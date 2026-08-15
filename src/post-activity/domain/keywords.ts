// 단어 판정의 **순수 규칙** — 판정 3단 중 ①과 ③ (이슈 #44 · 명세 6.1).
//
// ```
// ①  규칙이 글자로 찾는다   → 찾히면  used   · rule   (LLM 을 안 부른다)
//        │ 못 찾은 것만
//        ▼
// ②  LLM 에게 묻는다        → 참이면  similar · llm      ← `engine/judge.ts`
//        │
//        ▼
// ③  근거를 원문과 대조한다 → 원문에 없으면 그 판정을 버리고 missing
// ```
//
// ## ⛔ 이 파일이 안 하는 것
//
// LLM 도 DB 도 시각도 모른다. 순수 함수만 있다 — 검사가 글자 몇 개만 넣어 볼 수 있어야 한다
// (`src/report/engine/verify.ts` 와 같은 자리이고, 실제로 그 파일의 대조기를 그대로 쓴다).
//
// ## 🔴 「비슷한 말」의 경계는 여기에 없다 (결정 F17 · 명세 6.4)
//
// 「참았어요」가 「참다」인가 같은 판단은 **프롬프트의 12줄 표**가 정한다
// (`prompts/retelling_keywords/보낼것.md`). 판정이 흔들리면 그 표를 고치지 이 파일을
// 고치지 않는다. ⛔ 여기에 단어 이름이 한 글자도 없는 것이 그 약속의 모양이다.

import { skeleton } from '@/llm/judge'
import { 낱말_후보들, 최소_어간_길이 } from '@/report/engine'
import type { 단어판정, 버린것, 판정할_단어, 후활동카드 } from '@/post-activity/types'

/**
 * ①이 쓸 조각의 **바닥**. 두 글자다 (🔴 결정 F14 · 명세 6.1).
 *
 * `낱말_후보들()` 은 「~다」로 끝나는 낱말의 어간을 떼어 찾는데, **두 글자 낱말은 어간이
 * 한 글자**가 된다 — 「참다」→「참」. 한 글자는 「참새를 봤어요」·「참 재밌었어요」에도
 * 걸려서, 아이가 방귀를 참은 이야기를 한 마디도 안 했는데 `used` 가 찍힌다.
 *
 * 🔴 **그래서 부르는 쪽인 여기서 바닥을 건다.** ⛔ `verify.ts` 를 고치지 않는다 — 그 함수는
 * 보호자 리포트의 낱말 세기가 쓰고 있고 거기서는 성기게 잡아도 되는 자리라 지금 동작이
 * 맞다. 고치면 리포트 숫자가 함께 바뀐다.
 *
 * ⚠️ 값은 리포트의 `최소_어간_길이`(2)를 **같은 이유로 같이 쓴다** — 한 글자는 아무 말에나
 * 걸린다. 두 자리가 갈라져야 할 이유가 생기면 그때 여기에 숫자를 직접 적어라.
 */
export const 후활동_조각_바닥 = 최소_어간_길이

/**
 * 아이가 말한 줄거리에서 **띄어쓰기와 문장부호를 걷어낸 글자**. 찾기는 여기서 한다.
 *
 * 리포트의 `발화_뼈대()` 와 같은 일인데 그쪽은 인용 목록을 받는다 — 후활동은 받아쓴 글이
 * **한 덩이**라 글자 하나를 받는다. 만드는 함수(`skeleton`)는 같은 것을 쓴다.
 *
 * ⚠️ 단어마다 다시 만들지 마라. 12번 같은 일을 한다.
 */
export function 줄거리_뼈대(줄거리: string): string {
  return skeleton(줄거리)
}

/**
 * ①이 실제로 찾아 볼 조각들 — `낱말_후보들()` 에서 **두 글자 미만을 걷어낸 것**.
 *
 * 빈 배열이 나오면 「글자로는 못 믿는 단어」라는 뜻이고, 그런 단어는 ①을 건너뛰고 곧장
 * ②(LLM)로 간다.
 */
export function 후활동_낱말_후보들(단어: string): string[] {
  return 낱말_후보들(단어).filter((조각) => 조각.length >= 후활동_조각_바닥)
}

/**
 * ① — 이 단어가 아이 말 안에 **글자로** 있나.
 *
 * 🔴 `false` 는 「안 썼다」가 아니라 **「글자로는 못 찾았다」**다. 그 판정은 ②가 한다.
 */
export function 규칙이_찾았나(단어: string, 줄거리뼈대: string): boolean {
  if (줄거리뼈대 === '') return false
  return 후활동_낱말_후보들(단어).some((조각) => 줄거리뼈대.includes(조각))
}

/**
 * ③ — LLM 이 댄 근거가 아이 원문에 **글자로 있나** (명세 6.1 ③).
 *
 * 🔴 **이것이 이 갈래의 방어선이다.** 프롬프트도 「지어낸 근거는 버려진다」고 알려 주지만
 * (`[W-DROP]`), 그건 부탁이고 이쪽은 지켜지지 않아도 막는 것이다. 지어낸 근거는 보호자
 * 화면에 「아이가 이렇게 말했어요」로 그대로 뜬다.
 *
 * 양쪽 다 뼈대로 만들어 견준다 — 받아쓴 글에는 문장부호가 섞여 있고, 모델이 그것을 빼고
 * 인용하는 일이 흔하다. 맞는 판정이 문장부호 하나 때문에 버려지면 안 된다.
 */
