// 리포트 프롬프트 둘을 부르고, 응답을 읽고, 원문과 대조해 거른 뒤 `ReportNarrative` 로
// 세운다 (이슈 #37 · 명세 5절·8절 ②③).
//
// `src/llm/engine/analyze.ts` 와 같은 자리다 — 재료는 인자로 받고, 응답은 zod 로 읽고,
// **검증 실패가 fallback 을 일으키지 않는다**(`complete()` 가 끝난 뒤에 검증하므로
// 구조적으로 그렇게 된다).
//
// ## 두 편을 동시에 부른다 (명세 8절)
//
// `report_analysis` 와 `report_guide` 는 **서로를 안 본다.** 순서를 지킬 이유가 없고
// 차례로 부르면 보호자가 기다리는 시간이 두 배가 된다. 지연은 둘 중 느린 쪽이다.
//
// 🔴 **한쪽이 실패해도 다른 쪽은 산다** (결정 R9). 실패한 쪽 칸은 빈 채로 두고, 무엇이
// 왜 실패했는지 `failed` 에 담아 올린다. **둘 다 실패하면 `narrative` 가 `null`** 이고,
// 그것을 `status='metrics_only'` 로 저장하는 것은 부르는 쪽(이슈 #38)이다 (결정 R18).
//
// ## ⛔ 이 파일이 안 하는 것
//
// DB 를 모른다. 저장도, 낱말 누적(`child_words`)도, 지표 집계도 여기 없다.
// 디스크는 프롬프트 파일 둘에만 닿는다(`chooseBody`).
//
// ## ⚠️ `analyze.ts` 와 한 군데 다르다 — `strictObject` 가 아니다
//
// 분석 LLM 은 필드가 하나라도 더 오면 거부한다(경계 1). 리포트는 그렇게 하지 않는다 —
// 곁가지 필드 하나 때문에 보호자 리포트의 문장이 통째로 사라지는 것보다, 아는 칸만
// 받아 쓰는 편이 결정 R16(빈약해도 리포트는 만든다)에 맞다. 모르는 칸은 zod 가 버린다.

import { z } from 'zod'

import { ValueError } from '@/llm/domain/progress'
import { extractJson } from '@/llm/judge'
import { chooseBody } from '@/llm/prompts'
import { complete, type LLMResult } from '@/llm/provider'
import type { Settings } from '@/llm/config'
import type { ReportMetrics, ReportNarrative } from '@/report/types'

import {
  buildReportAnalysisMaterial,
  buildReportGuideMaterial,
  type ChildInfo,
  type ReportMaterialArgs,
} from './material'
import {
  대표발화_거르기,
  낱말_거르기,
  발화_뼈대,
  빈_장부,
  이야기질문_거르기,
  카드_거르기,
  카드_순서,
  type DroppedRecord,
} from './verify'

/**
 * `llm_calls.purpose` 에 그대로 들어갈 글자다.
 *
 * 🔴 **트랙 사이의 계약이다.** 파이썬이 두던 「옮겨 담는 표」를 이 레포는 없앴으므로
 * 엔진이 처음부터 DB 값을 쓴다(`tests/purpose.test.ts` 머리말).
 *
 * ⚠️ 지금 `llm_calls_purpose_check` 는 `('analysis','character','mission_reply',
 * 'mission_summary')` 넷만 받는다(`src/llm/db/schema.ts:666`). **이 둘을 넣으려면 CHECK 를
 * 넓혀야 하고, 그것은 스키마 갈래(이슈 #35)의 몫이다** — 미션(이슈 #18)이 같은 자리에서
 * 같은 방식으로 갔다. 안 넓히면 저장 배선(이슈 #38)에서 INSERT 가 막힌다.
 */
export const 말하기분석_용도 = 'report_analysis'
export const 가정연계_용도 = 'report_guide'

/** 프롬프트 폴더 이름. `chooseBody()` 가 이 이름으로 `보낼것.md` 를 읽는다. */
export const 말하기분석_프롬프트 = 'report_analysis'
export const 가정연계_프롬프트 = 'report_guide'

/**
 * 리포트 서술 응답이 규격에 안 맞는다. ⛔ **fallback 사유가 아니다.**
 *
 * `AnalysisResponseError` 와 같은 갈래다 — 「받은 것이 잘못됐다」라서 `ValueError` 를
 * 그대로 물려받는다.
 */
export class ReportNarrativeError extends ValueError {
  constructor(메시지: string) {
    super(메시지)
    this.name = 'ReportNarrativeError'
  }
}

// ── 응답 규격 ──────────────────────────────────────────────────────────────

