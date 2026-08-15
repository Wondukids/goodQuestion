// 말하기 후 활동 API 넷 — 이슈 #45 의 「끝났다」 조건 (`docs/말하기후활동_명세.md` 9절 수용 기준).
//
// **여기가 다 초록이면 이 이슈는 끝난 것이다.** 기준 문장을 그대로 검사 이름에 옮겼다.
//
// 재는 것은 3·4·5·6·10·11·12·14 와 그 짝인 문지기·반복 안전이다.
// 판정 규칙 자체(6·7·8·9)는 `tests/post-activity-judge.test.ts` 가 이미 잰다 — 여기서는
// **그 판정이 표에 어떻게 앉는가**만 본다.
//
// ## 어느 층을 두드리나
//
// 아이 앱 계약이 HTTP 코드·봉투로 적혀 있으므로 **라우트 핸들러**를 직접 부른다
// (`tests/mission-api.test.ts` 와 같은 방식 — `getDb()` 자리에 검사 트랜잭션을 꽂아 되돌린다).
//
// ## 🔴 LLM 을 진짜로 부르지 않는다 (두 가지 방식으로)
//
// - **수용 5·6** — 단어 12개가 **전부 글자로 찾히는** 줄거리를 넣는다. 그러면 판정 엔진이
//   ①에서 끝내고 **LLM 을 아예 안 부른다** (명세 6.3). 만약 부르려 들면 `tests/setup.ts` 의
//   SDK 그물이 터뜨려 `analyzed: false` 가 되므로, 이 검사가 초록인 것 자체가
//   「LLM 호출 없이」의 증거다 (수용 기준 6 의 괄호).
// - **수용 10** — 공급자를 일부러 죽여 둔다 (`report-api.test.ts` 의 같은 수).
//
// ## ⛔ 미션 1·2 와 아무 관계가 없다 (명세 3절)
//
// 이름이 다 「미니게임」으로 묶여 보여도 다른 활동이다. 그쪽은 `tests/mission-api.test.ts` 다.

import { randomUUID } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

import {
  characters,
  parent_reports,
  post_activity_keywords,
  post_activity_results,
  stories,
  story_scenes,
  story_sessions,
} from '@/llm/db/schema'
import { 후활동_config } from '@/llm/db/seed'

// ⚠️ 팩토리 안에서 바깥 변수를 참조하면 hoisting 에 걸린다 (`mission-api.test.ts` 와 같은 상자).
const 상자 = vi.hoisted(() => ({ tx: null as unknown }))

vi.mock('@/llm/repo/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/llm/repo/db')>()
  return { ...real, getDb: () => 상자.tx ?? real.getDb() }
})

// 받아쓰기를 바이트 → UTF-8 로 흉내 낸다 (`mission-api.test.ts` 와 같은 가짜).
vi.mock('@/stt/server', () => ({
  SttError: class SttError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly detail?: string,
    ) {
      super(message)
    }
  },
  recognizeSpeech: async (audio: Buffer) => audio.toString('utf-8'),
}))

import { GET as 열기_라우트 } from '@/app/api/sessions/[session_id]/post-activity/route'
import { POST as 순서_라우트 } from '@/app/api/sessions/[session_id]/post-activity/order/route'
import { POST as 줄거리_라우트 } from '@/app/api/sessions/[session_id]/post-activity/retelling/route'
import { POST as 종료_라우트 } from '@/app/api/sessions/[session_id]/post-activity/complete/route'
import { closeDb, getDb, type Conn } from '@/llm/repo/db'
import { createSession } from '@/llm/repo/sessions'
import type { RetellingCall } from '@/post-activity'
import { queueReport, __testing } from '@/report/service/generate'
import { submitPostActivityRetelling } from '@/session/service/post-activity'

import { installFakeSdk } from './support/sdk-gate'

