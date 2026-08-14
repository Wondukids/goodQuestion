// `prompts/` 를 다루는 한 묶음.
//
// 부르는 쪽은 `@/llm/prompts` 하나만 알면 된다. 안이 둘로 갈린 것은 층 때문이다 —
// `parse.ts` 는 글자만 다루고(파일을 모른다), `render.ts` 만 디스크에 닿는다.

export { PromptError, materialJson } from './parse'

export {
  chooseBody,
  promptsDir,
  read,
  보낼것,
  프롬프트가_아닌_md,
} from './render'
