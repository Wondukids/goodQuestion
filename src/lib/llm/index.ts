// LLM 공급자 이중화. **이 파일이 공급자를 아는 유일한 곳이다.**
// 호출부(분석·캐릭터)는 어느 회사 모델이 대답했는지 신경 쓰지 않는다.
//
// 파이썬 `src/goodquestion/llm.py` 526줄을 옮긴 것이다 (이슈 #26 말-3).
//
// ## 체인
//
// 기본: Gemini(키1) → Gemini(키2) → Gemini(키3) → Anthropic
//
// 앤트로픽 칸은 **`ANTHROPIC_API_KEY` 가 있을 때만** 만들어진다. 사람이 2026-08-11 에
// 「앤트로픽은 안 쓴다」고 정했고 키를 안 넣었으므로 지금 실제로 도는 체인은 **제미나이 3단**이다.
//
// 가운데 키2·키3 단계는 제미나이 무료 티어가 시간당 한도를 내기 때문이다 (결정 53).
// 한 턴에 LLM 을 두 번 부르므로 골든셋 43건을 돌리면 중간에 막힌다 — 실측에서 **2턴째**였다.
// 막힌 뒤 남은 건이 전부 「판정 불가」가 되면 그날 측정이 통째로 날아간다.
//
// **어느 키가 막혔는지 기억하지 않는다.** 모든 호출이 언제나 키1 부터 시작한다.
// 대가는 키1 이 막힌 동안 건마다 헛시도 한 번인데(한도 거절은 즉시 돌아온다), 대신 동작이
// 항상 같아 되짚기 쉽고 한도가 풀리면 **저절로** 키1 로 돌아간다.
//
// ## ⛔ `gpt-5-nano` 는 체인이 아니다
//
// 2026-08-12 사람 결정 — **fallback 이 아니라 나란히 견주는 두 번째 줄**이다.
// 되풀이는 무료 `flash-lite` 로 하고, 검사가 다 선 뒤 **한 번만** nano 로 돌려
// 더 싼 모델로도 되는지 본다. **키에 실제로 돈이 나가기 때문이다.**
// 그래서 `line: 'openai'` 를 명시해야만 그 줄이 만들어지고, 실패해도 제미나이로 안 넘어간다 —
// 넘어가면 「nano 로 됐나」를 못 재게 된다.
//
// ## fallback 조건
//
// **API 에러 / 네트워크 실패 / 타임아웃일 때만** 발동한다. JSON 스키마 검증 실패나
// 「응답이 마음에 안 든다」는 이유로 넘기지 않는다. 그래서 이 파일은 **원문 텍스트만**
// 돌려주고 파싱과 검증은 호출부가 한다.

import { geminiKey, loadSettings, type Settings, 제미나이_키_번호들 } from '@/lib/config'

import { waitForRateLimit } from './rate-limit'

export { waitForRateLimit, __testing as __rateLimitTesting } from './rate-limit'

/** 안트로픽은 max_tokens 가 필수다. 대사 1~2문장이 목표라 넉넉히 잡아둔다. */
const ANTHROPIC_MAX_TOKENS = 4096

/**
 * 제미나이가 받는 생각 수준. SDK 의 `ThinkingLevel` 이 이 넷이라 **소문자 그대로**다.
 * 우리 effort 이름과 글자가 같아서 회차에 한 값만 저장하고 양쪽 공급자에 흘린다.
 *
 * ⛔ 모르는 이름이면 **아무것도 안 보낸다** — 멋대로 골라서 비용을 바꾸지 않는다.
 */
export const _생각수준 = ['minimal', 'low', 'medium', 'high'] as const

/** OpenAI 의 `reasoning.effort`. SDK 의 `ReasoningEffort` 를 그대로 옮겼다. `none` 이 유효하다. */
const _추론강도 = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export type ProviderName = 'gemini' | 'anthropic' | 'openai'

/**
 * 시도 한 번의 기록. **성공하든 실패하든 하나가 한 행이다** (결정 33).
 * 넘어간 흔적이 기록에 없으면 「왜 이 턴이 느렸나」를 되짚을 수 없다.
 *
 * ⚠️ 칸 이름을 `llm_calls` **컬럼 이름에 맞췄다.** 파이썬은 여기서 이름이 달라
 * `저장.py` 가 옮겨 담았는데, 그 옮겨 담는 자리가 버그가 사는 곳이다
 * (`docs/설계/코드구조.md` — 변환 층을 만들지 않는다).
 */
