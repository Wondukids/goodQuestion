// 골든셋을 실제 분석 LLM 에 태워 채점한다 (이슈 #26 · 화면-골든셋).
//
// 파이썬 `src/goodquestion_admin/채점.py` 364줄과 `routes/goldenset.py` 의 규칙 부분을
// 옮긴 것이다. **점수를 내는 것은 이 파일이 아니다** — `lib/scoring.ts` 의 `score()` 다
// (`CLAUDE.md` 경계 6: 화면도 서비스도 실행기를 부를 뿐 스스로 계산하지 않는다).
//
// 이 파일이 하는 일은 넷이다.
//
// 1. 정답지 파일을 찾아 읽는다 (⚠️ **쓰지 않는다** — 고치는 길이 아예 없다. FR-058 · SC-015)
// 2. 항목마다 분석기를 부르고, **답이 온 것만** 채점기에 넘긴다
// 3. 원자료를 `goldenset_runs` · `goldenset_results` 에 남긴다
// 4. 남은 것을 화면이 그릴 모양으로 조립한다
//
// ## 「판정 불가」를 분모에서 빼는 방법
//
// `lib/scoring.ts` 머리말과 같은 규칙이다 — 답이 안 온 항목은 애초에 `score()` 에
// 넘기지 않는다. 그러면 `표.건수` 가 곧 판정한 수가 되고 분모가 저절로 맞는다.
// 판정 불가로 떨어지는 것은 둘뿐이다.
//
// 1. 분석기 호출이 실패했다 — API 에러 · 네트워크 · 타임아웃
// 2. 응답을 라벨로 못 바꿨다 — JSON 이 아니거나 깨졌다
//
// ⚠️ **라벨이 왔는데 정답과 다른 것은 「틀림」이지 판정 불가가 아니다.**
//
// ## 왜 `analyze()` 를 안 부르나
//
// `lib/engine/analyze.ts` 의 `analyze()` 는 응답을 **zod 로 검증한다** (경계 1 을 지키는 자리다).
// 골든셋은 일부러 검증하지 않는다 — 목록 밖 값을 냈다는 것 자체가 **측정 대상**이라,
// 검증을 태우면 「틀림」이 예외가 되어 「판정 불가」로 바뀐다 (결정 29).
// 그래서 부르는 길은 따로 두되 **재료를 만드는 방식은 엔진과 똑같이** 한다 (결정 54) —
// `buildAnalysisMaterial()` 하나를 지나간다. 2026-08-10 에 파이썬에서 이게 갈려서
// 골든셋이 **엔진에 없는 프롬프트를 재고 있었다.**

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { loadSettings, PROJECT_ROOT, type Settings, 제미나이_키_번호들 } from '@/lib/config'
import { ValueError } from '@/lib/domain/progress'
import { 분석_스키마 } from '@/lib/engine/analyze'
import { buildAnalysisMaterial } from '@/lib/engine/material'
import { complete } from '@/lib/llm'
import { chooseBody, promptsDir, sendableBody } from '@/lib/prompts'
import { getDb, type Conn } from '@/lib/repo/db'
import {
  createGoldensetRun,
  endGoldensetRun,
  insertGoldensetResult,
  listGoldensetRuns,
  readGoldensetRun,
  readGoldensetRunResults,
  type GoldensetRunRow,
} from '@/lib/repo/goldenset'
import {
  GoldensetError,
  isCorrect,
  parseGoldenset,
  responseToLabel,
  reviewedOnly,
  score,
  type GoldenItem,
  type GoldenLabel,
  type ItemScore,
  type ScorePair,
  type ScoreTable,
} from '@/lib/scoring'

export { GoldensetError, reviewedOnly } from '@/lib/scoring'

