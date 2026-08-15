// 다시 만들기 — `POST /api/reports/{session_id}/regenerate` (명세 7절 · 결정 R19).
//
// 🔴 **성공과 실패가 HTTP 상태로 갈린다.** 화면(#39)은 본문을 안 읽고 상태만 보고 리포트를
//    다시 조회한다. 그래서 한도에 걸린 것을 200 에 담아 보내면 화면이 실패를 못 알아챈다.
//
//    | 언제 | 상태 |
//    |---|---|
//    | 다시 만들어 저장했다 | `200` + `ParentReport` |
//    | 한도(`regenerated >= 설정값`)에 닿았다 | `429` |
//    | 내 아이가 아니다 · 그런 활동이 없다 · 아직 리포트가 없다 | `404` |
//
// ⚠️ LLM 이 둘 다 실패해도 **200 이다.** 그때는 `status='metrics_only'` 로 숫자가 담긴
//    리포트가 저장되고(R18), 화면은 그것을 안내 문구와 함께 정상 경로로 그린다.
//    「다시 만들기가 실패했다」가 아니라 「이번에도 문장이 안 나왔다」이기 때문이다.

import { z } from 'zod'

import { regenerateReport, RegenerateLimit } from '@/report/service/reports'

import { failed, ok, 로그인필요, 못찾음, 한도초과 } from './envelope'
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

    const 다시 = await regenerateReport({ session_id: 읽음.data.session_id })
    return 다시 === null ? 못찾음() : ok(다시)
  } catch (오류) {
    if (오류 instanceof RegenerateLimit) return 한도초과(오류.message)
    return failed(오류)
  }
}
