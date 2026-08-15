// 리포트 API 응답 모양 — **성공은 알맹이 그대로, 실패는 HTTP 상태로 가른다.**
//
//     성공  ParentReport · ReportListItem[] · 204 (본문 없음)
//     실패  { error: { code, message } } + 4xx/5xx
//
// ## 🔴 아이 앱 봉투(`{ ok, data }`)를 안 썼다 — 왜인지 남긴다
//
// 킥오프 ⑤는 「아이 앱 계약과 같은 결(`src/session/controller/envelope.ts`)로 맞춰라」였다.
// 그런데 화면 갈래(#39)가 **먼저 닫히면서** 세 가지를 이미 가정해 짰다 (2026-08-15 본선 통보):
//
// 1. `GET /api/children/{child_id}/reports` 는 **맨 배열**이다 — `{ reports: [...] }` 로 감싸지 않는다.
// 2. 「다시 만들기」의 본문은 화면이 안 본다. **성공/실패가 HTTP 상태로 갈리기만** 하면 된다.
// 3. `ParentReport` 에 `session_id` 가 없고, 화면이 그 값을 따로 들고 다닌다.
//
// 목록이 맨 배열이면 리포트 한 장만 봉투에 넣을 이유가 없다. 게다가 프론트 계약 문서 4절의
// 「붙여서 바로 돌려 볼 수 있는 샘플 응답」이 **봉투 없는 알맹이**이고, #39 의 `/dev/report`
// 가 그 샘플을 그대로 화면에 꽂아 보는 자리다 — 봉투를 씌우면 그 확인 경로가 끊긴다.
//
// ⚠️ 그래서 **아이 앱과 다른 결**이 되었다. 킥오프를 거스른 자리이므로 본선에 보고한다.
//    되돌리기는 쉽다 — 이 파일의 `ok()` 한 줄과 화면의 읽는 자리 한 줄이다.

export interface ReportErrorBody {
  code: string
  message: string
}

/** 성공 — 알맹이를 그대로 낸다. */
export function ok<T>(data: T): Response {
  return Response.json(data)
}

/** 실패 — 화면은 상태 코드만 보고, 본문은 사람이 읽는다. */
export function fail(status: number, error: ReportErrorBody): Response {
  return Response.json({ error }, { status })
}

/** 본문 없는 성공 — 읽음 표시가 쓴다 (명세 7절: `204`). */
export function 내용없음(): Response {
  return new Response(null, { status: 204 })
}

/**
 * 🔴 **없는 것과 남의 것을 한 응답으로 묶는다** (명세 7절 문지기).
 *
 * 리포트에는 아이 발화 원문이 그대로 실린다. `403` 을 내면 「그 활동은 있는데 네 것이
 * 아니다」를 알려 주는 셈이라, 남의 아이 id 를 넣어 보는 것만으로 **누가 언제 놀았는지**가
 * 새어 나간다. 그래서 존재 여부를 가르지 않고 **전부 404** 다.
 */
export function 못찾음(): Response {
  return fail(404, { code: 'REPORT_NOT_FOUND', message: '그 리포트가 없다' })
}

/** 로그인 안 됨. 문지기가 볼 보호자가 없으면 그 아래 판단이 아예 성립하지 않는다. */
export function 로그인필요(): Response {
  return fail(401, { code: 'PARENT_NOT_AUTHENTICATED', message: '로그인한 보호자가 없다' })
}

/** 「다시 만들기」 한도 (R19 · 명세 7절). 비용이 보호자 손에 달려 있어 막는 자리다. */
export function 한도초과(메시지: string): Response {
  return fail(429, { code: 'REGENERATE_LIMIT', message: 메시지 })
}

/** 예상 못 한 예외 하나를 그대로 응답으로. 컨트롤러의 `catch` 한 줄이다. */
export function failed(오류: unknown): Response {
  return fail(500, {
    code: 'INTERNAL',
    message: 오류 instanceof Error ? 오류.message : String(오류),
  })
}
