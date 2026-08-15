// 말하기 후 활동 API 넷 — **한 요청의 순서가 사는 곳** (`docs/말하기후활동_명세.md` 5절 · 이슈 #45).
//
// 앞 갈래 넷이 조각을 다 만들어 두었다. 이 파일이 그것을 잇는다 —
// 표 둘(#42) · 판정 엔진(#44) · 리포트 시점(#43) · 받아쓰기(기존).
//
// ```
// A 열기     세션·설정을 보고 지금까지의 결과를 준다
// B 순서     서버가 정답과 대조해 판정한다.  앱이 보낸 판정은 받지 않는다
// C 줄거리   받아쓴 글을 **먼저** 저장하고 → 판정한다. 판정 실패는 오류가 아니다
// D 종료     completed_at 을 채우고 ⭐ 리포트를 띄운다 (기다리지 않는다)
// ```
//
// ⛔ 이 도메인은 `@/llm/repo` 를 직접 물지 않는다 (`src/session/README.md` · 이슈 #4).
//    표 둘을 만지는 자리는 전부 `@/llm/service/post-activity.ts` 다.
//
// ## 🔴 문지기 셋이 넷 모두의 앞머리다
//
// 1. 세션이 없다 → `LookupError` (404 `SESSION_NOT_FOUND`)
// 2. 그 이야기에 후활동 설정이 없다 → 404 `POST_ACTIVITY_NOT_CONFIGURED`
// 3. 세션이 아직 `completed` 가 아니다 → 409 `POST_ACTIVITY_NOT_ALLOWED`
//
// ⚠️ **2 를 3 보다 먼저 본다** (명세에 순서가 없어 이 갈래가 정했다 · 되돌려도 된다).
//    「이 이야기엔 후활동이 아예 없다」는 세션 상태와 무관한 사실이고, 앱이 활동 버튼을
//    **아예 안 그리게** 만드는 판정이라 먼저 답하는 편이 낫다.
//
// ## 🔴 세션 상태를 건드리지 않는다 (F10 · F5)
//
// 후활동은 **이미 `completed` 인 세션**에 붙는 활동이다. `story_sessions.status` 는 한
// 글자도 안 바뀐다. 체크 제약에 `post_activity` 값이 남아 있지만 **쓰지 않는 값**이다 —
// 한때 쓰려다 접었다(F5). 그 상태를 되살리면 활동을 안 하고 앱을 꺼버린 아이의 세션이
// 거기에 영영 갇힌다.

import { z } from 'zod'

import { printLine } from '@/llm/log'
import {
  postActivityReportExists,
  postActivityResult,
  postActivitySession,
  recordKeywordJudgement,
  recordOrderAttempt,
  recordPostActivityCompleted,
  recordRetellingText,
  type PostActivityResultRow,
} from '@/llm/service/post-activity'
import type { Conn } from '@/llm/service/run'
import { LookupError, ValueError } from '@/llm/service/step'
import { judgeRetellingKeywords, type RetellingCall, 버린_수 } from '@/post-activity'
import type { 단어판정, 후활동카드 } from '@/post-activity/types'
import { queueReport } from '@/report/service/generate'

// ── 오류 둘 (명세 5.E) ─────────────────────────────────────────────────────
//
// 봉투(`controller/envelope.ts`)가 이 둘을 HTTP 로 옮긴다. 미션의 409 둘이
// `llm/service/mission.ts` 에 사는 것과 같은 자리다 — **던지는 파일이 이름의 집이다.**

/** 404 — 이 이야기에 후활동 설정이 없다. 앱은 그때 활동 버튼을 **아예 그리지 않는다.** */
export class PostActivityNotConfigured extends Error {
  constructor(메시지: string) {
    super(메시지)
    this.name = 'PostActivityNotConfigured'
  }
}

/** 409 — 세션이 아직 `completed` 가 아니다 (이야기가 안 끝났다). */
export class PostActivityNotAllowed extends Error {
  constructor(메시지: string) {
    super(메시지)
    this.name = 'PostActivityNotAllowed'
  }
}

// ── `stories.post_activity_config` 읽기 (명세 4.1) ─────────────────────────

/**
 * DB 에 든 설정의 규격.
 *
 * ⚠️ `strictObject` 가 아니다 — 나중에 칸이 하나 늘었다고 활동 전체가 500 이 되는 것보다
 *    아는 칸만 보고 도는 편이 낫다 (`단어판정_응답_스키마` 와 같은 판단). 그래서 **응답에는
 *    읽은 값을 그대로** 싣는다 (아래 `openPostActivity`) — 앱이 새 칸을 바로 받는다 (F1).
 */
