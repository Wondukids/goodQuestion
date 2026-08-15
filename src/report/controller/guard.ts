// 문지기 — **이 리포트가 내 아이 것인가** (명세 7절).
//
// 로그인한 보호자의 `parents.id`(= Supabase `auth.users.id`)로 `children` 을 타고 내려가
// 그 활동이 자기 아이 것인지 본다. 아니면 **404** 다 — `403` 이 아니고, 존재 여부도 알리지
// 않는다 (`envelope.ts` 의 `못찾음()` 머리말에 왜인지 적었다).
//
// ## 두 DB 를 잇는 자리라 여기 산다
//
// 아이 소유는 **저쪽(팀 Supabase RLS)**이 알고, 활동은 **우리 표**(`story_sessions`)에 있다.
// 한 트랜잭션으로 못 묶으므로 세션 열기(`src/session/controller/sessions.ts`)와 같은 방식을
// 쓴다 — **입구에서 한 번 확인하고**, 그 아래로는 아이 id 를 불투명 값으로 흘린다.
//
// ⚠️ 쿠키(`selected_child`)를 보지 않는다. 화면은 고른 아이의 리포트를 부르지만, 서버가
//    「고른 아이」를 믿으면 URL 의 다른 아이 id 로 부를 때 판단 기준이 두 개가 된다.
//    여기서 재는 것은 **URL 이 가리키는 아이가 이 보호자 것인가** 하나뿐이다.

import { createClient } from '@/lib/supabase/server'
import { getDb, type Conn } from '@/llm/repo/db'
import { readSessionIdentity } from '@/report/repo/materials'

/** 통과하면 아이 id 를 들고 나온다. 나머지 둘은 응답이 정해져 있다 (401 · 404). */
export type 문지기결과 =
  | { kind: '통과'; child_id: string }
  | { kind: '로그인없음' }
  | { kind: '못찾음' }

/**
 * 이 아이가 로그인한 보호자의 아이인가.
 *
 * RLS(`children_own`)가 이미 본인 것만 내주지만 조건을 명시한다 — 정책이 바뀌어도 새지
 * 않게 (`src/lib/selected-child.ts` 와 같은 규칙).
 */
export async function 아이_문지기(child_id: string): Promise<문지기결과> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { kind: '로그인없음' }

  const { data } = await supabase
    .from('children')
    .select('id')
    .eq('id', child_id)
    .eq('parent_id', user.id)
    .maybeSingle()

  return data ? { kind: '통과', child_id } : { kind: '못찾음' }
}

/**
 * 이 활동이 내 아이 것인가.
 *
 * 순서가 하나다 — 활동에서 **아이 id 를 꺼낸 뒤** 그 아이를 문지기에 태운다. 활동이 없을
 * 때와 남의 아이일 때가 **같은 결과**(`못찾음`)인 것이 이 함수의 요점이다.
 */
export async function 세션_문지기(session_id: string, conn?: Conn): Promise<문지기결과> {
  const 신원 = await readSessionIdentity(conn ?? getDb(), session_id)
  if (신원 === null) return { kind: '못찾음' }
  return 아이_문지기(신원.child_id)
}