const 카드_스키마 = z.object({
  axis: z.enum(카드_순서),
  summary: z.string(),
  quote_message_id: z.string().nullable().default(null),
  did_well: z.string(),
  to_improve: z.string(),
})

/** `report_analysis` 가 내는 것 (명세 5.2). */
export const 말하기분석_응답_스키마 = z.object({
  overall: z.string(),
  cards: z.array(카드_스키마),
  highlight: z
    .object({ quote_message_id: z.string(), why: z.string() })
    .nullable()
    .default(null),
  word_tip: z.string().nullable().default(null),
  words: z.object({
    extracted: z.array(z.string()),
    repeated: z.array(z.string()),
  }),
})

/** `report_guide` 가 내는 것 (명세 5.4). */
export const 가정연계_응답_스키마 = z.object({
  reason: z.string(),
  story_questions: z.array(
    z.object({
      element: z.string(),
      scene_code: z.string(),
      quote_message_id: z.string(),
      question: z.string(),
      fallback: z.string(),
    }),
  ),
  daily_questions: z.array(
    z.object({ label: z.string(), question: z.string(), goal: z.string() }),
  ),
})

export type 말하기분석_응답 = z.infer<typeof 말하기분석_응답_스키마>
export type 가정연계_응답 = z.infer<typeof 가정연계_응답_스키마>

/**
 * LLM 에 그대로 나가는 스키마. 프롬프트에 JSON 모양을 다시 적지 않는 이유가 이것이다 —
 * **모양을 두 곳에 적으면 갈라진다** (`analyze.ts` 의 `분석_스키마` 와 같은 자리).
 */
export const 말하기분석_출력_스키마: Record<string, unknown> = {
  type: 'object',
  properties: {
    overall: { type: 'string' },
    cards: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          axis: { type: 'string', enum: [...카드_순서] },
          summary: { type: 'string' },
          quote_message_id: { type: ['string', 'null'] },
          did_well: { type: 'string' },
          to_improve: { type: 'string' },
        },
        required: ['axis', 'summary', 'quote_message_id', 'did_well', 'to_improve'],
      },
    },
    highlight: {
      type: ['object', 'null'],
      properties: { quote_message_id: { type: 'string' }, why: { type: 'string' } },
      required: ['quote_message_id', 'why'],
    },
    word_tip: { type: ['string', 'null'] },
    words: {
      type: 'object',
      properties: {
        extracted: { type: 'array', items: { type: 'string' } },
        repeated: { type: 'array', items: { type: 'string' } },
      },
      required: ['extracted', 'repeated'],
    },
  },
  required: ['overall', 'cards', 'highlight', 'word_tip', 'words'],
}

export const 가정연계_출력_스키마: Record<string, unknown> = {
  type: 'object',
  properties: {
    reason: { type: 'string' },
    story_questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          element: { type: 'string' },
          scene_code: { type: 'string' },
          quote_message_id: { type: 'string' },
          question: { type: 'string' },
          fallback: { type: 'string' },
        },
        required: ['element', 'scene_code', 'quote_message_id', 'question', 'fallback'],
      },
    },
    daily_questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          question: { type: 'string' },
          goal: { type: 'string' },
        },
        required: ['label', 'question', 'goal'],
      },
    },
  },
  required: ['reason', 'story_questions', 'daily_questions'],
}

// ── 읽기 ───────────────────────────────────────────────────────────────────

/**
 * 응답 글자에서 JSON 을 꺼내 규격을 잰다.
 *
 * 코드 울타리를 걷어 내고 중괄호 안을 꺼내는 일은 `extractJson()`(`src/llm/judge.ts`)이
 * 이미 한다 — 같은 일을 하는 자리를 둘로 만들지 않는다.
 */
function 읽기<T>(무엇: string, 본문: string, 스키마: z.ZodType<T>): T {
  const 값 = extractJson(본문)
  if (값 === null) {
    throw new ReportNarrativeError(
      `${무엇} 응답이 JSON 이 아니다\n받은 것: ${본문.slice(0, 200)}`,
    )
  }
  const 읽은것 = 스키마.safeParse(값)
  if (!읽은것.success) {
    throw new ReportNarrativeError(
      `${무엇} 출력이 규격에 안 맞는다:\n${z.prettifyError(읽은것.error)}`,
    )
  }
  return 읽은것.data
}

export function parseAnalysisResponse(본문: string): 말하기분석_응답 {
  return 읽기('report_analysis', 본문, 말하기분석_응답_스키마)
}

export function parseGuideResponse(본문: string): 가정연계_응답 {
  return 읽기('report_guide', 본문, 가정연계_응답_스키마)
}

// ── 부르기 ─────────────────────────────────────────────────────────────────

