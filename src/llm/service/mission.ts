// 미션의 llm 쪽 문 ① — 트리거·다리 대사·세션 열기 (이슈 #19 · `docs/미션_명세.md` 7절 A·E).
//
// 세션 도메인(`src/session`)은 repo·engine 을 직접 물지 못한다 (이슈 #4 경계 — eslint 가
// 막는다). `sessionPendingTurn()`·`advanceAfterClosing()` 이 그렇게 생긴 문들이고, 미션의
// 문은 둘로 갈렸다:
//
// | 파일 | 무엇 |
// |---|---|
// | 여기 (`mission.ts`) | **일반 턴에 끼는 것** — 트리거·다리 대사(A) · 세션 열기의 미션 칸(E) · 가드 |
// | `mission-turn.ts` | **미션 안에서 도는 것** — 선택 이벤트(B) · 미션 턴(C) · 종료 요약(D) |
//
// 갈라 둔 이유는 방향이다. 이 파일은 `service/run.ts` 가 **부르는** 쪽(손잡이를 끼워 준다)이고,
// `mission-turn.ts` 는 `run.ts` 의 잠금·설정을 **불러다 쓰는** 쪽이다. 한 파일에 두면 순환한다.
//
// ## 🔴 규칙은 여기 없다
//
// 발동 여부는 `domain/mission.decideMissionTrigger()` 가, 대사는 `engine/mission` 이 낸다.
// 이 파일이 하는 일은 순서를 잡고 DB 와 그 둘 사이를 오가는 것뿐이다 (`service/turn.ts` 와 같은 결).

import { decideMissionTrigger } from '@/llm/domain/mission'
import { LookupError, ValueError } from '@/llm/domain/progress'
import { missionReplyTurn } from '@/llm/engine/mission'
import { dialogueLine, printLine } from '@/llm/log'
import { LLMError } from '@/llm/provider'
import { getDb, type Conn } from '@/llm/repo/db'
import {
  abandonMissionSession,
  activeMissionOfSession,
  activeMissionSession,
  completedMissionSession,
  createMissionSession,
  missionOfScene,
  readMission,
  readMissionSession,
  type MissionRow,
  type MissionSessionRow,
} from '@/llm/repo/missions'
import { insertAttempts } from '@/llm/repo/runs'
import {
  clearSceneEnd,
  insertMessage,
  nextMessage,
  overwriteMessageText,
  readSession,
} from '@/llm/repo/sessions'

import type { DialogueStage, MissionHook, MissionStageArgs } from './turn'
import { TurnFailed } from './turn'

// ═══════════════════════════════════════════════════════════════════════════
// 오류 둘 — 명세 7절 E 의 409 두 칸
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 미션이 도는 중이라 일반 턴을 받을 수 없다 (409 `MISSION_IN_PROGRESS`).
 *
 * 재시도해도 같다 — 앱이 할 일은 미션을 마치는 것(`complete`)이지 다시 보내는 것이 아니다.
 */
export class MissionInProgress extends Error {
  constructor(메시지: string) {
    super(메시지)
    this.name = 'MissionInProgress'
  }
}