// ── DB 가 있나 (post-activity-schema.test.ts 와 같은 문지기) ────────────────

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
    `\n[post-activity-api.test] Postgres 에 못 붙어 후활동 API 검사를 건너뛴다 (도커가 꺼져 있나?)\n` +
      `                        ${못붙는_이유}\n\n`,
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

// ── 씨앗 — 끝난 세션 하나 ──────────────────────────────────────────────────

interface 씨앗 {
  session_id: string
  child_id: string
}

/**
 * 이야기 → 캐릭터 → 장면 → **끝난 세션** 하나. 리포트 재료가 되도록 장면까지 세운다.
 *
 * ⚠️ `status: 'completed'` 로 시작한다 — 후활동은 **이미 끝난 세션**에 붙는 활동이다 (F10).
 */
async function 끝난_세션(
  tx: Conn,
  options: { 후활동?: boolean } = {},
): Promise<씨앗> {
  const 꼬리 = randomUUID().slice(0, 8)
  const child_id = randomUUID()

  const [이야기] = await tx
    .insert(stories)
    .values({
      slug: `s-pa-api-${꼬리}`,
      title: '방귀 뀌는 며느리',
      summary: '큰 방귀를 부끄러워하던 며느리가 자신의 다름을 장점으로 바꾸는 이야기',
      difficulty: '보통',
      status: 'draft',
      post_activity_config: options.후활동 === false ? null : 후활동_config,
    })
    .returning({ id: stories.id })

  const [캐릭터] = await tx
    .insert(characters)
    .values({
      story_id: 이야기.id,
      code: `ch_pa_${꼬리}`,
      name: '며느리',
      persona: '시집온 지 얼마 안 된 며느리',
      speech_style: '옛이야기 말투',
      guidance_style: '자기 걱정을 소리 내어 말한다',
      forbidden: ['설명하지 않는다'],
    })
    .returning({ id: characters.id })

  const [장면] = await tx
    .insert(story_scenes)
    .values({
      story_id: 이야기.id,
      code: `sc_pa_${꼬리}`,
      scene_order: 1,
      conflict: '갈등',
      character_id: 캐릭터.id,
      character_name: '며느리',
      character_opening: '아이고… 나 때문에 다들 놀랐지 뭐야.',
      character_closing: '네 말을 들으니 마음이 놓이는구나.',
      scene_stance: '아직 참고 있다',
      scene_goal: '아이가 며느리의 처지를 헤아리게 한다',
      required_elements: ['EMPATHY'],
      preferred_turns: 2,
      max_turns: 4,
    })
    .returning({ id: story_scenes.id })

  const session_id = await createSession(tx, { story_id: 이야기.id, child_id })
  await tx
    .update(story_sessions)
    .set({ current_scene_id: 장면.id, status: 'completed', completed_at: sql`now()` })
    .where(eq(story_sessions.id, session_id))

  return { session_id, child_id }
}

// ── 라우트를 두드리는 손잡이 ───────────────────────────────────────────────

function 경로(session_id: string) {
  return { params: Promise.resolve({ session_id }) }
}

// 🔴 **응답 모양을 서비스 타입에서 안 빌려 온다.** 여기서 재는 것은 명세 5절이 글자까지
//    적어 둔 **선 위의 계약**이라, 서비스 타입이 바뀌면 검사가 조용히 따라가면 안 된다.
interface 오류봉투 {
  code: string
  message: string
  retryable: boolean
}

interface 열기응답 {
  config: typeof 후활동_config
  result: {
    submitted_order: string[] | null
    is_order_correct: boolean | null
    attempt_count: number
    retelling_text: string | null
    completed_at: string | null
  }
}
interface 순서응답 {
  is_correct: boolean
  attempt_count: number
}
interface 줄거리응답 {
  empty?: true
  text?: string
  analyzed?: boolean
  keywords?: { card_id: string; word: string; status: string; evidence: string | null }[] | null
}
interface 종료응답 {
  report: 'queued' | 'exists'
}

