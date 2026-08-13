// 회차와 LLM 호출 기록.
//
// 파이썬 `src/goodquestion_admin/저장.py` 의 회차·시도 갈래를 옮긴 것이다 (이슈 #26 저장-5).
// 관리 표 11개 중 이 둘(`runs`·`llm_calls`)만 이식됐다 (`docs/설계/이식목록.md` 1절).
//
// ## ⭐ 토큰 수가 여기 쌓이는 이유
//
// `gpt-5-nano` 가 정말 더 싼지는 **실제로 쓴 토큰**으로만 판단할 수 있다 (B-4).
// `input_tokens`·`output_tokens` 를 안 남기면 그 판단을 할 근거가 사라진다.
// 그래서 **시도 하나가 한 행이고, 실패한 시도도 그대로 남긴다** (결정 33) —
// 넘어간 흔적이 기록에 없으면 「왜 이 턴이 느렸나」를 되짚을 수 없다.
//
// ## ⛔ 옮겨 담는 층을 두지 않는다
//
// 파이썬 `시도` 는 칸 이름이 컬럼과 달라(`응답`·`걸린_초`·`성공`·`실패_사유`)
// `저장.py` 가 하나하나 옮겨 담았다. **그 옮겨 담는 자리가 버그가 사는 곳이다.**
// 타입스크립트 `Attempt`(`lib/llm/index.ts`)는 처음부터 `llm_calls` 컬럼 이름을 쓰므로
// 여기서는 **받은 것을 그대로 넣는다.**
//
// ⚠️ 그 `Attempt` 를 import 하지 않고 같은 모양을 여기 다시 적은 것은 층 경계 때문이다 —
//    repo 는 `llm` 을 import 하지 않는다 (`docs/설계/코드구조.md` 4절, eslint 가 막는다).
//    **이름을 바꾸지 않았으므로 변환이 아니다.** `Attempt` 가 이 모양을 그대로 만족한다.

import { and, asc, desc, eq, sql } from 'drizzle-orm'

import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import { llm_calls, runs, stories, story_sessions } from '@/db/schema'
import { LookupError } from '@/lib/domain/progress'

import type { Conn } from './db'

/** `runs` 한 행. */
export type RunRow = typeof runs.$inferSelect

/** `llm_calls` 한 행. */
export type LlmCallRow = typeof llm_calls.$inferSelect

/**
 * 시도 한 번. `lib/llm/index.ts` 의 `Attempt` 가 이 모양이다 (칸 이름 = 컬럼 이름).
 *
 * ⚠️ `purpose` 는 `'analysis'` 또는 `'character'` 여야 한다 —
 *    `llm_calls_purpose_check` 가 다른 값을 거절한다. 여기서 바꿔 주지 않는다.
 *    부르는 쪽(`complete({ purpose })`)이 처음부터 그 값을 쓴다.
 */
export interface AttemptRecord {
  purpose: string
  provider: string
  model: string
  effort: string | null
  system_text: string
  user_text: string
  response_text: string | null
  input_tokens: number | null
  output_tokens: number | null
  duration_ms: number
  ok: boolean
  error: string | null
}

// ---------------------------------------------------------------------------
// 회차
// ---------------------------------------------------------------------------

export async function createRun(
  conn: Conn,
  값: {
    session_id: string
    scope: string
    scene_order: number | null
    started_by: string | null
    analysis_model: string | null
    analysis_effort: string | null
    character_model: string | null
    character_effort: string | null
    default_utterance_source: string
    prompt_version: string
    experiment_note?: string | null
  },
): Promise<RunRow> {
  const 행들 = await conn
    .insert(runs)
    .values({ ...값, experiment_note: 값.experiment_note ?? null })
    .returning()
  return 행들[0]
}

export async function readRun(conn: Conn, run_id: string): Promise<RunRow> {
  const 행들 = await conn.select().from(runs).where(eq(runs.id, run_id)).limit(1)
  if (행들.length === 0) throw new LookupError(`회차가 없다: ${run_id}`)
  return 행들[0]
}

