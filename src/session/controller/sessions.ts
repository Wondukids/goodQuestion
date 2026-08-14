// 세션 열기 — `POST /api/sessions` (`docs/이야기_세션_명세.md` 4.1절 · 이슈 #6).
//
// 아이 확인(`selected_child` 쿠키 → `child_id`)은 **여기 입구에서 한 번**이고, 그 아래로는
// 불투명 값이다 (명세 4절 서두 — 아이 소유 확인은 저쪽 DB, 세션은 이쪽 표라서 한 트랜잭션으로
// 못 묶는다). 쿠키가 없으면 401 — 계약 표에 없는 자리라 코드는 `CHILD_NOT_SELECTED` 로 새로
// 하나 적는다 (봉투 모양은 그대로).

import { z } from 'zod'

import { getSelectedChild } from '@/lib/selected-child'
import { openSession } from '@/session/service/open'

import { fail, failed, ok } from './envelope'

const 본문 = z.strictObject({ story: z.string().min(1) })

export async function POST(request: Request): Promise<Response> {
  const 아이 = await getSelectedChild()
  if (아이 === null) {
    return fail(401, {
      code: 'CHILD_NOT_SELECTED',
      message: '고른 아이가 없다 — 아이를 고른 뒤 다시 열어라',
      retryable: false,
    })
  }

  const 읽음 = 본문.safeParse(await request.json().catch(() => null))
  if (!읽음.success) {
    return fail(400, {
      code: 'BAD_REQUEST',
      message: '요청 body 는 { story: string } 이어야 한다',
      retryable: false,
    })
  }

  try {
    return ok(await openSession({ child_id: 아이.id, story: 읽음.data.story }))
  } catch (오류) {
    return failed(오류)
  }
}
