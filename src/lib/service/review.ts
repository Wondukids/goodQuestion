// 사람 검수 — 화면이 쓰는 조립과 판정 저장 (이슈 #26 화면-4).
//
// 파이썬 `goodquestion_admin/routes/review.py` 319줄에서 **규칙에 해당하는 절반**을
// 옮긴 것이다. 화면(`app/(admin)/review/**`)에는 폼을 읽어 이 함수를 부르는 일만 남는다.
//
// ## 🔴 이 화면이 이 레포의 존재 이유에 가장 가깝다
//
// 기획자가 생성된 대사를 **사람 눈으로 보고** 점수와 교정을 남기는 자리다. 그래서
// 여기서 지키는 것은 「어떻게 보이나」가 아니라 **무엇이 기록으로 남나**다.
//
// | 규칙 | 어디서 |
// |---|---|
// | 판정은 지킴(1.0) · 넘음(0.0) · 보류(NULL) 셋뿐이다 | `판정_값` |
// | 넘음에는 **걸린 항목**이 있어야 한다 | `saveHumanScore()` |
// | 보류에는 **못 정한 이유**가 있어야 한다 (FR-045d) | `saveHumanScore()` |
// | 다시 매겨도 앞 판정이 남는다 (FR-047) | `repo/review.insertScore()` — 덧붙이기 |
// | 기준 문장은 전부 「초안」이다 (FR-044d) | `repo/review.insertCriterion()` |
// | 내보내기는 **사람이 확정한 것만** 담는다 (FR-049) | `repo/review.analysisGoldenRows()` |
//
// ## ⛔ 여기서 판정하지 않는다 (`CLAUDE.md` 경계 6)
//
// 모드도 장면 종료도 만지지 않는다. 이 파일이 다루는 것은 **사람이 매긴 점수**뿐이고,
// 엔진이 이 표를 읽는 방향은 없다.
//
// ## ⚠️ 검수 값의 허용 목록은 분석 층에서 가져온다
//
// `lib/engine/analyze.ts` 의 `의도_값`·`사고_요소`·`유효성_값` 이 정본(`prompts/analysis.md`)을
// 옮긴 목록이다 (파이썬은 `goldenset.py` 가 같은 목록을 들고 있었다). **여기서 다시 적지
// 않는다** — 두 벌이 되면 교정 칸이 프롬프트와 조용히 어긋난다.

import { existsSync, statSync } from 'node:fs'
import path from 'node:path'

import { PROJECT_ROOT } from '@/lib/config'
import { ValueError } from '@/lib/domain/progress'
import { elementName, elementNames, 요소 } from '@/lib/elements'
import { 사고_요소, 유효성_값, 의도_값 } from '@/lib/engine/analyze'
import { getDb, type Conn } from '@/lib/repo/db'
import {
  analysisGoldenRows,
  insertCorrection,
  insertCriterion,
  insertScore,
  latestHumanReviewAt,
  pendingScores,
  reviewRecords,
  reviewTurns,
  staleScores,
  utteranceExportRows,
  type PendingScore,
  type ReviewRecord,
  type ReviewTurn,
} from '@/lib/repo/review'
import { readRun, type RunRow } from '@/lib/repo/runs'
import { MessageNotFound } from '@/lib/service/step'

// ═══════════════════════════════════════════════════════════════════════════
// 판정 기준 — 화면이 그대로 그리는 표
// ═══════════════════════════════════════════════════════════════════════════

/** 체크리스트 한 줄. `code` 가 `scores.violated_item` 에 저장되는 값이다. */
export interface ChecklistItem {
  code: string
  label: string
}

/** 분석 검수의 판정 기준 셋 (파이썬 `분석_체크리스트`). */
export const 분석_체크리스트: readonly ChecklistItem[] = [
  { code: 'direct_only', label: '발화에서 직접 확인되는 것만 기록했는가' },
  { code: 'evidence_in_utterance', label: '원문 근거가 실제 발화 안에 있는가' },
  { code: 'no_vague_norm', label: '막연한 당위를 사고 요소로 세지 않았는가' },
]

