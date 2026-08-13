// 설정 로딩. 실제 키는 `.env.local` 에만 있고 여기에는 기본값과 읽는 방법만 둔다.
//
// 파이썬 `src/goodquestion/config.py` 를 옮긴 것이다 (이슈 #26 말-1).
//
// 🔴 **설정을 직접 만드는 경로를 남기지 않는다.** 이게 이 파일의 가장 중요한 규칙이다.
//    파이썬은 `Settings(...)` 를 검사가 **직접 만들 수 있었고**, 그러면 dataclass 기본값이
//    그대로 먹어서 `GQ_LLM_RPM` 이 안 닿았다. 그 탓에 F-2(분당 문지기)를 환경변수로 못 껐고
//    검사 일곱이 244초 중 228초를 잠으로 태웠다.
//    → 그래서 `Settings` 를 만드는 길은 **`loadSettings()` 하나뿐**이다. 부분값이 필요하면
//      `loadSettings({ llm_rpm: 0 })` 처럼 넘긴다. 그러면 나머지 칸은 **언제나** 환경에서 온다.
//
// ⚠️ 칸 이름은 파이썬과 같은 snake_case 다. DB 컬럼은 아니지만 1:1 로 대조하려면
//    이름이 같아야 한다 (`docs/설계/코드구조.md` 3절의 취지).

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { config as loadDotenv } from 'dotenv'
import { parse as parseToml, TomlError } from 'smol-toml'

/**
 * 이 파일이 있는 폴더 — 인 줄 알았던 값.
 *
 * 🔴 **Next(turbopack) 안에서는 `undefined` 다.** 코드를 `.next/` 아래로 옮겨 담으면서
 * `import.meta.dirname` 이 사라지고, 그러면 `path.resolve(undefined, …)` 가
 * **모듈 로딩 중에** 터진다 — 이 파일을 거치는 **라우트 전부가 500** 이 된다.
 * `lib/prompts/render.ts` 머리말이 경고한 바로 그 자리인데, 거기서 막기 전에
 * 여기서 먼저 죽는다 (2026-08-13 `next dev` 로 실제로 봤다).
 *
 * 그래서 없으면 `process.cwd()` 로 내려앉는다 — Next 문서가 권하는 쪽이고
 * (`02-pages/04-api-reference/03-functions/get-static-props.md:160-168`)
 * `next dev`·`next start` 는 `web/` 에서 돈다. vitest·tsx 에서는 예전과 똑같다.
 */
const 이_파일_폴더 = import.meta.dirname as string | undefined
const 기준 = 이_파일_폴더 ?? path.join(process.cwd(), 'lib')

/** 레포 루트. 이 파일은 `<루트>/web/lib/config.ts` 다. */
export const PROJECT_ROOT = path.resolve(기준, '..', '..')
export const WEB_ROOT = path.resolve(기준, '..')

// 제미나이 키를 여기 적힌 **순서대로** 쓴다. 한도에 걸리면 다음 키로 넘어간다.
// 키를 늘리려면 이 배열에 이름만 더한다 (`.env.local` 에도 같은 이름으로 넣는다).
//
// 🔴 **`GQ_` 접두사가 붙어 있다 — 뗄 수 없다** (결정 72 · 2026-08-13 사람 결정).
//    팀 repo `api_team` 의 `.env.example` 에 `GEMINI_API_KEY` 가 **이미 있고 그건 저쪽 TTS**
//    (Gemini 2.5 Flash) 용이다. 이름이 같으면 한 배포에서 키 하나가 저쪽 TTS 와 우리
//    분석·캐릭터 LLM 을 동시에 먹여 **할당량과 청구가 섞인다** — 우리 분당 문지기
//    (`GQ_LLM_RPM` · `lib/llm/rate-limit.ts`)는 저쪽 TTS 호출을 세지 못하고,
//    저쪽이 TTS 때문에 유료 등급으로 올리면 우리 「무료 flash-lite」 전제가 소리 없이 바뀐다.
//    이름을 갈라 두어도 **같은 키를 쓰고 싶으면 값을 같게 적으면 되므로** 나눠 쓰는 선택지를
//    잃지 않는다.
//    ⚠️ 아카이빙될 파이썬 판(`src/goodquestion/config.py:51`)은 접두사 없는 **옛 이름 그대로**다.
//       두 판을 나란히 돌려 견줄 때는 `.env.local` 에 두 이름이 다 있어야 한다.
//    이름을 세우는 검사는 `web/tests/config.test.ts`.
const GEMINI_키_이름들 = [
  'GQ_GEMINI_API_KEY',
  'GQ_GEMINI_API_KEY_2',
  'GQ_GEMINI_API_KEY_3',
] as const