export function 근거가_원문에_있나(근거: string, 줄거리뼈대: string): boolean {
  const 조각 = skeleton(근거)
  if (조각 === '' || 줄거리뼈대 === '') return false
  return 줄거리뼈대.includes(조각)
}

// ── ① 한 판 ────────────────────────────────────────────────────────────────

/**
 * 카드와 단어를 함께 잡는 열쇠. `post_activity_keywords` 의
 * `UNIQUE (result_id, card_id, word)` 와 **같은 짝**이다.
 *
 * ⚠️ 두 글자를 그냥 이어 붙이지 않는다. 가름쇠가 없으면 「`ab`+`c`」와 「`a`+`bc`」가 같은
 * 열쇠가 된다. JSON 으로 싸면 가름쇠를 고를 일도, 그 글자가 값에 섞일 걱정도 없다.
 */
export function 단어_열쇠(card_id: string, word: string): string {
  return JSON.stringify([card_id, word])
}

/** ①이 끝낸 것과 ②로 넘길 것. */
export interface 규칙_판정 {
  /**
   * 판정할 단어 **전부**를 카드 차례로 (겹친 것은 걷어낸 뒤).
   *
   * 🔴 마지막에 12행을 **이 차례로** 세운다. 두 갈래(`결정`·`남은것`)로 나뉜 것을 다시
   * 합칠 때 카드 순서를 잃지 않게, 나누는 자리에서 차례를 함께 들고 나온다.
   */
  전체: 판정할_단어[]
  /** 글자로 찾혀 `used` 로 끝난 단어들 */
  결정: 단어판정[]
  /** ②(LLM)에게 물어볼 단어들. **재료의 `words` 가 이것이다** */
  남은것: 판정할_단어[]
}

/**
 * 카드 넉 장의 단어를 **차례대로** ①에 태운다 (명세 6.1 ①).
 *
 * 차례는 `post_activity_config.cards[]` 그대로다 — 리포트 화면이 칩을 그 순서로 그린다
 * (명세 7.3). 같은 카드에 같은 단어가 두 번 적혀 있으면 뒤엣것을 버린다:
 * `post_activity_keywords` 의 `UNIQUE (result_id, card_id, word)` 가 두 행을 못 받는다.
 *
 * ⛔ `used` 에는 `evidence` 를 안 싣는다. 🟡 명세에 안 적힌 자리라 **되돌리기 쉬운 쪽**을
 * 골랐다 — 찾힌 조각은 「당당하」처럼 어간이라 보호자에게 보일 말이 아니고, 원문에서 앞뒤를
 * 오려 내는 것은 명세에 없는 산식이다. 화면(F16)은 칩만 그린다.
 */
export function 규칙_단계(카드들: readonly 후활동카드[], 줄거리뼈대: string): 규칙_판정 {
  const 전체: 판정할_단어[] = []
  const 결정: 단어판정[] = []
  const 남은것: 판정할_단어[] = []
  const 본것 = new Set<string>()

  for (const 카드 of 카드들) {
    for (const 단어 of 카드.keywords) {
      const 열쇠 = 단어_열쇠(카드.id, 단어)
      if (본것.has(열쇠)) continue
      본것.add(열쇠)
      전체.push({ card_id: 카드.id, word: 단어 })

      if (규칙이_찾았나(단어, 줄거리뼈대)) {
        결정.push({
          card_id: 카드.id,
          word: 단어,
          status: 'used',
          evidence: null,
          decided_by: 'rule',
        })
      } else {
        남은것.push({ card_id: 카드.id, word: 단어 })
      }
    }
  }

  return { 전체, 결정, 남은것 }
}

// ── 장부 · 세기 ────────────────────────────────────────────────────────────

export function 빈_장부(): 버린것 {
  return { evidence: [], unanswered: [], unasked: [] }
}

/** 버린 것이 하나라도 있나. 부르는 쪽이 로그를 낼지 말지 여기서 가른다. */
export function 버린_수(장부: 버린것): number {
  return 장부.evidence.length + 장부.unanswered.length + 장부.unasked.length
}

/**
 * 상태별 개수 (명세 7.2 — `used` · `similar` · `missing` 셋이 지표에 실린다).
 *
 * ⚠️ **세는 자리를 여기 하나만 둔다.** 화면과 지표가 각자 세면 두 숫자가 갈린다.
 */
export function 단어_세기(판정들: readonly 단어판정[]): {
  used: number
  similar: number
  missing: number
} {
  return {
    used: 판정들.filter((것) => 것.status === 'used').length,
    similar: 판정들.filter((것) => 것.status === 'similar').length,
    missing: 판정들.filter((것) => 것.status === 'missing').length,
  }
}