export interface Attempt {
  purpose: string
  provider: ProviderName
  model: string
  effort: string | null
  system_text: string
  user_text: string
  response_text: string | null
  input_tokens: number | null
  output_tokens: number | null
  duration_ms: number
  ok: boolean
  error: string | null
}

/**
 * LLM 응답 원문과 「누가 대답했는지」.
 *
 * `provider`·`model` 은 로그에 찍기 위한 것이다. **fallback 이 돌았는지 눈으로 봐야 한다.**
 */
export interface LLMResult {
  text: string
  provider: ProviderName
  model: string
  attempts: readonly Attempt[]
}

/** 체인의 모든 단계가 실패했을 때. */
export class LLMError extends Error {
  readonly attempts: readonly Attempt[]

  constructor(message: string, attempts: readonly Attempt[] = []) {
    super(message)
    this.name = 'LLMError'
    this.attempts = attempts
  }
}

interface ProviderResponse {
  text: string
  input_tokens: number | null
  output_tokens: number | null
  /** 안트로픽은 스키마 지시를 system 에 덧붙이므로 실제로 나간 것을 돌려준다. */
  system: string
}

interface Step {
  provider: ProviderName
  model: string
  effort: string | null
  /** 로그에 찍는 이름. `gemini(key=2)` 처럼 어느 키였는지까지 보인다. */
  label: string
  settings: Settings
  /** 이 칸이 쓸 제미나이 키. 다른 공급자는 `null`. */
  apiKey: string | null
}

// ── 토큰 세기 ──────────────────────────────────────────────────────────────

/** 공급자마다 칸 이름이 달라 **아는 이름을 차례로** 본다. 없으면 `null`(모름)이다. */
function 토큰(usage: unknown, ...이름들: string[]): number | null {
  if (usage === null || typeof usage !== 'object') return null
  const 표 = usage as Record<string, unknown>
  for (const 이름 of 이름들) {
    const 값 = 표[이름]
    if (typeof 값 === 'number' && Number.isFinite(값)) return 값
  }
  return null
}

// ── 제미나이 ───────────────────────────────────────────────────────────────

function 제미나이_생각수준(effort: string | null): string | null {
  if (!effort) return null
  const 값 = effort.trim().toLowerCase()
  return (_생각수준 as readonly string[]).includes(값) ? 값 : null
}

/**
 * `interactions.create()` 에 넘길 본문을 만든다.
 *
 * **따로 뺀 이유** — 2026-08-11 에 생각 수준을 최상위 인자로 보냈다가 라이브 호출이
 * 전부 `TypeError` 로 죽었다. SDK 가 받는 본문 키는 정해져 있고(`generation_config` 안이다),
 * 검사가 클라이언트를 통째로 가짜로 바꾸면 그 거절이 안 보인다.
 * 그래서 **본문 모양만 따로 검사할 수 있게** 함수로 뺐다.
 *
 * ⚠️ JS SDK 도 파이썬과 **같은 snake_case 키**를 받는다(`system_instruction` ·
 *    `generation_config` · `response_format`). 확인하고 옮겼다.
 */
export function geminiRequest(
  settings: Settings,
  system: string,
  user: string,
  json_schema: Record<string, unknown> | null,
): Record<string, unknown> {
  const 요청: Record<string, unknown> = {
    model: settings.gemini_model,
    input: user,
    system_instruction: system,
  }
  const 수준 = 제미나이_생각수준(settings.gemini_effort)
  if (수준 !== null) 요청.generation_config = { thinking_level: 수준 }
  if (json_schema !== null) {
    요청.response_format = {
      type: 'text',
      mime_type: 'application/json',
      schema: json_schema,
    }
  }
  return 요청
}

