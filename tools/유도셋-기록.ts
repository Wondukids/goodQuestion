// 유도 골든셋 하네스 — **엔진과 같은 프롬프트로 대사를 내고**, 나온 것을 정답지 파일에 박제한다.
//
// 파이썬 `src/goodquestion/goldenset_유도.py` 의 두 절(「엔진과 같은 프롬프트」·「뽑기」)을
// 옮긴 것이다 (이슈 #26 · char 트랙 #22).
//
// | 파이썬 | 여기 |
// |---|---|
// | `프롬프트_지문()` | `characterPromptDigest()` |
// | `재료_블록()` | `characterMaterialBlock()` |
// | `대사_요청()` | `lineRequest()` |
// | `엔진_대사_내기()` | `engineLineMaker()` |
// | `항목_뽑기()` | `pickItem()` |
// | `붙여쓰기()` | `appendItem()` |
// | `다음_번호()` | `nextNumber()` |
// | `고쳐쓰기()` | `rewriteLines()` |
// | `_판정값()` | `판정값()` (안 내보낸다) |
// | `대사_적기()` | `recordLines()` |
// | `사람판정_적기()` | `recordHumanVerdict()` |
//
// 읽는 쪽(`유도항목`·`읽기`·`대조_내기` …)은 `@/llm/goldenset-guidance.ts` 에 이미 있다.
// 심판(`과녁을_향했나`·`아이_대신_말했나`)은 `@/llm/judge.ts` 다. 여기서 다시 만들지 않는다.
//
// ## 🔴 이 파일의 존재 이유 — 엔진과 **같은** 프롬프트여야 한다
//
// 골든셋이 엔진과 다른 프롬프트로 돌면 잰 숫자가 엔진 조건의 값이 아니다.
// 2026-08-10 에 파이썬에서 실제로 그랬고(결정 54), 원인은 **재료를 만드는 자리가 둘이었던 것**
// 이다 (`lib/prompts/parse.ts` 의 `materialJson` 머리말).
//
// 그래서 이 파일은 재료 JSON 도 프롬프트 틀도 **직접 만들지 않는다.**
//
// - user 는 `renderCharacterMaterial()` 하나를 지나간다 — 엔진의 `characterTurn()` 이
//   지나가는 것과 **같은 함수**다 (`buildCharacterMaterial()` = 묶음 + 이 함수).
// - system 은 `chooseBody('character', …))` 로 뜬다 — `generateLine()` 과 같은 줄이다.
// - 뽑을 때의 재료 묶음은 `buildCharacterMaterialBundle()` 가 만든다 — 엔진이 만드는 그 dict 다.
//
// ## ⛔ 채점 재료는 캐릭터에게 안 간다
//
// `채점` 블록(`guidance_target`·`element_criterion`)은 캐릭터 LLM 이 절대 못 본다.
// 규칙 층이 넘기는 것은 요소 **이름**과 걱정 문장인데 캐릭터에게는 걱정 문장 한 줄뿐이다
// (기준 문서 13절). 여기서 그 선을 넘으면 **엔진보다 쉬운 문제를 풀리고 재는 것**이 된다.
// `characterMaterialBlock()` 이 `항목.재료` 만 보는 것으로 그 선을 지킨다.
//
// ## ⛔ LLM 을 직접 부르지 않는다
//
// `engineLineMaker()` 만 `generateLine()` 을 감싼다. 나머지는 전부 글자와 파일이다.
// 판을 돌리는 쪽은 **대사 내는 함수를 인자로 받는다** — 검사에서 가짜를 꽂기 위해서다.

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'

import type { Settings } from '@/llm/config'
import { generateLine } from '@/llm/engine/character'
import {
  buildCharacterMaterialBundle,
  renderCharacterMaterial,
  type CharacterMaterialArgs,
  type CharacterScene,
} from '@/llm/engine/material'
import type { GuidanceItem, HumanVerdict } from '@/llm/goldenset-guidance'
import type { CheckResult } from '@/llm/judge'
import { chooseBody, materialJson, promptsDir, 보낼것 } from '@/llm/prompts'
import { fileDigest } from '@/llm/service/goldenset'

// ═══════════════════════════════════════════════════════════════════════════
// ① 엔진과 같은 프롬프트
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 캐릭터 프롬프트 **파일 원문**의 지문 (파이썬 `프롬프트_지문()`).
 *
 * 어느 프롬프트로 낸 대사인지를 `판정대기.프롬프트_지문` 에 박제한다.
 * ⚠️ `보낼것.md` 만 잰다 — 모델이 실제로 받은 글자가 바뀌었을 때만 지문이 바뀌어야
 * 「그때 그 프롬프트였다」를 말할 수 있다 (분석 쪽 `promptDigest()` 와 같은 판단).
 */
