// 읽음 표시 — `POST /api/reports/{session_id}/read` (명세 7절 · 3.2 빨간 점).
//
// 응답은 **204**(본문 없음)다. 두 번 눌러도 처음 연 시각이 안 밀린다 (`markReportRead()`).

import { z } from 'zod'

import { markRead } from '@/report/service/reports'

import { failed, 내용없음, 로그인필요, 못찾음 } from './envelope'
import { 세션_문지기 } from './guard'

const 경로 = z.strictObject({ session_id: z.uuid() })

export async function POST(
  _request: Request,
  context: { params: Promise<{ session_id: string }> },
): Promise<Response> {
  const 읽음 = 경로.safeParse(await context.params)
  if (!읽음.success) return 못찾음()

  try {
    const 문 = await 세션_문지기(읽음.data.session_id)
    if (문.kind === '로그인없음') return 로그인필요()
    if (문.kind === '못찾음') return 못찾음()

    const 찍었나 = await markRead({ session_id: 읽음.data.session_id })
    return 찍었나 ? 내용없음() : 못찾음()
  } catch (오류) {
    return failed(오류)
  }
}
