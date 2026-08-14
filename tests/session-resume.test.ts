// 끊긴 턴 이어하기 — 명세 8절 수용 기준 여섯 (`docs/대화턴_이어하기_명세.md` · 이슈 #2).
//
// **여기 여섯이 다 초록이면 이 이슈는 끝난 것이다.** 기준 문장을 그대로 검사 이름에 옮겼다.
//
// ## 어느 층을 두드리나
//
// 아이 앱 계약이 HTTP 코드·봉투로 적혀 있으므로 **라우트 핸들러**를 직접 부른다
// (`tests/routes.db.test.ts` 와 같은 방식 — `getDb()` 자리에 검사 트랜잭션을 꽂아 되돌린다).
// 예외는 기준 4 다: 아이 앱의 새 발화 엔드포인트(`POST /api/sessions/{id}/turns`)가 별도
// 이슈라 아직 없어, 그 자리가 재사용할 문지기(`analysisStep()`)와 봉투 매핑으로 잰다.
//
// ## LLM 은 SDK 자리에서 가짜로 바꾼다 (`tests/service.test.ts` 와 같은 가짜)
//
// 기준 6 의 「LLM 호출 없음」은 SDK 자리에서 세야 진짜로 센 것이다.

import { randomUUID } from 'node:crypto'

import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { characters, stories, story_scenes } from '@/llm/db/schema'

// ⚠️ 팩토리 안에서 바깥 변수를 참조하면 hoisting 에 걸린다 (`routes.db.test.ts` 와 같은 상자).
const 상자 = vi.hoisted(() => ({ tx: null as unknown }))

vi.mock('@/llm/repo/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/llm/repo/db')>()
  return {
    ...real,
    // 검사가 트랜잭션을 꽂아 두면 그것을, 아니면 진짜 연결을 준다.
    getDb: () => 상자.tx ?? real.getDb(),
  }
})

import { POST as 이어하기_라우트 } from '@/app/api/sessions/[session_id]/turns/resume/route'
import { closeDb, getDb, type Conn } from '@/llm/repo/db'
import { readSession, sceneMessages } from '@/llm/repo/sessions'
import { readTurnCondition } from '@/llm/repo/turn-conditions'
import { advanceRun, pendingTurn, startRun, submitTurn, TurnIncomplete } from '@/llm/service/run'
import { analysisStep, decisionStep } from '@/llm/service/step'
import { TurnFailed } from '@/llm/service/turn'
import { 옮긴다 } from '@/session/controller/envelope'

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
    `\n[session-resume.test] Postgres 에 못 붙어 이어하기 검사를 건너뛴다 (도커가 꺼져 있나?)\n` +
      `                      ${못붙는_이유}\n\n`,
  )
}
const 검사 = 못붙는_이유 === null ? describe : describe.skip

afterAll(async () => {
  상자.tx = null
  await closeDb()
})

class 되돌림 extends Error {}

/** 트랜잭션을 열어 `getDb()` 자리에 꽂고, 본문이 끝나면 **무조건 되돌린다.** */
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

// ── 가짜 제미나이 (`tests/service.test.ts` 와 같은 자리·같은 방식) ─────────

interface 가짜_설정 {
  /** 이번 분석이 찾아냈다고 할 요소들. 기본은 **그 장면의 목표 전부**. */
  요소들?: (턴: number, 목표: string[]) => string[]
  분석_실패?: boolean
  대사_실패?: boolean
}

interface 가짜_기록 {
  호출: { 용도: '분석' | '대사' }[]
  설정: 가짜_설정
}

function 뽑기(user: string, 열쇠: string): string {
  const 맞은것 = new RegExp(`"${열쇠}":"((?:[^"\\\\]|\\\\.)*)"`).exec(user)
  return 맞은것 === null ? '' : (JSON.parse(`"${맞은것[1]}"`) as string)
}

function 목표_뽑기(user: string): string[] {
  const 맞은것 = /"target_elements":\[([^\]]*)\]/.exec(user)
  if (맞은것 === null || 맞은것[1].trim() === '') return []
  return JSON.parse(`[${맞은것[1]}]`) as string[]
}

