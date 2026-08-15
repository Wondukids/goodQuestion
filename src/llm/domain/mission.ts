// 미션(미니게임)의 트리거와 미션 턴을 정하는 규칙 함수 (이슈 #18 · `docs/미션_명세.md` 4·5절).
//
// **이 파일은 LLM 을 부르지 않는다** — `decide.ts` 와 같은 결이다. 같은 입력이면 항상 같은 답.
// ⛔ 아무것도 import 하지 않는다 (`decide.ts`·`progress.ts` 와 같은 규칙). 그래서 config 의
//    입력 타입도 여기서 plain 으로 자체 정의한다 — config 모양의 정본은 명세 6절의 jsonc 이고,
//    드리즐 스키마(`src/llm/db/**`)는 #17 트랙 소유라 물지 않는다.
//
// ## 두 함수의 자리 (명세 4절 표)
//
// - `decideMissionTrigger()` — **판단 단계(`decide()`) 직후**에 부른다 (명세 5절 · M1).
//   ⚠️ 부르는 쪽이 「그 씬에 미션이 정의돼 있고 완료된 시도가 없다」를 보장한다.
//   미션 없는 씬(대화1·2)은 이 함수를 아예 부르지 않는다 — 닫힘 게이트 자체가 없다.
// - `decideMissionTurn()` — 팝업 안 아이 발화 하나를 판정한다 (명세 4절 ③).
//   일반 턴의 `decide()` 자리에 끼는 미션판이다. 분석(②)은 기존 `analyze()` 그대로다(M2).
//
// ## 여기서 하지 않는 것
//
// - `evidence` 대조로 요소를 버리는 후처리는 **이 함수 앞**에서 끝나 있어야 한다 —
//   `decide()` 와 같은 전제다. `detected_elements` 는 후처리(`postProcess`)를 통과한
//   type 글자 목록이다.
// - 씬 턴 수·유도 카운터(`current_child_turn_count` · `turns_without_new_element` ·
//   `consecutive_low_information_turns` · `last_guidance_target`)는 **답에 아예 없다**(M3).
//   없는 칸은 저장할 수 없다 — 「건드리지 않는다」를 모양으로 지킨다.

/**
 * 부르는 쪽이 잘못된 인자를 줬다는 갈래. `progress.ts` 의 `ValueError` 와 같은 자리인데,
 * 이 파일은 아무것도 import 하지 않으므로 같은 모양을 다시 세운다.
 */
export class ValueError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValueError'
  }
}

// 되묻기 사유 2종 (M9). ⚠️ `decide.ts` 의 저정보 3종과 다르다 — OFF_TOPIC 은 되묻지 않는다.
// 프론트의 「6자 미만」 클라이언트 규칙을 이 판정이 대체한다.
const 되묻는_판정: ReadonlySet<string> = new Set(['SHORT', 'UNCLEAR'])

/**
 * `story_missions.config.trigger` (명세 6절 jsonc 가 정본).
 *
 * 미션1 `{ any_elements: ['SOLUTION'], min_turns: 2 }` ·
 * 미션2 `{ any_elements: ['PERSPECTIVE'], min_turns: 2 }`. 규칙은 데이터다(M1) —
 * 여기 코드에는 요소 이름이 한 글자도 없다.
 */
export interface MissionTriggerConfig {
  /** 이 중 하나라도 (이번 감지 ∪ 씬 누적)에 있으면 발동 */
  any_elements: readonly string[]
  /** 요소가 안 잡혀도 씬의 아이 턴 수가 이만큼이면 발동 — 기획 「2회 이상 대화」 폴백 */
  min_turns: number
}

/**
 * `story_sessions` 에서 오는 현재 장면의 진행 상태 중 트리거가 보는 두 칸.
 *
 * 이름은 DB 컬럼명 그대로다 (`decide.ts` 와 같은 규칙 — 변환하지 않는다).
 */
export interface MissionSceneState {
  /** 이번 발화를 포함한 1부터 세는 값 — `decide()` 와 같은 읽기다 */
  current_child_turn_count: number
  /**
   * 씬 누적. 이번 감지와 합집합으로만 쓰므로 `decide()` 호출 전 값을 주든
   * `decide()` 가 낸 반영 후 값을 주든 답이 같다.
   *
   * 누적까지 보는 이유: 미션을 중도 이탈(`abandoned` — M4)해도 합산된 요소는 남아,
   * 복귀 뒤 새 감지가 없는 턴에도 다시 발동해야 하기 때문이다(명세 8절).
   */
  accumulated_elements: readonly string[]
}

