// 세션 조회 — `GET /api/sessions/{session_id}` (`docs/이야기_세션_명세.md` 4.2절 · 이슈 #6).
//
// **상태를 바꾸지 않는다** — 홈 「이어서 보기」 카드의 진행률 표시용이다. 플레이 진입은
// 4.1(`POST /api/sessions`)이 맡는다. 남의 아이 세션은 404 다 — 있다는 사실도 안 새게,
// 소유 대조는 서비스 층(`viewSession()`)이 한다.
//
// ⚠️ **Next 16 에서 `context.params` 는 프라미스다** (`turn-resume.ts` 와 같은 함정).

import { z } from 'zod'

import { getSelectedChild } from '@/lib/selected-child'
import { viewSession } from '@/session/service/open'

import { fail, failed, ok } from './envelope'

const 경로 = z.strictObject({ session_id: z.uuid() })

export async function GET(
  _request: Request,
  context: { params: Promise<{ session_id: string }> },
): Promise<Response> {
  const 아이 = await getSelectedChild()
  if (아이 === null) {
    return fail(401, {
      code: 'CHILD_NOT_SELECTED',
      message: '고른 아이가 없다 — 아이를 고른 뒤 다시 조회해라',
      retryable: false,
    })
  }

  const 읽음 = 경로.safeParse(await context.params)
  if (!읽음.success) {
    // uuid 가 아니면 그런 세션은 없다 — 명세 표에 400 칸이 없어 404 로 간다 (turn-resume 과 같다).
    return fail(404, {
      code: 'SESSION_NOT_FOUND',
      message: '세션 id 가 uuid 가 아니다',
      retryable: false,
    })
  }

  try {
    return ok(await viewSession({ session_id: 읽음.data.session_id, child_id: 아이.id }))
  } catch (오류) {
    return failed(오류)
  }
}
