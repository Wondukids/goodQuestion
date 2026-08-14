// ① 분석 — `POST /api/v1/analysis` (`docs/설계/라우트계약.md` 3절).
//
// ⛔ **세 가지만 한다** — zod 로 읽고 · `analysisStep()` 을 부르고 · 봉투를 씌운다
//    (`docs/설계/코드구조.md` 2절). 장면을 고르는 것도, `decide()` 를 부르는 것도 여기가 아니다.

import { z } from 'zod'

import { analysisStep } from '@/llm/service/step'

import { badRequest, failed, ok, zodMessage } from './envelope'

const 요청 = z.strictObject({
  // 장면은 `story_sessions.current_scene_id` 가 정한다. **씬 키를 받지 않는다.**
  session_id: z.uuid(),
  // ⚠️ **STT 결과 그대로 다듬지 않는다.** `trim()` 으로 값을 바꾸면 저장되는 문장이 달라진다.
  //    공백뿐인지만 본다 — 파이썬 `runner.유효한_발화()` 와 같은 규칙이다.
  child_utterance: z.string().refine((글) => 글.trim().length > 0, '발화가 비어 있다'),
})

export async function POST(request: Request): Promise<Response> {
  let 본문: unknown
  try {
    본문 = await request.json()
  } catch {
    return badRequest('JSON 본문을 읽지 못했다')
  }

  const 읽음 = 요청.safeParse(본문)
  if (!읽음.success) return badRequest(zodMessage(읽음.error))

  try {
    const { data, meta } = await analysisStep(읽음.data)
    return ok(data, meta)
  } catch (오류) {
    return failed(오류)
  }
}
