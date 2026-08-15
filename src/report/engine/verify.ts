// LLM 이 낸 것을 **재료 원문과 맞춰 보고 어긋나면 버린다** (이슈 #37 · 명세 5.2·5.3).
//
// 🔴 **이 파일이 P-3 갈래의 핵심이다.** 리포트에는 아이 발화가 따옴표 안에 그대로 실린다.
//    LLM 이 없는 발화를 지어내 그 따옴표를 채우면, 보호자는 **자기 아이가 하지 않은 말을
//    아이가 한 말로 읽는다.** 프롬프트로도 조이지만(`[A-QUOTEID]` · `[G-QUOTEID]`),
//    프롬프트는 지켜지기를 바라는 것이고 이 파일은 **지켜지지 않아도 막는 것**이다.
//
// 방식은 새것이 아니다 — 심판이 「위반」이라면서 대사에 없는 문장을 근거로 대면 그 판정을
// 버리는 자리가 이미 있다(`src/llm/judge.ts:428`). 거기서 쓰는 `skeleton()` 을 그대로 쓴다.
//
// ## 두 가지를 대조한다
//
// | 무엇 | 어떻게 | 어긋나면 |
// |---|---|---|
// | 인용 id | `quotes[]` 안에 그 `message_id` 가 있나 | 카드는 인용만 비운다 · 질문은 통째로 버린다 |
// | 낱말 | 아이 발화 글자 안에 그 낱말이 있나 | 그 낱말만 버린다 |
//
// **인용 id 는 정확 일치, 낱말은 그럴 수 없다.** 왜 그런지는 `낱말_후보들()` 머리말에 있다.
//
// ## ⛔ 이 파일이 안 하는 것
//
// LLM 도 DB 도 시각도 모른다. 순수 함수만 있다 — 검사가 가짜 응답 한 덩이를 그대로
// 넣어 볼 수 있어야 하기 때문이다(`tests/report-narrative.test.ts`).
// 「새 낱말인가」 판정은 여기가 아니라 규칙(이슈 #36 · `child_words` 대조)이 한다.

import { skeleton } from '@/llm/judge'
import { 요소 } from '@/llm/elements'
import type { Quote, SkillCard, StoryQuestion } from '@/report/types'

/** 사고 요소 8종 코드. 화면 이름표 표(`src/llm/elements.ts`)가 정본이다. */
export const 요소_코드: readonly string[] = Object.keys(요소)

/**
 * 어간을 줄여 가며 찾을 때의 **최소 길이**. 2 다.
 *
 * 1 로 내리면 「가다」의 「가」가 아무 발화에나 걸리고, 3 으로 올리면 두 글자 어간
 * (「참다」→「참」)을 통째로 못 찾는다. ⚠️ 실측 없이 정한 값이라 여기 한 곳에 둔다.
 */
export const 최소_어간_길이 = 2

// ── 인용 id ────────────────────────────────────────────────────────────────

/** `quotes[]` 가 가진 id 들. 이 밖의 id 는 인용될 수 없다 (명세 5.2). */
export function 인용_id_집합(quotes: readonly Quote[]): Set<string> {
  return new Set(quotes.map((인용) => 인용.message_id))
}

/** id 로 인용 하나를 찾는다. 없으면 `null`. */
export function 인용_찾기(quotes: readonly Quote[], id: string | null): Quote | null {
  if (id === null) return null
  return quotes.find((인용) => 인용.message_id === id) ?? null
}

// ── 낱말 ──────────────────────────────────────────────────────────────────

/** 인용 후보의 글자를 모두 이어 붙인 뼈대. 낱말을 여기서 찾는다. */
export function 발화_뼈대(quotes: readonly Quote[]): string {
  return skeleton(quotes.map((인용) => 인용.text).join(' '))
}