/** 그 시도가 `in_progress` 가 아니다 (409 `MISSION_NOT_ACTIVE`). 이미 끝났거나 버려진 시도다. */
export class MissionNotActive extends Error {
  constructor(메시지: string) {
    super(메시지)
    this.name = 'MissionNotActive'
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// config — 모양의 정본은 명세 6절 jsonc 다
// ═══════════════════════════════════════════════════════════════════════════

/** `config.items` 한 칸 (prop_choice). */
export interface MissionItem {
  id: string
  name: string
  desc?: string
}

/** `config.steps` 한 칸 (prop_choice). `{item}` 은 아이가 고른 소품 이름으로 바뀐다. */
export interface MissionStep {
  key: string
  expect?: string
  ask: string
}

/** `config.cards` 한 칸 (card_help). `reask` 는 친구마다 다르다 (M9). */
export interface MissionCard {
  id: string
  name: string
  trouble?: string
  reask?: string
}

/**
 * `story_missions.config` 를 읽는 한 벌.
 *
 * ⚠️ 두 미션 유형이 한 타입을 나눠 쓴다 — 쓰지 않는 칸은 `undefined` 다. 유형별로 타입을
 *    가르지 않는 이유는 DB 가 그렇게 저장하기 때문이다(jsonb 한 칸). 어느 칸이 있어야 하는지는
 *    읽는 자리에서 `없으면_터진다()` 로 말한다 — 조용히 빈 문자열로 내려앉지 않는다.
 */
export interface MissionConfig {
  trigger: { any_elements: string[]; min_turns: number }
  items?: MissionItem[]
  steps?: MissionStep[]
  cards?: MissionCard[]
  /** prop_choice 공통 되묻기 문구 (M9). */
  reask?: string
  intro?: string
  ask?: string
  more?: string
  more_pick?: string
  closing?: string
}

/** `config` 를 타입으로 본다. 모양 검사는 `tests/missions.test.ts`(#17) 가 잰다. */
export function missionConfig(mission: MissionRow): MissionConfig {
  return mission.config as unknown as MissionConfig
}

/** 없으면 데이터가 깨진 것이다 — 빈 문자열로 내려앉으면 아이가 빈 말풍선을 본다. */
function 없으면_터진다<T>(값: T | undefined | null, 무엇: string, mission: MissionRow): T {
  if (값 === undefined || 값 === null) {
    throw new ValueError(`${mission.code} 의 config 에 ${무엇} 이(가) 없다`)
  }
  return 값
}

/** prop_choice 의 스텝 key 들 — `decideMissionTurn()` 이 순서대로 받는다. */
export function stepKeys(mission: MissionRow): string[] {
  if (mission.mission_type !== 'prop_choice') return []
  return 없으면_터진다(missionConfig(mission).steps, 'steps', mission).map((스텝) => 스텝.key)
}

/** 소품 한 개. 아이가 고른 id 로 찾는다. */
export function missionItem(mission: MissionRow, id: string): MissionItem {
  const 것 = 없으면_터진다(missionConfig(mission).items, 'items', mission).find((하나) => hasId(하나, id))
  if (것 === undefined) throw new ValueError(`${mission.code} 에 없는 소품이다: ${id}`)
  return 것
}

/** 친구 카드 한 장. */
export function missionCard(mission: MissionRow, id: string): MissionCard {
  const 것 = 없으면_터진다(missionConfig(mission).cards, 'cards', mission).find((하나) => hasId(하나, id))
  if (것 === undefined) throw new ValueError(`${mission.code} 에 없는 친구다: ${id}`)
  return 것
}

function hasId(하나: { id: string }, id: string): boolean {
  return 하나.id === id
}

/**
 * 그 스텝의 고정 질문 (prop_choice). `{item}` 을 아이가 고른 소품 **이름**으로 바꾼다.
 *
 * 치환은 여기 한 자리다 — 프론트에도 같은 문구가 있지만 그쪽은 서버 실패 폴백 사본이다
 * (명세 6절 「대사 정본 주의」).
 */
export function stepAsk(mission: MissionRow, step: string, item_name: string | null): string {
  const 스텝 = 없으면_터진다(missionConfig(mission).steps, 'steps', mission).find(
    (하나) => 하나.key === step,
  )
  if (스텝 === undefined) throw new ValueError(`${mission.code} 에 없는 스텝이다: ${step}`)
  return item_name === null ? 스텝.ask : 스텝.ask.replaceAll('{item}', item_name)
}

// ═══════════════════════════════════════════════════════════════════════════
// 앱에 실어 보낼 미션 한 벌
// ═══════════════════════════════════════════════════════════════════════════

/** 턴 응답의 `next.mission` · 세션 열기의 `mission` — 앱이 팝업을 여는 데 필요한 넷 (명세 7절 A·E). */
export interface MissionStart {
  mission_session_id: string
  code: string
  mission_type: string
  /** 소품·카드·스텝·고정 대사 한 벌. 프론트가 화면을 그리는 재료다. */
  config: Record<string, unknown>
}

function 미션시작(시도: MissionSessionRow, mission: MissionRow): MissionStart {
  return {
    mission_session_id: 시도.id,
    code: mission.code,
    mission_type: mission.mission_type,
    config: mission.config,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 가드 — 미션 진행 중에는 일반 턴을 받지 않는다 (명세 7절 E)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 이 세션에서 지금 도는 중인 미션 시도. 없으면 `null`.
 *
 * 세션 도메인이 일반 턴 앞에서 부르는 문이다 — 있으면 409 `MISSION_IN_PROGRESS` 다.
 */
export async function activeMission(args: {
  session_id: string
  conn?: Conn
}): Promise<MissionSessionRow | null> {
  return activeMissionOfSession(args.conn ?? getDb(), args.session_id)
}

/**
 * 미션 API 세 개가 입구에서 부르는 문 — 시도 한 벌을 확인하고 재료를 함께 준다.
 *
 * - 그 id 가 없거나 **다른 세션의 시도**면 404 (`LookupError`) — 남의 시도를 열어 보지 못한다.
 * - `in_progress` 가 아니면 409 `MISSION_NOT_ACTIVE`. ⚠️ `complete` 는 반복 안전이라
 *   이 문을 그대로 쓰지 않는다 (`completed` 를 다시 받아야 한다 — `mission-turn.ts` 참고).
 */
export async function readMissionAttempt(args: {
  session_id: string
  mission_session_id: string
  conn?: Conn
}): Promise<{ attempt: MissionSessionRow; mission: MissionRow }> {
  const conn = args.conn ?? getDb()
  const attempt = await readMissionSession(conn, args.mission_session_id)
  if (attempt === null || attempt.session_id !== args.session_id) {
    throw new LookupError(`미션 시도가 없다: ${args.mission_session_id}`)
  }
  const mission = await readMission(conn, attempt.mission_id)
  if (mission === null) throw new LookupError(`미션 정의가 없다: ${attempt.mission_id}`)
  return { attempt, mission }
}

// ═══════════════════════════════════════════════════════════════════════════
// A. 트리거 — ② 와 ③ 사이에 끼는 손잡이 (명세 7절 A)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 미션 손잡이 한 개 — **한 턴에 하나씩 새로 만든다.**
 *
 * `afterDecision()` 이 발동을 판정하고, 발동했으면 `started` 에 앱에 실어 보낼 한 벌이 담긴다.
 * 조립층은 그 값을 `next: 미션시작` 으로 옮기기만 한다 (`src/session/service/turn.ts`).
 */
export interface MissionTrigger extends MissionHook {
  /** 이 턴이 미션을 시작했으면 그 한 벌, 아니면 `null`. */
  readonly started: MissionStart | null
}

/**
 * 판단 단계 직후에 부를 손잡이를 만든다 (명세 5절 · M1).
 *
 * 하는 일 넷:
 * 1. 그 씬에 미션이 있나 · **완료된 시도가 없나** — 둘 중 하나라도 아니면 아무 일도 없다
 * 2. `decideMissionTrigger()` — 규칙은 순수 함수가 안다. 여기서 다시 쓰지 않는다
 * 3. 발동이면 `mission_sessions` 행 하나 (이미 있으면 그 행 — **반복 안전**)
 * 4. 닫힘을 눌렀으면 씬 종료 사유를 무르고, ③ 대신 **다리 대사**를 만든다
 *
 * ⚠️ 3 이 「이미 있으면 그 행」인 것이 이어 돌리기(resume)를 떠받친다. 다리 대사에서 죽은 턴은
 *    행이 이미 있는 채로 다시 오고, 그때 두 번째 행을 만들면 `ux_mission_sessions_active` 가
 *    튕긴다. 그래서 **판정 커밋에서 생긴 행을 그대로 쓴다** (명세 7절 A 마지막 문단).
 */
export function missionTrigger(): MissionTrigger {
  let started: MissionStart | null = null

  return {
    get started() {
      return started
    },

    async afterDecision(args: MissionStageArgs): Promise<DialogueStage | null> {
      const { conn, session_id, scene } = args

      // 1 ─ 미션 없는 씬(대화1·2)은 여기서 끝난다. 트리거도 닫힘 게이트도 없다.
      const mission = await missionOfScene(conn, scene.scene_id)
      if (mission === null) return null
      const 완료 = await completedMissionSession(conn, { session_id, mission_id: mission.id })
      if (완료 !== null) return null

      // 2 ─ 규칙. 세션 행은 ② 가 갱신한 **뒤**라 턴 수·누적이 이번 발화를 포함한다 —
      //     `decide()` 가 본 값과 같다 (`domain/mission.ts` 의 `MissionSceneState` 주석).
      const 세션 = await readSession(conn, session_id)
      const 판정 = decideMissionTrigger(
        missionConfig(mission).trigger,
        {
          current_child_turn_count: 세션.current_child_turn_count,
          accumulated_elements: 세션.accumulated_elements,
        },
        { detected_elements: args.detected_elements },
        { response_mode: args.response_mode },
      )

      // 3 ─ 이미 열린 시도가 있으면 **그 턴이 발동 턴이다** — 규칙을 다시 묻지 않는다.
      //     (요소·턴 수는 늘기만 해서 판정도 같지만, 근거는 「행이 있다」 쪽이 강하다.)
      const 열린것 = await activeMissionSession(conn, { session_id, mission_id: mission.id })
      if (열린것 === null && !판정.triggered) return null

      const 시도 = 열린것 ?? (await createMissionSession(conn, { session_id, mission_id: mission.id }))

      // 4 ─ 닫힘 게이트. ② 가 적어 둔 종료 사유를 무르지 않으면 다리 대사 직후 씬이 닫힌다.
      if (판정.closing_overridden) await clearSceneEnd(conn, session_id)

      const dialogue = await 다리_대사(args, mission)
      started = 미션시작(시도, mission)
      return dialogue
    },
  }
}

/**
 * 다리 대사 한 줄을 만들어 `messages` 캐릭터 행으로 남긴다 (③ 의 미션판).
 *
 * `runDialogueStage()` 와 갈리는 자리 셋:
 *
 * - 부르는 것이 `characterTurn()` 이 아니라 `missionReplyTurn(direction_kind:'bridge_into_mission')`
 *   이다 (명세 9절). 고정 닫는 말 갈림이 없으므로 `source` 는 언제나 `generated` 다.
 * - **경계 채점을 안 돌린다.** 심판 셋은 캐릭터 프롬프트의 경계(`response_mode`·유도 과녁)를
 *   재는데 다리 대사에는 그 칸이 없다 — 재료가 없는 채로 돌리면 늘 「판정 안 함」이다.
 * - 미션 대화(`mission_messages`)는 아직 한 줄도 없다. 팝업이 열리기 전이다.
 *
 * ⚠️ 같은 턴의 캐릭터 행이 이미 있으면 **덮어쓴다** — ③ 재호출·이어 돌리기와 같은 규칙이다
 *    (`runDialogueStage()` 의 「바로 다음 한 행」).
 */
async function 다리_대사(args: MissionStageArgs, mission: MissionRow): Promise<DialogueStage> {
  const { conn, run_id, session_id, scene, child_message_id, turn_order } = args

  args.notify?.('다리 대사 시작', mission.code)

  let 결과
  try {
    결과 = await missionReplyTurn({
      scene,
      mission: {
        mission_goal: mission.mission_goal,
        // 팝업이 아직 안 열려 스텝도 선택도 없다. 프롬프트는 빈 칸을 「아직 아니다」로 읽는다.
        step: null,
        question: null,
        selection: null,
      },
      child_utterance: args.child_utterance,
      main_point: args.main_point,
      direction_kind: 'bridge_into_mission',
      settings: args.settings,
      notify: args.notify,
    })
  } catch (오류) {
    if (오류 instanceof LLMError) {
      // 사유를 기록에 남기고 던진다 — 흘리면 `llm_calls` 에 한 건도 안 남는다 (결정 33).
      // ⚠️ 이 행들의 `purpose` 는 `mission_reply` 라 관리자 화면의 「③ 이 실패했다」 띠
      //    (`turnFailureState()` — 단계 이름과 같은 purpose 만 센다) 에는 안 잡힌다.
      //    아이 앱은 502 로 받고 resume 을 부르므로 계약에는 영향이 없다.
      if (오류.attempts.length > 0) {
        await conn.transaction(async (tx) => {
          await insertAttempts(tx, { run_id, message_id: child_message_id, attempts: 오류.attempts })
        })
      }
      throw new TurnFailed(오류, {
        child_message_id,
        stage: 'character',
        attempts: 오류.attempts,
      })
    }
    throw 오류
  }

  const 글 = 결과.line
  if (글 === null) throw new ValueError(`${mission.code}: 다리 대사가 비었다`)

  const 다음 = await nextMessage(conn, { session_id, turn_order })
  const 덮어쓸_행 =
    다음 !== null && 다음.speaker_type === 'character' && 다음.scene_id === scene.scene_id
      ? 다음
      : null

  const 행 = await conn.transaction(async (tx) => {
    const 저장된 =
      덮어쓸_행 === null
        ? await insertMessage(tx, {
            session_id,
            scene_id: scene.scene_id,
            speaker_type: 'character',
            text: 글,
          })
        : await overwriteMessageText(tx, { message_id: 덮어쓸_행.id, text: 글 })
    if (결과.llm !== null) {
      await insertAttempts(tx, { run_id, message_id: child_message_id, attempts: 결과.llm.attempts })
    }
    return 저장된
  })

  printLine(dialogueLine(scene.character_name ?? '', 글, { 고정: false }))

  return {
    message_id: 행.id,
    turn_order: 행.turn_order,
    text: 글,
    source: 'generated',
    overwritten: 덮어쓸_행 !== null,
    llm: 결과.llm,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// E. 세션 열기의 미션 칸 (명세 7절 E · M4)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 세션 열기 응답에 실을 `mission` (명세 7절 E).
 *
 * | 그 씬의 상태 | 내는 것 |
 * |---|---|
 * | 미션이 없다 · 아직 발동 전 | `null` — 팝업을 열지 않는다 |
 * | 완료된 시도가 있다 | `null` — **다시 노출하지 않는다** |
 * | `in_progress` 시도가 남아 있다 | 그 시도를 `abandoned` 로 접고 **새 시도**를 실어 준다 (M4) |
 *
 * 마지막 칸이 이 함수가 상태를 바꾸는 유일한 자리다. 「재개는 처음부터」라 이어 붙일 것이
 * 없고, 합산된 요소는 `story_sessions` 에 남아 있어 손해가 없다.
 */
export async function missionForOpen(args: {
  session_id: string
  scene_id: string
  conn?: Conn
}): Promise<MissionStart | null> {
  const conn = args.conn ?? getDb()

  const mission = await missionOfScene(conn, args.scene_id)
  if (mission === null) return null
  const session_id = args.session_id
  if ((await completedMissionSession(conn, { session_id, mission_id: mission.id })) !== null) {
    return null
  }

  const 남은것 = await activeMissionSession(conn, { session_id, mission_id: mission.id })
  if (남은것 === null) return null

  // 접고 새로 연다. 부분 유니크 인덱스가 「진행 중은 하나」를 지키므로 순서가 중요하다.
  const 새것 = await conn.transaction(async (tx) => {
    await abandonMissionSession(tx, 남은것.id)
    return createMissionSession(tx, { session_id, mission_id: mission.id })
  })
  return 미션시작(새것, mission)
}
