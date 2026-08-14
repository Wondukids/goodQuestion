// 🔴 검사가 남의 DB 를 물지 않는가 (`tests/setup.ts` F-4 · `db/push-guard.ts`)
//
// ⚠️ **이 파일은 가드가 붙어 있는지를 못 잰다.** 가드는 `setup.ts` 가 파일을 읽는 순간
//    한 번 도는데, 그때 이미 통과했으니 이 검사가 도는 것이다. 여기서 재는 것은
//    **판정 규칙**이고, 「setup 에 실제로 배선됐나」는 진짜 vitest 를 원격 주소로
//    돌려서 확인했다 (2026-08-13 · `drizzle-kit push` 가드와 같은 방식).
//
// 🔴 그래서 이 파일만 초록인 것으로 안심하지 마라. `tests/setup.ts` 에서 그 두 줄이
//    사라져도 **여기는 그대로 초록이다.** 배선을 옮기면 실물로 다시 확인해라.

import { describe, expect, it } from 'vitest'

import { 검사_대상_가드 } from '@/llm/db/push-guard'

const 로컬 = 'postgresql://postgres:pw@localhost:5433/goodquestion_ts'

describe('검사_대상_가드', () => {
  it('로컬 개발 DB 는 통과시킨다', () => {
    expect(() => 검사_대상_가드(로컬)).not.toThrow()
    expect(() => 검사_대상_가드('postgresql://postgres:pw@127.0.0.1:5433/goodquestion_ts')).not.toThrow()
  })

  it('주소가 없으면 막지 않는다 — DB 를 안 무는 검사가 그대로 돌아야 한다', () => {
    expect(() => 검사_대상_가드(undefined)).not.toThrow()
    expect(() => 검사_대상_가드('')).not.toThrow()
    expect(() => 검사_대상_가드('   ')).not.toThrow()
  })

  it('🔴 저쪽(팀 레포) 라이브를 가리키면 터진다', () => {
    expect(() =>
      검사_대상_가드(
        'postgresql://postgres.uoiwtxezgdsgztimhqbj:pw@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres',
      ),
    ).toThrow(/검사를 막았다/)
  })

  it('⛔ 로컬이어도 파이썬 데모 백업(`goodquestion`)은 막는다', () => {
    expect(() => 검사_대상_가드('postgresql://postgres:pw@localhost:5433/goodquestion')).toThrow(
      /검사를 막았다/,
    )
  })

  it('못 읽는 주소는 「모르면 거부」다', () => {
    expect(() => 검사_대상_가드('주소가 아니다')).toThrow(/DATABASE_URL 을 읽지 못했다/)
  })

  it('막을 때 어디로 가야 하는지 알려 준다 — 대상·허용·다음 수', () => {
    let 문구 = ''
    try {
      검사_대상_가드('postgresql://postgres:pw@db.example.com:5432/postgres')
    } catch (e) {
      문구 = e instanceof Error ? e.message : String(e)
    }
    expect(문구).toContain('db.example.com / postgres') // 어디를 물었나
    expect(문구).toContain('goodquestion_ts') // 무엇이 허용인가
    expect(문구).toContain('tools/완주-저쪽DB.ts') // 저쪽에 쓰려면 어디로
    expect(문구).toContain('web/.env.local') // 로컬로 되돌리려면
  })
})
