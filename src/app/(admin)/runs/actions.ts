'use server'

// 화면이 누르는 단추 여섯 (이슈 #26 화면-3).
//
// ⛔ **여기에 규칙이 없다.** 하는 일은 라우트 넷과 똑같이 셋뿐이다 —
//    폼을 zod 로 읽고 · `service` 함수를 부르고 · 돌아갈 곳을 정한다
//    (`docs/설계/코드구조.md` 2절). 모드도 장면 종료도 여기서 정하지 않는다.
//
// ## 왜 라우트가 아니라 서버 액션인가
//
// **세션을 만드는 라우트는 계약 넷 안에 없다** (`docs/설계/라우트계약.md` 7절).
// 「회차 시작 화면이 서버에서 `service/run.ts` 를 직접 부른다」가 계약이고, 장면 시작·
// 전개 재생도 마찬가지다. ①②③ 은 라우트가 이미 있지만 화면이 HTTP 로 자기 서버를
// 도로 두드릴 이유가 없다 — **둘 다 같은 `service` 함수를 부르므로 답이 갈리지 않는다**
// (`코드구조.md` 1절). 그것을 `tests/routes.db.test.ts` 가 이미 재고 있다.
//
// ## 오류는 삼킨 뒤 주소에 실어 보낸다
//
// 서버 액션이 그냥 터지면 Next 의 오류 화면이 뜨고 회차가 어디까지 갔는지 안 보인다.
// 그래서 라우트가 쓰는 **같은 표**(`app/api/_lib/envelope.ts` 의 `옮긴다()`)로 코드·문구를
// 뽑아 `?error=` 로 넘긴다. 화면과 라우트가 같은 이름으로 같은 실패를 말한다.

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { 고를_수_있는_강도, loadSettings } from '@/lib/config'
import { advanceStep, resumeTurn, startRunStep, submitTurn } from '@/lib/service/run'
import { analysisStep, decisionStep, dialogueStep, ValueError } from '@/lib/service/step'
import { listScenesView } from '@/lib/service/view'

import { 옮긴다 } from '../../api/_lib/envelope'

/** 실패를 사람이 읽을 한 줄로. 라우트가 쓰는 표를 그대로 쓴다. */
function 오류_문구(오류: unknown): string {
  const { error } = 옮긴다(오류)
  return `${error.code}: ${error.message}`
}

/**
 * 성공이면 그대로, 실패면 `?error=` 를 달아 돌아간다.
 *
 * ⚠️ `redirect()` 는 **던져서** 흐름을 끊는다 (Next `redirect.md`). 그래서 `try` 안에서
 *    부르면 우리 `catch` 가 그것을 실패로 잡아먹는다. 반드시 `try` 밖에서 부른다.
 */
function 돌아간다(경로: string, 오류: string | null): never {
  redirect(오류 === null ? 경로 : `${경로}?error=${encodeURIComponent(오류)}`)
}

/**
 * 폼 칸 하나. 빈 문자열은 「안 적었다」이므로 `null` 로 본다.
 *
 * ⚠️ **공백뿐인가를 판정만 하고 값은 원본 그대로 준다.** 사람이 넣은 문장(발화·메모)을
 *    다듬으면 저장된 글이 넣은 글과 달라지기 때문이다. 다듬어야 하는 칸은 스키마 쪽에서
 *    `z.string().trim()` 을 붙인다 — 지금은 모델·강도 넷이 그렇다 (`시작_폼`).
 */
function 칸(폼: FormData, 이름: string): string | null {
  const 값 = 폼.get(이름)
  if (typeof 값 !== 'string' || 값.trim() === '') return null
  return 값
}

/** zod 가 거부한 첫 까닭. 어느 칸이 왜 틀렸는지가 남아야 사람이 고친다. */
function zod_문구(오류: z.ZodError): string {
  const 건 = 오류.issues[0]
  if (건 === undefined) return 'BAD_REQUEST: 폼이 틀렸다'
  return `BAD_REQUEST: ${건.path.length === 0 ? '' : `${건.path.join('.')}: `}${건.message}`
}

// ═══════════════════════════════════════════════════════════════════════════
// 회차 시작 — `startRunStep()` + `advanceStep()`
// ═══════════════════════════════════════════════════════════════════════════