const 후활동설정_스키마 = z.object({
  cards: z
    .array(z.object({ id: z.string(), title: z.string(), keywords: z.array(z.string()) }))
    .min(1),
  answer_order: z.array(z.string()).min(1),
  tray_order: z.array(z.string()).min(1),
})

interface 후활동설정 {
  cards: 후활동카드[]
  answer_order: string[]
  tray_order: string[]
}

/**
 * 설정이 규격에 안 맞으면 **500 이다.** 아이도 앱도 잘못한 것이 없다 — 서버 데이터가
 * 잘못됐다. `ValueError`(400)로 옮기면 앱이 자기 요청을 고치려 든다.
 */
function 설정을_읽는다(config: unknown, session_id: string): 후활동설정 {
  const 읽음 = 후활동설정_스키마.safeParse(config)
  if (!읽음.success) {
    throw new Error(
      `stories.post_activity_config 가 규격에 안 맞는다 (session_id=${session_id}):\n` +
        z.prettifyError(읽음.error),
    )
  }
  return 읽음.data
}

// ── 문지기 ─────────────────────────────────────────────────────────────────

export interface PostActivityArgs {
  session_id: string
  /** 안 주면 `llm/service` 쪽이 `getDb()` 로 내려앉는다. 검사는 트랜잭션을 넘겨 되돌린다. */
  conn?: Conn
}

interface 열린_활동 {
  설정: 후활동설정
  /** `stories.post_activity_config` 를 **읽은 그대로**. 응답에 그대로 실린다 */
  원본설정: unknown
  /** 판정 LLM 에 실을 「무슨 이야기인가」 */
  이야기: { title: string; summary: string }
}

/** 넷 모두의 앞머리 — 세션 → 설정 → 상태. 셋 다 통과해야 표를 만진다 (이 파일 머리말). */
async function 활동을_연다(args: PostActivityArgs): Promise<열린_활동> {
  const 세션 = await postActivitySession(args)
  if (세션 === null) throw new LookupError(`세션이 없다: ${args.session_id}`)
  if (세션.config === null) {
    throw new PostActivityNotConfigured(`이 이야기에는 말하기 후 활동이 없다: ${args.session_id}`)
  }
  if (세션.status !== 'completed') {
    throw new PostActivityNotAllowed(
      `이야기가 아직 안 끝났다 (${세션.status}). 후활동은 끝난 세션에만 붙는다: ${args.session_id}`,
    )
  }
  return {
    // 깨진 설정을 200 으로 흘리면 앱이 빈 트레이를 그린다 — 여는 자리에서 잰다.
    설정: 설정을_읽는다(세션.config, args.session_id),
    원본설정: 세션.config,
    이야기: 세션.story,
  }
}

// ── A. 활동 열기 (명세 5.A) ────────────────────────────────────────────────

/** 명세 5.A 가 글자까지 적어 둔 `result` 의 모양. */
export interface PostActivityResultView {
  /** 아이의 **첫 제출** 순서. 아직 한 번도 안 냈으면 `null` */
  submitted_order: string[] | null
  /** 「끝내 맞췄나」 (F18). 아직 안 냈으면 `null` */
  is_order_correct: boolean | null
  attempt_count: number
  retelling_text: string | null
  completed_at: string | null
}

export interface PostActivityOpenData {
  /** `stories.post_activity_config` 를 **읽은 그대로** (F1 — 고치면 화면이 바뀐다) */
  config: unknown
  result: PostActivityResultView
}

/** 행이 없을 때도 같은 칸을 낸다 — 앱이 두 모양을 가릴 일이 없게 (명세 5.A). */
function 결과_모양(행: PostActivityResultRow | null): PostActivityResultView {
  if (행 === null) {
    return {
      submitted_order: null,
      is_order_correct: null,
      attempt_count: 0,
      retelling_text: null,
      completed_at: null,
    }
  }
  return {
    submitted_order: 행.submitted_order,
    is_order_correct: 행.is_order_correct,
    attempt_count: 행.attempt_count,
    retelling_text: 행.retelling_text,
    completed_at: 행.completed_at === null ? null : 행.completed_at.toISOString(),
  }
}

/**
 * `GET /api/sessions/{sid}/post-activity` — 카드·정답 순서와 **지금까지의 결과**.
 *
 * 결과를 함께 주는 것이 요점이다 — 아이가 중간에 나갔다 돌아오면 앱이 그 자리를 되살린다.
 */
export async function openPostActivity(args: PostActivityArgs): Promise<PostActivityOpenData> {
  const { 원본설정 } = await 활동을_연다(args)
  return { config: 원본설정, result: 결과_모양(await postActivityResult(args)) }
}

// ── B. 순서 제출 (명세 5.B) ────────────────────────────────────────────────

