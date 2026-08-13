// 조립 계층 대조 검사 — `lib/service/` 셋 (`turn.ts` · `story.ts` · `run.ts`).
//
// **여기서 동화가 처음부터 끝까지 도는지가 갈린다.**
//
// ## 진짜 DB 를 쓰고, 끝나면 되돌린다
//
// `tests/repo.test.ts` 와 같은 방식이다 — 트랜잭션을 열고 검사가 끝나면 **무조건 롤백**한다.
// 조립층은 「무엇을 어느 순서로 저장하나」가 알맹이라 가짜 DB 로는 잴 것이 남지 않는다.
// DB 가 없으면 `describe.skip` 이라 vitest 보고에 「skipped」로 뜬다 — 조용히 통과시키지 않는다.
//
// ## LLM 은 SDK 자리에서 가짜로 바꾼다
//
// ⛔ 진짜 공급자를 부르지 않는다. F-1 그물(`tests/support/sdk-gate.ts`)이 클라이언트를
// 만드는 순간 터뜨리고, 여기서는 `installFakeSdk('gemini', …)` 로 그 자리에 가짜를 꽂는다.
// **한 겹 위(`lib/llm`)를 가짜로 바꾸지 않는 이유**는 이 검사가 재려는 것 중 하나가
// 「CLOSING 일 때 LLM 호출이 **0** 인가」이고, 그건 SDK 자리에서 세야 진짜로 센 것이다.
//
// ## ⭐ 이 파일이 재는 여섯 (조립 트랙이 지켜야 하는 것)
//
// 1. 캐릭터는 `characterTurn()` 만 부른다 → **CLOSING 턴의 캐릭터 호출 수가 0**
// 2. `missing_elements` 를 저장하지 않는다 → 어느 표에도 그 칸이 없다
// 3. `turn_conditions` 에 판정을 박제한다 → 턴마다 한 행
// 4. 로그 세 줄을 찍는다 → `[분석]`·`[상태]`·`[판정]` 이 그 순서로
// 5. 커밋은 부르는 쪽이 한다 → 바깥 트랜잭션을 되돌리면 **한 행도 안 남는다**
// 6. `character_opening`·`character_closing` 은 고정 텍스트다 → 원문 그대로, LLM 0회

import { randomUUID } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { characters, messages, stories, story_scenes, story_sessions } from '@/db/schema'

// ── 장면 행을 읽은 **직후**에 끼어드는 자리 ────────────────────────────────
//
// 「사람이 시드를 고치는 순간」을 턴 한가운데 — **장면은 이미 정해졌고 아직 판정은 안 났을
// 때** — 에 정확히 놓으려고 저장 계층 함수 하나를 감싼다. 그 창이 결함 6 이 살던 자리다.
// 기본은 `null` 이라 다른 검사에는 아무 영향이 없고, 한 번 쓰이면 스스로 비운다.
// ⚠️ 팩토리 안에서 바깥 변수를 참조하면 hoisting 에 걸린다 (`admin.test.ts` 와 같은 상자).
const 상자 = vi.hoisted(() => ({ 장면_읽은_직후: null as null | (() => Promise<void>) }))

vi.mock('@/lib/repo/content', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/repo/content')>()
  return {
    ...real,
    scenesOfStory: async (...인자: Parameters<typeof real.scenesOfStory>) => {
      const 행들 = await real.scenesOfStory(...인자)
      const 끼어들기 = 상자.장면_읽은_직후
      상자.장면_읽은_직후 = null
      if (끼어들기 !== null) await 끼어들기()
      return 행들
    },
  }
})

import { loadSettings } from '@/lib/config'
import { read, sendableBody } from '@/lib/prompts'
import { closeDb, getDb, type Conn } from '@/lib/repo/db'
import { readAttempts } from '@/lib/repo/runs'
import { latestSeedRevision } from '@/lib/repo/seed'
import { insertMessage, readSession, sceneMessages } from '@/lib/repo/sessions'
import { readRunTurnConditions, readTurnCondition } from '@/lib/repo/turn-conditions'
import { saveExperimentPromptStep } from '@/lib/service/prompt-lab'
import { analysisStep, decisionStep, dialogueStep } from '@/lib/service/step'
import {
  advanceRun,
  inProgress,
  pendingTurn,
  restoreDecision,
  resumeTurn,
  runSettings,
  runState,
  startRun,
  submitTurn,
  turnFailureState,
  TurnInProgress,
  TurnNotAllowed,
  기본_프롬프트_버전,
} from '@/lib/service/run'
import { saveSeedCell } from '@/lib/service/seed'
import { runStory, startScene } from '@/lib/service/story'
import { isUsableUtterance, runDialogueStage, TurnFailed } from '@/lib/service/turn'

import { installFakeSdk } from './support/sdk-gate'

// ── DB 가 있나 (repo.test.ts 와 같은 문지기) ───────────────────────────────

async function 붙어보기(): Promise<string | null> {
  try {
    await getDb().execute(sql`select 1`)
    return null
  } catch (오류) {
    if (오류 instanceof Error && 오류.cause instanceof Error) {
      return `${오류.cause.name}: ${오류.cause.message}`
    }
    return 오류 instanceof Error ? `${오류.name}: ${오류.message}` : String(오류)
  }
}

const 못붙는_이유 = await 붙어보기()
if (못붙는_이유 !== null) {
  process.stderr.write(
    `\n[service.test] Postgres 에 못 붙어 조립 계층 검사를 건너뛴다 (도커가 꺼져 있나?)\n` +
      `              ${못붙는_이유}\n\n`,
  )
}
const 검사 = 못붙는_이유 === null ? describe : describe.skip

afterAll(async () => {
  await closeDb()
})

// ── 트랜잭션을 열고 끝나면 되돌린다 ────────────────────────────────────────

class 되돌림 extends Error {}

async function 트랜잭션(본문: (tx: Conn) => Promise<void>): Promise<void> {
  try {
    await getDb().transaction(async (tx) => {
      await 본문(tx)
      throw new 되돌림('검사가 끝났으니 되돌린다')
    })
  } catch (오류) {
    if (!(오류 instanceof 되돌림)) throw 오류
  }
}

// ── 가짜 제미나이 ─────────────────────────────────────────────────────────

interface 가짜_설정 {
  /** 이번 분석이 찾아냈다고 할 요소들. 기본은 **그 장면의 목표 전부**. */
  요소들?: (턴: number, 목표: string[]) => string[]
  분석_실패?: boolean
  대사_실패?: boolean
  /**
   * **앞의 N 번 시도만** API 에러로 떨어뜨린다 — 체인의 다음 칸이 이어받아 성공한다.
   * `분석_실패`(전부 실패)와 달리 **fallback 으로 살아난 턴**을 만드는 자리다.
   */
  분석_먼저_실패?: number
  utterance_validity?: string
}

interface 가짜_기록 {
  /** ⭐ `system` 도 적는다 — 「이 회차가 어느 프롬프트로 돌았나」를 재는 자리다 (T094). */
  호출: { 용도: '분석' | '대사'; user: string; system: string }[]
  설정: 가짜_설정
}

/** 재료 JSON 에서 값 하나를 꺼낸다. 검사가 「무엇을 보냈나」를 되읽는 자리다. */
function 뽑기(user: string, 열쇠: string): string {
  const 맞은것 = new RegExp(`"${열쇠}":"((?:[^"\\\\]|\\\\.)*)"`).exec(user)
  return 맞은것 === null ? '' : (JSON.parse(`"${맞은것[1]}"`) as string)
}

function 목표_뽑기(user: string): string[] {
  const 맞은것 = /"target_elements":\[([^\]]*)\]/.exec(user)
  if (맞은것 === null || 맞은것[1].trim() === '') return []
  return JSON.parse(`[${맞은것[1]}]`) as string[]
}

/**
 * SDK 자리에 가짜를 꽂는다. 분석과 대사는 **`response_format` 유무**로 가른다 —
 * 분석만 JSON 스키마를 실어 보내기 때문이다 (`lib/llm/index.ts` 의 `geminiRequest()`).
 */
