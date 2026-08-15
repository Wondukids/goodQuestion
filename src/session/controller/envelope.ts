// 아이 앱 응답 봉투 — `{ ok, data }` / `{ ok: false, error }` (`docs/대화턴_이어하기_명세.md` 4절).
//
// 관리자 v1 봉투(`@/llm/controller/envelope`)와 **다른 계약**이다 — 그쪽은
// `{ api_version, data, meta }` 고, 이쪽 명세는 `ok` 로 갈랐다. 명세가 정본이다.
//
// ⛔ 여기에 규칙을 쓰지 않는다. 하는 일은 둘뿐이다 —
//    성공을 `{ ok: true, data }` 로 싸고, 예외를 명세 4절의 코드·HTTP 로 옮긴다.
//
// 예외 이름은 `@/llm/service/step` 의 재-내보내기 목록에서 가져온다 — 라우트·컨트롤러가
// repo·provider 를 직접 물지 않게 서비스 층이 한 번 모아 둔 자리다 (v1 봉투와 같은 이유).

import {
  AnalysisResponseError,
  LLMError,
  LookupError,
  MissionInProgress,
  MissionNotActive,
  TurnIncomplete,
  TurnInProgress,
  TurnNotAllowed,
  ValueError,
} from '@/llm/service/step'
import type { PendingTurn } from '@/llm/service/run'

export interface SessionErrorBody {
  code: string
  message: string
  retryable: boolean
  /** 409 `TURN_INCOMPLETE` 에만 실린다 — 앱은 이걸 받으면 resume 을 부른다 (명세 4.1절). */
  pending?: PendingTurn
}

export function ok<T>(data: T): Response {
  return Response.json({ ok: true, data })
}

/** 실패. ⛔ `data` 를 같이 싣지 않는다 — v1 봉투와 같은 이유다. */
export function fail(status: number, error: SessionErrorBody): Response {
  return Response.json({ ok: false, error }, { status })
}

/**
 * 서비스 층이 던진 것을 명세 4절의 표로 옮긴다.
 *
 * ⚠️ 순서가 의미를 갖는다 — 상속 관계라 좁은 것을 먼저 본다:
 * - `TurnIncomplete` ⊂ `TurnNotAllowed` : 「미완 턴이 있어 새 발화가 막혔다」와 「부를 차례가 아니다」
 * - `AnalysisResponseError` ⊂ `ValueError` · `TurnFailed` ⊂ `LLMError`
 */
export function 옮긴다(오류: unknown): { status: number; error: SessionErrorBody } {
  const 말 = 오류 instanceof Error ? 오류.message : String(오류)
  const 짓기 = (status: number, code: string, retryable = false) => ({
    status,
    error: { code, message: 말, retryable },
  })

  // 409 — 미완 턴이 있어 새 발화가 막혔다. `pending` 을 실어 앱이 resume 을 부르게 한다.
  if (오류 instanceof TurnIncomplete) {
    return { status: 409, error: { ...짓기(409, 'TURN_INCOMPLETE').error, pending: 오류.pending } }
  }
  // 409 — 같은 세션에서 아직 끝나지 않은 호출이 있다. **재시도 가능하다.**
  //       미션 API 도 같은 회차 잠금을 공유한다 (미션 명세 7절 E).
  if (오류 instanceof TurnInProgress) return 짓기(409, 'TURN_IN_PROGRESS', true)
  // 409 — 미션이 도는 중이라 일반 턴을 받을 수 없다 (미션 명세 7절 E).
  //       재시도해도 같다: 앱이 할 일은 미션을 마치는 것(complete)이다.
  if (오류 instanceof MissionInProgress) return 짓기(409, 'MISSION_IN_PROGRESS')
  // 409 — 그 미션 시도가 `in_progress` 가 아니다. 이미 끝났거나 버려졌다 (미션 명세 7절 E).
  if (오류 instanceof MissionNotActive) return 짓기(409, 'MISSION_NOT_ACTIVE')
  // 409 — 이어 돌릴 것이 없다 · 회차 없는 세션 · 부를 차례가 아니다.
  if (오류 instanceof TurnNotAllowed) return 짓기(409, 'TURN_NOT_ALLOWED')
  // 502 — 분석 LLM 이 규격 밖 응답을 냈다. v1 은 422 로 가르지만 아이 앱 계약(명세 4.2절 표)에
  //       그 칸이 없다 — 저장 상태는 그대로고 앱이 할 수 있는 일은 다시 resume 뿐이라 502 다.
  if (오류 instanceof AnalysisResponseError) return 짓기(502, 'LLM_UNAVAILABLE', true)
  // 502 — 공급자가 전부 실패했다 (`TurnFailed` 포함). 이어 돌리다 또 실패한 자리다.
  if (오류 instanceof LLMError) return 짓기(502, 'LLM_UNAVAILABLE', true)
  // 404 — 그 `session_id` 가 없다.
  if (오류 instanceof LookupError) return 짓기(404, 'SESSION_NOT_FOUND')
  // 400 — 부르는 쪽이 잘못된 인자를 줬다.
  if (오류 instanceof ValueError) return 짓기(400, 'BAD_REQUEST')
  return 짓기(500, 'INTERNAL')
}

/** 예외 하나를 그대로 응답으로. 컨트롤러의 `catch` 한 줄이다. */
export function failed(오류: unknown): Response {
  const { status, error } = 옮긴다(오류)
  return fail(status, error)
}