/** 쓸 수 있는 제미나이 키 번호. 체인 순서와 검사가 다 이걸 본다. */
export const 제미나이_키_번호들 = [1, 2, 3] as const

let dotenv를_읽었나 = false

/**
 * `.env.local` 을 `process.env` 에 채운다.
 *
 * 이미 셸에 있는 값이 이긴다(덮어쓰지 않는다). 파일이 없어도 조용히 넘어간다 —
 * CI 처럼 환경변수만 있는 경우가 있다.
 *
 * ⚠️ Next.js 는 `web/.env.local` 을 알아서 읽지만 vitest·tsx 는 안 읽는다.
 *    그래서 여기서 한 번 더 읽는다. `override: false` 라 두 번 읽어도 값이 안 흔들린다.
 */
export function loadEnvFile(): void {
  if (dotenv를_읽었나) return
  dotenv를_읽었나 = true

  // web/.env.local 이 먼저다. 레포 루트 쪽은 파이썬 판이 쓰던 자리라 뒤에 본다.
  for (const 후보 of [path.join(WEB_ROOT, '.env.local'), path.join(PROJECT_ROOT, '.env.local')]) {
    if (existsSync(후보)) loadDotenv({ path: 후보, override: false, quiet: true })
  }
}

export interface Settings {
  /** 있는 것만 적힌 순서대로. 빈칸과 공백뿐인 값은 없는 것으로 친다. */
  gemini_api_keys: readonly string[]
  anthropic_api_key: string | null
  openai_api_key: string | null

  gemini_model: string
  anthropic_model: string
  openai_model: string

  /** 추론 강도는 **세 공급자에 다 간다** — 제미나이는 `thinking_level`, 나머지는 `effort`. */
  gemini_effort: string
  anthropic_effort: string
  openai_effort: string

  llm_timeout_seconds: number
  /** 분당 호출 상한. 0 이하면 안 막는다. AI Studio 의 flash-lite RPM 이 15 라 기본이 12 다. */
  llm_rpm: number

  database_url: string | null
}

function 글자(이름: string, 기본값: string): string {
  const 값 = (process.env[이름] ?? '').trim()
  return 값 === '' ? 기본값 : 값
}

function 있으면(이름: string): string | null {
  const 값 = (process.env[이름] ?? '').trim()
  return 값 === '' ? null : 값
}

function 숫자(이름: string, 기본값: number): number {
  const 값 = Number((process.env[이름] ?? '').trim())
  return Number.isFinite(값) ? 값 : 기본값
}

/**
 * `.env.local` 을 읽어 `Settings` 를 만든다. **이것이 유일한 길이다.**
 *
 * `overrides` 는 검사와 회차 설정이 쓴다. 준 칸만 갈리고 **나머지는 언제나 환경에서 온다** —
 * 파이썬이 여기서 미끄러졌다(위 머리말).
 */
export function loadSettings(overrides: Partial<Settings> = {}): Settings {
  loadEnvFile()

  const 키들 = GEMINI_키_이름들.map((이름) => (process.env[이름] ?? '').trim()).filter(
    (값) => 값 !== '',
  )

  return {
    gemini_api_keys: 키들,
    anthropic_api_key: 있으면('ANTHROPIC_API_KEY'),
    openai_api_key: 있으면('OPENAI_API_KEY'),

    // 🔴 flash 가 아니라 flash-lite 다 (결정 55 · 2026-08-12 사람이 다시 못박았다).
    //    flash 는 하루 20호출이라 세션 하나(약 32호출)도 못 끝내고,
    //    골든셋을 flash-lite 로 재 왔으므로 **재는 모델과 돌리는 모델이 같아진다.**
    gemini_model: 글자('GQ_GEMINI_MODEL', 'gemini-3.5-flash-lite'),
    anthropic_model: 글자('GQ_ANTHROPIC_MODEL', 'claude-sonnet-5'),
    openai_model: 글자('GQ_OPENAI_MODEL', 'gpt-5-nano'),

    gemini_effort: 글자('GQ_GEMINI_EFFORT', 'medium'),
    anthropic_effort: 글자('GQ_ANTHROPIC_EFFORT', 'medium'),
    openai_effort: 글자('GQ_OPENAI_EFFORT', 'none'),

    llm_timeout_seconds: 숫자('GQ_LLM_TIMEOUT_SECONDS', 30),
    llm_rpm: 숫자('GQ_LLM_RPM', 12),

    database_url: 있으면('DATABASE_URL'),

    ...overrides,
  }
}

