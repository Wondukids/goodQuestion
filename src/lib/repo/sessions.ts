// 세션·메시지·분석 — 한 회차가 남기는 기록 전부를 읽고 쓴다.
//
// 파이썬 `src/goodquestion/db.py` 의 세션/메시지 갈래를 옮긴 것이다 (이슈 #26 저장-4).
// `세션과_이야기()`(`goodquestion_admin/회차.py:45`)와 `마지막_아이_메시지()`(:676) 도 여기 왔다 —
// 둘 다 엔진 표만 읽는 조회라 저장 계층에 있는 게 맞다.
//
// ## ⛔ `missing_elements` 를 저장하지 않는다 (`CLAUDE.md` 경계 5)
//
// `story_sessions` 에 그 칸이 없고 여기서 만들지도 않는다.
// **`required_elements − accumulated_elements` 로 매번 계산한다.** 부르는 쪽이 계산하는 이유는
// 두 값이 서로 다른 표(`story_scenes` · `story_sessions`)에서 오기 때문이고,
// 저장해 두면 시드의 `required_elements` 를 고친 순간 낡은 값이 남는다.
//
// ## 커밋은 부르는 쪽이 한다 (결정 18)
//
// 여기서 트랜잭션을 여닫지 않는다. 특히 **아이 메시지 행은 LLM 을 부르기 전에 저장하고
// 커밋한다** — `utterance_analyses.message_id` 가 NOT NULL FK 라 순서를 바꿀 수 없고,
// 분석이 죽어도 그 행은 되돌리지 않는다 (`docs/설계/라우트계약.md` 3절).
// 그 커밋을 언제 하느냐는 서비스 층이 정한다.

import { and, asc, desc, eq, gt, lt, sql } from 'drizzle-orm'

import { messages, stories, story_scenes, story_sessions, utterance_analyses } from '@/db/schema'
import type { Decision } from '@/lib/domain/decide'
import { LookupError } from '@/lib/domain/progress'

import type { Conn } from './db'

/** `story_sessions` 한 행. 칸 이름은 DB 컬럼 그대로다. */
export type SessionRow = typeof story_sessions.$inferSelect

/** `messages` 한 행. */
export type MessageRow = typeof messages.$inferSelect

/** 세션 한 행에 이야기의 `code`·`title` 을 붙인 것 (파이썬 `세션과_이야기`). */
export type SessionWithStory = SessionRow & { story_code: string; story_title: string }

/**
 * 분석 LLM 이 내는 넷. **이 넷뿐이다** (`CLAUDE.md` 경계 1).
 *
 * ⛔ `response_mode`·`scene_goal_met`·`scene_end_reason` 을 절대 더하지 말 것.
 * ⚠️ 여기서 따로 세우는 이유는 층 경계다 — repo 는 `engine` 을 import 하지 않는다.
 *    `engine/analyze.ts` 의 zod 결과가 이 모양을 그대로 만족한다 (칸 이름이 컬럼 이름이므로).
 */
export interface AnalysisPayload {
  child_intent: string
  main_point: string | null
  // ⚠️ `evidence` 는 **`null` 일 수 있다.** `engine/analyze.ts` 의 zod 가 없으면 `null` 로 둔다.
  //    빈 문자열로 바꾸지 않는다 — 「근거를 안 줬다」와 「근거가 빈칸이다」가 한 값이 되면
  //    후처리(`evidence` 대조로 요소를 버리는 것)의 판단 근거가 사라진다.
  detected_elements: readonly { type: string; evidence: string | null }[]
  utterance_validity: string
}

// ---------------------------------------------------------------------------
// 읽기
// ---------------------------------------------------------------------------

/** 결정 19 — 매 턴 여기서 읽는다. 메모리에 들고 있지 않는다. */
export async function readSession(conn: Conn, session_id: string): Promise<SessionRow> {
  const 행들 = await conn
    .select()
    .from(story_sessions)
    .where(eq(story_sessions.id, session_id))
    .limit(1)
  if (행들.length === 0) throw new LookupError(`세션이 없다: ${session_id}`)
  return 행들[0]
}

/**
 * 세션과 그 이야기의 코드·제목을 함께. 장면 목록을 이어서 읽어야 할 때 쓴다.
 *
 * 파이썬은 `story_title` 만 붙였다 — 그것이 장면 조회 키였기 때문이다.
 * 이제 키는 `code` 이고 제목은 화면에 그리는 값이라 **둘 다** 붙인다.
 */