// ═══════════════════════════════════════════════════════════════════════════
// 정답지 파일 — ⚠️ 읽기만 한다
//
// 화면에서 고치는 길을 내지 않는다. 정본은 파일이고 사람이 옮긴다
// (`CLAUDE.md` 경계 6 의 프롬프트 규칙과 같은 원리).
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `<레포>/goldenset`. `src/` 아래가 아니다 — 파이썬 판과 **같은 파일**을 읽는다.
 *
 * 🔴 `PROJECT_ROOT`(`lib/config.ts`)가 한 칸이라도 어긋나면 여기가 없는 폴더를 가리키고
 *    `goldensetFiles()` 가 예외 없이 `[]` 를 돌려준다 — **화면만 조용히 빈다.**
 *    그래서 착지 확인에 「/goldenset 에 파일 둘이 보이나」가 들어 있다.
 */
export const GOLDENSET_DIR = path.join(PROJECT_ROOT, 'goldenset')

/** `goldenset/*.jsonl` 의 파일 이름들. 건수도 파일 수도 코드에 박지 않는다. */
export function goldensetFiles(): string[] {
  if (!existsSync(GOLDENSET_DIR)) return []
  return readdirSync(GOLDENSET_DIR)
    .filter((이름) => 이름.endsWith('.jsonl'))
    .sort()
}

/** 이름을 실제 경로로 바꾼다. **폴더 밖으로 나가는 이름은 받지 않는다.** */
export function goldensetPath(이름: string | null): string {
  const 파일들 = goldensetFiles()
  if (파일들.length === 0) {
    throw new GoldensetError(`${GOLDENSET_DIR} 에 정답지 파일(*.jsonl)이 없다`)
  }
  const 고른_것 = 이름 ?? 파일들[0]
  if (!파일들.includes(고른_것)) {
    throw new GoldensetError(`골든셋 폴더에 없는 파일이다: ${JSON.stringify(고른_것)}`)
  }
  return path.join(GOLDENSET_DIR, 고른_것)
}

/** 정답지 한 파일을 읽는다. 오류에는 `파일:줄번호` 가 붙는다. */
export function readGoldensetFile(경로: string): GoldenItem[] {
  return parseGoldenset(readFileSync(경로, 'utf-8'), 경로)
}

/** 파일 원문 bytes 의 SHA-256 지문 (정규화하지 않는다) — 파이썬 `파일_지문()`. */
export function fileDigest(경로: string): string {
  return createHash('sha256').update(readFileSync(경로)).digest('hex')
}

/**
 * 분석 프롬프트 파일 **전체 원문**의 지문 — 파이썬 `프롬프트_지문()`.
 *
 * ⚠️ 보낼 층(`sendableBody()`)이 아니라 파일 통째다. 사람이 한글 층만 고쳐도 지문이 바뀌어야
 *    「그때 그 프롬프트였다」를 말할 수 있다.
 */
export function promptDigest(): string {
  return fileDigest(path.join(promptsDir(), 'analysis.md'))
}

// ═══════════════════════════════════════════════════════════════════════════
// 분석기 — 골든셋용 LLM 어댑터
// ═══════════════════════════════════════════════════════════════════════════

/** 분석기가 돌려주는 것. `got_model` 은 **실제로 답한** 모델이다 (fallback 을 눈으로 봐야 한다). */
export interface AnalyzedLabel {
  라벨: GoldenLabel
  got_model: string | null
}

/** 항목 하나를 분석하는 함수. 검사는 여기에 가짜를 꽂는다. */
export type GoldensetAnalyzer = (항목: GoldenItem) => Promise<AnalyzedLabel>

/** 응답은 왔는데 라벨로 못 바꿨다. **답한 모델은 보존한다** (파이썬 `LLM응답변환오류`). */
export class LabelParseError extends Error {
  readonly got_model: string | null

  constructor(메시지: string, got_model: string | null) {
    super(메시지)
    this.name = 'LabelParseError'
    this.got_model = got_model
  }
}

