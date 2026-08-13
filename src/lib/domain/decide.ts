// 진행 모드·장면 종료·반응 키를 정하는 규칙 함수.
//
// **이 파일은 LLM 을 부르지 않는다** (`CLAUDE.md` 경계 2). 같은 입력이면 항상 같은 답이 나온다.
// ⛔ 아무것도 import 하지 않는다 (`docs/설계/코드구조.md` 1절). eslint 가 막아 뒀다.
//
// 규칙 본문은 `docs/기준/대화작동규칙.md:122-129`(표)와 `:135-145`(같은 내용을 글로 푼 것)에 있고,
// 표의 여러 행이 동시에 참일 때는 **위에서부터 먼저 맞는 행이 이긴다**(결정 4).
// 원문에 없어서 우리가 정한 것은 결정 13~16 이며 아래 각 자리에 결정 번호를 달아 두었다.
//
// ⚠️ 파이썬 `src/goodquestion/decide.py` 를 **있는 그대로** 옮긴 것이다 (이슈 #26 규칙-1).
//    `web/tests/decide.test.ts` 가 파이썬에서 뽑은 황금표와 대조한다.
//    ⭐ 이슈 #27 로 **직전 유도 요소 반복 회피** 하나가 얹혔다(파이썬 `c980947` 과 같은 모양).
//    남은 결점 셋(요소 우선순위 · 유도 세기 값 · 아이 말과의 연결)은 **일부러 안 넣었다** —
//    2026-08-12 사람 결정으로 MVP 뒤로 미뤘다(`notes/issues/27/HANDOFF.md` 「결정 사항」).
//
// ## 이 함수가 전제하는 것 (원문에 없어 정한 읽기)
//
// - `current_child_turn_count` 는 **이번 발화를 포함한 1부터 세는 값**이다.
//   결정 2 의 "2로 두면 아이가 두 턴 만에 필수 요소를 다 말했을 때 장면이 바로 끝난다"가
//   이 읽기를 전제한다. 따라서 첫 아이 발화는 `1`, `max_turns = 4` 면 4번째 발화에서 끝난다.
// - "남은 턴" = `max_turns - current_child_turn_count`.
// - 두 카운터는 **이번 턴까지 반영한 값**으로 규칙을 판정한다.
//   "저정보 2회 연속"은 직전 1회 + 이번 1회를 뜻하기 때문이다.
// - `scene_goal_met` 은 **필수 요소를 다 모았는가**다(종료 여부와 별개).
//   원문에 계산식이 없다(`docs/기준/대화작동규칙.md:114`). 종료로 정의하면 `scene_end_reason` 과
//   겹쳐 정보가 하나 사라지므로, 겹치지 않는 쪽으로 읽었다.
//
// ## 여기서 하지 않는 것
//
// `evidence` 대조로 요소를 버리는 후처리는 **이 함수 앞**에서 끝나 있어야 한다
// (`docs/기준/대화작동규칙.md:108`). 이 함수는 아이 발화 원문을 받지 않는다.
// "약한 당위만 있는 SOLUTION 제외"도 여기서 하지 않는다. 결정 16 의 "기준이 없다"는
// 2026-08-07 인터뷰 Q23 으로 풀렸지만(「무엇을 하는지가 들어 있어야 구체적이다」),
// 그 기준은 `prompts/analysis.md` 의 `SOLUTION` 행이 지고 후처리로는 붙이지 않았다.
// 자세한 것은 `analyze.py` 머리말의 후처리 절.

// 저정보 3종. PLAYFUL 은 들어가지 않는다 (`docs/기준/db구조.md:259`, `docs/기준/대화작동규칙.md:186-189`).
const 저정보_판정: ReadonlySet<string> = new Set(['SHORT', 'UNCLEAR', 'OFF_TOPIC'])

// soft-cue 를 건너뛰는 반응 키 (`docs/기준/대화작동규칙.md:255`)
const SOFT_CUE_스킵: ReadonlySet<string> = new Set([
  'playfulUtterance',
  'questionFromChild',
  'unclearUtterance',
])

// reactionKey 6행 「의견·반박·결정 등」에 해당하는 의도 (`docs/기준/대화작동규칙.md:204`)
const 반박_계열_의도: ReadonlySet<string> = new Set([
  'OPINION',
  'REASONING',
  'DECISION',
  'PERSPECTIVE',
  'REQUEST',
  'CHALLENGE',
])

/**
 * `story_sessions` 에서 오는 현재 장면의 진행 상태.
 *
 * 이름은 DB 컬럼명 그대로다(`CLAUDE.md` DB 절 — 변환하지 않는다).
 */
export interface SessionState {
  current_child_turn_count: number
  accumulated_elements: readonly string[]
  last_response_mode: string | null
  /**
   * 직전에 **유도한** 요소. 직전 **턴**의 대상이 아니다 — 유도가 없던 턴은 이 값을 지우지 않는다.
   * 그 턴에는 캐릭터가 걱정을 아예 안 얹으므로 아이가 들은 말에 걱정이 없다.
   */
  last_guidance_target: string | null
  turns_without_new_element: number
  consecutive_low_information_turns: number
}

