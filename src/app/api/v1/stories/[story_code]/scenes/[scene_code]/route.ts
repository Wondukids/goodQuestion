// ④ 장면 조회 — `GET /api/v1/stories/{story_code}/scenes/{scene_code}`
// (`docs/설계/라우트계약.md` 6절).
//
// 세션과 무관한 **콘텐츠 조회**라 `session_id` 를 받지 않는다. `meta` 도 없다 (LLM 을 안 부른다).
//
// ⚠️ 경로가 두 토막인 것은 스키마가 `UNIQUE (story_id, code)` 이기 때문이다 —
//    씬 코드 하나만으로는 전역에서 유일하지 않다.
//
// ⚠️ **Next 16 에서 `context.params` 는 프라미스다** (`node_modules/next/dist/docs/01-app/
//    03-api-reference/03-file-conventions/route.md` — v15.0.0-RC 부터). `await` 없이 꺼내면
//    `undefined` 가 나가고 조용히 404 가 된다.

import { z } from 'zod'

import { sceneView } from '@/lib/service/step'

import { badRequest, failed, ok, zodMessage } from '../../../../../_lib/envelope'

const 경로 = z.strictObject({
  // `stories.code` (예 `s_banggui_daughter_in_law_001`)
  story_code: z.string().min(1),
  // `story_scenes.code` (예 `sc_banggui_03`)
  scene_code: z.string().min(1),
})

export async function GET(
  _request: Request,
  context: { params: Promise<{ story_code: string; scene_code: string }> },
): Promise<Response> {
  const 읽음 = 경로.safeParse(await context.params)
  if (!읽음.success) return badRequest(zodMessage(읽음.error))

  try {
    const { data, meta } = await sceneView(읽음.data)
    return ok(data, meta)
  } catch (오류) {
    return failed(오류)
  }
}
