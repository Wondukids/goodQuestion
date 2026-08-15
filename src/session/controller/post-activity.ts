// 말하기 후 활동 API 넷 — `GET /api/sessions/{sid}/post-activity` 와
// `POST …/{order|retelling|complete}` (`docs/말하기후활동_명세.md` 5절 A~D · 이슈 #45).
//
// 경로·봉투(`{ok,data}`)·오디오 방식은 세션 계약을 **그대로** 쓴다. 그래서 이 파일은
// `turn.ts`(턴)·`missions.ts`(미션)와 같은 모양이다.
//
// ⚠️ **Next 16 에서 `context.params` 는 프라미스다** (`turn.ts` 와 같은 함정).
//
// ## 🔴 명세와 어긋나는 자리 둘 — **앱 갈래(#46)가 이대로 받아야 한다**
//
// 1. **녹음은 `multipart/form-data` 가 아니다.** 명세 5.C 는 그렇게 적었지만 뜻은
//    「대화 턴 API 와 같은 모양」이고, 실제 턴 API(`turn.ts:34`)는 **녹음을 본문에 그대로
//    싣고 채널 수를 `x-audio-channels` 헤더**로 받는다. 실제 관례를 따랐다.
// 2. **STT 실패 코드는 `STT_FAILED`(502)다.** 기존 턴·미션 API 는 같은 자리에
//    `STT_UNAVAILABLE` 을 쓰는데, 명세 5.E 가 이 API 에는 `STT_FAILED` 를 적었다.
//    명세를 따랐다 — 둘 다 `retryable: true` 라 앱이 하는 일은 같다.
//
// ## 아이 확인이 없는 이유
//
// 턴·미션 API 와 같다 — 열쇠는 추측할 수 없는 `session_id` 다. 아이 확인(쿠키)은 세션을
// 여는 자리에서 한 번 하고, 그 뒤로 세션 id 를 쥔 쪽이 그 세션의 주인이다.

import { z } from 'zod'

import {
  completePostActivity,
  openPostActivity,
  submitPostActivityOrder,
  submitPostActivityRetelling,
} from '@/session/service/post-activity'
import { recognizeSpeech, SttError } from '@/stt/server'

import { fail, failed, ok } from './envelope'

const 경로 = z.strictObject({ session_id: z.uuid() })

/** 명세 5.B 의 요청. `is_correct` 는 **안 받는다** — 판정은 서버가 한다. */
const 순서_본문 = z.strictObject({ submitted_order: z.array(z.string().min(1)).min(1) })

/** 명세 5.D 의 요청. */
const 종료_본문 = z.strictObject({ reason: z.enum(['finished', 'left']) })

type 경로값 = { session_id: string }

/** 경로를 읽는다. uuid 가 아니면 그런 세션은 없다 — 계약 표에 400 칸이 없어 404 다. */
function 경로를_읽는다(값: unknown): { ok: true; session_id: string } | { ok: false; res: Response } {
  const 읽음 = 경로.safeParse(값)
  if (읽음.success) return { ok: true, session_id: 읽음.data.session_id }
  return {
    ok: false,
    res: fail(404, {
      code: 'SESSION_NOT_FOUND',
      message: '세션 id 가 uuid 가 아니다',
      retryable: false,
    }),
  }
}

// ── A. 활동 열기 ───────────────────────────────────────────────────────────

/** **body 가 없다.** 카드·정답 순서와 지금까지의 결과를 함께 준다 (명세 5.A). */
export async function GET(
  _request: Request,
  context: { params: Promise<경로값> },
): Promise<Response> {
  const 읽음 = 경로를_읽는다(await context.params)
  if (!읽음.ok) return 읽음.res

  try {
    return ok(await openPostActivity({ session_id: 읽음.session_id }))
  } catch (오류) {
    return failed(오류)
  }
}

// ── B. 순서 제출 ───────────────────────────────────────────────────────────

/** 「다 놓았어요!」를 누를 때마다 온다. 🔴 앱이 보낸 판정은 받지 않는다 (명세 5.B). */
export async function POST_order(
  request: Request,
  context: { params: Promise<경로값> },
): Promise<Response> {
  const 읽음 = 경로를_읽는다(await context.params)
  if (!읽음.ok) return 읽음.res

  const 본문 = 순서_본문.safeParse(await request.json().catch(() => null))
  if (!본문.success) {
    return fail(400, {
      code: 'BAD_REQUEST',
      message: '요청 body 는 { submitted_order: string[] } 이어야 한다',
      retryable: false,
    })
  }

  try {
    return ok(
      await submitPostActivityOrder({
        session_id: 읽음.session_id,
        submitted_order: 본문.data.submitted_order,
      }),
    )
  } catch (오류) {
    return failed(오류)
  }
}

// ── C. 녹음 보내기 ─────────────────────────────────────────────────────────

/**
 * 요청 body 는 **녹음 오디오 바이너리**다 (`application/octet-stream` + `X-Audio-Channels`) —
 * 턴 API 와 한 글자도 다르지 않다 (이 파일 머리말 1). 받아쓰기는 여기서 끝내고 서비스에는
 * 확정 텍스트만 준다.
 *
 * 🔴 **받아쓰기가 실패하면 아무것도 안 변한 상태다** — 같은 녹음을 다시 보내면 된다.
 *    LLM 판정 실패는 이 길로 오지 않는다. 그건 오류가 아니라 200 이다 (F4·F8).
 */
export async function POST_retelling(
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
  // 마이크가 스테레오면 opus 헤더와 config 채널 수가 어긋난다 — 턴 API 와 같은 손잡이.
  const 채널 = Number(request.headers.get('x-audio-channels')) || 1

  let 줄거리: string
  try {
    // 무음이면 "" — 서비스가 `{ empty: true }` 로 돌려 앱이 재시도 연출을 한다.
    줄거리 = await recognizeSpeech(오디오, 채널)
  } catch (오류) {
    if (오류 instanceof SttError) {
      // 🔴 명세 5.E 의 이름이다 — 턴 API 의 `STT_UNAVAILABLE` 과 다르다 (이 파일 머리말 2).
      return fail(502, { code: 'STT_FAILED', message: 오류.message, retryable: true })
    }
    throw 오류
  }

  try {
    return ok(await submitPostActivityRetelling({ session_id: 읽음.session_id, retelling: 줄거리 }))
  } catch (오류) {
    return failed(오류)
  }
}

// ── D. 활동 종료 ───────────────────────────────────────────────────────────

/** ⭐ 리포트를 띄우는 자리다 (F11). **반복 안전**이라 앱은 같은 요청을 또 보내도 된다. */
export async function POST_complete(
  request: Request,
  context: { params: Promise<경로값> },
): Promise<Response> {
  const 읽음 = 경로를_읽는다(await context.params)
  if (!읽음.ok) return 읽음.res

  const 본문 = 종료_본문.safeParse(await request.json().catch(() => null))
  if (!본문.success) {
    return fail(400, {
      code: 'BAD_REQUEST',
      message: "요청 body 는 { reason: 'finished' | 'left' } 이어야 한다",
      retryable: false,
    })
  }

  try {
    return ok(
      await completePostActivity({ session_id: 읽음.session_id, reason: 본문.data.reason }),
    )
  } catch (오류) {
    return failed(오류)
  }
}