export async function readSessionWithStory(
  conn: Conn,
  session_id: string,
): Promise<SessionWithStory> {
  const 행들 = await conn
    .select({
      session: story_sessions,
      story_code: stories.code,
      story_title: stories.title,
    })
    .from(story_sessions)
    .innerJoin(stories, eq(stories.id, story_sessions.story_id))
    .where(eq(story_sessions.id, session_id))
    .limit(1)
  if (행들.length === 0) throw new LookupError(`세션이 없다: ${session_id}`)
  const 행 = 행들[0]
  return { ...행.session, story_code: 행.story_code, story_title: 행.story_title }
}

/** 메시지 한 행. 없으면 `null` — 그 id 가 이 세션 것인지는 부르는 쪽이 본다 (404 를 가른다). */
export async function readMessage(conn: Conn, message_id: string): Promise<MessageRow | null> {
  const 행들 = await conn.select().from(messages).where(eq(messages.id, message_id)).limit(1)
  return 행들.length === 0 ? null : 행들[0]
}

/**
 * 2.1 표의 `previousCharacterMessage` — **현재 장면** 안의 최근 character 1건.
 *
 * 장면이 바뀌면 캐릭터가 바뀌므로 장면 밖은 보지 않는다.
 * 첫 턴이면 고정 첫 대사가 유일한 후보다.
 */
export async function lastCharacterMessage(
  conn: Conn,
  { session_id, scene_id }: { session_id: string; scene_id: string },
): Promise<string | null> {
  const 행들 = await conn
    .select({ text: messages.text })
    .from(messages)
    .where(
      and(
        eq(messages.session_id, session_id),
        eq(messages.scene_id, scene_id),
        eq(messages.speaker_type, 'character'),
      ),
    )
    .orderBy(desc(messages.turn_order))
    .limit(1)
  return 행들.length === 0 ? null : 행들[0].text
}

/** 이 세션의 마지막 아이 발화 id. 끝나지 않은 턴을 잇는 자리가 쓴다. */
export async function lastChildMessageId(
  conn: Conn,
  session_id: string,
): Promise<string | null> {
  const 행들 = await conn
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.session_id, session_id), eq(messages.speaker_type, 'child')))
    .orderBy(desc(messages.turn_order))
    .limit(1)
  return 행들.length === 0 ? null : 행들[0].id
}

/**
 * 현재 장면의 대화. 캐릭터 LLM 재료다 (`docs/기준/LLM입출력규격.md:280-289`).
 *
 * 범위는 **현재 장면만.** 장면이 바뀌면 캐릭터가 바뀌므로 이전 장면 대화는 넘기지 않는다.
 * `before_turn_order` 를 주면 그보다 앞선 것만 — 이번 발화를 목록에서 빼는 규칙이 여기다.
 */
export async function sceneMessages(
  conn: Conn,
  {
    session_id,
    scene_id,
    before_turn_order,
  }: { session_id: string; scene_id: string; before_turn_order?: number | null },
): Promise<{ speaker_type: string; turn_order: number; text: string }[]> {
  const 조건 = [eq(messages.session_id, session_id), eq(messages.scene_id, scene_id)]
  if (before_turn_order !== undefined && before_turn_order !== null) {
    조건.push(lt(messages.turn_order, before_turn_order))
  }
  return conn
    .select({
      speaker_type: messages.speaker_type,
      turn_order: messages.turn_order,
      text: messages.text,
    })
    .from(messages)
    .where(and(...조건))
    .orderBy(asc(messages.turn_order))
}

/**
 * 턴 로그 화면이 그리는 한 행 — `messages` 에 장면과 분석을 붙인 것.
 *
 * 칸 이름은 전부 DB 컬럼 그대로다. 장면에서 오는 셋(`scene_order`·`character_name`·
 * `required_elements`)은 화면이 `missing_elements` 를 **뺄셈으로 계산**할 재료다
 * (`CLAUDE.md` 경계 5 — 저장하지 않는다).
 *
 * ⚠️ 분석 넷은 **아이 메시지에만** 있다. 캐릭터 행이면 전부 `null` 이다 (left join).
 */
export interface TranscriptRow {
  id: string
  session_id: string
  scene_id: string
  speaker_type: string
  turn_order: number
  text: string
  utterance_source: string | null
  created_at: Date
  scene_order: number
  character_name: string | null
  required_elements: string[] | null
  child_intent: string | null
  main_point: string | null
  detected_elements: { type: string; evidence: string | null }[] | null
  utterance_validity: string | null
}