/**
 * 낱말 하나를 발화에서 찾을 때 시도할 글자들 (긴 것부터).
 *
 * 🔴 **인용 id 처럼 정확히 맞출 수가 없다.** 프롬프트가 낱말을 **기본형**으로 내라고
 * 시키는데(`[A-WORDS]` · 명세 4.3 — 「부끄러웠어요」→「부끄럽다」), 그 기본형은 아이가
 * 실제로 말한 글자에 **없다.** 글자 그대로 찾기로 대조하면 동사·형용사가 전부 버려진다.
 *
 * 그래서 이렇게 한다.
 *
 * 1. 낱말 그대로 — 명사는 여기서 걸린다 (「며느리」)
 * 2. 「다」로 끝나면 그것을 뗀 어간 — 「당당하다」→「당당하」가 「당당하게」에 걸린다
 * 3. 그 어간을 뒤에서 한 글자씩 줄인 것들, `최소_어간_길이` 까지 —
 *    불규칙 활용을 잡는 자리다. 「부끄럽다」의 어간 「부끄럽」은 「부끄러웠어요」에
 *    없지만 「부끄」는 있다
 *
 * ⚠️ **한계를 알고 쓴다.** 줄인 조각이 짧을수록 헐거워져서, 아이가 「부끄러웠어요」라고만
 * 했는데 LLM 이 「부끄러워하다」를 내면 그것도 통과한다. 막으려는 것은 **아이 발화와
 * 아무 상관 없는 낱말**이고 그건 두 글자에서도 안 걸린다. 형태소 분석기를 넣지 않기로 한
 * 이상(명세 5.3) 여기가 낼 수 있는 최선이다.
 *
 * ⚠️ **이 성김은 조용히 넘어가지 않는다.** 「새 낱말인가」는 규칙이 `child_words` 와
 * 다시 대조하고(명세 4.3), 리포트를 다시 만들면 숫자가 흔들릴 수 있다는 것도 명세
 * 13절이 위험으로 적어 두었다.
 */
export function 낱말_후보들(낱말: string): string[] {
  const 뼈대 = skeleton(낱말)
  if (뼈대 === '') return []

  const 후보: string[] = [뼈대]
  if (뼈대.endsWith('다') && 뼈대.length >= 2) {
    const 어간 = 뼈대.slice(0, -1)
    후보.push(어간)
    for (let 길이 = 어간.length - 1; 길이 >= 최소_어간_길이; 길이 -= 1) {
      후보.push(어간.slice(0, 길이))
    }
  }
  return [...new Set(후보)]
}

/**
 * 이 낱말이 아이 발화 안에 글자로 있나 (결정 R21 · 명세 5.3 ②).
 *
 * `발화뼈대` 는 `발화_뼈대()` 가 만든 것이다 — 낱말마다 다시 만들면 발화가 긴 활동에서
 * 같은 일을 수십 번 한다.
 */
export function 낱말이_발화에_있나(낱말: string, 발화뼈대: string): boolean {
  return 낱말_후보들(낱말).some((조각) => 발화뼈대.includes(조각))
}

/** 발화에 없는 낱말을 버린다. 살린 것과 버린 것을 함께 돌려준다. */
export function 낱말_거르기(
  낱말들: readonly string[],
  발화뼈대: string,
): { kept: string[]; dropped: string[] } {
  const 살린: string[] = []
  const 버린: string[] = []
  for (const 낱말 of 낱말들) {
    // 같은 낱말이 두 번 오면 한 번만 남긴다 — 화면이 같은 말을 두 번 찍는다.
    if (살린.includes(낱말) || 버린.includes(낱말)) continue
    if (낱말이_발화에_있나(낱말, 발화뼈대)) 살린.push(낱말)
    else 버린.push(낱말)
  }
  return { kept: 살린, dropped: 버린 }
}

// ── 버린 것 장부 ───────────────────────────────────────────────────────────

/**
 * 무엇을 왜 버렸나. 부르는 쪽(이슈 #38)이 로그에 남길 수 있게 돌려준다.
 *
 * ⚠️ **버린 것이 조용하면 프롬프트가 새고 있다는 걸 아무도 모른다.** 인용을 자주 지어내는
 * 판인지 아닌지가 여기서만 보인다.
 */
export interface DroppedRecord {
  /** 목록 밖이라 비운 카드의 축 이름 */
  card_quotes: string[]
  /** 목록 밖이라 통째로 지운 대표 발화 (있으면 그 id) */
  highlight: string | null
  /** 발화에 없어 버린 낱말 */
  words: string[]
  /** 발화에 없어 버린 반복 표현 */
  phrases: string[]
  /** 버린 이야기 질문과 그 까닭 */
  story_questions: string[]
}

export function 빈_장부(): DroppedRecord {
  return { card_quotes: [], highlight: null, words: [], phrases: [], story_questions: [] }
}

// ── 카드 · 질문 거르기 ─────────────────────────────────────────────────────

/** 역량 3카드의 순서. **셋 고정이고 순서도 고정**이다 (명세 5.2 · 프론트 계약 1절). */
export const 카드_순서: readonly SkillCard['axis'][] = ['어휘', '표현', '논리']