/**
 * `번호` 번째 제미나이 키. 없으면 `null`.
 *
 * 키가 몇 개인지 아는 자리를 **여기 하나로** 모은다. 넷째 키가 생기면
 * `GEMINI_키_이름들` 과 `제미나이_키_번호들` 만 늘리면 되고 체인은 그대로다.
 */
export function geminiKey(settings: Settings, 번호: number): string | null {
  return settings.gemini_api_keys[번호 - 1] ?? null
}

// ── 화면에서 고를 수 있는 값 ────────────────────────────────────────────────
// 자유 입력칸은 오타를 그대로 저장했고, 그 회차는 첫 호출에서 통째로 실패했다 (2026-08-11).

export const 고를_수_있는_제미나이_모델 = ['gemini-3.5-flash-lite', 'gemini-3.5-flash'] as const

/**
 * 고를 수 있는 추론 강도.
 *
 * ⚠️ **`llm/` 이 아는 이름과 같아야 한다** — 모르는 이름을 고르면 강도가 안 실린 채
 *    조용히 돈다. `web/tests/llm.test.ts` 가 두 목록이 어긋나면 빨개진다.
 */
export const 고를_수_있는_강도 = ['minimal', 'low', 'medium', 'high'] as const

/**
 * 고를 수 있는 모델. 설정이 목록 밖 모델을 가리키면 **그것도 함께** 보여 준다.
 *
 * 설정을 이긴 척하지 않는다 — `.env.local` 이 다른 모델을 가리키는데 화면에서 그 값이
 * 사라지는 편이 더 헷갈린다.
 */
export function 모델_목록(현재: string): readonly string[] {
  if ((고를_수_있는_제미나이_모델 as readonly string[]).includes(현재)) {
    return 고를_수_있는_제미나이_모델
  }
  return [현재, ...고를_수_있는_제미나이_모델]
}

// ── 단가표 ────────────────────────────────────────────────────────────────
//
// 파이썬 `src/goodquestion/config.py` 의 「단가표」 절을 옮긴 것이다 (이슈 #26 E-3 · FR-006).
//
// 🔴 **비용은 기록이 아니라 설정이다.** `llm_calls` 에는 토큰만 남고 금액 칸이 **없다.**
//    단가는 바뀌고 모델도 갈아타므로, 원장에는 토큰만 남기고 **볼 때마다 이 표로 곱한다.**
//    그래서 지난 회차의 금액도 「그때 단가」로 되짚을 수 있다 (`단가표.toml` 머리말).
//
// 🔴 **모르면 `null`(모름)이고 0 으로 때우지 않는다.** 「안 썼다」와 「모른다」가 한 값이 되면
//    예산 판단이 조용히 틀어진다. 표에 없는 모델·첫 구간보다 이른 회차·토큰이 안 남은 시도가
//    전부 「모름」이다.
//
// ⚠️ **파이썬과 갈린 자리 하나 — `Decimal` 이 아니라 `number` 다.** 자바스크립트에 십진
//    수형이 없다. 파이썬이 `Decimal(str(값))` 을 쓴 것은 `Decimal(0.30)` 이 2진수 오차를
//    금액에 싣기 때문인데, 여기서는 값 자체를 float 로 두고 **화면에서 소수 여섯 자리로
//    끊는다** (파이썬 틀도 `"%.6f"` 로 끊었다). 토큰 수가 백만 단위여도 float64 의 유효자리
//    (15~16자리)가 여섯 자리 반올림을 흔들지 못한다.

/** `단위` 칸에 적을 수 있는 말과 그 나눗수. 공급자 가격표가 보통 백만 토큰당이라 셋을 뒀다. */
const _단위별_나눗수: Record<string, number> = {
  백만토큰당: 1_000_000,
  천토큰당: 1_000,
  토큰당: 1,
}

const _단가_칸 = ['적용_시작일', '입력_단가', '출력_단가'] as const

