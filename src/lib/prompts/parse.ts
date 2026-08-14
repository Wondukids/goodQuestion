// `prompts/*.md` 의 글자를 다루는 층 — 틀을 뽑고 채우고 보낼 층을 자른다.
//
// 파이썬 `src/goodquestion/prompts.py` 를 옮긴 것이다 (이슈 #26 말-2).
// ⛔ 파일을 읽지 않는다. 디스크에 닿는 것은 `render.ts` 뿐이다.
//
// ## 왜 md 안의 블록을 틀로 쓰나
//
// `prompts/analysis.md` 와 `prompts/character.md` 는 「받는 것」 절에 재료의 모양을
// 코드블록으로 적어 두었다. 그 목록을 코드에 다시 적으면 md 와 코드가 갈라지고,
// 갈라진 것을 아무도 모른다. 그래서 **md 의 블록 자체를 틀로 쓴다.**
//
// 프롬프트 본문 전체는 system 으로 나가고, 채운 블록은 user 로 나간다.
//
// ## 문자열 보간(`${…}`)을 쓰지 않는 이유
//
// 파이썬이 `str.format` 을 버린 것과 같은 자리다. 두 가지가 걸린다.
//
// - 프롬프트 본문에 JSON 예시(`{ "type": "REASON" }`)가 있어 통째 치환이 죽는다.
// - 아이가 `{` 를 말하면 채운 뒤에도 죽는다. 아이 말은 무엇이든 올 수 있다.
//
// 그래서 `{이름}` 만 찾아 바꾸는 방식으로 간다. 이름은 소문자 snake_case 로 제한해
// JSON 예시의 중괄호와 섞이지 않게 했다.

/** 프롬프트를 읽거나 파싱하다 실패했다. 어느 파일 어느 자리인지 메시지에 담는다. */
export class PromptError extends Error {
  constructor(메시지: string) {
    super(메시지)
    this.name = 'PromptError'
  }
}

/**
 * 틀에 채우지 못한 자리가 남았다 (파이썬 `자리표시자_남음`).
 *
 * 빈 문자열로 채우는 것과 아예 안 채우는 것은 다르다. 안 채운 채로 LLM 에 보내면
 * `{scene_stance}` 같은 글자가 그대로 프롬프트에 실린다.
 */
export class PlaceholderRemainingError extends PromptError {
  constructor(메시지: string) {
    super(메시지)
    this.name = 'PlaceholderRemainingError'
  }
}

// 「받는 것」 절 뒤에 처음 나오는 코드블록이 재료 틀이다.
const 받는것 = /^##\s*받는\s*것\s*$/m
const 코드블록 = /```[^\n]*\n([\s\S]*?)```/g

// LLM 에 실제로 보낼 토막의 경계 (결정 48).
const 보낼것 = /<!--\s*보내는 것 시작\s*-->\n([\s\S]*?)<!--\s*보내는 것 끝\s*-->/

// 자리표시자 이름은 소문자 snake_case 만. JSON 예시의 `{ "type": ... }` 는 걸리지 않는다.
const 자리표시자 = /\{([a-z][a-z0-9_]*)\}/g

/** 오류 메시지에 붙일 출처. 파일에서 왔으면 경로, 아니면 「주어진 본문」. */
function 어디(출처: string | undefined): string {
  return 출처 ?? '주어진 본문'
}

/**
 * `<!-- 보내는 것 시작/끝 -->` 사이만 뽑는다. **표식이 없으면 통째로 돌려준다** (결정 48).
 *
 * `prompts/*.md` 는 층이 둘이다 — 사람이 읽는 한글 층과 LLM 에 가는 영어 층.
 * 한글 층에는 출처 인용(📄 ✏️)과 「왜 이렇게 정했나」가 살고, **그건 모델에게 쓸모가 없다.**
 * 2026-08-09 실측 — 캐릭터 프롬프트의 16%가 `docs/…:줄번호` 인용이었다.
 *
 * **표식이 없으면 통째로 보내는 이유**는 실험 프롬프트다. 관리 페이지에서 사람이 써 넣은
 * 본문은 층이 없다. 거기서 잘라내려 들면 사람이 쓴 프롬프트가 통째로 사라진다.
 * **한 글자도 못 찾겠으면 다 보내는 쪽이 안전하다.**
 *
 * ⚠️ 이 함수는 **자르기만 한다.** 두 층의 뜻이 어긋났는지는 보지 못한다 —
 * 파이썬 `tests/test_프롬프트_두층.py` 가 `[E-…]`·`[C-…]` 표로 **짝이 맞는지**까지만 봤다.
 */
