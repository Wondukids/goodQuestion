// 말하기 후 활동 — 이 도메인의 층들과 **부르는 쪽(#45)이 함께 쓰는 계약 하나** (이슈 #44).
//
// 정본은 `docs/말하기후활동_명세.md` 4.3(표) · 6절(판정 3단) · 7.2(리포트에 붙는 모양).
// `src/report/types.ts` 와 같은 자리다 — 층이 아니라 **셋이 공유하는 이름표**다.
//
// ⛔ 여기에 함수를 두지 않는다. 값을 만드는 것은 `domain/` · `engine/` 이다.

import type { LLMResult } from '@/llm/provider'

/**
 * 단어 하나의 판정 (`post_activity_keywords.status` · 명세 4.3).
 *
 * - `used` 아이가 **그 글자 그대로** 말했다 (①이 찾았다)
 * - `similar` 비슷한 말로 그 뜻을 말했다 (②가 봤고 ③이 근거를 확인했다)
 * - `missing` 안 썼다
 */
export type 판정상태 = 'used' | 'similar' | 'missing'

/**
 * 누가 그렇게 봤나 (`post_activity_keywords.decided_by`).
 *
 * 🔴 **「어느 단에서 끝났나」가 아니라 「누가 마지막으로 봤나」다.** DB CHECK 가 둘만
 * 받는데(`'rule'` · `'llm'`) `missing` 은 둘 다 아니라서, 어느 쪽으로든 정해야 한다.
 * ①이 글자로 찾아 끝낸 것만 `'rule'` 이고 **②로 넘어간 것은 전부 `'llm'`** 이다 —
 * 안 왔든, 거짓으로 왔든, ③에서 버려졌든 마지막으로 그 단어를 본 것은 LLM 이다.
 * 🟡 명세에 없는 판단이라 되돌려도 된다. 바꾸려면 이 주석과 `engine/judge.ts` 한 곳이다.
 */
export type 판정자 = 'rule' | 'llm'

/** `stories.post_activity_config.cards[]` 한 장 (명세 4.1). */
export interface 후활동카드 {
  /** `'endure'` · `'burst'` · `'pear'` · `'pride'`. 이 값이 그대로 `card_id` 가 된다 */
  id: string
  title: string
  /** 이 카드의 핵심 단어 셋 */
  keywords: readonly string[]
}

/** 아이 말을 읽을 때 **무슨 이야기인지** 알라고 주는 것. 판정 대상이 아니다 (`[W-STORY]`). */
export interface 후활동이야기 {
  title: string
  summary: string
}

/** ①이 끝내지 못해 ②로 보낼 단어 하나. 어느 카드의 것인지가 함께 간다. */
export interface 판정할_단어 {
  card_id: string
  word: string
}

/**
 * `post_activity_keywords` 한 행이 될 값.
 *
 * ⛔ **이 도메인은 이 값을 만들 뿐 저장하지 않는다** (넣는 것은 이슈 #45).
 */
export interface 단어판정 {
  card_id: string
  word: string
  status: 판정상태
  /** 아이 원문에서 떼어 온 조각. **`missing` 이면 NULL** 이다 (명세 4.3) */
  evidence: string | null
  decided_by: 판정자
}

/**
 * 대조에서 **버린 것**. 부르는 쪽이 로그에 남길 수 있게 올린다.
 *
 * ⚠️ **버린 것이 조용하면 프롬프트가 새고 있다는 걸 아무도 모른다** (`src/report/engine/verify.ts`
 * 의 `DroppedRecord` 와 같은 자리). 지어낸 근거를 자주 내는 판인지가 여기서만 보인다.
 */
export interface 버린것 {
  /** ③ — 근거가 아이 원문에 없어 판정을 버린 단어 */
  evidence: string[]
  /** 응답에 아예 안 온 단어. `missing` 으로 떨어뜨렸다 */
  unanswered: string[]
  /** 물어보지 않은 단어를 보태 온 것. 그냥 버렸다 */
  unasked: string[]
}

/**
 * 판정 한 건의 결과. **던지지 않는다** — 실패도 값으로 온다 (결정 F4·F8 · 수용 기준 10).
 *
 * 🔴 **「판정을 못 했다」와 「단어를 하나도 안 썼다」는 다른 말이다.**
 * 앞엣것은 `analyzed: false` · `words: null` 이고 `analyzed_at` 을 NULL 로 둔다.
 * 뒤엣것은 `analyzed: true` · 12행이 전부 `missing` 이고 `analyzed_at` 이 찬다 (명세 4.2).
 */
export interface 판정결과 {
  analyzed: boolean
  /** 단어 12개 **전부**. 판정을 못 했으면 `null` (명세 4.3 — `missing` 도 행으로 남는다) */
  words: 단어판정[] | null
  /** 못 한 사유. 해냈으면 `null` */
  failed: string | null
  /** 어느 공급자가 답했나. 안 불렀거나(①이 다 끝냄) 실패했으면 `null` */
  llm: LLMResult | null
  dropped: 버린것
  /** `post_activity_results.analysis_version` 에 넣을 값 (명세 4.2) */
  version: string
}
