// `prompts/*.md` 를 디스크에서 읽어 (system, user) 한 쌍을 만든다.
//
// 파이썬 `src/goodquestion/prompts.py` 의 `읽기`·`본문_고르기`·`재료` 자리다 (이슈 #26 말-2).
// `CLAUDE.md` 기술 스택 절 — "프롬프트는 prompts/*.md에서 읽어온다."
//
// ## 파일을 캐시하지 않는다
//
// 부를 때마다 읽는다. 파이썬도 그랬고, **사람이 md 를 고치면 다음 호출부터 바로 반영된다**는
// 성질이 거기서 나온다. 시드를 DB 에서 읽는 것과 같은 이유다 (`CLAUDE.md` — 배포·동기화 경로가 없다).
//
// ## `prompts/` 를 어떻게 찾나 — ⚠️ 여기가 이 파일에서 가장 미끄러운 자리다
//
// `prompts/` 는 **레포 루트**에 있고 이 코드는 `src/` 안에 있다. 그런데 경로를 잡는 두 흔한
// 방법이 런타임마다 갈린다.
//
// - `import.meta.dirname` (= 파이썬 `Path(__file__)`) 는 vitest·tsx·node 에서는 맞지만
//   **Next.js 는 코드를 `.next/` 아래로 컴파일해 옮기므로 가리키는 자리가 달라진다.**
//   Next 문서가 못박아 뒀다 — "Since Next.js compiles your code into a separate directory
//   you can't use `__dirname` … Instead you can use `process.cwd()`"
//   (`node_modules/next/dist/docs/02-pages/04-api-reference/03-functions/get-static-props.md:160-168`).
// - `process.cwd()` 는 Next 가 권하는 쪽이지만(`next dev`·`next start` 는 레포 루트에서 돈다)
//   검사를 어디서 돌리느냐에 따라 갈릴 수 있다.
//
// 그래서 **둘 다 시작점으로 삼아 위로 거슬러 올라가며 표식 파일이 있는 `prompts/` 를 찾는다.**
// 짐작하지 않고 **있는지 확인해서** 고르므로 두 런타임에서 같은 답이 나오고,
// 못 찾으면 조용히 넘어가지 않고 **본 자리를 전부 적어** 터진다.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { PROJECT_ROOT } from '@/llm/config'

import { fill, materialTemplate, PromptError, sendableBody } from './parse'

/** 이 파일이 있어야 우리 `prompts/` 다. 이름만 같은 남의 폴더를 잡지 않으려고 둔다. */
const 표식 = 'analysis.md'

/**
 * `prompts/` 안에 있지만 **프롬프트가 아닌** md (2026-08-14).
 *
 * `README.md` 는 프롬프트 관리 규칙을 적은 문서다. LLM 에 보내는 글이 아니므로
 * 프롬프트 목록에 끼면 안 된다 — 작업대 화면에 뜨고, 이름 목록을 정확히 일치로 보는
 * 검사가 빨개진다.
 *
 * ⚠️ **여기 한 곳에만 둔다.** 목록을 만드는 자리(`service/prompt-lab.ts`)와 세는 자리
 * (`tests/prompts.test.ts`)가 각자 이름을 적으면 파일이 하나 더 늘 때 둘이 갈라진다.
 */
export const 프롬프트가_아닌_md: readonly string[] = ['README']

let 찾은_디렉터리: string | null = null

/** 시작 자리부터 파일시스템 꼭대기까지. */
function 조상들(시작: string): string[] {
  const 모은것: string[] = []
  let 여기 = path.resolve(시작)
  for (;;) {
    모은것.push(여기)
    const 위 = path.dirname(여기)
    if (위 === 여기) return 모은것
    여기 = 위
  }
}

/** 레포의 `prompts/` 자리. 못 찾으면 터진다. */
export function promptsDir(): string {
  if (찾은_디렉터리 !== null) return 찾은_디렉터리

  const 본것: string[] = []
  for (const 시작 of [process.cwd(), PROJECT_ROOT]) {
    for (const 조상 of 조상들(시작)) {
      const 후보 = path.join(조상, 'prompts')
      if (본것.includes(후보)) continue
      본것.push(후보)
      if (existsSync(path.join(후보, 표식))) {
        찾은_디렉터리 = 후보
        return 후보
      }
    }
  }

  throw new PromptError(
    `prompts/ 를 못 찾았다 (${표식} 가 있는 자리를 찾는다). 본 자리:\n  ${본것.join('\n  ')}`,
  )
}

/** `prompts/<이름>.md` 를 읽는다 (파이썬 `읽기()`). */
export function read(이름: string, 디렉터리?: string): string {
  const 경로 = path.join(디렉터리 ?? promptsDir(), `${이름}.md`)
  if (!existsSync(경로)) {
    throw new PromptError(`프롬프트가 없다: ${경로}`)
  }
  return readFileSync(경로, 'utf-8')
}

/**
 * 주어진 본문이 있으면 그것을, 없으면 `prompts/<이름>.md` 를 읽는다 (파이썬 `본문_고르기()`).
 *
 * 「안 주면 파일」이라는 기본값 규칙을 한 곳에만 둔다. 부르는 쪽(`analyze` · `character` ·
 * `service`)이 각자 `if (프롬프트 == null)` 을 쓰면 셋이 조용히 갈라질 수 있다.
 *
 * **엔진은 주어진 본문이 어디서 왔는지 모른다.** 회차용 실험 프롬프트든 시험용 문자열이든
 * 여기서는 그냥 문자열이다 (`CLAUDE.md` 경계 6 — 페이지가 DB 를 읽는 방향만 있다).
 * 빈 문자열도 「준 것」으로 본다 — `''` 를 주고 파일이 읽히면 준 사람이 속는다.
 */
export function chooseBody(이름: string, 주어진?: string | null): string {
  return 주어진 === null || 주어진 === undefined ? read(이름) : 주어진
}

/** 프롬프트 하나가 LLM 으로 나가는 모양. */
export interface RenderedPrompt {
  system: string
  user: string
}

/**
 * (system, user) 한 쌍을 만든다 (파이썬 `재료()`).
 *
 * system 은 **보낼 층**, user 는 채운 재료 블록이다 (결정 48 — 그 전에는 본문 전체였다).
 */
export function render(이름: string, 값: Readonly<Record<string, string>>): RenderedPrompt {
  const 출처 = `prompts/${이름}.md`
  const 본문 = read(이름)
  return {
    system: sendableBody(본문),
    user: fill(materialTemplate(본문, 출처), 값, 출처),
  }
}