const 시작_폼 = z
  .object({
    story_code: z.string().min(1),
    scope: z.enum(['scene', 'story']),
    // 빈 칸이면 `null` 이다. `runs_scene_order_check` 가 `story` 범위에서 값이 있으면 막는다.
    scene_order: z.coerce.number().int().positive().nullable(),
    started_by: z.string().nullable(),
    experiment_note: z.string().nullable(),

    // 🔴 **모델 이름을 다듬어 저장한다** (파이썬 `routes/runs.py` 의 `analysis_model.strip()`).
    //    `칸()` 은 「공백뿐인가」만 판정하고 값은 원본을 준다. 그래서 `"  gemini-3.5-flash  "`
    //    가 그대로 `runs` 에 박혔고, 그 회차는 **첫 LLM 호출에 통째로 실패**한다. 파이썬이
    //    자유 입력칸을 목록으로 바꾼 2026-08-11 사고가 정확히 이것이다.
    analysis_model: z.string().trim().nullable(),

    // 🔴 **파이썬의 422 자리다** (`routes/runs.py` 의 강도 검사 — 「폼을 안 거치고 들어오는
    //    요청이 있다」). 모르는 강도는 제미나이에 **안 실린 채 조용히 돈다** — 폼에서 온 값을
    //    여기서 막지 않으면 「강도를 medium 으로 줬는데 왜 빠르지」를 나중에 못 되짚는다.
    //    ⭐ `.nullable()` 이라야 「안 골랐다」(라디오를 하나도 안 누른 폼)가 통과한다.
    //
    //    ⚠️ **다듬은 뒤 목록과 견준다** — 파이썬이 `값.strip() not in 고를_수_있는_강도` 로
    //       같은 순서다. `.trim()` 을 안 붙이면 `" high "` 가 파이썬에서는 통과하고 여기서는
    //       거절돼 이식하며 갈린 자리가 하나 더 생긴다. 라디오는 그런 값을 안 보내지만
    //       **폼을 안 거치는 요청**이 이 검사의 존재 이유다.
    //
    //    ⛔ 이 검사는 **폼에서 온 값에만** 닿는다. 칸이 비어 바닥값(`.env.local` 의
    //       `GQ_GEMINI_EFFORT`)이 채워지는 길은 여기를 안 거치므로 목록 밖 강도가 그대로
    //       회차에 박힐 수 있다. **파이썬도 똑같다** (`설정.gemini_effort` 를 검사 없이 썼다) —
    //       이식 회귀가 아니라 원래 그런 것이고, 고칠 거면 설정 읽는 자리에서 고쳐야 한다.
    analysis_effort: z.string().trim().pipe(z.enum(고를_수_있는_강도)).nullable(),
    character_model: z.string().trim().nullable(),
    character_effort: z.string().trim().pipe(z.enum(고를_수_있는_강도)).nullable(),
  })
  // 파이썬 `routes/runs.py:279` 의 422. DB `runs_scene_order_check` 도 막지만 그쪽은 사람에게
  // 제약 이름이 박힌 SQL 오류로 보인다 — 어느 칸을 채우라는 말인지가 화면에 남아야 한다.
  .refine((값) => !(값.scope === 'scene' && 값.scene_order === null), {
    path: ['scene_order'],
    message: '장면 하나 범위에는 장면을 골라야 한다',
  })

