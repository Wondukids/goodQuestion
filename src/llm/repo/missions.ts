// 미션 세 표를 읽고 쓴다 (`sql/005_missions.sql` · 이슈 #17 이 세운 표 · 이슈 #19 가 쓴다).
//
// ⛔ 다른 repo 파일과 같은 규칙이다 — **트랜잭션을 여닫지 않고**, 규칙을 쓰지 않는다.
//    「언제 시도를 버리나」·「어느 스텝이 다음인가」는 전부 위층(`service/mission*.ts`)이 정한다.
//
// ## 왜 미션 대화가 `messages` 가 아닌가 (M5)
//
// 미완 턴 판정(`pendingTurn()`)이 「마지막 아이 발화의 **바로 다음 한 행**」을 보기 때문이다.
// 미션 대화를 `messages` 에 섞으면 그 규칙이 깨져 멀쩡한 턴이 미완으로 보인다.
// 본 대화로 넘어가는 것은 종료 요약 한 행뿐이고, 그 행은 `repo/sessions.insertMessage()` 가 넣는다.

import { and, asc, desc, eq, sql } from 'drizzle-orm'

import { mission_messages, mission_sessions, story_missions } from '@/llm/db/schema'

import type { Conn } from './db'

/** `story_missions` 한 행 — 미션 1종의 정의·상수. */
export type MissionRow = typeof story_missions.$inferSelect

/** `mission_sessions` 한 행 — 한 플레이에서 미션 1회 시도. */
export type MissionSessionRow = typeof mission_sessions.$inferSelect

/** `mission_messages` 한 행 — 미션 안 대화 한 줄. */
export type MissionMessageRow = typeof mission_messages.$inferSelect

/** `mission_sessions.selections` 한 칸. 컬럼 타입 그대로다. */
export type MissionSelectionRow = MissionSessionRow['selections'][number]

// ── story_missions ─────────────────────────────────────────────────────────

/**
 * 그 장면에 걸린 미션. **없으면 `null`** — 미션 없는 씬(대화1·2)이 여기로 온다.
 *
 * `UNIQUE (scene_id)` 라 한 행뿐이다 (씬당 미션 1개 · MVP).
 */
export async function missionOfScene(conn: Conn, scene_id: string): Promise<MissionRow | null> {
  const [행] = await conn
    .select()
    .from(story_missions)
    .where(eq(story_missions.scene_id, scene_id))
    .limit(1)
  return 행 ?? null
}

/** 미션 하나를 id 로. 미션 API 가 시도 행에서 정의로 건너올 때 쓴다. */
export async function readMission(conn: Conn, mission_id: string): Promise<MissionRow | null> {
  const [행] = await conn.select().from(story_missions).where(eq(story_missions.id, mission_id)).limit(1)
  return 행 ?? null
}

// ── mission_sessions ───────────────────────────────────────────────────────

/** 시도 한 행을 id 로. 없으면 `null` (남의 세션 것일 수도 있어 판정은 위층이 한다). */
export async function readMissionSession(
  conn: Conn,
  mission_session_id: string,
): Promise<MissionSessionRow | null> {
  const [행] = await conn
    .select()
    .from(mission_sessions)
    .where(eq(mission_sessions.id, mission_session_id))
    .limit(1)
  return 행 ?? null
}

/**
 * 이 세션에서 **지금 도는 중인** 시도. 없으면 `null`.
 *
 * 미션이 여럿이어도 세션 하나에서 동시에 도는 것은 하나뿐이다 — 씬이 하나씩 지나가고
 * 미션 진행 중에는 일반 턴이 409 로 막히기 때문이다 (명세 7절 E).
 */
export async function activeMissionOfSession(
  conn: Conn,
  session_id: string,
): Promise<MissionSessionRow | null> {
  const [행] = await conn
    .select()
    .from(mission_sessions)
    .where(
      and(eq(mission_sessions.session_id, session_id), eq(mission_sessions.status, 'in_progress')),
    )
    .orderBy(desc(mission_sessions.started_at))
    .limit(1)
  return 행 ?? null
}

/** 그 (세션, 미션) 의 진행 중 시도. `ux_mission_sessions_active` 가 하나임을 보장한다. */
export async function activeMissionSession(
  conn: Conn,
  { session_id, mission_id }: { session_id: string; mission_id: string },
): Promise<MissionSessionRow | null> {
  const [행] = await conn
    .select()
    .from(mission_sessions)
    .where(
      and(
        eq(mission_sessions.session_id, session_id),
        eq(mission_sessions.mission_id, mission_id),
        eq(mission_sessions.status, 'in_progress'),
      ),
    )
    .limit(1)
  return 행 ?? null
}

/**
 * 그 (세션, 미션) 의 **끝난** 시도. 있으면 트리거를 다시 발동하지 않는다 (명세 5절 · 7절 E).
 *
 * ⚠️ `abandoned` 는 여기 안 든다 — 이탈한 시도는 「완료」가 아니라서 다시 발동해야 한다.
 */
