// 분석 LLM 층 — 재료를 보내고, 응답을 읽고, 후처리한다 (이슈 #26 말-5).
//
// 파이썬 `src/goodquestion/analyze.py` 를 옮긴 것이다.
//
// ⛔ `CLAUDE.md` 경계 1 — 분석 LLM 은 `child_intent` · `main_point` · `detected_elements` ·
//    `utterance_validity` **넷만** 낸다. 여기에 `response_mode`·`scene_goal_met`·
//    `scene_end_reason` 같은 필드가 섞이면 **거부한다.** 조용히 무시하면 경계를 넘은 걸
//    아무도 모른다. 이 레포는 그걸 보려고 있다. (zod `strictObject` 가 그 경계를 코드로 지킨다.)
//
// ## 검증이 `llm/` 밖에 있는 이유
//
// `CLAUDE.md` LLM 절 — fallback 은 **API 에러 / 네트워크 실패 / 타임아웃일 때만** 발동한다.
// "스키마 검증 실패나 응답 품질이 마음에 안 든다는 이유로 넘기지 않는다."
// 그래서 `llm.complete()` 는 원문만 돌려주고 검증은 여기서 한다.
// 여기서 예외가 나면 이미 `complete()` 가 끝난 뒤라 fallback 이 돌 수 없다 (B-2).
//
// ## 후처리 (`docs/기준/대화작동규칙.md:108`, 결정 26)
//
// - `evidence` 가 아이 발화 원문에 없으면 그 요소를 버린다 — **공백만 지우고** 부분 문자열로 본다
// - `type` 중복 제거 — 먼저 나온 것을 남긴다
// - "약한 당위만 있는 SOLUTION 제외"는 **여기서 하지 않는다.** 프롬프트가 조인다.
//   결정 16 은 "기준이 없다"를 이유로 미구현이었는데 **2026-08-07 인터뷰 Q23 이 기준을 줬다** —
//   「무엇을 하는지(행동)가 들어 있어야 구체적이다」. 그 기준은 `prompts/analysis.md` 의
//   `SOLUTION` 행에 넣었고, **후처리 규칙으로는 붙이지 않았다.**
//   「행동이 있는가」는 한국어 발화를 읽어야 아는 것이라 순수 함수가 판정할 자리가 아니다.
//   📄 정본은 이걸 후처리 5번으로 요구한다(`발화분석:255`, "필요에 따라 보정합니다").
//   붙일지 말지는 **골든셋 채점 숫자를 보고 정한다.**
//
// 저장은 **후처리 전 원본**으로 한다(결정 26). 후처리 후를 저장하면 프롬프트를 고쳐도
// 차이가 후처리에 먹혀 안 보인다 — `analysis_version` 을 둔 이유가 그것이다(결정 3).

import { z } from 'zod'

import { ValueError } from '@/llm/domain/progress'
import { complete, type LLMResult } from '@/llm/provider'
import { chooseBody } from '@/llm/prompts'
import type { Settings } from '@/llm/config'

/** `docs/기준/대화작동규칙.md:311` · `sql/001_schema.sql:232` 의 CHECK 와 같은 목록이다. */
export const 유효성_값 = ['VALID', 'SHORT', 'UNCLEAR', 'OFF_TOPIC', 'PLAYFUL'] as const

/**
 * 사고 요소 8개 (`docs/기준/대화작동규칙.md:315`).
 *
 * 스키마(DB)에는 CHECK 를 걸지 않았지만 **LLM 에 보내는 스키마에는 적어 준다** —
 * 프롬프트의 표와 같은 내용이다.
 */
export const 사고_요소 = [
  'DECISION',
  'REASON',
  'PERSPECTIVE',
  'SOLUTION',
  'RESULT',
  'EMOTION',
  'EMPATHY',
  'REQUEST',
] as const

