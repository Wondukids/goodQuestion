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
import { printLine } from '@/llm/log'
import { getDb, type Conn } from '@/llm/repo/db'
import { loadReportSettings } from '@/report/config'
import type { ReportCall } from '@/report/engine'
import {
  listReports,
  markReportRead,
  readReport,
  리포트없는_활동들,
  type ReportRow,
} from '@/report/repo/reports'
import type { ParentReport, ReportListItem, ReportStatus } from '@/report/types'

import { generateReport, queueReport } from './generate'

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

/**
 * 받침이 한 번에 띄우는 장 수. 늘리려면 이 숫자만 고친다 (아래 「한 번에 한 장만」).
 */
const 받침_한번에 = 1

/**
 * 🔴 **받침 — 보호자가 열었는데 리포트가 없으면 그 자리에서 띄운다** (F12 · 후활동 명세 7.1).
 *
 * 리포트가 없는 활동을 최근 순으로 최대 `받침_한번에` 개 띄운다. **기다리지 않는다.**
 *
 * ## 왜 이 자리가 필요한가
 *
 * 후활동이 있는 이야기는 세션이 끝나도 리포트를 안 만든다 (F10). 만들라는 신호는 아이가
 * 끝 화면을 떠날 때 오는데(F11), **앱을 그냥 꺼버리면** 그 신호가 영영 안 온다. 그러면
 * 보호자에게 보여 줄 것이 없다. 늦게 만들어도 손해 보는 사람이 없고, 그사이 아이가 순서만
 * 맞추고 껐다면 **그것까지** 담긴다.
 *
 * ## 왜 목록에도 거나 (한 장 조회만으로는 못 받친다)
 *
 * 화면은 **목록을 먼저 부르고 그 첫 줄을 연다** (`components/report/report-screen.tsx`).
 * 목록은 `parent_reports` 행에서 나오므로, 리포트가 없는 활동은 드롭다운에 **아예 안 뜬다** —
 * 보호자가 그 활동의 한 장 조회에 닿을 길이 없다. 그래서 받침은 목록 쪽이 본체다.
 *
 * ## 왜 기다리지 않나 (되돌리기 쉬운 쪽 · 킥오프 ⑥)
 *
 * 여기서 `await` 하면 보호자의 첫 열람이 **LLM 2회만큼** 멈춘다 (명세 11절이 이미 「느려질
 * 수 있다」고 적어 둔 위험이다). 목록 조회를 그만큼 붙잡아 두는 것은 더 나쁘다. 그래서
 * **띄우기만 하고 지금 있는 것을 그대로 낸다** — 다음 열람(또는 새로고침)에 뜬다.
 * 되돌리기도 이쪽이 쉽다: 기다리게 하려면 이 함수의 `queueReport()` 를
 * `await generateReport()` 로 바꾸는 한 줄이다. 화면에 「만드는 중」이 필요한데 그건 다른
 * 갈래 몫이라 손대지 않았다 (마지막 답변에 무엇이 필요한지 적었다).
 *
 * ## 한 번에 한 장만
 *
 * 리포트 한 장이 LLM 2회다. 밀린 것이 여럿인 아이(리포트 기능 이전의 옛 활동들)를 한꺼번에
 * 띄우면 열람 한 번에 비용이 몇 배로 나간다. **최근 것 한 장씩** 띄우고 나머지는 다음
 * 열람이 이어 받는다 — 보호자가 보고 싶은 순서도 최근 순이다.
 *
 * 밀린 것이 더 있으면 로그에 남긴다 — 조용히 잘라 내면 「다 만들었다」로 읽힌다.
 */
async function 받침(conn: Conn, child_id: string): Promise<void> {
  // 한 개 더 읽어 「남은 것이 있나」를 안다 (세는 질의를 따로 던지지 않으려고).
  const 밀린것 = await 리포트없는_활동들(conn, child_id, 받침_한번에 + 1)
  if (밀린것.length === 0) return

  const 띄울것 = 밀린것.slice(0, 받침_한번에)
  for (const session_id of 띄울것) queueReport(session_id)
  printLine(
    `[리포트] 받침 띄움=[${띄울것.join(', ')}] 남음=${밀린것.length > 받침_한번에 ? '있음' : '없음'}`,
  )
}

/**
 * 아이 하나의 리포트 목록 — 상단 활동 드롭다운. 없으면 빈 배열이다.
 *
 * ⚠️ **읽기만 하는 함수가 아니다** — 리포트가 빠진 활동이 있으면 받침을 띄운다 (F12, 위).
 *    이번에 띄운 것은 이 응답에 **안 실린다.** 아직 만들어지지 않았기 때문이다.
 */
export async function listChildReports(args: {
  child_id: string
  conn?: Conn
}): Promise<ReportListItem[]> {
  const conn = args.conn ?? getDb()
  await 받침(conn, args.child_id)
  return listReports(conn, args.child_id)
}

/**
 * 리포트 한 장. 아직 안 만들어졌으면 `null` — 컨트롤러가 `404` 로 옮긴다.
 *
 * 없으면 **띄워 두고** `null` 을 낸다 (F12). 목록을 거치지 않고 주소로 바로 연 보호자가
 * 여기로 온다.
 *
 * ⚠️ **만드는 중에 또 열면 한 번 더 띄운다** — 아직 행이 없어 `queueReport()` 의 「이미
 *    있으면 돌아간다」가 안 걸린다. 저장은 덮어쓰기라 행은 안 늘지만 LLM 2회가 또 나간다.
 *    화면은 목록을 먼저 부르므로 이 길로 겹치는 것은 새로고침을 연달아 누르는 때뿐이라
 *    그대로 뒀다. 막으려면 「만드는 중」을 표에 남겨야 하고 그건 칸을 늘리는 일이다.
 */
export async function readParentReport(args: {
  session_id: string
  conn?: Conn
}): Promise<ParentReport | null> {
  const 행 = await readReport(args.conn ?? getDb(), args.session_id)
  if (행 === null) {
    queueReport(args.session_id)
    return null
  }
  return 계약모양(행)
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