export async function startRunAction(폼: FormData): Promise<void> {
  const 읽음 = 시작_폼.safeParse({
    story_code: 칸(폼, 'story_code') ?? '',
    scope: 칸(폼, 'scope') ?? 'story',
    scene_order: 칸(폼, 'scene_order'),
    started_by: 칸(폼, 'started_by'),
    experiment_note: 칸(폼, 'experiment_note'),
    analysis_model: 칸(폼, 'analysis_model'),
    analysis_effort: 칸(폼, 'analysis_effort'),
    character_model: 칸(폼, 'character_model'),
    character_effort: 칸(폼, 'character_effort'),
  })
  if (!읽음.success) 돌아간다('/runs', zod_문구(읽음.error))

  let 갈_곳 = '/runs'
  let 오류: string | null = null
  try {
    // 🔴 **파이썬의 둘째 422 다** — 「고른 장면이 이야기에 없다」. 파이썬은 이 검사를
    //    **세션·회차를 만들기 전에** 한다 (`routes/runs.py` 의 `if scope == "scene" and not any(...)`).
    //    이식본에는 그 검사가 없어서 **회차가 먼저 생기고** 그 뒤 `advanceStep()` 이 터졌다 —
    //    아무 턴도 없는 **유령 회차**가 목록에 남는다 (2026-08-13 실측: `runs` 가 8→9).
    //
    // ⚠️ 던져서 막는다. `옮긴다()` 가 `ValueError` 를 `BAD_REQUEST` 로 옮기므로 라우트와
    //    **같은 이름의 같은 실패**가 된다 (파이썬은 422 이고 우리 표에서는 「부르는 쪽이
    //    틀렸다」가 400 이다 — 앞의 두 422 도 그 자리로 옮겨 와 있다).
    //
    // ⛔ 장면이 **하나도 없는** 경우는 여기서 안 가른다. 그건 「이야기를 찾을 수 없다」쪽이고
    //    `startRunStep()` 이 그 자리에서 제 문구로 던진다.
    if (읽음.data.scope === 'scene') {
      const 장면들 = await listScenesView(읽음.data.story_code)
      const 있나 = 장면들.some((장면) => 장면.scene_order === 읽음.data.scene_order)
      if (장면들.length > 0 && !있나) throw new ValueError('고른 장면이 이야기에 없다')
    }

    // ⭐ **빈 칸을 NULL 로 두지 않는다** (파이썬 `routes/runs.py:307` 의 `… or 설정.gemini_model`).
    //    NULL 이면 `runSettings()` 가 볼 때마다 그때의 `.env.local` 로 내려앉으므로,
    //    나중에 설정을 바꾸면 **옛 회차의 뜻이 따라 변한다.** 회차를 견주는 도구에서 그건 손실이다.
    const 바닥 = loadSettings()
    const { run } = await startRunStep({
      story_code: 읽음.data.story_code,
      scope: 읽음.data.scope,
      // `story` 범위면 `null` 이어야 한다 (CHECK). 화면이 실수로 채워도 여기서 떨어낸다.
      scene_order: 읽음.data.scope === 'scene' ? 읽음.data.scene_order : null,
      started_by: 읽음.data.started_by,
      experiment_note: 읽음.data.experiment_note,
      analysis_model: 읽음.data.analysis_model ?? 바닥.gemini_model,
      analysis_effort: 읽음.data.analysis_effort ?? 바닥.gemini_effort,
      character_model: 읽음.data.character_model ?? 바닥.gemini_model,
      character_effort: 읽음.data.character_effort ?? 바닥.gemini_effort,
    })
    // 대화 장면에 닿을 때까지 전개를 재생한다. 안 하면 `current_scene_id` 가 null 이라
    // ① 이 409 `TURN_NOT_ALLOWED` 로 튕긴다 (계약 7절 표). ⛔ LLM 을 부르지 않는다.
    await advanceStep({ run_id: run.id })
    갈_곳 = `/runs/${run.id}`
  } catch (그것) {
    오류 = 오류_문구(그것)
  }
  돌아간다(갈_곳, 오류)
}

// ═══════════════════════════════════════════════════════════════════════════
// 전개 재생 · 끊긴 턴 이어 돌리기
// ═══════════════════════════════════════════════════════════════════════════

const run_id_폼 = z.object({ run_id: z.uuid() })

export async function advanceAction(폼: FormData): Promise<void> {
  const 읽음 = run_id_폼.safeParse({ run_id: 칸(폼, 'run_id') })
  if (!읽음.success) 돌아간다('/runs', zod_문구(읽음.error))

  let 오류: string | null = null
  try {
    await advanceStep({ run_id: 읽음.data.run_id })
  } catch (그것) {
    오류 = 오류_문구(그것)
  }
  돌아간다(`/runs/${읽음.data.run_id}`, 오류)
}

const 이어돌리기_폼 = z.object({ run_id: z.uuid(), child_message_id: z.uuid() })

/**
 * 끊긴 턴을 **죽은 단계부터** 이어 돌린다 (결정 44 · `라우트계약.md` 8절).
 *
 * ⛔ 아이 메시지를 새로 만들지 않는다 — `messages` 행도 턴 수도 늘지 않는다.
 */