function 가짜_제미나이(설정: 가짜_설정 = {}): 가짜_기록 {
  const 기록: 가짜_기록 = { 호출: [], 설정 }

  installFakeSdk('gemini', () => ({
    interactions: {
      create: async (요청: Record<string, unknown>) => {
        const user = String(요청.input ?? '')
        const 분석인가 = 요청.response_format !== undefined
        기록.호출.push({
          용도: 분석인가 ? '분석' : '대사',
          user,
          system: String(요청.system_instruction ?? ''),
        })

        // ⭐ 몇 번째 시도인가 — 방금 밀어 넣은 것을 포함한 수다. 체인이 키를 바꿔 다시 부르면
        //    이 수만 오르고 `messages` 는 그대로다 (한 턴의 attempt_no 와 같은 뜻이다).
        const 분석_차례 = () => 기록.호출.filter((하나) => 하나.용도 === '분석').length

        if (분석인가) {
          if (기록.설정.분석_실패) throw new Error('APIError: 분석 500')
          if ((기록.설정.분석_먼저_실패 ?? 0) >= 분석_차례()) {
            throw new Error('APIError: 분석 503 (이 칸만 실패한다)')
          }
          const 발화 = 뽑기(user, 'child_utterance')
          const 턴 = 기록.호출.filter((하나) => 하나.용도 === '분석').length
          const 고르기 = 기록.설정.요소들 ?? ((_턴: number, 목표: string[]) => 목표)
          return {
            output_text: JSON.stringify({
              child_intent: 'OPINION',
              main_point: `${발화}`,
              // evidence 는 아이 발화 원문이라 후처리(`postProcess`)를 그대로 통과한다.
              detected_elements: 고르기(턴, 목표_뽑기(user)).map((type) => ({
                type,
                evidence: 발화,
              })),
              utterance_validity: 기록.설정.utterance_validity ?? 'VALID',
            }),
            usage_metadata: { prompt_token_count: 100, candidates_token_count: 20 },
          }
        }

        if (기록.설정.대사_실패) throw new Error('APIError: 대사 500')
        return {
          output_text: `그러게 말이다 (${기록.호출.length})`,
          usage_metadata: { prompt_token_count: 200, candidates_token_count: 30 },
        }
      },
    },
  }))

  return 기록
}

function 대사_호출수(기록: 가짜_기록): number {
  return 기록.호출.filter((하나) => 하나.용도 === '대사').length
}

// ── 콘솔 줄 모으기 ────────────────────────────────────────────────────────

let 찍힌_줄: string[] = []
let 원래_log: ReturnType<typeof vi.spyOn> | null = null

beforeEach(() => {
  찍힌_줄 = []
  원래_log = vi.spyOn(console, 'log').mockImplementation((...조각들: unknown[]) => {
    찍힌_줄.push(조각들.map((하나) => String(하나)).join(' '))
  })
})

afterEach(() => {
  원래_log?.mockRestore()
  원래_log = null
})

/** 로그 세 줄만 골라 낸다. `[LLM]`·`[세션]` 같은 줄은 뺀다. */
function 세줄(): string[] {
  return 찍힌_줄.filter((줄) => /^\[(분석|상태|판정)\]/.test(줄))
}

// ── 검사용 콘텐츠 ─────────────────────────────────────────────────────────

interface 씨앗 {
  story_id: string
  story_code: string
  /** `sc_svc_01`(전개) `02`(전개) `03`(대화) `04`(전개) `05`(대화) */
  scene_ids: Record<string, string>
}

/** 전개와 대화가 섞인 다섯 장면. 「방귀 뀌는 며느리」와 같은 모양이다. */
async function 콘텐츠_넣기(tx: Conn): Promise<씨앗> {
  const 꼬리 = randomUUID().slice(0, 8)
  const story_code = `s_svc_${꼬리}`

  const [이야기] = await tx
    .insert(stories)
    .values({
      code: story_code,
      title: `조립 검사용 ${꼬리}`,
      summary: '검사용',
      difficulty: '보통',
      status: 'draft',
    })
    .returning({ id: stories.id })

  const [캐릭터] = await tx
    .insert(characters)
    .values({
      story_id: 이야기.id,
      code: 'ch_svc_daughter_in_law',
      name: '며느리',
      persona: '시집온 지 얼마 안 된 며느리',
      speech_style: '옛이야기 말투',
      guidance_style: '자기 걱정을 소리 내어 말한다',
      forbidden: ['설명하지 않는다'],
    })
    .returning({ id: characters.id })

  const 대화칸 = {
    character_id: 캐릭터.id,
    character_name: '며느리',
    character_opening: '아이고… 나 때문에 다들 놀랐지 뭐야.',
    character_closing: '네 말을 들으니 마음이 놓이는구나.',
    scene_stance: '아직 참고 있다',
    scene_goal: '아이가 며느리의 처지를 헤아리게 한다',
    required_elements: ['EMPATHY', 'SOLUTION'],
    element_criteria: { SOLUTION: '어떻게 하면 좋을까?' },
    remaining_worries: { SOLUTION: '그럼 난 어떻게 하면 좋을까…' },
    preferred_turns: 2,
    max_turns: 4,
  }

  const 넣은_장면들 = await tx
    .insert(story_scenes)
    .values([
      { story_id: 이야기.id, code: 'sc_svc_01', scene_order: 1, scene_description: '전개 1' },
      { story_id: 이야기.id, code: 'sc_svc_02', scene_order: 2, scene_description: '전개 2' },
      { story_id: 이야기.id, code: 'sc_svc_03', scene_order: 3, conflict: '갈등', ...대화칸 },
      { story_id: 이야기.id, code: 'sc_svc_04', scene_order: 4, scene_description: '전개 4' },
      { story_id: 이야기.id, code: 'sc_svc_05', scene_order: 5, conflict: '갈등', ...대화칸 },
    ])
    .returning({ id: story_scenes.id, code: story_scenes.code })

  const scene_ids: Record<string, string> = {}
  for (const 행 of 넣은_장면들) scene_ids[행.code] = 행.id
  return { story_id: 이야기.id, story_code, scene_ids }
}

/** 회차를 열고 **첫 대화 장면 앞까지** 전개를 재생해 둔다. */
async function 회차_준비(tx: Conn): Promise<{ 씨: 씨앗; run_id: string; session_id: string }> {
  const 씨 = await 콘텐츠_넣기(tx)
  const { run } = await startRun(tx, { story_code: 씨.story_code, started_by: '검사' })
  const 할_일 = await advanceRun(tx, run.id)
  expect(할_일.kind).toBe('발화받기')
  return { 씨, run_id: run.id, session_id: run.session_id }
}

// ═══════════════════════════════════════════════════════════════════════════
// DB 없이도 도는 것
// ═══════════════════════════════════════════════════════════════════════════