/** 이 세션의 회차. `runs.session_id` 가 UNIQUE 라 있어도 하나다 (「두 번 보내기 잠금」의 근거). */
export async function readRunBySession(
  conn: Conn,
  session_id: string,
): Promise<RunRow | null> {
  const 행들 = await conn.select().from(runs).where(eq(runs.session_id, session_id)).limit(1)
  return 행들.length === 0 ? null : 행들[0]
}

export async function listRuns(conn: Conn): Promise<RunRow[]> {
  return conn.select().from(runs).orderBy(desc(runs.started_at), desc(runs.id))
}

/** 회차 한 행에 세션 상태와 이야기를 붙인 것. 회차 목록 화면이 쓴다. */
export type RunWithStory = RunRow & {
  status: string
  current_scene_id: string | null
  story_code: string
  story_title: string
}

/**
 * 회차 목록 + 세션 상태 + 이야기 (최근 것이 위).
 *
 * ⚠️ 회차마다 `readSessionWithStory()` 를 다시 부르지 않는다 — 회차가 쌓이면 그만큼
 * 왕복이 늘고, 목록 화면이 느린 이유가 저장 계층 밖에 숨는다.
 */
export async function listRunsWithStory(conn: Conn): Promise<RunWithStory[]> {
  const 행들 = await conn
    .select({
      run: runs,
      status: story_sessions.status,
      current_scene_id: story_sessions.current_scene_id,
      // 바깥 이름은 `story_code` 그대로, 읽는 칸은 `stories.slug` 다 (결정 3 · 4차).
      story_code: stories.slug,
      story_title: stories.title,
    })
    .from(runs)
    .innerJoin(story_sessions, eq(story_sessions.id, runs.session_id))
    .innerJoin(stories, eq(stories.id, story_sessions.story_id))
    .orderBy(desc(runs.started_at), desc(runs.id))
  return 행들.map((행) => ({
    ...행.run,
    status: 행.status,
    current_scene_id: 행.current_scene_id,
    story_code: 행.story_code,
    story_title: 행.story_title,
  }))
}

/** 끝난 시각은 **처음 한 번만** 찍는다. 다시 불러도 첫 값이 남는다. */
export async function endRun(conn: Conn, run_id: string): Promise<RunRow> {
  const 행들 = await conn
    .update(runs)
    .set({ ended_at: sql`coalesce(${runs.ended_at}, now())` })
    .where(eq(runs.id, run_id))
    .returning()
  if (행들.length === 0) throw new LookupError(`회차가 없다: ${run_id}`)
  return 행들[0]
}

// ---------------------------------------------------------------------------
// LLM 호출 기록
// ---------------------------------------------------------------------------

/**
 * 시도 1건마다 행 1건. **실패한 시도도 그대로 넣는다** (결정 33).
 *
 * `attempt_no` 는 **같은 턴·같은 용도에서 이어서** 매긴다 (결정 44).
 * 처음 도는 턴이면 최대값이 없어 1부터다. 같은 턴을 다시 보내면 3·4로 이어져,
 * 한 턴 안에서 몇 번째 시도였는지가 번호로 남는다. 다시 1부터 세면
 * `(message_id, purpose, attempt_no)` 가 같은 행이 두 벌 생겨
 * 어느 것이 먼저였는지 시각으로만 알 수 있게 된다.
 */
export async function insertAttempts(
  conn: Conn,
  {
    run_id,
    message_id,
    attempts,
  }: { run_id: string; message_id: string | null; attempts: readonly AttemptRecord[] },
): Promise<LlmCallRow[]> {
  const 저장됨: LlmCallRow[] = []
  const 다음_번호 = new Map<string, number>()

  for (const 항목 of attempts) {
    let 번호 = 다음_번호.get(항목.purpose)
    if (번호 === undefined) {
      번호 = (await 마지막_시도_번호(conn, { message_id, purpose: 항목.purpose })) + 1
    }
    다음_번호.set(항목.purpose, 번호 + 1)

    const 행들 = await conn
      .insert(llm_calls)
      .values({ run_id, message_id, attempt_no: 번호, ...항목 })
      .returning()
    저장됨.push(행들[0])
  }
  return 저장됨
}