export async function resumeAction(폼: FormData): Promise<void> {
  const 읽음 = 이어돌리기_폼.safeParse({
    run_id: 칸(폼, 'run_id'),
    child_message_id: 칸(폼, 'child_message_id'),
  })
  if (!읽음.success) 돌아간다('/runs', zod_문구(읽음.error))

  let 오류: string | null = null
  try {
    await resumeTurn(읽음.data)
  } catch (그것) {
    오류 = 오류_문구(그것)
  }
  돌아간다(`/runs/${읽음.data.run_id}`, 오류)
}

// ═══════════════════════════════════════════════════════════════════════════
// ①②③ — 라우트 셋과 **같은 서비스 함수**를 부른다
// ═══════════════════════════════════════════════════════════════════════════

const 분석_폼 = z.object({
  run_id: z.uuid(),
  session_id: z.uuid(),
  // ⚠️ **다듬지 않는다.** `trim()` 하면 저장되는 문장이 사람이 넣은 것과 달라진다.
  //    공백뿐인지만 본다 — `app/api/v1/analysis/route.ts` 와 같은 규칙이다.
  child_utterance: z.string().refine((글) => 글.trim().length > 0, '발화가 비어 있다'),
})

/**
 * 한 턴을 **끝까지** — ①분석 ②판단 ③대사 (파이썬 `회차.py:444 턴_뒤에서()` → `턴_돌리기()`).
 * 발화 폼의 기본 단추가 이것이고, 「① 분석만」은 그 폼의 둘째 단추다.
 *
 * ⛔ **묶은 것이 아니다.** `submitTurn()` 은 `runTurn()` 을 잠금·문지기와 함께 감싼 것이고,
 *    서비스 함수 셋(`analysisStep`·`decisionStep`·`dialogueStep`)도 라우트 셋도 그대로 있다.
 *    화면이 셋을 이어 부르는 것은 파이썬이 하던 일 그대로다 (`CLAUDE.md` 의 금지는
 *    「관리자 화면이 단계별로 들여다보고 따로 다시 돌려야 하니까」가 근거이고, 그 길은 남는다).
 *
 * ⚠️ **`session_id` 를 쓰지 않는다** — `submitTurn()` 의 열쇠는 `run_id` 이고 세션은 회차에서
 *    찾아온다. 폼 스키마를 `analysisAction` 과 **같은 것**으로 두는 까닭은 단추 둘이 같은 폼을
 *    쏘기 때문이다(스키마가 갈리면 한쪽 단추가 조용히 400 이 된다). 그래서 뒤따르는 **오류 표는
 *    `analysisAction` 과 다르다** — 세션이 없어도 여기서는 `SESSION_NOT_FOUND` 가 아니라
 *    회차 쪽 오류가 온다. 다음 사람이 같은 표를 기대하지 말 것.
 */
export async function turnAction(폼: FormData): Promise<void> {
  const run_id = 칸(폼, 'run_id')
  const 읽음 = 분석_폼.safeParse({
    run_id,
    session_id: 칸(폼, 'session_id'),
    // `칸()` 을 안 쓴다 — 공백뿐인 발화를 `null` 로 바꿔 버리면 zod 가 그것을 못 본다.
    child_utterance: 폼.get('child_utterance') ?? '',
  })
  if (!읽음.success) 돌아간다(run_id === null ? '/runs' : `/runs/${run_id}`, zod_문구(읽음.error))

  let 오류: string | null = null
  try {
    await submitTurn({
      run_id: 읽음.data.run_id,
      child_utterance: 읽음.data.child_utterance,
    })
  } catch (그것) {
    오류 = 오류_문구(그것)
  }
  돌아간다(`/runs/${읽음.data.run_id}`, 오류)
}

