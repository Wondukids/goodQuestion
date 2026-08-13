// `prompts/*.md` 파서 한 묶음 (이슈 #26 말-2).
//
// 부르는 쪽은 `@/lib/prompts` 하나만 알면 된다. 안이 둘로 갈린 것은 층 때문이다 —
// `parse.ts` 는 글자만 다루고(파일을 모른다), `render.ts` 만 디스크에 닿는다.

export {
  PlaceholderRemainingError,
  PromptError,
  fill,
  materialJson,
  materialTemplate,
  placeholders,
  sendableBody,
} from './parse'

export { chooseBody, promptsDir, read, render, type RenderedPrompt } from './render'