/**
 * `child_intent` 13개 (`docs/기준/대화작동규칙.md:313`).
 *
 * ⚠️ 값 목록은 문서의 13개를 쓰되 **닫지 않는다** (`스펙확정_연동기준.md` E).
 *    데모 중에 저장이 실패하면 대화가 멈춘다. 목록 밖 값이 오면 그대로 저장하고 로그에 남긴다.
 *    그래서 아래 zod 스키마의 `child_intent` 는 `enum` 이 아니라 `string` 이다 —
 *    **LLM 에 보내는 JSON 스키마에만** 13개를 적어 준다.
 */
export const 의도_값 = [
  'QUESTION',
  'OPINION',
  'REASONING',
  'SOLUTION',
  'DECISION',
  'PERSPECTIVE',
  'EMOTION',
  'REQUEST',
  'CHALLENGE',
  'PLAYFUL',
  'OFF_TOPIC',
  'SHORT_RESPONSE',
  'UNCLEAR',
] as const

const 코드펜스 = /^\s*```[a-zA-Z]*\s*|\s*```\s*$/g
const 공백 = /\s+/g

/**
 * 분석 LLM 응답이 규격에 안 맞는다. ⛔ **fallback 사유가 아니다.**
 *
 * 파이썬 `분석_응답_오류(ValueError)` 자리다 — 「부르는 쪽/받은 것이 잘못됐다」는 갈래라
 * `ValueError` 를 그대로 물려받는다 (`lib/domain/progress.ts` 머리말).
 */
export class AnalysisResponseError extends ValueError {
  constructor(메시지: string) {
    super(메시지)
    this.name = 'AnalysisResponseError'
  }
}

/**
 * 이번 발화에서 확인된 생각 조각 하나.
 *
 * `sql/001_schema.sql:229` — `[{ "type": "REASON", "evidence": "억울하니까" }, ...]`
 */
export const DetectedElementSchema = z.strictObject({
  type: z.string(),
  evidence: z.string().nullable().default(null),
})

/**
 * 분석 LLM 출력 4개. **이 넷뿐이다** (`CLAUDE.md` 경계 1).
 *
 * ⛔ `strictObject` 가 그 경계를 코드로 지킨다. 필드가 하나라도 더 오면 예외다.
 *    파이썬 `ConfigDict(extra="forbid")` 자리다. **여기에 칸을 더하지 마라.**
 */
export const AnalysisPayloadSchema = z.strictObject({
  child_intent: z.string(),
  main_point: z.string().nullable().default(null),
  detected_elements: z.array(DetectedElementSchema),
  utterance_validity: z.enum(유효성_값),
})

export type DetectedElement = z.infer<typeof DetectedElementSchema>
export type AnalysisPayload = z.infer<typeof AnalysisPayloadSchema>

/**
 * LLM 에 그대로 나가는 스키마. ⛔ **여기에 필드를 더하면 경계 1 위반이다.**
 */
export const 분석_스키마: Record<string, unknown> = {
  type: 'object',
  properties: {
    child_intent: { type: 'string', enum: [...의도_값] },
    main_point: { type: ['string', 'null'] },
    detected_elements: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: [...사고_요소] },
          evidence: { type: 'string' },
        },
        required: ['type', 'evidence'],
      },
    },
    utterance_validity: { type: 'string', enum: [...유효성_값] },
  },
  required: ['child_intent', 'main_point', 'detected_elements', 'utterance_validity'],
}

/**
 * LLM 이 낸 문자열을 읽어 검증한다 (파이썬 `응답_읽기()`).
 *
 * ⛔ 이 함수는 `llm` 을 부르지 않는다 — 검증 실패가 fallback 을 일으키면 안 되기 때문이다.
 */