/** `story_scenes` 에서 오는 장면 상수. */
export interface SceneConstants {
  required_elements: readonly string[]
  preferred_turns: number
  max_turns: number
}

/**
 * 분석 LLM 출력 4개 중 규칙에 쓰이는 3개.
 *
 * `main_point` 는 규칙에 쓰이지 않아 받지 않는다 (`docs/기준/LLM입출력규격.md:196-201`).
 */
export interface AnalysisResult {
  child_intent: string
  detected_elements: readonly string[]
  utterance_validity: string
}

/**
 * 규칙 함수의 답. 그대로 로그에 찍고 `story_sessions` 에 저장한다.
 *
 * `missing_elements` 는 여기 없다. 저장하지 않고 매번 계산한다(`CLAUDE.md` 경계 5).
 */
export interface Decision {
  response_mode: string // NORMAL / GUIDED / CLOSING
  guidance_target: string | null // 이번 턴의 유도 대상 (GUIDED 또는 soft-cue). 없으면 null
  /**
   * 다음 턴이 기억할 값 → `story_sessions.last_guidance_target` 에 저장한다.
   * 이번 턴에 대상이 있으면 그것, 없으면 **직전 값을 그대로 실어 보낸다**(이슈 #27).
   * 다른 카운터들과 같은 꼴이다 — 규칙 함수가 다음 상태를 내고 부르는 쪽은 저장만 한다.
   */
  last_guidance_target: string | null
  soft_cue: boolean // NORMAL 인데 약한 유도를 얹는가 (결정 15)
  reaction_key: string
  scene_goal_met: boolean
  scene_end_reason: string | null // GOAL_MET / MAX_TURNS
  accumulated_elements: readonly string[]
  turns_without_new_element: number
  consecutive_low_information_turns: number
}

/**
 * 순서를 지키면서 중복을 없앤다 (`docs/기준/대화작동규칙.md:104`, `:108` 중복 제거).
 *
 * 집합을 쓰면 순서가 흔들려 로그를 눈으로 비교할 수 없다.
 */
function union(기존: readonly string[], 새것: readonly string[]): string[] {
  const 쌓은것: string[] = []
  for (const 요소 of [...기존, ...새것]) {
    if (!쌓은것.includes(요소)) 쌓은것.push(요소)
  }
  return 쌓은것
}

/**
 * 부족한 요소 중 하나를 고른다. **직전에 유도한 것이면 한 칸 건너뛴다** (이슈 #27).
 *
 * 기준 문서 12절 409행 「직전에 유도한 요소와 동일한 요소가 반복되지 않도록 **합니다**」.
 * 같은 목록의 410·411행이 「…할 수 **있습니다**」인 것과 달리 **선택형이 아니라서** 넣었다.
 * 14절 469행도 강한 유도의 조건으로 다시 적는다.
 *
 * ⚠️ **제외가 아니라 건너뛰기다.** `missing` 이 하나뿐이면 되돌아온다 —
 * 유도할 것이 그것뿐인데 건너뛰면 장면을 채울 길이 없어진다.
 *
 * 우선순위를 매기지 않는다(결정: 2026-08-12). 배열 순서를 그대로 쓰고 직전 것만 한 칸 민다.
 */
function 유도_대상(missing: readonly string[], 직전: string | null): string {
  for (const 요소 of missing) {
    if (요소 !== 직전) return 요소
  }
  return missing[0]
}

/**
 * `docs/기준/대화작동규칙.md:244-253` 의 표를 결정 13-a 의 순서로 적용한다.
 *
 * 표의 행 순서를 그대로 쓰지 않는 자리가 하나 있다. CLOSING 은 표에서 7행이지만
 * `:206` 이 "CLOSING 턴에서는 의도 매핑을 무시하고 directResponse 를 쓴다"고
 * 못박았고, 명시 문장이 표 배치를 이긴다(결정 13-a).
 */