/**
 * LLM 을 부르는 함수. 기본은 `complete()` 다.
 *
 * 검사가 바꿔치기해서 네트워크 없이 **대조 규칙만** 볼 수 있게 둔다 —
 * `JudgeCall`(`src/llm/judge.ts`)과 같은 자리이고, 리포트는 한 번에 둘을 부르므로
 * 가짜 SDK 하나로는 어느 쪽 대답인지 가르기 어렵다.
 */
export type ReportCall = (
  system: string,
  user: string,
  options: {
    json_schema: Record<string, unknown>
    settings?: Settings
    purpose: string
    notify?: (제목: string, 내용: string) => void
  },
) => Promise<LLMResult>

export interface ReportCallOptions {
  /** 주면 그 본문을 system 으로 보낸다. **안 주면 `보낼것.md` 를 읽는다** (`chooseBody`). */
  prompt?: string | null
  settings?: Settings
  notify?: (제목: string, 내용: string) => void
  call?: ReportCall
}

/** 한 편을 부르고 읽은 결과. 원문 응답이 함께 온다 — 어느 공급자가 답했는지 찍어야 한다. */
export interface ReportHalf<T> {
  payload: T
  llm: LLMResult
}

export async function reportAnalysis(
  재료: string,
  options: ReportCallOptions = {},
): Promise<ReportHalf<말하기분석_응답>> {
  const 본문 = chooseBody(말하기분석_프롬프트, options.prompt)
  const 호출 = options.call ?? complete
  const 응답 = await 호출(본문, 재료, {
    json_schema: 말하기분석_출력_스키마,
    settings: options.settings,
    purpose: 말하기분석_용도,
    notify: options.notify,
  })
  return { payload: parseAnalysisResponse(응답.text), llm: 응답 }
}

export async function reportGuide(
  재료: string,
  options: ReportCallOptions = {},
): Promise<ReportHalf<가정연계_응답>> {
  const 본문 = chooseBody(가정연계_프롬프트, options.prompt)
  const 호출 = options.call ?? complete
  const 응답 = await 호출(본문, 재료, {
    json_schema: 가정연계_출력_스키마,
    settings: options.settings,
    purpose: 가정연계_용도,
    notify: options.notify,
  })
  return { payload: parseGuideResponse(응답.text), llm: 응답 }
}

// ── 거르기 ─────────────────────────────────────────────────────────────────

/** 말하기 분석 탭이 채우는 네 칸 (`ReportNarrative` 의 앞쪽). */
export type 말하기분석_몫 = Pick<ReportNarrative, 'overall' | 'cards' | 'highlight' | 'word_tip'>

/** 가정 연계 탭이 채우는 세 칸 (`ReportNarrative` 의 뒤쪽). */
export type 가정연계_몫 = Pick<
  ReportNarrative,
  'reason' | 'story_questions' | 'daily_questions'
>

/**
 * 규칙이 다시 세는 낱말 목록 (명세 4.3 ①). **`ReportNarrative` 에 없는 값**이다 —
 * 화면에 뜨는 것이 아니라 지표 쪽으로 넘어가 `child_words` 와 대조된다.
 */
export interface ExtractedWords {
  extracted: string[]
  repeated: string[]
}

const 빈_말하기분석: 말하기분석_몫 = {
  overall: '',
  cards: [],
  highlight: null,
  word_tip: null,
}

const 빈_가정연계: 가정연계_몫 = {
  reason: '',
  story_questions: [],
  daily_questions: [],
}

/** 응답 하나를 원문과 대조해 거른다 (명세 5.2·5.3). 순수 함수다. */
export function 걸러낸_말하기분석(
  payload: 말하기분석_응답,
  metrics: ReportMetrics,
  장부: DroppedRecord,
): { part: 말하기분석_몫; words: ExtractedWords } {
  const quotes = metrics.quotes
  const 뼈대 = 발화_뼈대(quotes)

  const 낱말 = 낱말_거르기(payload.words.extracted, 뼈대)
  const 표현 = 낱말_거르기(payload.words.repeated, 뼈대)
  장부.words.push(...낱말.dropped)
  장부.phrases.push(...표현.dropped)

  return {
    part: {
      overall: payload.overall,
      cards: 카드_거르기(payload.cards, quotes, 장부),
      highlight: 대표발화_거르기(payload.highlight, quotes, 장부),
      word_tip: payload.word_tip,
    },
    words: { extracted: 낱말.kept, repeated: 표현.kept },
  }
}