export function parseResponse(본문: string): AnalysisPayload {
  코드펜스.lastIndex = 0
  const 벗긴것 = 본문.trim().replace(코드펜스, '')

  let 원시: unknown
  try {
    원시 = JSON.parse(벗긴것)
  } catch (오류) {
    const 사유 = 오류 instanceof Error ? 오류.message : String(오류)
    throw new AnalysisResponseError(`JSON 이 아니다: ${사유}\n받은 것: ${본문.slice(0, 200)}`)
  }

  const 읽은것 = AnalysisPayloadSchema.safeParse(원시)
  if (!읽은것.success) {
    throw new AnalysisResponseError(
      `분석 출력이 규격에 안 맞는다:\n${z.prettifyError(읽은것.error)}`,
    )
  }
  return 읽은것.data
}

/**
 * 공백을 모두 지운다 (결정 26).
 *
 * 아이 발화는 STT 결과다(`docs/기준/대화작동규칙.md:57`). 띄어쓰기가 흔들리는데
 * 그 흔들림으로 요소를 버리면 재는 대상이 바뀐다.
 */
export function 공백뺀(글: string): string {
  return 글.replace(공백, '')
}

/** 후처리 결과 — 살린 `type` 들과 버린 `type` 들. */
export interface PostProcessed {
  kept: readonly string[]
  dropped: readonly string[]
}

/**
 * `evidence` 대조로 요소를 거른다 (파이썬 `후처리()`). 입력은 건드리지 않는다.
 *
 * `docs/기준/대화작동규칙.md:108` + 결정 26.
 */
export function postProcess(
  요소들: readonly DetectedElement[],
  아이_발화: string,
): PostProcessed {
  const 원문 = 공백뺀(아이_발화)

  const 살린: string[] = []
  const 버린: string[] = []

  for (const 요소 of 요소들) {
    // type 중복 제거 — 먼저 나온 판정을 남긴다
    if (살린.includes(요소.type) || 버린.includes(요소.type)) continue

    const 근거 = 공백뺀(요소.evidence ?? '')
    if (근거 !== '' && 원문.includes(근거)) {
      살린.push(요소.type)
    } else {
      // 근거가 없거나 아이 말에 없는 글자다. 살릴 근거가 없다.
      버린.push(요소.type)
    }
  }

  return { kept: 살린, dropped: 버린 }
}

export interface AnalyzeOptions {
  /** 주면 그 본문을 system 으로 보낸다. **안 주면 `prompts/analysis.md` 를 읽는다.** */
  prompt?: string | null
  settings?: Settings
  notify?: (제목: string, 내용: string) => void
}

/** 분석 한 번의 결과. 원문 응답(`llm`)이 함께 온다 — 어느 공급자가 답했는지 찍어야 한다. */
export interface AnalyzeResult {
  analysis: AnalysisPayload
  llm: LLMResult
}

/**
 * 분석 LLM 을 부르고 검증까지 마친다 (파이썬 `분석하기()`).
 *
 * `재료` 는 `buildAnalysisMaterial()` 이 만든 user 본문이다. 이 함수는 **재료를 만들지 않는다** —
 * 관리자 화면이 재료만 따로 들여다보고 그 단계부터 다시 돌릴 수 있어야 하기 때문이다.
 *
 * 준 본문이 어디서 왔는지 이 함수는 알지 못한다 (결정 41·42 와 같은 주입).
 */
export async function analyze(재료: string, options: AnalyzeOptions = {}): Promise<AnalyzeResult> {
  const 본문 = chooseBody('analysis', options.prompt)
  const 응답 = await complete(본문, 재료, {
    json_schema: 분석_스키마,
    settings: options.settings,
    // ⚠️ `llm_calls.purpose` 에 그대로 들어간다. 파이썬은 여기서 「분석」이라 부르고
    //    `저장.py:242` 가 `{"분석": "analysis"}` 로 옮겨 담았는데, **그 옮겨 담는 표를 없앴다.**
    //    부르는 쪽이 처음부터 DB 값을 쓴다 — 아니면 `llm_calls_purpose_check` 가 거절한다.
    purpose: 'analysis',
    notify: options.notify,
  })
  return { analysis: parseResponse(응답.text), llm: 응답 }
}
