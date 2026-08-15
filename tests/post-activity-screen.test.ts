// 말하기 후 활동 · 앱 배선 (이슈 #46) — 화면이 서버 값으로 그려지는가, 요청이 계약 모양인가.
//
// 재는 것 둘:
//
//   1. **어댑터** `finale-config.ts` — 서버 `post_activity_config` → 화면이 그릴 장면들.
//      순수 함수라 붙일 서버도 마이크도 없이 잰다 (`tests/report-screen.test.ts` 와 같은 결).
//   2. **요청 모양** `session-api.ts` 의 후활동 API 넷 — `fetch` 를 가짜로 끼우고
//      **무엇을 어떻게 보내는지**만 본다. 서버 동작은 `tests/post-activity-api.test.ts` 몫이다.
//
// 🔴 2 를 재는 값이 여기 있다. 명세 5.C 는 녹음을 `multipart/form-data` 로 적었지만 **실제
//    서버는 그렇게 안 받는다** — 턴 API 그대로 `application/octet-stream` + `X-Audio-Channels`
//    다 (`src/session/controller/post-activity.ts` 머리말). 글로만 남기면 다음 사람이 명세를
//    믿고 고쳤다가 아이 목소리가 통째로 사라진다. 그래서 검사로 못박는다.
//
// ⛔ 미션 1·2 와는 아무 관계가 없다 (명세 3절). 그쪽은 `tests/mission-api.test.ts` 다.

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  resumeFrom,
  toScenes,
  toTrayOrder,
} from '@/stories/fart-bride/minigame/finale-config'
import { SCENES, TRAY_ORDER } from '@/stories/fart-bride/minigame/finale-script'
import {
  beaconPostActivityComplete,
  completePostActivity,
  fetchPostActivity,
  fetchPostActivityWhenReady,
  openPostActivityClosingStory,
  SessionApiError,
  submitPostActivityOrder,
  submitPostActivityRetelling,
  type PostActivityConfig,
  type PostActivityResult,
} from '@/stories/fart-bride/session-api'

// ── 재료 ───────────────────────────────────────────────────────────────────

/** DB(sql/007)에 든 값과 같은 모양 — 화면 상수에서 떠서 만든다 (명세 4.1). */
function 서버config(): PostActivityConfig {
  return {
    cards: SCENES.map((장) => ({ id: 장.id, title: 장.title, keywords: [...장.keywords] })),
    answer_order: SCENES.map((장) => 장.id),
    tray_order: [...TRAY_ORDER],
  }
}