describe('service — DB 를 안 보는 조각들', () => {
  it('확정 텍스트가 없으면 발화로 치지 않는다 (db구조.md:302)', () => {
    expect(isUsableUtterance('며느리가 불쌍해요')).toBe(true)
    expect(isUsableUtterance(' ')).toBe(false)
    expect(isUsableUtterance('')).toBe(false)
    expect(isUsableUtterance(null)).toBe(false)
    expect(isUsableUtterance(undefined)).toBe(false)
  })

  it('회차에 적힌 강도 한 값이 **두 공급자에 다 간다** (2026-08-11)', () => {
    const 바닥 = loadSettings({
      gemini_model: '바닥모델',
      gemini_effort: '바닥강도',
      anthropic_effort: '바닥강도',
    })
    const { analysis, character } = runSettings(
      {
        analysis_model: 'gemini-3.5-flash-lite',
        analysis_effort: 'low',
        character_model: null,
        character_effort: 'high',
      },
      바닥,
    )

    expect(analysis.gemini_model).toBe('gemini-3.5-flash-lite')
    expect(analysis.gemini_effort).toBe('low')
    expect(analysis.anthropic_effort).toBe('low')
    // 회차에 없으면 바닥값이 남는다 — 지어내지 않는다.
    expect(character.gemini_model).toBe('바닥모델')
    expect(character.gemini_effort).toBe('high')
    expect(character.anthropic_effort).toBe('high')
  })

  it('박제된 판정을 그대로 되살린다 — 다시 계산하지 않는다 (FR-016)', () => {
    const 되살린 = restoreDecision({
      message_id: 'm',
      run_id: 'r',
      seed_revision: 0,
      prompt_version: 'mvp_v1',
      current_child_turn_count: 2,
      accumulated_elements: ['EMPATHY', 'SOLUTION'],
      last_response_mode: 'NORMAL',
      turns_without_new_element: 0,
      consecutive_low_information_turns: 0,
      response_mode: 'CLOSING',
      guidance_target: null,
      soft_cue: false,
      reaction_key: 'directResponse',
      scene_goal_met: true,
      scene_end_reason: 'GOAL_MET',
    })
    expect(되살린.response_mode).toBe('CLOSING')
    expect(되살린.scene_end_reason).toBe('GOAL_MET')
    expect(되살린.accumulated_elements).toEqual(['EMPATHY', 'SOLUTION'])
  })

  it('두 번 보내기 잠금은 회차마다 따로다 (runs.session_id 가 UNIQUE 라서)', () => {
    const 가 = randomUUID()
    const 나 = randomUUID()
    expect(inProgress.start(가)).toBe(true)
    // 같은 회차의 둘째 호출은 못 들어온다.
    expect(inProgress.start(가)).toBe(false)
    // 다른 회차는 막지 않는다.
    expect(inProgress.start(나)).toBe(true)

    inProgress.setStage(가, '분석 시작', '')
    expect(inProgress.read(가)).toBe('분석 시작')
    inProgress.notify(가)('캐릭터 대사 시작', '며느리')
    expect(inProgress.read(가)).toBe('캐릭터 대사 시작: 며느리')

    inProgress.end(가)
    inProgress.end(나)
    expect(inProgress.read(가)).toBeNull()
    // 안 도는 회차에는 단계가 남지 않는다.
    inProgress.setStage(가, '분석 시작')
    expect(inProgress.read(가)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 조립-1 한 턴
// ═══════════════════════════════════════════════════════════════════════════

검사('service/turn — 한 턴이 흐르는 길 ③→⑨', () => {
  it('분석 → 판단 → 대사가 한 턴으로 이어지고 남을 것이 다 남는다', async () => {
    const 기록 = 가짜_제미나이({ 요소들: (턴, 목표) => (턴 === 1 ? [목표[0]] : 목표) })

    await 트랜잭션(async (tx) => {
      const { 씨, run_id, session_id } = await 회차_준비(tx)

      const 결과 = await submitTurn({
        run_id,
        child_utterance: '며느리가 창피했을 것 같아',
        conn: tx,
      })

      // ⑤ 분석 — 후처리 전 원본이 그대로 온다 (결정 26)
      expect(결과.analysis.child_intent).toBe('OPINION')
      expect(결과.kept).toEqual(['EMPATHY'])
      expect(결과.dropped).toEqual([])

      // ⑥ 판정 — 첫 발화라 NORMAL 강제, 신규 요소가 있어 soft-cue (결정 15)
      expect(결과.decision.response_mode).toBe('NORMAL')
      expect(결과.decision.soft_cue).toBe(true)
      expect(결과.decision.guidance_target).toBe('SOLUTION')
      expect(결과.missing).toEqual(['SOLUTION'])

      // ⑦ 대사 — 캐릭터 LLM 이 만든 문장이다
      expect(결과.dialogue.source).toBe('generated')
      expect(결과.dialogue.text).toMatch(/그러게 말이다/)
      expect(결과.dialogue.overwritten).toBe(false)

      // ⑧ 저장 — messages 셋(고정 첫 대사 · 아이 · 캐릭터)
      const 대화 = await sceneMessages(tx, {
        session_id,
        scene_id: 씨.scene_ids.sc_svc_03,
      })
      expect(대화.map((행) => 행.speaker_type)).toEqual(['character', 'child', 'character'])
      expect(대화[0].text).toBe('아이고… 나 때문에 다들 놀랐지 뭐야.')
      expect(대화[1].text).toBe('며느리가 창피했을 것 같아')

      // story_sessions — 이번 턴을 반영한 값
      const 세션 = await readSession(tx, session_id)
      expect(세션.current_child_turn_count).toBe(1)
      expect(세션.accumulated_elements).toEqual(['EMPATHY'])
      expect(세션.last_detected_elements).toEqual(['EMPATHY'])
      expect(세션.last_response_mode).toBe('NORMAL')
      expect(세션.last_guidance_target).toBe('SOLUTION')
      expect(세션.scene_end_reason).toBeNull()

      // llm_calls — 분석 한 번, 대사 한 번. 토큰이 남아 있어야 예산 판단(B-4)이 선다
      const 시도들 = await readAttempts(tx, { run_id, message_id: 결과.child_message_id })
      expect(시도들.map((행) => 행.purpose).sort()).toEqual(['analysis', 'character'])
      expect(시도들.every((행) => 행.ok)).toBe(true)
      expect(시도들.every((행) => (행.input_tokens ?? 0) > 0)).toBe(true)

      // ⚠️ 아이 발화는 회차의 기본 출처를 그대로 문다 (요청에 두지 않는다)
      const 아이_행 = await tx
        .select({ utterance_source: messages.utterance_source })
        .from(messages)
        .where(eq(messages.id, 결과.child_message_id))
      expect(아이_행[0].utterance_source).toBe('synthetic_adult')

      expect(기록.호출.map((하나) => 하나.용도)).toEqual(['분석', '대사'])
    })
  })

  it('⭐ 로그 세 줄을 그 순서로 찍는다 — 이 레포의 존재 이유다', async () => {
    가짜_제미나이({ 요소들: (턴, 목표) => (턴 === 1 ? [목표[0]] : 목표) })

    await 트랜잭션(async (tx) => {
      const { run_id } = await 회차_준비(tx)
      await submitTurn({ run_id, child_utterance: '며느리가 창피했을 것 같아', conn: tx })

      const 줄들 = 세줄()
      expect(줄들).toHaveLength(3)
      expect(줄들[0]).toMatch(
        /^\[분석\] child_intent=OPINION main_point=".*" detected_elements=\[EMPATHY\("며느리가 창피했을 것 같아"\)\] utterance_validity=VALID 버림=\[\]$/,
      )
      // missing_elements 는 저장하지 않는 계산값인데도 찍는다 (경계 5 · 결정 23)
      expect(줄들[1]).toBe(
        '[상태] current_child_turn_count=1 accumulated_elements=[EMPATHY]' +
          ' missing_elements=[SOLUTION] last_response_mode=null' +
          ' turns_without_new_element=0 consecutive_low_information_turns=0',
      )
      expect(줄들[2]).toBe(
        '[판정] response_mode=NORMAL guidance_target=SOLUTION soft_cue=true' +
          ' reaction_key=empathyFromChild scene_goal_met=false scene_end_reason=null',
      )
    })
  })

  it('⭐ 판정을 turn_conditions 에 박제한다 — 없으면 턴 로그가 회차를 못 그린다', async () => {
    가짜_제미나이({ 요소들: (턴, 목표) => (턴 === 1 ? [목표[0]] : 목표) })

    await 트랜잭션(async (tx) => {
      const { run_id } = await 회차_준비(tx)
      const 결과 = await submitTurn({ run_id, child_utterance: '며느리가 불쌍해', conn: tx })

      const 조건 = await readTurnCondition(tx, 결과.child_message_id)
      expect(조건).not.toBeNull()
      // [상태] 줄
      expect(조건!.current_child_turn_count).toBe(1)
      expect(조건!.accumulated_elements).toEqual(['EMPATHY'])
      expect(조건!.last_response_mode).toBeNull()
      // [판정] 줄
      expect(조건!.response_mode).toBe('NORMAL')
      expect(조건!.guidance_target).toBe('SOLUTION')
      expect(조건!.soft_cue).toBe(true)
      // 회차에서 베껴 박제한다
      expect(조건!.prompt_version).toBe('mvp_v1')

      // ⛔ 경계 5 — `missing_elements` 는 **어느 표에도** 없다. 매번 빼서 쓴다.
      expect('missing_elements' in 조건!).toBe(false)
      expect('missing_elements' in (await readSession(tx, 결과.session.id))).toBe(false)
      expect(결과.missing).toEqual(['SOLUTION'])
    })
  })

  it('⭐ CLOSING 이면 캐릭터 LLM 을 **한 번도** 안 부르고 고정 마지막 대사를 재생한다', async () => {
    // 경계 4 · 결정 36. 가르는 자리는 `characterTurn()` 하나뿐이라 조립층에는
    // 'CLOSING' 이라는 글자가 없다 — 그것이 실제로 지켜지는지 **호출 수**로 잰다.
    const 기록 = 가짜_제미나이()

    await 트랜잭션(async (tx) => {
      const { 씨, run_id, session_id } = await 회차_준비(tx)

      // 첫 턴에 목표를 다 채워도 preferred_turns(2) 를 못 채워 아직 CLOSING 이 아니다.
      await submitTurn({ run_id, child_utterance: '며느리가 창피했을 것 같아', conn: tx })
      expect(대사_호출수(기록)).toBe(1)

      찍힌_줄 = []
      const 둘째 = await submitTurn({
        run_id,
        child_utterance: '몰래 알려주면 될 것 같아',
        conn: tx,
      })

      expect(둘째.decision.response_mode).toBe('CLOSING')
      expect(둘째.decision.scene_end_reason).toBe('GOAL_MET')
      // 🔴 이 줄이 경계 4 다 — 대사 호출이 **안 늘었다**
      expect(대사_호출수(기록)).toBe(1)
      expect(둘째.dialogue.llm).toBeNull()
      expect(둘째.dialogue.source).toBe('fixed')
      // story_scenes 원문 그대로. 생성하지 않는다
      expect(둘째.dialogue.text).toBe('네 말을 들으니 마음이 놓이는구나.')

      // CLOSING 이어도 messages 는 **한 행**이다 (결정 21 · 36)
      const 대화 = await sceneMessages(tx, { session_id, scene_id: 씨.scene_ids.sc_svc_03 })
      expect(대화.map((행) => 행.speaker_type)).toEqual([
        'character',
        'child',
        'character',
        'child',
        'character',
      ])

      // llm_calls 에도 그 턴의 캐릭터 시도가 없다
      const 시도들 = await readAttempts(tx, { run_id, message_id: 둘째.child_message_id })
      expect(시도들.map((행) => 행.purpose)).toEqual(['analysis'])

      // 로그 — 고정 대사에는 `[고정]` 이 붙고 장면끝 줄이 따라온다
      expect(찍힌_줄).toContain('[고정] 며느리: 네 말을 들으니 마음이 놓이는구나.')
      expect(찍힌_줄.some((줄) => 줄.startsWith('[장면끝 3] scene_end_reason=GOAL_MET'))).toBe(true)
    })
  })

  it('⭐ 바깥 트랜잭션을 되돌리면 한 행도 안 남는다 — 커밋은 부르는 쪽이 한다', async () => {
    // 결정 18. 조립층이 스스로 커밋해 버리면 이 검사가 빨개진다.
    가짜_제미나이()
    let 남긴_세션 = ''

    await 트랜잭션(async (tx) => {
      const { run_id, session_id } = await 회차_준비(tx)
      남긴_세션 = session_id
      await submitTurn({ run_id, child_utterance: '며느리가 불쌍해', conn: tx })
    })

    const 세션들 = await getDb()
      .select({ id: story_sessions.id })
      .from(story_sessions)
      .where(eq(story_sessions.id, 남긴_세션))
    expect(세션들).toEqual([])

    const 메시지들 = await getDb()
      .select({ id: messages.id })
      .from(messages)
      .where(eq(messages.session_id, 남긴_세션))
    expect(메시지들).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 조립-2 장면
// ═══════════════════════════════════════════════════════════════════════════

검사('service/story — 전개는 지문, 대화는 멀티턴', () => {
  it('전개 장면은 messages 를 안 남기고 지문만 찍는다 (결정 22)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const { run } = await startRun(tx, { story_code: 씨.story_code })

      const 할_일 = await advanceRun(tx, run.id)

      // 전개 1·2 를 지나 대화 3 에서 멈춘다
      expect(할_일.kind).toBe('발화받기')
      expect(할_일.scene_id).toBe(씨.scene_ids.sc_svc_03)
      expect(찍힌_줄).toContain('[전개 1] 전개 1')
      expect(찍힌_줄).toContain('[전개 2] 전개 2')

      const 전개_메시지 = await sceneMessages(tx, {
        session_id: run.session_id,
        scene_id: 씨.scene_ids.sc_svc_01,
      })
      expect(전개_메시지).toEqual([])
    })
  })

  it('⭐ character_opening 은 고정 텍스트다 — 재생만 하고 LLM 을 안 부른다 (경계 4)', async () => {
    const 기록 = 가짜_제미나이()

    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const { run } = await startRun(tx, { story_code: 씨.story_code })
      await advanceRun(tx, run.id)

      const 대화 = await sceneMessages(tx, {
        session_id: run.session_id,
        scene_id: 씨.scene_ids.sc_svc_03,
      })
      expect(대화).toHaveLength(1)
      expect(대화[0].text).toBe('아이고… 나 때문에 다들 놀랐지 뭐야.')
      expect(기록.호출).toEqual([])
      expect(찍힌_줄).toContain('[고정] 며느리: 아이고… 나 때문에 다들 놀랐지 뭐야.')
    })
  })

  it('장면에 들어가면 앞 장면의 누적이 지워진다 (안 지우면 첫 턴에 GOAL_MET)', async () => {
    가짜_제미나이()

    await 트랜잭션(async (tx) => {
      const { 씨, run_id, session_id } = await 회차_준비(tx)
      await submitTurn({ run_id, child_utterance: '며느리가 창피했을 것 같아', conn: tx })
      expect((await readSession(tx, session_id)).accumulated_elements).not.toEqual([])

      await startScene(tx, {
        session_id,
        scene: (await runState(tx, run_id)).scenes.find(
          (행) => 행.scene_id === 씨.scene_ids.sc_svc_05,
        )!,
      })
      const 세션 = await readSession(tx, session_id)
      expect(세션.current_scene_id).toBe(씨.scene_ids.sc_svc_05)
      expect(세션.current_child_turn_count).toBe(0)
      expect(세션.accumulated_elements).toEqual([])
      expect(세션.scene_end_reason).toBeNull()
    })
  })

  it('⭐ 「방귀 뀌는 며느리」가 장면 1→9 로 끝까지 돈다', async () => {
    // ⚠️ `npx tsx db/seed.ts` 를 한 번도 안 돌린 DB 라면 여기서 빨개진다. 그게 맞다.
    // 가짜 분석이 **그 장면의 목표를 다 찾아냈다**고 하므로 각 장면은 preferred_turns
    // 에서 GOAL_MET 으로 닫힌다 — 2 + 3 + 3 + 2 = 열 턴.
    const 기록 = 가짜_제미나이()

    await 트랜잭션(async (tx) => {
      const { run } = await startRun(tx, {
        story_code: 's_banggui_daughter_in_law_001',
        started_by: '검사',
      })

      const 결과 = await runStory({
        conn: tx,
        run_id: run.id,
        session_id: run.session_id,
        story_code: 's_banggui_daughter_in_law_001',
        prompt_version: 'mvp_v1',
        utterance_source: 'synthetic_adult',
        input: () => '며느리가 창피했을 것 같아',
      })

      expect(결과.completed).toBe(true)
      expect(결과.step?.kind).toBe('회차끝')
      expect(결과.turns).toHaveLength(10)

      // 장면마다 마지막 턴이 CLOSING 이고 고정 마지막 대사가 나갔다
      const 닫은_턴 = 결과.turns.filter((턴) => 턴.dialogue.source === 'fixed')
      expect(닫은_턴).toHaveLength(4)
      expect(닫은_턴.every((턴) => 턴.decision.scene_end_reason === 'GOAL_MET')).toBe(true)
      // 🔴 CLOSING 턴 넷은 캐릭터 LLM 을 안 불렀다 — 분석 10, 대사 6
      expect(기록.호출.filter((하나) => 하나.용도 === '분석')).toHaveLength(10)
      expect(대사_호출수(기록)).toBe(6)

      const 세션 = await readSession(tx, run.session_id)
      expect(세션.status).toBe('completed')
      expect(세션.completed_at).not.toBeNull()

      // 전개 다섯은 messages 를 안 남기고, 대화 넷은 (첫 대사 + 턴마다 두 줄) 을 남긴다
      const 전부 = await tx
        .select({ speaker_type: messages.speaker_type })
        .from(messages)
        .where(eq(messages.session_id, run.session_id))
      expect(전부.filter((행) => 행.speaker_type === 'child')).toHaveLength(10)
      expect(전부.filter((행) => 행.speaker_type === 'character')).toHaveLength(4 + 10)

      // 턴 판정이 아이가 말한 순서대로 열 줄 남는다 (턴 로그 화면의 재료)
      expect(await readRunTurnConditions(tx, run.id)).toHaveLength(10)
    })
  }, 30_000)
})

// ═══════════════════════════════════════════════════════════════════════════
// 조립-3 회차 · 잠금 · ③ 재호출
// ═══════════════════════════════════════════════════════════════════════════

검사('service/run — 회차 · 잠금 · 이어 돌리기', () => {
  it('회차와 세션은 함께 생기고 1:1 이다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const { run, session_id } = await startRun(tx, {
        story_code: 씨.story_code,
        started_by: '검사',
        experiment_note: '조립 검사',
      })
      expect(run.session_id).toBe(session_id)
      expect(run.scope).toBe('story')
      expect(run.scene_order).toBeNull()
      expect(run.default_utterance_source).toBe('synthetic_adult')
      expect(run.prompt_version).toBe('mvp_v1')

      const 상태 = await runState(tx, run.id)
      expect(상태.session.story_code).toBe(씨.story_code)
      expect(상태.scenes).toHaveLength(5)
      // 아직 장면에 안 들어갔다 → 첫 장면을 시작할 차례
      expect(상태.step.kind).toBe('장면시작')
    })
  })

  it('⭐ 두 번 보내기 잠금 — 도는 중이면 튕기고 messages 가 안 늘어난다', async () => {
    가짜_제미나이()

    await 트랜잭션(async (tx) => {
      const { run_id, session_id } = await 회차_준비(tx)

      // 다른 호출이 잡고 있는 상태를 만든다 (실제로는 앞 요청이 아직 도는 중이다)
      expect(inProgress.start(run_id)).toBe(true)
      try {
        await expect(
          submitTurn({ run_id, child_utterance: '며느리가 불쌍해', conn: tx }),
        ).rejects.toThrow(TurnInProgress)
      } finally {
        inProgress.end(run_id)
      }

      // 아이 메시지가 하나도 안 생겼다 — 턴 수가 어긋나지 않는다 (FR-035)
      const 대화 = await sceneMessages(tx, {
        session_id,
        scene_id: (await runState(tx, run_id)).session.current_scene_id!,
      })
      expect(대화.filter((행) => 행.speaker_type === 'child')).toHaveLength(0)

      // 잠금은 끝나면 풀린다 — 다음 호출은 들어간다
      await submitTurn({ run_id, child_utterance: '며느리가 불쌍해', conn: tx })
      expect(inProgress.read(run_id)).toBeNull()
    })
  })

  it('발화받기 차례가 아니면 거절한다 (409 자리)', async () => {
    가짜_제미나이()

    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const { run } = await startRun(tx, { story_code: 씨.story_code })
      // 아직 장면에 안 들어갔다 → 발화를 받을 차례가 아니다
      await expect(
        submitTurn({ run_id: run.id, child_utterance: '며느리가 불쌍해', conn: tx }),
      ).rejects.toThrow(TurnNotAllowed)
      // 튕긴 뒤에도 잠금이 남지 않는다
      expect(inProgress.read(run.id)).toBeNull()
    })
  })

  it('빈 발화는 행을 만들지 않는다 (400 자리)', async () => {
    await 트랜잭션(async (tx) => {
      const { run_id } = await 회차_준비(tx)
      await expect(submitTurn({ run_id, child_utterance: '   ', conn: tx })).rejects.toThrow(
        /비어 있다/,
      )
    })
  })

  it('⭐ ③ 이 죽으면 아이 메시지만 남고, 같은 턴으로 이어 돌린다', async () => {
    // 2026-08-12 사람 결정 (`라우트계약.md` 8절).
    const 기록 = 가짜_제미나이({
      대사_실패: true,
      요소들: (턴, 목표) => (턴 === 1 ? [목표[0]] : 목표),
    })

    await 트랜잭션(async (tx) => {
      const { 씨, run_id, session_id } = await 회차_준비(tx)

      const 오류 = await submitTurn({
        run_id,
        child_utterance: '며느리가 창피했을 것 같아',
        conn: tx,
      }).then(
        () => null,
        (e: unknown) => e,
      )
      expect(오류).toBeInstanceOf(TurnFailed)
      const 실패 = 오류 as TurnFailed
      expect(실패.stage).toBe('character')

      // 아이 메시지·분석·판정은 남아 있다. 되돌리지 않는다 (결정 18 · 44)
      const 미완 = await pendingTurn(tx, { session_id })
      expect(미완).toEqual({ message_id: 실패.child_message_id, stage: 'character' })
      expect(await readTurnCondition(tx, 실패.child_message_id)).not.toBeNull()

      // 실패 사유가 기록에 남는다 — 메모리가 아니라 llm_calls 에서 읽는다 (FR-040)
      const 상태 = await turnFailureState(tx, { run_id, session_id })
      expect(상태?.failed).toBe(true)
      expect(상태?.reasons.every((행) => 행.purpose === 'character')).toBe(true)

      // 새 발화를 받지 않는다 — 받으면 messages 가 하나 더 생겨 턴 수가 어긋난다
      await expect(
        submitTurn({ run_id, child_utterance: '다른 말', conn: tx }),
      ).rejects.toThrow(TurnNotAllowed)

      // ③ 만 다시 돈다. **분석도 판정도 다시 하지 않는다**
      기록.설정.대사_실패 = false
      const 분석_호출 = 기록.호출.filter((하나) => 하나.용도 === '분석').length
      const 이어감 = await resumeTurn({ run_id, child_message_id: 실패.child_message_id, conn: tx })

      expect(이어감.resumed_from).toBe('character')
      expect(이어감.decision.response_mode).toBe('NORMAL')
      expect(이어감.dialogue.source).toBe('generated')
      expect(기록.호출.filter((하나) => 하나.용도 === '분석')).toHaveLength(분석_호출)

      // 턴 수도 messages 도 늘지 않았다 (FR-015 · FR-035)
      expect((await readSession(tx, session_id)).current_child_turn_count).toBe(1)
      const 대화 = await sceneMessages(tx, { session_id, scene_id: 씨.scene_ids.sc_svc_03 })
      expect(대화.map((행) => 행.speaker_type)).toEqual(['character', 'child', 'character'])
      expect(await pendingTurn(tx, { session_id })).toBeNull()
    })
  })

  it('⭐ ③ 을 다시 부르면 캐릭터 행을 **덮어쓴다** — 같은 턴의 대사가 둘이 되지 않는다', async () => {
    가짜_제미나이({ 요소들: (턴, 목표) => (턴 === 1 ? [목표[0]] : 목표) })

    await 트랜잭션(async (tx) => {
      const { 씨, run_id, session_id } = await 회차_준비(tx)
      const 결과 = await submitTurn({
        run_id,
        child_utterance: '며느리가 창피했을 것 같아',
        conn: tx,
      })
      const 처음_대사 = 결과.dialogue.message_id

      // 관리자가 모드를 GUIDED 로 바꿔 대사만 다시 만든다 — 이 레포의 존재 이유다
      const 다시 = await runDialogueStage({
        conn: tx,
        run_id,
        session_id,
        scene: (await runState(tx, run_id)).scenes.find(
          (행) => 행.scene_id === 씨.scene_ids.sc_svc_03,
        )!,
        child_utterance: '며느리가 창피했을 것 같아',
        child_message_id: 결과.child_message_id,
        turn_order: 결과.turn_order,
        main_point: 결과.analysis.main_point,
        decision: {
          response_mode: 'GUIDED',
          reaction_key: 'directResponse',
          guidance_target: 'SOLUTION',
        },
      })

      expect(다시.overwritten).toBe(true)
      expect(다시.message_id).toBe(처음_대사)
      expect(다시.text).not.toBe(결과.dialogue.text)

      const 대화 = await sceneMessages(tx, { session_id, scene_id: 씨.scene_ids.sc_svc_03 })
      expect(대화).toHaveLength(3)
      expect(대화[2].text).toBe(다시.text)

      // ⛔ 세션은 안 건드린다 — 갱신은 ② 가 이미 끝냈다 (턴이 두 번 오르지 않는다)
      expect((await readSession(tx, session_id)).current_child_turn_count).toBe(1)
    })
  })

  it('① 이 죽으면 분석부터 이어 돈다 — 아이 메시지는 그 행 그대로다', async () => {
    const 기록 = 가짜_제미나이({ 분석_실패: true })

    await 트랜잭션(async (tx) => {
      const { run_id, session_id } = await 회차_준비(tx)

      const 오류 = await submitTurn({
        run_id,
        child_utterance: '며느리가 창피했을 것 같아',
        conn: tx,
      }).then(
        () => null,
        (e: unknown) => e,
      )
      expect((오류 as TurnFailed).stage).toBe('analysis')

      const 미완 = await pendingTurn(tx, { session_id })
      expect(미완?.stage).toBe('analysis')
      // 실패한 시도가 남아 있다 (결정 33 — 넘어간 흔적이 없으면 되짚을 수 없다)
      const 시도들 = await readAttempts(tx, { run_id, message_id: 미완!.message_id })
      expect(시도들.length).toBeGreaterThan(0)
      expect(시도들.every((행) => !행.ok && 행.purpose === 'analysis')).toBe(true)

      기록.설정.분석_실패 = false
      const 이어감 = await resumeTurn({ run_id, child_message_id: 미완!.message_id, conn: tx })
      expect(이어감.resumed_from).toBe('analysis')
      expect(이어감.dialogue.source).toBe('generated')

      // 아이 메시지는 하나뿐이고 턴 수도 1 이다 (FR-015 · FR-035)
      const 세션 = await readSession(tx, session_id)
      expect(세션.current_child_turn_count).toBe(1)
      const 대화 = await sceneMessages(tx, {
        session_id,
        scene_id: 세션.current_scene_id!,
      })
      expect(대화.filter((행) => 행.speaker_type === 'child')).toHaveLength(1)
    })
  })

  it('돌고 있는 회차는 실패라고 말하지 않는다 (2026-08-07)', async () => {
    가짜_제미나이({ 대사_실패: true })

    await 트랜잭션(async (tx) => {
      const { run_id, session_id } = await 회차_준비(tx)
      await submitTurn({ run_id, child_utterance: '며느리가 불쌍해', conn: tx }).catch(() => null)

      // 미완 턴이 있어도 **도는 중**이면 화면에 실패를 띄우지 않는다
      inProgress.start(run_id)
      try {
        expect(await turnFailureState(tx, { run_id, session_id })).toBeNull()
      } finally {
        inProgress.end(run_id)
      }
      expect((await turnFailureState(tx, { run_id, session_id }))?.failed).toBe(true)
    })
  })

  it('실패 행이 없는 미완 턴은 「끝나지 않은 턴」이지 「실패한 턴」이 아니다', async () => {
    await 트랜잭션(async (tx) => {
      const { 씨, run_id, session_id } = await 회차_준비(tx)
      // 서버가 도중에 내려간 옛 턴 흉내 — 아이 메시지만 있고 시도 기록이 없다
      await insertMessage(tx, {
        session_id,
        scene_id: 씨.scene_ids.sc_svc_03,
        speaker_type: 'child',
        text: '며느리가 불쌍해',
      })
      const 상태 = await turnFailureState(tx, { run_id, session_id })
      expect(상태?.stage).toBe('analysis')
      expect(상태?.failed).toBe(false)
      expect(상태?.reasons).toEqual([])
    })
  })

  // ═════════════════════════════════════════════════════════════════════════
  // 2026-08-13 — 화면이 **멀쩡한 턴을 「다 실패했다」로 그리던 것** (이슈 #26)
  // ═════════════════════════════════════════════════════════════════════════
  //
  // 🔴 `llm_calls` 에는 fallback 으로 넘어가기 전 **실패한 시도가 그대로 남는다**(결정 33).
  //    그 행들을 용도·시각 안 가리고 모으면 1차 실패·2차 성공한 턴이 실패로 보인다 —
  //    파이썬 `_예비공급자_쓴_턴들` 이 성공한 시도를 전부 예비로 잡았던 것과 같은 갈래고,
  //    `service/view.fallbackTurns()` 주석이 경고해 둔 함정이다.
  //
  // ⭐ 아래 둘이 그 함정을 **실측으로** 잡는다. `분석_먼저_실패: 1` 은 체인의 첫 칸만
  //    떨어뜨리므로 그 턴은 **살아서 끝난다** — 그런데도 실패 행이 하나 남는다.

  /** 체인이 두 칸(제미나이 키1·키2)이라고 못 박는다 — `.env.local` 에 안 기대게. */
  const 두_칸 = () => loadSettings({ gemini_api_keys: ['키1', '키2'], anthropic_api_key: null })

  it('⭐ ① 이 1차 실패·2차 성공한 턴은 「실패했다」고 말하지 않는다', async () => {
    const 기록 = 가짜_제미나이({ 분석_먼저_실패: 1 })

    await 트랜잭션(async (tx) => {
      const { run_id, session_id } = await 회차_준비(tx)
      // 화면에서 「① 분석만」을 누른 자리다. ② 는 아직 안 눌렀다.
      await analysisStep({
        session_id,
        child_utterance: '며느리가 창피했을 것 같아',
        conn: tx,
        base_settings: 두_칸(),
      })
      expect(기록.호출.filter((하나) => 하나.용도 === '분석')).toHaveLength(2)

      // 기록에는 실패 한 줄과 성공 한 줄이 나란히 남는다 (결정 33 — 흔적을 지우지 않는다)
      const 시도들 = (await readAttempts(tx, { run_id })).filter((행) => 행.purpose === 'analysis')
      expect(시도들.map((행) => 행.ok)).toEqual([false, true])

      // ② 를 기다리는 **정상 대기**다. 죽은 단계가 아니다.
      expect((await pendingTurn(tx, { session_id }))?.stage).toBe('decision')
      expect(await turnFailureState(tx, { run_id, session_id })).toBeNull()
    })
  })

  it('② 를 누른 직후 ③ 을 기다리는 것도 정상 대기다 — 시도가 없으면 실패가 아니다', async () => {
    const 기록 = 가짜_제미나이({ 분석_먼저_실패: 1 })

    await 트랜잭션(async (tx) => {
      const { run_id, session_id } = await 회차_준비(tx)
      const 분석단계 = await analysisStep({
        session_id,
        child_utterance: '며느리가 창피했을 것 같아',
        conn: tx,
        base_settings: 두_칸(),
      })
      await decisionStep({
        session_id,
        message_id: 분석단계.data.message_id,
        analysis: {
          child_intent: 분석단계.data.analysis.child_intent,
          detected_elements: 분석단계.data.detected_elements_kept,
          utterance_validity: 분석단계.data.analysis.utterance_validity,
        },
        conn: tx,
      })

      // ③ 은 아직 한 번도 안 불렸다. 폼이 그 자리에 있으니 「죽은 단계」가 아니다.
      expect(기록.호출.filter((하나) => 하나.용도 === '대사')).toHaveLength(0)
      expect((await pendingTurn(tx, { session_id }))?.stage).toBe('character')
      expect(await turnFailureState(tx, { run_id, session_id })).toBeNull()
    })
  })

  it('⭐ ① 이 fallback 으로 살아난 뒤 ③ 이 죽으면 **③ 의 사유만** 말한다', async () => {
    // 앞 검사의 짝 — 여기서는 진짜로 끊겼다. 그래도 ① 의 실패 행을 사유에 섞으면
    // 「두 공급자가 다 실패했다」의 근거가 틀린 자리를 가리킨다.
    const 기록 = 가짜_제미나이({ 분석_먼저_실패: 1, 대사_실패: true })

    await 트랜잭션(async (tx) => {
      const { run_id, session_id } = await 회차_준비(tx)
      await submitTurn({
        run_id,
        child_utterance: '며느리가 창피했을 것 같아',
        conn: tx,
        base_settings: 두_칸(),
      }).catch(() => null)
      expect(기록.호출.filter((하나) => 하나.용도 === '분석')).toHaveLength(2)

      const 상태 = await turnFailureState(tx, { run_id, session_id })
      expect(상태?.stage).toBe('character')
      expect(상태?.failed).toBe(true)
      // 🔴 ① 의 실패는 이미 이어졌다. 여기 끼면 안 된다.
      expect(상태?.reasons.map((행) => 행.purpose)).toEqual(['character', 'character'])
    })
  })

  // ═════════════════════════════════════════════════════════════════════════
  // 2026-08-13 — 「마지막 성공 뒤」는 **닿을 수 없는 가지**다 (결함 7)
  // ═════════════════════════════════════════════════════════════════════════
  //
  // `turnFailureState()` 머리말이 한동안 「그 단계 용도의, **마지막 성공 뒤에** 남은
  // 실패만」을 근거로 내세웠는데, 실측해 보니 그 「마지막 성공」이 호출마다 0 이었다.
  // 성공 시도는 **그 단계의 산출물 행과 같은 트랜잭션**에 들어가기 때문이다 —
  // 분석 성공은 `utterance_analyses` 와, 캐릭터 성공은 캐릭터 `messages` 행과 함께
  // 커밋된다 (`service/turn.ts` 의 `한묶음()` 둘). 그래서 **성공 시도가 있는 단계는
  // 애초에 미완으로 안 나온다.** 지탱하는 것은 `decision` 게이트·`character` 게이트·
  // `purpose` 분리 셋뿐이라는 뜻이고, 그 사실을 여기 박아 둔다.

  /** 이 턴에서 **성공한** 시도의 단계 이름들 (`llm_calls.purpose`). */
  async function 성공한_단계들(
    tx: Conn,
    곳: { run_id: string; message_id: string },
  ): Promise<Set<string>> {
    const 시도들 = await readAttempts(tx, 곳)
    return new Set(시도들.filter((행) => 행.ok).map((행) => 행.purpose))
  }

  it('⭐ 성공 시도가 있으면 그 단계는 미완으로 안 나온다 (산출물 행과 한 트랜잭션이라서)', async () => {
    const 기록 = 가짜_제미나이({
      분석_먼저_실패: 1,
      요소들: (턴, 목표) => (턴 === 1 ? [목표[0]] : 목표),
    })

    await 트랜잭션(async (tx) => {
      const { run_id, session_id } = await 회차_준비(tx)

      // ① — 1차 실패·2차 성공. 실패 행과 성공 행이 나란히 남는다 (결정 33).
      const 분석단계 = await analysisStep({
        session_id,
        child_utterance: '며느리가 창피했을 것 같아',
        conn: tx,
        base_settings: 두_칸(),
      })
      const message_id = 분석단계.data.message_id
      expect(await 성공한_단계들(tx, { run_id, message_id })).toEqual(new Set(['analysis']))

      // 🔴 성공한 그 단계는 **미완 자리가 아니다** — 「마지막 성공 뒤」를 볼 일이 없다.
      expect((await pendingTurn(tx, { session_id }))?.stage).not.toBe('analysis')
      expect((await pendingTurn(tx, { session_id }))?.stage).toBe('decision')

      await decisionStep({
        session_id,
        message_id,
        analysis: {
          child_intent: 분석단계.data.analysis.child_intent,
          detected_elements: 분석단계.data.detected_elements_kept,
          utterance_validity: 분석단계.data.analysis.utterance_validity,
        },
        conn: tx,
      })
      const 조건 = await readTurnCondition(tx, message_id)
      await dialogueStep({
        session_id,
        message_id,
        response_mode: 조건!.response_mode,
        reaction_key: 조건!.reaction_key,
        guidance_target: 조건!.guidance_target,
        main_point: 분석단계.data.analysis.main_point,
        conn: tx,
        base_settings: 두_칸(),
      })

      // ③ 까지 끝나면 성공한 단계가 둘이 되고 미완 자체가 사라진다.
      expect(await 성공한_단계들(tx, { run_id, message_id })).toEqual(
        new Set(['analysis', 'character']),
      )
      expect(await pendingTurn(tx, { session_id })).toBeNull()
      expect(await turnFailureState(tx, { run_id, session_id })).toBeNull()
      expect(대사_호출수(기록)).toBe(1)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 실험 프롬프트가 회차에 닿는가 (T094 · FR-057)
// ═══════════════════════════════════════════════════════════════════════════
//
// 🔴 **이게 없으면 프롬프트 작업대가 있어도 효과가 없다.** 화면이 본문을 저장해도 회차가
//    정본(`prompts/*.md`)으로 돌면 「실험판으로 한 회차」라는 것이 성립하지 않는다.
//    파이썬은 `회차.py` 의 `실험_프롬프트들()` 이 이 자리를 메웠다.
//
// ⭐ **SDK 자리에서 잰다.** 한 겹 위(`lib/llm`)를 가짜로 바꾸면 「무엇이 system 으로
//    나갔나」를 못 본다 — 이 파일이 CLOSING 호출 수를 재는 것과 같은 이유다.

검사('service — 회차의 실험 프롬프트가 엔진까지 간다', () => {
  /**
   * 실험 본문 한 벌. **`## 받는 것` 절이 있어야 한다** — 재료 틀도 이 본문에서 뽑기
   * 때문이다 (`engine/material.ts`). 표식(`<!-- 보내는 것 … -->`)이 없으므로
   * `sendableBody()` 가 **통째로** system 으로 내보낸다 (결정 48).
   */
  const 실험_본문 = (이름: string) =>
    [`실험용 ${이름} 지시다. 정본과 한 글자도 안 겹친다.`, '', '## 받는 것', '', '```json', `{${이름}_material}`, '```', ''].join('\n')

  const 실험_분석 = 실험_본문('analysis')
  const 실험_캐릭터 = 실험_본문('character')

  function 나간_system(기록: 가짜_기록, 용도: '분석' | '대사'): string {
    const 하나 = 기록.호출.find((호출) => 호출.용도 === 용도)
    expect(하나, `${용도} 호출이 없다`).toBeDefined()
    return 하나!.system
  }

  it('저장돼 있으면 그 회차는 그것으로 돈다 — 분석도 캐릭터도', async () => {
    const 기록 = 가짜_제미나이()
    await 트랜잭션(async (tx) => {
      const { run_id } = await 회차_준비(tx)
      await saveExperimentPromptStep({ run_id, name: 'analysis', body: 실험_분석, conn: tx })
      await saveExperimentPromptStep({ run_id, name: 'character', body: 실험_캐릭터, conn: tx })

      await submitTurn({ run_id, child_utterance: '며느리가 불쌍해', conn: tx })

      expect(나간_system(기록, '분석')).toBe(실험_분석)
      expect(나간_system(기록, '대사')).toBe(실험_캐릭터)
    })
  })

  it('안 저장돼 있으면 정본(`prompts/*.md`)으로 돈다', async () => {
    const 기록 = 가짜_제미나이()
    await 트랜잭션(async (tx) => {
      const { run_id } = await 회차_준비(tx)
      await submitTurn({ run_id, child_utterance: '며느리가 불쌍해', conn: tx })

      expect(나간_system(기록, '분석')).toBe(sendableBody(read('analysis')))
      expect(나간_system(기록, '대사')).toBe(sendableBody(read('character')))
    })
  })

  it('한 종류만 저장돼 있으면 나머지 한 종류만 정본으로 돈다', async () => {
    const 기록 = 가짜_제미나이()
    await 트랜잭션(async (tx) => {
      const { run_id } = await 회차_준비(tx)
      await saveExperimentPromptStep({ run_id, name: 'analysis', body: 실험_분석, conn: tx })

      await submitTurn({ run_id, child_utterance: '며느리가 불쌍해', conn: tx })

      expect(나간_system(기록, '분석')).toBe(실험_분석)
      expect(나간_system(기록, '대사')).toBe(sendableBody(read('character')))
    })
  })

  it('⭐ 이어 돌리는 턴도 같은 실험 프롬프트로 돈다 — 한 턴 안에서 조건이 갈리지 않는다', async () => {
    // 처음 시도는 실험 프롬프트로, 이어 돌리기는 정본으로 돌면 그 회차의 결과를 못 믿는다.
    const 기록 = 가짜_제미나이({ 대사_실패: true })
    await 트랜잭션(async (tx) => {
      const { run_id, session_id } = await 회차_준비(tx)
      await saveExperimentPromptStep({ run_id, name: 'character', body: 실험_캐릭터, conn: tx })

      await submitTurn({ run_id, child_utterance: '며느리가 불쌍해', conn: tx }).catch(() => null)
      기록.설정.대사_실패 = false
      const 미완 = await pendingTurn(tx, { session_id })
      await resumeTurn({ run_id, child_message_id: 미완!.message_id, conn: tx })

      // 대사 호출이 여럿이다 — **전부** 실험 본문이어야 한다.
      const 대사들 = 기록.호출.filter((호출) => 호출.용도 === '대사')
      expect(대사들.length).toBeGreaterThan(1)
      for (const 하나 of 대사들) expect(하나.system).toBe(실험_캐릭터)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 시드 판 번호가 턴마다 박제된다 (FR-060a · FR-060b · SC-014)
// ═══════════════════════════════════════════════════════════════════════════
//
// 파이썬 `tests/test_admin_seed.py` 의
// `test_도중에_시드를_고치면_섞인_회차로_잡히고_지난_턴은_안_바뀐다` 와
// `test_시드를_안_고친_회차는_섞이지_않는다` 를 옮긴 것이다.
//
// ⚠️ 파이썬은 시드 화면(`POST /seed/...`)을 두드려 고쳤다. 여기서는 같은 일을 하는
//    `saveSeedCell()` 을 부른다 — 화면이 아니라 **개정이 한 줄 쌓이는 것**이 재는 것이라서다.

검사('service — turn_conditions.seed_revision', () => {
  /** 그 회차의 턴 판정을 아이가 말한 순서대로. */
  async function 조건들(tx: Conn, run_id: string) {
    return readRunTurnConditions(tx, run_id)
  }

  it('도중에 시드를 고치면 섞인 회차로 잡히고 지난 턴은 안 바뀐다', async () => {
    가짜_제미나이({ 요소들: () => [] })
    await 트랜잭션(async (tx) => {
      const { 씨, run_id } = await 회차_준비(tx)

      await submitTurn({ run_id, child_utterance: '며느리가 불쌍해', conn: tx })
      const 첫_턴 = await 조건들(tx, run_id)
      expect(첫_턴).toHaveLength(1)

      // 회차가 도는 **도중에** 시드를 고친다 (관리자 화면이 하는 일이다).
      await saveSeedCell(
        {
          table_name: 'story_scenes',
          row_id: 씨.scene_ids.sc_svc_03,
          column_name: 'scene_stance',
          value: '이제 말해 볼까 망설인다',
          origin: 'draft',
          changed_by: '검사',
        },
        tx,
      )

      await submitTurn({ run_id, child_utterance: '어떻게 하면 좋을까', conn: tx })
      const 둘 = await 조건들(tx, run_id)

      expect(둘).toHaveLength(2)
      // FR-060a — 고친 값은 **다음 턴부터** 붙는다. 앞 턴 조건은 손대지 않는다.
      expect(둘[0].seed_revision).toBeLessThan(둘[1].seed_revision)
      // FR-060b — 판 번호가 갈렸으니 「도중에 조건이 바뀐 회차」다.
      expect(new Set(둘.map((행) => 행.seed_revision)).size).toBe(2)
      // SC-014 — 지난 턴의 박제가 통째로 그대로다 (한 칸도 안 바뀐다).
      expect(둘.filter((행) => 행.message_id === 첫_턴[0].message_id)).toEqual(첫_턴)
    })
  })

  it('시드를 안 고친 회차는 안 섞인다', async () => {
    가짜_제미나이({ 요소들: () => [] })
    await 트랜잭션(async (tx) => {
      const { run_id } = await 회차_준비(tx)

      await submitTurn({ run_id, child_utterance: '며느리가 불쌍해', conn: tx })
      await submitTurn({ run_id, child_utterance: '어떻게 하면 좋을까', conn: tx })

      const 둘 = await 조건들(tx, run_id)
      expect(둘).toHaveLength(2)
      expect(new Set(둘.map((행) => 행.seed_revision)).size).toBe(1)
      expect(new Set(둘.map((행) => 행.prompt_version))).toEqual(new Set([기본_프롬프트_버전]))
    })
  })

  it('⭐ 장면을 읽은 뒤에 시드가 바뀌어도 **그 턴이 실제로 쓴 판**이 박힌다', async () => {
    // 결함 6 (2026-08-13). 파이썬 `회차.턴_돌리기()` 는 순서를 주석으로 못박아 뒀다 —
    // 「T083: 조건 번호를 먼저 붙잡고, 그 다음 장면 행을 한 번 읽어 턴을 끝낸다」.
    // 이식본은 거꾸로여서, 그 사이에 사람이 시드를 고치면 **쓴 장면은 N 판인데 조건에는
    // N+1** 이 박혔다. 창은 좁지만(DB 쿼리 두어 개) 회차끼리의 비교가 조용히 거짓이 된다.
    const 기록 = 가짜_제미나이({ 요소들: () => [] })
    await 트랜잭션(async (tx) => {
      const { 씨, run_id } = await 회차_준비(tx)
      const 처음 = await latestSeedRevision(tx)

      // 장면 행을 읽은 **직후** — 이 턴이 쓸 장면이 이미 정해진 뒤 — 에 사람이 시드를 고친다.
      상자.장면_읽은_직후 = async () => {
        await saveSeedCell(
          {
            table_name: 'story_scenes',
            row_id: 씨.scene_ids.sc_svc_03,
            column_name: 'scene_stance',
            value: '이제 말해 볼까 망설인다',
            origin: 'draft',
            changed_by: '검사',
          },
          tx,
        )
      }

      const 결과 = await submitTurn({ run_id, child_utterance: '며느리가 불쌍해', conn: tx })

      // 정말로 턴 한가운데서 개정이 한 줄 쌓였다 (안 끼어들었으면 이 검사가 무의미하다).
      expect(상자.장면_읽은_직후).toBeNull()
      expect(await latestSeedRevision(tx)).toBeGreaterThan(처음)

      // 이 턴이 실제로 쓴 것은 **옛 입장**이다 — 캐릭터 재료가 그 증거다.
      const 대사 = 기록.호출.find((하나) => 하나.용도 === '대사')
      expect(대사?.user).toContain('아직 참고 있다')
      expect(대사?.user).not.toContain('이제 말해 볼까 망설인다')

      // 🔴 그래서 박히는 조건 번호도 **옛 판**이다. N+1 이면 조건과 실제가 어긋난다.
      const 조건 = await readTurnCondition(tx, 결과.child_message_id)
      expect(조건!.seed_revision).toBe(처음)
    })
  })

  // ── 결함 6 의 잔존 셋 (2026-08-13 적대적 검증) ──────────────────────────
  //
  // 위 검사가 잡은 것은 `submitTurn()` **하나**였다. `runTurn()`·`runDecisionStage()` 를
  // 부르는 자리는 다섯인데 넷이 옛 순서 그대로였다. 아래 셋이 그 나머지를 하나씩 잡는다.
  // ⚠️ 다섯째(`runTurn()` 안의 `??` 차선)는 이제 이 레포에서 안 쓰인다 — 부르는 자리가
  //    전부 내려보내므로, 여기 잡을 것이 남지 않는 것이 맞다.

  /** 「사람이 시드를 고치는 순간」 — 개정이 한 줄 쌓인다 (관리자 화면이 하는 일이다). */
  async function 시드를_고친다(tx: Conn, 씨: 씨앗): Promise<void> {
    await saveSeedCell(
      {
        table_name: 'story_scenes',
        row_id: 씨.scene_ids.sc_svc_03,
        column_name: 'scene_stance',
        value: '이제 말해 볼까 망설인다',
        origin: 'draft',
        changed_by: '검사',
      },
      tx,
    )
  }

  it('⭐ ② 만 따로 불러도 **그 호출이 읽은 장면의 판**이 박힌다', async () => {
    // ① 과 ② 는 서로 다른 HTTP 호출이라 ① 이 본 판을 ② 로 실어 나를 칸이 계약에 없다.
    // 못 잇는 것은 거기까지고, **② 한 호출 안**의 창은 `submitTurn()` 과 똑같이 닫힌다.
    // 탐침으로 재 보니 안 닫혀 있었다 (`expected 612 to be 328`).
    가짜_제미나이({ 요소들: () => [] })
    await 트랜잭션(async (tx) => {
      const { 씨, session_id } = await 회차_준비(tx)
      const 분석단계 = await analysisStep({
        session_id,
        child_utterance: '며느리가 불쌍해',
        conn: tx,
      })

      // ① 이 끝난 뒤의 판. ② 가 장면을 읽는 그 순간에 사람이 시드를 고친다.
      const 판단_앞 = await latestSeedRevision(tx)
      상자.장면_읽은_직후 = async () => await 시드를_고친다(tx, 씨)

      await decisionStep({
        session_id,
        message_id: 분석단계.data.message_id,
        analysis: {
          child_intent: 분석단계.data.analysis.child_intent,
          detected_elements: 분석단계.data.detected_elements_kept,
          utterance_validity: 분석단계.data.analysis.utterance_validity,
        },
        conn: tx,
      })

      expect(상자.장면_읽은_직후).toBeNull()
      expect(await latestSeedRevision(tx)).toBeGreaterThan(판단_앞)
      const 조건 = await readTurnCondition(tx, 분석단계.data.message_id)
      expect(조건!.seed_revision).toBe(판단_앞)
    })
  })

  it('⭐ ② 에서 죽은 턴을 이어 돌릴 때도 장면보다 판을 먼저 붙잡는다', async () => {
    // 파이썬 `재시도_돌리기()` 에는 이 갈래가 아예 없다 — ①②③ 이 갈린 우리한테만 있는 길이라
    // 「파이썬은 어디서 붙잡았나」로 정할 수가 없다. `submitTurn()` 과 같은 자리로 맞춘다.
    가짜_제미나이({ 요소들: () => [] })
    await 트랜잭션(async (tx) => {
      const { 씨, run_id, session_id } = await 회차_준비(tx)
      const 분석단계 = await analysisStep({
        session_id,
        child_utterance: '며느리가 불쌍해',
        conn: tx,
      })
      expect((await pendingTurn(tx, { session_id }))?.stage).toBe('decision')

      const 이어_앞 = await latestSeedRevision(tx)
      상자.장면_읽은_직후 = async () => await 시드를_고친다(tx, 씨)

      await resumeTurn({ run_id, child_message_id: 분석단계.data.message_id, conn: tx })

      expect(상자.장면_읽은_직후).toBeNull()
      expect(await latestSeedRevision(tx)).toBeGreaterThan(이어_앞)
      const 조건 = await readTurnCondition(tx, 분석단계.data.message_id)
      expect(조건!.seed_revision).toBe(이어_앞)
    })
  })

  it('⭐ ① 에서 죽은 턴을 이어 돌릴 때도 같은 자리에서 붙잡는다', async () => {
    // 이 갈래는 파이썬에 있다 — 그쪽은 장면을 읽은 **뒤**(분석 LLM 이 끝난 뒤) 붙잡았다.
    // 한 함수 안에서 갈래마다 규칙이 갈리지 않도록 두 갈래를 같은 자리로 맞춘 것이고,
    // 그 결정을 `resumeTurn()` 주석에 적어 뒀다.
    const 기록 = 가짜_제미나이({ 분석_실패: true, 요소들: () => [] })
    await 트랜잭션(async (tx) => {
      const { 씨, run_id, session_id } = await 회차_준비(tx)
      await submitTurn({ run_id, child_utterance: '며느리가 불쌍해', conn: tx }).catch(() => null)
      const 미완 = await pendingTurn(tx, { session_id })
      expect(미완?.stage).toBe('analysis')

      기록.설정.분석_실패 = false
      const 이어_앞 = await latestSeedRevision(tx)
      상자.장면_읽은_직후 = async () => await 시드를_고친다(tx, 씨)

      await resumeTurn({ run_id, child_message_id: 미완!.message_id, conn: tx })

      expect(상자.장면_읽은_직후).toBeNull()
      expect(await latestSeedRevision(tx)).toBeGreaterThan(이어_앞)
      const 조건 = await readTurnCondition(tx, 미완!.message_id)
      expect(조건!.seed_revision).toBe(이어_앞)
    })
  })

  it('⭐ 터미널 경로 — 사람이 발화를 치는 동안 시드가 바뀌어도 쓴 판이 박힌다', async () => {
    // 다섯 경로 중 창이 가장 넓던 자리다. 장면을 읽고 `input()` 이 **사람을 기다리는 동안**
    // 열려 있었다. 파이썬 `터미널.py` 는 `턴_시작` 사건에서 — 다 친 뒤에 — 붙잡았다.
    가짜_제미나이({ 요소들: () => [] })
    await 트랜잭션(async (tx) => {
      const { 씨, run_id, session_id } = await 회차_준비(tx)
      const 처음 = await latestSeedRevision(tx)

      // 장면을 읽은 직후 = 아직 아이가 입도 떼기 전이다.
      상자.장면_읽은_직후 = async () => await 시드를_고친다(tx, 씨)
      let 남은_발화: string | null = '며느리가 불쌍해'

      const 결과 = await runStory({
        conn: tx,
        run_id,
        session_id,
        story_code: 씨.story_code,
        prompt_version: 기본_프롬프트_버전,
        utterance_source: 'synthetic_adult',
        input: () => {
          const 이번 = 남은_발화
          남은_발화 = null
          return 이번
        },
      })

      expect(결과.turns).toHaveLength(1)
      expect(상자.장면_읽은_직후).toBeNull()
      expect(await latestSeedRevision(tx)).toBeGreaterThan(처음)

      const 조건들 = await readRunTurnConditions(tx, run_id)
      expect(조건들).toHaveLength(1)
      expect(조건들[0].seed_revision).toBe(처음)
    })
  })

  it('개정이 한 건도 없으면 0 이다 — 「모른다」를 지어내지 않는다', async () => {
    가짜_제미나이({ 요소들: () => [] })
    await 트랜잭션(async (tx) => {
      const { run_id } = await 회차_준비(tx)
      const 지금 = await latestSeedRevision(tx)

      await submitTurn({ run_id, child_utterance: '며느리가 불쌍해', conn: tx })

      expect((await 조건들(tx, run_id))[0].seed_revision).toBe(지금)
    })
  })
})