/**
 * 단가표 파일의 모양이 약속과 다르다.
 *
 * 조용히 넘기지 않고 멈춘다. 오타 하나로 단가가 빠지면 화면 금액이 소리 없이 틀어지는데,
 * **「모름」과 「틀린 값」은 다르다.**
 */
export class 단가표_형식_오류 extends Error {
  constructor(문구: string) {
    super(문구)
    this.name = '단가표_형식_오류'
  }
}

/** 한 모델의 한 구간. 이 시작일부터 다음 구간 전날까지 이 값을 쓴다. */
export interface 단가 {
  /** `YYYY-MM-DD`. 날짜만 비교하므로 글자로 둔다 — ISO 라 사전순 = 날짜순이다. */
  적용_시작일: string
  입력_단가: number
  출력_단가: number
}

/**
 * `{모델: [{적용_시작일, 입력_단가, 출력_단가}, …]}` 를 담는 그릇.
 *
 * `통화`·`단위` 는 숫자가 아니라 **그 숫자를 어떻게 읽나**를 적은 칸이다.
 * 단가가 하나도 없으면 둘 다 없어도 된다(비어 있는 표가 정상이다).
 */
export interface 단가표 {
  통화: string | null
  단위: string | null
  모델별: ReadonlyMap<string, readonly 단가[]>
}

/** 빈 표. 파일이 없을 때 이것이 나오고, 그러면 모든 비용이 「모름」이다. */
export function 빈_단가표(): 단가표 {
  return { 통화: null, 단위: null, 모델별: new Map() }
}

/**
 * 호출 시각을 적용 시작일과 견줄 날짜(`YYYY-MM-DD`)로 바꾼다.
 *
 * `Date` 는 **UTC 로 옮긴 뒤** 날짜를 뗀다 (파이썬 `_날짜로()` 의 tz-aware 갈래와 같다).
 * 같은 순간이 보는 사람 시간대에 따라 다른 구간에 걸리면 지난 회차의 금액이 흔들린다.
 * `llm_calls.created_at` 은 `timestamptz` 라 늘 이쪽으로 온다.
 */
export function 날짜로(시각: Date | string): string {
  if (시각 instanceof Date) {
    if (Number.isNaN(시각.getTime())) {
      throw new TypeError(`호출 시각이 날짜가 아니다: ${String(시각)}`)
    }
    return 시각.toISOString().slice(0, 10)
  }
  if (typeof 시각 === 'string' && /^\d{4}-\d{2}-\d{2}/.test(시각)) return 시각.slice(0, 10)
  throw new TypeError(`호출 시각은 Date 나 YYYY-MM-DD 여야 한다: ${String(시각)}`)
}

/**
 * 그 시각에 적용되던 구간을 고른다. 없으면 `null`(모름)이다.
 *
 * 「없음」이 되는 경우는 둘이다 — 표에 없는 모델이거나, 그 모델의 **첫 적용 시작일보다
 * 이른** 시각이거나. ⭐ 둘 다 0 이 아니라 **모름**이다.
 * 적용 시작일 **당일부터** 그 단가다.
 */
export function 적용_단가(표: 단가표, 모델: string, 시각: Date | string): 단가 | null {
  const 구간들 = 표.모델별.get(모델)
  if (구간들 === undefined || 구간들.length === 0) return null
  const 기준일 = 날짜로(시각)
  const 해당 = 구간들.filter((구간) => 구간.적용_시작일 <= 기준일)
  if (해당.length === 0) return null
  return 해당[해당.length - 1] // 읽을 때 시작일 순으로 정렬해 두었다
}

function _문자열_칸(값: unknown, 이름: string, 출처: string): string | null {
  if (값 === undefined || 값 === null) return null
  if (typeof 값 !== 'string' || 값.trim() === '') {
    throw new 단가표_형식_오류(`${출처}: \`${이름}\` 은 빈칸이 아닌 글자여야 한다 — ${표시(값)}`)
  }
  return 값.trim()
}

function 표시(값: unknown): string {
  if (typeof 값 === 'string') return JSON.stringify(값)
  if (값 instanceof Date) return 값.toISOString()
  return String(값)
}

