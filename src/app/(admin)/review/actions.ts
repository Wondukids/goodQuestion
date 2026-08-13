'use server'

// 검수 화면이 누르는 단추 셋 (이슈 #26 화면-4).
//
// 파이썬 `routes/review.py` 의 `POST` 셋(`분석_판정` · `대사_판정` · `기준_쓰기`) 자리다.
//
// ⛔ **여기에 규칙이 없다.** 하는 일은 `runs/actions.ts` 와 똑같이 셋뿐이다 —
//    폼을 zod 로 읽고 · `service/review.ts` 를 부르고 · 돌아갈 곳을 정한다.
//    판정이 무엇을 요구하는지(넘음엔 항목 · 보류엔 이유)는 전부 `service` 안에 있다.
//
// ## 오류는 삼킨 뒤 주소에 실어 보낸다
//
// 파이썬은 422 를 던져 오류 화면을 띄웠다. 여기서는 라우트가 쓰는 **같은 표**
// (`app/api/_lib/envelope.ts` 의 `옮긴다()`)로 코드·문구를 뽑아 `?error=` 로 넘긴다 —
// 회차 화면과 같은 방식이고, 검수하던 턴을 그대로 보면서 무엇이 틀렸는지 읽을 수 있다.
// ⚠️ 그래서 **상태 코드가 갈린다**: 파이썬 422 → 여기서는 `BAD_REQUEST`(400) 문구다.
//    계약(`라우트계약.md` 8절)이 「부르는 쪽이 잘못된 인자를 줬다」를 400 으로 본다.
//
// ## 매긴 사람은 헤더에서 온다
//
// 파이썬 `_사람()` 과 같은 자리다 — Tailscale 이 붙여 주는 로그인 이름을 읽고, 없으면
// 「알 수 없음」이다. ⛔ **인증이 아니다.** 계정도 아이 개인정보도 여기 들어오지 않는다
// (`CLAUDE.md` 경계 6). 누가 매겼는지가 기록에 남아야 판정을 되짚을 수 있을 뿐이다.

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { saveHumanScore, writeCriterion, type ReviewTarget } from '@/lib/service/review'

import { 옮긴다 } from '../../api/_lib/envelope'

/** 실패를 사람이 읽을 한 줄로. 라우트가 쓰는 표를 그대로 쓴다. */
function 오류_문구(오류: unknown): string {
  const { error } = 옮긴다(오류)
  return `${error.code}: ${error.message}`
}

/**
 * 성공이면 그대로, 실패면 `?error=` 를 달아 돌아간다.
 *
 * ⚠️ `redirect()` 는 **던져서** 흐름을 끊는다. 반드시 `try` 밖에서 부른다.
 * ⚠️ 조각(`#turn-…`)은 **물음표 뒤**가 아니라 맨 끝이다. 순서를 바꾸면 `error` 값 안에
 *    조각이 딸려 들어가 화면에 그대로 찍힌다.
 */
function 돌아간다(경로: string, 조각: string, 오류: string | null): never {
  const 물음 = 오류 === null ? '' : `?error=${encodeURIComponent(오류)}`
  redirect(`${경로}${물음}${조각}`)
}

/** 폼 칸 하나. 빈 문자열은 「안 적었다」이므로 `null` 로 본다. */
function 칸(폼: FormData, 이름: string): string | null {
  const 값 = 폼.get(이름)
  if (typeof 값 !== 'string' || 값.trim() === '') return null
  return 값
}

/** zod 가 거부한 첫 까닭. */
function zod_문구(오류: z.ZodError): string {
  const 건 = 오류.issues[0]
  if (건 === undefined) return 'BAD_REQUEST: 폼이 틀렸다'
  return `BAD_REQUEST: ${건.path.length === 0 ? '' : `${건.path.join('.')}: `}${건.message}`
}

/** 판정을 매긴 사람 (파이썬 `_사람()`). */
async function 사람(): Promise<string> {
  return (await headers()).get('Tailscale-User-Login') ?? '알 수 없음'
}

// ═══════════════════════════════════════════════════════════════════════════
// 판정 남기기 — 분석 · 대사
// ═══════════════════════════════════════════════════════════════════════════

const 판정_폼 = z.object({ run_id: z.uuid(), message_id: z.uuid() })

/**
 * 판정 한 건.
 *
 * ⚠️ 값 칸(`value`·`comment`·교정 4칸)은 zod 로 좁히지 않고 **그대로 넘긴다.** 무엇이
 *    허용되는지는 `service/review.ts` 하나가 안다 — 두 군데서 걸러 내면 언젠가 갈린다.
 */
async function 판정_저장(폼: FormData, target: ReviewTarget): Promise<never> {
  const 읽음 = 판정_폼.safeParse({
    run_id: 칸(폼, 'run_id'),
    message_id: 칸(폼, 'message_id'),
  })
  if (!읽음.success) 돌아간다('/review/pending', '', zod_문구(읽음.error))

  const { run_id, message_id } = 읽음.data
  let 오류: string | null = null
  try {
    await saveHumanScore({
      run_id,
      message_id,
      target,
      graded_by: await 사람(),
      form: {
        value: 폼.get('value')?.toString() ?? '',
        comment: 칸(폼, 'comment'),
        violated_item: 칸(폼, 'violated_item'),
        correction_child_intent: 칸(폼, 'correction_child_intent'),
        correction_main_point: 칸(폼, 'correction_main_point'),
        correction_detected_elements: 칸(폼, 'correction_detected_elements'),
        correction_utterance_validity: 칸(폼, 'correction_utterance_validity'),
        correction_text: 칸(폼, 'correction_text'),
      },
    })
  } catch (그것) {
    오류 = 오류_문구(그것)
  }
  // 매긴 턴 자리로 되돌아간다 (파이썬과 같은 조각 이름 `#turn-{message_id}`).
  돌아간다(`/review/runs/${run_id}`, `#turn-${message_id}`, 오류)
}

export async function analysisScoreAction(폼: FormData): Promise<void> {
  await 판정_저장(폼, 'analysis')
}

export async function utteranceScoreAction(폼: FormData): Promise<void> {
  await 판정_저장(폼, 'utterance')
}

// ═══════════════════════════════════════════════════════════════════════════
// 기준 문장 남기기
// ═══════════════════════════════════════════════════════════════════════════

const 기준_폼 = z.object({
  scene_id: z.uuid(),
  element: z.string().min(1),
  criterion: z.string().min(1),
  /** 검수 화면에서 눌렀으면 그 회차로, 보류 화면에서 눌렀으면 없다. */
  run_id: z.uuid().nullable(),
})

export async function criterionAction(폼: FormData): Promise<void> {
  const 읽음 = 기준_폼.safeParse({
    scene_id: 칸(폼, 'scene_id'),
    element: 칸(폼, 'element') ?? '',
    criterion: 폼.get('criterion')?.toString() ?? '',
    run_id: 칸(폼, 'run_id'),
  })
  if (!읽음.success) 돌아간다('/review/pending', '', zod_문구(읽음.error))

  const { scene_id, element, criterion, run_id } = 읽음.data
  let 오류: string | null = null
  try {
    await writeCriterion({ scene_id, element, criterion, written_by: await 사람() })
  } catch (그것) {
    오류 = 오류_문구(그것)
  }
  돌아간다(run_id === null ? '/review/pending' : `/review/runs/${run_id}`, '', 오류)
}