export function characterPromptDigest(): string {
  return fileDigest(path.join(promptsDir(), 'character', 보낼것))
}

/**
 * 캐릭터 LLM 에게 갈 JSON 한 덩이 (파이썬 `재료_블록()`).
 *
 * ⛔ `채점` 은 넣지 않는다 — 과녁 이름도 기준 문장도 캐릭터에게 가지 않는다.
 * 그래서 인자가 `항목.재료` 하나다.
 *
 * 🔴 `materialJson()` 을 지나간다 — 엔진이 지나가는 것과 **같은 함수**다. 여기서
 * `JSON.stringify` 를 따로 부르면 그 순간 갈라진다 (`lib/prompts/parse.ts` 머리말).
 * `lineRequest()` 의 `user` 안에 들어가는 것도 이 글자다(`renderCharacterMaterial()` 이 부른다).
 */
export function characterMaterialBlock(항목: Pick<GuidanceItem, '재료'>): string {
  return materialJson(항목.재료)
}

/** LLM 으로 나가는 한 쌍. `lib/prompts` 의 `RenderedPrompt` 와 같은 모양이다. */
export interface LineRequest {
  system: string
  user: string
}

/**
 * 엔진과 **같은 (system, user)** 를 만든다 (파이썬 `대사_요청()`).
 *
 * - `user` — `renderCharacterMaterial()`. 엔진의 `buildCharacterMaterial()` 뒷대목과 같은 함수다.
 * - `system` — `chooseBody(...))`. `generateLine()` 이 쓰는 것과 같은 줄이다.
 *
 * `prompt` 를 주면 그 본문으로 짓는다 — **프롬프트 A 와 B 를 같은 항목에 태워 견주는 자리**다.
 * 그때 본문과 틀은 **같은 출처**여야 하므로 둘 다 같은 값을 받는다.
 */
export function lineRequest(
  항목: Pick<GuidanceItem, '재료'>,
  prompt: string | null = null,
): LineRequest {
  return {
    system: chooseBody('character', prompt),
    user: renderCharacterMaterial(항목.재료),
  }
}

/** 판을 돌리는 쪽이 받는 「대사 내는 함수」. 검사는 여기에 가짜를 꽂는다. */
export type LineMaker = (system: string, user: string) => Promise<string>

export interface EngineLineMakerOptions {
  /** 주면 그 본문으로 판을 돈다. 안 주면 `prompts/character.md`. */
  prompt?: string | null
  settings?: Settings
  notify?: (제목: string, 내용: string) => void
}

/**
 * 진짜 캐릭터 LLM (파이썬 `엔진_대사_내기()`).
 *
 * `generateLine()` 을 그대로 부른다 — **엔진이 회차에서 부르는 것과 같은 함수**다.
 * `system` 은 그쪽이 프롬프트에서 다시 뜨므로 여기서 넘기지 않는다
 * (`lineRequest()` 가 낸 것과 같은 값이다).
 *
 * ⚠️ 응답을 검증하지 않는다. 캐릭터가 이상한 말을 했다는 것 자체가 측정 대상이다.
 */
