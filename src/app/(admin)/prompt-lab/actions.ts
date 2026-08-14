'use server'

// 작업대가 누르는 단추 하나 — 「이 회차에 실험용으로 저장」.
//
// 파이썬 `POST /runs/{run_id}/prompts/{name}` 자리다 (`routes/prompt_lab.py`).
//
// ⛔ **여기에 규칙이 없다.** 폼을 zod 로 읽고 · `service` 를 부르고 · 돌아갈 곳을 정한다
//    (`docs/설계/코드구조.md` 2절). 회차 화면의 `actions.ts` 와 같은 모양이다.
//
// 🔴 **`prompts/*.md` 를 쓰지 않는다** (`CLAUDE.md` 경계 6). 저장되는 곳은
//    `experiment_prompts` 표 하나뿐이고, 확정본은 사람이 파일로 옮긴다.

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { saveExperimentPromptStep } from '@/llm/service/prompt-lab'

import { 옮긴다 } from '@/llm/controller/envelope'

/** 실패를 사람이 읽을 한 줄로. 라우트가 쓰는 표를 그대로 쓴다. */
function 오류_문구(오류: unknown): string {
  const { error } = 옮긴다(오류)
  return `${error.code}: ${error.message}`
}

/**
 * 저장한 회차의 작업대로 돌아간다. 실패면 `?error=` 를 달아 같은 자리로.
 *
 * ⚠️ `redirect()` 는 **던져서** 흐름을 끊는다 (Next `redirect.md`). 반드시 `try` 밖에서 부른다.
 */
function 돌아간다(run_id: string | null, 오류: string | null): never {
  const 주소 = new URLSearchParams()
  if (run_id !== null) 주소.set('run_id', run_id)
  if (오류 !== null) 주소.set('error', 오류)
  const 물음표 = 주소.size === 0 ? '' : `?${주소.toString()}`
  redirect(`/prompt-lab${물음표}`)
}

const 저장_폼 = z.object({
  run_id: z.uuid(),
  // ⭐ 실험할 수 있는 이름은 둘뿐이다. `experiment_prompts_name_check` 도 같은 값을 막고
  //    `repo/prompt-lab.ts` 도 한 번 더 본다 — 세 겹인 것은 이 표가 회차 결과를 바꾸기 때문이다.
  name: z.enum(['analysis', 'character']),
  // ⚠️ **다듬지 않는다.** 저장되는 글자가 사람이 넣은 것과 달라지면 무엇을 실험했는지 흐려진다.
  //    공백뿐인지만 본다 (`service` 도 같은 규칙으로 한 번 더 거른다).
  body: z.string().refine((글) => 글.trim().length > 0, '빈 프롬프트는 저장할 수 없다'),
})

/** zod 가 거부한 첫 까닭. 어느 칸이 왜 틀렸는지가 남아야 사람이 고친다. */
function zod_문구(오류: z.ZodError): string {
  const 건 = 오류.issues[0]
  if (건 === undefined) return 'BAD_REQUEST: 폼이 틀렸다'
  return `BAD_REQUEST: ${건.path.length === 0 ? '' : `${건.path.join('.')}: `}${건.message}`
}

export async function saveExperimentPromptAction(폼: FormData): Promise<void> {
  const run_id = 폼.get('run_id')
  const 읽음 = 저장_폼.safeParse({
    run_id,
    name: 폼.get('name') ?? '',
    body: 폼.get('body') ?? '',
  })
  if (!읽음.success) {
    돌아간다(typeof run_id === 'string' && run_id !== '' ? run_id : null, zod_문구(읽음.error))
  }

  let 오류: string | null = null
  try {
    await saveExperimentPromptStep(읽음.data)
  } catch (그것) {
    오류 = 오류_문구(그것)
  }
  돌아간다(읽음.data.run_id, 오류)
}
