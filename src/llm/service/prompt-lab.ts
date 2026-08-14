// 프롬프트 작업대가 그릴 것을 조립한다 (이슈 #26 화면-6 · FR-057·FR-058).
//
// 파이썬 `src/goodquestion_admin/routes/prompt_lab.py` 의 조립 부분과
// `goodquestion_admin/회차.py` 의 `실험_프롬프트들()` 을 옮긴 것이다.
//
// ## 🔴 이 화면은 `prompts/*.md` 를 **읽기만 한다** (`CLAUDE.md` 경계 6)
//
// > 「프롬프트 정본은 `prompts/*.md` 다. 페이지에서 고친 것은 실험용이며,
// >  확정본은 사람이 파일에 옮긴다.」
//
// 그래서 이 파일에도, `repo/prompt-lab.ts` 에도, `app/(admin)/prompt-lab/` 에도
// **파일을 쓰는 코드가 한 줄도 없다.** 실험판은 `experiment_prompts` 표에 살고
// 그 표에서 md 로 돌아가는 화살표는 없다.
// `tests/prompt-lab.test.ts` 가 두 가지로 지킨다 — ① 저장·조회 길을 다 지난 뒤 md 파일의
// 해시가 그대로인지 ② 이 세 자리의 소스에 파일 쓰기 API 가 들어왔는지.
//
// ## ⚠️ md 를 캐시하지 않는다
//
// `lib/prompts/render.ts` 의 `read()` 는 부를 때마다 디스크를 읽는다 —
// **사람이 md 를 고치면 다음 호출부터 바로 반영된다**는 성질이 거기서 나온다.
// 실험판을 얹는 방식도 그 성질을 안 깬다: 파일 목록도 본문도 **그릴 때마다** 다시 읽고,
// 실험 본문은 그 위에 덧씌우기만 한다. 모듈 전역에 담아 두는 것이 하나도 없다.

import { readdirSync } from 'node:fs'
import path from 'node:path'

import { ValueError } from '@/llm/domain/progress'
import { promptsDir, read, 프롬프트가_아닌_md } from '@/llm/prompts'
import { getDb, type Conn } from '@/llm/repo/db'
import {
  readExperimentPrompts,
  saveExperimentPrompt,
  실험할_수_있는_이름,
} from '@/llm/repo/prompt-lab'
import { readRun, type RunRow } from '@/llm/repo/runs'

/** 화면에 뜨는 프롬프트 한 종류. */
export interface PromptItem {
  /** 파일 이름에서 `.md` 를 뗀 것 (`analysis` · `character` · `child` …). */
  name: string
  /** `prompts/<name>.md` 의 내용. **정본이다.** */
  canonical_body: string
  /** 이 회차에 저장된 실험 본문. 없으면 `null`. */
  experiment_body: string | null
  /** 화면에 띄울 본문 — 실험 본문이 있으면 그것, 없으면 정본. */
  display_body: string
  /** 실험할 수 있는가 (`analysis`·`character` 둘뿐이다). */
  editable: boolean
  /** 이 회차에 실험 본문이 저장돼 있는가. */
  is_experiment: boolean
}

export interface PromptLabView {
  run_id: string | null
  /** 회차를 안 골랐으면 `null` 이고 화면은 정본만 읽기 전용으로 보여 준다. */
  run: RunRow | null
  prompts: PromptItem[]
  /** 이 회차에 실험 본문이 저장된 이름들 (이름 순). */
  experiment_names: string[]
}

/**
 * `prompts/` 안의 프롬프트 이름들. **부를 때마다 다시 읽는다** (캐시하지 않는다).
 *
 * ⛔ `README.md` 처럼 프롬프트가 아닌 문서는 뺀다 (`프롬프트가_아닌_md`).
 *    안 빼면 작업대 화면에 규칙 문서가 프롬프트인 척 뜬다.
 */
export function listPromptNames(디렉터리?: string): string[] {
  const 자리 = 디렉터리 ?? promptsDir()
  return readdirSync(자리)
    .filter((이름) => 이름.endsWith('.md'))
    .map((이름) => path.basename(이름, '.md'))
    .filter((이름) => !프롬프트가_아닌_md.includes(이름))
    .sort()
}

/**
 * 작업대 화면 하나 (파이썬 `프롬프트_화면()`).
 *
 * `run_id` 가 없으면 실험 본문을 안 읽는다 — 정본을 읽기 전용으로 보여 줄 뿐이다.
 */
export async function promptLabView({
  run_id = null,
  conn,
  디렉터리,
}: {
  run_id?: string | null
  conn?: Conn
  /** 검사에서 임시 폴더를 쓰기 위한 자리. 화면은 넘기지 않는다. */
  디렉터리?: string
} = {}): Promise<PromptLabView> {
  let 실험값: Record<string, string> = {}
  let run: RunRow | null = null
  if (run_id !== null) {
    const 연결 = conn ?? getDb()
    run = await readRun(연결, run_id)
    실험값 = await readExperimentPrompts(연결, run_id)
  }

  const prompts = listPromptNames(디렉터리).map((name) => {
    const canonical_body = read(name, 디렉터리)
    const experiment_body = 실험값[name] ?? null
    return {
      name,
      canonical_body,
      experiment_body,
      display_body: experiment_body ?? canonical_body,
      editable: (실험할_수_있는_이름 as readonly string[]).includes(name),
      is_experiment: experiment_body !== null,
    }
  })

  return { run_id, run, prompts, experiment_names: Object.keys(실험값).sort() }
}

/**
 * 실험 본문 하나를 회차에 저장한다 (파이썬 `실험_프롬프트_저장()` 라우트).
 *
 * ⛔ **빈 본문은 거절한다.** 빈 것을 저장하면 그 회차는 system 없이 도는데, 그게 실험인지
 *    실수인지 나중에 못 가른다. (파이썬도 400 이다.)
 */
export async function saveExperimentPromptStep({
  run_id,
  name,
  body,
  conn,
}: {
  run_id: string
  name: string
  body: string
  conn?: Conn
}): Promise<void> {
  if (body.trim() === '') {
    throw new ValueError('빈 프롬프트는 저장할 수 없다')
  }
  // ⚠️ 다듬지 않은 **원본 그대로** 넣는다. 사람이 넣은 글자와 나가는 글자가 달라지면
  //    「무엇을 실험했나」가 흐려진다.
  await saveExperimentPrompt(conn ?? getDb(), { run_id, name, body })
}

/**
 * 이 회차에만 저장된 실험 본문 (파이썬 `회차.실험_프롬프트들()`).
 *
 * 없으면 `null` 이고, `null` 이면 엔진이 지금까지처럼 `prompts/*.md` 를 읽는다
 * (`prompts.chooseBody()` 한 곳이 그 규칙을 갖고 있다).
 *
 * ⭐ **턴을 도는 길이 이 함수를 부른다** (2026-08-13 배선). `submitTurn()`·`resumeTurn()` 은
 *    파이썬 `회차.py` 처럼 턴 시작에 한 번 붙잡고, 라우트 단계 함수(`analysisStep()`·
 *    `dialogueStep()`)는 계약이 ①②③ 으로 갈려 있어 **제 단계에서** 읽는다.
 *    부르는 쪽이 `analysis_prompt`·`character_prompt` 를 명시로 넘기면 그것이 이긴다.
 */
export async function experimentPrompts(
  run_id: string,
  conn?: Conn,
): Promise<{ analysis: string | null; character: string | null }> {
  const 본문들 = await readExperimentPrompts(conn ?? getDb(), run_id)
  return { analysis: 본문들.analysis ?? null, character: 본문들.character ?? null }
}
