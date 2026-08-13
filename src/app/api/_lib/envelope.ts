// 응답 봉투와 오류 표 — 라우트 넷이 **똑같이** 쓰는 자리 (`docs/설계/라우트계약.md` 2절).
//
// ⛔ 여기에 규칙을 쓰지 않는다. 하는 일은 둘뿐이다 —
//    성공을 `{ api_version, data, meta? }` 로 싸고, 예외를 계약 8절의 코드·HTTP 로 옮긴다.
//
// ⚠️ 밑줄로 시작하는 폴더(`_lib`)라 Next 의 라우팅에서 빠진다. 이 파일은 라우트가 아니다.
//
// ## 왜 예외를 `@/lib/service/step` 에서 가져오나
//
// `app/` 은 `lib/repo` 와 `lib/llm` 을 직접 import 하지 않는다 (eslint 가 막아 뒀다).
// `SceneNotFound` 는 repo 에, `LLMError` 는 llm 에 사는데 라우트가 그것을 **이름으로**
// 알아봐야 상태 코드를 가를 수 있다. 그래서 `step.ts` 가 그 목록을 한 번 다시 내보낸다.

import type { ZodError } from 'zod'

import {
  AnalysisResponseError,
  LLMError,
  LookupError,
  MessageNotFound,
  SceneNotFound,
  TurnInProgress,
  TurnNotAllowed,
  ValueError,
  type Meta,
} from '@/lib/service/step'

/** 봉투의 `api_version`. 경로의 `/v1` 과 짝이다 (계약 8절 「아직 안 정한 것」 3번). */
export const API_VERSION = 'v1'

export interface ErrorBody {
  code: string
  message: string
  retryable: boolean
}

/**
 * 성공. `meta` 는 **LLM 을 부른 호출에만** 실린다 — `null` 이면 칸 자체를 넣지 않는다
 * (② · CLOSING 인 ③ · ④).
 */
export function ok<T>(data: T, meta: Meta | null = null): Response {
  return Response.json(
    meta === null ? { api_version: API_VERSION, data } : { api_version: API_VERSION, data, meta },
  )
}

/**
 * 실패. ⛔ **`data` 를 같이 싣지 않는다** — 반쯤 성공한 모양을 만들면 화면이 둘 다 읽으려 든다.
 */
export function fail(status: number, error: ErrorBody): Response {
  return Response.json({ api_version: API_VERSION, error }, { status })
}

/** zod 가 요청을 거부했다 (계약 8절 400 `BAD_REQUEST`). */
export function badRequest(message: string): Response {
  return fail(400, { code: 'BAD_REQUEST', message, retryable: false })
}

/** zod 오류를 사람이 읽을 한 줄로. 어느 칸이 왜 틀렸는지가 남아야 화면이 고칠 수 있다. */
export function zodMessage(오류: ZodError): string {
  return 오류.issues
    .map((건) => (건.path.length === 0 ? 건.message : `${건.path.join('.')}: ${건.message}`))
    .join(' · ')
}

/**
 * 서비스 층이 던진 것을 계약 8절의 표로 옮긴다.
 *
 * ⚠️ **순서가 의미를 갖는다** — 아래 셋은 상속 관계라 좁은 것을 먼저 본다.
 * - `AnalysisResponseError` ⊂ `ValueError` : 「LLM 이 규격 밖」(422)과 「요청이 틀렸다」(400)
 * - `SceneNotFound` ⊂ `LookupError` : 「씬이 없다」와 「세션이 없다」
 * - `TurnFailed` ⊂ `LLMError` : 둘 다 502 라 갈릴 것은 없지만 같은 갈래다
 */
export function 옮긴다(오류: unknown): { status: number; error: ErrorBody } {
  const 말 = 오류 instanceof Error ? 오류.message : String(오류)
  const 짓기 = (status: number, code: string, retryable = false) => ({
    status,
    error: { code, message: 말, retryable },
  })

  // 422 — 분석 LLM 이 규격 밖 응답을 냈다. ⛔ fallback 은 돌지 않았다 (`CLAUDE.md` LLM 절).
  if (오류 instanceof AnalysisResponseError) return 짓기(422, 'SCHEMA_INVALID')
  // 502 — 공급자가 전부 실패했다 (API 에러·네트워크·타임아웃). **재시도 가능하다.**
  if (오류 instanceof LLMError) return 짓기(502, 'LLM_UNAVAILABLE', true)
  // 409 — 같은 세션에서 아직 끝나지 않은 호출이 있다. 재시도 가능하다.
  if (오류 instanceof TurnInProgress) return 짓기(409, 'TURN_IN_PROGRESS', true)
  // 409 — 지금 이 단계를 부를 차례가 아니다 (전개 장면 · 끝난 세션 · 미완 턴).
  if (오류 instanceof TurnNotAllowed) return 짓기(409, 'TURN_NOT_ALLOWED')
  // 404 — `message_id` 가 없거나 그 세션 것이 아니다.
  if (오류 instanceof MessageNotFound) return 짓기(404, 'MESSAGE_NOT_FOUND')
  // 404 — 씬 코드가 틀렸다 · 세션의 현재 장면이 사라졌다.
  if (오류 instanceof SceneNotFound) return 짓기(404, 'SCENE_NOT_FOUND')
  // 404 — 그 `session_id` 가 없다 (`readSession()` 이 맨 `LookupError` 를 던진다).
  if (오류 instanceof LookupError) return 짓기(404, 'SESSION_NOT_FOUND')
  // 400 — 부르는 쪽이 잘못된 인자를 줬다 (빈 발화 등).
  if (오류 instanceof ValueError) return 짓기(400, 'BAD_REQUEST')
  return 짓기(500, 'INTERNAL')
}

/** 예외 하나를 그대로 응답으로. 라우트의 `catch` 한 줄이다. */
export function failed(오류: unknown): Response {
  const { status, error } = 옮긴다(오류)
  return fail(status, error)
}