export interface PostActivityOrderData {
  /** 🔴 **서버가 계산한 값**이다. 앱이 보낸 판정은 받지 않는다 */
  is_correct: boolean
  attempt_count: number
}

/**
 * `POST …/post-activity/order` — 「다 놓았어요!」를 누를 때마다 온다.
 *
 * 🔴 **판정은 서버가 한다.** `answer_order` 와 글자로 대조한다 (명세 5.B).
 * 「첫 제출을 안 덮는다」(F7)와 「끝내 맞췄나」(F18)는 SQL 한 문장 안에 있다
 * (`@/llm/repo/post-activity` 의 `submitPostActivityOrder()`).
 *
 * ⚠️ 카드 넉 장의 **순열이 아니면 400 이다.** 명세에 없는 판단이라 이 갈래가 정했다 —
 *    화면이 낼 수 있는 값은 넉 장을 늘어놓은 것뿐이라 그 밖의 값은 앱 버그이고,
 *    `submitted_order` 는 **첫 제출만 남는 칸**이라 한 번 들어간 쓰레기가 영영 남는다.
 *    막는 쪽을 되돌리기는 쉽지만, 이미 들어간 값은 되돌릴 수 없다.
 */
export async function submitPostActivityOrder(
  args: PostActivityArgs & { submitted_order: readonly string[] },
): Promise<PostActivityOrderData> {
  const { 설정 } = await 활동을_연다(args)
  const 정답 = 설정.answer_order
  const 낸것 = args.submitted_order

  const 같은_묶음 =
    낸것.length === 정답.length && [...낸것].sort().join(' ') === [...정답].sort().join(' ')
  if (!같은_묶음) {
    throw new ValueError(
      `submitted_order 가 카드 ${정답.length}장의 순열이 아니다: ${JSON.stringify(낸것)}`,
    )
  }

  const is_correct = 낸것.every((카드, 자리) => 카드 === 정답[자리])
  const 행 = await recordOrderAttempt({ ...args, is_correct })
  return { is_correct, attempt_count: 행.attempt_count }
}

// ── C. 줄거리 말하기 (명세 5.C) ────────────────────────────────────────────

export type PostActivityRetellingData =
  /** 아무 말도 안 담겼다 — **아무것도 저장하지 않는다.** 앱이 재시도 연출을 한다 */
  | { empty: true }
  | {
      text: string
      /** `false` 면 판정을 못 했다. **오류가 아니다** — 아이 화면은 끝까지 간다 (F4·F8) */
      analyzed: boolean
      /** 단어 12행. 판정을 못 했으면 `null` */
      keywords: 단어판정[] | null
    }

/**
 * `POST …/post-activity/retelling` — 받아쓴 줄거리 하나를 저장하고 판정한다.
 *
 * 받아쓰기(STT)는 컨트롤러(HTTP 경계) 몫이다 — 이 층은 확정 텍스트만 받는다 (턴 API 와 같다).
 *
 * ## 🔴 저장이 판정보다 먼저다 (F4·F8 · 수용 기준 10)
 *
 * 판정이 실패해도 **아이 말은 남아야 한다.** 그래서 순서가 이렇다:
 *
 * ```
 * ① retelling_text 저장 (+ 지난 판정 지우기)  →  ② 판정  →  ③ 성공했을 때만 단어 12행
 * ```
 *
 * ②가 죽으면 ③이 없다 — `analyzed_at` 은 NULL 로 남고 응답은 **200** 이다.
 * 그것이 「판정을 못 했다」이고, 「단어를 하나도 안 썼다」(12행 전부 `missing`)와 다르다.
 *
 * ⚠️ **반만 판정한 12행을 저장하지 않는다.** ①규칙이 이미 찾아 둔 `used` 까지 함께 버린다 —
 *    일부러 그렇다. 반만 넣으면 보호자 화면이 나머지를 「아이가 안 썼어요」로 읽는다
 *    (명세 4.2). 그 판단은 판정 엔진이 `words: null` 로 이미 냈고 여기서는 따를 뿐이다.
 */