/** 캐릭터 대사 검수의 판정 기준 셋 (파이썬 `대사_체크리스트`). */
export const 대사_체크리스트: readonly ChecklistItem[] = [
  { code: 'no_answer_first', label: '아이 대신 정답을 먼저 말하지 않았는가' },
  { code: 'no_direct_learning_question', label: '직접적인 학습 질문을 하지 않았는가' },
  { code: 'no_scene_end', label: '장면을 스스로 끝내지 않았는가' },
]

/** 검수 대상 둘. `scores.target` 의 값이다. */
export type ReviewTarget = 'analysis' | 'utterance'

/** 화면에 쓰는 이름 (파이썬 `대상_이름`). */
export const 대상_이름: Readonly<Record<string, string>> = {
  analysis: '분석 검수',
  utterance: '캐릭터 대사 검수',
}

/**
 * 폼 값 → `scores.value` (파이썬 `판정_값`).
 *
 * 🔴 **셋뿐이다.** 「반쯤 맞다」를 못 적게 막은 것이고 `scores_value_check` 가 DB 에서도
 * 같은 것을 막는다. 보류는 `null` 이라 분모에서 빠진다 (FR-045a·b).
 */
export const 판정_값: ReadonlyMap<string, number | null> = new Map([
  ['pass', 1.0],
  ['fail', 0.0],
  ['pending', null],
])

/**
 * 시드 값의 출처 이름 (파이썬 `출처.이름`). **정의는 `service/origin.ts` 한 곳이다.**
 *
 * ⚠️ 검수 화면이 쓰는 것은 `draft`(초안) 하나다 — 기준 문장은 전부 초안으로만 저장되기
 *    때문이다. 나머지 둘은 `review_criteria.origin` 이 `canon` 으로 올라올 때를 위해 있다.
 */
export { 출처_이름 } from './origin'

/** 교정 칸이 고르게 할 것들. 정본 목록을 **정렬만** 해서 준다. */
export const 교정_고를_값 = {
  child_intents: [...의도_값].sort(),
  validities: [...유효성_값].sort(),
  /** `[코드, 화면 이름]`. 파이썬 `[(value, 요소.이름(value)) …]` 자리다. */
  elements: [...사고_요소].sort().map((코드) => [코드, elementName(코드)] as const),
}

const 의도_허용 = new Set<string>(의도_값)
const 유효성_허용 = new Set<string>(유효성_값)
const 요소_허용 = new Set<string>(사고_요소)

/** 항목 코드 → 사람이 읽을 이름. 모르는 코드는 그대로, 없으면 `-` (파이썬 `_판정_항목_이름`). */
export function 판정_항목_이름(target: string, code: string | null): string {
  if (code === null || code === '') return '-'
  const 항목들 = target === 'analysis' ? 분석_체크리스트 : 대사_체크리스트
  return 항목들.find((항목) => 항목.code === code)?.label ?? code
}

// ═══════════════════════════════════════════════════════════════════════════
// 정답지 파일이 낡았나
// ═══════════════════════════════════════════════════════════════════════════

/** 파이썬 `goldenset.기본_파일`. **읽기만 한다** — 화면은 이 파일을 고치지 않는다. */
export const 골든셋_기본_파일 = path.join(PROJECT_ROOT, 'goldenset', 'banggui_검수전.jsonl')

/**
 * 내보낸 정답지가 검수 기록보다 오래됐나 (파이썬 `_파일_오래됨`).
 *
 * 검수 기록이 하나도 없으면 낡을 것도 없다(`false`). 파일이 아예 없으면 낡은 것으로 본다.
 */
export function 골든셋_파일_오래됨(latest_review_at: Date | null): boolean {
  if (latest_review_at === null) return false
  if (!existsSync(골든셋_기본_파일)) return true
  return statSync(골든셋_기본_파일).mtime < latest_review_at
}

