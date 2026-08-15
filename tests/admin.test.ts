// 관리자 화면 — 파이썬 `tests/test_admin_routes.py` 19개 중 **15개를 옮긴 것** (화면-5).
//
// ## 어느 15개이고 왜 넷이 빠지나
//
// `docs/설계/이식_전수목록.md` 5-2절이 「19개 중 15개를 옮긴다 · 버리는 넷은 전부
// **화면 기술 전제**다」라고 못박아 뒀다. 그 넷은 이렇게 갈린다.
//
// | # | 파이썬 검사 | 왜 안 옮기나 |
// |---|---|---|
// | 5 | `..._진행_표시가_빈_주소를_두드리지_않는다` | htmx 폴링 전제. `hx-get`·`#run-body`·`/runs/{id}/status` 가 검사의 내용 자체다. 서버 렌더링에는 그 주소도 그 실패도 없다 |
// | 6 | `턴_완료_폴링은_..._한꺼번에_갱신한다` | 같음 — htmx 부분 갱신 |
// | 14 | `카드_겉에_예비공급자_띠가_그려진다` | Jinja 틀을 실제로 렌더해 문맥 이름 어긋남을 잡는 검사다. 틀 엔진이 바뀌면 잡으려던 실패 방식이 없어진다 |
// | 15 | `예비공급자가_없으면_띠도_없다` | 같음 |
//
// ⚠️ **판별 로직(#10~#13)은 버리지 않는다.** 순수 함수라 그대로 옮기고 띠 렌더만 버렸다.
//
// ## 옮기면서 모양이 달라진 것 셋 — 「깨졌다」로 세지 말 것
//
// - **#2** 상태코드가 204 → 400 이다. 204 는 htmx 가 아무것도 안 갈아끼우게 하려던 값이고,
//   계약(`라우트계약.md` 2절)은 빈 발화를 `BAD_REQUEST` 로 본다.
// - **#8** 파이썬은 `threading.Barrier` 로 진짜 스레드를 겹쳤다. Node 는 이벤트 루프가 하나라
//   `Promise.all` + **가짜 LLM 안에서 서로를 기다리게** 하는 방식으로 겹친다.
// - **#19** 주소가 `GET /runs/{id}?scene=99` → `GET /api/v1/stories/{code}/scenes/{code}` 다.
//
// ## 무엇을 부르나 — 화면이 누르는 그 단추를 누른다
//
// 화면은 서버 액션에서 `service` 를 부른다. 검사도 그 액션을 **그대로 부른다.**
// ⭐ `redirect()` 는 던져서 흐름을 끊는데(Next `redirect.md`), 던지는 예외의 `digest` 에
//    목적지가 들어 있다 — `NEXT_REDIRECT;replace;/runs/…?error=…;307;`. 그래서 「어디로
//    돌아갔나」와 「어떤 오류 코드를 실었나」를 그 한 줄에서 읽을 수 있다 (`눌러본다()`).
//    이게 없으면 「액션이 `advanceStep()` 을 빼먹었다」 같은 실수를 아무도 못 잡는다.

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { characters, runs, stories, story_scenes, story_sessions } from '@/llm/db/schema'

// ⚠️ 팩토리 안에서 바깥 변수를 참조하면 hoisting 에 걸린다 (`routes.db.test.ts` 와 같은 상자).
const 상자 = vi.hoisted(() => ({ tx: null as unknown }))

vi.mock('@/llm/repo/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/llm/repo/db')>()
  return { ...real, getDb: () => 상자.tx ?? real.getDb() }
})

import { 옮긴다 } from '@/llm/controller/envelope'
import { loadSettings, WEB_ROOT, 고를_수_있는_강도 } from '@/llm/config'
import { read } from '@/llm/prompts'
import { closeDb, getDb, type Conn } from '@/llm/repo/db'
import { readAttempts, readRun } from '@/llm/repo/runs'
import { insertMessage, sessionTranscript } from '@/llm/repo/sessions'
import { readRunTurnConditions } from '@/llm/repo/turn-conditions'
import {
  advanceStep,
  inProgress,
  runSettings,
  runState,
  startRunStep,
  TurnInProgress,
} from '@/llm/service/run'
import { saveExperimentPromptStep } from '@/llm/service/prompt-lab'
import { analysisStep, decisionStep, dialogueStep, sceneView } from '@/llm/service/step'
import { runStory } from '@/llm/service/story'
import {
  fallbackTurns,
  runDetail,
  scenePages,
  turnLogLines,
  type ScenePage,
  type TurnRow,
} from '@/llm/service/view'

import {
  advanceAction,
  analysisAction,
  decisionAction,
  dialogueAction,
  resumeAction,
  startRunAction,
  turnAction,
} from '@/app/(admin)/runs/actions'
import { 대화줄, 어느_패널, LLM칸 } from '@/app/(admin)/runs/ui'
import { 도는_단추인가, 보내기, 눌린_단추_칸 } from '@/app/(admin)/runs/submit'

import { installFakeSdk } from './support/sdk-gate'

// ── DB 가 있나 (다른 DB 검사와 같은 문지기) ───────────────────────────────

async function 붙어보기(): Promise<string | null> {
  try {
    await getDb().execute(sql`select 1`)
    return null
  } catch (오류) {
    return 오류 instanceof Error ? `${오류.name}: ${오류.message}` : String(오류)
  }
}

const 못붙는_이유 = await 붙어보기()
if (못붙는_이유 !== null) {
  process.stderr.write(
    `\n[admin.test] Postgres 에 못 붙어 화면 검사를 건너뛴다 (도커가 꺼져 있나?)\n` +
      `             ${못붙는_이유}\n\n`,
  )
}
const DB검사 = 못붙는_이유 === null ? describe : describe.skip

afterAll(async () => {
  상자.tx = null
  await closeDb()
})

class 되돌림 extends Error {}

async function 트랜잭션(본문: (tx: Conn) => Promise<void>): Promise<void> {
  try {
    await getDb().transaction(async (tx) => {
      상자.tx = tx
      await 본문(tx)
      throw new 되돌림('검사가 끝났으니 되돌린다')
    })
  } catch (오류) {
    if (!(오류 instanceof 되돌림)) throw 오류
  } finally {
    상자.tx = null
  }
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

// ── 가짜 제미나이 ─────────────────────────────────────────────────────────
//
// ⛔ F-1 그물이 SDK 생성자를 막고 있고, 여기서 그 자리에 가짜를 꽂는다.
//    **한 겹 위(`lib/llm`)를 가짜로 바꾸지 않는다** — 「LLM 을 몇 번 불렀나」를 재려면
//    SDK 자리에서 세야 진짜로 센 것이다.

interface 가짜_기록 {
  분석: number
  대사: number
  /** ⭐ 나간 system 을 그대로 적는다 — 「이 회차가 어느 프롬프트로 돌았나」의 증거다 (T094). */
  분석_system: string[]
  대사_system: string[]
}

/** `문지기` 를 주면 분석 호출이 그 프라미스를 기다린다 (동시성 검사용). */
function 가짜_제미나이(문지기?: () => Promise<void>): 가짜_기록 {
  const 기록: 가짜_기록 = { 분석: 0, 대사: 0, 분석_system: [], 대사_system: [] }

  installFakeSdk('gemini', () => ({
    interactions: {
      create: async (요청: Record<string, unknown>) => {
        const user = String(요청.input ?? '')
        // 분석만 JSON 스키마를 실어 보낸다 (`lib/llm/index.ts` 의 `geminiRequest()`).
        if (요청.response_format !== undefined) {
          기록.분석 += 1
          기록.분석_system.push(String(요청.system_instruction ?? ''))
          if (문지기 !== undefined) await 문지기()
          const 맞은것 = /"child_utterance":"((?:[^"\\]|\\.)*)"/.exec(user)
          const 원문 = 맞은것 === null ? '' : (JSON.parse(`"${맞은것[1]}"`) as string)
          return {
            output_text: JSON.stringify({
              child_intent: 'OPINION',
              main_point: 원문,
              // evidence 가 아이 발화 원문이라 후처리를 그대로 통과한다.
              detected_elements: [{ type: 'EMPATHY', evidence: 원문 }],
              utterance_validity: 'VALID',
            }),
            usage_metadata: { prompt_token_count: 100, candidates_token_count: 20 },
          }
        }
        기록.대사 += 1
        기록.대사_system.push(String(요청.system_instruction ?? ''))
        return {
          output_text: '그러게 말이다',
          usage_metadata: { prompt_token_count: 200, candidates_token_count: 30 },
        }
      },
    },
  }))

  return 기록
}

/** 호출 수만 견준다 — 기록에는 나간 system 도 담겨 있어 통째 비교가 안 된다. */
function 호출수(기록: 가짜_기록): { 분석: number; 대사: number } {
  return { 분석: 기록.분석, 대사: 기록.대사 }
}

/** 한 번만 닫히는 문. 「LLM 안에 들어왔다」를 검사가 기다릴 수 있게 한다. */
function 문(): { 도착: Promise<void>; 문지기: () => Promise<void>; 연다: () => void } {
  let 도착_알림: () => void = () => {}
  let 열림_알림: () => void = () => {}
  const 도착 = new Promise<void>((resolve) => (도착_알림 = resolve))
  const 열림 = new Promise<void>((resolve) => (열림_알림 = resolve))
  let 처음 = true
  return {
    도착,
    문지기: async () => {
      // 둘째 회차는 안 막는다 — 잠금이 **회차마다 따로**인지 재려면 하나만 잡아야 한다.
      if (!처음) return
      처음 = false
      도착_알림()
      await 열림
    },
    연다: () => 열림_알림(),
  }
}

// ── 검사용 콘텐츠 ─────────────────────────────────────────────────────────
//
// 전개 · 대화 · 전개 · 대화 — **쪽 나누기(#16~#18)를 재려면 이 모양이어야 한다.**

interface 씨앗 {
  story_code: string
  scene_ids: Record<string, string>
}

