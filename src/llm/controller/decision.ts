// ② 판단 — `POST /api/v1/decision` (`docs/설계/라우트계약.md` 4절).
//
// **LLM 이 아니다.** `decide()` 순수 함수 한 번이고, 그 함수는 서비스 층 아래에 있다.
// ⛔ 라우트는 그 답을 계산하지도, 손보지도 않는다 — `meta` 도 안 실린다.

import { z } from 'zod'

import { decisionStep } from '@/llm/service/step'

import { badRequest, failed, ok, zodMessage } from './envelope'

const 요청 = z.strictObject({
  session_id: z.uuid(),
  // ① 이 준 값. **세 호출이 같은 턴을 가리킨다는 증거다.**
  message_id: z.uuid(),
  analysis: z.strictObject({
    // ⚠️ `child_intent`·`utterance_validity` 는 **닫지 않는다** — 원문이 "등"으로 열어 뒀다
    //    (`sql/001_schema.sql` 주석 · 계약 4절).
    child_intent: z.string(),
    // ⚠️ ① 의 `detected_elements_kept` 를 넣는다. **후처리 전 원본이 아니다** (계약 4절).
    detected_elements: z.array(z.string()),
    utterance_validity: z.string(),
  }),
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
    const { data, meta } = await decisionStep(읽음.data)
    return ok(data, meta)
  } catch (오류) {
    return failed(오류)
  }
}
