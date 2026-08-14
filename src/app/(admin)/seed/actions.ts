'use server'

// 시드 작업대가 누르는 단추 둘 (이슈 #26 화면-2).
//
// ⛔ **여기에 규칙이 없다.** 하는 일은 셋뿐이다 — 폼을 zod 로 읽고 · `service/seed.ts` 를
//    부르고 · 돌아갈 곳을 정한다 (`docs/설계/코드구조.md` 2절).
//
// ## 왜 라우트가 아니라 서버 액션인가
//
// `app/(admin)/runs/actions.ts` 머리말과 같다 — 화면이 HTTP 로 자기 서버를 도로 두드릴
// 이유가 없고, 시드 편집은 계약 넷 안에 아예 없다 (관리 도구다).
//
// ## 오류는 삼킨 뒤 주소에 실어 보낸다
//
// 서버 액션이 그냥 터지면 Next 의 오류 화면이 뜬다. 파이썬 판은 **같은 화면을 다시 그리고
// 그 위에 경고를 얹었는데**(2026-08-11 사람이 정함 — 전에는 흰 페이지에 `{"detail": …}`
// 한 줄이었다), 여기서는 `?error=` 로 넘겨 같은 화면이 띠를 그린다. 어느 칸에서 났는지도
// 함께 넘긴다 (`?field=`) — 화면에 칸이 40개라 그것 없이는 못 찾는다.

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { saveSeedCell, undoSeedCell, 경고_칸자리 } from '@/lib/service/seed'

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
function 돌아간다(오류: string | null, 칸자리: string | null): never {
  if (오류 === null) redirect('/seed')
  const 물음 = new URLSearchParams({ error: 오류 })
  if (칸자리 !== null) 물음.set('field', 칸자리)
  redirect(`/seed?${물음.toString()}`)
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

/**
 * 누가 고쳤나. Tailscale 이 앞에 있으면 그 로그인 이름이 온다 (파이썬과 같은 헤더다).
 *
 * ⛔ 인증이 아니다 (`CLAUDE.md` 경계 6 — 인증·계정은 이 레포에 안 들어온다).
 *    이력에 이름을 적어 두는 것뿐이고, 없으면 `null` 이다.
 */
async function 고친_사람(): Promise<string | null> {
  return (await headers()).get('Tailscale-User-Login')
}

// ═══════════════════════════════════════════════════════════════════════════
// 한 칸 저장
// ═══════════════════════════════════════════════════════════════════════════

const 한칸_폼 = z.object({
  table_name: z.enum(['characters', 'story_scenes']),
  row_id: z.uuid(),
  column_name: z.string().min(1),
  // ⭐ **`min(1)` 이 아니다.** 빈 칸을 「칸이 아예 없다」로 치면 사람에게 기계 말이 뜬다.
  //    비울 수 있는 칸인지는 `service/seed.ts` 가 사람 말로 답한다.
  value: z.string(),
  origin: z.enum(['canon', 'draft']),
  json_key: z.string().nullable(),
})

export async function saveSeedCellAction(폼: FormData): Promise<void> {
  const 읽음 = 한칸_폼.safeParse({
    table_name: 칸(폼, 'table_name') ?? '',
    row_id: 칸(폼, 'row_id') ?? '',
    column_name: 칸(폼, 'column_name') ?? '',
    // `칸()` 을 안 쓴다 — 공백뿐인 값을 `null` 로 바꿔 버리면 「비울 수 없는 칸」 경고가 안 뜬다.
    value: 폼.get('value') ?? '',
    origin: 칸(폼, 'origin') ?? 'draft',
    json_key: 칸(폼, 'json_key'),
  })
  if (!읽음.success) 돌아간다(zod_문구(읽음.error), null)

  let 오류: string | null = null
  try {
    await saveSeedCell({ ...읽음.data, changed_by: await 고친_사람() })
  } catch (그것) {
    오류 = 오류_문구(그것)
  }
  돌아간다(
    오류,
    오류 === null
      ? null
      : 경고_칸자리(
          읽음.data.table_name,
          읽음.data.row_id,
          읽음.data.column_name,
          읽음.data.json_key,
        ),
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 되돌리기
// ═══════════════════════════════════════════════════════════════════════════

const 되돌리기_폼 = z.object({ revision_id: z.coerce.number().int().positive() })

export async function undoSeedRevisionAction(폼: FormData): Promise<void> {
  const 읽음 = 되돌리기_폼.safeParse({ revision_id: 칸(폼, 'revision_id') })
  if (!읽음.success) 돌아간다(zod_문구(읽음.error), null)

  let 오류: string | null = null
  try {
    await undoSeedCell({ revision_id: 읽음.data.revision_id, changed_by: await 고친_사람() })
  } catch (그것) {
    오류 = 오류_문구(그것)
  }
  돌아간다(오류, null)
}
