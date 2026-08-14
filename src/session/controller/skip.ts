// 대화 씬 건너뛰기 — `POST /api/sessions/{session_id}/scenes/{scene_code}/skip`.
//
// ⚠️ **Next 16 에서 `context.params` 는 프라미스다** (`turn.ts` · `turn-resume.ts` 와 같은 함정).
//
// ## 아이 확인이 없는 이유
//
// 턴 API 와 같다 — 열쇠는 추측할 수 없는 `session_id` 다. 아이 확인(쿠키)은 **세션을 여는
// 자리**(`sessions.ts`)에서 한 번 하고, 그 뒤로 세션 id 를 쥔 쪽이 그 세션의 주인이다.
// 여기만 다르게 하면 같은 계약 안에서 규칙이 둘이 된다.

import { z } from 'zod'

import { skipScene } from '@/session/service/skip'

import { fail, failed, ok } from './envelope'

const 경로 = z.strictObject({
  session_id: z.uuid(),
  scene_code: z.string().min(1),
})

export async function POST(
  request: Request,
  context: { params: Promise<{ session_id: string; scene_code: string }> },
): Promise<Response> {
  const 읽음 = 경로.safeParse(await context.params)
  if (!읽음.success) {
    // uuid 가 아니면 그런 세션은 없다 — 계약 표에 400 칸이 없어 404 로 간다 (턴 API 와 같다).
    return fail(404, {
      code: 'SESSION_NOT_FOUND',
      message: '세션 id 가 uuid 가 아니다',
      retryable: false,
    })
  }

  try {
    return ok(
      await skipScene({
        session_id: 읽음.data.session_id,
        scene_code: 읽음.data.scene_code,
      }),
    )
  } catch (오류) {
    return failed(오류)
  }
}