/**
 * 세션의 재생 순서 전부 (파이썬 `goodquestion_admin/회차.메시지_목록()`).
 *
 * ⛔ **판정을 다시 계산하지 않는다.** 저장된 사실만 읽는다.
 *
 * ⚠️ 파이썬은 「바로 다음 한 행」을 lateral 로 붙여 `character_response` 를 만들었다.
 *    여기서는 그 한 칸을 SQL 에 두지 않는다 — **목록을 순서대로 다 읽으므로**
 *    바로 다음 행이 이미 손에 있고, 붙이는 일은 화면 조립층(`service/view.ts`)이 한다.
 *    ⭐ 「뒤에 오는 첫 캐릭터 메시지」로 집으면 실패한 턴이 **다음 턴의 대사**를 제 것으로
 *    착각한다는 규칙은 그대로다. 그래서 거기서도 **바로 다음 한 행**만 본다.
 */
export async function sessionTranscript(
  conn: Conn,
  session_id: string,
): Promise<TranscriptRow[]> {
  return conn
    .select({
      id: messages.id,
      session_id: messages.session_id,
      scene_id: messages.scene_id,
      speaker_type: messages.speaker_type,
      turn_order: messages.turn_order,
      text: messages.text,
      utterance_source: messages.utterance_source,
      created_at: messages.created_at,
      scene_order: story_scenes.scene_order,
      character_name: story_scenes.character_name,
      required_elements: story_scenes.required_elements,
      child_intent: utterance_analyses.child_intent,
      main_point: utterance_analyses.main_point,
      detected_elements: utterance_analyses.detected_elements,
      utterance_validity: utterance_analyses.utterance_validity,
    })
    .from(messages)
    .innerJoin(story_scenes, eq(story_scenes.id, messages.scene_id))
    .leftJoin(utterance_analyses, eq(utterance_analyses.message_id, messages.id))
    .where(eq(messages.session_id, session_id))
    .orderBy(asc(messages.turn_order), asc(messages.id))
}

// ---------------------------------------------------------------------------
// 쓰기
// ---------------------------------------------------------------------------

/**
 * 결정 19 — 실행할 때마다 새 세션. 이어하기는 이 트랙 밖이다.
 *
 * `child_id` 는 `children` 테이블이 이 레포 범위 밖이라 걸 FK 가 없다. 값만 든다.
 *
 * **안 주면 새 UUID 를 만든다.** 관리 도구가 시험용 아이를 골랐으면 그 id 를 넘긴다 (결정 46).
 * ⚠️ 엔진은 그 값이 **어느 표에서 왔는지 모른다.** 여기서 관리 표를 조회하지 않는다 —
 *    조회하면 저장 계층이 관리 표를 아는 것이 되어 경계가 깨진다.
 *
 * ⚠️ 새 UUID 는 **DB 가** 만든다(`gen_random_uuid()`). 코드에서 만들지 않는다 —
 *    안 주면 어디서 나온 값인지가 파이썬 판과 달라진다.
 */
export async function createSession(
  conn: Conn,
  { story_id, child_id }: { story_id: string; child_id?: string | null },
): Promise<string> {
  const 행들 = await conn
    .insert(story_sessions)
    .values({
      child_id: child_id ?? sql`gen_random_uuid()`,
      story_id,
      status: 'in_progress',
    })
    .returning({ id: story_sessions.id })
  return 행들[0].id
}

/**
 * 장면이 바뀌면 세션의 **장면 상태 9칸**을 초기화한다 (결정 22).
 *
 * 안 지우면 앞 장면의 누적 요소를 물려받아 첫 턴에 `GOAL_MET` 이 뜬다.
 * 컬럼 설명이 전부 "현재 장면에서" 로 시작한다(`docs/기준/db구조.md:224-232`).
 */
export async function enterScene(
  conn: Conn,
  session_id: string,
  scene_id: string,
): Promise<void> {
  await conn
    .update(story_sessions)
    .set({
      current_scene_id: scene_id,
      current_child_turn_count: 0,
      accumulated_elements: [],
      last_detected_elements: [],
      last_response_mode: null,
      last_guidance_target: null,
      turns_without_new_element: 0,
      consecutive_low_information_turns: 0,
      scene_goal_met: false,
      scene_end_reason: null,
      last_activity_at: sql`now()`,
    })
    .where(eq(story_sessions.id, session_id))
}