/** 분석 LLM 출력 중 트리거가 쓰는 하나. `utterance_validity` 는 트리거 규칙에 안 쓰여 받지 않는다. */
export interface TriggerAnalysis {
  detected_elements: readonly string[]
}

/** `decide()` 의 답 중 닫힘 게이트가 보는 한 칸. */
export interface TriggerDecision {
  response_mode: string
}

/**
 * 트리거 판정의 답.
 *
 * | 칸 | 무엇 |
 * |---|---|
 * | `triggered` | 이번 턴에 미션을 시작하는가 — 참이면 다리 대사 + `next: 미션시작` (명세 7절 A) |
 * | `trigger_reason` | ELEMENT / MIN_TURNS / CLOSING_GATE. 여럿이 겹치면 이 순서의 첫 것. 미발동이면 null |
 * | `closing_overridden` | 이번 턴의 CLOSING 을 버리고 트리거로 갔는가 — 참이면 씬을 닫지 않는다 (명세 5절 게이트) |
 */
export interface MissionTrigger {
  triggered: boolean
  trigger_reason: string | null
  closing_overridden: boolean
}

/**
 * 이번 아이 발화(일반 턴)에 대해 미션을 시작할지 정한다 (명세 5절 · M1).
 *
 * ```
 * 발동 = (any_elements 중 하나 ∈ 이번 감지 ∪ 씬 누적)
 *     OR (씬의 아이 턴 수 ≥ min_turns)
 *     OR (decide() 가 CLOSING)          ← 닫힘 게이트
 * ```
 *
 * 닫힘 게이트: 미션 씬에서 미션 완료 전에 `decide()` 가 CLOSING 을 내면 CLOSING 대신
 * 트리거를 발동한다 — 기획의 「미션 필수 장면에서는 미션과 핵심 발화가 완료된 경우」의
 * 코드화다. M7(미션2 즉발)은 규칙이 아니라 데이터다 — PERSPECTIVE 가 첫 턴에 잡히면
 * ELEMENT 로 그냥 발동한다.
 */
export function decideMissionTrigger(
  trigger: MissionTriggerConfig,
  session: MissionSceneState,
  analysis: TriggerAnalysis,
  decision: TriggerDecision,
): MissionTrigger {
  const 보이는_요소 = new Set([...analysis.detected_elements, ...session.accumulated_elements])
  const 요소_발동 = trigger.any_elements.some((요소) => 보이는_요소.has(요소))
  const 턴수_발동 = session.current_child_turn_count >= trigger.min_turns
  const 닫힘_게이트 = decision.response_mode === 'CLOSING'

  const triggered = 요소_발동 || 턴수_발동 || 닫힘_게이트
  const trigger_reason = 요소_발동
    ? 'ELEMENT'
    : 턴수_발동
      ? 'MIN_TURNS'
      : 닫힘_게이트
        ? 'CLOSING_GATE'
        : null

  // 게이트가 아니어도(요소·턴수로 발동해도) CLOSING 턴이면 닫힘을 누른다 —
  // 씬은 미션 완료 뒤 complete(명세 7절 D)의 산식으로만 닫힌다.
  return { triggered, trigger_reason, closing_overridden: triggered && 닫힘_게이트 }
}

/**
 * 미션 턴의 진행 상태. `mission_sessions`·`mission_messages` 를 보고 부르는 쪽이 만든다.
 */
export interface MissionTurnState {
  /** 지금 스텝 key — 'use'·'request'(미션1) 또는 친구 카드 id(미션2). 선택 이벤트(명세 7절 B)가 정해 둔 값이다 */
  step: string
  /** 이 스텝에서 이미 되물었는가 (M9 — 스텝당 1회). `mission_messages` 를 보고 부르는 쪽이 센다 */
  reask_used: boolean
  /** 씬 누적 — `story_sessions.accumulated_elements` */
  accumulated_elements: readonly string[]
}

/** `story_missions` 한 행 중 턴 판정이 보는 것. */
export interface MissionConstants {
  /** 'prop_choice'(미션1) / 'card_help'(미션2) */
  mission_type: string
  /** prop_choice: config.steps 의 key 를 순서대로 (['use','request']). card_help 는 빈 배열 — 스텝은 카드 선택이 정한다 */
  step_keys: readonly string[]
}

/** `story_scenes` 에서 오는 장면 상수 중 턴 판정이 보는 하나. */
export interface MissionSceneConstants {
  required_elements: readonly string[]
}

/** 분석 LLM 출력 중 미션 턴 규칙에 쓰이는 둘. `child_intent`·`main_point` 는 규칙에 안 쓰여 받지 않는다. */
export interface MissionTurnAnalysis {
  detected_elements: readonly string[]
  utterance_validity: string
}

