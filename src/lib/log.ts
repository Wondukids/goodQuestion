// 매 턴 콘솔에 찍는 세 줄 (결정 23).
//
// `CLAUDE.md` 「로그」 — **이 로그가 이 레포의 존재 이유다. 지우거나 요약하지 말 것.**
//
// 프롬프트를 고쳐 가며 결과를 **눈으로 비교**하는 게 목적이라 형태가 고정이어야 한다.
// 그래서 없는 값도 자리를 비우지 않고 `null` 로 찍고, 필드 순서를 바꾸지 않는다.
// `web/tests/log.test.ts` 가 글자까지 비교한다.
//
// | 줄 | 무엇 | 필드 순서 |
// |---|---|---|
// | `[분석]` | `utterance_analyses` 에 저장될 4개 + `버림` | 컬럼 표 순서 |
// | `[상태]` | `story_sessions` 에 저장될 값 + `missing_elements` | 컬럼 순서 |
// | `[판정]` | `decide()` 가 돌려준 `Decision` | `decide.ts` 필드 순서 |
//
// 공급자·모델은 `lib/llm/index.ts` 의 `[LLM]` 줄이 찍는다. 여기 중복해 넣지 않는다.
// DB 컬럼명을 그대로 쓴다(`CLAUDE.md` DB 절 — 변환하지 않는다).
//
// 파이썬 `src/goodquestion/log.py` 를 옮긴 것이다 (이슈 #26 말-7).
// 함수 이름 대응은 `docs/설계/코드구조.md` 대응표에 있다 —
// `분석_줄()`·`상태_줄()`·`판정_줄()` → `analysisLine()`·`stateLine()`·`decisionLine()`.

import type { Decision, SessionState } from '@/lib/domain/decide'

/**
 * 분석 LLM 이 낸 요소 하나. `utterance_analyses.detected_elements` 의 원소다.
 *
 * `evidence` 를 `?` 로 둔 것은 이 줄을 만드는 쪽(engine)의 파서가 「없음」을
 * `null` 로 줄지 `undefined` 로 줄지에 로그가 매이지 않게 하려는 것이다. 둘 다 `null` 로 찍는다.
 */
export interface DetectedElementForLog {
  type: string
  evidence?: string | null
}

/**
 * 분석 LLM 출력 4개 (`CLAUDE.md` 경계 1 — 이 넷뿐이다).
 *
 * ⚠️ 여기서 파서의 타입을 import 하지 않는다. 로그는 최하층이라 위층을 몰라야 하고,
 * 구조가 맞으면 그대로 들어온다.
 */
export interface AnalysisForLog {
  child_intent: string
  main_point: string | null
  detected_elements: readonly DetectedElementForLog[]
  utterance_validity: string
}

/** `story_scenes` 한 행 중 장면 줄이 쓰는 칸. 이름은 DB 컬럼 그대로다. */
export interface SceneForLog {
  scene_order: number
  character_name?: string | null
  required_elements?: readonly string[] | null
  preferred_turns?: number | null
  max_turns?: number | null
  scene_description?: string | null
}

/**
 * 한 줄 그대로 출력한다.
 *
 * 파이썬은 rich 를 `soft_wrap=True`·`markup=False` 로 불렀다 — 로그가 접히면 눈으로
 * 비교할 수 없고, 아이 발화에 대괄호가 섞여도 건드리면 안 되기 때문이다.
 * node 의 `console.log` 는 접지도 해석하지도 않으므로 **그냥 넘기는 것이 같은 뜻**이다.
 */
export function printLine(줄: string): void {
  console.log(줄)
}

/**
 * 값 하나를 로그 표기로 바꾼다 (결정 23).
 *
 * 없으면 `null`, 참·거짓은 SQL 표기, 배열은 `[A, B]`.
 * `-` 를 쓰지 않는 이유는 값이 `-` 인 것과 구별이 안 되기 때문이다(결정 11 과 같은 이유).
 *
 * 파이썬에 없던 `undefined` 도 `null` 로 본다 — 자바스크립트에서 「없음」이 둘로 갈릴 뿐
 * 로그가 말하려는 것은 하나다.
 */
function 값(것: unknown): string {
  if (것 === null || 것 === undefined) return 'null'
  if (typeof 것 === 'boolean') return 것 ? 'true' : 'false'
  if (Array.isArray(것)) return '[' + 것.map((하나) => 값(하나)).join(', ') + ']'
  return String(것)
}

/**
 * `REASON("억울하니까")`. evidence 가 없으면 `REASON(null)`.
 *
 * evidence 가 보여야 왜 버려졌는지 알 수 있다 (결정 26).
 */