export interface AnalyzeItemOptions {
  /** 먼저 쓸 제미나이 키 번호. */
  키?: number
  /**
   * `element_criteria` 를 재료에 싣나. **기본은 끔.**
   *
   * 파이썬이 기준선을 이 조건(빈 값)으로 재 왔다. 한 번에 하나만 바꾸려면
   * 기준선을 먼저 잡고 켠 채로 한 번 더 재서 **그 차이만** 봐야 한다 (2026-08-10 사람 결정).
   * 그 16문장은 아직 **검수받지 않은 AI 초안**이기도 하다 (결정 34 Q3).
   */
  기준_포함?: boolean
  settings?: Settings
}

/**
 * 골든셋 항목 하나를 분석 LLM 에 태운다 (파이썬 `goldenset.llm_분석결과()`).
 *
 * 🔴 **`goal` 을 안 보낸다.** 정답지 한 줄에는 `scene_goal` 이 없고, 파이썬은 goal **없이**
 *    재 왔다. 켠 채로 재면 점수가 떨어졌을 때 「이식 실수」인지 「goal 탓」인지 못 가른다
 *    (`docs/설계/이식_체크리스트.md` B-3 → B-5 순서). 켜는 것은 B-5 의 일이다.
 *
 * ⛔ 한 판에 두 회사를 섞지 않고 유료 fallback 도 안 태운다 (`include_anthropic: false`).
 *    실제 대화 엔진이 쓰는 `complete()` 기본 체인에는 앤트로픽이 그대로 남는다.
 */
export async function analyzeGoldenItem(
  항목: GoldenItem,
  { 키 = 1, 기준_포함 = false, settings }: AnalyzeItemOptions = {},
): Promise<AnalyzedLabel> {
  const user = buildAnalysisMaterial({
    scene: {
      scene_description: 항목.scene_description,
      conflict: 항목.conflict,
      required_elements: 항목.target_elements,
      element_criteria: 기준_포함 ? 항목.element_criteria : {},
    },
    child_utterance: 항목.child_utterance,
    previous_character_message: 항목.previous_character_message,
    include_goal: false,
  })
  const system = sendableBody(chooseBody('analysis', null))

  const 결과 = await complete(system, user, {
    json_schema: 분석_스키마,
    settings,
    purpose: 'analysis',
    preferred_gemini_key: 키,
    include_anthropic: false,
  })

  try {
    return { 라벨: responseToLabel(결과.text), got_model: 결과.model }
  } catch (오류) {
    throw new LabelParseError(오류 instanceof Error ? 오류.message : String(오류), 결과.model)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 돌리기
// ═══════════════════════════════════════════════════════════════════════════

/** 항목 하나를 돌린 결과. 셋 중 하나다 — 맞음 · 틀림 · 판정 불가 (파이썬 `항목결과`). */
export interface ItemOutcome {
  항목: GoldenItem
  라벨: GoldenLabel | null
  /** `null` 이면 판정 불가다. */
  채점: ItemScore | null
  판정불가_사유: string | null
  got_model: string | null
}

/** 돌린 항목 전부와, **판정한 것만으로 낸** 점수표 (파이썬 `돌린_결과`). */
export interface RunOutcome {
  결과들: readonly ItemOutcome[]
  표: ScoreTable
  중단_메모: string | null
}

/** 한 판을 사람이 읽는 다섯 숫자로 (파이썬 `돌린_결과` 의 프로퍼티들). */
export interface RunSummary {
  돌린_수: number
  판정불가_수: number
  /** 위반율·정확도의 분모. 판정 불가를 뺀 수다. */
  판정한_수: number
  맞은_수: number
  틀린_수: number
  /**
   * 판정한 것이 하나도 없으면 0% 가 아니라 「잰 것이 없다」다.
   *
   * 「모름」을 0 으로 채우지 않는다 — 0.000 을 띄우면 다 틀린 것처럼 보인다.
   */
  점수를_낼_수_있나: boolean
}

export function summarize(
  결과들: readonly { 채점: ItemScore | null }[],
  표: Pick<ScoreTable, '건수'>,
): RunSummary {
  const 판정불가_수 = 결과들.filter((행) => 행.채점 === null).length
  const 맞은_수 = 결과들.filter((행) => isCorrect(행.채점)).length
  return {
    돌린_수: 결과들.length,
    판정불가_수,
    판정한_수: 표.건수,
    맞은_수,
    틀린_수: 결과들.filter((행) => 행.채점 !== null && !isCorrect(행.채점)).length,
    점수를_낼_수_있나: 표.건수 > 0,
  }
}

export interface RunGoldensetOptions {
  /** 호출 시작을 분당 N건 이하로 제한. 안 주면 쉬지 않는다. */
  분당?: number | null
  /** 결과 한 건이 나올 때마다 부른다. **호출 직후**라 `created_at` 이 호출 간격을 보존한다. */
  onItem?: (행: ItemOutcome) => Promise<void> | void
}

function 쉰다(밀리초: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 밀리초))
}