export function engineLineMaker(options: EngineLineMakerOptions = {}): LineMaker {
  return async (_system: string, user: string): Promise<string> => {
    const { line } = await generateLine(user, options)
    return line
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ② 뽑기 — 회차를 돌며 항목을 파일에 박제한다
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 파이썬 `json.dumps(…, ensure_ascii=False)` 와 **같은 글자**를 만든다.
 *
 * 🔴 `JSON.stringify()` 를 그냥 쓰면 안 된다. 한글은 둘 다 그대로 두지만(파이썬
 * `ensure_ascii=False` = JS 기본) **구분자가 다르다** — 파이썬 기본은 `", "` 와 `": "` 이고
 * `JSON.stringify` 는 공백이 없다. `goldenset/유도/검수전.jsonl` 일곱 줄이 전부 파이썬
 * 기본 형식으로 쓰여 있어서, 여기서 공백을 빼면 `rewriteLines()` 한 번에 **안 고친 줄까지
 * 전부 다시 쓰여** 사람이 무엇이 바뀌었는지 못 본다.
 *
 * ⚠️ 재료가 **순수 JSON 값**일 때만 맞다 (문자열·수·불리언·null·배열·평범한 객체).
 * `toJSON()` 을 가진 것(`Date` 등)은 여기 오지 않는다 — 정답지는 파일에서 읽은 값이다.
 * 칸 순서는 넣은 순서 그대로다 (파이썬 dict 와 JS 객체가 같다).
 */
export function 파이썬_JSON(값: unknown): string {
  if (값 === null || 값 === undefined) return 'null'
  if (Array.isArray(값)) return `[${값.map((하나) => 파이썬_JSON(하나)).join(', ')}]`
  if (typeof 값 === 'object') {
    const 짝들 = Object.entries(값 as Record<string, unknown>)
      // `JSON.stringify` 와 같이 `undefined` 칸은 통째로 뺀다 (파이썬에는 그런 값이 없다).
      .filter(([, 속값]) => 속값 !== undefined)
      .map(([열쇠, 속값]) => `${JSON.stringify(열쇠)}: ${파이썬_JSON(속값)}`)
    return `{${짝들.join(', ')}}`
  }
  return JSON.stringify(값)
}

/** 뽑기가 보는 장면 칸. 캐릭터 재료에 쓰는 것 + 채점에만 쓰는 것 둘. */
export interface PickScene extends CharacterScene {
  scene_order: number
  /** ⛔ 채점 쪽에만 간다. 그 요소가 무엇으로 쳐지는지의 기준 문장들. */
  element_criteria: Readonly<Record<string, string>> | null
}

export interface PickArgs
  extends Omit<CharacterMaterialArgs, 'prompt' | 'scene' | 'guidance_target'> {
  scene: PickScene
  /** 이번 턴의 과녁. 없으면 잴 것이 없다(아래 참고). */
  guidance_target: string | null
  /** 같은 과녁의 몇 번째 항목인가. `nextNumber()` 가 세어 준다. */
  번호: number
}

/**
 * 캐릭터가 대사를 내기 **직전**의 상태를 정답지 한 줄로 만든다 (파이썬 `항목_뽑기()`).
 *
 * 과녁이 없는 턴은 `null` 을 돌려준다 — 잴 것이 없다.
 * NORMAL soft-cue 턴은 대상이 있으므로 **뽑는다**(약한 유도도 유도다).
 *
 * 🔴 재료 묶음을 **손수 짓지 않는다.** `buildCharacterMaterialBundle()` 를 부른다 —
 * 베껴 쓰면 엔진과 조용히 갈라지고, 그러면 박제한 값이 엔진 입력이 아니게 된다.
 *
 * ⚠️ **파이썬과 인자가 다르다.** 파이썬은 `conn`·`session_id`·`turn_order` 를 받아
 * 이 안에서 `db.장면_메시지들()` 로 캐릭터가 본 이력을 떴다. 여기서는 엔진과 같이
 * **부르는 쪽이 잘라 넘긴다**(`pastMessages`) — `lib/engine/*` 이 `repo` 를 모르는 것이
 * 이 판의 구조이고(2026-08-12), 자르는 지점을 엔진과 같게 두는 것이 원래 의도였다.
 */
export function pickItem(args: PickArgs): Record<string, unknown> | null {
  const { scene, guidance_target: 대상, 번호 } = args
  if (!대상) return null

  const 기준 = (scene.element_criteria ?? {})[대상] ?? ''
  const 재료 = buildCharacterMaterialBundle({ ...args, guidance_target: 대상 })
  const 장면 = String(scene.scene_order).padStart(2, '0')
  const 차례 = String(번호).padStart(3, '0')

  return {
    // `banggui` 는 파이썬이 박아 둔 그대로다. 이야기가 하나뿐이라 아직 갈래가 없다.
    id: `gd_banggui_${장면}_${대상}_${차례}`,
    검수: '초안',
    scene_order: scene.scene_order,
    // ⚠️ 이름이 「장면_이름」이지만 담기는 것은 캐릭터 이름이다. 파이썬이 그렇고 파일도 그렇다.
    장면_이름: scene.character_name ?? '',
    재료,
    // ⛔ 캐릭터에게 안 간 것들이다. 채점 쪽에만 둔다.
    채점: { guidance_target: 대상, element_criterion: 기준 },
    사람판정: [],
    메모: '',
  }
}

/** 한 줄씩 이어 붙인다 (파이썬 `붙여쓰기()`). 파일이 없으면 머리말 없이 만든다 — 머리말은 사람이 쓴다. */
export function appendItem(경로: string, 항목: Readonly<Record<string, unknown>>): void {
  mkdirSync(path.dirname(경로), { recursive: true })
  appendFileSync(경로, `${파이썬_JSON(항목)}\n`, 'utf-8')
}

/**
 * 같은 과녁의 항목이 몇 개나 있나 + 1 (파이썬 `다음_번호()`). `id` 가 겹치지 않게 이어 붙일 때 쓴다.
 *
 * ⚠️ **줄 전체에서 `_과녁_` 를 찾는다** — `id` 만 보지 않는다. 대사에 그 글자가 들어 있으면
 * 같이 세어진다. 파이썬이 그렇고, 이식은 지금 모양 그대로다.
 */
export function nextNumber(경로: string, 대상: string): number {
  if (!existsSync(경로)) return 1
  let 셈 = 0
  for (const 원문줄 of readFileSync(경로, 'utf-8').split('\n')) {
    const 줄 = 원문줄.trim()
    if (줄 !== '' && !줄.startsWith('//') && 줄.includes(`_${대상}_`)) 셈 += 1
  }
  return 셈 + 1
}

/** `rewriteLines()` 가 줄마다 부르는 함수. `null` 이면 그 줄은 안 바꾼다. */
export type LineEdit = (자료: Record<string, unknown>) => Record<string, unknown> | null

/**
 * 정답지의 **JSON 줄만** 손보고 다시 쓴다 (파이썬 `고쳐쓰기()`).
 * 머리말(`//`)과 빈 줄은 글자 그대로 둔다. 돌려주는 것은 실제로 바뀐 줄 수다.
 *
 * 🔴 **원자적으로 쓴다.** 파이썬은 `write_text()` 로 제자리에 썼지만, 중간에 죽으면
 * 사람이 매긴 판정이 통째로 날아간다 — 되살릴 데가 없는 값이다. 그래서 같은 디렉터리의
 * 임시 파일에 다 쓰고 `rename` 한다(같은 파일시스템이라 원자적이다). 실패하면 임시만 지운다.
 * **이식하면서 일부러 갈라 둔 자리다.**
 *
 * ⚠️ 통째로 다시 쓰므로 **다른 프로세스가 같은 파일에 붙여쓰는 중이면 안 된다.**
 * 회차를 돌리면서 동시에 판정을 적지 말 것. (rename 은 반쯤 쓰인 파일만 막는다.)
 */
export function rewriteLines(경로: string, 고치기: LineEdit): number {
  const 줄들 = readFileSync(경로, 'utf-8').split('\n')
  // 파이썬 `splitlines()` 는 끝의 개행 뒤에 빈 줄을 만들지 않는다. 여기서도 맞춘다.
  if (줄들.length > 0 && 줄들[줄들.length - 1] === '') 줄들.pop()

  const 새_줄들: string[] = []
  let 바뀐 = 0

  for (const 원문줄 of 줄들) {
    const 줄 = 원문줄.trim()
    if (줄 === '' || 줄.startsWith('//')) {
      새_줄들.push(원문줄)
      continue
    }
    const 자료 = JSON.parse(줄) as Record<string, unknown>
    const 고친것 = 고치기(자료)
    if (고친것 === null) {
      새_줄들.push(원문줄)
      continue
    }
    새_줄들.push(파이썬_JSON(고친것))
    바뀐 += 1
  }

  const 임시 = `${경로}.${process.pid}.tmp`
  try {
    writeFileSync(임시, `${새_줄들.join('\n')}\n`, 'utf-8')
    renameSync(임시, 경로)
  } catch (오류) {
    rmSync(임시, { force: true })
    throw 오류
  }
  return 바뀐
}

/** 채점 하나의 값을 심판이 쓰는 낱말로 (파이썬 `_판정값()`). `null` 은 **판정불가**다 (결정 29). */
function 판정값(점수: number | null | undefined, 좋음: string, 나쁨: string): string {
  if (점수 === 1) return 좋음
  if (점수 === 0) return 나쁨
  return '판정불가'
}

/** 채점 목록에서 이름으로 값 하나 (파이썬 `한판.점수()`). 없으면 `null` — 판정 안 한 것과 같다. */
function 점수(채점들: readonly CheckResult[] | undefined, 이름: string): number | null {
  return 채점들?.find((하나) => 하나.name === 이름)?.value ?? null
}

/**
 * `recordLines()` 가 한 판 결과에서 실제로 보는 것만 (파이썬 `한판` 의 부분집합).
 *
 * 판을 도는 쪽은 `tools/유도셋-판.ts` 의 `RoundResult` 이고 **이 모양을 만족한다.**
 * 그래도 여기서 통째 타입을 요구하지 않는 것은 **적는 쪽이 도는 쪽을 몰라도 되게** 하기
 * 위해서다 — 이 파일은 `유도셋-판.ts` 를 import 하지 않는다(방향은 판 → 기록 한쪽뿐이다).
 */
export interface RoundLine {
  항목_id: string
  /** 대사를 못 냈으면 `null`. 그 줄은 적지 않는다 — 실패는 판 합계에 남는다. */
  대사: string | null
  채점들?: readonly CheckResult[]
}

export interface RecordLinesOptions {
  돌린날: string
  /** `characterPromptDigest()`. 어느 프롬프트로 낸 대사인지. */
  프롬프트_지문?: string
}

/**
 * 판에서 나온 대사를 `판정대기` 로 파일에 남긴다 (파이썬 `대사_적기()`).
 *
 * 사람이 판정할 재료다. 같은 대사가 이미 있으면 안 넣는다 — 판을 두 번 돌려 우연히
 * 같은 문장이 나와도 물음이 두 번 뜨지 않게. 돌려주는 것은 바뀐 줄 수다.
 */
export function recordLines(
  경로: string,
  결과들: readonly RoundLine[],
  { 돌린날, 프롬프트_지문 = '' }: RecordLinesOptions,
): number {
  const 대사_by_id = new Map<string, RoundLine>()
  for (const 한 of 결과들) {
    if (한.대사) 대사_by_id.set(한.항목_id, 한)
  }

  return rewriteLines(경로, (자료) => {
    const 한 = 대사_by_id.get(String(자료.id ?? ''))
    if (한 === undefined || !한.대사) return null

    const 대기들 = Array.isArray(자료.판정대기) ? [...(자료.판정대기 as unknown[])] : []
    const 이미있나 = 대기들.some(
      (대기) =>
        typeof 대기 === 'object' && 대기 !== null && (대기 as Record<string, unknown>).대사 === 한.대사,
    )
    if (이미있나) return null

    대기들.push({
      대사: 한.대사,
      심판_과녁: 판정값(점수(한.채점들, 'guided_toward_target'), '적중', '빗나감'),
      심판_답누출: 판정값(점수(한.채점들, 'gave_away_element'), '지킴', '위반'),
      돌린날,
      프롬프트_지문,
    })
    자료.판정대기 = 대기들
    return 자료
  })
}

/**
 * 인터뷰에서 나온 사람 판정 하나를 파일에 넣는다 (파이썬 `사람판정_적기()`). 넣었으면 `true`.
 *
 * 같은 대사에 이미 판정이 있으면 기본으로 **안 건드린다** — 인터뷰를 두 번 돌다 먼저 매긴 것을
 * 조용히 지우면 안 되기 때문이다.
 *
 * `덮어쓰기` 는 **기준이 바뀌어 다시 매기는 자리**를 위한 것이다 (예: `element_criteria` 를
 * 고치면 그 기준으로 준 판정이 낡는다). 옛 판정은 `근거` 앞에 남겨 둔다 —
 * 무엇이 왜 뒤집혔는지가 곧 기록이다.
 */
export function recordHumanVerdict(
  경로: string,
  항목_id: string,
  판정: HumanVerdict,
  { 덮어쓰기 = false }: { 덮어쓰기?: boolean } = {},
): boolean {
  let 넣음 = false

  rewriteLines(경로, (자료) => {
    if (자료.id !== 항목_id) return null

    const 판정들 = Array.isArray(자료.사람판정) ? [...(자료.사람판정 as unknown[])] : []
    const 자리 = 판정들.findIndex(
      (하나) =>
        typeof 하나 === 'object' && 하나 !== null && (하나 as Record<string, unknown>).대사 === 판정.대사,
    )
    let 근거 = 판정.근거

    if (자리 !== -1) {
      if (!덮어쓰기) return null // 이미 매긴 대사다
      const 옛것 = 판정들[자리] as Record<string, unknown>
      판정들.splice(자리, 1)
      // ⚠️ 파이썬은 없는 칸을 `None` 으로 찍는다. 여기서는 빈 글자다 — 파일이 깨진 줄에서만
      //    갈리는 자리이고, 그런 줄은 애초에 파서에서 터진다.
      근거 = (
        `[${String(옛것.매긴날 ?? '')} 옛 판정: 과녁=${String(옛것.과녁 ?? '')} ` +
        `답누출=${String(옛것.답누출 ?? '')} — ${String(옛것.근거 ?? '')}] ${근거}`
      ).trim()
    }

    판정들.push({
      대사: 판정.대사,
      과녁: 판정.과녁,
      답누출: 판정.답누출,
      근거,
      매긴날: 판정.매긴날,
    })
    자료.사람판정 = 판정들
    넣음 = true
    return 자료
  })

  return 넣음
}