/**
 * `turn_order` 는 **세션 전체** 순번이다 (`docs/기준/db구조.md:281` — 장면별이 아니다).
 *
 * 번호를 **DB 안에서** 센다. 읽어다 더하면 읽기와 쓰기 사이에 다른 턴이 끼어
 * 같은 번호가 두 번 나온다(`messages_session_id_turn_order_key` 가 잡는다).
 */
export async function insertMessage(
  conn: Conn,
  {
    session_id,
    scene_id,
    speaker_type,
    text,
    stt_raw_text,
    utterance_source,
  }: {
    session_id: string
    scene_id: string
    speaker_type: string
    text: string
    stt_raw_text?: string | null
    utterance_source?: string | null
  },
): Promise<{ id: string; turn_order: number }> {
  const 다음_번호 = sql<number>`(
    select coalesce(max(${messages.turn_order}), 0) + 1
    from ${messages}
    where ${messages.session_id} = ${session_id}
  )`
  const 행들 = await conn
    .insert(messages)
    .values({
      session_id,
      scene_id,
      speaker_type,
      turn_order: 다음_번호,
      text,
      stt_raw_text: stt_raw_text ?? null,
      utterance_source: utterance_source ?? null,
    })
    .returning({ id: messages.id, turn_order: messages.turn_order })
  return 행들[0]
}

/**
 * 어느 분석 규격으로 낸 결과인가 (결정 3 · `db구조.md` 11절).
 *
 * 🔴 **값을 우리가 적어 보낸다 — DB 기본값에 기대지 않는다** (2026-08-13).
 *    파이썬은 이 칸을 한 번도 안 실어 보냈고 `sql/001_schema.sql:244` 의
 *    `NOT NULL DEFAULT 'mvp_v1'` 이 대신 채웠다. 우리 DB 만 보면 똑같이 도는데,
 *    **저쪽(팀 repo) 표는 nullable 이고 기본값이 없다.** 그대로 얹으면 실패하지도
 *    않고 **전 행이 조용히 NULL 로** 쌓여, 나중에 「어느 규격이 낸 결과인가」를
 *    되짚을 수가 없다. 얹기 전에 여기서 막는다.
 *    (`tests/repo.test.ts` 가 **기본값을 떼어 낸 표**에 넣어 보는 것으로 잰다.)
 */
export const 분석_규격 = 'mvp_v1'

/**
 * **후처리 전 원본**을 넣는다 (결정 26).
 *
 * 후처리 후를 저장하면 프롬프트를 고쳐도 차이가 후처리에 먹혀 안 보인다.
 */
export async function insertAnalysis(
  conn: Conn,
  { message_id, analysis }: { message_id: string; analysis: AnalysisPayload },
): Promise<string> {
  const 행들 = await conn
    .insert(utterance_analyses)
    .values({
      message_id,
      child_intent: analysis.child_intent,
      main_point: analysis.main_point,
      // 컬럼이 JSONB 라 목록을 그대로 준다.
      detected_elements: [...analysis.detected_elements],
      utterance_validity: analysis.utterance_validity,
      analysis_version: 분석_규격,
    })
    .returning({ id: utterance_analyses.id })
  return 행들[0].id
}

/**
 * 1.1 표 6·7단계를 **한 번에** 쓴다 (결정 18).
 *
 * `decide()` 가 누적·카운터·모드를 한 덩어리로 돌려주므로 나눠 쓰면 중간 상태만 생긴다.
 * `last_guidance_target` 은 GUIDED 뿐 아니라 soft-cue 대상도 담는다(`docs/기준/db구조.md:228`).
 * ⚠️ 저장하는 것은 `decision.guidance_target`(이번 턴)이 **아니라**
 *    `decision.last_guidance_target`(이월값)이다. 유도가 없던 턴은 직전 기억을 지우지 않는다(이슈 #27).
 *
 * ⚠️ `turn_count` 는 **이번 발화를 포함한** 값이다. 턴 수 +1 을 하는 자리는 부르는 쪽이다
 *    (결정 17-a · `decide.ts` 머리말).
 */