async function callGemini(
  settings: Settings,
  system: string,
  user: string,
  json_schema: Record<string, unknown> | null,
  apiKey: string | null,
): Promise<ProviderResponse> {
  const { GoogleGenAI } = await import('@google/genai')

  const client = new GoogleGenAI({
    apiKey: apiKey ?? geminiKey(settings, 1) ?? '',
    // ⚠️ timeout 은 밀리초다.
    httpOptions: { timeout: Math.round(settings.llm_timeout_seconds * 1000) },
  })

  const interaction = await client.interactions.create(
    geminiRequest(settings, system, user, json_schema) as never,
  )
  const 응답 = interaction as unknown as Record<string, unknown>
  const usage = 응답.usage_metadata ?? 응답.usage ?? null

  return {
    text: typeof 응답.output_text === 'string' ? 응답.output_text : '',
    input_tokens: 토큰(usage, 'prompt_token_count', 'total_input_tokens'),
    output_tokens: 토큰(
      usage,
      'candidates_token_count',
      'response_token_count',
      'total_output_tokens',
    ),
    system,
  }
}

// ── 앤트로픽 ───────────────────────────────────────────────────────────────

async function callAnthropic(
  settings: Settings,
  system: string,
  user: string,
  json_schema: Record<string, unknown> | null,
): Promise<ProviderResponse> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')

  const client = new Anthropic({
    apiKey: settings.anthropic_api_key ?? '',
    // ⚠️ 파이썬 SDK 는 초, JS SDK 는 **밀리초**다. 옮길 때 갈린 자리다.
    timeout: Math.round(settings.llm_timeout_seconds * 1000),
  })

  // 안트로픽에는 제미나이의 `response_format` 에 해당하는 파라미터가 없어서
  // 시스템 프롬프트로 형식을 지시한다. fallback 경로라 자주 타지 않는다.
  let 실제_system = system
  if (json_schema !== null) {
    실제_system =
      `${system}\n\n` +
      '아래 JSON 스키마에 정확히 맞는 JSON만 출력하라. ' +
      '설명, 인사말, 코드블록 표시(```)를 붙이지 말 것.\n' +
      `${JSON.stringify(json_schema)}`
  }

  const response = await client.messages.create({
    model: settings.anthropic_model,
    max_tokens: ANTHROPIC_MAX_TOKENS,
    system: 실제_system,
    messages: [{ role: 'user', content: user }],
    // Sonnet 5 는 budget_tokens 방식을 받지 않는다. effort 로 추론 강도를 준다.
    output_config: { effort: settings.anthropic_effort },
  } as never)

  // adaptive thinking 이 켜지면 앞쪽에 생각 블록이 올 수 있으므로 **text 블록만** 모은다.
  const 덩이들 = (response as unknown as { content?: unknown[] }).content ?? []
  const text = 덩이들
    .filter((덩이): 덩이 is { type: string; text: string } => {
      return typeof 덩이 === 'object' && 덩이 !== null && (덩이 as { type?: string }).type === 'text'
    })
    .map((덩이) => 덩이.text)
    .join('')

  const usage = (response as unknown as { usage?: unknown }).usage ?? null
  return {
    text,
    input_tokens: 토큰(usage, 'input_tokens'),
    output_tokens: 토큰(usage, 'output_tokens'),
    system: 실제_system,
  }
}

// ── OpenAI (예산 검증 줄) ──────────────────────────────────────────────────

async function callOpenAI(
  settings: Settings,
  system: string,
  user: string,
  json_schema: Record<string, unknown> | null,
): Promise<ProviderResponse> {
  const { default: OpenAI } = await import('openai')

  const client = new OpenAI({
    apiKey: settings.openai_api_key ?? '',
    timeout: Math.round(settings.llm_timeout_seconds * 1000),
  })

  const 요청: Record<string, unknown> = {
    model: settings.openai_model,
    input: user,
    instructions: system,
  }
  const 강도 = settings.openai_effort.trim().toLowerCase()
  // 제미나이와 같은 규칙 — 모르는 이름이면 아무것도 안 보낸다.
  if ((_추론강도 as readonly string[]).includes(강도)) 요청.reasoning = { effort: 강도 }
  if (json_schema !== null) {
    요청.text = {
      format: { type: 'json_schema', name: 'response', schema: json_schema, strict: false },
    }
  }

  const response = await client.responses.create(요청 as never)
  const 응답 = response as unknown as Record<string, unknown>
  const usage = 응답.usage ?? null

  return {
    text: typeof 응답.output_text === 'string' ? 응답.output_text : '',
    input_tokens: 토큰(usage, 'input_tokens', 'prompt_tokens'),
    output_tokens: 토큰(usage, 'output_tokens', 'completion_tokens'),
    system,
  }
}

