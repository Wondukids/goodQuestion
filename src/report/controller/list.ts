// 리포트가 있는 활동 목록 — `GET /api/children/{child_id}/reports` (명세 7절).
//
// 상단 활동 드롭다운을 채운다. **맨 배열**(`ReportListItem[]`)로 낸다 — 화면 갈래(#39)가
// 그렇게 가정하고 짰다 (`envelope.ts` 머리말).
//
// 리포트가 하나도 없는 아이는 **빈 배열**이고 404 가 아니다. 아이는 있고 활동이 없을 뿐이다.

import { z } from 'zod'

import { listChildReports } from '@/report/service/reports'

import { failed, ok, 로그인필요, 못찾음 } from './envelope'
import { 아이_문지기 } from './guard'

const 경로 = z.strictObject({ child_id: z.uuid() })

export async function GET(
  _request: Request,
  context: { params: Promise<{ child_id: string }> },
): Promise<Response> {
  const 읽음 = 경로.safeParse(await context.params)
  if (!읽음.success) return 못찾음()

  try {
    const 문 = await 아이_문지기(읽음.data.child_id)
    if (문.kind === '로그인없음') return 로그인필요()
    if (문.kind === '못찾음') return 못찾음()

    return ok(await listChildReports({ child_id: 문.child_id }))
  } catch (오류) {
    return failed(오류)
  }
}
