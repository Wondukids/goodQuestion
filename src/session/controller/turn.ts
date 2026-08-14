// 아이 앱 턴 — `POST /api/sessions/{session_id}/turns` (`docs/이야기_세션_명세.md` 4.3절 · 이슈 #7).
//
// **요청 body 는 녹음 오디오 바이너리다** (`application/octet-stream` + `X-Audio-Channels`
// 헤더 — 기존 `/api/fart-bride/stt` 라우트와 같은 방식). 받아쓰기(STT)는 HTTP 경계인
// 여기서 끝내고, 서비스 층에는 확정 텍스트만 내려보낸다.
//
// ⚠️ **Next 16 에서 `context.params` 는 프라미스다** (`turn-resume.ts` 와 같은 함정).
//
// `client_turn_id` 중복 방지는 스키마 이슈 #5 몫이라 여기 없다 — #5 가 착지하면 붙는다.

import { z } from 'zod'

import { runSessionTurn } from '@/session/service/turn'
import { recognizeSpeech, SttError } from '@/stt/server'

import { fail, failed, ok } from './envelope'

const 경로 = z.strictObject({ session_id: z.uuid() })

export async function POST(
  request: Request,
  context: { params: Promise<{ session_id: string }> },
): Promise<Response> {
  const 읽음 = 경로.safeParse(await context.params)
  if (!읽음.success) {
    // uuid 가 아니면 그런 세션은 없다 — 계약 표에 400 칸이 없어 404 로 간다 (resume 과 같다).
    return fail(404, {
      code: 'SESSION_NOT_FOUND',
      message: '세션 id 가 uuid 가 아니다',
      retryable: false,
    })
  }

  const 오디오 = Buffer.from(await request.arrayBuffer())
  if (오디오.length === 0) {
    // 녹음이 아예 안 실렸다 — 무음(빈 발화)과 다르다. 무음은 STT 를 거쳐 `empty` 로 나간다.
    return fail(400, { code: 'BAD_REQUEST', message: '녹음 데이터가 비어 있다', retryable: false })
  }
  // 마이크가 스테레오면 opus 헤더와 config 채널 수가 어긋난다 — 기존 STT 라우트와 같은 손잡이.
  const 채널 = Number(request.headers.get('x-audio-channels')) || 1

  let 발화: string
  try {
    // 무음이면 "" — 서비스가 `{ empty: true }` 로 돌려 앱이 재시도 연출을 한다.
    발화 = await recognizeSpeech(오디오, 채널)
  } catch (오류) {
    if (오류 instanceof SttError) {
      // 저장 상태는 아무것도 안 변했다 — 같은 녹음을 다시 보내면 된다.
      return fail(502, { code: 'STT_UNAVAILABLE', message: 오류.message, retryable: true })
    }
    throw 오류
  }

  try {
    return ok(await runSessionTurn({ session_id: 읽음.data.session_id, utterance: 발화 }))
  } catch (오류) {
    return failed(오류)
  }
}
