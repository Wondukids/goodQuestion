// 미션 API 셋 — `POST /api/sessions/{sid}/missions/{msid}/{events|turns|complete}`
// (`docs/미션_명세.md` 7절 B·C·D · 이슈 #19).
//
// 경로·봉투(`{ok,data}`)·오디오 방식은 세션 계약을 **그대로** 쓴다 (명세 7절 서두).
// 그래서 이 파일은 `turn.ts`(턴)·`skip.ts`(건너뛰기)와 같은 모양이다 — 다른 것은 경로
// 조각이 하나 더 있다는 것뿐이다.
//
// ⚠️ **Next 16 에서 `context.params` 는 프라미스다** (`turn.ts` 와 같은 함정).
//
// ## 아이 확인이 없는 이유
//
// 턴 API 와 같다 — 열쇠는 추측할 수 없는 `session_id` 다. 아이 확인(쿠키)은 세션을 여는
// 자리에서 한 번 하고, 그 뒤로 세션 id 를 쥔 쪽이 그 세션의 주인이다. 남의 `mission_session_id`
// 를 끼워 넣는 것은 서비스 층이 막는다 (`readMissionAttempt()` — 다른 세션의 시도면 404).

import { z } from 'zod'

import { runMissionComplete, runMissionEvent, runMissionTurn } from '@/session/service/mission'
import { recognizeSpeech, SttError } from '@/stt/server'

import { fail, failed, ok } from './envelope'

const 경로 = z.strictObject({ session_id: z.uuid(), mission_session_id: z.uuid() })

/** 명세 7절 B 의 요청 — `value` 는 소품·친구 id 또는 `'yes'`/`'no'`. `skip` 은 값이 없다. */
const 이벤트_본문 = z.strictObject({
  type: z.enum(['prop_select', 'friend_select', 'more', 'skip']),
  value: z.string().min(1).optional(),
})

type 경로값 = { session_id: string; mission_session_id: string }

/** 경로 둘을 읽는다. uuid 가 아니면 그런 것은 없다 — 계약 표에 400 칸이 없어 404 다. */
function 경로를_읽는다(값: unknown): { ok: true; data: 경로값 } | { ok: false; res: Response } {
  const 읽음 = 경로.safeParse(값)
  if (읽음.success) return { ok: true, data: 읽음.data }
  return {
    ok: false,
    res: fail(404, {
      code: 'SESSION_NOT_FOUND',
      message: '세션 id 나 미션 시도 id 가 uuid 가 아니다',
      retryable: false,
    }),
  }
}

// ── B. 선택 이벤트 ─────────────────────────────────────────────────────────

export async function POST_events(
  request: Request,
  context: { params: Promise<경로값> },
): Promise<Response> {
  const 읽음 = 경로를_읽는다(await context.params)
  if (!읽음.ok) return 읽음.res

  const 본문 = 이벤트_본문.safeParse(await request.json().catch(() => null))
  if (!본문.success) {
    return fail(400, {
      code: 'BAD_REQUEST',
      message: '요청 body 는 { type: prop_select|friend_select|more|skip, value?: string } 이어야 한다',
      retryable: false,
    })
  }

  try {
    return ok(
      await runMissionEvent({
        ...읽음.data,
        type: 본문.data.type,
        value: 본문.data.value ?? null,
      }),
    )
  } catch (오류) {
    return failed(오류)
  }
}

// ── C. 미션 턴 ─────────────────────────────────────────────────────────────

/**
 * 요청 body 는 **녹음 오디오 바이너리**다 (`application/octet-stream` + `X-Audio-Channels`) —
 * 턴 API 와 한 글자도 다르지 않다. 받아쓰기는 여기서 끝내고 서비스에는 확정 텍스트만 준다.
 */
export async function POST_turns(
  request: Request,
  context: { params: Promise<경로값> },
): Promise<Response> {
  const 읽음 = 경로를_읽는다(await context.params)
  if (!읽음.ok) return 읽음.res

  const 오디오 = Buffer.from(await request.arrayBuffer())
  if (오디오.length === 0) {
    // 녹음이 아예 안 실렸다 — 무음(빈 발화)과 다르다. 무음은 STT 를 거쳐 `empty` 로 나간다.
    return fail(400, { code: 'BAD_REQUEST', message: '녹음 데이터가 비어 있다', retryable: false })
  }
  const 채널 = Number(request.headers.get('x-audio-channels')) || 1

  let 발화: string
  try {
    발화 = await recognizeSpeech(오디오, 채널)
  } catch (오류) {
    if (오류 instanceof SttError) {
      // 저장 상태는 아무것도 안 변했다 — 같은 녹음을 다시 보내면 된다.
      return fail(502, { code: 'STT_UNAVAILABLE', message: 오류.message, retryable: true })
    }
    throw 오류
  }

  try {
    return ok(await runMissionTurn({ ...읽음.data, utterance: 발화 }))
  } catch (오류) {
    return failed(오류)
  }
}

// ── D. 종료 요약 ───────────────────────────────────────────────────────────

/** **body 가 없다.** 반복 안전이라 앱은 같은 요청을 다시 보내도 된다 (명세 7절 D). */
export async function POST_complete(
  _request: Request,
  context: { params: Promise<경로값> },
): Promise<Response> {
  const 읽음 = 경로를_읽는다(await context.params)
  if (!읽음.ok) return 읽음.res

  try {
    return ok(await runMissionComplete(읽음.data))
  } catch (오류) {
    return failed(오류)
  }
}