/**
 * 항목마다 분석기를 부르고, **답이 온 것만** 채점기에 넘긴다 (파이썬 `골든셋_돌리기()`).
 *
 * 파이썬 `goldenset.돌린다()` 를 안 쓰는 이유는 그 함수가 **한 항목에서 터지면 그대로
 * 터뜨리기** 때문이다. 터미널에서는 그게 맞다 — 몇 건으로 낸 점수인지가 흐려지면 안 되니까.
 * 화면에서는 30건 중 1건이 타임아웃 났다고 나머지 29건의 결과가 사라지면 안 되므로,
 * 터뜨리는 대신 그 한 건을 **판정 불가로 세워 두고 분모에서 뺀다.**
 *
 * ⭐ **연속 3건이 실패하면 멈춘다.** 키가 통째로 막힌 상태에서 남은 건을 계속 던지면
 *    그날 측정이 통째로 판정 불가가 된다.
 */
export async function runGoldenset(
  항목들: readonly GoldenItem[],
  분석기: GoldensetAnalyzer,
  { 분당 = null, onItem }: RunGoldensetOptions = {},
): Promise<RunOutcome> {
  if (분당 !== null && 분당 !== undefined && 분당 < 1) {
    throw new ValueError('분당 호출 수는 1 이상이어야 한다')
  }

  const 쌍들: ScorePair[] = []
  const 결과들: ItemOutcome[] = []
  const 호출_간격 = 분당 === null || 분당 === undefined ? null : 60_000 / 분당
  let 다음_호출_시각: number | null = null
  let 연속_실패 = 0
  let 중단_메모: string | null = null

  for (const [차례, 항목] of 항목들.entries()) {
    if (다음_호출_시각 !== null) {
      const 기다릴 = 다음_호출_시각 - Date.now()
      if (기다릴 > 0) {
        console.log(`분당 ${분당}건 속도 제한 때문에 다음 호출까지 ${(기다릴 / 1000).toFixed(1)}초 쉰다.`)
        await 쉰다(기다릴)
      }
    }
    if (호출_간격 !== null) 다음_호출_시각 = Date.now() + 호출_간격

    let 행: ItemOutcome
    try {
      const { 라벨, got_model } = await 분석기(항목)
      쌍들.push({ 항목, 라벨 })
      // 한 건짜리 채점을 따로 돌려 그 항목의 O/X 를 바로 얻는다. 채점기는 하나다.
      const 한건_채점 = score([{ 항목, 라벨 }]).항목별[0]
      행 = { 항목, 라벨, 채점: 한건_채점, 판정불가_사유: null, got_model }
      연속_실패 = 0
    } catch (오류) {
      // ⛔ 한 건 실패가 나머지를 지우면 안 된다.
      const 이름 = 오류 instanceof Error ? 오류.name : typeof 오류
      const 말 = 오류 instanceof Error ? 오류.message : String(오류)
      행 = {
        항목,
        라벨: null,
        채점: null,
        판정불가_사유: `${이름}: ${말}`,
        got_model: 오류 instanceof LabelParseError ? 오류.got_model : null,
      }
      연속_실패 += 1
    }

    결과들.push(행)
    if (onItem !== undefined) await onItem(행)

    if (연속_실패 === 3) {
      const 남은_수 = 항목들.length - 차례 - 1
      중단_메모 = `연속 3건 실패로 멈췄다. 남은 ${남은_수}건은 안 돌렸다`
      console.error(중단_메모)
      break
    }
  }

  return { 결과들, 표: score(쌍들), 중단_메모 }
}

