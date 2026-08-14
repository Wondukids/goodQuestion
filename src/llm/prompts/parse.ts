// `prompts/` 의 글자를 다루는 층 — 지금은 재료를 JSON 으로 만드는 일 하나뿐이다.
//
// ⛔ 파일을 읽지 않는다. 디스크에 닿는 것은 `render.ts` 뿐이다.
//
// ## 예전에 여기 있던 것들 (2026-08-14 에 걷어냈다)
//
// 프롬프트 파일이 **한 파일 안에서 두 층**이던 시절에는 이 파일이 훨씬 컸다.
//
// - `sendableBody()` — `<!-- 보내는 것 시작 -->` 표식 사이만 오려 냈다.
//   이제 나가는 쪽과 사람이 읽는 쪽이 **다른 파일**로 갈렸으므로 오릴 것이 없다.
//   표식을 찾던 정규식이 `-->` 뒤에 `\n` 리터럴을 요구해서 CRLF 체크아웃에서 통째로
//   깨졌던 것이 파일을 나눈 까닭 중 하나다.
// - `materialTemplate()` · `fill()` · `placeholders()` · `PlaceholderRemainingError`
//   — md 의 「## 받는 것」 절 뒤 코드블록을 틀로 뽑아 `{이름}` 을 채웠다.
//   그 절은 사람이 읽는 층에 있었으므로 **`보낼것.md` 에는 아예 없다.** 그리고 채울
//   자리가 파일마다 `{analysis_material}` 하나뿐이라 틀을 뽑을 이유도 사라졌다.
//   지금은 `user` 본문이 곧 `materialJson(재료)` 다.
//
// 관리 규칙은 `prompts/README.md` 에 있다.

/** 프롬프트를 읽거나 다루다 실패했다. 어느 파일인지 메시지에 담는다. */
export class PromptError extends Error {
  constructor(메시지: string) {
    super(메시지)
    this.name = 'PromptError'
  }
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