export async function updateSession(
  conn: Conn,
  {
    session_id,
    decision,
    turn_count,
    last_detected,
  }: {
    session_id: string
    decision: Decision
    turn_count: number
    last_detected: readonly string[]
  },
): Promise<void> {
  await conn
    .update(story_sessions)
    .set({
      current_child_turn_count: turn_count,
      accumulated_elements: [...decision.accumulated_elements],
      last_detected_elements: [...last_detected],
      last_response_mode: decision.response_mode,
      last_guidance_target: decision.last_guidance_target,
      turns_without_new_element: decision.turns_without_new_element,
      consecutive_low_information_turns: decision.consecutive_low_information_turns,
      scene_goal_met: decision.scene_goal_met,
      scene_end_reason: decision.scene_end_reason,
      last_activity_at: sql`now()`,
    })
    .where(eq(story_sessions.id, session_id))
}

/**
 * 마지막 장면이 끝났다 (결정 22).
 *
 * `'post_activity'` 로 두지 않는다 — 이 레포에 말하기 후 활동이 없어 영영 안 끝난 세션이 남는다.
 */
export async function completeSession(conn: Conn, session_id: string): Promise<void> {
  await conn
    .update(story_sessions)
    .set({ status: 'completed', completed_at: sql`now()`, last_activity_at: sql`now()` })
    .where(eq(story_sessions.id, session_id))
}

// ---------------------------------------------------------------------------
// ③ 재호출과 미완 턴 (2026-08-12 사람 결정 · `docs/설계/라우트계약.md` 8절)
// ---------------------------------------------------------------------------
//
// 한 턴이 중간에 죽으면 **③(대사)만 다시 부를 수 있게 한다**가 결정이다.
// 아래 셋이 그 결정이 서는 자리다 — 없으면 미완 턴을 찾지도, 이어 붙이지도 못한다.

/**
 * 박제된 분석을 되살린다. **다시 분석하지 않는다** (파이썬 FR-015 · `회차.저장된_분석()`).
 *
 * 후처리 **전** 원본이 그대로 나온다 (결정 26). 후처리는 순수 함수라
 * (원본 요소, 아이 발화) 만 있으면 언제든 같은 답이 다시 나온다.
 */
export async function readSavedAnalysis(
  conn: Conn,
  message_id: string,
): Promise<AnalysisPayload | null> {
  const 행들 = await conn
    .select({
      child_intent: utterance_analyses.child_intent,
      main_point: utterance_analyses.main_point,
      detected_elements: utterance_analyses.detected_elements,
      utterance_validity: utterance_analyses.utterance_validity,
    })
    .from(utterance_analyses)
    .where(eq(utterance_analyses.message_id, message_id))
    .limit(1)
  return 행들.length === 0 ? null : 행들[0]
}

/**
 * `turn_order` 가 그 값보다 큰 **첫 한 행**. 없으면 `null`. (파이썬 `회차.미완_턴()` 의 lateral)
 *
 * ⚠️ **화자를 걸러 집지 않는다.** 걸러 집으면 실패한 턴이 **그 다음 턴의 대사**를
 *    자기 것으로 착각한다. 「바로 다음 한 행」이어야 미완인지 아닌지가 갈린다.
 */
export async function nextMessage(
  conn: Conn,
  { session_id, turn_order }: { session_id: string; turn_order: number },
): Promise<{ id: string; speaker_type: string; scene_id: string; turn_order: number } | null> {
  const 행들 = await conn
    .select({
      id: messages.id,
      speaker_type: messages.speaker_type,
      scene_id: messages.scene_id,
      turn_order: messages.turn_order,
    })
    .from(messages)
    .where(and(eq(messages.session_id, session_id), gt(messages.turn_order, turn_order)))
    .orderBy(asc(messages.turn_order), asc(messages.id))
    .limit(1)
  return 행들.length === 0 ? null : 행들[0]
}

/**
 * 이미 있는 메시지의 글만 바꾼다. **행을 늘리지 않는다.**
 *
 * ③ 재호출이 쓰는 자리다 — 새로 넣으면 `turn_order` 가 하나 더 생겨 그 턴의 대사가 둘이 된다.
 */
export async function overwriteMessageText(
  conn: Conn,
  { message_id, text }: { message_id: string; text: string },
): Promise<{ id: string; turn_order: number }> {
  const 행들 = await conn
    .update(messages)
    .set({ text })
    .where(eq(messages.id, message_id))
    .returning({ id: messages.id, turn_order: messages.turn_order })
  return 행들[0]
}