// ═══════════════════════════════════════════════════════════════════════════
// 한 조각을 한 판으로 — 원자료를 모두 남긴다
// ═══════════════════════════════════════════════════════════════════════════

export interface RunFileOptions {
  경로: string
  /** 조각 크기가 아니다. 어느 판이든 **정답지 파일 전체 건수**를 보존한다. */
  전체_항목들: readonly GoldenItem[]
  항목들: readonly GoldenItem[]
  키?: number
  분당?: number | null
  기준_포함?: boolean
  started_by?: string | null
  /** 안 주면 실제 분석 LLM 을 부른다. **검사는 반드시 가짜를 꽂는다** (F-1). */
  분석기?: GoldensetAnalyzer
  conn?: Conn
  settings?: Settings
}

/** 판 하나를 돌린 뒤 돌려주는 것. `goldenset_run_id` 가 있어야 화면이 그 판을 다시 읽는다. */
export interface RunFileResult extends RunOutcome {
  goldenset_run_id: string
}

/**
 * 정답지의 한 조각을 한 판으로 돌리고 원자료를 모두 저장한다 (파이썬 `파일_골든셋_실행()`).
 *
 * 판을 **먼저** 열고 한 건씩 넣는다 — 중간에 막혀도 앞 건이 남는다.
 */
export async function runFileGoldenset({
  경로,
  전체_항목들,
  항목들,
  키 = 1,
  분당 = null,
  기준_포함 = false,
  started_by = null,
  분석기,
  conn,
  settings,
}: RunFileOptions): Promise<RunFileResult> {
  const 설정 = settings ?? loadSettings()
  제미나이_키_확인(키, 설정)

  const 연결 = conn ?? getDb()
  const 판 = await createGoldensetRun(연결, {
    file_name: path.basename(경로),
    file_digest: fileDigest(경로),
    file_item_count: 전체_항목들.length,
    prompt_digest: promptDigest(),
    prompt_label: null,
    requested_model: 설정.gemini_model,
    started_by,
    note: null,
  })

  const 돌린것 = await runGoldenset(
    항목들,
    분석기 ?? ((항목) => analyzeGoldenItem(항목, { 키, 기준_포함, settings: 설정 })),
    {
      분당,
      // 호출 직후 저장해야 `created_at` 이 실제 호출 시각의 간격을 보존한다.
      onItem: async (행) => {
        const 라벨 = 행.라벨
        await insertGoldensetResult(연결, {
          goldenset_run_id: 판.id,
          item_id: 행.항목.id,
          item_review: 행.항목.검수,
          unjudged_reason: 행.판정불가_사유,
          got_model: 행.got_model,
          expected_child_intent: 행.항목.정답.child_intent,
          expected_validity: 행.항목.정답.utterance_validity,
          expected_elements: 행.항목.정답.detected_elements,
          got_child_intent: 라벨 === null ? null : 라벨.child_intent,
          got_validity: 라벨 === null ? null : 라벨.utterance_validity,
          got_elements: 라벨 === null ? null : 라벨.detected_elements,
          got_main_point: 라벨 === null ? null : 라벨.main_point,
        })
      },
    },
  )

  await endGoldensetRun(연결, 판.id, { note: 돌린것.중단_메모 })
  return { ...돌린것, goldenset_run_id: 판.id }
}