async function 봉투<T>(
  응답: Response,
): Promise<{ status: number; ok: boolean; data: T; error: 오류봉투 }> {
  const 몸 = (await 응답.json()) as { ok: boolean; data: T; error: 오류봉투 }
  return { status: 응답.status, ok: 몸.ok, data: 몸.data, error: 몸.error }
}

const 주소 = 'http://검사/api/sessions'

async function 열기(session_id: string) {
  return 봉투<열기응답>(
    await 열기_라우트(new Request(`${주소}/${session_id}/post-activity`), 경로(session_id)),
  )
}

async function 순서(session_id: string, submitted_order: readonly string[]) {
  const 요청 = new Request(`${주소}/${session_id}/post-activity/order`, {
    method: 'POST',
    body: JSON.stringify({ submitted_order }),
  })
  return 봉투<순서응답>(await 순서_라우트(요청, 경로(session_id)))
}

/** 녹음은 **본문에 그대로** 싣는다 (`x-audio-channels` 헤더) — 대화 턴 API 와 같은 모양. */
async function 줄거리(session_id: string, 말: string) {
  const 요청 = new Request(`${주소}/${session_id}/post-activity/retelling`, {
    method: 'POST',
    body: Buffer.from(말, 'utf-8'),
    headers: { 'x-audio-channels': '1' },
  })
  return 봉투<줄거리응답>(await 줄거리_라우트(요청, 경로(session_id)))
}

async function 종료(session_id: string, reason: 'finished' | 'left') {
  const 요청 = new Request(`${주소}/${session_id}/post-activity/complete`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  })
  const 답 = await 봉투<종료응답>(await 종료_라우트(요청, 경로(session_id)))
  // 리포트는 뒤에서 도는 작업이라 검사만 기다린다 (`__testing` 머리말).
  await __testing.마지막작업
  return 답
}

// ── 읽기 손잡이 ────────────────────────────────────────────────────────────

async function 결과행(tx: Conn, session_id: string) {
  const 행들 = await tx
    .select()
    .from(post_activity_results)
    .where(eq(post_activity_results.session_id, session_id))
  return 행들.length === 0 ? null : 행들[0]
}

async function 단어행들(tx: Conn, result_id: string) {
  return tx
    .select()
    .from(post_activity_keywords)
    .where(eq(post_activity_keywords.result_id, result_id))
}

async function 리포트_수(tx: Conn, session_id: string): Promise<number> {
  const 행들 = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(parent_reports)
    .where(eq(parent_reports.session_id, session_id))
  return 행들[0].n
}

/** 공급자를 죽여 둔다 — 뒤에서 도는 생성·판정에는 `call` 을 꽂을 자리가 없다. */
function 공급자를_죽인다(): void {
  installFakeSdk('gemini', () => ({
    interactions: {
      create: async () => {
        throw new Error('가짜: 공급자가 죽었다')
      },
    },
  }))
}

const 정답순서 = 후활동_config.answer_order

/**
 * 단어 12개가 **전부 글자로 찾히는** 줄거리. ①규칙이 다 끝내므로 LLM 이 안 불린다.
 *
 * 🔴 「참다」는 두 글자라 어간을 못 떼고 **글자 그대로** 있어야 찾힌다 (F14 · `후활동_조각_바닥`).
 */
const 다_말한_줄거리 =
  '며느리가 시집을 와서 방귀를 참다가 걱정이 되었어요. ' +
  '깜짝 놀랄 만큼 큰 방귀가 나와서 기둥이 흔들렸어요. ' +
  '배나무 앞에서 힘껏 방귀를 뀌니 배가 우수수 떨어졌어요. ' +
  '마을 사람들이 칭찬을 하고 고마워했고 며느리는 당당하게 웃었어요.'

// ═══════════════════════════════════════════════════════════════════════════

