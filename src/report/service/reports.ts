// 보호자가 부르는 네 요청의 **순서** (명세 7절 · 프론트 계약 3절).
//
// | 요청 | 여기 함수 |
// |---|---|
// | `GET /api/children/{child_id}/reports` | `listChildReports()` |
// | `GET /api/reports/{session_id}` | `readParentReport()` |
// | `POST /api/reports/{session_id}/read` | `markRead()` |
// | `POST /api/reports/{session_id}/regenerate` | `regenerateReport()` |
//
// ⛔ **문지기는 여기 없다.** 「내 아이인가」는 저쪽(Supabase `children`)을 봐야 알고, 그
//    확인은 HTTP 경계에서 한 번 한다 (`controller/guard.ts`). 이 층은 아이 id 를 받은 뒤의
//    순서만 안다 — `src/session/service/open.ts` 가 쿠키를 컨트롤러에서 받는 것과 같은 결이다.

import type { Settings } from '@/llm/config'
import { getDb, type Conn } from '@/llm/repo/db'
import { loadReportSettings } from '@/report/config'
import type { ReportCall } from '@/report/engine'
import { listReports, markReportRead, readReport, type ReportRow } from '@/report/repo/reports'
import type { ParentReport, ReportListItem, ReportStatus } from '@/report/types'

import { generateReport } from './generate'

/** 「다시 만들기」를 한도까지 썼다 — 컨트롤러가 `429` 로 옮긴다 (명세 7절 · R19). */
export class RegenerateLimit extends Error {
  readonly limit: number

  constructor(메시지: string, limit: number) {
    super(메시지)
    this.name = 'RegenerateLimit'
    this.limit = limit
  }
}

/** 저장된 행 하나를 화면 계약(`ParentReport`)으로 옮긴다. 값을 다시 세지 않는다. */
export function 계약모양(행: ReportRow): ParentReport {
  return {
    status: 행.status as ReportStatus,
    metrics: 행.metrics,
    narrative: 행.narrative ?? null,
    generated_at: 행.generated_at.toISOString(),
    read_at: 행.read_at === null ? null : 행.read_at.toISOString(),
    regenerated: 행.regenerated,
  }
}

/** 아이 하나의 리포트 목록 — 상단 활동 드롭다운. 없으면 빈 배열이다. */
export async function listChildReports(args: {
  child_id: string
  conn?: Conn
}): Promise<ReportListItem[]> {
  return listReports(args.conn ?? getDb(), args.child_id)
}

/** 리포트 한 장. 아직 안 만들어졌으면 `null` — 컨트롤러가 `404` 로 옮긴다. */
export async function readParentReport(args: {
  session_id: string
  conn?: Conn
}): Promise<ParentReport | null> {
  const 행 = await readReport(args.conn ?? getDb(), args.session_id)
  return 행 === null ? null : 계약모양(행)
}

/**
 * 읽음 표시 (명세 3.2 빨간 점). 리포트가 없으면 `false` — 컨트롤러가 `404` 로 옮긴다.
 *
 * 두 번 눌러도 **처음 연 시각이 그대로다** (`markReportRead()`).
 */
export async function markRead(args: { session_id: string; conn?: Conn }): Promise<boolean> {
  const conn = args.conn ?? getDb()
  const 행 = await readReport(conn, args.session_id)
  if (행 === null) return false
  await markReportRead(conn, args.session_id)
  return true
}

export interface RegenerateArgs {
  session_id: string
  conn?: Conn
  settings?: Settings
  /** 검사가 LLM 자리에 꽂는 가짜 */
  call?: ReportCall
  /** 한도를 검사에서 바꿔 볼 때만. 안 주면 환경에서 읽는다 (`src/report/config.ts`). */
  regenerate_limit?: number
}

/**
 * 「다시 만들기」 (R19) — 지표부터 통째로 다시 만들어 **덮어쓴다.**
 *
 * 순서 셋:
 * 1. 리포트가 없으면 `null` (404). **여기서 처음 만들어 주지 않는다** — 「다시」가 아니다.
 * 2. `regenerated` 가 한도에 닿았으면 `RegenerateLimit` (429). 비용이 보호자 손에 달려 있다.
 * 3. 다시 만들고 `regenerated` 를 1 올린다.
 *
 * ⚠️ 세 번째에서 LLM 이 둘 다 실패해도 **저장은 된다** — `status='metrics_only'` 로 숫자만
 *    남는다 (R18). 그래도 `regenerated` 는 오른다: 비용은 이미 나갔기 때문이다.
 */
export async function regenerateReport(args: RegenerateArgs): Promise<ParentReport | null> {
  const conn = args.conn ?? getDb()

  const 있던것 = await readReport(conn, args.session_id)
  if (있던것 === null) return null

  const 한도 = args.regenerate_limit ?? loadReportSettings().regenerate_limit
  if (있던것.regenerated >= 한도) {
    throw new RegenerateLimit(
      `다시 만들기는 ${한도}번까지다 (지금 ${있던것.regenerated}번). 리포트 한 장에 LLM 2회가 나간다`,
      한도,
    )
  }

  const 다시 = await generateReport({
    session_id: args.session_id,
    conn,
    settings: args.settings,
    call: args.call,
    regenerate: true,
  })
  return 다시 === null ? null : 계약모양(다시)
}