// ═══════════════════════════════════════════════════════════════════════════
// 화면이 부르는 자리 — 규칙은 전부 여기 있고 라우트·액션에는 없다
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 먼저 쓸 제미나이 키 번호를 검사한다 (파이썬 라우트의 `_키_칸()`).
 *
 * **한 건이라도 부르기 전에** 막는다. 키 지정은 결정 53 이 금지한 '막힌 키 기억'이 아니라
 * 사람이 이번 조각에만 주는 시작 순서이며, 다음 호출에는 남지 않는다.
 */
export function 제미나이_키_확인(키: number, settings?: Settings): number {
  if (!(제미나이_키_번호들 as readonly number[]).includes(키)) {
    throw new ValueError(`키는 ${제미나이_키_번호들.join(' · ')} 중 하나여야 한다`)
  }
  const 설정 = settings ?? loadSettings()
  if (키 !== 1 && !설정.gemini_api_keys[키 - 1]) {
    throw new ValueError(`GQ_GEMINI_API_KEY_${키} 가 설정돼 있지 않다`)
  }
  return 키
}

export interface SliceOptions {
  /** 몇 번째부터. **사람이 세는 번호다** — `1` 이 첫 줄이다 (0 부터가 아니다). */
  offset?: number | null
  /** 몇 건을. 안 주면 끝까지. */
  limit?: number | null
}

/**
 * 조각을 자른다 (파이썬 라우트의 `offset`·`limit` 계산).
 *
 * ## 왜 `offset` 이 있나 (2026-08-10 사람 승인)
 *
 * `limit` 만 있던 시절엔 **언제나 1번부터** 잘렸다. 그래서 43건을 나눠 돌리려고
 * 10 → 20 → 43 으로 키우면 앞 건이 반복해 돌아 **43건에 73번**을 불렀다.
 *
 * ⛔ **범위 밖을 가리키면 조용히 0건을 돌리지 않는다.** 「돌렸는데 아무것도 안 나왔다」와
 *    「가리킨 곳에 아무것도 없다」는 다른 말이고, 섞이면 사람이 성공으로 오해한다.
 */
export function sliceItems(
  항목들: readonly GoldenItem[],
  { offset = null, limit = null }: SliceOptions = {},
): GoldenItem[] {
  if (offset !== null && offset !== undefined && offset < 1) {
    throw new ValueError('시작 번호는 1 이상이어야 한다')
  }
  if (limit !== null && limit !== undefined && limit < 1) {
    throw new ValueError('건수는 1 이상이어야 한다')
  }
  const 처음 = offset ? offset - 1 : 0
  const 돌릴_것 =
    limit === null || limit === undefined
      ? 항목들.slice(처음)
      : 항목들.slice(처음, 처음 + limit)

  if (돌릴_것.length === 0) {
    throw new ValueError(
      `그 범위에는 항목이 없다 — 이 정답지는 ${항목들.length}건인데 ${처음 + 1}번째부터 달라고 했다`,
    )
  }
  return 돌릴_것
}

export interface StartRunArgs {
  file: string | null
  offset?: number | null
  limit?: number | null
  key?: number
  per_minute?: number | null
  /** ⭐ `--검수완료만`. 켜면 검수 끝난 것만 돌린다. **자르기보다 먼저 거른다** (CLI 와 같은 차례). */
  reviewed_only?: boolean
  기준_포함?: boolean
  started_by?: string | null
  분석기?: GoldensetAnalyzer
  conn?: Conn
  settings?: Settings
}

/**
 * 화면의 「골든셋 돌리기」 단추 하나 (파이썬 `routes/goldenset.전체_돌리기()`).
 *
 * ⚠️ `reviewed_only` 를 걸러도 `file_item_count` 는 **파일 전체 건수** 그대로다.
 *    「73건짜리 파일에서 30건을 골라 돌렸다」가 남아야 판끼리 견줄 수 있다.
 */