export async function completedMissionSession(
  conn: Conn,
  { session_id, mission_id }: { session_id: string; mission_id: string },
): Promise<MissionSessionRow | null> {
  const [행] = await conn
    .select()
    .from(mission_sessions)
    .where(
      and(
        eq(mission_sessions.session_id, session_id),
        eq(mission_sessions.mission_id, mission_id),
        eq(mission_sessions.status, 'completed'),
      ),
    )
    .orderBy(desc(mission_sessions.completed_at))
    .limit(1)
  return 행 ?? null
}

/** 시도 한 행을 연다. `current_step` 은 비운 채다 — 첫 스텝은 선택 이벤트가 정한다 (명세 7절 B). */
export async function createMissionSession(
  conn: Conn,
  { session_id, mission_id }: { session_id: string; mission_id: string },
): Promise<MissionSessionRow> {
  const [행] = await conn.insert(mission_sessions).values({ session_id, mission_id }).returning()
  return 행
}

/**
 * 이탈한 시도를 접는다 (M4). 복귀는 **새 행으로 처음부터**다 — 이어 돌리기가 없다.
 *
 * 부분 유니크 인덱스(`ux_mission_sessions_active`)가 `status='in_progress'` 만 보므로,
 * 접고 나야 새 시도를 넣을 수 있다.
 */
export async function abandonMissionSession(conn: Conn, mission_session_id: string): Promise<void> {
  await conn
    .update(mission_sessions)
    .set({ status: 'abandoned' })
    .where(eq(mission_sessions.id, mission_session_id))
}

/** 관찰용 스텝 표시. **재개엔 쓰지 않는다** (M4) — 다음 발화가 어느 스텝인지를 적을 뿐이다. */
export async function setMissionStep(
  conn: Conn,
  { mission_session_id, step }: { mission_session_id: string; step: string | null },
): Promise<void> {
  await conn
    .update(mission_sessions)
    .set({ current_step: step })
    .where(eq(mission_sessions.id, mission_session_id))
}

/**
 * 말이 아닌 입력 한 건을 `selections` 뒤에 붙인다 (명세 7절 B).
 *
 * 🔴 **DB 안에서 이어 붙인다** (`||`). 읽어다 붙여 쓰면 그 사이에 들어온 선택이 사라진다 —
 *    `insertMessage()` 가 `turn_order` 를 DB 안에서 세는 것과 같은 이유다.
 */
export async function appendMissionSelection(
  conn: Conn,
  {
    mission_session_id,
    selection,
  }: { mission_session_id: string; selection: Omit<MissionSelectionRow, 'at'> },
): Promise<void> {
  await conn
    .update(mission_sessions)
    .set({
      selections: sql`${mission_sessions.selections} || ${JSON.stringify([
        { ...selection, at: new Date().toISOString() },
      ])}::jsonb`,
    })
    .where(eq(mission_sessions.id, mission_session_id))
}

/** 시도를 완료로 접고 요약 원문을 남긴다 (명세 7절 D). */
export async function completeMissionSession(
  conn: Conn,
  { mission_session_id, summary_text }: { mission_session_id: string; summary_text: string },
): Promise<void> {
  await conn
    .update(mission_sessions)
    .set({ status: 'completed', summary_text, completed_at: sql`now()` })
    .where(eq(mission_sessions.id, mission_session_id))
}

// ── mission_messages ───────────────────────────────────────────────────────

/** 이 시도 안에서 오간 말 전부, 순번대로. */
export async function missionMessages(
  conn: Conn,
  mission_session_id: string,
): Promise<MissionMessageRow[]> {
  return conn
    .select()
    .from(mission_messages)
    .where(eq(mission_messages.mission_session_id, mission_session_id))
    .orderBy(asc(mission_messages.turn_order))
}

/**
 * 미션 안 한 줄을 넣는다.
 *
 * `turn_order` 를 **DB 안에서** 센다 — `insertMessage()` 와 같은 이유다
 * (`mission_messages_mission_session_id_turn_order_key` 가 겹침을 잡는다).
 */
export async function insertMissionMessage(
  conn: Conn,
  {
    mission_session_id,
    speaker_type,
    step,
    text,
    stt_raw_text,
    analysis,
    line_source,
  }: {
    mission_session_id: string
    speaker_type: 'child' | 'character' | 'system'
    step: string | null
    text: string
    stt_raw_text?: string | null
    analysis?: MissionMessageRow['analysis']
    line_source?: 'fixed' | 'generated' | 'summary' | null
  },
): Promise<MissionMessageRow> {
  const 다음_번호 = sql<number>`(
    select coalesce(max(${mission_messages.turn_order}), 0) + 1
    from ${mission_messages}
    where ${mission_messages.mission_session_id} = ${mission_session_id}
  )`
  const [행] = await conn
    .insert(mission_messages)
    .values({
      mission_session_id,
      turn_order: 다음_번호,
      speaker_type,
      step,
      text,
      stt_raw_text: stt_raw_text ?? null,
      analysis: analysis ?? null,
      line_source: line_source ?? null,
    })
    .returning()
  return 행
}