async function 콘텐츠_넣기(tx: Conn): Promise<씨앗> {
  const 꼬리 = randomUUID().slice(0, 8)
  const story_code = `s_ad_${꼬리}`

  const [이야기] = await tx
    .insert(stories)
    .values({
      slug: story_code,
      title: `화면 검사용 ${꼬리}`,
      summary: '검사용',
      difficulty: '보통',
      status: 'draft',
    })
    .returning({ id: stories.id })

  const [며느리] = await tx
    .insert(characters)
    .values({
      story_id: 이야기.id,
      code: 'ch_ad_daughter_in_law',
      name: '며느리',
      persona: '시집온 지 얼마 안 된 며느리',
      speech_style: '옛이야기 말투',
      guidance_style: '자기 걱정을 소리 내어 말한다',
      forbidden: ['설명하지 않는다'],
    })
    .returning({ id: characters.id })

  const [시아버지] = await tx
    .insert(characters)
    .values({
      story_id: 이야기.id,
      code: 'ch_ad_father_in_law',
      name: '시아버지',
      persona: '엄한 시아버지',
      speech_style: '옛이야기 말투',
      guidance_style: '못마땅함을 드러낸다',
      forbidden: ['설명하지 않는다'],
    })
    .returning({ id: characters.id })

  const 대화 = (order: number, 캐릭터: string, 이름: string) => ({
    story_id: 이야기.id,
    code: `sc_ad_0${order}`,
    scene_order: order,
    conflict: '갈등',
    character_id: 캐릭터,
    character_name: 이름,
    character_opening: `[${이름}] 아이고… 나 때문에 다들 놀랐지 뭐야.`,
    character_closing: `[${이름}] 네 말을 들으니 마음이 놓이는구나.`,
    scene_stance: '아직 참고 있다',
    scene_goal: '아이가 처지를 헤아리게 한다',
    required_elements: ['EMPATHY'],
    element_criteria: { EMPATHY: '마음을 헤아렸나' },
    remaining_worries: { EMPATHY: '그럼 난 어떻게 하면 좋을까…' },
    preferred_turns: 2,
    max_turns: 4,
  })

  const 넣은 = await tx
    .insert(story_scenes)
    .values([
      { story_id: 이야기.id, code: 'sc_ad_01', scene_order: 1, scene_description: '전개 한 줄' },
      대화(2, 며느리.id, '며느리'),
      { story_id: 이야기.id, code: 'sc_ad_03', scene_order: 3, scene_description: '전개 두 줄' },
      대화(4, 시아버지.id, '시아버지'),
    ])
    .returning({ id: story_scenes.id, code: story_scenes.code })

  const scene_ids: Record<string, string> = {}
  for (const 행 of 넣은) scene_ids[행.code] = 행.id
  return { story_code, scene_ids }
}

/** 회차를 열고 첫 대화 장면 앞까지 전개를 재생한다 — 화면의 「시작」 단추가 하는 일이다. */
async function 회차_시작(씨: 씨앗, 덧붙임: Record<string, unknown> = {}) {
  const { run } = await startRunStep({ story_code: 씨.story_code, started_by: '검사', ...덧붙임 })
  await advanceStep({ run_id: run.id })
  return run
}

/** ①②③ 한 턴. 화면이 단추 셋을 차례로 누르는 것과 같다. */
async function 한턴(session_id: string, 발화: string) {
  const 하나 = await analysisStep({ session_id, child_utterance: 발화 })
  const 둘 = await decisionStep({
    session_id,
    message_id: 하나.data.message_id,
    analysis: {
      child_intent: 하나.data.analysis.child_intent,
      detected_elements: 하나.data.detected_elements_kept,
      utterance_validity: 하나.data.analysis.utterance_validity,
    },
  })
  const 셋 = await dialogueStep({
    session_id,
    message_id: 하나.data.message_id,
    response_mode: 둘.data.decision.response_mode,
    reaction_key: 둘.data.decision.reaction_key,
    guidance_target: 둘.data.decision.guidance_target,
    main_point: 하나.data.analysis.main_point,
  })
  return { 하나, 둘, 셋 }
}

// ── 단추를 누른다 ─────────────────────────────────────────────────────────

function 폼짓기(값들: Record<string, string | string[]>): FormData {
  const 폼 = new FormData()
  for (const [이름, 값] of Object.entries(값들)) {
    for (const 하나 of Array.isArray(값) ? 값 : [값]) 폼.append(이름, 하나)
  }
  return 폼
}

/**
 * 서버 액션을 부르고 **어디로 돌아갔는지**를 읽는다.
 *
 * `redirect()` 가 던지는 예외의 `digest` 가 `NEXT_REDIRECT;replace;<주소>;307;` 이다.
 * ⚠️ 주소에 `;` 가 섞일 걱정은 없다 — `encodeURIComponent` 가 `%3B` 로 바꾼다.
 */
async function 눌러본다(
  액션: (폼: FormData) => Promise<void>,
  값들: Record<string, string | string[]>,
): Promise<{ 경로: string; error: string | null }> {
  let 잡힘: unknown = null
  try {
    await 액션(폼짓기(값들))
  } catch (오류) {
    잡힘 = 오류
  }
  const digest = (잡힘 as { digest?: string } | null)?.digest
  if (typeof digest !== 'string' || !digest.startsWith('NEXT_REDIRECT')) {
    throw 잡힘 ?? new Error('액션이 아무 데도 안 돌아갔다')
  }
  const 주소 = new URL(digest.split(';')[2], 'http://검사')
  return { 경로: 주소.pathname, error: 주소.searchParams.get('error') }
}

// ═══════════════════════════════════════════════════════════════════════════
// 순수 함수 — DB 없이 돈다 (#10~#13 · #16~#17)
// ═══════════════════════════════════════════════════════════════════════════

describe('#10~#13 예비 공급자 — 「고른 모델이 아닌 것이 대답했다」', () => {
  const 회차 = {
    analysis_model: 'gemini-3.5-flash-lite',
    character_model: 'gemini-3.5-flash-lite',
  }
  const 메시지 = '11111111-1111-4111-8111-111111111111'

  const 시도 = (덮어쓰기: Record<string, unknown> = {}) => ({
    message_id: 메시지,
    purpose: 'analysis',
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    attempt_no: 1,
    ok: true,
    ...덮어쓰기,
  })

  it('#10 고른 모델이 대답했으면 예비 공급자가 아니다', () => {
    expect(fallbackTurns(회차, [시도()]).size).toBe(0)
  })

  it('#11 다른 모델이 대답했으면 그 턴에 남는다 — 무엇을 고르려 했는지까지', () => {
    const 결과 = fallbackTurns(회차, [
      시도({ model: 'claude-sonnet-5', provider: 'anthropic', attempt_no: 3 }),
    ])

    expect([...결과.keys()]).toEqual([메시지])
    expect(결과.get(메시지)).toEqual([
      {
        purpose: 'analysis',
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        chosen_model: 'gemini-3.5-flash-lite',
        attempt_no: 3,
      },
    ])
  })

  it('#12 실패한 시도는 예비 공급자로 안 센다', () => {
    // 실패까지 세면 제미나이가 한 번 막혔다가 제미나이가 답한 턴도 예비로 잘못 잡힌다.
    const 결과 = fallbackTurns(회차, [
      시도({ model: 'claude-sonnet-5', provider: 'anthropic', ok: false, attempt_no: 1 }),
      시도({ attempt_no: 2 }),
    ])
    expect(결과.size).toBe(0)
  })

  it('#13 분석과 캐릭터의 고른 모델을 따로 본다', () => {
    const 섞인_회차 = {
      analysis_model: 'gemini-3.5-flash-lite',
      character_model: 'gemini-3.5-flash',
    }
    const 결과 = fallbackTurns(섞인_회차, [
      시도({ purpose: 'analysis', model: 'gemini-3.5-flash-lite' }),
      시도({ purpose: 'character', model: 'gemini-3.5-flash-lite' }),
    ])

    // 분석은 고른 대로, 캐릭터는 flash 를 골랐는데 flash-lite 가 답했다.
    expect(결과.get(메시지)).toEqual([
      {
        purpose: 'character',
        provider: 'gemini',
        model: 'gemini-3.5-flash-lite',
        chosen_model: 'gemini-3.5-flash',
        attempt_no: 1,
      },
    ])
  })

  it('⚠️ 회차에 모델이 안 박혀 있으면 세지 않는다 (파이썬과 갈린 자리)', () => {
    // 파이썬은 `시도["model"] == None` 이 늘 거짓이라 성공한 **모든** 시도를 예비로 잡았다.
    const 결과 = fallbackTurns({ analysis_model: null, character_model: null }, [시도()])
    expect(결과.size).toBe(0)
  })
})