export async function startGoldensetRun(args: StartRunArgs): Promise<RunFileResult> {
  const 경로 = goldensetPath(args.file)
  const 전체_항목들 = readGoldensetFile(경로)
  const 고른것 = args.reviewed_only ? reviewedOnly(전체_항목들) : 전체_항목들
  if (고른것.length === 0) {
    throw new ValueError('검수 끝난 항목이 이 정답지에 하나도 없다')
  }
  const 돌릴_것 = sliceItems(고른것, { offset: args.offset, limit: args.limit })

  return runFileGoldenset({
    경로,
    전체_항목들,
    항목들: 돌릴_것,
    키: 제미나이_키_확인(args.key ?? 1, args.settings),
    분당: args.per_minute ?? null,
    기준_포함: args.기준_포함 ?? false,
    started_by: args.started_by ?? 'admin-web',
    분석기: args.분석기,
    conn: args.conn,
    settings: args.settings,
  })
}

export interface RunItemArgs {
  file: string | null
  item_id: string
  key?: number
  per_minute?: number | null
  기준_포함?: boolean
  started_by?: string | null
  분석기?: GoldensetAnalyzer
  conn?: Conn
  settings?: Settings
}

/** 항목 하나만 돌린다 (파이썬 `routes/goldenset.한_건_돌리기()`). 그것도 한 판으로 남는다. */
export async function runGoldensetItem(args: RunItemArgs): Promise<RunFileResult> {
  const 경로 = goldensetPath(args.file)
  const 전체_항목들 = readGoldensetFile(경로)
  const 항목 = 전체_항목들.find((항목) => 항목.id === args.item_id)
  if (항목 === undefined) {
    throw new ValueError(`그런 항목이 없다: ${args.item_id}`)
  }

  return runFileGoldenset({
    경로,
    전체_항목들,
    항목들: [항목],
    키: 제미나이_키_확인(args.key ?? 1, args.settings),
    분당: args.per_minute ?? null,
    기준_포함: args.기준_포함 ?? false,
    started_by: args.started_by ?? 'admin-web',
    분석기: args.분석기,
    conn: args.conn,
    settings: args.settings,
  })
}

// ── 화면에 그릴 모양 ────────────────────────────────────────────────────────

/**
 * 항목 한 건의 결과 (화면이 한 칸에 그리는 것).
 *
 * ⭐ 돌린 직후 메모리에서 온 것이든 나중에 DB 에서 읽은 것이든 **같은 모양**이다.
 *    그래서 한 판을 새로고침해도 화면이 달라지지 않는다.
 */
export interface ResultView {
  item_id: string
  item_review: string
  판정불가_사유: string | null
  got_model: string | null
  기대: { child_intent: string; utterance_validity: string; detected_elements: readonly string[] }
  /** 판정 불가면 `null`. */
  라벨: GoldenLabel | null
  채점: ItemScore | null
  판정불가: boolean
  맞음: boolean
}

/** 판 하나를 화면이 그릴 모양으로. */
export interface RunView {
  run: GoldensetRunRow
  결과들: readonly ResultView[]
  /** `item_id` → 그 항목의 결과. 표를 그릴 때 항목 줄에 붙인다. */
  줄들: Map<string, ResultView>
  표: ScoreTable
  요약: RunSummary
}

/**
 * 저장된 판 하나를 되살린다.
 *
 * ⛔ **점수를 새로 짓지 않는다.** 저장된 `expected_*`·`got_*` 를 그대로 `score()` 에 넣어
 *    돌린 그 순간과 같은 채점기를 지나게 한다 — 판정 불가 건은 넣지 않으므로 분모도 그대로다.
 */