검사('말하기 후 활동 API (명세 5절 A~D) × 진짜 DB', () => {
  // ── 문지기 셋 (명세 5.E) ────────────────────────────────────────────────

  it('세션 id 가 uuid 가 아니면 404 SESSION_NOT_FOUND', async () => {
    const 답 = await 열기('그런거없음')
    expect(답.status).toBe(404)
    expect(답.error.code).toBe('SESSION_NOT_FOUND')
  })

  it('없는 세션이면 404 SESSION_NOT_FOUND', async () => {
    await 트랜잭션(async () => {
      const 답 = await 열기(randomUUID())
      expect(답.status).toBe(404)
      expect(답.error.code).toBe('SESSION_NOT_FOUND')
    })
  })

  it('후활동 설정이 없는 이야기면 404 POST_ACTIVITY_NOT_CONFIGURED', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 끝난_세션(tx, { 후활동: false })
      const 답 = await 열기(씨앗.session_id)
      expect(답.status).toBe(404)
      expect(답.error.code).toBe('POST_ACTIVITY_NOT_CONFIGURED')
    })
  })

  it('이야기가 아직 안 끝났으면 409 POST_ACTIVITY_NOT_ALLOWED — 표에 아무것도 안 남는다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 끝난_세션(tx)
      await tx
        .update(story_sessions)
        .set({ status: 'in_progress', completed_at: null })
        .where(eq(story_sessions.id, 씨앗.session_id))

      for (const 답 of [
        await 열기(씨앗.session_id),
        await 순서(씨앗.session_id, 정답순서),
        await 줄거리(씨앗.session_id, 다_말한_줄거리),
        await 종료(씨앗.session_id, 'finished'),
      ]) {
        expect(답.status).toBe(409)
        expect(답.error.code).toBe('POST_ACTIVITY_NOT_ALLOWED')
      }
      expect(await 결과행(tx, 씨앗.session_id)).toBeNull()
      expect(await 리포트_수(tx, 씨앗.session_id)).toBe(0)
    })
  })

  // ── A. 활동 열기 (명세 5.A) ─────────────────────────────────────────────

  it('A — 활동을 열면 DB 의 config 와 빈 result 가 온다 (수용 2)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 끝난_세션(tx)
      const 답 = await 열기(씨앗.session_id)

      expect(답.status).toBe(200)
      expect(답.ok).toBe(true)
      // 🔴 화면 상수가 아니라 **DB 값**이다 — config 를 고치면 화면이 바뀐다 (F1).
      expect(답.data.config).toEqual(후활동_config)
      expect(답.data.result).toEqual({
        submitted_order: null,
        is_order_correct: null,
        attempt_count: 0,
        retelling_text: null,
        completed_at: null,
      })
    })
  })

  // ── B. 순서 제출 (명세 5.B · 수용 3·4) ──────────────────────────────────

  it('수용 3 — 두 번 틀리고 세 번째에 맞추면 첫 순서가 남고 attempt_count=3 · is_order_correct=true', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 끝난_세션(tx)
      const 첫_틀린_순서 = ['pear', 'endure', 'burst', 'pride']
      const 둘째_틀린_순서 = ['burst', 'endure', 'pear', 'pride']

      const 첫판 = await 순서(씨앗.session_id, 첫_틀린_순서)
      expect(첫판.data).toEqual({ is_correct: false, attempt_count: 1 })

      const 둘째판 = await 순서(씨앗.session_id, 둘째_틀린_순서)
      expect(둘째판.data).toEqual({ is_correct: false, attempt_count: 2 })

      const 셋째판 = await 순서(씨앗.session_id, 정답순서)
      expect(셋째판.data).toEqual({ is_correct: true, attempt_count: 3 })

      const 행 = await 결과행(tx, 씨앗.session_id)
      // 🔴 **첫 번째** 순서다 — 두 번째·세 번째가 안 덮었다 (F7).
      expect(행?.submitted_order).toEqual(첫_틀린_순서)
      expect(행?.attempt_count).toBe(3)
      // 🔴 「끝내 맞췄나」다 (F18). 「첫 제출이 정답이었나」는 attempt_count = 1 로 안다.
      expect(행?.is_order_correct).toBe(true)

      // 되돌아온 아이가 자기 자리를 되살릴 수 있다 (명세 5.A).
      const 다시열기 = await 열기(씨앗.session_id)
      expect(다시열기.data.result.submitted_order).toEqual(첫_틀린_순서)
      expect(다시열기.data.result.attempt_count).toBe(3)
    })
  })

  it('B — 못 맞추고 나가면 is_order_correct 는 false 로 남는다 (「아직 안 냈다」 NULL 과 갈린다)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 끝난_세션(tx)
      await 순서(씨앗.session_id, ['pear', 'endure', 'burst', 'pride'])
      expect((await 결과행(tx, 씨앗.session_id))?.is_order_correct).toBe(false)
    })
  })

  it('B — 맞춘 뒤에 또 틀려도 is_order_correct 는 안 내려간다 (F18 — 「끝내 맞췄나」)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 끝난_세션(tx)
      await 순서(씨앗.session_id, 정답순서)
      const 나중에_틀림 = await 순서(씨앗.session_id, ['pear', 'endure', 'burst', 'pride'])

      // 이번 회차의 판정은 그대로 `false` 로 답한다 — 화면이 그 회차를 그려야 한다.
      expect(나중에_틀림.data).toEqual({ is_correct: false, attempt_count: 2 })
      // 🔴 표에 남는 것은 「끝내 맞췄나」다. 한 번 참이면 계속 참이다.
      expect((await 결과행(tx, 씨앗.session_id))?.is_order_correct).toBe(true)
    })
  })

  it('B — 앱이 보낸 판정은 받지 않는다. 순열이 아니면 400 이고 표에 안 들어간다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 끝난_세션(tx)

      // 곁가지 칸(`is_correct`)을 실으면 `strictObject` 가 튕긴다 — 판정은 서버가 한다.
      const 곁가지 = new Request(`${주소}/${씨앗.session_id}/post-activity/order`, {
        method: 'POST',
        body: JSON.stringify({ submitted_order: 정답순서, is_correct: true }),
      })
      const 답1 = await 봉투(await 순서_라우트(곁가지, 경로(씨앗.session_id)))
      expect(답1.status).toBe(400)
      expect(답1.error.code).toBe('BAD_REQUEST')

      // 카드 넉 장의 순열이 아니다 (이 갈래가 정한 400 — `submitted_order` 는 못 되돌린다).
      const 답2 = await 순서(씨앗.session_id, ['pear', 'pear', 'burst', 'pride'])
      expect(답2.status).toBe(400)
      expect(답2.error.code).toBe('BAD_REQUEST')

      expect(await 결과행(tx, 씨앗.session_id)).toBeNull()
    })
  })

  it('수용 4 — 순서만 맞추고 닫으면 그 행이 남고 retelling_text 는 NULL 이다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 끝난_세션(tx)
      await 순서(씨앗.session_id, 정답순서)

      const 행 = await 결과행(tx, 씨앗.session_id)
      expect(행).not.toBeNull()
      expect(행?.is_order_correct).toBe(true)
      expect(행?.retelling_text).toBeNull()
      expect(행?.analyzed_at).toBeNull()
      expect(행?.completed_at).toBeNull()
      expect(await 단어행들(tx, 행!.id)).toHaveLength(0)
    })
  })

  // ── C. 줄거리 말하기 (명세 5.C · 수용 5·6·10) ───────────────────────────

  it('수용 5·6 — 줄거리를 말하면 retelling_text 가 차고 단어 12행이 생긴다 (LLM 호출 없이)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 끝난_세션(tx)
      await 순서(씨앗.session_id, 정답순서)

      const 답 = await 줄거리(씨앗.session_id, 다_말한_줄거리)
      expect(답.status).toBe(200)
      expect(답.data.analyzed).toBe(true)
      expect(답.data.text).toBe(다_말한_줄거리)
      expect(답.data.keywords).toHaveLength(12)

      const 행 = await 결과행(tx, 씨앗.session_id)
      expect(행?.retelling_text).toBe(다_말한_줄거리)
      expect(행?.analyzed_at).not.toBeNull()
      expect(행?.analysis_version).toBe('retelling_v1')

      const 단어들 = await 단어행들(tx, 행!.id)
      expect(단어들).toHaveLength(12)
      // 🔴 SDK 그물이 살아 있는 채로 전부 `rule` 이 나왔다 = **LLM 을 한 번도 안 불렀다.**
      expect(단어들.every((것) => 것.decided_by === 'rule')).toBe(true)
      expect(단어들.every((것) => 것.status === 'used')).toBe(true)
      // 카드 넉 장 × 단어 셋이 그대로 앉았다.
      expect(new Set(단어들.map((것) => 것.card_id))).toEqual(
        new Set(후활동_config.cards.map((카드) => 카드.id)),
      )
    })
  })

  it('C — 아무 말도 안 담기면 { empty: true } 고 아무것도 저장하지 않는다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 끝난_세션(tx)
      await 순서(씨앗.session_id, 정답순서)

      const 답 = await 줄거리(씨앗.session_id, '   ')
      expect(답.status).toBe(200)
      expect(답.data).toEqual({ empty: true })
      expect((await 결과행(tx, 씨앗.session_id))?.retelling_text).toBeNull()
    })
  })

  it('C — 녹음이 아예 안 실리면 400 이다 (무음과 다르다)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 끝난_세션(tx)
      const 빈요청 = new Request(`${주소}/${씨앗.session_id}/post-activity/retelling`, {
        method: 'POST',
        body: Buffer.alloc(0),
      })
      const 답 = await 봉투(await 줄거리_라우트(빈요청, 경로(씨앗.session_id)))
      expect(답.status).toBe(400)
      expect(답.error.code).toBe('BAD_REQUEST')
    })
  })

  it('수용 10 — LLM 을 죽여 놓고 돌려도 200 · analyzed:false · 줄거리는 저장 · analyzed_at 은 NULL', async () => {
    await 트랜잭션(async (tx) => {
      공급자를_죽인다()
      const 씨앗 = await 끝난_세션(tx)
      // 글자로 안 찾히는 말이라 ②(LLM)까지 간다 — 그리고 거기서 죽는다.
      const 못알아들을_말 = '음… 며느리 이야기였어요. 재미있었어요.'

      const 답 = await 줄거리(씨앗.session_id, 못알아들을_말)
      expect(답.status).toBe(200)
      expect(답.ok).toBe(true)
      expect(답.data.analyzed).toBe(false)
      expect(답.data.keywords).toBeNull()
      expect(답.data.text).toBe(못알아들을_말)

      const 행 = await 결과행(tx, 씨앗.session_id)
      // 🔴 아이 말은 남았다. 판정만 못 했다.
      expect(행?.retelling_text).toBe(못알아들을_말)
      expect(행?.analyzed_at).toBeNull()
      expect(행?.analysis_version).toBeNull()
      // 반만 판정한 행을 넣지 않는다 — ①이 찾아 둔 것까지 버린다 (명세 4.2).
      expect(await 단어행들(tx, 행!.id)).toHaveLength(0)
    })
  })

  it('C — 판정 LLM 이 답하면 similar·llm 로 앉고, 지어낸 근거는 missing 이 된다 (수용 8·9)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 끝난_세션(tx)
      // 글자로 찾히는 것은 「시집」·「방귀」 둘뿐이다. 나머지 열이 ②로 간다.
      const 말 = '며느리가 시집을 와서 방귀를 꾹 눌렀어요.'

      // 🔴 진짜 API 를 안 친다 — 이음매를 바꿔치기한다 (`RetellingCall` 머리말).
      const 가짜판정: RetellingCall = async () => ({
        text: JSON.stringify({
          words: 후활동_config.cards.flatMap((카드) =>
            카드.keywords.map((단어) => ({
              word: 단어,
              similar: 단어 === '참다' || 단어 === '걱정',
              // 「걱정」의 근거는 원문에 **없는 말**이다 → ③ 대조가 버린다 (수용 9).
              evidence: 단어 === '참다' ? '꾹 눌렀어요' : '아이가 하지도 않은 말',
            })),
          ),
        }),
        // 어느 공급자가 답했다고 적을지는 이 검사와 상관없다 — 실제로는 아무도 안 불렸다.
        provider: 'gemini',
        model: '가짜',
        attempts: [],
      })

      const 답 = await submitPostActivityRetelling({
        session_id: 씨앗.session_id,
        retelling: 말,
        call: 가짜판정,
      })
      expect(답).toMatchObject({ analyzed: true })

      const 행 = await 결과행(tx, 씨앗.session_id)
      const 단어들 = await 단어행들(tx, 행!.id)
      expect(단어들).toHaveLength(12)
      const 찾기 = (단어: string) => 단어들.find((것) => 것.word === 단어)

      // ① 글자로 찾은 것 — `used` · `rule` · 근거 없음
      expect(찾기('시집')).toMatchObject({ status: 'used', decided_by: 'rule', evidence: null })
      // ② 비슷한 말 — `similar` · `llm` · 근거는 **아이 원문에서 떼어 온 조각**
      expect(찾기('참다')).toMatchObject({
        status: 'similar',
        decided_by: 'llm',
        evidence: '꾹 눌렀어요',
      })
      // ③ 지어낸 근거는 버려진다 — `missing` 이고 근거는 NULL 이다 (수용 9 · 명세 4.3)
      expect(찾기('걱정')).toMatchObject({ status: 'missing', decided_by: 'llm', evidence: null })
      // 물어봤는데 「아니다」로 온 것도 행이 남는다 (12개 전부 남는다)
      expect(찾기('우수수')).toMatchObject({ status: 'missing', decided_by: 'llm' })
    })
  })

  it('C — 다시 말하면 지난 판정의 단어 행이 모두 지워지고 다시 들어간다 (명세 4.3)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 끝난_세션(tx)
      await 줄거리(씨앗.session_id, 다_말한_줄거리)
      const 행 = await 결과행(tx, 씨앗.session_id)
      expect(await 단어행들(tx, 행!.id)).toHaveLength(12)

      // 두 번째 녹음은 판정이 죽는다 — 지난 12행이 남아 있으면 안 된다.
      공급자를_죽인다()
      const 다시 = await 줄거리(씨앗.session_id, '음… 잘 기억이 안 나요.')
      expect(다시.data.analyzed).toBe(false)

      const 다시행 = await 결과행(tx, 씨앗.session_id)
      expect(다시행?.retelling_text).toBe('음… 잘 기억이 안 나요.')
      expect(다시행?.analyzed_at).toBeNull()
      expect(await 단어행들(tx, 다시행!.id)).toHaveLength(0)
    })
  })

  // ── D. 활동 종료 (명세 5.D · 수용 11·12·14) ─────────────────────────────

  it('수용 11 — 「마치기」를 누르면 completed_at 이 차고 리포트가 만들어진다', async () => {
    await 트랜잭션(async (tx) => {
      공급자를_죽인다()
      const 씨앗 = await 끝난_세션(tx)
      await 순서(씨앗.session_id, 정답순서)

      const 답 = await 종료(씨앗.session_id, 'finished')
      expect(답.status).toBe(200)
      expect(답.data).toEqual({ report: 'queued' })

      expect((await 결과행(tx, 씨앗.session_id))?.completed_at).not.toBeNull()
      expect(await 리포트_수(tx, 씨앗.session_id)).toBe(1)
      // ⛔ 세션 상태는 안 건드린다 — 이미 `completed` 다 (F10).
      const [세션] = await tx
        .select({ status: story_sessions.status })
        .from(story_sessions)
        .where(eq(story_sessions.id, 씨앗.session_id))
      expect(세션.status).toBe('completed')
    })
  })

  it('수용 12 — 활동을 안 하고 떠나도 리포트가 만들어진다. 결과 행은 안 생긴다', async () => {
    await 트랜잭션(async (tx) => {
      공급자를_죽인다()
      const 씨앗 = await 끝난_세션(tx)

      const 답 = await 종료(씨앗.session_id, 'left')
      expect(답.data).toEqual({ report: 'queued' })
      expect(await 리포트_수(tx, 씨앗.session_id)).toBe(1)
      // 🔴 빈 결과 행을 세우지 않는다 — 세우면 리포트가 「후활동을 했다」로 읽는다.
      expect(await 결과행(tx, 씨앗.session_id)).toBeNull()
    })
  })

  it("D — 'left' 는 completed_at 을 안 채운다. 순서만 맞추고 떠난 자리다", async () => {
    await 트랜잭션(async (tx) => {
      공급자를_죽인다()
      const 씨앗 = await 끝난_세션(tx)
      await 순서(씨앗.session_id, 정답순서)

      await 종료(씨앗.session_id, 'left')
      const 행 = await 결과행(tx, 씨앗.session_id)
      expect(행).not.toBeNull()
      expect(행?.completed_at).toBeNull()
      expect(await 리포트_수(tx, 씨앗.session_id)).toBe(1)
    })
  })

  it('D — 반복 호출이 안전하다. 두 번째는 아무 일도 안 일어난다', async () => {
    await 트랜잭션(async (tx) => {
      공급자를_죽인다()
      const 씨앗 = await 끝난_세션(tx)
      await 순서(씨앗.session_id, 정답순서)

      expect((await 종료(씨앗.session_id, 'finished')).data).toEqual({ report: 'queued' })
      const 처음_마친_시각 = (await 결과행(tx, 씨앗.session_id))?.completed_at

      // 마치고 나서 끝 화면을 떠났다 — 앱이 한 번 더 부른다.
      expect((await 종료(씨앗.session_id, 'left')).data).toEqual({ report: 'exists' })
      expect((await 종료(씨앗.session_id, 'finished')).data).toEqual({ report: 'exists' })

      expect((await 결과행(tx, 씨앗.session_id))?.completed_at).toEqual(처음_마친_시각)
      expect(await 리포트_수(tx, 씨앗.session_id)).toBe(1)
    })
  })

  it('수용 14 — 이야기가 끝난 것만으로는 리포트가 안 만들어진다 (「기다린다」의 상대가 이 API 다)', async () => {
    await 트랜잭션(async (tx) => {
      공급자를_죽인다()
      const 씨앗 = await 끝난_세션(tx)

      // 세션이 닫히는 자리가 넘기는 곁다리. 🔴 #45 는 **이것을 넘기지 않는다.**
      queueReport(씨앗.session_id, { 후활동을_기다린다: true })
      await __testing.마지막작업
      expect(await 리포트_수(tx, 씨앗.session_id)).toBe(0)

      // 그리고 이 API 가 그 기다림을 끝낸다.
      await 종료(씨앗.session_id, 'finished')
      expect(await 리포트_수(tx, 씨앗.session_id)).toBe(1)
    })
  })

  it("D — reason 이 'finished'·'left' 가 아니면 400 이다", async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 끝난_세션(tx)
      const 요청 = new Request(`${주소}/${씨앗.session_id}/post-activity/complete`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'quit' }),
      })
      const 답 = await 봉투(await 종료_라우트(요청, 경로(씨앗.session_id)))
      expect(답.status).toBe(400)
      expect(답.error.code).toBe('BAD_REQUEST')
      expect(await 리포트_수(tx, 씨앗.session_id)).toBe(0)
    })
  })
})
