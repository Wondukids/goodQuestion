// 단어 판정 프롬프트에 보낼 **재료**를 만든다 (이슈 #44 · 명세 6.1 ②).
//
// `src/report/engine/material.ts` 와 같은 자리다 — 재료를 만드는 일만 하고 **LLM 을 부르지
// 않는다.** 부르는 것은 `judge.ts` 다. 갈라 두면 「이 판정에 무엇을 보냈나」를 따로 들여다볼
// 수 있고, 검사가 재료만 떼어 잴 수 있다.
//
// ## ⛔ 자리표시자를 쓰지 않는다
//
// user 본문은 언제나 재료 JSON 한 덩이다. 프롬프트 본문은 system 으로만 나가고 이 파일은
// 그 글자를 한 번도 안 본다 (`prompts/README.md` 2절).
//
// ## 🔴 열쇠 넷은 프롬프트와의 계약이다
//
// `story` · `cards` · `words` · `retelling`. 정본은 `prompts/retelling_keywords/보낼것.md`
// 의 「받는 것」 표다. 이름을 바꾸려면 그 표를 먼저 고쳐야 한다.

import { materialJson } from '@/llm/prompts'
import type { 판정할_단어, 후활동이야기, 후활동카드 } from '@/post-activity/types'

export interface RetellingMaterialArgs {
  story: 후활동이야기
  /** 카드 넉 장. **아이가 본 순서** = `post_activity_config.cards[]` 차례 그대로 */
  cards: readonly 후활동카드[]
  /** 🔴 **①이 거르고 남은 것만.** 다 보내면 규칙이 이미 낸 판정과 두 벌이 생긴다 */
  words: readonly 판정할_단어[]
  /** 서버가 받아쓴 아이 줄거리 원문 (`post_activity_results.retelling_text`) */
  retelling: string
}

/**
 * 판정 프롬프트에 보낼 user 본문 (명세 6.1 「보내는 재료」 네 줄).
 *
 * ⛔ **카드의 `keywords` 를 안 싣는다.** 판정할 단어는 `words` 가 나르고, 카드에 또 실으면
 * ①이 이미 `used` 로 끝낸 단어까지 모델 눈에 들어와 그것도 판정하려 든다 —
 * 프롬프트가 「`words` 에 온 것만 낸다」(`[W-ALL]`)로 막고 있지만 안 보내는 편이 확실하다.
 *
 * ⛔ **정답 순서·시도 횟수·아이 이름·나이를 안 싣는다.** 순서 맞추기는 앱과 서버가
 * 채점하고(명세 5.B), 아이 정보는 이 판정에 쓸 데가 없다 (프롬프트 갈래의
 * 「프롬프트에서 뺀 것」 표).
 *
 * ⚠️ **`words` 가 비면 부를 이유가 없다.** 이 함수는 그래도 재료를 만들어 주지만, 그 판단은
 * 부르는 쪽(`judge.ts`)이 한다 — 재료를 만드는 자리가 호출 여부까지 정하면 검사가
 * 「빈 목록으로 무엇이 나가나」를 못 잰다.
 */
export function buildRetellingKeywordsMaterial(args: RetellingMaterialArgs): string {
  const 재료: Record<string, unknown> = {
    story: { title: args.story.title, summary: args.story.summary },
    cards: args.cards.map((카드) => ({ id: 카드.id, title: 카드.title })),
    words: args.words.map((것) => ({ card_id: 것.card_id, word: 것.word })),
    retelling: args.retelling,
  }

  return materialJson(재료)
}