describe('#16~#17 장면 쪽 나누기 — 대화 하나가 쪽 하나', () => {
  const 장면 = (order: number, 이름: string | null = null) =>
    ({
      scene_id: `id-${order}`,
      scene_order: order,
      character_id: 이름 === null ? null : `ch-${order}`,
      character_name: 이름,
    }) as unknown as Parameters<typeof scenePages>[0][number]

  const 요약 = (쪽들: ScenePage[]) =>
    쪽들.map((쪽) => [쪽.scene_order, 쪽.character_name, 쪽.scenes.map((장면) => 장면.scene_order)])

  it('#16 앞선 전개는 그 대화에 딸린다 — 전개만 든 빈 쪽을 만들지 않는다', () => {
    const 쪽들 = scenePages([장면(1), 장면(2), 장면(3, '며느리'), 장면(4), 장면(5, '시아버지')])

    expect(요약(쪽들)).toEqual([
      [3, '며느리', [1, 2, 3]],
      [5, '시아버지', [4, 5]],
    ])
  })

  it('#17 ⭐ 끝에 대화 없이 전개만 남으면 그것도 한 쪽이다', () => {
    // 안 그러면 그 전개가 화면에서 통째로 사라진다.
    const 쪽들 = scenePages([장면(1, '며느리'), 장면(2), 장면(3)])

    expect(요약(쪽들)).toEqual([
      [1, '며느리', [1]],
      [3, null, [2, 3]],
    ])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 진짜 DB — 회차를 열고 턴을 돌린다
// ═══════════════════════════════════════════════════════════════════════════

DB검사('화면이 부르는 자리 × 진짜 DB', () => {
  it('#1 회차를 만들면 고정 첫 대사가 뜬다 — LLM 0회', async () => {
    await 트랜잭션(async (tx) => {
      const 기록 = 가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)

      const run = await 회차_시작(씨, { scope: 'scene', scene_order: 2 })

      expect(run.scope).toBe('scene')
      expect(run.scene_order).toBe(2)
      expect(run.default_utterance_source).toBe('synthetic_adult')

      const 줄들 = await sessionTranscript(tx, run.session_id)
      // 🔴 `character_opening` 은 `story_scenes` 의 고정 텍스트다. 생성하지 않는다 (경계 4).
      expect(줄들.map((행) => [행.speaker_type, 행.text])).toEqual([
        ['character', '[며느리] 아이고… 나 때문에 다들 놀랐지 뭐야.'],
      ])
      expect(호출수(기록)).toEqual({ 분석: 0, 대사: 0 })

      const 상세 = await runDetail(run.id)
      expect(상세.next_action.kind).toBe('발화받기')
    })
  })

  it('#2 빈 발화는 턴을 만들지 않는다 (204 였던 자리가 400 이다)', async () => {
    await 트랜잭션(async (tx) => {
      const 기록 = 가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)
      const run = await 회차_시작(씨)

      const 터짐 = await analysisStep({
        session_id: run.session_id,
        child_utterance: '   ',
      }).catch((오류: unknown) => 오류)

      // 확정 텍스트가 없으면 행을 만들지 않는다 (`docs/기준/db구조.md:302`).
      expect(옮긴다(터짐)).toMatchObject({ status: 400, error: { code: 'BAD_REQUEST' } })

      const 줄들 = await sessionTranscript(tx, run.session_id)
      expect(줄들.filter((행) => 행.speaker_type === 'child')).toHaveLength(0)
      expect(기록.분석).toBe(0)
    })
  })

  it('#3 진행 중이면 두 번째 발화를 거절한다 (FR-035)', async () => {
    await 트랜잭션(async (tx) => {
      const 문지기 = 문()
      가짜_제미나이(문지기.문지기)
      const 씨 = await 콘텐츠_넣기(tx)
      const run = await 회차_시작(씨)

      const 첫째 = 한턴(run.session_id, '며느리가 창피했겠다')
      // ⭐ 가짜 LLM 안에 들어왔다 = 잠금은 이미 잡혔다. 벽시계로 기다리지 않는다.
      await 문지기.도착

      const 둘째 = await analysisStep({
        session_id: run.session_id,
        child_utterance: '두 번째',
      }).catch((오류: unknown) => 오류)

      expect(둘째).toBeInstanceOf(TurnInProgress)
      expect(옮긴다(둘째)).toMatchObject({
        status: 409,
        error: { code: 'TURN_IN_PROGRESS', retryable: true },
      })

      문지기.연다()
      await 첫째
      // 아이 메시지가 하나만 생겼다 — 안 막으면 턴 수가 어긋난다.
      const 줄들 = await sessionTranscript(tx, run.session_id)
      expect(줄들.filter((행) => 행.speaker_type === 'child')).toHaveLength(1)
    })
  })

  it('#4 다시 열어도 누적 요소와 턴 수가 그대로다 (FR-038)', async () => {
    await 트랜잭션(async (tx) => {
      가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)
      const run = await 회차_시작(씨)
      await 한턴(run.session_id, '며느리가 창피했겠다')

      const 처음 = await runDetail(run.id)
      const 다시 = await runDetail(run.id)

      // 상세 화면이 `startScene()` 을 다시 부르면 상태 9칸이 지워져 여기서 갈린다.
      const 볼_것 = (상세: typeof 처음) => [
        상세.session.current_child_turn_count,
        상세.session.accumulated_elements,
        상세.session.last_response_mode,
        상세.current_missing_elements,
        상세.messages.length,
      ]
      expect(볼_것(다시)).toEqual(볼_것(처음))
      expect(처음.session.current_child_turn_count).toBe(1)
      expect(처음.session.accumulated_elements).toEqual(['EMPATHY'])
    })
  })

  it('#7 두 번 보내기 잠금은 회차마다 따로 걸린다 (FR-041)', async () => {
    await 트랜잭션(async (tx) => {
      const 문지기 = 문()
      가짜_제미나이(문지기.문지기)
      const 씨 = await 콘텐츠_넣기(tx)
      const 가 = await 회차_시작(씨)
      const 나 = await 회차_시작(씨)

      const 가_턴 = analysisStep({ session_id: 가.session_id, child_utterance: '가의 발화' })
      await 문지기.도착
      expect(inProgress.read(가.id)).not.toBeNull()

      // 나 는 막히지 않는다 — 잠금이 회차별이 아니면 여기서 409 가 난다.
      const 나_턴 = await analysisStep({
        session_id: 나.session_id,
        child_utterance: '나의 발화',
      })
      expect(나_턴.data.turn_order).toBe(2)

      문지기.연다()
      await 가_턴
      expect(inProgress.read(가.id)).toBeNull()
    })
  })

  it('#8 같은 시각에 돈 두 회차의 턴이 섞이지 않는다 (FR-041)', async () => {
    await 트랜잭션(async (tx) => {
      가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)
      const 가 = await 회차_시작(씨)
      const 나 = await 회차_시작(씨)

      // ⚠️ 파이썬은 스레드 둘을 장벽으로 겹쳤다. 여기서는 두 턴을 **동시에 띄운다.**
      await Promise.all([한턴(가.session_id, '가의 발화'), 한턴(나.session_id, '나의 발화')])

      for (const 회차 of [가, 나]) {
        const 줄들 = await sessionTranscript(tx, 회차.session_id)
        const 아이 = 줄들.filter((행) => 행.speaker_type === 'child')
        expect(아이).toHaveLength(1)

        const 조건들 = await readRunTurnConditions(tx, 회차.id)
        expect(조건들.map((행) => 행.message_id)).toEqual([아이[0].id])
        expect(조건들.every((행) => 행.run_id === 회차.id)).toBe(true)

        const 시도들 = await readAttempts(tx, { run_id: 회차.id })
        expect(시도들.length).toBeGreaterThan(0)
        expect(시도들.every((행) => 행.message_id === 아이[0].id)).toBe(true)
      }

      // 발화가 서로 바뀌지 않았다.
      const 가_줄 = await sessionTranscript(tx, 가.session_id)
      expect(가_줄.find((행) => 행.speaker_type === 'child')?.text).toBe('가의 발화')
    })
  })

  it('#9 ⭐ 대본으로 돈 회차와 화면으로 돈 회차가 같은 판정을 남긴다 (SC-010)', async () => {
    await 트랜잭션(async (tx) => {
      가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)
      const 발화들 = ['며느리가 창피했겠다', '그래도 참았으면 좋겠어']

      // ① 대본 길 — `runStory()` (파이썬의 터미널 경로)
      const 대본_회차 = await startRunStep({
        story_code: 씨.story_code,
        scope: 'scene',
        scene_order: 2,
        started_by: '대본',
      })
      let 남은 = [...발화들]
      await runStory({
        conn: tx,
        run_id: 대본_회차.run.id,
        session_id: 대본_회차.session_id,
        story_code: 씨.story_code,
        scope: 'scene',
        scene_order: 2,
        prompt_version: 대본_회차.run.prompt_version,
        input: () => 남은.shift() ?? null,
      })

      // ② 화면 길 — ①②③ 을 단계별로
      const 화면_회차 = await 회차_시작(씨, { scope: 'scene', scene_order: 2 })
      남은 = [...발화들]
      for (const 발화 of 발화들) {
        const { 셋 } = await 한턴(화면_회차.session_id, 발화)
        if (셋.data.source === 'fixed') break
      }

      const 칸넷 = async (session_id: string) => {
        const { session } = await runState(
          tx,
          session_id === 대본_회차.session_id ? 대본_회차.run.id : 화면_회차.id,
        )
        return [
          session.last_response_mode,
          session.scene_end_reason,
          session.accumulated_elements,
          session.current_child_turn_count,
        ]
      }
      expect(await 칸넷(화면_회차.session_id)).toEqual(await 칸넷(대본_회차.session_id))
    })
  })

  it('#18 아직 안 간 장면은 쪽으로 안 만들어진다', async () => {
    await 트랜잭션(async (tx) => {
      가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)

      // `scene` 범위 — 그 장면 하나뿐이라 넘겨볼 곳이 없다.
      const 한장면 = await 회차_시작(씨, { scope: 'scene', scene_order: 2 })
      expect((await runDetail(한장면.id)).scene_pages).toHaveLength(1)

      // `story` 범위 — 시작 직후에는 장면 2 까지만 갔다. 4 는 아직 쪽이 아니다.
      const 전체 = await 회차_시작(씨)
      const 상세 = await runDetail(전체.id)
      expect(상세.scene_pages.map((쪽) => 쪽.scene_order)).toEqual([2])
      expect(상세.scene_pages[0].scenes.map((장면) => 장면.scene_order)).toEqual([1, 2])
    })
  })

  it('#19 없는 장면을 고르면 404 SCENE_NOT_FOUND 다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)

      const 없는_씬 = await sceneView({
        story_code: 씨.story_code,
        scene_code: 'sc_ad_99',
        conn: tx,
      }).catch((오류: unknown) => 오류)
      expect(옮긴다(없는_씬)).toMatchObject({
        status: 404,
        error: { code: 'SCENE_NOT_FOUND', retryable: false },
      })
    })
  })

  // ── 실험 프롬프트가 ①③ 에도 닿는가 (T094 · FR-057) ──────────────────────
  //
  // 🔴 **화면이 부르는 길은 `submitTurn()` 이 아니라 `analysisStep()`·`dialogueStep()` 이다.**
  //    `tests/service.test.ts` 가 `submitTurn()` 쪽을 재고, 여기서 단계 함수 쪽을 잰다.
  //    한쪽만 배선하면 「작업대에서 저장했는데 화면으로 돌리면 정본으로 돈다」가 된다.

  /** 실험 본문 한 벌. `## 받는 것` 절이 있어야 재료 틀도 여기서 뽑힌다. */
  const 실험_본문 = (이름: string) =>
    [`실험용 ${이름} 지시다. 정본과 한 글자도 안 겹친다.`, '', '## 받는 것', '', '```json', `{${이름}_material}`, '```', ''].join('\n')

  it('회차에 저장된 실험 프롬프트로 ①③ 이 돈다', async () => {
    await 트랜잭션(async (tx) => {
      const 기록 = 가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)
      const run = await 회차_시작(씨)

      await saveExperimentPromptStep({
        run_id: run.id,
        name: 'analysis',
        body: 실험_본문('analysis'),
        conn: tx,
      })
      await saveExperimentPromptStep({
        run_id: run.id,
        name: 'character',
        body: 실험_본문('character'),
        conn: tx,
      })

      await 한턴(run.session_id, '며느리가 창피했을 것 같아')

      expect(기록.분석_system).toEqual([실험_본문('analysis')])
      expect(기록.대사_system).toEqual([실험_본문('character')])
    })
  })

  it('실험 프롬프트가 없으면 ①③ 이 정본으로 돈다', async () => {
    await 트랜잭션(async (tx) => {
      const 기록 = 가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)
      const run = await 회차_시작(씨)

      await 한턴(run.session_id, '며느리가 창피했을 것 같아')

      expect(기록.분석_system).toEqual([read('analysis')])
      expect(기록.대사_system).toEqual([read('character')])
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 서버 액션 — 화면의 단추를 실제로 누른다
// ═══════════════════════════════════════════════════════════════════════════

DB검사('화면의 단추', () => {
  it('「시작」이 회차를 열고 **전개까지 재생한 뒤** 진행 화면으로 보낸다', async () => {
    await 트랜잭션(async (tx) => {
      const 기록 = 가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)

      const { 경로, error } = await 눌러본다(startRunAction, {
        story_code: 씨.story_code,
        scope: 'story',
        started_by: '검사',
      })

      expect(error).toBeNull()
      const run_id = 경로.split('/')[2]
      expect(경로).toBe(`/runs/${run_id}`)

      // ⭐ 전개를 안 재생하면 `current_scene_id` 가 null 이라 ① 이 409 로 튕긴다 (계약 7절).
      const 상세 = await runDetail(run_id)
      expect(상세.next_action.kind).toBe('발화받기')
      expect(상세.current_scene?.scene_order).toBe(2)
      // ⛔ 시작에는 LLM 이 한 번도 안 나간다.
      expect(호출수(기록)).toEqual({ 분석: 0, 대사: 0 })
    })
  })

  // ── 회차 시작 폼의 모델·강도 칸 (E-1 · 이식 누락이었다) ───────────────────
  //
  // 파이썬 `templates/run_new.html` 의 `LLM칸` 매크로 ×2 가 이식에서 빠져 있었고,
  // 뒷단(`StartRunArgs`·`runSettings()`)은 다 와 있는데 폼과 액션만 비어서 `runs` 의 네 칸이
  // **전부 NULL** 이었다. 결과는 안 틀리지만 **회차 기록에 「무엇으로 돌렸나」가 안 남는다** —
  // 회차끼리 견주는 것이 이 도구의 존재 이유라 그게 실질적 손실이다.

  it('폼에 넣은 모델·강도가 `runs` 행에 그대로 남는다', async () => {
    await 트랜잭션(async (tx) => {
      가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)

      const { 경로, error } = await 눌러본다(startRunAction, {
        story_code: 씨.story_code,
        scope: 'story',
        started_by: '검사',
        analysis_model: 'gemini-3.5-flash',
        analysis_effort: 'high',
        character_model: 'gemini-3.5-flash-lite',
        character_effort: 'minimal',
      })
      expect(error).toBeNull()

      const run = await readRun(tx, 경로.split('/')[2])
      expect({
        analysis_model: run.analysis_model,
        analysis_effort: run.analysis_effort,
        character_model: run.character_model,
        character_effort: run.character_effort,
      }).toEqual({
        analysis_model: 'gemini-3.5-flash',
        analysis_effort: 'high',
        character_model: 'gemini-3.5-flash-lite',
        character_effort: 'minimal',
      })

      // ⭐ 저장만 되고 안 쓰이면 뜻이 없다 — 회차에 박힌 값이 실제 설정까지 흐르는지 본다.
      //    강도 한 값이 **두 공급자에 다** 간다 (2026-08-11).
      const 설정 = runSettings(run)
      expect(설정.analysis.gemini_model).toBe('gemini-3.5-flash')
      expect(설정.analysis.gemini_effort).toBe('high')
      expect(설정.analysis.anthropic_effort).toBe('high')
      expect(설정.character.gemini_model).toBe('gemini-3.5-flash-lite')
      expect(설정.character.gemini_effort).toBe('minimal')
    })
  })

  it('앞뒤 공백이 붙은 모델 이름은 다듬어 저장된다 (파이썬 `.strip()`)', async () => {
    await 트랜잭션(async (tx) => {
      가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)

      const { 경로, error } = await 눌러본다(startRunAction, {
        story_code: 씨.story_code,
        scope: 'story',
        analysis_model: '  gemini-3.5-flash  ',
        analysis_effort: ' high ',
        character_model: '\tgemini-3.5-flash-lite\n',
        // 🔴 **넷째 칸도 보낸다** (2026-08-13 통합). 여기 없던 탓에 `character_effort` 의
        //    `.trim()` 만 되돌려도 64건이 그대로 초록이었다 — 「넷을 다 다듬는다」고
        //    적어 놓고 셋만 재고 있었다.
        character_effort: '  low  ',
      })
      expect(error).toBeNull()

      const run = await readRun(tx, 경로.split('/')[2])
      expect({
        analysis_model: run.analysis_model,
        analysis_effort: run.analysis_effort,
        character_model: run.character_model,
        character_effort: run.character_effort,
      }).toEqual({
        analysis_model: 'gemini-3.5-flash',
        analysis_effort: 'high',
        character_model: 'gemini-3.5-flash-lite',
        character_effort: 'low',
      })

      // 🔴 다듬지 않으면 이 값이 그대로 `gemini_model` 자리에 흘러가 **첫 호출에 통째로
      //    실패한다.** `runSettings()` 가 `run.analysis_model || 바닥` 이라 공백이 붙은 이름도
      //    「값이 있다」로 이겨 버린다 — 바닥값으로 내려앉지도 않는다.
      const 설정 = runSettings(run)
      expect(설정.analysis.gemini_model).toBe('gemini-3.5-flash')
      expect(설정.analysis.gemini_effort).toBe('high')
      expect(설정.character.gemini_model).toBe('gemini-3.5-flash-lite')
      expect(설정.character.gemini_effort).toBe('low')
    })
  })

  it('이야기에 없는 장면으로 시작하면 막힌다 — **회차가 안 생긴다** (파이썬 422)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx) // 장면은 1~4 뿐이다
      const 앞_회차 = (await tx.select({ id: runs.id }).from(runs)).length
      const 앞_세션 = (await tx.select({ id: story_sessions.id }).from(story_sessions)).length

      const { 경로, error } = await 눌러본다(startRunAction, {
        story_code: 씨.story_code,
        scope: 'scene',
        scene_order: '99',
      })

      // 파이썬 문구 그대로다 (`routes/runs.py` — `detail="고른 장면이 이야기에 없다"`).
      expect(error).toBe('BAD_REQUEST: 고른 장면이 이야기에 없다')
      expect(경로).toBe('/runs')
      // 🔴 **유령 회차를 잡는 자리다.** 검사 전에는 회차가 먼저 생기고 그 뒤 `advanceStep()` 이
      //    터져서, 아무 턴도 없는 회차와 세션이 목록에 남았다 (실측 `runs` 8→9).
      expect((await tx.select({ id: runs.id }).from(runs)).length).toBe(앞_회차)
      expect((await tx.select({ id: story_sessions.id }).from(story_sessions)).length).toBe(앞_세션)
    })
  })

  it('목록 밖 강도는 막힌다 — 회차가 아예 안 생긴다 (파이썬 422 · C-13)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const 앞 = (await tx.select({ id: runs.id }).from(runs)).length

      const { 경로, error } = await 눌러본다(startRunAction, {
        story_code: 씨.story_code,
        scope: 'story',
        analysis_effort: 'ultra', // 목록에 없는 이름. 파이썬에서는 자유 입력칸의 오타였다.
      })

      // 어느 칸이 왜 틀렸는지가 남아야 사람이 고친다 (`zod_문구()`).
      expect(error).toMatch(/^BAD_REQUEST: analysis_effort: /)
      expect(경로).toBe('/runs')
      // 🔴 모르는 강도는 제미나이에 **안 실린 채 조용히 돈다.** 여기서 안 막으면 회차가
      //    생기고, 나중에 「강도를 줬는데 왜 빠르지」를 못 되짚는다.
      expect((await tx.select({ id: runs.id }).from(runs)).length).toBe(앞)
    })
  })

  it('빈칸이면 설정 바닥값이 채워져 들어간다 — NULL 이 아니다', async () => {
    await 트랜잭션(async (tx) => {
      가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)

      const { 경로, error } = await 눌러본다(startRunAction, {
        story_code: 씨.story_code,
        scope: 'story',
      })
      expect(error).toBeNull()

      const run = await readRun(tx, 경로.split('/')[2])
      const 바닥 = loadSettings()
      // 🔴 NULL 로 두면 `runSettings()` 가 **볼 때마다 그때의 `.env.local`** 로 내려앉는다.
      //    나중에 설정을 바꾸면 옛 회차의 뜻이 따라 변한다.
      expect(run.analysis_model).not.toBeNull()
      expect(run.analysis_effort).not.toBeNull()
      expect(run.character_model).not.toBeNull()
      expect(run.character_effort).not.toBeNull()
      expect({
        analysis_model: run.analysis_model,
        analysis_effort: run.analysis_effort,
        character_model: run.character_model,
        character_effort: run.character_effort,
      }).toEqual({
        analysis_model: 바닥.gemini_model,
        analysis_effort: 바닥.gemini_effort,
        character_model: 바닥.gemini_model,
        character_effort: 바닥.gemini_effort,
      })
    })
  })

  it('scope=scene 인데 장면을 안 골랐으면 막힌다 — DB CHECK 말고 사람 말로', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const 앞 = (await tx.select({ id: runs.id }).from(runs)).length

      const { 경로, error } = await 눌러본다(startRunAction, {
        story_code: 씨.story_code,
        scope: 'scene',
      })

      // `runs_scene_order_check` 도 막지만 그쪽은 제약 이름이 박힌 SQL 오류로 보인다.
      expect(error).toMatch(/^BAD_REQUEST: scene_order: /)
      expect(경로).toBe('/runs')
      expect((await tx.select({ id: runs.id }).from(runs)).length).toBe(앞)
    })
  })

  it('①②③ 단추를 차례로 누르면 한 턴이 돈다', async () => {
    await 트랜잭션(async (tx) => {
      const 기록 = 가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)
      const run = await 회차_시작(씨)
      const 공통 = { run_id: run.id, session_id: run.session_id }

      expect(await 눌러본다(analysisAction, { ...공통, child_utterance: '며느리가 창피했겠다' })).toEqual({
        경로: `/runs/${run.id}`,
        error: null,
      })

      const 분석뒤 = await runDetail(run.id)
      expect(분석뒤.pending?.stage).toBe('decision')
      const message_id = 분석뒤.pending!.message_id
      const 분석 = 분석뒤.pending!.analysis!

      expect(
        await 눌러본다(decisionAction, {
          ...공통,
          message_id,
          child_intent: 분석.child_intent,
          utterance_validity: 분석.utterance_validity,
          detected_elements: [...분석.detected_elements_kept],
        }),
      ).toEqual({ 경로: `/runs/${run.id}`, error: null })

      const 판단뒤 = await runDetail(run.id)
      expect(판단뒤.pending?.stage).toBe('character')
      const 판정 = 판단뒤.pending!.decision!

      expect(
        await 눌러본다(dialogueAction, {
          ...공통,
          message_id,
          response_mode: 판정.response_mode,
          reaction_key: 판정.reaction_key,
          guidance_target: 판정.guidance_target ?? '',
          main_point: 분석.main_point ?? '',
        }),
      ).toEqual({ 경로: `/runs/${run.id}`, error: null })

      const 끝 = await runDetail(run.id)
      expect(끝.pending).toBeNull()
      expect(끝.messages.map((행) => 행.speaker_type)).toEqual(['character', 'child', 'character'])
      expect(호출수(기록)).toEqual({ 분석: 1, 대사: 1 })
    })
  })

  it('한 턴 돌리기 단추 하나로 ①②③ 이 다 돈다', async () => {
    // 🔴 파이썬은 발화를 넣으면 `회차.py:444 턴_뒤에서()` 가 끝까지 돌렸고 사람은 한 번만
    //    눌렀다. 바로 위 검사와 **끝난 자리가 같아야 한다** — 단추 셋을 누른 것과 한 번
    //    누른 것이 같은 DB 상태를 남기는지가 이 짝의 뜻이다.
    await 트랜잭션(async (tx) => {
      const 기록 = 가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)
      const run = await 회차_시작(씨)

      expect(
        await 눌러본다(turnAction, {
          run_id: run.id,
          // ⚠️ `turnAction` 은 이 값을 안 쓴다. 폼이 하나라 실려 오고 스키마가 받을 뿐이다.
          session_id: run.session_id,
          child_utterance: '며느리가 창피했겠다',
        }),
      ).toEqual({ 경로: `/runs/${run.id}`, error: null })

      const 끝 = await runDetail(run.id)
      // ⓐ 끝나지 않은 턴이 없다 — ②③ 을 사람이 더 누를 자리가 남지 않았다.
      expect(끝.pending).toBeNull()
      // ⓑ 고정 첫 대사 · 아이 발화 · 캐릭터 대사.
      expect(끝.messages.map((행) => 행.speaker_type)).toEqual(['character', 'child', 'character'])
      // ⓒ 판정 스냅샷이 한 행 남았다 (`[분석] [상태] [판정]` 세 줄의 뿌리).
      expect(await readRunTurnConditions(tx, run.id)).toHaveLength(1)
      // ⓓ LLM 은 분석 1 · 대사 1. ② 는 순수 함수라 안 센다.
      expect(호출수(기록)).toEqual({ 분석: 1, 대사: 1 })
    })
  })

  it('실패는 `?error=` 로 돌아온다 — 라우트와 **같은 코드 이름**이다', async () => {
    await 트랜잭션(async (tx) => {
      가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)
      const run = await 회차_시작(씨)

      // 빈 발화 — 계약 8절 400 `BAD_REQUEST` (파이썬 #2 의 204 자리다).
      const 빈발화 = await 눌러본다(analysisAction, {
        run_id: run.id,
        session_id: run.session_id,
        child_utterance: '   ',
      })
      expect(빈발화.경로).toBe(`/runs/${run.id}`)
      expect(빈발화.error).toMatch(/^BAD_REQUEST: /)

      // 없는 세션 — 404 `SESSION_NOT_FOUND`.
      const 없는세션 = await 눌러본다(analysisAction, {
        run_id: run.id,
        session_id: randomUUID(),
        child_utterance: '음',
      })
      expect(없는세션.error).toMatch(/^SESSION_NOT_FOUND: /)

      // ⛔ 어느 쪽도 아이 메시지를 만들지 않았다.
      const 줄들 = await sessionTranscript(tx, run.session_id)
      expect(줄들.filter((행) => 행.speaker_type === 'child')).toHaveLength(0)
    })
  })

  it('전개 재생 단추가 다음 대화 장면까지 민다', async () => {
    await 트랜잭션(async (tx) => {
      const 기록 = 가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)
      const run = await 회차_시작(씨)

      // 장면 2 를 CLOSING 으로 끝낸다 — 「계속하기」 단추가 아니라 `decide()` 가 끝낸다.
      await 한턴(run.session_id, '며느리가 창피했겠다 1')
      await 한턴(run.session_id, '며느리가 창피했겠다 2')
      expect((await runDetail(run.id)).next_action.kind).toBe('장면시작')

      const { 경로, error } = await 눌러본다(advanceAction, { run_id: run.id })
      expect({ 경로, error }).toEqual({ 경로: `/runs/${run.id}`, error: null })

      const 상세 = await runDetail(run.id)
      // 전개 3 을 지나 대화 4 에 섰다. 전개는 `messages` 에 안 남는다 (결정 22).
      expect(상세.current_scene?.scene_order).toBe(4)
      expect(상세.next_action.kind).toBe('발화받기')
      // 전개 재생과 고정 첫 대사는 LLM 0회 — 앞의 두 턴에서 쓴 것이 전부다.
      expect(호출수(기록)).toEqual({ 분석: 2, 대사: 1 })
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 턴 로그 화면의 알맹이 — 박제된 판정으로 세 줄을 되살린다 (FR-011 · SC-005)
// ═══════════════════════════════════════════════════════════════════════════

DB검사('턴 로그 — `turn_conditions` 를 읽는다', () => {
  it('턴마다 `[분석] [상태] [판정]` 세 줄이 되살아난다 — DB 컬럼명 그대로', async () => {
    await 트랜잭션(async (tx) => {
      가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)
      const run = await 회차_시작(씨)
      await 한턴(run.session_id, '며느리가 창피했겠다')

      const 상세 = await runDetail(run.id)
      const 아이 = 상세.messages.filter((행) => 행.speaker_type === 'child')
      expect(아이).toHaveLength(1)

      const 줄들 = 아이[0].log_lines
      expect(줄들).not.toBeNull()
      expect(줄들!.분석).toMatch(/^\[분석] child_intent=OPINION /)
      expect(줄들!.분석).toContain('detected_elements=[EMPATHY("며느리가 창피했겠다")]')
      expect(줄들!.상태).toMatch(/^\[상태] current_child_turn_count=1 /)
      // ⚠️ 저장하지 않고 매번 뺀다 (경계 5). 목표를 채웠으니 빈 목록이다.
      expect(줄들!.상태).toContain('accumulated_elements=[EMPATHY] missing_elements=[]')
      expect(줄들!.판정).toMatch(/^\[판정] response_mode=NORMAL /)
      expect(줄들!.missing_elements).toEqual([])
    })
  })

  it('⭐ 대사가 안 붙은 턴은 `character_response` 가 null 이다 (다음 턴 것을 빌려오지 않는다)', async () => {
    await 트랜잭션(async (tx) => {
      가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)
      const run = await 회차_시작(씨)

      // ③ 을 부르지 않고 ①② 까지만 — 이 턴은 대사를 못 받았다.
      const 하나 = await analysisStep({
        session_id: run.session_id,
        child_utterance: '며느리가 창피했겠다',
      })
      await decisionStep({
        session_id: run.session_id,
        message_id: 하나.data.message_id,
        analysis: {
          child_intent: 'OPINION',
          detected_elements: 하나.data.detected_elements_kept,
          utterance_validity: 'VALID',
        },
      })

      const 상세 = await runDetail(run.id)
      const 아이 = 상세.messages.find((행) => 행.speaker_type === 'child')
      expect(아이?.character_response).toBeNull()
      // 그리고 화면이 이어 돌릴 자리를 안다.
      expect(상세.pending).toMatchObject({ stage: 'character', message_id: 하나.data.message_id })
      expect(상세.pending?.decision?.response_mode).toBe('NORMAL')
    })
  })

  it('⭐ 다음 턴의 대사를 제 것으로 착각하지 않는다 — **바로 다음 한 행**만 본다', async () => {
    await 트랜잭션(async (tx) => {
      가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)
      const run = await 회차_시작(씨)
      const scene_id = 씨.scene_ids.sc_ad_02

      // 「턴 하나가 대사 없이 끝나고 그 다음 턴은 대사를 받았다」를 손으로 만든다.
      // 정상 흐름으로는 못 만든다 — 미완 턴이 있으면 새 발화를 안 받기 때문이다 (FR-035).
      await insertMessage(tx, { session_id: run.session_id, scene_id, speaker_type: 'child', text: '가' })
      const 둘째 = await insertMessage(tx, {
        session_id: run.session_id,
        scene_id,
        speaker_type: 'child',
        text: '나',
      })
      await insertMessage(tx, {
        session_id: run.session_id,
        scene_id,
        speaker_type: 'character',
        text: '그러게 말이다',
      })

      const 상세 = await runDetail(run.id)
      const 아이 = 상세.messages.filter((행) => 행.speaker_type === 'child')
      expect(아이.map((행) => [행.text, 행.character_response])).toEqual([
        // 「뒤에 오는 첫 캐릭터 메시지」로 집으면 여기가 '그러게 말이다' 가 되어
        // 「응답 없음」이 영영 안 뜬다.
        ['가', null],
        ['나', '그러게 말이다'],
      ])
      expect(아이[1].id).toBe(둘째.id)
    })
  })

  it('스냅샷이 없는 턴은 세 줄이 `null` 이다 — 꾸며 내지 않는다', () => {
    const 없음 = turnLogLines(
      {
        text: '음',
        child_intent: 'OPINION',
        main_point: null,
        detected_elements: [],
        utterance_validity: 'VALID',
      },
      null,
      ['EMPATHY'],
    )
    expect(없음).toBeNull()
  })

  it('분석 행이 없으면 `[분석]` 만 null 이고 나머지 둘은 나온다', () => {
    const 줄들 = turnLogLines(
      {
        text: '음',
        child_intent: null,
        main_point: null,
        detected_elements: null,
        utterance_validity: null,
      },
      {
        message_id: 'm',
        run_id: 'r',
        seed_revision: 0,
        prompt_version: 'mvp_v1',
        current_child_turn_count: 2,
        accumulated_elements: ['EMPATHY'],
        last_response_mode: 'NORMAL',
        turns_without_new_element: 1,
        consecutive_low_information_turns: 0,
        response_mode: 'GUIDED',
        guidance_target: 'REASON',
        soft_cue: false,
        reaction_key: 'directResponse',
        scene_goal_met: false,
        scene_end_reason: null,
      },
      ['EMPATHY', 'REASON'],
    )

    expect(줄들!.분석).toBeNull()
    expect(줄들!.missing_elements).toEqual(['REASON'])
    expect(줄들!.상태).toContain('accumulated_elements=[EMPATHY] missing_elements=[REASON]')
    expect(줄들!.판정).toContain('response_mode=GUIDED guidance_target=REASON')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 층 경계 — 화면 파일이 무엇을 부르나 (`코드구조.md` 4절)
// ═══════════════════════════════════════════════════════════════════════════
//
// ⭐ 파이썬 #14·#15 는 Jinja 를 렌더해 「문맥 이름이 어긋나면 조용히 안 보인다」를 잡았다.
//    그 실패 방식은 사라졌지만 **같은 갈래의 실패는 남아 있다** — 폼 칸 이름과 액션이 읽는
//    이름이 어긋나면 단추가 조용히 안 먹는다. 그래서 그 짝을 여기서 맞춰 본다.

// ═══════════════════════════════════════════════════════════════════════════
// 2026-08-13 — **화면이 200 인데 회차가 멈춘 건** (이슈 #26)
// ═══════════════════════════════════════════════════════════════════════════
//
// 사람이 겪은 것: ① 을 누르고 3.2초 동안 아무 표시가 없어 다시 눌렀다. 둘째 호출이 회차
// 잠금에 걸려 409 `TURN_IN_PROGRESS` 로 튕겼고, 첫 호출은 그 뒤 분석을 정상으로 저장했다.
// 화면에 남은 것은 오류 띠와 「이 턴은 분석 단계에서 끊겼다 · 위의 「이어 돌리기」로 잇는다」
// 였는데, **그 「이어 돌리기」 단추는 도는 중에는 그려지지 않는다.** 없는 단추를 가리켰다.
//
// 🔴 그때까지 검사가 잰 것은 「쪽이 200 으로 뜬다」와 「①②③ 을 차례로 누르면 돈다」뿐이었다.
//    **눌리는 차례가 어긋났을 때 회차가 계속 돌 수 있나**는 아무도 안 쟀다. 그것을 여기서 잰다.

describe('단계 패널 갈래 — 파이썬 `run_body.html` 의 `progress → failure → 발화받기`', () => {
  it('🔴 이 회차가 도는 중이면 `pending` 이 `analysis` 여도 「도는중」이다', () => {
    // ① 이 도는 동안 아이 `messages` 행은 이미 있고 `utterance_analyses` 행은 아직 없다.
    // 저장된 사실로는 **죽은 턴과 똑같이** 생겨서 `pendingTurn()` 이 `analysis` 를 낸다.
    expect(
      어느_패널({
        progress: '분석 시작',
        pending_stage: 'analysis',
        next_action_kind: '발화받기',
      }),
    ).toBe('도는중')
  })

  it('도는 중이면 ②③ 자리도 안 내준다 — 두 번 누르면 409 가 난다', () => {
    for (const 자리 of ['decision', 'character'] as const) {
      expect(
        어느_패널({ progress: '캐릭터 대사 시작', pending_stage: 자리, next_action_kind: '발화받기' }),
      ).toBe('도는중')
    }
    // 미완 턴이 없어도 마찬가지다 — ③ 이 도는 중에 ① 폼을 내주면 새 발화가 끼어든다.
    expect(
      어느_패널({ progress: '분석 시작', pending_stage: null, next_action_kind: '발화받기' }),
    ).toBe('도는중')
  })

  it('안 도는데 분석 행이 없으면 「분석에서끊김」 — 그때는 「이어 돌리기」 띠가 함께 있다', () => {
    expect(
      어느_패널({ progress: null, pending_stage: 'analysis', next_action_kind: '발화받기' }),
    ).toBe('분석에서끊김')
  })

  it('미완 턴이 죽은 자리대로 ②③ 을 낸다', () => {
    expect(어느_패널({ progress: null, pending_stage: 'decision', next_action_kind: '발화받기' })).toBe(
      '판단',
    )
    expect(
      어느_패널({ progress: null, pending_stage: 'character', next_action_kind: '발화받기' }),
    ).toBe('대사')
  })

  it('미완 턴이 없으면 `nextStep()` 이 낸 다음 할 일을 따른다', () => {
    expect(어느_패널({ progress: null, pending_stage: null, next_action_kind: '발화받기' })).toBe(
      '분석',
    )
    expect(어느_패널({ progress: null, pending_stage: null, next_action_kind: '장면시작' })).toBe(
      '장면시작',
    )
    expect(어느_패널({ progress: null, pending_stage: null, next_action_kind: '회차끝' })).toBe(
      '더할것없음',
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 담장 사이 — 회차 상세에서 「LLM 시도 · 프롬프트 원문 · 비용」 화면으로 가는 길
// ═══════════════════════════════════════════════════════════════════════════
//
// 🔴 **화면은 섰는데 부르는 자리가 없었다** (2026-08-13 통합). `/runs/{id}/turns/{message_id}`
//    를 만든 쪽은 「링크는 통합이 붙인다」로 남겨 뒀고, 회차 화면을 만든 쪽은 그 쪽이 생긴 줄
//    몰랐다. 주소를 손으로 쳐야만 닿는 화면이 하루 남아 있었다.
//    파이썬은 턴 카드 안에 `details` 로 붙어 있었다 (`templates/turn.html:91-97`).
//
// ⭐ 그래서 재는 것은 「링크 컴포넌트가 있다」가 아니라 **「대화 한 줄을 그리면 그 링크가
//    같이 나온다」**다. 앞엣것만 재면 아무도 안 부르는 채로 초록이 된다.

describe('대화 한 줄 — 그 턴의 LLM 시도로 내려가는 길', () => {
  const 아이턴: TurnRow = {
    id: '11111111-1111-4111-8111-111111111111',
    session_id: '22222222-2222-4222-8222-222222222222',
    scene_id: '33333333-3333-4333-8333-333333333333',
    speaker_type: 'child',
    turn_order: 2,
    text: '며느리가 창피했겠다',
    utterance_source: 'text',
    created_at: new Date('2026-08-13T00:00:00Z'),
    scene_order: 3,
    character_name: '며느리',
    required_elements: ['REASON'],
    child_intent: 'ANSWER',
    main_point: '창피함',
    detected_elements: [{ type: 'REASON', evidence: '창피' }],
    utterance_validity: 'VALID',
    turn_condition: null,
    log_lines: null,
    character_response: '그랬겠구나',
  }

  function 그려본다(행: TurnRow): string {
    return renderToStaticMarkup(createElement(대화줄, { run_id: '9f', 행 }))
  }

  it('🔴 아이 턴을 그리면 `/runs/{run_id}/turns/{message_id}` 링크가 함께 나온다', () => {
    const 마크업 = 그려본다(아이턴)
    expect(마크업).toContain(`href="/runs/9f/turns/${아이턴.id}"`)
    // 무엇을 보러 가는 길인지가 글자에 있어야 사람이 누른다.
    // ⚠️ 2026-08-15 에 글자가 「LLM 시도 …」에서 「AI 를 부른 기록 보기」로 바뀌었다
    //    (규칙 1-1 · 가는 곳의 제목과 같은 말로). 재는 것은 그대로 「길이 글자로 보인다」다.
    expect(마크업).toContain('AI 를 부른 기록')
  })

  it('⚠️ 캐릭터 턴에는 안 붙는다 — `llm_calls.message_id` 는 아이 발화 행을 가리킨다', () => {
    // 캐릭터 행의 id 로 열면 늘 「호출 없음」이 나와 「이 턴은 LLM 을 안 썼다」로 잘못 읽힌다.
    const 마크업 = 그려본다({ ...아이턴, speaker_type: 'character', character_response: null })
    expect(마크업).not.toContain('/turns/')
    expect(마크업).not.toContain('답하지 못했습니다')
  })

  it('대사를 못 받은 아이 턴은 「캐릭터가 아직 답하지 못했습니다」와 링크를 **둘 다** 낸다', () => {
    // 여기가 사람이 가장 자주 눌러 볼 자리다 — 왜 대사가 없나를 원문에서 봐야 한다.
    // ⚠️ 옛 글자는 「응답 없음」이었다 (2026-08-15 · 규칙 2-5 — 운영자에게 그건 오류로 읽힌다).
    const 마크업 = 그려본다({ ...아이턴, character_response: null })
    expect(마크업).toContain('캐릭터가 아직 답하지 못했습니다')
    expect(마크업).toContain(`href="/runs/9f/turns/${아이턴.id}"`)
  })
})

DB검사('멈춘 턴에서 빠져나가는 길 — 「쪽이 뜬다」와 「회차가 돈다」는 다르다', () => {
  it('🔴 ① 이 두 번 눌려 409 가 나도 그 회차는 화면에서 끝까지 돌아간다', async () => {
    await 트랜잭션(async (tx) => {
      const 문지기 = 문()
      const 기록 = 가짜_제미나이(문지기.문지기)
      const 씨 = await 콘텐츠_넣기(tx)
      const run = await 회차_시작(씨)
      const 공통 = { run_id: run.id, session_id: run.session_id }

      // 첫째 「분석」. 가짜 LLM 안에서 멈춰 세운다 — 사람이 응답을 기다리던 그 3.2초다.
      const 첫째 = 눌러본다(analysisAction, { ...공통, child_utterance: '며느리가 창피했겠다' })
      await 문지기.도착

      // 사람이 다시 눌렀다.
      const 둘째 = await 눌러본다(analysisAction, { ...공통, child_utterance: '며느리가 창피했겠다' })
      expect(둘째.error).toMatch(/^TURN_IN_PROGRESS: /)
      // ⚠️ 벌거벗은 id 를 던지면 `message_id` 로 읽힌다. 무엇이 어느 회차에서 도는지 적는다.
      expect(둘째.error).toContain(`run_id=${run.id} · `)

      문지기.연다()
      expect(await 첫째).toEqual({ 경로: `/runs/${run.id}`, error: null })

      // 🔴 여기가 사람이 막혔다고 본 자리다 — 회차는 ② 를 기다리고 있을 뿐이다.
      const 멈춘곳 = await runDetail(run.id)
      expect(멈춘곳.progress).toBeNull()
      expect(멈춘곳.pending?.stage).toBe('decision')
      expect(
        어느_패널({
          progress: 멈춘곳.progress,
          pending_stage: 멈춘곳.pending?.stage ?? null,
          next_action_kind: 멈춘곳.next_action.kind,
        }),
      ).toBe('판단')

      const message_id = 멈춘곳.pending!.message_id
      const 분석 = 멈춘곳.pending!.analysis!
      expect(
        await 눌러본다(decisionAction, {
          ...공통,
          message_id,
          child_intent: 분석.child_intent,
          utterance_validity: 분석.utterance_validity,
          detected_elements: [...분석.detected_elements_kept],
        }),
      ).toEqual({ 경로: `/runs/${run.id}`, error: null })

      // ② 는 화면 경로에서도 `turn_conditions` 를 남긴다 (턴 로그 세 줄의 재료다).
      const 조건들 = await readRunTurnConditions(tx, run.id)
      expect(조건들.map((행) => 행.message_id)).toEqual([message_id])

      const 판단뒤 = await runDetail(run.id)
      const 판정 = 판단뒤.pending!.decision!
      expect(
        await 눌러본다(dialogueAction, {
          ...공통,
          message_id,
          response_mode: 판정.response_mode,
          reaction_key: 판정.reaction_key,
          guidance_target: 판정.guidance_target ?? '',
          main_point: 분석.main_point ?? '',
        }),
      ).toEqual({ 경로: `/runs/${run.id}`, error: null })

      const 끝 = await runDetail(run.id)
      expect(끝.pending).toBeNull()
      // ⭐ 「응답 없음」이 사라졌다 = 캐릭터 대사가 이 턴에 붙었다.
      const 아이 = 끝.messages.filter((행) => 행.speaker_type === 'child')
      expect(아이).toHaveLength(1) // 두 번 눌러도 아이 메시지는 하나다 (FR-035)
      expect(아이[0].character_response).not.toBeNull()
      expect(아이[0].log_lines).not.toBeNull()
      // 409 로 튕긴 둘째는 LLM 을 안 불렀다.
      expect(호출수(기록)).toEqual({ 분석: 1, 대사: 1 })
    })
  })

  it('「죽은 단계부터 이어 돌리기」 단추 하나로도 멈춘 턴이 끝난다', async () => {
    await 트랜잭션(async (tx) => {
      const 기록 = 가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)
      const run = await 회차_시작(씨)
      const 공통 = { run_id: run.id, session_id: run.session_id }

      await 눌러본다(analysisAction, { ...공통, child_utterance: '며느리가 창피했겠다' })
      const 멈춘곳 = await runDetail(run.id)
      // 🔴 ② 를 기다리는 것은 **정상 대기다.** 주황 띠를 그리지 않는다 (2026-08-13).
      //    ② 는 `decide()` 순수 함수라 LLM 이 없고, 「실패」라는 사실이 존재할 수 없다.
      //    그래도 `resumeAction` 은 그대로 산다 — 아래가 그 단추 하나로 끝나는지 잰다.
      expect(멈춘곳.failure).toBeNull()
      expect(멈춘곳.pending!.stage).toBe('decision')

      expect(
        await 눌러본다(resumeAction, {
          run_id: run.id,
          child_message_id: 멈춘곳.pending!.message_id,
        }),
      ).toEqual({ 경로: `/runs/${run.id}`, error: null })

      const 끝 = await runDetail(run.id)
      expect(끝.pending).toBeNull()
      const 아이 = 끝.messages.filter((행) => 행.speaker_type === 'child')
      expect(아이).toHaveLength(1)
      expect(아이[0].character_response).not.toBeNull()
      // ⛔ 이어 돌리기는 분석을 다시 부르지 않는다 — 박제된 값을 쓴다 (FR-015).
      expect(호출수(기록)).toEqual({ 분석: 1, 대사: 1 })
    })
  })
})

/**
 * `children` 이 **필수**인 컴포넌트를 `createElement` 의 **셋째 인자**로 그리게 해 주는 형변환.
 *
 * ⚠️ 이 한 줄이 없으면 검사 도구 둘이 서로 반대를 요구한다 (2026-08-13 통합에서 부딪혔다):
 *    · `tsc` — `createElement(C, props, 글자)` 의 셋째 인자는 **타입 위에서 `children` 을
 *      안 메운다.** `보내기` 처럼 `children: React.ReactNode` 가 필수면 `props` 에 그 칸이
 *      없다고 빨개진다 (TS2769).
 *    · `eslint` — 그렇다고 `props` 에 `children` 을 넣으면 `react/no-children-prop` 이 막는다.
 *
 * 그래서 **타입만** 누그러뜨린다. 돌아가는 코드는 그대로이고 그려지는 결과도 같다 —
 * `createElement` 는 셋째 인자를 `props.children` 자리에 넣는다.
 * ⛔ 검사를 끄지 않는다. 컴포넌트의 진짜 prop 타입에서 `Omit` 으로 **파생**시키므로,
 *    `보내기` 의 칸이 바뀌면 여기도 따라 바뀌고 잘못 준 prop 은 여전히 빨개진다.
 */
function 글자는_따로<P extends { children: ReactNode }>(
  컴포넌트: (props: P) => unknown,
): (props: Omit<P, 'children'>) => ReactNode {
  return 컴포넌트 as unknown as (props: Omit<P, 'children'>) => ReactNode
}

describe('화면 파일은 service 만 부른다', () => {
  const 읽기 = (상대경로: string) => readFileSync(path.join(WEB_ROOT, 상대경로), 'utf8')

  const 화면들 = [
    'app/(admin)/layout.tsx',
    'app/(admin)/runs/page.tsx',
    'app/(admin)/runs/actions.ts',
    'app/(admin)/runs/ui.tsx',
    // 엔진 값을 사람 말로 옮기는 표 (규칙 1-1). 이름표만 붙이는 자리라 여기도 같은 그물에 든다.
    'app/(admin)/runs/wording.tsx',
    'app/(admin)/runs/[run_id]/page.tsx',
    'app/(admin)/runs/[run_id]/log/page.tsx',
  ]

  for (const 상대경로 of 화면들) {
    it(`${상대경로} — repo · llm · db 를 직접 부르지 않는다`, () => {
      const 본문 = 읽기(상대경로)
      const 가져온것 = [...본문.matchAll(/from\s+'([^']+)'/g)].map((하나) => 하나[1])

      for (const 하나 of 가져온것) {
        expect(하나.startsWith('@/llm/repo')).toBe(false)
        expect(하나.startsWith('@/llm/provider')).toBe(false)
        expect(하나.startsWith('@/db')).toBe(false)
      }
    })

    it(`${상대경로} — 판정을 스스로 계산하지 않는다 (경계 6)`, () => {
      // 주석과 **역따옴표로 감싼 글**은 뺀다 — 머리말도 화면 글귀도 「여기서 `decide()` 를
      // 부르지 않는다」라고 적고 있어서, 안 빼면 그 문장 자체가 검사를 빨갛게 만든다.
      const 코드만 = 읽기(상대경로)
        .split('\n')
        .filter((줄) => !/^\s*(\/\/|\*|\/\*)/.test(줄))
        .join('\n')
        .replace(/`[^`]*`/g, '``')
      expect(코드만).not.toMatch(/\bdecide\s*\(/)
      expect(코드만).not.toMatch(/\bnextStep\s*\(/)
      expect(코드만).not.toMatch(/\bpostProcess\s*\(/)
    })
  }

  it('⭐ 회차 화면의 제출 단추는 눌린 뒤 스스로 잠근다 (2026-08-13)', () => {
    // 파이썬은 턴을 202 로 받고 htmx 가 폴링해서 **도는 동안 폼이 화면에 없었다**
    // (`run_body.html` 의 `{% elif progress %}`). 이식본의 서버 액션은 동기라 그 자리에
    // 아무 표시가 없고, 사람이 3.2초를 기다리다 다시 눌러 409 를 만들었다.
    for (const 상대경로 of ['app/(admin)/runs/page.tsx', 'app/(admin)/runs/[run_id]/page.tsx']) {
      const 본문 = 읽기(상대경로)
      expect(본문, `${상대경로} 에 <보내기> 가 없다`).toMatch(/<보내기[\s>]/)
      expect(본문, `${상대경로} 에 잠기지 않는 단추가 남아 있다`).not.toMatch(/type="submit"/)
    }
  })

  it('🔴 발화 폼이 `turnAction` 에 걸려 있고 단추 순서가 ①②③ 먼저다 (죽은 그물이던 자리)', () => {
    // ⭐ **이 검사가 없으면 `action={turnAction}` 을 `analysisAction` 으로 되돌려도 전부 초록이다.**
    //    아래 DB 검사들은 `눌러본다(turnAction, …)` 로 액션을 **직접** 부르므로 「turnAction 이
    //    ①②③ 을 돈다」만 재고 「화면이 그것에 걸려 있다」는 아무도 안 봤다. 2026-08-13 에
    //    되돌려 봤더니 49건이 그대로 초록이었다 — 이번 수리의 핵심이 무보호였다.
    //
    // 🔴 **단추 순서도 여기서 잰다.** 입력칸에서 엔터를 치면 브라우저가 **첫 제출 단추**를
    //    누른다. 뒤집히면 엔터가 「① 분석만」이 되어 파이썬과 손버릇이 갈리는데,
    //    화면을 안 그리는 검사는 그 뒤집힘을 하나도 못 본다.
    const 본문 = 읽기('app/(admin)/runs/[run_id]/page.tsx')

    // 발화 입력칸이 든 `<form>` 하나를 통째로 떼어낸다 (폼은 겹치지 않으므로 비탐욕이면 된다).
    const 발화폼 = [...본문.matchAll(/<form action=\{(\w+)\}[\s\S]*?<\/form>/g)].find((하나) =>
      하나[0].includes('name="child_utterance"'),
    )
    expect(발화폼, '발화 입력칸이 든 <form> 이 없다').toBeDefined()
    expect(발화폼![1], '발화 폼이 turnAction 이 아닌 것에 걸렸다').toBe('turnAction')

    const 단추들 = [...발화폼![0].matchAll(/<보내기([^>]*)>([\s\S]*?)<\/보내기>/g)]
    expect(단추들.length, '발화 폼의 단추가 둘이 아니다 (①②③ · ① 분석만)').toBe(2)

    // 첫 단추 = 폼의 action(=turnAction) 그대로. `formAction` 이 붙으면 그게 아니다.
    expect(단추들[0][1], '첫 단추가 폼의 action 이 아닌 다른 액션으로 샌다').not.toMatch(
      /formAction/,
    )
    // ⚠️ **글자가 2026-08-15 에 바뀌었다** (규칙 1-1 · 3-6). 옛 글자는 「한 턴 돌리기 (①②③)」
    //    였는데 ①②③ 은 우리 계약의 번호일 뿐 운영자에게는 뜻이 없다. 재는 것은 그대로
    //    「첫 단추가 한 차례를 끝까지 도는 쪽이다」이고, 그 사실을 새 글자로 잰다.
    expect(단추들[0][2], '첫 단추가 「캐릭터 대답까지 한 번에」가 아니다').toContain(
      '캐릭터 대답까지 한 번에',
    )

    // 🔴 **첫 단추의 `표식` 도 여기서 잰다** (2026-08-13 통합 — 이 줄이 없어 무보호였다).
    //    `표식` 만 지워 봤더니 64건이 전부 초록인 채로 **고쳤다던 버그가 그대로 돌아왔다.**
    //    기전: `표식` 이 없으면 `도는_단추인가()` 가 「단추 하나뿐인 폼」 갈래
    //    (`표식 === undefined && formAction === undefined` → 늘 true)로 떨어져, 「① 분석만」을
    //    눌러도 이 단추가 **「한 턴 도는 중… (LLM 2회)」**로 바뀐다. 나가는 LLM 은 1회다.
    //    ⚠️ 아래 렌더 검사 둘은 `보내기` 를 직접 그리며 **검사가 표식을 손으로 준다** —
    //       화면이 실제로 주는지는 저기서 못 본다. 반대쪽 `formAction` 만 지켜지고 있었다.
    expect(단추들[0][1], '첫 단추에 표식="turn" 이 없다 — 옆 단추를 눌러도 이 단추가 제 글자를 잃는다').toMatch(
      /표식="turn"/,
    )
    // 둘째 단추 = 검수용 ① 분석만. 통째로 사라져도 여태 아무도 안 봤다.
    expect(단추들[1][1], '둘째 단추가 analysisAction 에 안 걸렸다').toMatch(
      /formAction=\{analysisAction\}/,
    )
    // ⚠️ 옛 글자는 「① 분석만 (검수)」였다 (같은 2026-08-15 갈이).
    expect(단추들[1][2], '둘째 단추가 「아이 말만 먼저 읽어 보기」가 아니다').toContain(
      '아이 말만 먼저 읽어 보기',
    )
    // ⚠️ 둘째 단추에는 `표식` 이 **없어야** 한다 — `formAction` 이 붙은 단추의 `name` 은
    //    React 가 `$ACTION_ID_…` 로 덮어쓰므로(`pushFormActionAttribute`) 얹어도 안 실려 오고,
    //    개발 콘솔에 경고만 찍힌다. 가르는 것은 `status.action` 쪽이다.
    expect(단추들[1][1], '둘째 단추에 표식이 붙었다 — React 가 덮어쓸 자리다').not.toMatch(
      /표식=/,
    )
  })

  it('⭐ 도는중 문구는 **눌린 단추에만** 붙는다 — 잠금은 둘 다 (2026-08-13 거짓 문구)', () => {
    // 「① 분석만」을 눌렀는데 옆 단추가 「한 턴 도는 중… (LLM 2회)」로 바뀌던 자리다.
    // 그때 나가는 LLM 은 1회다 — 화면이 사실이 아닌 것을 말했다.
    const 턴 = async () => {}
    const 분석 = async () => {}
    const 자료 = (표식: string | null) => {
      const 폼 = new FormData()
      if (표식 !== null) 폼.set(눌린_단추_칸, 표식)
      return 폼
    }

    // ① 「한 턴 돌리기」를 눌렀다 — 폼의 action 그대로라 submitter 의 name/value 가 실려 온다.
    const 턴누름 = { pending: true, method: 'post', action: 턴, data: 자료('turn') } as const
    expect(도는_단추인가(턴누름, { 표식: 'turn' })).toBe(true)
    expect(도는_단추인가(턴누름, { 표식: 'analysis', formAction: 분석 })).toBe(false)

    // ② 「① 분석만」을 눌렀다 — React 19 는 submitter 가 제 `formAction` 을 가지면 그 단추의
    //    name/value 를 **버리므로**(`react-dom-client` 의 `extractEvents$1`) `data` 로는 못 가른다.
    //    `status.action` 이 그 단추의 `formAction` 과 같은 것으로 가른다.
    const 분석누름 = { pending: true, method: 'post', action: 분석, data: 자료(null) } as const
    expect(도는_단추인가(분석누름, { 표식: 'analysis', formAction: 분석 })).toBe(true)
    expect(도는_단추인가(분석누름, { 표식: 'turn' })).toBe(false)

    // ③ 단추가 하나뿐인 폼(이어 돌리기·판단·대사)은 그대로 제 문구를 낸다.
    expect(도는_단추인가(턴누름, {})).toBe(true)
    // ④ 안 도는 폼은 아무도 안 바뀐다.
    const 멈춤 = { pending: false, method: null, action: null, data: null } as const
    expect(도는_단추인가(멈춤, { 표식: 'turn' })).toBe(false)
    expect(도는_단추인가(멈춤, {})).toBe(false)
  })

  it('🔴 **렌더된** <보내기> — formAction 과 표식이 <button> 까지 간다', () => {
    // `formAction` 이 `<button>` 에 안 넘어가면 둘째 단추가 조용히 `turnAction` 을 부른다.
    // 글자만 훑는 검사는 prop 이름이 있는 것만 보고 **넘어갔는지**는 못 본다.
    // ⚠️ 여기서는 서버 렌더라 `useFormStatus()` 가 늘 `pending: false` 다 — 도는중 글자는
    //    위의 순수 함수 검사가 재고, 여기서는 **평상시 모양**을 잰다.
    const 그린것 = renderToStaticMarkup(
      createElement(
        글자는_따로(보내기),
        { 표식: 'analysis', formAction: '/x' as unknown as (폼: FormData) => void },
        '① 분석만 (검수)',
      ),
    )
    // ⚠️ 속성 이름의 대소문자·차례는 React 가 정한다 (`formAction="/x"` 를 그대로 낸다).
    //    HTML 속성 이름은 대소문자를 안 가리므로 견줄 때만 풀어 준다.
    expect(그린것, 'formAction 이 <button> 에 안 넘어갔다').toMatch(/formaction="\/x"/i)
    expect(그린것).toMatch(/type="submit"/)
    expect(그린것).toContain('① 분석만 (검수)')
    // 안 도는 동안에는 잠기지 않고 제 글자를 낸다.
    // (`disabled:opacity-50` 은 클래스 이름이므로 **속성**만 본다.)
    expect(그린것).not.toMatch(/\sdisabled=/)

    // 🔴 **`formAction` 이 있으면 `name`/`value` 를 얹지 않는다.** 진짜 서버 액션은 함수라
    //    React 가 그 자리에 `$ACTION_ID_…` 를 넣어야 하고, 우리 이름이 있으면 개발 콘솔에
    //    「Cannot specify a "name" prop for a button that specifies a function as a formAction …
    //    It will get overridden.」를 찍는다 (`pushFormActionAttribute`). 실측하면 이름은 사라지고
    //    `value` 만 남아 **React 가 지은 칸에 얹힌다.**
    //    ⚠️ 여기서 `'/x'` 문자열을 쓰는 것은 **일부러다.** 함수를 주면 React 가 스스로
    //       이름을 지워서, 우리가 도로 얹어도 렌더 결과로는 못 본다 — 문자열일 때만
    //       「우리가 안 얹었다」가 눈에 보인다.
    expect(그린것, 'formAction 단추에 name 이 얹혔다 (React 가 덮어쓸 자리다)').not.toMatch(
      new RegExp(`name="${눌린_단추_칸}"`),
    )
    expect(그린것, 'formAction 단추에 value 가 얹혔다').not.toMatch(/value="analysis"/)

    // 반대쪽 — `formAction` 이 없는 단추(=폼의 action 을 쓰는 쪽)는 표식이 실려야 한다.
    // 이게 없으면 `useFormStatus().data` 로 「어느 단추가 눌렸나」를 못 가른다.
    const 표식만 = renderToStaticMarkup(
      createElement(글자는_따로(보내기), { 표식: 'turn' }, '한 턴 돌리기 (①②③)'),
    )
    expect(표식만, '표식이 name 으로 안 나갔다').toMatch(new RegExp(`name="${눌린_단추_칸}"`))
    expect(표식만, '표식이 value 로 안 나갔다').toMatch(/value="turn"/)

    // 단추가 하나뿐인 폼은 표식이 없다 — 없는 채로도 그려져야 한다 (name 이 붙으면 안 된다).
    const 하나뿐 = renderToStaticMarkup(createElement(보내기, null, '판단'))
    expect(하나뿐).not.toMatch(/name=/)
    expect(하나뿐).toContain('판단')
  })

  it('🔴 도는 동안 **안 눌린 단추도 잠긴다** — 갈라지는 것은 글자뿐 (409 를 막는 자리)', async () => {
    // ⛔ 「눌린 단추만 잠근다」로 좁히면 2026-08-13 의 409 가 그대로 돌아온다 — 「① 분석만」이
    //    6초 도는 동안 옆의 「한 턴 돌리기」를 누를 수 있게 되고, 그 둘째 호출은 회차 잠금
    //    (`service/run.inProgress`)에 걸려 `TURN_IN_PROGRESS` 로 튕긴다.
    //    `도는_단추인가()` 가 가르는 것은 **글자**이지 `disabled` 가 아니다.
    //
    // ⚠️ **이 검사만 훅을 갈아끼운다.** 서버 렌더에서는 `useFormStatus()` 가 늘
    //    `pending: false` 라, 위의 두 검사는 「도는 동안의 모양」을 아무도 못 본다.
    //    2026-08-13 에 `disabled={상태.pending}` 을 `disabled={도는_단추인가(…)}` 로 좁혀
    //    봤더니 63건이 전부 초록이었다.
    // ⭐ `react-dom/server` 는 다른 모듈 id 라 이 갈아끼움에 안 걸린다 — 위에서 이미 불러
    //    둔 진짜 렌더러가 그대로 돈다. `보내기` 안에서 도는 훅은 이것 하나뿐이라
    //    새로 불러온 모듈이 React 인스턴스를 갈아도 부딪힐 자리가 없다.
    const 분석: (폼: FormData) => void = () => {}
    vi.resetModules()
    vi.doMock('react-dom', async (원래) => {
      const 진짜 = await 원래<typeof import('react-dom')>()
      return {
        ...진짜,
        useFormStatus: () => ({
          pending: true,
          method: 'post',
          action: 분석,
          data: new FormData(),
        }),
      }
    })
    try {
      const { 보내기: 도는중_보내기 } = await import('@/app/(admin)/runs/submit')

      // 눌린 쪽 — `formAction` 이 `status.action` 과 같다 (화면과 같이 `표식` 은 안 준다).
      const 눌린것 = renderToStaticMarkup(
        createElement(
          글자는_따로(도는중_보내기),
          { formAction: 분석, 도는중: '분석 중… (LLM)' },
          '① 분석만 (검수)',
        ),
      )
      expect(눌린것, '눌린 단추가 안 잠겼다').toMatch(/\sdisabled=/)
      expect(눌린것, '눌린 단추에 도는중 글자가 없다').toContain('분석 중… (LLM)')

      // 안 눌린 쪽 — 같은 폼이라 함께 잠기되, 글자는 제 것 그대로다.
      const 안눌린것 = renderToStaticMarkup(
        createElement(
          글자는_따로(도는중_보내기),
          { 표식: 'turn', 도는중: '한 턴 도는 중… (LLM 2회)' },
          '한 턴 돌리기 (①②③)',
        ),
      )
      expect(안눌린것, '안 눌린 단추가 안 잠겼다 — 누르면 409 다').toMatch(/\sdisabled=/)
      expect(안눌린것, '안 눌린 단추가 제 일이 아닌 것을 말한다').not.toContain('한 턴 도는 중')
      expect(안눌린것).toContain('한 턴 돌리기 (①②③)')
    } finally {
      vi.doUnmock('react-dom')
      vi.resetModules()
    }
  })

  it('⭐ 회차 상세 머리에 모델과 **강도**가 함께 적힌다 (E-1)', () => {
    // 모델만 있으면 「무엇으로 돌렸나」가 반쪽이다 — 같은 모델을 강도만 바꿔 돌린 회차 둘이
    // 화면에서 똑같아 보인다. 회차끼리 견주는 것이 이 도구의 존재 이유다.
    const 본문 = 읽기('app/(admin)/runs/[run_id]/page.tsx')
    for (const 칸 of ['analysis_model', 'analysis_effort', 'character_model', 'character_effort']) {
      expect(본문, `상세 머리에 ${칸} 이 없다`).toMatch(new RegExp(`\\['${칸}', run\\.${칸}\\]`))
    }
  })

  it('🔴 **렌더된** LLM 칸의 `name` 과 액션이 읽는 이름이 맞는다 (죽은 그물이던 자리)', () => {
    // `ui.tsx` 의 `LLM칸` 은 칸 이름을 **템플릿 문자열**로 짓는다 (`name={`${이름}_model`}`).
    // 그래서 글자만 훑는 아래 검사(`name="…"`)는 이 넷을 **하나도 안 본다** — 2026-08-13 에
    // `name` 을 일부러 깨뜨려 봤더니 54건이 전부 초록이었다. 브라우저에서는 모델 선택이
    // 통째로 무시되고 **모든 회차가 바닥값으로 떨어지는** 고장인데 아무도 안 잡았다.
    //
    // ⭐ 그래서 여기서는 **JSX 를 실제로 그려** 나온 `name` 을 읽는다. DB 왕복 검사도 이 자리를
    //    못 본다 — 거기서는 `폼짓기()` 가 FormData 를 손으로 지어 JSX 를 한 번도 안 거친다.
    const 액션 = 읽기('app/(admin)/runs/actions.ts')

    for (const 이름 of ['analysis', 'character'] as const) {
      const 그린것 = renderToStaticMarkup(
        createElement(LLM칸, {
          제목: '검사',
          이름,
          모델들: ['gemini-3.5-flash-lite'],
          기본_모델: 'gemini-3.5-flash-lite',
          강도들: 고를_수_있는_강도,
          기본_강도: 'low',
        }),
      )
      const 폼칸 = new Set([...그린것.matchAll(/name="([^"]+)"/g)].map((하나) => 하나[1]))
      expect(폼칸, `${이름} 칸의 name 이 달라졌다`).toEqual(
        new Set([`${이름}_model`, `${이름}_effort`]),
      )
      for (const 칸 of 폼칸) {
        expect(액션, `${칸} 를 읽는 곳이 없다`).toMatch(new RegExp(`칸\\(폼, '${칸}'\\)`))
      }
    }

    // 그려지기만 하고 회차 시작 폼에 안 붙어 있으면 뜻이 없다.
    const 화면 = 읽기('app/(admin)/runs/page.tsx')
    expect(화면.match(/<LLM칸/g)?.length, '회차 시작 폼에 LLM칸 두 벌이 없다').toBe(2)
    expect(화면).toMatch(/이름="analysis"/)
    expect(화면).toMatch(/이름="character"/)
  })

  it('⭐ 폼 칸 이름과 액션이 읽는 이름이 맞는다 — 어긋나면 단추가 조용히 안 먹는다', () => {
    const 액션 = 읽기('app/(admin)/runs/actions.ts')
    const 화면 = 읽기('app/(admin)/runs/page.tsx') + 읽기('app/(admin)/runs/[run_id]/page.tsx')

    const 폼칸 = new Set([...화면.matchAll(/name="([a-z_]+)"/g)].map((하나) => 하나[1]))
    // 발화 입력칸이 없으면 회차를 돌릴 수 없다 (파이썬 #1 의 뒤쪽 두 줄).
    expect(폼칸.has('child_utterance')).toBe(true)

    for (const 이름 of 폼칸) {
      // `칸(폼, '이름')` 또는 `폼.get('이름')` 또는 `폼.getAll('이름')` 중 하나로 읽어야 한다.
      expect(액션, `${이름} 를 읽는 곳이 없다`).toMatch(
        new RegExp(`(칸\\(폼, '${이름}'\\)|폼\\.get(All)?\\('${이름}'\\))`),
      )
    }
  })
})