/** 아직 아무것도 안 한 아이의 `result` (명세 5.A). */
const 빈결과: PostActivityResult = {
  submitted_order: null,
  is_order_correct: null,
  attempt_count: 0,
  retelling_text: null,
  completed_at: null,
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. 카드는 서버 값으로 그린다 (F1 · 수용 기준 2)
// ═══════════════════════════════════════════════════════════════════════════

describe('toScenes — 제목·핵심 단어는 DB 값, 그림·칩 색은 앱 값', () => {
  it('서버 config 를 그대로 그린다 — 상수와 값이 같아도 온 길이 다르다', () => {
    const 장면 = toScenes(서버config())

    expect(장면.map((장) => 장.title)).toEqual(SCENES.map((장) => 장.title))
    expect(장면.map((장) => 장.keywords)).toEqual(SCENES.map((장) => 장.keywords))
  })

  it('⭐ `post_activity_config` 를 고치면 화면이 바뀐다 (수용 기준 2)', () => {
    const 고친것 = 서버config()
    고친것.cards[0].title = '새로 지은 제목'
    고친것.cards[0].keywords = ['하나', '둘', '셋']

    const [처음] = toScenes(고친것)

    expect(처음.title).toBe('새로 지은 제목')
    expect(처음.keywords).toEqual(['하나', '둘', '셋'])
    // 상수는 그대로다 — 화면이 상수를 본 것이 아니다
    expect(SCENES[0].title).not.toBe('새로 지은 제목')
  })

  it('그림·칩 색은 DB 에 없다 — id 로 앱 자산을 잇는다 (명세 4.1)', () => {
    const [처음] = toScenes(서버config())

    expect(처음.image).toBe(SCENES[0].image)
    expect(처음.chip).toBe(SCENES[0].chip)
  })

  it('🔴 `answer_order` 가 정본이다 — `cards` 차례와 갈리면 그쪽을 따른다', () => {
    const 뒤집힌 = 서버config()
    뒤집힌.answer_order = [...뒤집힌.answer_order].reverse()

    expect(toScenes(뒤집힌).map((장) => 장.id)).toEqual(
      [...SCENES].reverse().map((장) => 장.id),
    )
  })

  it('그 목록이 성기면 `cards` 차례로 돈다 — 카드가 통째로 사라지는 것보다 낫다', () => {
    const 모르는id = 서버config()
    모르는id.answer_order = ['endure', 'burst', 'pear', '없는카드']
    expect(toScenes(모르는id).map((장) => 장.id)).toEqual(SCENES.map((장) => 장.id))

    const 중복 = 서버config()
    중복.answer_order = ['endure', 'endure', 'burst', 'pear']
    expect(toScenes(중복).map((장) => 장.id)).toEqual(SCENES.map((장) => 장.id))
  })

  it('모르는 id 의 카드도 그려진다 — 자산을 자리 순서로 빌린다', () => {
    const 새이야기: PostActivityConfig = {
      cards: [
        { id: 'a', title: '가', keywords: ['ㄱ'] },
        { id: 'b', title: '나', keywords: ['ㄴ'] },
      ],
      answer_order: ['a', 'b'],
      tray_order: ['b', 'a'],
    }

    const 장면 = toScenes(새이야기)

    expect(장면.map((장) => 장.title)).toEqual(['가', '나'])
    // 그림이 비면 회색 카드가 된다 — 자리 순서로라도 채운다
    expect(장면[0].image).toBe(SCENES[0].image)
    expect(장면[1].image).toBe(SCENES[1].image)
  })

  it('서버가 안 열렸으면 화면 상수로 그린다 — 비상용이라 지우지 않았다 (명세 8절 4)', () => {
    expect(toScenes(null)).toEqual(SCENES)

    const 빈카드 = 서버config()
    빈카드.cards = []
    expect(toScenes(빈카드)).toEqual(SCENES)
  })
})

describe('toTrayOrder — 처음 깔리는 (섞인) 순서', () => {
  it('서버 `tray_order` 대로 깔린다', () => {
    const 장면 = toScenes(서버config())

    expect(toTrayOrder(서버config(), 장면)).toEqual(TRAY_ORDER)
  })

  it('🔴 빠진 카드는 뒤에 붙는다 — 트레이에 없으면 아이가 놓을 방법이 없다', () => {
    const 성긴것 = 서버config()
    성긴것.tray_order = ['pear', '없는카드', 'pear']

    const 트레이 = toTrayOrder(성긴것, toScenes(성긴것))

    expect(트레이[0]).toBe('pear')
    // 모르는 id 는 버리고 중복은 한 번만, 남은 셋이 뒤로 붙는다
    expect([...트레이].sort()).toEqual(SCENES.map((장) => 장.id).sort())
    expect(트레이).toHaveLength(4)
  })

  it('서버가 안 열렸으면 상수 순서다', () => {
    expect(toTrayOrder(null, SCENES)).toEqual(TRAY_ORDER)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. 나갔다 돌아온 아이의 자리 (명세 5.A 의 `result`)
// ═══════════════════════════════════════════════════════════════════════════

describe('resumeFrom — 하던 자리에서 잇는다 (명세 밖 판단 · 되돌려도 된다)', () => {
  it('아무것도 안 했으면 1단계다', () => {
    expect(resumeFrom(null)).toEqual({ step: 'order', retelling: null })
    expect(resumeFrom(빈결과)).toEqual({ step: 'order', retelling: null })
  })

  it('순서를 **끝내 맞췄으면** 2단계로 연다 — 이미 푼 문제를 다시 풀리지 않는다 (F18)', () => {
    expect(
      resumeFrom({ ...빈결과, submitted_order: ['pear'], is_order_correct: true, attempt_count: 3 }),
    ).toEqual({ step: 'tell', retelling: null })
  })

  it('여러 번 눌렀어도 못 맞췄으면 1단계다 — 횟수는 보지 않는다', () => {
    expect(
      resumeFrom({ ...빈결과, is_order_correct: false, attempt_count: 5 }),
    ).toEqual({ step: 'order', retelling: null })
  })

  it('줄거리를 이미 말했으면 그 글과 함께 2단계 끝자리로 연다', () => {
    expect(
      resumeFrom({ ...빈결과, is_order_correct: true, retelling_text: '며느리가 시집와서…' }),
    ).toEqual({ step: 'tell', retelling: '며느리가 시집와서…' })
  })

  it('공백뿐인 줄거리는 없는 것으로 친다 — 빈 따옴표만 뜬 화면을 열지 않는다', () => {
    expect(resumeFrom({ ...빈결과, retelling_text: '   ' })).toEqual({
      step: 'order',
      retelling: null,
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. 요청 모양 — 계약 5절 A~D 대로 보내는가
// ═══════════════════════════════════════════════════════════════════════════

type 부름 = { url: string; init?: RequestInit }

/** `fetch` 를 가짜로 끼우고 무엇을 보냈는지 받아 둔다. */
function fetch를_끼운다(응답: () => Response): 부름[] {
  const 보낸것: 부름[] = []
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    보낸것.push({ url, init })
    return 응답()
  })
  return 보낸것
}

const 성공 = (data: unknown, status = 200) =>
  new Response(JSON.stringify({ ok: true, data }), { status })

const 실패 = (status: number, code: string, retryable = false) =>
  new Response(JSON.stringify({ ok: false, error: { code, message: code, retryable } }), {
    status,
  })

afterEach(() => vi.unstubAllGlobals())

describe('API 넷 — 봉투와 경로 (명세 5절 A~D)', () => {
  it('A. 열기는 GET 이고 body 가 없다', async () => {
    const 보낸것 = fetch를_끼운다(() => 성공({ config: 서버config(), result: 빈결과 }))

    const 열림 = await fetchPostActivity('s-1')

    expect(보낸것[0].url).toBe('/api/sessions/s-1/post-activity')
    expect(보낸것[0].init).toBeUndefined()
    expect(열림.result.attempt_count).toBe(0)
  })

  it('🔴 A. 후활동이 없는 이야기는 404 코드가 그대로 올라온다 — 버튼을 안 그리는 신호다', async () => {
    fetch를_끼운다(() => 실패(404, 'POST_ACTIVITY_NOT_CONFIGURED'))

    await expect(fetchPostActivity('s-1')).rejects.toMatchObject({
      status: 404,
      code: 'POST_ACTIVITY_NOT_CONFIGURED',
    })
    await expect(fetchPostActivity('s-1')).rejects.toBeInstanceOf(SessionApiError)
  })

  it('B. 순서는 JSON `{ submitted_order }` 하나다 — 앱 판정은 **안 싣는다**', async () => {
    const 보낸것 = fetch를_끼운다(() => 성공({ is_correct: false, attempt_count: 1 }))

    await submitPostActivityOrder('s-1', ['pear', 'endure', 'burst', 'pride'])

    expect(보낸것[0].url).toBe('/api/sessions/s-1/post-activity/order')
    expect(보낸것[0].init?.method).toBe('POST')
    expect(JSON.parse(String(보낸것[0].init?.body))).toEqual({
      submitted_order: ['pear', 'endure', 'burst', 'pride'],
    })
  })

  it('🔴 C. 녹음은 multipart 가 **아니다** — octet-stream + X-Audio-Channels (턴 API 와 같다)', async () => {
    const 보낸것 = fetch를_끼운다(() => 성공({ text: '며느리가…', analyzed: true, keywords: [] }))
    const 녹음 = new Blob([new Uint8Array([1, 2, 3])])

    await submitPostActivityRetelling('s-1', 녹음, 2)

    const 헤더 = 보낸것[0].init?.headers as Record<string, string>
    expect(보낸것[0].url).toBe('/api/sessions/s-1/post-activity/retelling')
    expect(헤더['Content-Type']).toBe('application/octet-stream')
    expect(헤더['X-Audio-Channels']).toBe('2')
    // 녹음이 본문에 그대로 실린다 — FormData 로 감싸지 않는다
    expect(보낸것[0].init?.body).toBe(녹음)
  })

  it('C. 무음은 `{ empty: true }` 로 온다 — 오류가 아니다', async () => {
    fetch를_끼운다(() => 성공({ empty: true }))

    expect(await submitPostActivityRetelling('s-1', new Blob(['x']), 1)).toEqual({ empty: true })
  })

  it('🔴 C. 판정 실패는 **200** 이다 — 화면이 끝까지 가야 한다 (수용 기준 10)', async () => {
    fetch를_끼운다(() => 성공({ text: '며느리가…', analyzed: false, keywords: null }))

    const 결과 = await submitPostActivityRetelling('s-1', new Blob(['x']), 1)

    expect(결과.empty).toBeUndefined()
    expect(결과).toMatchObject({ analyzed: false, keywords: null, text: '며느리가…' })
  })

  it('C. 받아쓰기 실패(502 STT_FAILED)만 던진다 — 재시도 가능으로 온다', async () => {
    fetch를_끼운다(() => 실패(502, 'STT_FAILED', true))

    await expect(submitPostActivityRetelling('s-1', new Blob(['x']), 1)).rejects.toMatchObject({
      code: 'STT_FAILED',
      retryable: true,
    })
  })

  it('D. 종료는 JSON `{ reason }` — finished 와 left 둘뿐이다', async () => {
    const 보낸것 = fetch를_끼운다(() => 성공({ report: 'queued' }))

    expect(await completePostActivity('s-1', 'finished')).toEqual({ report: 'queued' })
    await completePostActivity('s-1', 'left')

    expect(보낸것[0].url).toBe('/api/sessions/s-1/post-activity/complete')
    expect(JSON.parse(String(보낸것[0].init?.body))).toEqual({ reason: 'finished' })
    expect(JSON.parse(String(보낸것[1].init?.body))).toEqual({ reason: 'left' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. 🔴 서버가 세션을 닫을 때까지 기다린다 (2026-08-15 · 실기에서 잡은 버그)
// ═══════════════════════════════════════════════════════════════════════════
//
// 앱이 말하는 「끝」(화면 조각을 다 넘겼다)과 서버가 말하는 「끝」(세션이 `completed`)이
// 다르다. 아이가 마지막 대화를 건너뛰면 앱은 건너뛰기를 보내 놓고 답을 안 기다리고
// 끝 화면으로 간다 — 그 요청이 서버에 닿기 전에 물으면 409 다. 한 번 묻고 마는 코드는
// 활동을 **영영** 못 열었고, 늦게 닿으면 열렸다. 그래서 「뜰 때도 있고 안 뜰 때도」였다.

describe('fetchPostActivityWhenReady — 아직 안 닫힌 세션을 기다린다', () => {
  /** 검사는 곁다리로 짧게 준다 — 진짜 상수(10초·600ms)로 돌면 검사가 그만큼 선다. */
  const 짧게 = { waitMs: 300, pollMs: 5 }

  it('409 를 두 번 내고 세 번째에 열리면 그 값을 돌려준다', async () => {
    let 회차 = 0
    const 보낸것 = fetch를_끼운다(() => {
      회차 += 1
      return 회차 < 3
        ? 실패(409, 'POST_ACTIVITY_NOT_ALLOWED', true)
        : 성공({ config: 서버config(), result: 빈결과 })
    })

    const 열림 = await fetchPostActivityWhenReady('s-1', 짧게)

    expect(보낸것).toHaveLength(3)
    expect(열림.config.cards).toHaveLength(4)
  })

  it('🔴 404(후활동 없음)는 기다리지 않는다 — 한 번만 묻고 바로 실패한다', async () => {
    const 보낸것 = fetch를_끼운다(() => 실패(404, 'POST_ACTIVITY_NOT_CONFIGURED'))

    await expect(fetchPostActivityWhenReady('s-1', 짧게)).rejects.toMatchObject({
      code: 'POST_ACTIVITY_NOT_CONFIGURED',
    })
    /* 되물으면 후활동 없는 이야기마다 10초씩 헛되이 기다린다 */
    expect(보낸것).toHaveLength(1)
  })

  it('끝내 안 닫히면 기다림이 다한 뒤 포기한다 (리포트는 F12 가 받는다)', async () => {
    const 보낸것 = fetch를_끼운다(() => 실패(409, 'POST_ACTIVITY_NOT_ALLOWED', true))

    await expect(fetchPostActivityWhenReady('s-1', 짧게)).rejects.toMatchObject({
      code: 'POST_ACTIVITY_NOT_ALLOWED',
    })
    expect(보낸것.length).toBeGreaterThan(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. 🔴 아이가 「할래」를 누르면 안 닫힌 이야기를 밀어 닫는다 (2026-08-15 결정)
// ═══════════════════════════════════════════════════════════════════════════
//
// 서버는 **마지막 대화 장면이 끝나야** 세션을 닫는다. 아이가 그 장면에서 말을 안 하고
// 지나가면 서버는 거기 그대로 서고, 그런 판은 기다려도 영영 안 닫힌다 (실측: 끝까지 본
// 판의 셋 중 하나). 그래서 누른 자리에서 남은 장면을 건너뛰기로 밀어 닫는다.

describe('openPostActivityClosingStory — 안 닫힌 이야기를 밀어 닫고 연다', () => {
  it('이미 닫혀 있으면 건너뛰기를 **한 번도 안 보낸다**', async () => {
    const 보낸것 = fetch를_끼운다(() => 성공({ config: 서버config(), result: 빈결과 }))

    await openPostActivityClosingStory('s-1', 'fart-bride', 'sc_banggui_09')

    expect(보낸것).toHaveLength(1)
    expect(보낸것[0].url).toBe('/api/sessions/s-1/post-activity')
  })

  it('409 면 서버가 선 장면을 건너뛰어 닫고 그 뒤에 연다', async () => {
    let 닫혔나 = false
    const 보낸것 = fetch를_끼운다(() => {
      const url = 보낸것[보낸것.length - 1].url
      if (url.endsWith('/skip')) {
        닫혔나 = true
        /* 마지막 장면을 건너뛰면 다음 장면이 없다 = 회차끝 */
        return 성공({ scene: null })
      }
      return 닫혔나
        ? 성공({ config: 서버config(), result: 빈결과 })
        : 실패(409, 'POST_ACTIVITY_NOT_ALLOWED', true)
    })

    const 열림 = await openPostActivityClosingStory('s-1', 'fart-bride', 'sc_banggui_09')

    expect(보낸것.map((것) => 것.url)).toEqual([
      '/api/sessions/s-1/post-activity',
      '/api/sessions/s-1/scenes/sc_banggui_09/skip',
      '/api/sessions/s-1/post-activity',
    ])
    expect(열림.config.cards).toHaveLength(4)
  })

  it('밀 곳을 모르면(서버 장면 null) 건너뛰기 없이 되묻다 만다', async () => {
    const 보낸것 = fetch를_끼운다(() => 실패(409, 'POST_ACTIVITY_NOT_ALLOWED', true))

    await expect(
      openPostActivityClosingStory('s-1', 'fart-bride', null, { waitMs: 300, pollMs: 5 }),
    ).rejects.toMatchObject({ code: 'POST_ACTIVITY_NOT_ALLOWED' })

    expect(보낸것.every((것) => !것.url.endsWith('/skip'))).toBe(true)
  })
})

describe('떠나는 순간의 종료 알림 (F11 의 「뒤로가기」)', () => {
  it('sendBeacon 으로 같은 경로에 같은 body 를 보낸다', () => {
    const 보낸것: { url: string; body: BodyInit }[] = []
    vi.stubGlobal('navigator', {
      sendBeacon: (url: string, body: BodyInit) => {
        보낸것.push({ url, body })
        return true
      },
    })

    expect(beaconPostActivityComplete('s-1', 'left')).toBe(true)
    expect(보낸것[0].url).toBe('/api/sessions/s-1/post-activity/complete')
  })

  it('sendBeacon 이 없는 브라우저에서는 조용히 넘어간다 — 터지면 안 된다', () => {
    vi.stubGlobal('navigator', {})

    expect(beaconPostActivityComplete('s-1', 'left')).toBe(false)
  })
})