// ── 체인 ──────────────────────────────────────────────────────────────────

export type Line = 'default' | 'openai'

export interface ChainOptions {
  preferred_gemini_key?: number
  include_anthropic?: boolean
  /** ⛔ `'openai'` 는 예산 검증 줄이다. 체인에 섞이지 않는다. */
  line?: Line
}

/**
 * 이번 호출이 밟을 차례를 만든다. **상태를 안 들고 매번 새로 만든다.**
 *
 * 어느 키가 막혀 있는지 기억하지 않기 때문에 순서는 언제나 같다 (결정 53).
 * 키2·키3 이 설정돼 있지 않으면 **그 칸을 아예 만들지 않는다** — 빈 키로 부른 실패 시도가
 * 기록에 생기면 안 된다.
 *
 * `preferred_gemini_key` 를 주면 **그 키만 맨 앞으로** 오고 나머지는 번호 순서 그대로
 * 뒤에 붙는다(3 을 고르면 `키3 → 키1 → 키2`). 건너뛰지 않는 이유는 같다 —
 * 한도는 시간이 지나면 풀리므로 앞 키도 여전히 쓸 값이 있다.
 *
 * ⚠️ 키1 칸은 값이 비어 있어도 만든다. 「키가 하나도 없다」를 조용히 성공으로 만들지
 *    않으려는 것이고, 그 경우 첫 시도가 실패로 기록에 남는다.
 */
export function buildChain(settings: Settings, options: ChainOptions = {}): readonly Step[] {
  const { preferred_gemini_key = 1, include_anthropic = true, line = 'default' } = options

  if (line === 'openai') {
    // ⛔ 이 줄에는 fallback 이 없다. 제미나이로 넘어가면 「nano 로 됐나」를 못 잰다.
    return [
      {
        provider: 'openai',
        model: settings.openai_model,
        effort: settings.openai_effort,
        label: 'openai',
        settings,
        apiKey: null,
      },
    ]
  }

  if (!(제미나이_키_번호들 as readonly number[]).includes(preferred_gemini_key)) {
    const 고를_수_있는 = 제미나이_키_번호들.join(' · ')
    throw new Error(`preferred_gemini_key 는 ${고를_수_있는} 중 하나여야 한다`)
  }
  if (preferred_gemini_key !== 1 && !geminiKey(settings, preferred_gemini_key)) {
    throw new Error(
      `GQ_GEMINI_API_KEY_${preferred_gemini_key} 가 없어서 키${preferred_gemini_key} 부터 시작할 수 없다`,
    )
  }

  const 번호들 = 제미나이_키_번호들.filter((번호) => 번호 === 1 || geminiKey(settings, 번호))
  const 정렬 = [...번호들].sort((가, 나) => {
    const 가_우선 = 가 === preferred_gemini_key ? 0 : 1
    const 나_우선 = 나 === preferred_gemini_key ? 0 : 1
    return 가_우선 - 나_우선 || 가 - 나
  })

  const 단계들: Step[] = 정렬.map((번호) => ({
    provider: 'gemini' as const,
    model: settings.gemini_model,
    effort: settings.gemini_effort,
    label: `gemini(key=${번호})`,
    settings,
    apiKey: geminiKey(settings, 번호),
  }))

  // ⭐ 키가 없으면 **그 칸을 아예 만들지 않는다** (2026-08-11). 그전에는 빈 키로 부르고
  //    SDK 가 알아보기 어려운 말로 죽었고, 그 헛시도가 `llm_calls` 에 실패 행으로 남았다.
  //    사람이 「앤트로픽은 안 쓴다」고 정했으므로 이 갈래가 기본 동작이 된다.
  if (include_anthropic && settings.anthropic_api_key) {
    단계들.push({
      provider: 'anthropic',
      model: settings.anthropic_model,
      effort: settings.anthropic_effort,
      label: 'anthropic',
      settings,
      apiKey: null,
    })
  }

  return 단계들
}

