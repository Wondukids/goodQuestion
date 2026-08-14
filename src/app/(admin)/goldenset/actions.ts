'use server'

// 골든셋 화면이 누르는 단추 둘 (파이썬 `routes/goldenset.py` 의 POST 둘).
//
// ⛔ **여기에 규칙이 없다.** `app/(admin)/runs/actions.ts` 와 똑같이 셋만 한다 —
//    폼을 zod 로 읽고 · `service` 함수를 부르고 · 돌아갈 곳을 정한다
//    (`docs/설계/코드구조.md` 2절). 범위·키를 검사하는 규칙은 `service/goldenset.ts` 에 있다.
//    파이썬은 그 검사를 라우트(`_정수_칸`·`_키_칸`)에 뒀는데, 그러면 화면과 라우트가
//    서로 다른 잣대를 갖게 된다.
//
// ## 오류는 삼킨 뒤 주소에 실어 보낸다
//
// 라우트가 쓰는 **같은 표**(`app/api/_lib/envelope.ts` 의 `옮긴다()`)로 코드·문구를 뽑아
// `?error=` 로 넘긴다. `ValueError` 가 `BAD_REQUEST` 로 나가므로 파이썬의 400 과 같은 자리다.
//
// ## 왜 결과를 주소(`?run=`)로 넘기나
//
// 파이썬은 POST 응답에 결과를 **그 자리에서** 렌더했다. 서버 액션은 그렇게 못 한다 —
// 액션은 값을 화면에 직접 실어 주지 않고 리다이렉트로 끝난다. 그런데 **원자료는 이미
// `goldenset_runs`·`goldenset_results` 에 전부 남는다**(그게 이 화면의 존재 이유다).
// 그래서 판 id 만 주소에 실으면 화면이 그 판을 되살려 그린다 — 새로고침해도 같고,
// 어제 돌린 판도 주소만 있으면 그대로 다시 보인다. **점수를 두 번 계산하지 않는다.**

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { runGoldensetItem, startGoldensetRun } from '@/llm/service/goldenset'

import { 옮긴다 } from '@/llm/controller/envelope'

/** 실패를 사람이 읽을 한 줄로. 라우트가 쓰는 표를 그대로 쓴다. */
function 오류_문구(오류: unknown): string {
  const { error } = 옮긴다(오류)
  return `${error.code}: ${error.message}`
}

/** 폼 칸 하나. 빈 문자열은 「안 적었다」이므로 `null` 로 본다. */
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

/** 성공이면 그 판으로, 실패면 `?error=` 를 달아 돌아간다. */
function 돌아간다(file: string | null, run_id: string | null, 오류: string | null): never {
  const 칸들 = new URLSearchParams()
  if (file !== null) 칸들.set('file', file)
  if (run_id !== null) 칸들.set('run', run_id)
  if (오류 !== null) 칸들.set('error', 오류)
  const 물음표 = 칸들.size === 0 ? '' : `?${칸들.toString()}`
  // ⚠️ `redirect()` 는 **던져서** 흐름을 끊는다 (Next `redirect.md`). `try` 밖에서 부른다.
  redirect(`/goldenset${물음표}`)
}

/**
 * 비어 있으면 `null`(안 줬다), 값이 있으면 정수로 (파이썬 `_정수_칸()`).
 *
 * **조용히 0 이나 기본값으로 때우지 않는다.** 「43번째부터」라고 쓰려다 오타가 나면
 * 1번부터 43건이 통째로 다시 돌아 돈이 나간다.
 */
const 정수칸 = z.coerce.number().int().nullable()

const 돌리기_폼 = z.object({
  file: z.string().nullable(),
  offset: 정수칸,
  limit: 정수칸,
  key: z.coerce.number().int(),
  per_minute: 정수칸,
  reviewed_only: z.boolean(),
})

/**
 * 정답지의 한 조각을 실제 분석 LLM 으로 돌린다. **돈이 들고 느리다.**
 *
 * ⭐ `reviewed_only` 가 CLI `--검수완료만` 이다. 켜면 검수 끝난 것만 돌고,
 *    자르기(`offset`·`limit`)는 **거른 뒤**에 먹는다 (파이썬 `main()` 과 같은 차례).
 */
export async function runGoldensetAction(폼: FormData): Promise<void> {
  const file = 칸(폼, 'file')
  const 읽음 = 돌리기_폼.safeParse({
    file,
    offset: 칸(폼, 'offset'),
    limit: 칸(폼, 'limit'),
    key: 칸(폼, 'key') ?? 1,
    per_minute: 칸(폼, 'per_minute'),
    reviewed_only: 폼.get('reviewed_only') !== null,
  })
  if (!읽음.success) 돌아간다(file, null, zod_문구(읽음.error))

  let run_id: string | null = null
  let 오류: string | null = null
  try {
    const 결과 = await startGoldensetRun({
      file: 읽음.data.file,
      offset: 읽음.data.offset,
      limit: 읽음.data.limit,
      key: 읽음.data.key,
      per_minute: 읽음.data.per_minute,
      reviewed_only: 읽음.data.reviewed_only,
      started_by: 'admin-web',
    })
    run_id = 결과.goldenset_run_id
  } catch (그것) {
    오류 = 오류_문구(그것)
  }
  돌아간다(file, run_id, 오류)
}

const 한건_폼 = z.object({
  file: z.string().nullable(),
  item_id: z.string().min(1),
  key: z.coerce.number().int(),
  per_minute: 정수칸,
})

/** 항목 하나만 돌린다. 그것도 한 판으로 남는다 — 지문과 원자료가 같이 남아야 견줄 수 있다. */
export async function runGoldensetItemAction(폼: FormData): Promise<void> {
  const file = 칸(폼, 'file')
  const 읽음 = 한건_폼.safeParse({
    file,
    item_id: 칸(폼, 'item_id') ?? '',
    key: 칸(폼, 'key') ?? 1,
    per_minute: 칸(폼, 'per_minute'),
  })
  if (!읽음.success) 돌아간다(file, null, zod_문구(읽음.error))

  let run_id: string | null = null
  let 오류: string | null = null
  try {
    const 결과 = await runGoldensetItem({
      file: 읽음.data.file,
      item_id: 읽음.data.item_id,
      key: 읽음.data.key,
      per_minute: 읽음.data.per_minute,
      started_by: 'admin-web',
    })
    run_id = 결과.goldenset_run_id
  } catch (그것) {
    오류 = 오류_문구(그것)
  }
  돌아간다(file, run_id, 오류)
}