export function sendableBody(본문: string): string {
  const 맞은것 = 보낼것.exec(본문)
  return 맞은것 === null ? 본문 : 맞은것[1].trim()
}

/**
 * 재료 한 덩이를 JSON 으로 (결정 48).
 *
 * 한글을 `\uXXXX` 로 부풀리지 않는다 — **글자 하나가 토큰 여럿**이 된다.
 * 들여쓰기를 안 준다 — 공백도 토큰이고, 모델이 읽는 데 필요하지 않다.
 * (`JSON.stringify` 의 기본값이 파이썬 `ensure_ascii=False, separators=(",", ":")` 와 같다.)
 *
 * ⚠️ **여기 한 곳에만 둔다.** 2026-08-10 에 골든셋이 엔진과 **다른 프롬프트**로 돌고 있던
 * 것이 드러났다. 원인은 재료를 만드는 자리가 둘이었던 것이다.
 * 또 나누면 또 갈라진다 — 회차와 골든셋이 **같은 함수**를 지나가게 한다.
 */
export function materialJson(재료: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(재료)
}

/**
 * 「받는 것」 절 뒤 첫 코드블록을 뽑는다 (파이썬 `재료_틀()`).
 *
 * `출처` 는 오류 메시지에만 쓴다 — 어느 파일이 깨졌는지 알려면 있어야 한다.
 */
export function materialTemplate(본문: string, 출처?: string): string {
  const 자리 = 받는것.exec(본문)
  if (자리 === null) {
    throw new PromptError(`${어디(출처)}: 「## 받는 것」 절이 없다`)
  }

  // 절 뒤에서부터 찾는다. `lastIndex` 를 쓰므로 매번 다시 놓는다(전역 정규식 상태).
  코드블록.lastIndex = 자리.index + 자리[0].length
  const 블록 = 코드블록.exec(본문)
  코드블록.lastIndex = 0
  if (블록 === null) {
    throw new PromptError(`${어디(출처)}: 「받는 것」 절 뒤에 코드블록이 없다`)
  }

  return 블록[1].replace(/\n+$/, '')
}

/** 틀에 남아 있는 `{이름}` 의 이름들. */
export function placeholders(틀: string): Set<string> {
  return new Set([...틀.matchAll(자리표시자)].map((맞은것) => 맞은것[1]))
}

/**
 * `{이름}` 을 값으로 바꾼다. 하나라도 남으면 예외를 올린다 (파이썬 `채우기()`).
 *
 * ⚠️ **값 안에 `{이름}` 이 들어 있으면 그것도 「못 채운 자리」로 잡혀 터진다.**
 * 아이가 `{scene}` 이라고 말하면 여기서 터진다는 뜻이다. 파이썬이 그랬고, 이식이라
 * 그대로 뒀다 (`CLAUDE.md` — 옮기는 일과 고치는 일을 같이 하지 않는다).
 */
export function fill(
  틀: string,
  값: Readonly<Record<string, string>>,
  출처?: string,
): string {
  const 채운것 = 틀.replace(자리표시자, (통째, 이름: string) =>
    // ⚠️ `이름 in 값` 이 아니라 제 것만 본다 — `constructor` 같은 이름이
    //    소문자 규칙을 통과해서 프로토타입 값이 끼어들 수 있다.
    Object.prototype.hasOwnProperty.call(값, 이름) ? String(값[이름]) : 통째,
  )

  const 남은것 = [...placeholders(채운것)].sort()
  if (남은것.length > 0) {
    throw new PlaceholderRemainingError(
      `${어디(출처)}: 채우지 못한 자리: ${남은것.join(', ')}`,
    )
  }

  return 채운것
}