/** 그 칸에 맞는 호출부를 **부르는 시점에** 고른다. */
function 단계_부르기(
  단계: Step,
  system: string,
  user: string,
  json_schema: Record<string, unknown> | null,
): Promise<ProviderResponse> {
  switch (단계.provider) {
    case 'gemini':
      return callGemini(단계.settings, system, user, json_schema, 단계.apiKey)
    case 'anthropic':
      return callAnthropic(단계.settings, system, user, json_schema)
    case 'openai':
      return callOpenAI(단계.settings, system, user, json_schema)
  }
}

// ── complete ──────────────────────────────────────────────────────────────

export interface CompleteOptions extends ChainOptions {
  json_schema?: Record<string, unknown> | null
  settings?: Settings
  /**
   * 로그에만 쓴다. 한 턴에 분석·캐릭터가 한 번씩 찍히는데 이게 없으면 어느 줄이
   * 어느 호출인지 구별할 수 없다 (결정 20). 공급자 전환에는 영향이 없다.
   */
  purpose?: string
  /** 공급자가 바뀌었을 때 화면에 알릴 자리. 기본은 아무것도 안 한다. */
  notify?: (제목: string, 내용: string) => void
}

/**
 * 처음 성공한 것을 돌려준다. 설정에 없는 키와 앤트로픽 칸은 만들어지지 않는다.
 *
 * `json_schema` 를 주면 JSON 을 요청하지만 **이 함수는 파싱하지 않는다.**
 * 검증 실패로 fallback 하지 않는다는 규칙을 지키려면 검증이 이 바깥에 있어야 한다.
 */
export async function complete(
  system: string,
  user: string,
  options: CompleteOptions = {},
): Promise<LLMResult> {
  const settings = options.settings ?? loadSettings()
  const json_schema = options.json_schema ?? null
  const purpose = options.purpose ?? ''
  const notify = options.notify ?? (() => {})
  const 표시 = purpose ? `용도=${purpose} ` : ''

  const 단계들 = buildChain(settings, options)
  const 시도_기록: Attempt[] = []

  for (let 번호 = 0; 번호 < 단계들.length; 번호 += 1) {
    const 단계 = 단계들[번호]
    const 다음 = 번호 + 1 < 단계들.length ? 단계들[번호 + 1] : null

    // 호출 **직전**에 막는다. 한도에 걸린 뒤 넘어가는 것보다 안 걸리는 게 싸다 —
    // 걸린 호출은 버려지고 그 턴이 통째로 어긋난다.
    // ⚠️ 키를 바꿔도 분당 창은 **하나**다. 같은 계정 한도이기 때문이다.
    await waitForRateLimit(settings.llm_rpm, 표시)
    const 시작 = performance.now()

    let 응답: ProviderResponse
    try {
      응답 = await 단계_부르기(단계, system, user, json_schema)
    } catch (오류) {
      const duration_ms = Math.round(performance.now() - 시작)
      const 실패_사유 = 오류 instanceof Error ? `${오류.name}: ${오류.message}` : String(오류)
      시도_기록.push({
        purpose,
        provider: 단계.provider,
        model: 단계.model,
        effort: 단계.effort,
        system_text: system,
        user_text: user,
        response_text: null,
        input_tokens: null,
        output_tokens: null,
        duration_ms,
        ok: false,
        error: 실패_사유,
      })

      if (다음 === null) {
        throw new LLMError(
          `체인의 모든 단계가 실패했다(${단계들.map((칸) => 칸.label).join(' → ')}). ` +
            `마지막(${단계.label}): ${실패_사유}`,
          시도_기록,
        )
      }

      // 무슨 이유로 넘어갔는지 반드시 보이게 찍는다. **조용한 fallback 은 버그를 숨긴다.**
      // 같은 공급자의 다음 키로 가는 것은 「재시도」, 다른 회사로 가는 것은 「fallback」이다.
      const 건너감 = 다음.provider === 단계.provider ? '재시도' : 'fallback'
      console.log(`[LLM] ${표시}${단계.label} 실패 → ${다음.label} ${건너감} (${실패_사유})`)
      notify('공급자 전환', 실패_사유)
      continue
    }

    const duration_ms = Math.round(performance.now() - 시작)
    시도_기록.push({
      purpose,
      provider: 단계.provider,
      model: 단계.model,
      effort: 단계.effort,
      system_text: 응답.system,
      user_text: user,
      response_text: 응답.text,
      input_tokens: 응답.input_tokens,
      output_tokens: 응답.output_tokens,
      duration_ms,
      ok: true,
      error: null,
    })

    console.log(
      `[LLM] ${표시}provider=${단계.label} model=${단계.model}` +
        (단계.effort ? ` effort=${단계.effort}` : '') +
        (번호 === 0 ? '' : ' (fallback)') +
        ` in=${응답.input_tokens} out=${응답.output_tokens} 초=${(duration_ms / 1000).toFixed(3)}`,
    )

    return { text: 응답.text, provider: 단계.provider, model: 단계.model, attempts: 시도_기록 }
  }

  throw new Error('체인이 비어 있을 수 없다')
}