function reactionKey(
  response_mode: string,
  analysis: AnalysisResult,
  detected: ReadonlySet<string>,
): string {
  const 의도 = analysis.child_intent
  const 유효성 = analysis.utterance_validity

  // 0. CLOSING 이 모든 매핑을 덮는다
  if (response_mode === 'CLOSING') return 'directResponse'

  // 1. 장난·딴소리. validity OFF_TOPIC 도 여기다 (`:188` "playful 반응 쪽")
  if (
    의도 === 'PLAYFUL' ||
    의도 === 'OFF_TOPIC' ||
    유효성 === 'PLAYFUL' ||
    유효성 === 'OFF_TOPIC'
  ) {
    return 'playfulUtterance'
  }

  // 2. 질문
  if (의도 === 'QUESTION') return 'questionFromChild'

  // 3. 방법 제안. 표 3행이 "SOLUTION intent 또는 detected" 이고,
  //    `:200` 의 "(SHORT 보다 우선)" 이 4행보다 앞에 두는 근거다.
  if (의도 === 'SOLUTION' || detected.has('SOLUTION')) return 'proposalFromChild'

  // 4. 짧음·불명확
  if (
    의도 === 'UNCLEAR' ||
    의도 === 'SHORT_RESPONSE' ||
    유효성 === 'SHORT' ||
    유효성 === 'UNCLEAR'
  ) {
    return 'unclearUtterance'
  }

  // 5. 공감. 원문 5행은 두 키가 함께 적혀 있고 갈림 조건이 없다(`:259`).
  //    EMPATHY 가 실제로 잡혔을 때만 이 키를 쓴다(결정 13-b).
  if (detected.has('EMPATHY')) return 'empathyFromChild'

  // 6. 의견·반박·결정
  if (반박_계열_의도.has(의도)) return 'disagreement'

  // 7. 그 외
  return 'directResponse'
}

/** 이번 아이 발화 하나에 대해 다음에 무엇을 할지 정한다. */
export function decide(
  session: SessionState,
  scene: SceneConstants,
  analysis: AnalysisResult,
): Decision {
  const 기존_누적 = [...session.accumulated_elements]
  const detected = [...analysis.detected_elements]

  const 새_누적 = union(기존_누적, detected)
  // `required_elements` 의 배열 순서를 그대로 살린다. 이 순서가 곧 대화 흐름이다(결정 14).
  const missing = scene.required_elements.filter((요소) => !새_누적.includes(요소))

  const 신규_요소_있음 = detected.some((요소) => !기존_누적.includes(요소))
  const 저정보 = 저정보_판정.has(analysis.utterance_validity)

  // 카운터는 둘 다 '연속' 이다 (`docs/기준/db구조.md:265-266`). 끊기면 0 으로 돌아간다.
  const 신규없음_횟수 = 신규_요소_있음 ? 0 : session.turns_without_new_element + 1
  const 저정보_횟수 = !저정보 ? 0 : session.consecutive_low_information_turns + 1

  const turn = session.current_child_turn_count
  const 남은_턴 = scene.max_turns - turn

  let response_mode = 'NORMAL'
  let scene_end_reason: string | null = null
  let guidance_target: string | null = null
  let soft_cue = false

  if (turn >= scene.preferred_turns && missing.length === 0) {
    // 1행 — 최소 턴을 채웠고 필수 요소가 다 모였다
    response_mode = 'CLOSING'
    scene_end_reason = 'GOAL_MET'
  } else if (turn >= scene.max_turns) {
    // 2행 — 요소가 남았어도 최대 턴에서 끝낸다. 마지막 턴의 신규 요소보다 이 행이 앞선다(결정 4).
    response_mode = 'CLOSING'
    scene_end_reason = 'MAX_TURNS'
  } else if (turn === 1 || 신규_요소_있음 || session.last_response_mode === 'GUIDED') {
    // 3행 — NORMAL 강제. 첫 발화 / 이번 턴 신규 요소 / 직전 GUIDED.
    //       직전이 GUIDED 면 이번엔 쉬어 간다(유도가 연속으로 나가지 않게).
    response_mode = 'NORMAL'
  } else if (
    missing.length > 0 &&
    (저정보_횟수 >= 2 || 신규없음_횟수 >= 2 || 남은_턴 <= 2)
  ) {
    // 4행 — 유도. 이 자리에 오면 직전은 GUIDED 가 아니다(3행에서 이미 걸러졌다).
    response_mode = 'GUIDED'
    guidance_target = 유도_대상(missing, session.last_guidance_target)
  }

  const reaction_key = reactionKey(response_mode, analysis, new Set(detected))

  // NORMAL soft-cue (`docs/기준/대화작동규칙.md:131`). 재량이 아니라 조건이 맞으면 항상 넣는다(결정 15).
  if (
    response_mode === 'NORMAL' &&
    신규_요소_있음 &&
    missing.length > 0 &&
    !SOFT_CUE_스킵.has(reaction_key)
  ) {
    soft_cue = true
    // 반복 회피는 soft-cue 에도 똑같이 건다. `last_guidance_target` 이 둘 다 담고
    // (`docs/기준/db구조.md:228`), 짧은 장면에서는 soft-cue 쪽이 더 자주 돈다.
    guidance_target = 유도_대상(missing, session.last_guidance_target)
  }

  return {
    response_mode,
    guidance_target,
    // 대상이 없는 턴은 기억을 지우지 않고 직전 값을 실어 보낸다 (「직전 유도」 기준).
    last_guidance_target: guidance_target ?? session.last_guidance_target,
    soft_cue,
    reaction_key,
    scene_goal_met: missing.length === 0,
    scene_end_reason,
    accumulated_elements: 새_누적,
    turns_without_new_element: 신규없음_횟수,
    consecutive_low_information_turns: 저정보_횟수,
  }
}
