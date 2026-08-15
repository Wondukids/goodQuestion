/**
 * 보호자 리포트 API 네 개를 부르는 얇은 층 (계약 문서 3절).
 *
 * 브라우저에서 상대 경로로 부른다 — 이 레포가 자기 API 를 부르는 방식이 그렇고
 * (`src/stories/fart-bride/session-api.ts`), 쿠키(로그인 · 선택된 아이)가 그대로 실린다.
 *
 * ⛔ 라우트 자체는 여기서 만들지 않는다. `src/app/api/reports/**` 는 다른 갈래(#38)의 몫이다.
 *
 * ⚠️ 값을 zod 로 검사하지 않는다. 같은 레포 안에서 `ParentReport` 선언 하나를 서버와
 *    화면이 함께 보고 있어(`src/report/types.ts`) 한 번 더 재는 값이 되기 때문이다.
 */

import type { ParentReport, ReportListItem } from "@/report/types";

/** 서버가 거절한 요청. `status` 를 들고 다녀 화면이 429(3회 초과)를 갈라 볼 수 있다. */
export class ReportRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ReportRequestError";
  }

  /** 「다시 만들기」를 3회 넘게 눌렀다 (계약 3절) */
  get tooMany(): boolean {
    return this.status === 429;
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: "no-store", ...init });
  if (!res.ok) {
    throw new ReportRequestError(res.status, `${init?.method ?? "GET"} ${path} 실패`);
  }
  return (await res.json()) as T;
}

/** 상단 활동 드롭다운을 채운다. 서버가 최근 순으로 준다. */
export function fetchReportList(childId: string): Promise<ReportListItem[]> {
  return requestJson<ReportListItem[]>(
    `/api/children/${encodeURIComponent(childId)}/reports`,
  );
}

/**
 * 리포트 한 장. **아직 활동을 안 한 아이는 실제로 생기는 상태**라
 * `404` 를 오류가 아니라 `null` 로 받는다 — 화면은 빈 판이 아니라 안내를 낸다.
 */
export async function fetchReport(sessionId: string): Promise<ParentReport | null> {
  const path = `/api/reports/${encodeURIComponent(sessionId)}`;
  const res = await fetch(path, { cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new ReportRequestError(res.status, `GET ${path} 실패`);
  return (await res.json()) as ParentReport;
}

/**
 * 보호자가 처음 열었다고 알린다 (계약 2절 ⑤).
 * 실패해도 삼킨다 — 점 하나 때문에 리포트를 못 보게 만들 이유가 없다.
 */
export async function markReportRead(sessionId: string): Promise<void> {
  try {
    await fetch(`/api/reports/${encodeURIComponent(sessionId)}/read`, {
      method: "POST",
    });
  } catch {
    /* 읽음 표시는 다음에 열 때 다시 시도된다 */
  }
}

/**
 * 문장을 다시 만든다. 3회를 넘기면 서버가 429 로 막는다 (계약 3절).
 *
 * ⚠️ POST 의 응답 본문 모양은 계약에 없다. 그래서 **성공 여부만 보고 새로 조회한다** —
 *    #38 이 무엇을 돌려주든 화면이 깨지지 않는 쪽이다. 본문이 정해지면 한 줄로 줄어든다.
 */
export async function regenerateReport(sessionId: string): Promise<ParentReport | null> {
  const path = `/api/reports/${encodeURIComponent(sessionId)}/regenerate`;
  const res = await fetch(path, { method: "POST" });
  if (!res.ok) throw new ReportRequestError(res.status, `POST ${path} 실패`);
  return fetchReport(sessionId);
}