function _시작일_해석(값: unknown, 모델: string, 출처: string): string {
  // smol-toml 의 `TomlDate` 는 `Date` 의 하위형이다. 따옴표로 감싸 적으면 **글자**로
  // 들어오는데, 그건 파이썬과 똑같이 막는다 (`단가표.toml` 머리말의 그 함정이다).
  if (값 instanceof Date) return 날짜로(값)
  throw new 단가표_형식_오류(
    `${출처}: \`${모델}\` 의 적용_시작일은 TOML 날짜여야 한다 — ` +
      `따옴표 없이 2026-08-01 처럼 적는다 (지금 값: ${표시(값)})`,
  )
}

function _금액_해석(값: unknown, 칸: string, 모델: string, 출처: string): number {
  // TOML 정수는 안전 범위를 넘으면 bigint 로 온다. 불리언은 숫자가 아니다.
  const 숫자값 =
    typeof 값 === 'number' ? 값 : typeof 값 === 'bigint' ? Number(값) : Number.NaN
  if (!Number.isFinite(숫자값)) {
    throw new 단가표_형식_오류(`${출처}: \`${모델}\` 의 ${칸} 은 숫자여야 한다 — ${표시(값)}`)
  }
  if (숫자값 < 0) {
    throw new 단가표_형식_오류(`${출처}: \`${모델}\` 의 ${칸} 이 음수다 — ${표시(값)}`)
  }
  return 숫자값
}

function _구간들_해석(구간들: unknown, 모델: string, 출처: string): 단가[] {
  if (!Array.isArray(구간들) || 구간들.length === 0) {
    throw new 단가표_형식_오류(
      `${출처}: \`${모델}\` 은 구간 목록이어야 한다 — [["모델"."${모델}"]] 로 적는다`,
    )
  }

  const 만들어진: 단가[] = []
  const 본_시작일 = new Set<string>()
  for (const 구간 of 구간들) {
    if (typeof 구간 !== 'object' || 구간 === null || Array.isArray(구간)) {
      throw new 단가표_형식_오류(`${출처}: \`${모델}\` 의 구간 하나가 표가 아니다 — ${표시(구간)}`)
    }
    const 칸들 = 구간 as Record<string, unknown>
    const 남은_칸 = Object.keys(칸들).filter(
      (이름) => !(_단가_칸 as readonly string[]).includes(이름),
    )
    if (남은_칸.length > 0) {
      throw new 단가표_형식_오류(
        `${출처}: \`${모델}\` 에 모르는 칸이 있다 — ${JSON.stringify(남은_칸.sort())}. ` +
          `쓸 수 있는 칸은 ${JSON.stringify(_단가_칸)} 뿐이다`,
      )
    }
    const 빠진_칸 = _단가_칸.filter((이름) => !(이름 in 칸들))
    if (빠진_칸.length > 0) {
      throw new 단가표_형식_오류(`${출처}: \`${모델}\` 의 구간에 ${JSON.stringify(빠진_칸)} 이(가) 없다`)
    }

    const 시작일 = _시작일_해석(칸들['적용_시작일'], 모델, 출처)
    if (본_시작일.has(시작일)) {
      throw new 단가표_형식_오류(
        `${출처}: \`${모델}\` 에 같은 적용 시작일이 두 번 있다 — ${시작일}. ` +
          '어느 쪽이 맞는지 코드가 정할 수 없다',
      )
    }
    본_시작일.add(시작일)
    만들어진.push({
      적용_시작일: 시작일,
      입력_단가: _금액_해석(칸들['입력_단가'], '입력_단가', 모델, 출처),
      출력_단가: _금액_해석(칸들['출력_단가'], '출력_단가', 모델, 출처),
    })
  }
  만들어진.sort((왼, 오른) => (왼.적용_시작일 < 오른.적용_시작일 ? -1 : 1))
  return 만들어진
}