// ── 예열 ──────────────────────────────────────────────────────────────────

/**
 * 첫 호출에만 붙는 웃돈을 **사람이 기다리기 전에** 미리 치른다. 성공했는지 돌려준다.
 *
 * 2026-08-09 실측 — 똑같은 호출이 **1회차 13510ms, 2회차 3753ms, 3회차 4311ms** 였다.
 * 첫 번에만 10초가 붙는다. 같은 날 함께 잰 것 — 입력을 2581→489 로 줄여도 88ms 밖에
 * 안 줄고, 모델을 바꾸면 오히려 느렸다.
 * ⚠️ 그러니 **지연을 줄이는 길은 이 함수뿐이다.** 프롬프트를 짧게 해도, 모델을 바꿔도 안 준다.
 *
 * ## 규칙 넷
 *
 * - **던지지 않는다.** 빠르게 하려는 장치지 기능이 아니다. 키가 없거나 망이 끊겨 있어도
 *   서버는 떠야 하고, 진짜 실패는 첫 회차가 드러낸다.
 * - **`complete()` 를 쓰지 않는다.** 그걸 쓰면 제미나이가 죽었을 때 앤트로픽 호출이 하나
 *   나간다. 예열하자고 **돈 드는** fallback 을 태울 이유가 없다.
 * - **제미나이 키는 다 훑는다.** 키1 이 이미 막힌 채로 서버를 켜면 예열이 헛수고가 되고
 *   진짜 첫 회차가 「10초 + 키1 실패 + 키2 재시도」를 다 문다. 키2 도 같은 무료 티어라
 *   **돈이 안 든다.** 순서는 `buildChain()` 에서 가져온다 — 키 차례가 두 곳에 갈라지면 어긋난다.
 * - **결과를 버린다.** 어떤 값도 회차에 들어가지 않는다.
 *
 * ⚠️ **이건 키가 유효한지 검사하는 절차가 아니다.** 실패는 나쁜 키일 수도, 잠깐 끊긴 망일
 *    수도 있다. 「예열 실패 = 키가 죽었다」로 읽으면 없는 사실을 지어내는 것이다.
 */
export async function warmUp(settings?: Settings): Promise<boolean> {
  const 설정 = settings ?? loadSettings()
  if (!geminiKey(설정, 1)) {
    console.log('[LLM] 예열 건너뜀 — GQ_GEMINI_API_KEY 가 없다')
    return false
  }

  // 앤트로픽 칸은 뺀다. 여기서 태우면 예열하자고 돈이 나간다.
  const 제미나이_칸 = buildChain(설정).filter((칸) => 칸.provider === 'gemini')

  for (const 칸 of 제미나이_칸) {
    const 시작 = performance.now()
    try {
      await callGemini(칸.settings, 'ping', 'ping', null, 칸.apiKey)
      console.log(`[LLM] 예열 ${칸.label} 성공 초=${((performance.now() - 시작) / 1000).toFixed(3)}`)
      return true
    } catch (오류) {
      const 사유 = 오류 instanceof Error ? `${오류.name}: ${오류.message}` : String(오류)
      console.log(
        `[LLM] 예열 ${칸.label} 실패 초=${((performance.now() - 시작) / 1000).toFixed(3)} (${사유})`,
      )
    }
  }
  return false
}