/** 이 턴·이 용도로 이미 매긴 마지막 `attempt_no`. 없으면 0. */
async function 마지막_시도_번호(
  conn: Conn,
  { message_id, purpose }: { message_id: string | null; purpose: string },
): Promise<number> {
  if (message_id === null) return 0
  const 행들 = await conn
    .select({ 마지막: sql<number>`coalesce(max(${llm_calls.attempt_no}), 0)::int` })
    .from(llm_calls)
    .where(and(eq(llm_calls.message_id, message_id), eq(llm_calls.purpose, purpose)))
  return 행들[0].마지막
}

/**
 * 이 턴에서 실패한 시도의 사유. **메모리가 아니라 기록에서 읽는다.**
 *
 * `LLMError` 안에서만 살던 사유를 화면이 되살릴 수 있는 유일한 자리다.
 */
export async function failureReasons(
  conn: Conn,
  { run_id, message_id }: { run_id: string; message_id: string },
) {
  return conn
    .select({
      id: llm_calls.id,
      purpose: llm_calls.purpose,
      attempt_no: llm_calls.attempt_no,
      provider: llm_calls.provider,
      model: llm_calls.model,
      error: llm_calls.error,
      created_at: llm_calls.created_at,
    })
    .from(llm_calls)
    .where(
      and(
        eq(llm_calls.run_id, run_id),
        eq(llm_calls.message_id, message_id),
        eq(llm_calls.ok, false),
      ),
    )
    .orderBy(
      asc(llm_calls.created_at),
      asc(llm_calls.purpose),
      asc(llm_calls.attempt_no),
      asc(llm_calls.id),
    )
}

/** 회차의 시도 전부. `message_id` 를 주면 그 턴만. */
export async function readAttempts(
  conn: Conn,
  { run_id, message_id }: { run_id: string; message_id?: string | null },
): Promise<LlmCallRow[]> {
  const 조건 = [eq(llm_calls.run_id, run_id)]
  if (message_id !== undefined && message_id !== null) {
    조건.push(eq(llm_calls.message_id, message_id))
  }
  return conn
    .select()
    .from(llm_calls)
    .where(and(...조건))
    .orderBy(
      asc(llm_calls.created_at),
      asc(llm_calls.purpose),
      asc(llm_calls.attempt_no),
      asc(llm_calls.id),
    )
}

/**
 * 한 턴이 쓴 토큰·시간 합계. **모르는 토큰이 하나라도 있으면 합계도 모름(`null`)으로 둔다.**
 *
 * 0 으로 채우면 「안 썼다」와 「모른다」가 한 값이 되어 예산 판단(B-4)이 틀린다.
 */
export async function attemptTotals(
  conn: Conn,
  { run_id, message_id }: { run_id: string; message_id: string },
): Promise<{
  attempt_count: number
  duration_ms: number
  input_tokens: number | null
  output_tokens: number | null
}> {
  const 모르면_모름 = (칸: AnyPgColumn) => sql<number | null>`(
    case when count(*) filter (where ${칸} is null) > 0
         then null
         else coalesce(sum(${칸}), 0)::int
    end
  )`

  const 행들 = await conn
    .select({
      attempt_count: sql<number>`count(*)::int`,
      duration_ms: sql<number>`coalesce(sum(${llm_calls.duration_ms}), 0)::int`,
      input_tokens: 모르면_모름(llm_calls.input_tokens),
      output_tokens: 모르면_모름(llm_calls.output_tokens),
    })
    .from(llm_calls)
    .where(and(eq(llm_calls.run_id, run_id), eq(llm_calls.message_id, message_id)))
  return 행들[0]
}