/** SDK 자리에 가짜를 꽂는다. 분석과 대사는 `response_format` 유무로 가른다. */
function 가짜_제미나이(설정: 가짜_설정 = {}): 가짜_기록 {
  const 기록: 가짜_기록 = { 호출: [], 설정 }

  installFakeSdk('gemini', () => ({
    interactions: {
      create: async (요청: Record<string, unknown>) => {
        const user = String(요청.input ?? '')
        const 분석인가 = 요청.response_format !== undefined
        기록.호출.push({ 용도: 분석인가 ? '분석' : '대사' })

        if (분석인가) {
          if (기록.설정.분석_실패) throw new Error('APIError: 분석 500')
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
              utterance_validity: 'VALID',
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

beforeEach(() => {
  // 로그 줄이 검사 출력을 덮지 않게. 로그 자체는 service.test.ts 가 잰다.
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

// ── 검사용 콘텐츠 (`tests/service.test.ts` 의 다섯 장면과 같은 모양) ───────

const 닫는_말 = '네 말을 들으니 마음이 놓이는구나.'

interface 씨앗 {
  story_id: string
  story_code: string
  scene_ids: Record<string, string>
}

async function 콘텐츠_넣기(tx: Conn): Promise<씨앗> {
  const 꼬리 = randomUUID().slice(0, 8)
  const story_code = `s_ssn_${꼬리}`

  const [이야기] = await tx
    .insert(stories)
    .values({
      slug: story_code,
      title: `이어하기 검사용 ${꼬리}`,
      summary: '검사용',
      difficulty: '보통',
      status: 'draft',
    })
    .returning({ id: stories.id })

  const [캐릭터] = await tx
    .insert(characters)
    .values({
      story_id: 이야기.id,
      code: 'ch_ssn_daughter_in_law',
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
    character_closing: 닫는_말,
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
      { story_id: 이야기.id, code: 'sc_ssn_01', scene_order: 1, scene_description: '전개 1' },
      { story_id: 이야기.id, code: 'sc_ssn_02', scene_order: 2, conflict: '갈등', ...대화칸 },
      { story_id: 이야기.id, code: 'sc_ssn_03', scene_order: 3, scene_description: '전개 3' },
    ])
    .returning({ id: story_scenes.id, code: story_scenes.code })

  const scene_ids: Record<string, string> = {}
  for (const 행 of 넣은_장면들) scene_ids[행.code] = 행.id
  return { story_id: 이야기.id, story_code, scene_ids }
}

/** 회차를 열고 첫 대화 장면 앞까지 전개를 재생해 둔다. */
async function 회차_준비(tx: Conn): Promise<{ 씨: 씨앗; run_id: string; session_id: string }> {
  const 씨 = await 콘텐츠_넣기(tx)
  const { run } = await startRun(tx, { story_code: 씨.story_code, started_by: '검사' })
  const 할_일 = await advanceRun(tx, run.id)
  expect(할_일.kind).toBe('발화받기')
  return { 씨, run_id: run.id, session_id: run.session_id }
}

// ── 라우트를 아이 앱처럼 부른다 ────────────────────────────────────────────

interface 봉투 {
  ok: boolean
  data?: {
    resumed_from: string
    child: { message_id: string; text: string }
    dialogue: { message_id: string; text: string; source: string }
    next: { kind: string; scene_id: string }
  }
  error?: {
    code: string
    message: string
    retryable: boolean
    pending?: { message_id: string; stage: string }
  }
}

/** `POST /api/sessions/{session_id}/turns/resume` — body 없음 (명세 4.2절). */
async function 이어하기(session_id: string): Promise<{ status: number; 본문: 봉투 }> {
  const 응답 = await 이어하기_라우트(
    new Request(`http://검사.local/api/sessions/${session_id}/turns/resume`, { method: 'POST' }),
    { params: Promise.resolve({ session_id }) },
  )
  return { status: 응답.status, 본문: (await 응답.json()) as 봉투 }
}

// ═══════════════════════════════════════════════════════════════════════════
// 명세 8절 — 수용 기준 여섯
// ═══════════════════════════════════════════════════════════════════════════

검사('세션 이어하기 — 명세 8절 수용 기준', () => {
  it('1. 캐릭터 단계 강제 실패 뒤 resume → 200 · resumed_from=character · 턴 카운트·turn_conditions 불변 · 대사 행이 생긴다', async () => {
    const 기록 = 가짜_제미나이({
      대사_실패: true,
      // 첫 턴이 목표를 다 못 채우게 — CLOSING 이 아니라 **생성 대사** 자리에서 죽인다.
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

      // 박제된 판정과 턴 카운트를 붙잡아 둔다 — resume 이 건드리면 안 되는 값들이다.
      const 조건_앞 = await readTurnCondition(tx, 실패.child_message_id)
      expect(조건_앞).not.toBeNull()
      expect((await readSession(tx, session_id)).current_child_turn_count).toBe(1)
      const 분석_호출 = 기록.호출.filter((하나) => 하나.용도 === '분석').length

      기록.설정.대사_실패 = false
      const { status, 본문 } = await 이어하기(session_id)

      expect(status).toBe(200)
      expect(본문.ok).toBe(true)
      expect(본문.data?.resumed_from).toBe('character')
      expect(본문.data?.child).toEqual({
        message_id: 실패.child_message_id,
        text: '며느리가 창피했을 것 같아',
      })
      expect(본문.data?.dialogue.source).toBe('generated')
      expect(본문.data?.next).toEqual({ kind: '발화받기', scene_id: 씨.scene_ids.sc_ssn_02 })

      // 턴 카운트와 turn_conditions 불변 — 재판정하지 않았다는 증거다 (명세 5절 2·6).
      expect((await readSession(tx, session_id)).current_child_turn_count).toBe(1)
      expect(await readTurnCondition(tx, 실패.child_message_id)).toEqual(조건_앞)
      // 분석 LLM 도 다시 부르지 않았다 — 죽은 단계(character)부터다.
      expect(기록.호출.filter((하나) => 하나.용도 === '분석')).toHaveLength(분석_호출)

      // 캐릭터 대사 행이 생겼다 (여는 말 · 아이 · 대사).
      const 대화 = await sceneMessages(tx, { session_id, scene_id: 씨.scene_ids.sc_ssn_02 })
      expect(대화.map((행) => 행.speaker_type)).toEqual(['character', 'child', 'character'])
      expect(대화[2].text).toBe(본문.data?.dialogue.text)
      expect(await pendingTurn(tx, { session_id })).toBeNull()
    })
  })

  it('2. 분석 단계 강제 실패 뒤 resume → 아이 messages 행 수 불변(재사용) · 분석~대사 완주', async () => {
    const 기록 = 가짜_제미나이({
      분석_실패: true,
      요소들: (턴, 목표) => (턴 === 1 ? [목표[0]] : 목표),
    })

    await 트랜잭션(async (tx) => {
      const { 씨, run_id, session_id } = await 회차_준비(tx)

      await expect(
        submitTurn({ run_id, child_utterance: '며느리가 불쌍해', conn: tx }),
      ).rejects.toThrow(TurnFailed)
      const 미완 = await pendingTurn(tx, { session_id })
      expect(미완?.stage).toBe('analysis')

      기록.설정.분석_실패 = false
      const { status, 본문 } = await 이어하기(session_id)

      expect(status).toBe(200)
      expect(본문.data?.resumed_from).toBe('analysis')
      expect(본문.data?.child).toEqual({ message_id: 미완!.message_id, text: '며느리가 불쌍해' })
      expect(본문.data?.dialogue.source).toBe('generated')

      // 아이 행은 저장된 그 행을 재사용했다 — 하나뿐이고 턴 수도 1 이다 (명세 5절 1).
      const 대화 = await sceneMessages(tx, { session_id, scene_id: 씨.scene_ids.sc_ssn_02 })
      expect(대화.filter((행) => 행.speaker_type === 'child')).toHaveLength(1)
      expect((await readSession(tx, session_id)).current_child_turn_count).toBe(1)
      // 분석~대사가 완주해 미완이 사라졌다.
      expect(await readTurnCondition(tx, 미완!.message_id)).not.toBeNull()
      expect(await pendingTurn(tx, { session_id })).toBeNull()
    })
  })

  it('3. 미완 턴 없이 resume → 409 TURN_NOT_ALLOWED', async () => {
    await 트랜잭션(async (tx) => {
      const { session_id } = await 회차_준비(tx)

      const { status, 본문 } = await 이어하기(session_id)

      expect(status).toBe(409)
      expect(본문.ok).toBe(false)
      expect(본문.error?.code).toBe('TURN_NOT_ALLOWED')
      expect(본문.error?.retryable).toBe(false)
    })
  })

  it('4. 미완 턴이 있는 세션에 새 발화 → 409 TURN_INCOMPLETE + pending 정보', async () => {
    // ⚠️ 아이 앱의 새 발화 엔드포인트(`POST /api/sessions/{id}/turns`)는 별도 이슈라 아직
    //    없다. 그 자리가 재사용할 문지기(`analysisStep()` — 킥오프 2절)가 `TurnIncomplete`
    //    를 던지고, 아이 앱 봉투가 409 `TURN_INCOMPLETE` + `pending` 으로 옮기는 것까지 잰다.
    가짜_제미나이({ 대사_실패: true, 요소들: (턴, 목표) => (턴 === 1 ? [목표[0]] : 목표) })

    await 트랜잭션(async (tx) => {
      const { run_id, session_id } = await 회차_준비(tx)
      await submitTurn({ run_id, child_utterance: '며느리가 불쌍해', conn: tx }).catch(() => null)
      const 미완 = await pendingTurn(tx, { session_id })
      expect(미완?.stage).toBe('character')

      const 오류 = await analysisStep({ session_id, child_utterance: '다른 말', conn: tx }).then(
        () => null,
        (e: unknown) => e,
      )
      expect(오류).toBeInstanceOf(TurnIncomplete)
      expect((오류 as TurnIncomplete).pending).toEqual(미완)

      const 옮긴 = 옮긴다(오류)
      expect(옮긴.status).toBe(409)
      expect(옮긴.error.code).toBe('TURN_INCOMPLETE')
      expect(옮긴.error.retryable).toBe(false)
      expect(옮긴.error.pending).toEqual({ message_id: 미완!.message_id, stage: 'character' })

      // 한 턴을 통째로 도는 길(`submitTurn()`)의 문지기도 같은 예외다.
      await expect(
        submitTurn({ run_id, child_utterance: '다른 말', conn: tx }),
      ).rejects.toThrow(TurnIncomplete)
    })
  })

  it('5. resume 성공 직후 resume 한 번 더 → 409 (반복 안전의 정의)', async () => {
    const 기록 = 가짜_제미나이({
      대사_실패: true,
      요소들: (턴, 목표) => (턴 === 1 ? [목표[0]] : 목표),
    })

    await 트랜잭션(async (tx) => {
      const { run_id, session_id } = await 회차_준비(tx)
      await submitTurn({ run_id, child_utterance: '며느리가 불쌍해', conn: tx }).catch(() => null)

      기록.설정.대사_실패 = false
      expect((await 이어하기(session_id)).status).toBe(200)

      const 두번째 = await 이어하기(session_id)
      expect(두번째.status).toBe(409)
      expect(두번째.본문.error?.code).toBe('TURN_NOT_ALLOWED')
    })
  })

  it('6. CLOSING 판정이 박제된 턴을 resume → source=fixed · LLM 호출 없음 · next.kind=장면끝', async () => {
    // 기본 가짜는 목표를 다 찾아내므로 2턴째(= preferred_turns) 판정이 CLOSING 이다.
    const 기록 = 가짜_제미나이()

    await 트랜잭션(async (tx) => {
      const { 씨, run_id, session_id } = await 회차_준비(tx)
      await submitTurn({ run_id, child_utterance: '첫 마디', conn: tx })

      // 2턴을 ①분석 ②판단까지만 돌리고 멈춘다 — ③ 직전에 서버가 죽은 자리다.
      const 분석단계 = await analysisStep({ session_id, child_utterance: '둘째 마디', conn: tx })
      const 판단 = await decisionStep({
        session_id,
        message_id: 분석단계.data.message_id,
        analysis: {
          child_intent: 분석단계.data.analysis.child_intent,
          detected_elements: 분석단계.data.detected_elements_kept,
          utterance_validity: 분석단계.data.analysis.utterance_validity,
        },
        conn: tx,
      })
      expect(판단.data.decision.response_mode).toBe('CLOSING')
      expect(await pendingTurn(tx, { session_id })).toEqual({
        message_id: 분석단계.data.message_id,
        stage: 'character',
      })

      const 호출_앞 = 기록.호출.length
      const { status, 본문 } = await 이어하기(session_id)

      expect(status).toBe(200)
      expect(본문.data?.resumed_from).toBe('character')
      // 캐릭터 LLM 을 부르지 않았다 — 고정 닫는 말 그대로다 (명세 5절 4 · FR-016).
      expect(기록.호출.length).toBe(호출_앞)
      expect(본문.data?.dialogue.source).toBe('fixed')
      expect(본문.data?.dialogue.text).toBe(닫는_말)
      expect(본문.data?.next).toEqual({ kind: '장면끝', scene_id: 씨.scene_ids.sc_ssn_02 })
      expect(await pendingTurn(tx, { session_id })).toBeNull()
    })
  })

  it('없는 세션은 404 SESSION_NOT_FOUND 다 (명세 4.2절 표)', async () => {
    await 트랜잭션(async () => {
      const { status, 본문 } = await 이어하기(randomUUID())
      expect(status).toBe(404)
      expect(본문.error?.code).toBe('SESSION_NOT_FOUND')
    })
  })
})
