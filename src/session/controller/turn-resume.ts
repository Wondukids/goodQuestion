// 끊긴 턴 이어하기 — `POST /api/sessions/{session_id}/turns/resume`
// (`docs/대화턴_이어하기_명세.md` 4.2절 · 이슈 #2).
//
// **요청 body 가 없다.** 오디오를 다시 받지 않는다 — 발화는 저장된 그 문장이고, 무엇을 이어
// 돌릴지는 서버가 저장된 사실로 판정한다 (명세 3절). 그래서 body 는 읽지도 않는다.
//
// ⚠️ **Next 16 에서 `context.params` 는 프라미스다** (`@/llm/controller/scene` 과 같은 함정).

import { z } from 'zod'

import { resumeSessionTurn } from '@/session/service/turn-resume'

import { fail, failed, ok } from './envelope'

const 경로 = z.strictObject({ session_id: z.uuid() })

export async function POST(
  _request: Request,
  context: { params: Promise<{ session_id: string }> },
): Promise<Response> {
  const 읽음 = 경로.safeParse(await context.params)
  if (!읽음.success) {
    // uuid 가 아니면 그런 세션은 없다 — 명세 4.2절 표에 400 칸이 없어 404 로 간다.
    return fail(404, {
      code: 'SESSION_NOT_FOUND',
      message: '세션 id 가 uuid 가 아니다',
      retryable: false,
    })
  }

  try {
    return ok(await resumeSessionTurn(읽음.data))
  } catch (오류) {
    return failed(오류)
  }
}
