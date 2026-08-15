// 리포트 한 장 — `GET /api/reports/{session_id}` (명세 7절 · 프론트 계약 3절).
//
// 순서 셋뿐이다: 경로를 읽고 · 문지기를 지나고 · 서비스 하나를 불러 봉투에 싼다.
//
// ⚠️ **Next 16 에서 `context.params` 는 프라미스다** (`src/session/controller/turn.ts` 와 같은 함정).

import { z } from 'zod'

import { readParentReport } from '@/report/service/reports'

import { failed, ok, 로그인필요, 못찾음 } from './envelope'
import { 세션_문지기 } from './guard'

const 경로 = z.strictObject({ session_id: z.uuid() })

export async function GET(
  _request: Request,
  context: { params: Promise<{ session_id: string }> },
): Promise<Response> {
  // uuid 가 아니면 그런 활동은 없다 — 문지기와 **같은 404** 로 나간다 (모양을 안 알린다).
  const 읽음 = 경로.safeParse(await context.params)
  if (!읽음.success) return 못찾음()

  try {
    const 문 = await 세션_문지기(읽음.data.session_id)
    if (문.kind === '로그인없음') return 로그인필요()
    if (문.kind === '못찾음') return 못찾음()

    const 리포트 = await readParentReport({ session_id: 읽음.data.session_id })
    // 활동은 내 아이 것이 맞는데 아직 리포트가 없다 (생성이 실패했거나 도는 중이다).
    return 리포트 === null ? 못찾음() : ok(리포트)
  } catch (오류) {
    return failed(오류)
  }
}