// ═══════════════════════════════════════════════════════════════════════════
// 검수 화면 — `GET /runs/{run_id}/review`
// ═══════════════════════════════════════════════════════════════════════════

/** 지금 보고 있는 턴. 요소 코드를 한국어 이름으로 편 칸이 하나 더 붙는다. */
export interface ReviewTurnView extends ReviewTurn {
  /** ⚠️ `detected_elements` 는 `{type, evidence}` 묶음 목록이다. 코드 글자가 아니다. */
  detected_element_names: string[]
}

/** 판정 이력 한 줄. 화면이 쓸 이름 둘이 붙는다. */
export interface ReviewRecordView extends ReviewRecord {
  target_label: string
  violated_item_label: string
}

export interface ReviewView {
  run: RunRow
  turns: ReviewTurn[]
  /** 0 부터. 턴이 없으면 0 이다. */
  index: number
  /** 검수할 발화가 없으면 `null`. */
  turn: ReviewTurnView | null
  /** **이 턴에 붙은** 판정만. 회차 전체가 아니다. */
  records: ReviewRecordView[]
  /** 기준이 바뀌어 다시 볼 판정 수. */
  stale_count: number
  goldenset_stale: boolean
}

/**
 * 검수 화면 한 쪽 (파이썬 `검수_화면()`).
 *
 * `index` 는 **범위 안으로 접는다** — 주소로 아무 숫자나 들어와도 화면이 깨지지 않는다.
 */