function 요소_표기(type_: string, evidence: string | null | undefined): string {
  const 근거 = evidence === null || evidence === undefined ? 'null' : `"${evidence}"`
  return `${type_}(${근거})`
}

/**
 * `utterance_analyses` 에 저장될 값 + 후처리가 떨어낸 것.
 *
 * `detected_elements` 는 **LLM 이 낸 원본**이다(저장되는 값과 같다, 결정 26).
 * 버려진 것은 `버림` 에 따로 적는다 — 없으면 `accumulated_elements` 가 왜 안 늘었는지 모른다.
 */
export function analysisLine(
  분석: AnalysisForLog,
  { 버린 }: { 버린: readonly string[] },
): string {
  const 요소들 =
    '[' + 분석.detected_elements.map((요소) => 요소_표기(요소.type, 요소.evidence)).join(', ') + ']'
  const 핵심 = 분석.main_point === null ? 'null' : `"${분석.main_point}"`

  return (
    '[분석]' +
    ` child_intent=${분석.child_intent}` +
    ` main_point=${핵심}` +
    ` detected_elements=${요소들}` +
    ` utterance_validity=${분석.utterance_validity}` +
    ` 버림=${값([...버린])}`
  )
}

/**
 * `story_sessions` 에 저장될 값 (결정 23 — 이번 턴을 반영한 값이다).
 *
 * `missing_elements` 는 DB 에 없는 계산값인데도 찍는다(`CLAUDE.md` 경계 5 — 저장 안 함).
 * `accumulated_elements` 바로 뒤에 두어 `required − accumulated` 를 눈으로 뺄 수 있게 한다.
 *
 * `last_response_mode` 만 **직전** 턴의 값이다. 이번 턴 결과는 `[판정]` 의 `response_mode` 다.
 * 컬럼 이름에 `last_` 가 붙어 있어 헷갈리지 않는다.
 */
export function stateLine(
  상태: SessionState,
  { missing }: { missing: readonly string[] },
): string {
  return (
    '[상태]' +
    ` current_child_turn_count=${상태.current_child_turn_count}` +
    ` accumulated_elements=${값([...상태.accumulated_elements])}` +
    ` missing_elements=${값([...missing])}` +
    ` last_response_mode=${값(상태.last_response_mode)}` +
    ` turns_without_new_element=${상태.turns_without_new_element}` +
    ` consecutive_low_information_turns=${상태.consecutive_low_information_turns}`
  )
}

/** `decide()` 가 돌려준 것. 필드 순서는 `decide.ts` 의 `Decision` 그대로다. */
export function decisionLine(판정: Decision): string {
  return (
    '[판정]' +
    ` response_mode=${판정.response_mode}` +
    ` guidance_target=${값(판정.guidance_target)}` +
    ` soft_cue=${값(판정.soft_cue)}` +
    ` reaction_key=${판정.reaction_key}` +
    ` scene_goal_met=${값(판정.scene_goal_met)}` +
    ` scene_end_reason=${값(판정.scene_end_reason)}`
  )
}

// ---------------------------------------------------------------------------
// 보조 줄 — 매 턴이 아니라 장면 경계와 대사에만 (결정 23)
// ---------------------------------------------------------------------------

/** `[고정]` 이 붙은 줄이 `story_scenes` 원문이고, 안 붙은 줄이 LLM 이 만든 것이다. */
export function dialogueLine(이름: string, 대사: string, { 고정 }: { 고정: boolean }): string {
  const 앞 = 고정 ? '[고정] ' : ''
  return `${앞}${이름}: ${대사}`
}

export function sceneLine(장면: SceneForLog): string {
  return (
    `[장면 ${장면.scene_order}] ${값(장면.character_name)}` +
    ` · required_elements=${값([...(장면.required_elements ?? [])])}` +
    ` preferred_turns=${값(장면.preferred_turns)}` +
    ` max_turns=${값(장면.max_turns)}`
  )
}

export function sceneEndLine(장면: SceneForLog, 판정: Decision): string {
  return (
    `[장면끝 ${장면.scene_order}]` +
    ` scene_end_reason=${값(판정.scene_end_reason)}` +
    ` scene_goal_met=${값(판정.scene_goal_met)}` +
    ` accumulated_elements=${값([...판정.accumulated_elements])}`
  )
}

/** 전개 장면은 지문만 찍고 넘어간다 (결정 22). `messages` 에 넣지 않는다. */
export function narrationLine(장면: SceneForLog): string {
  return `[전개 ${장면.scene_order}] ${장면.scene_description ?? ''}`
}