/**
 * 미션 턴 판정의 답. 요소 합산분과 스텝 진행뿐이다 —
 * 씬 턴 수·유도 카운터 칸은 **없다**(M3). 부르는 쪽이 실수로도 저장할 수 없다.
 */
export interface MissionTurnDecision {
  /**
   * 되묻기 지시 (M9). 참이면 대사를 생성하지 않고(`dialogue: null`) 같은 스텝을 유지한다.
   * 되묻기 문구는 config 고정 대사다 — 미션1은 `config.reask`, 미션2는 친구별 `reask`.
   */
  reask: boolean
  /** 이번 발화로 **새로** 합산되는 요소 — 씬 누적에 없던 것만. 응답의 `elements.gained` 자리다 */
  gained_elements: readonly string[]
  /** 합산 후 씬 누적 → `story_sessions.accumulated_elements` 에 그대로 저장한다 */
  accumulated_elements: readonly string[]
  /** required − 누적. 저장하지 않고 매번 계산한다 (`decide.ts` 와 같은 원칙) */
  missing_elements: readonly string[]
  /** 다음 스텝 key. 되묻기면 지금 스텝 그대로, 더 없으면 null */
  next_step: string | null
  /** prop_choice 의 마지막 스텝을 정상 진행으로 마쳤다 — `next.kind: 미션끝`. card_help 는 항상 false(종료는 선택 이벤트가 정한다) */
  steps_done: boolean
}

/**
 * 순서를 지키면서 중복을 없앤다 — `decide.ts` 의 `union()` 과 같은 함수다.
 * import 0 규칙이라 같은 모양을 다시 둔다. 집합을 쓰면 순서가 흔들려 로그를 눈으로 비교할 수 없다.
 */
function union(기존: readonly string[], 새것: readonly string[]): string[] {
  const 쌓은것: string[] = []
  for (const 요소 of [...기존, ...새것]) {
    if (!쌓은것.includes(요소)) 쌓은것.push(요소)
  }
  return 쌓은것
}

/**
 * 미션 안 아이 발화 하나를 판정한다 (명세 4절 ③ · M3 · M9).
 *
 * `decide()` 와 갈리는 자리:
 *
 * - 모드(NORMAL/GUIDED/CLOSING)가 없다 — 미션 턴은 유도하지 않고 씬을 닫지 않는다.
 *   씬 닫힘은 미션 완료 뒤 complete(명세 7절 D)의 산식 몫이다.
 * - 요소는 **되묻기 턴에도** 합산한다 — M3 은 「미션 발화의 요소는 씬 누적에 합산」이고
 *   되묻기 예외를 두지 않았다 (SHORT 발화는 어차피 요소가 거의 없다).
 * - 되묻기는 스텝당 1회다. 두 번째도 짧으면 그대로 진행한다 — 아이를 붙잡아 두지 않는다.
 */
export function decideMissionTurn(
  state: MissionTurnState,
  mission: MissionConstants,
  scene: MissionSceneConstants,
  analysis: MissionTurnAnalysis,
): MissionTurnDecision {
  const 기존_누적 = [...state.accumulated_elements]
  const detected = [...analysis.detected_elements]

  const gained: string[] = []
  for (const 요소 of detected) {
    if (!기존_누적.includes(요소) && !gained.includes(요소)) gained.push(요소)
  }
  const 새_누적 = union(기존_누적, detected)
  // `required_elements` 의 배열 순서를 그대로 살린다 (`decide.ts` 결정 14 와 같은 읽기).
  const missing = scene.required_elements.filter((요소) => !새_누적.includes(요소))

  const reask = 되묻는_판정.has(analysis.utterance_validity) && !state.reask_used

  let next_step: string | null
  let steps_done = false
  if (reask) {
    next_step = state.step
  } else if (mission.mission_type === 'prop_choice') {
    const 자리 = mission.step_keys.indexOf(state.step)
    if (자리 === -1) {
      throw new ValueError(`스텝이 step_keys 에 없다: ${state.step}`)
    }
    next_step = 자리 + 1 < mission.step_keys.length ? mission.step_keys[자리 + 1] : null
    steps_done = next_step === null
  } else {
    // card_help — 이 카드의 발화 스텝이 끝났다. 다음 카드로 갈지, 미션을 끝낼지는
    // 선택 이벤트(`more`)가 정하므로 여기서는 null 만 낸다 (명세 8절 미션2 순환).
    next_step = null
  }

  return {
    reask,
    gained_elements: gained,
    accumulated_elements: 새_누적,
    missing_elements: missing,
    next_step,
    steps_done,
  }
}