export async function reviewView(
  run_id: string,
  index: number,
  conn?: Conn,
): Promise<ReviewView> {
  const 연결 = conn ?? getDb()
  const run = await readRun(연결, run_id)
  const turns = await reviewTurns(연결, { run_id })
  const records = await reviewRecords(연결, { run_id })
  const stale = await staleScores(연결, { run_id })
  const latest_review_at = await latestHumanReviewAt(연결)

  let 자리 = 0
  let turn: ReviewTurnView | null = null
  let turn_records: ReviewRecordView[] = []

  if (turns.length > 0) {
    자리 = Math.min(Math.max(Number.isFinite(index) ? index : 0, 0), turns.length - 1)
    const 보는_턴 = turns[자리]
    // ⚠️ `detected_elements` 는 `{type, evidence}` 묶음이다. `type` 만 넘긴다 —
    //    `elementNames()` 가 같은 코드를 한 번만 남긴다.
    const 요소코드들 = (보는_턴.detected_elements ?? []).map((하나) => 하나.type)
    turn = { ...보는_턴, detected_element_names: elementNames(요소코드들) }
    turn_records = records
      .filter((기록) => 기록.message_id === 보는_턴.message_id)
      .map((기록) => ({
        ...기록,
        target_label: 대상_이름[기록.target] ?? 기록.target,
        violated_item_label: 판정_항목_이름(기록.target, 기록.violated_item),
      }))
  }

  return {
    run,
    turns,
    index: 자리,
    turn,
    records: turn_records,
    stale_count: stale.length,
    goldenset_stale: 골든셋_파일_오래됨(latest_review_at),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 보류 화면 — `GET /review/pending`
// ═══════════════════════════════════════════════════════════════════════════

export interface PendingScoreView extends PendingScore {
  target_label: string
}

export interface PendingView {
  pending: PendingScoreView[]
  goldenset_stale: boolean
}

/**
 * 아직 못 정한 판정을 모아 본다 (파이썬 `보류_화면()`).
 *
 * 🔴 이 화면의 쓸모는 「기준을 정해야 할 자리」를 한곳에 모으는 것이다. 보류가 분모에서
 * 빠지는 대신, 빠진 것이 눈에 보이는 자리가 여기다.
 */
export async function pendingView(conn?: Conn): Promise<PendingView> {
  const 연결 = conn ?? getDb()
  const 목록 = await pendingScores(연결)
  const latest_review_at = await latestHumanReviewAt(연결)
  return {
    pending: 목록.map((보류) => ({
      ...보류,
      target_label: 대상_이름[보류.target] ?? 보류.target,
    })),
    goldenset_stale: 골든셋_파일_오래됨(latest_review_at),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 판정 저장 — `POST /runs/{run_id}/review/{message_id}/{analysis|utterance}`
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 폼에서 온 그대로. **다듬지 않은 문자열**이다 — 검사가 폼을 흉내 내지 않고 그대로 부를 수
 * 있어야 해서, 걸러 내는 규칙을 화면이 아니라 여기에 뒀다 (파이썬은 라우트에 있었다).
 */
export interface ScoreForm {
  /** `pass` · `fail` · `pending`. */
  value: string
  comment?: string | null
  violated_item?: string | null
  /** 분석 교정 4칸. */
  correction_child_intent?: string | null
  correction_main_point?: string | null
  correction_detected_elements?: string | null
  correction_utterance_validity?: string | null
  /** 대사 교정 1칸. */
  correction_text?: string | null
}

/** 저장된 분석 교정. 골든셋 한 줄의 정답이 되는 모양이다. */
export interface AnalysisCorrection {
  child_intent: string
  main_point: string | null
  detected_elements: string[]
  utterance_validity: string
}

function 다듬기(값: string | null | undefined): string {
  return (값 ?? '').trim()
}

/**
 * 「까닭, 입장」처럼 **한국어 이름으로 적어도** 코드로 바꾼다 (파이썬 `_요소_코드들`).
 *
 * 화면이 요소를 한국어로 보여 주므로 사람이 그대로 받아 적는다. 모르는 값은 **그대로
 * 남긴다** — 허용 목록 검사가 그것을 잡아 거절한다. 여기서 조용히 버리지 않는다.
 */
export function 요소_코드들(원문: string): string[] {
  const 이름_코드 = new Map(Object.entries(요소).map(([코드, 표]) => [표.이름, 코드]))
  return 원문
    .split(',')
    .map((값) => 값.trim())
    .filter((값) => 값 !== '')
    .map((값) => 이름_코드.get(값) ?? 값)
}

/** 분석 교정 4칸. 하나도 안 적었으면 `null` (파이썬 `_분석_교정`). */
export function 분석_교정(폼: ScoreForm): AnalysisCorrection | null {
  const raw_elements = 다듬기(폼.correction_detected_elements)
  const raw_intent = 다듬기(폼.correction_child_intent)
  const raw_validity = 다듬기(폼.correction_utterance_validity)
  const raw_main_point = 다듬기(폼.correction_main_point)
  if (raw_elements === '' && raw_intent === '' && raw_validity === '' && raw_main_point === '') {
    return null
  }
  // ⚠️ 한 칸이라도 적었으면 의도·유효성은 **반드시** 허용 목록 안이어야 한다.
  //    반쯤 적힌 교정은 정답지에 실릴 수 없다.
  if (!의도_허용.has(raw_intent)) throw new ValueError('교정 child_intent가 허용 목록 밖이다')
  if (!유효성_허용.has(raw_validity)) {
    throw new ValueError('교정 utterance_validity가 허용 목록 밖이다')
  }
  const elements = 요소_코드들(raw_elements)
  if (elements.some((코드) => !요소_허용.has(코드))) {
    throw new ValueError('교정 detected_elements가 허용 목록 밖이다')
  }
  return {
    child_intent: raw_intent,
    main_point: raw_main_point === '' ? null : raw_main_point,
    // 먼저 나온 것을 남긴다 (파이썬 `dict.fromkeys`).
    detected_elements: [...new Set(elements)],
    utterance_validity: raw_validity,
  }
}

/**
 * 사람이 매긴 판정 한 건을 남긴다 (파이썬 `_판정_저장()`).
 *
 * 🔴 **어디에 붙는지**가 이 함수의 전부다 —
 *    `run_id` · `message_id`(아이 발화) · 대사일 때만 `llm_call_id` · 그 순간의 기준 판.
 *
 * ⚠️ 점수와 교정은 **한 트랜잭션**이다. 교정만 남거나 점수만 남으면 「틀렸다는데 정답이
 *    없는」 줄이 생겨 내보내기가 조용히 그 턴을 버린다.
 */
export async function saveHumanScore(
  {
    run_id,
    message_id,
    target,
    graded_by,
    form,
  }: {
    run_id: string
    message_id: string
    target: ReviewTarget
    graded_by: string
    form: ScoreForm
  },
  conn?: Conn,
): Promise<{ score_id: string }> {
  if (!판정_값.has(form.value)) {
    throw new ValueError('판정은 지킴·넘음·보류 중 하나여야 한다')
  }
  const value = 판정_값.get(form.value) ?? null
  const comment = 다듬기(form.comment) === '' ? null : 다듬기(form.comment)
  let violated_item = 다듬기(form.violated_item) === '' ? null : 다듬기(form.violated_item)

  const 체크리스트 = target === 'analysis' ? 분석_체크리스트 : 대사_체크리스트
  if (value === 0.0) {
    if (violated_item === null) throw new ValueError('넘음 판정에는 걸린 항목이 필요하다')
    if (!체크리스트.some((항목) => 항목.code === violated_item)) {
      throw new ValueError('걸린 항목이 판정 기준 목록 밖이다')
    }
  } else {
    // 지킴·보류에는 걸린 항목이 없다. 폼에 남아 있어도 떨어낸다.
    violated_item = null
  }
  if (value === null && comment === null) {
    // FR-045d — 「왜 못 정했는지」 없는 보류는 기준을 정할 자리를 못 남긴다.
    throw new ValueError('보류에는 아직 못 정한 이유가 필요하다')
  }

  const 연결 = conn ?? getDb()
  const 턴 = (await reviewTurns(연결, { run_id })).find((행) => 행.message_id === message_id)
  if (턴 === undefined) throw new MessageNotFound('이 회차에 해당 턴이 없다')

  // 교정은 저장 **전에** 읽는다 — 목록 밖 값이면 점수도 남기지 않는다.
  const 교정 =
    target === 'analysis'
      ? 분석_교정(form)
      : 다듬기(form.correction_text) === ''
        ? null
        : { text: 다듬기(form.correction_text) }
  // jsonb 칸이라 모양을 스키마로 좁히지 않는다 (`target` 에 따라 다르다).
  const corrected: Record<string, unknown> | null =
    교정 === null ? null : ({ ...교정 } as Record<string, unknown>)

  return 연결.transaction(async (tx) => {
    const score = await insertScore(tx, {
      run_id,
      message_id,
      // ⭐ 대사 판정만 그 대사를 낸 호출에 붙는다. 분석 판정은 `message_id` 하나로 붙는다.
      llm_call_id: target === 'utterance' ? 턴.llm_call_id : null,
      target,
      check_name: 'human_review',
      value,
      comment,
      violated_item,
      graded_by,
      criteria_version: 턴.latest_criteria_version,
    })
    if (corrected !== null) {
      await insertCorrection(tx, { score_id: score.id, target, corrected })
    }
    return { score_id: score.id }
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// 기준 문장 — `POST /scenes/{scene_id}/criteria`
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 이 장면에서 이 요소가 무엇인지 한 줄로 적는다 (파이썬 `기준_쓰기()`).
 *
 * 🔴 판 번호가 오르면 그전 판정이 **「다시 볼 대상」**이 된다 (FR-044e · SC-020).
 *    잣대를 바꿔 놓고 옛 점수를 그대로 쓰면 숫자가 거짓말을 한다.
 */
export async function writeCriterion(
  {
    scene_id,
    element,
    criterion,
    written_by,
  }: { scene_id: string; element: string; criterion: string; written_by: string | null },
  conn?: Conn,
): Promise<{ version: number }> {
  if (!요소_허용.has(element)) throw new ValueError('요소가 허용 목록 밖이다')
  const 문장 = criterion.trim()
  if (문장 === '') throw new ValueError('기준 문장을 써야 한다')

  const 행 = await insertCriterion(conn ?? getDb(), {
    scene_id,
    element,
    criterion: 문장,
    written_by,
  })
  return { version: 행.version }
}

// ═══════════════════════════════════════════════════════════════════════════
// 내보내기 — `GET /export/goldenset` · `GET /export/utterances`
// ═══════════════════════════════════════════════════════════════════════════

/** 골든셋 한 줄 — 파이썬 `goldenset.골든항목` 을 **칸 이름·순서까지 그대로** 옮긴 것이다. */
export interface GoldenItem {
  id: string
  검수: string
  scene_order: number
  장면_이름: string
  previous_character_message: string
  child_utterance: string
  target_elements: string[]
  정답: {
    child_intent: string
    detected_elements: string[]
    utterance_validity: string
    main_point: string | null
  }
  scene_description: string | null
  conflict: string | null
  메모: string
  utterance_source: string | null
  /** 장면별 요소 판정 기준. 관리 기록에서는 안 채운다 (파이썬도 기본값 `{}` 였다). */
  element_criteria: Record<string, string>
}

/**
 * 관리 기록에서 **확정된 분석 검수만** 골든셋 항목으로 (파이썬 `DB_골든셋_불러오기()`).
 *
 * ⭐ 여기서 나온 줄은 곧 분석 프롬프트의 입력이다 — 그래서 칸 이름이
 * `prompts/analysis.md` 의 「받는 것」과 글자 그대로 같다. 옮겨 담다 어긋날 자리를 없앤 것이다.
 */
export async function goldensetItems(conn?: Conn): Promise<GoldenItem[]> {
  const 행들 = await analysisGoldenRows(conn ?? getDb())
  return 행들.map((행) => ({
    id: String(행.message_id),
    검수: '검수완료',
    scene_order: Number(행.scene_order),
    장면_이름: 행.character_name ?? `장면 ${행.scene_order}`,
    previous_character_message: 행.previous_character_message ?? '',
    child_utterance: 행.child_utterance,
    target_elements: 행.target_elements ?? [],
    정답: {
      child_intent: 행.corrected.child_intent,
      detected_elements: 행.corrected.detected_elements ?? [],
      utterance_validity: 행.corrected.utterance_validity,
      main_point: 행.corrected.main_point ?? null,
    },
    scene_description: 행.scene_description,
    conflict: 행.conflict,
    메모: 행.comment ?? '',
    utterance_source: 행.utterance_source,
    element_criteria: {},
  }))
}

/**
 * JSONL 한 덩어리 (파이썬 `_jsonl()`).
 *
 * 첫 줄이 `// exported_at: …` 인 것은 파이썬 그대로다 — `goldenset.읽기()` 가 `//` 로
 * 시작하는 줄을 건너뛰므로, 내보낸 파일을 엔진이 **그대로 다시 읽는다** (SC-021).
 */
export function jsonl(항목들: readonly unknown[], exported_at: Date): string {
  const 줄들 = [`// exported_at: ${exported_at.toISOString()}`]
  for (const 항목 of 항목들) 줄들.push(JSON.stringify(항목))
  return 줄들.join('\n') + '\n'
}

/** 분석 정답지 내보내기. `exported_at` 은 응답 머리에도 실린다. */
export async function exportGoldenset(
  conn?: Conn,
): Promise<{ body: string; exported_at: Date }> {
  const exported_at = new Date()
  const 항목들 = await goldensetItems(conn)
  return { body: jsonl(항목들, exported_at), exported_at }
}

/** 대사 검수 내보내기. 행을 **그대로** 싣는다 (칸 이름 = DB 컬럼 이름). */
export async function exportUtterances(
  conn?: Conn,
): Promise<{ body: string; exported_at: Date }> {
  const exported_at = new Date()
  const 행들 = await utteranceExportRows(conn ?? getDb())
  return { body: jsonl(행들, exported_at), exported_at }
}