export async function submitPostActivityRetelling(
  args: PostActivityArgs & {
    retelling: string
    /**
     * 🔴 **검사가 바꿔치기하는 이음매다.** 컨트롤러는 안 넘긴다 — 안 넘기면 진짜 `complete()`
     * 가 돈다 (`RetellingCall` 머리말 · `generateReport({ call })` 과 같은 자리).
     * 검사에서 진짜 API 를 치면 돈이 나가고 답이 회차마다 흔들린다.
     */
    call?: RetellingCall
  },
): Promise<PostActivityRetellingData> {
  const { 설정, 이야기 } = await 활동을_연다(args)

  const 줄거리 = args.retelling.trim()
  if (줄거리 === '') {
    // 무음이다. 🔴 저장도 판정도 하지 않는다 — 지난 줄거리를 빈 글로 덮으면 안 된다.
    return { empty: true }
  }

  // ① 먼저 저장한다. 지난 판정(`analyzed_at`·단어 행)은 이 안에서 함께 지워진다.
  const 행 = await recordRetellingText({ ...args, text: 줄거리 })

  // ② 판정. ⛔ 던지지 않는다 — 실패도 값으로 온다 (`judgeRetellingKeywords()` 머리말).
  const 판정 = await judgeRetellingKeywords({
    story: 이야기,
    cards: 설정.cards,
    retelling: 줄거리,
    call: args.call,
  })
  판정줄(args.session_id, 판정)

  if (!판정.analyzed || 판정.words === null) {
    return { text: 줄거리, analyzed: false, keywords: null }
  }

  // ③ 12행과 `analyzed_at`. 여기까지 와야 「판정했다」다.
  await recordKeywordJudgement({
    ...args,
    result_id: 행.id,
    words: 판정.words,
    version: 판정.version,
  })
  return { text: 줄거리, analyzed: true, keywords: 판정.words }
}

/**
 * 판정 한 건의 결과 한 줄. **버린 것이 있으면 그 수까지 찍는다.**
 *
 * 🔴 버린 것이 조용하면 프롬프트가 새고 있어도 아무도 모른다 (`src/post-activity/types.ts`
 * 의 `버린것` 머리말 · 리포트의 `결과줄()` 과 같은 자리). 아이 이름도 원문도 안 찍는다.
 */
function 판정줄(
  session_id: string,
  판정: Awaited<ReturnType<typeof judgeRetellingKeywords>>,
): void {
  printLine(
    `[후활동] 판정 session_id=${session_id} analyzed=${판정.analyzed} ` +
      `단어=${판정.words?.length ?? 0} 버림=${버린_수(판정.dropped)}` +
      (판정.failed === null ? '' : ` 사유="${판정.failed}"`),
  )
}

// ── D. 활동 종료 (명세 5.D) — ⭐ 리포트를 띄우는 자리 ──────────────────────

/** `finished` 「마치기」를 눌렀다 · `left` 활동을 안 하고 끝 화면을 떠났다 */
export type PostActivityCompleteReason = 'finished' | 'left'

export interface PostActivityCompleteData {
  /** `exists` 면 이미 있어 안 만들었다. 아이 화면은 어느 쪽이든 그대로 넘어간다 */
  report: 'queued' | 'exists'
}

/**
 * `POST …/post-activity/complete` — 활동 종료. **여기가 리포트를 띄우는 자리다** (F11).
 *
 * | `reason` | 언제 | `completed_at` |
 * |---|---|---|
 * | `finished` | 「마치기」를 눌렀다 | 채운다 |
 * | `left` | 활동을 안 하고 끝 화면을 떠났다 | **아무것도 안 쓴다** |
 *
 * 🔴 **`후활동을_기다린다` 곁다리를 넘기지 마라.** 그건 「세션이 끝나는 자리」 전용이다
 * (`queueReport()` 머리말의 표). 여기서 넘기면 후활동이 있는 이야기의 리포트가 **영영**
 * 안 만들어진다 — 「기다린다」의 상대가 바로 이 자리이기 때문이다.
 *
 * ⭐ **반복 호출이 안전하다.** 아이가 마치고 끝 화면을 떠나면 이 API 가 두 번 불린다.
 * `completed_at` 은 처음 시각이 그대로 남고, 리포트는 행이 이미 있으면 안 만든다.
 *
 * ⛔ 세션 상태를 건드리지 않는다 — 이미 `completed` 다 (F10 · 이 파일 머리말).
 */
export async function completePostActivity(
  args: PostActivityArgs & { reason: PostActivityCompleteReason },
): Promise<PostActivityCompleteData> {
  await 활동을_연다(args)

  if (args.reason === 'finished') {
    await recordPostActivityCompleted(args)
  }
  // ⛔ `left` 는 아무것도 안 쓴다. 활동을 안 하고 떠난 아이에게 빈 결과 행을 세우면
  //    리포트가 그것을 「후활동을 했다」로 읽는다 (수용 기준 12 — 그때는 `null` 이어야 한다).

  // 🔴 띄우기 **전에** 본다. `queueReport()` 는 아무것도 안 돌려주므로(기다리지 않는
  //    문이다) 「이미 있었나」를 알 수 있는 자리가 여기뿐이다.
  const 이미있다 = await postActivityReportExists(args)
  queueReport(args.session_id)
  return { report: 이미있다 ? 'exists' : 'queued' }
}
