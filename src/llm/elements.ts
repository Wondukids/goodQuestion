// 사고 요소 코드의 **화면용 한국어 이름** (이슈 #26 조립-4).
//
// 파이썬 `src/goodquestion_admin/요소.py` 를 **있는 그대로** 옮긴 것이다.
//
// 아이 발화에서 찾는 사고 요소는 8종이고, 코드는 영문이다(`EMOTION` 등).
// 프롬프트·DB·보존 로그는 **영문 코드 그대로** 두고, 이 표는 **화면에만** 쓴다.
// (`docs/설계/코드구조.md` 3절 — 사고 요소 코드는 바꾸지 않는다. 바꾸면 대조가 깨진다.)
//
// ⛔ 아무것도 import 하지 않는다. 표 하나이고, 어느 층에서든 화면 이름이 필요할 뿐이다.
//
// ## 뜻은 정본에 있다
//
// 8종의 뜻은 정본 `발화 분석 및 진행 판단 연동 기준:143~152` 에 한 줄씩 정의돼 있고,
// `docs/재분석_기획과구현정책.md:138~145` 가 옮겨 적어 두었다.
// 여기서 정하는 것은 **뜻이 아니라 이름표**다 (2026-08-10 결정 4).
//
// ## 무너뜨리면 안 되는 구분
//
// `EMOTION` 은 감정을 **말하는** 것이고 `EMPATHY` 는 감정을 **헤아리고 배려하는** 것이다.
// 「감정 / 공감」이 이 선을 지킨다. 나중에 이름을 다시 손대더라도 둘을 한 말로 합치지 마라.

/** 요소 하나의 이름표. 파이썬의 `(화면 이름, 정본의 뜻)` 짝이다. */
export interface ElementLabel {
  /** 화면에 쓸 한국어 이름 */
  이름: string
  /** 정본이 적어 둔 한 줄 정의 */
  뜻: string
}

// 코드 → (화면 이름, 정본의 뜻)
// 뜻은 `docs/재분석_기획과구현정책.md:138~145` 의 표를 그대로 옮긴 것이다.
export const 요소: Readonly<Record<string, ElementLabel>> = {
  EMOTION: { 이름: '감정', 뜻: '자신이나 다른 인물의 감정을 직접 표현함' },
  EMPATHY: { 이름: '공감', 뜻: '다른 사람의 감정이나 어려움을 이해하고 배려함' },
  PERSPECTIVE: { 이름: '입장', 뜻: '다른 인물의 상황이나 입장을 고려함' },
  REASON: { 이름: '까닭', 뜻: '판단, 의견, 선택, 요청 등의 까닭을 말함' },
  SOLUTION: { 이름: '해결', 뜻: '문제를 줄이거나 해결할 구체적인 행동과 방법을 제시함' },
  RESULT: { 이름: '결과', 뜻: '행동이나 상황 이후의 결과를 설명하거나 예상함' },
  REQUEST: { 이름: '요청', 뜻: '특정 상대에게 행동, 말, 태도의 변화를 요구함' },
  DECISION: { 이름: '선택', 뜻: '선택하거나 자신의 입장을 정함' },
}

/** 화면에 쓸 한국어 이름. 모르는 코드는 **그대로 돌려준다** — 새 코드가 생겨도 화면이 안 깨진다. */
export function elementName(코드: string): string {
  return 요소[코드]?.이름 ?? 코드
}

/** 정본이 적어 둔 한 줄 정의. 없으면 빈 문자열. */
export function elementMeaning(코드: string): string {
  return 요소[코드]?.뜻 ?? ''
}

/**
 * `elementNames()` 가 받는 한 칸. 코드 글자이거나, 분석 LLM 이 낸 묶음이다.
 *
 * 묶음 쪽을 `{ type }` 으로 좁히지 않는다 — DB jsonb 에서 그대로 올라온 행이라
 * `evidence` 말고 무엇이 더 붙어 있어도 화면은 `type` 만 본다.
 */
export type ElementLike = string | { type?: string | null; [칸: string]: unknown }

/**
 * 요소 코드 목록을 화면 이름 목록으로. 비어 있으면(`null`·`undefined`·빈 배열) 빈 목록.
 *
 * 두 가지 모양이 들어온다.
 *
 * - `story_scenes.required_elements` — 코드 글자 목록 (`["EMOTION", ...]`)
 * - `analyses.detected_elements` — 분석 LLM 이 낸 묶음 목록
 *   (`[{"type": "EMOTION", "evidence": "..."}, ...]`. `lib/engine/analyze.ts` 의 `DetectedElement`)
 *
 * 묶음이 오면 `type` 을 꺼내고 같은 코드는 한 번만 남긴다 —
 * `goldenset._정답라벨_파싱` 이 쓰는 방식과 같다(같은 `type` 이 근거만 달리해 여러 번
 * 올 수 있다). 파이썬에서는 이걸 안 펴면 검수 화면이 `unhashable type: 'dict'` 로 죽었다.
 *
 * ⚠️ 중복은 **코드**로 거른다(이름으로가 아니다). 모르는 코드가 섞여도 그 코드 글자가
 *    그대로 이름 자리에 남는다 — 조용히 빈칸이 되지 않는다.
 */
export function elementNames(코드들: readonly ElementLike[] | null | undefined): string[] {
  if (!코드들 || 코드들.length === 0) return []
  const 코드: string[] = []
  for (const 항 of 코드들) {
    const 값 = typeof 항 === 'object' && 항 !== null ? 항.type : 항
    // 파이썬의 `값 is not None` 과 같은 자리다 — `type` 이 없는 묶음만 건너뛴다.
    if (값 !== null && 값 !== undefined && !코드.includes(값)) 코드.push(값)
  }
  return 코드.map(elementName)
}