/**
 * 카드를 고정 순서로 다시 세우고 **목록 밖 인용을 `null` 로 비운다** (명세 5.2).
 *
 * 🔴 카드는 **남긴다.** 명세가 「그 카드의 인용을 버리고 카드는 인용 없이 남긴다」이고,
 * 프론트 계약 1절도 `quote_message_id: string | null` — 「null 이면 인용 없이 그린다」다.
 *
 * ⚠️ 순서를 여기서 다시 세우는 것은 프롬프트를 못 믿어서가 아니라 **화면이 순서에
 * 기대기 때문**이다. 한 축이 두 번 오면 먼저 온 것을 남긴다.
 */
export function 카드_거르기(
  카드들: readonly SkillCard[],
  quotes: readonly Quote[],
  장부: DroppedRecord,
): SkillCard[] {
  const 있는_id = 인용_id_집합(quotes)
  const 세운것: SkillCard[] = []

  for (const 축 of 카드_순서) {
    const 카드 = 카드들.find((것) => 것.axis === 축)
    if (카드 === undefined) continue

    const 인용 = 카드.quote_message_id
    if (인용 !== null && !있는_id.has(인용)) {
      장부.card_quotes.push(축)
      세운것.push({ ...카드, quote_message_id: null })
    } else {
      세운것.push({ ...카드 })
    }
  }
  return 세운것
}

/**
 * 대표 발화의 인용이 목록 밖이면 **통째로 버린다** (명세 5.2 · 프론트 계약 1절).
 *
 * 카드와 달리 인용만 비울 수가 없다 — 대표 발화는 **인용 그 자체**라 인용이 빠지면
 * 남는 것이 「왜 이 말이 좋았나」뿐이고, 어느 말인지 없는 이유는 화면에 못 건다.
 */
export function 대표발화_거르기(
  highlight: { quote_message_id: string; why: string } | null,
  quotes: readonly Quote[],
  장부: DroppedRecord,
): { quote_message_id: string; why: string } | null {
  if (highlight === null) return null
  if (인용_id_집합(quotes).has(highlight.quote_message_id)) return { ...highlight }
  장부.highlight = highlight.quote_message_id
  return null
}

/**
 * 이야기 질문에서 **못 믿을 것을 통째로 버린다** (명세 5.4).
 *
 * 🔴 **여기만 카드와 처리가 다르다.** `StoryQuestion.quote_message_id` 는 프론트 계약이
 * `null` 을 안 받는 칸이라(`quote_message_id: string`) 비울 자리가 없다. 「엉뚱한 id 를
 * 그대로 내보내기」와 「그 질문을 버리기」 중 **버리는 쪽**을 골랐다 — 화면이
 * `quotes.find(...)` 로 원문을 찾고 「찾으면 반드시 있다」에 기대기 때문이다(프론트 계약
 * 1절). 질문 하나가 비는 것은 화면이 견디지만 못 찾는 id 는 못 견딘다.
 *
 * 버리는 사유 셋:
 *
 * 1. `quote_message_id` 가 `quotes[]` 밖 — 지어낸 인용
 * 2. `element` 가 8요소 코드가 아님 — 배지가 못 붙는다 (명세 5.4)
 * 3. 셋을 넘어선 것 — 3개 고정이다
 *
 * `scene_code` 는 **버리지 않고 인용의 것으로 덮어쓴다.** 배지의 장면과 인용된 발화가
 * 어긋나면 부모가 다른 장면 이야기를 아이에게 묻게 된다.
 */
export function 이야기질문_거르기(
  질문들: readonly StoryQuestion[],
  quotes: readonly Quote[],
  장부: DroppedRecord,
): StoryQuestion[] {
  const 살린: StoryQuestion[] = []

  for (const 질문 of 질문들) {
    const 인용 = 인용_찾기(quotes, 질문.quote_message_id)
    if (인용 === null) {
      장부.story_questions.push(`인용이 목록 밖이다 «${질문.quote_message_id}»`)
      continue
    }
    if (!요소_코드.includes(질문.element)) {
      장부.story_questions.push(`8요소 코드가 아니다 «${질문.element}»`)
      continue
    }
    if (살린.length >= 3) {
      장부.story_questions.push(`3개를 넘었다 «${질문.question}»`)
      continue
    }
    살린.push({ ...질문, scene_code: 인용.scene_code })
  }
  return 살린
}