export async function goldensetRunView(
  goldenset_run_id: string,
  conn?: Conn,
): Promise<RunView> {
  const 연결 = conn ?? getDb()
  const run = await readGoldensetRun(연결, goldenset_run_id)
  const 행들 = await readGoldensetRunResults(연결, goldenset_run_id)

  const 쌍들: ScorePair[] = []
  const 판정한_자리: number[] = []
  행들.forEach((행, 자리) => {
    if (행.unjudged_reason !== null) return
    쌍들.push({
      항목: {
        id: 행.item_id,
        검수: 행.item_review,
        정답: {
          child_intent: 행.expected_child_intent,
          detected_elements: 행.expected_elements,
          utterance_validity: 행.expected_validity,
        },
      },
      라벨: {
        child_intent: 행.got_child_intent ?? '',
        detected_elements: 행.got_elements ?? [],
        utterance_validity: 행.got_validity ?? '',
      },
    })
    판정한_자리.push(자리)
  })

  const 표 = score(쌍들)
  const 채점들 = new Map<number, ItemScore>()
  판정한_자리.forEach((자리, 몇번째) => 채점들.set(자리, 표.항목별[몇번째]))

  const 결과들: ResultView[] = 행들.map((행, 자리) => {
    const 채점 = 채점들.get(자리) ?? null
    return {
      item_id: 행.item_id,
      item_review: 행.item_review,
      판정불가_사유: 행.unjudged_reason,
      got_model: 행.got_model,
      기대: {
        child_intent: 행.expected_child_intent,
        utterance_validity: 행.expected_validity,
        detected_elements: 행.expected_elements,
      },
      라벨:
        행.unjudged_reason !== null
          ? null
          : {
              child_intent: 행.got_child_intent ?? '',
              detected_elements: 행.got_elements ?? [],
              utterance_validity: 행.got_validity ?? '',
              main_point: 행.got_main_point,
            },
      채점,
      판정불가: 채점 === null,
      맞음: isCorrect(채점),
    }
  })

  return {
    run,
    결과들,
    줄들: new Map(결과들.map((행) => [행.item_id, 행])),
    표,
    요약: summarize(결과들, 표),
  }
}

/** 골든셋 화면 하나를 그리는 데 필요한 것 전부 (파이썬 `routes/goldenset._바탕()`). */
export interface GoldensetScreen {
  files: readonly string[]
  file: string
  file_path: string
  items: readonly GoldenItem[]
  /** 검수 전 초안이 몇 건인가. **0 이 아니면 이 점수는 정답지를 잰 것이 아니다.** */
  draft_count: number
  total_count: number
  reviewed_count: number
  /** `?run=` 이 없으면 `null` 이다. 화면이 「안 돌림」과 「판정 불가」를 섞지 않게. */
  result: RunView | null
  /** 최근 판 목록. 새로고침해도 방금 돌린 판으로 돌아갈 수 있어야 한다. */
  recent_runs: readonly GoldensetRunRow[]
}

/** 화면 하나분. `goldenset_run_id` 를 주면 그 판의 결과를 함께 싣는다. */
export async function goldensetScreen(
  { file = null, goldenset_run_id = null }: { file?: string | null; goldenset_run_id?: string | null } = {},
  conn?: Conn,
): Promise<GoldensetScreen> {
  const 경로 = goldensetPath(file)
  const 항목들 = readGoldensetFile(경로)
  const 이름 = path.basename(경로)

  const 연결 = conn ?? getDb()
  const 판들 = await listGoldensetRuns(연결, 20)
  const result = goldenset_run_id === null ? null : await goldensetRunView(goldenset_run_id, 연결)

  return {
    files: goldensetFiles(),
    file: 이름,
    file_path: `goldenset/${이름}`,
    items: 항목들,
    draft_count: 항목들.filter((항목) => 항목.검수 !== '검수완료').length,
    total_count: 항목들.length,
    reviewed_count: reviewedOnly(항목들).length,
    result,
    recent_runs: 판들,
  }
}
