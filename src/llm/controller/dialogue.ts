// ③ 대사 — `POST /api/v1/dialogue` (`docs/설계/라우트계약.md` 5절).
//
// 🔴 **모드·반응 키를 요청에 두는 것이 이 레포의 존재 이유다** (계약 1절 「메아리를 살려 두는
// 이유」). DB 에서만 읽으면 관리자 화면이 모드를 바꿔 ③ 만 다시 돌리는 일을 못 한다.
//
// ⛔ **CLOSING 갈림은 여기 없다.** 캐릭터 LLM 을 부를지 마는지는 `characterTurn()` 하나가
//    가른다 (`CLAUDE.md` 경계 4). 그래서 이 파일에 `'CLOSING'` 은 zod enum 의 한 값일 뿐이다.

import { z } from 'zod'

import { dialogueStep } from '@/llm/service/step'

import { badRequest, failed, ok, zodMessage } from './envelope'

const 요청 = z.strictObject({
  session_id: z.uuid(),
  // ① 이 준 아이 메시지. 발화와 지난 말을 여기서 찾는다.
  message_id: z.uuid(),
  response_mode: z.enum(['NORMAL', 'GUIDED', 'CLOSING']),
  // ② 응답에서 그대로. 값이 camelCase 인 것은 원문이 그렇기 때문이다 (계약 2절).
  reaction_key: z.string().default(''),
  guidance_target: z.string().nullable(),
  // ① 응답에서 그대로.
  main_point: z.string().nullable(),
  // ⚠️ 계약에는 있는데 **아직 갈 곳이 없다.** `buildCharacterMaterial()` 에 이름을 넣는
  //    자리가 없어 지금은 받기만 하고 프롬프트에 흘리지 않는다. 저장하지도 않는다.
  child_name: z.string().nullable().optional(),
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
    const { data, meta } = await dialogueStep(읽음.data)
    return ok(data, meta)
  } catch (오류) {
    return failed(오류)
  }
}