/** ① 분석. 이제 **「① 분석만」 단추 전용(검수용)이다** — 기본 단추는 위의 `turnAction` 이다. */
export async function analysisAction(폼: FormData): Promise<void> {
  const run_id = 칸(폼, 'run_id')
  const 읽음 = 분석_폼.safeParse({
    run_id,
    session_id: 칸(폼, 'session_id'),
    // `칸()` 을 안 쓴다 — 공백뿐인 발화를 `null` 로 바꿔 버리면 zod 가 그것을 못 본다.
    child_utterance: 폼.get('child_utterance') ?? '',
  })
  if (!읽음.success) 돌아간다(run_id === null ? '/runs' : `/runs/${run_id}`, zod_문구(읽음.error))

  let 오류: string | null = null
  try {
    await analysisStep({
      session_id: 읽음.data.session_id,
      child_utterance: 읽음.data.child_utterance,
    })
  } catch (그것) {
    오류 = 오류_문구(그것)
  }
  돌아간다(`/runs/${읽음.data.run_id}`, 오류)
}

const 판단_폼 = z.object({
  run_id: z.uuid(),
  session_id: z.uuid(),
  message_id: z.uuid(),
  child_intent: z.string(),
  utterance_validity: z.string(),
})

/**
 * ② 판단. **LLM 이 아니다** — `decide()` 순수 함수 한 번이다.
 *
 * ⚠️ `detected_elements` 는 ① 의 **`detected_elements_kept`** 다 (계약 4절). 화면이 그 값을
 *    숨은 칸으로 들고 있다가 그대로 돌려보낸다 — 그 메아리가 「단계별로 다시 돌린다」의 뿌리다.
 */
export async function decisionAction(폼: FormData): Promise<void> {
  const 읽음 = 판단_폼.safeParse({
    run_id: 칸(폼, 'run_id'),
    session_id: 칸(폼, 'session_id'),
    message_id: 칸(폼, 'message_id'),
    child_intent: 칸(폼, 'child_intent') ?? '',
    utterance_validity: 칸(폼, 'utterance_validity') ?? '',
  })
  if (!읽음.success) 돌아간다('/runs', zod_문구(읽음.error))

  let 오류: string | null = null
  try {
    await decisionStep({
      session_id: 읽음.data.session_id,
      message_id: 읽음.data.message_id,
      analysis: {
        child_intent: 읽음.data.child_intent,
        // 체크박스라 여러 칸이 같은 이름으로 온다. 사람이 요소를 빼고 다시 판정해 볼 수 있다.
        detected_elements: 폼.getAll('detected_elements').map(String),
        utterance_validity: 읽음.data.utterance_validity,
      },
    })
  } catch (그것) {
    오류 = 오류_문구(그것)
  }
  돌아간다(`/runs/${읽음.data.run_id}`, 오류)
}

const 대사_폼 = z.object({
  run_id: z.uuid(),
  session_id: z.uuid(),
  message_id: z.uuid(),
  response_mode: z.enum(['NORMAL', 'GUIDED', 'CLOSING']),
  reaction_key: z.string(),
  guidance_target: z.string().nullable(),
  main_point: z.string().nullable(),
})

/**
 * ③ 대사.
 *
 * 🔴 **모드·반응 키를 폼에 두는 것이 이 레포의 존재 이유다** (계약 1절). 사람이 그 칸을
 * 고쳐 ③ 만 다시 돌릴 수 있어야 한다. DB 에서만 읽으면 그 일을 못 한다.
 *
 * ⛔ CLOSING 갈림은 여기 없다 — `characterTurn()` 하나가 가른다 (`CLAUDE.md` 경계 4).
 */
export async function dialogueAction(폼: FormData): Promise<void> {
  const 읽음 = 대사_폼.safeParse({
    run_id: 칸(폼, 'run_id'),
    session_id: 칸(폼, 'session_id'),
    message_id: 칸(폼, 'message_id'),
    response_mode: 칸(폼, 'response_mode') ?? '',
    reaction_key: 칸(폼, 'reaction_key') ?? '',
    guidance_target: 칸(폼, 'guidance_target'),
    main_point: 칸(폼, 'main_point'),
  })
  if (!읽음.success) 돌아간다('/runs', zod_문구(읽음.error))

  let 오류: string | null = null
  try {
    await dialogueStep({
      session_id: 읽음.data.session_id,
      message_id: 읽음.data.message_id,
      response_mode: 읽음.data.response_mode,
      reaction_key: 읽음.data.reaction_key,
      guidance_target: 읽음.data.guidance_target,
      main_point: 읽음.data.main_point,
    })
  } catch (그것) {
    오류 = 오류_문구(그것)
  }
  돌아간다(`/runs/${읽음.data.run_id}`, 오류)
}
