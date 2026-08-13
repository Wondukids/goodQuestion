// 턴별 상태·판정 스냅샷.
//
// 파이썬 `src/goodquestion_admin/저장.py` 의 `턴_조건_*` 갈래를 옮긴 것이다 (이슈 #26).
//
// ## ⭐ 이 표가 없으면 무엇을 못 하나
//
// `story_sessions` 는 매 턴 **덮어쓴다.** 그래서 지난 턴의 모드·누적 요소·카운터가
// 어디에도 안 남고, 턴 로그 화면이 **회차 전체를 그릴 수 없다.**
// 데모에서 「이 턴에 왜 이렇게 판정했나」를 되짚는 자리가 여기다.
//
// ⛔ **`missing_elements` 는 여기에도 저장하지 않는다** (`CLAUDE.md` 경계 5).
//    `required_elements − accumulated_elements` 로 매번 계산한다.
//    ⚠️ 그러니 되살릴 때도 **그 턴의 `accumulated_elements` 와 장면의 `required_elements`**
//       로 다시 빼야 한다. 이 표는 뺄셈의 재료를 남기지 답을 남기지 않는다.
//
// ⚠️ 엔진은 이 표를 모른다 (`sql/003_admin.sql:114`). 부르는 쪽 — `service/turn.ts` 가 받아 적는다.

import { asc, eq } from 'drizzle-orm'

import { messages, turn_conditions } from '@/db/schema'

import type { Conn } from './db'

/** `turn_conditions` 한 행. */
export type TurnConditionRow = typeof turn_conditions.$inferSelect

/** 넣을 값. `[상태]` 줄과 `[판정]` 줄을 그대로 받는다. */
export type TurnConditionInput = typeof turn_conditions.$inferInsert

/**
 * 이번 턴의 상태·판정을 박제한다.
 *
 * ⭐ **같은 `message_id` 로 다시 부르면 덮어쓴다.** 턴당 한 행이어야 하기 때문이고,
 * 관리자 화면이 모드를 바꿔 **판정을 다시 돌리는 것**이 이 레포의 존재 이유라
 * 두 번째 판정이 행을 늘리면 안 된다. `message_id` 가 PK 라 DB 가 그것을 보장한다.
 */
export async function upsertTurnCondition(
  conn: Conn,
  값: TurnConditionInput,
): Promise<TurnConditionRow> {
  const [행] = await conn
    .insert(turn_conditions)
    .values(값)
    .onConflictDoUpdate({ target: turn_conditions.message_id, set: 값 })
    .returning()
  return 행
}

/** 그 아이 메시지의 판정. 없으면 `null`(아직 판정 안 났다). */
export async function readTurnCondition(
  conn: Conn,
  message_id: string,
): Promise<TurnConditionRow | null> {
  const [행] = await conn
    .select()
    .from(turn_conditions)
    .where(eq(turn_conditions.message_id, message_id))
    .limit(1)
  return 행 ?? null
}

/**
 * 회차의 턴 판정 전부를 **아이가 말한 순서대로**.
 *
 * ⚠️ `turn_conditions` 자체에는 순서 칸이 없다. `messages.turn_order` 로 맞춘다 —
 * `current_child_turn_count` 로 세우면 장면이 바뀔 때 1 로 돌아가 뒤섞인다.
 */
export async function readRunTurnConditions(
  conn: Conn,
  run_id: string,
): Promise<TurnConditionRow[]> {
  return conn
    .select({
      message_id: turn_conditions.message_id,
      run_id: turn_conditions.run_id,
      seed_revision: turn_conditions.seed_revision,
      prompt_version: turn_conditions.prompt_version,
      current_child_turn_count: turn_conditions.current_child_turn_count,
      accumulated_elements: turn_conditions.accumulated_elements,
      last_response_mode: turn_conditions.last_response_mode,
      turns_without_new_element: turn_conditions.turns_without_new_element,
      consecutive_low_information_turns: turn_conditions.consecutive_low_information_turns,
      response_mode: turn_conditions.response_mode,
      guidance_target: turn_conditions.guidance_target,
      soft_cue: turn_conditions.soft_cue,
      reaction_key: turn_conditions.reaction_key,
      scene_goal_met: turn_conditions.scene_goal_met,
      scene_end_reason: turn_conditions.scene_end_reason,
    })
    .from(turn_conditions)
    .innerJoin(messages, eq(messages.id, turn_conditions.message_id))
    .where(eq(turn_conditions.run_id, run_id))
    .orderBy(asc(messages.turn_order))
}