/** 응답 하나를 원문과 대조해 거른다 (명세 5.4). 순수 함수다. */
export function 걸러낸_가정연계(
  payload: 가정연계_응답,
  metrics: ReportMetrics,
  장부: DroppedRecord,
): 가정연계_몫 {
  return {
    reason: payload.reason,
    story_questions: 이야기질문_거르기(payload.story_questions, metrics.quotes, 장부),
    // 일상 질문은 인용을 안 물므로 대조할 것이 없다. 3개 고정만 지킨다 (명세 5.4).
    daily_questions: payload.daily_questions.slice(0, 3).map((질문) => ({ ...질문 })),
  }
}

// ── 한 번에 ────────────────────────────────────────────────────────────────

export interface GenerateNarrativeArgs extends ReportMaterialArgs {
  settings?: Settings
  notify?: (제목: string, 내용: string) => void
  /** 편마다 본문을 따로 줄 때. 안 주면 파일을 읽는다. */
  prompts?: Partial<Record<'report_analysis' | 'report_guide', string>>
  call?: ReportCall
}

export interface ReportNarrativeResult {
  /**
   * 화면이 받을 서술. **한쪽만 실패했으면 그쪽 칸이 빈 채로 온다** — 결정 R16 대로
   * 화면이 「이번엔 모인 말이 적어요」로 메운다.
   *
   * 🔴 **둘 다 실패했을 때만 `null`** 이다. 그것을 `status='metrics_only'` 로 저장하는 것은
   * 부르는 쪽(이슈 #38)이다 (결정 R18).
   */
  narrative: ReportNarrative | null
  /** 규칙이 `child_words` 와 대조할 낱말 목록. 말하기 분석이 실패하면 `null` */
  words: ExtractedWords | null
  /** 편마다의 실패 사유. 성공했으면 `null` */
  failed: { report_analysis: string | null; report_guide: string | null }
  /** 대조에서 버린 것들 — 로그로 남기라고 올린다 */
  dropped: DroppedRecord
  /** 어느 공급자가 답했나. 안 불렸거나 실패했으면 `null` */
  llm: { report_analysis: LLMResult | null; report_guide: LLMResult | null }
}

function 사유(오류: unknown): string {
  return 오류 instanceof Error ? `${오류.name}: ${오류.message}` : String(오류)
}

/**
 * 리포트의 문장 전부를 만든다 (명세 8절 ②③).
 *
 * 재료를 만들고 → **두 편을 동시에 부르고** → 각각 원문과 대조해 거른 뒤 → 한 덩이로 세운다.
 * 저장은 하지 않는다.
 *
 * ⚠️ `Promise.all` 이 아니라 하나씩 `catch` 한다. `all` 은 먼저 터진 쪽 때문에 성한 쪽까지
 *    버리는데, 그러면 「한쪽이 깨져도 그 탭만 다시 만든다」(결정 R9)가 성립하지 않는다.
 */
export async function generateNarrative(
  args: GenerateNarrativeArgs,
): Promise<ReportNarrativeResult> {
  const { metrics, child, settings, notify, prompts, call } = args
  const 공통 = { settings, notify, call }

  const 분석_몫 = reportAnalysis(buildReportAnalysisMaterial({ metrics, child }), {
    ...공통,
    prompt: prompts?.report_analysis ?? null,
  }).then(
    (것) => ({ ok: true as const, 것 }),
    (오류: unknown) => ({ ok: false as const, 사유: 사유(오류) }),
  )

  const 안내_몫 = reportGuide(buildReportGuideMaterial({ metrics, child }), {
    ...공통,
    prompt: prompts?.report_guide ?? null,
  }).then(
    (것) => ({ ok: true as const, 것 }),
    (오류: unknown) => ({ ok: false as const, 사유: 사유(오류) }),
  )

  const [분석, 안내] = await Promise.all([분석_몫, 안내_몫])

  const 장부 = 빈_장부()
  let 말하기: 말하기분석_몫 = 빈_말하기분석
  let 낱말: ExtractedWords | null = null
  if (분석.ok) {
    const 걸러낸 = 걸러낸_말하기분석(분석.것.payload, metrics, 장부)
    말하기 = 걸러낸.part
    낱말 = 걸러낸.words
  }

  let 가정: 가정연계_몫 = 빈_가정연계
  if (안내.ok) {
    가정 = 걸러낸_가정연계(안내.것.payload, metrics, 장부)
  }

  return {
    narrative: 분석.ok || 안내.ok ? { ...말하기, ...가정 } : null,
    words: 낱말,
    failed: {
      report_analysis: 분석.ok ? null : 분석.사유,
      report_guide: 안내.ok ? null : 안내.사유,
    },
    dropped: 장부,
    llm: {
      report_analysis: 분석.ok ? 분석.것.llm : null,
      report_guide: 안내.ok ? 안내.것.llm : null,
    },
  }
}

export type { ChildInfo, DroppedRecord }