/** 읽어 온 표를 검사해 `단가표` 로 만든다. 파일 없이 시험할 때도 쓴다. */
export function 단가표_해석(원본: unknown, 출처 = '단가표'): 단가표 {
  if (typeof 원본 !== 'object' || 원본 === null || Array.isArray(원본)) {
    throw new 단가표_형식_오류(`${출처}: 표가 아니다`)
  }
  const 칸들 = 원본 as Record<string, unknown>
  const 통화 = _문자열_칸(칸들['통화'], '통화', 출처)
  const 단위 = _문자열_칸(칸들['단위'], '단위', 출처)
  if (단위 !== null && !(단위 in _단위별_나눗수)) {
    throw new 단가표_형식_오류(
      `${출처}: 단위는 ${Object.keys(_단위별_나눗수).join(' · ')} 중 하나여야 한다 — ${표시(단위)}`,
    )
  }

  const 날것 = 칸들['모델'] ?? {}
  if (typeof 날것 !== 'object' || 날것 === null || Array.isArray(날것)) {
    throw new 단가표_형식_오류(`${출처}: \`모델\` 은 모델 이름별 표여야 한다`)
  }

  const 모델별 = new Map<string, readonly 단가[]>()
  for (const [모델, 구간들] of Object.entries(날것 as Record<string, unknown>)) {
    모델별.set(모델, _구간들_해석(구간들, 모델, 출처))
  }

  if (모델별.size > 0 && (통화 === null || 단위 === null)) {
    throw new 단가표_형식_오류(
      `${출처}: 단가를 적었으면 \`통화\` 와 \`단위\` 도 적어야 한다. ` +
        '숫자만 있고 무엇당 얼마인지 없으면 화면 금액을 믿을 수 없다',
    )
  }
  return { 통화, 단위, 모델별 }
}

/**
 * 단가표 파일의 자리. 환경변수 `GQ_PRICING_FILE` 로 바꾼다 (파이썬과 같은 이름).
 *
 * ⚠️ 기본 자리가 파이썬(레포 루트)과 다르다 — **`web/단가표.toml`** 이다. 루트 것은
 *    파이썬과 함께 아카이빙되므로 타입스크립트 판이 읽는 사본을 `web/` 에 두었다.
 */
export function 단가표_경로(): string {
  loadEnvFile()
  const 지정 = (process.env['GQ_PRICING_FILE'] ?? '').trim()
  return 지정 === '' ? path.join(WEB_ROOT, '단가표.toml') : 지정
}

/**
 * 단가표 파일을 읽는다. **파일이 없으면 빈 표**다(모든 비용이 「모름」).
 *
 * 파일이 없다고 죽지 않는 이유는 `.env.local` 과 같다 — 이게 없어도 레포는 돌아야 한다.
 * 다만 **모양이 틀린 파일은 죽인다** (`단가표_형식_오류`).
 */
export function 단가표_읽기(경로?: string): 단가표 {
  const 자리 = 경로 ?? 단가표_경로()
  if (!existsSync(자리)) return 빈_단가표()
  let 원본: unknown
  try {
    원본 = parseToml(readFileSync(자리, 'utf8'))
  } catch (오류) {
    if (오류 instanceof TomlError) {
      throw new 단가표_형식_오류(`단가표를 읽지 못했다: ${자리} — ${오류.message}`)
    }
    throw 오류
  }
  return 단가표_해석(원본, 자리)
}

/**
 * 한 시도(또는 합계)의 비용. **모르면 `null` 이고, 0 으로 때우지 않는다.**
 *
 * `null` 이 되는 경우는 넷이다.
 *
 * - 토큰을 안 준 시도다 (`입력_토큰`·`출력_토큰` 중 하나라도 `null`).
 *   `repo/runs.attemptTotals()` 가 이미 같은 규칙으로 합계를 `null` 로 낸다.
 * - 모델 이름을 모른다 (`null`).
 * - 단가표에 없는 모델이다 — **지어내지 않는다.**
 * - 그 모델의 첫 적용 시작일보다 이른 회차다.
 *
 * `표` 를 주지 않으면 파일을 읽는다. 화면처럼 여러 줄을 계산할 때는 **한 번 읽어 넘겨라.**
 */
export function 비용_계산(
  모델: string | null,
  입력_토큰: number | null,
  출력_토큰: number | null,
  호출_시각: Date | string,
  표?: 단가표,
): number | null {
  if (모델 === null || 입력_토큰 === null || 출력_토큰 === null) return null
  const 쓸_표 = 표 ?? 단가표_읽기()
  const 적용 = 적용_단가(쓸_표, 모델, 호출_시각)
  if (적용 === null) return null
  // 해석 단계에서 걸러지지만, 손으로 만든 표를 넘길 수도 있다.
  const 나눗수 = _단위별_나눗수[쓸_표.단위 ?? '']
  if (나눗수 === undefined) return null
  return (입력_토큰 * 적용.입력_단가 + 출력_토큰 * 적용.출력_단가) / 나눗수
}
