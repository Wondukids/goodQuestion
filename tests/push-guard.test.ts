// `drizzle-kit push` 사고 가드를 세우는 검사 (이슈 #26 · 「다음 할 일」 0).
//
// ## 왜 검사가 필요한가
//
// 막는 대상이 **한 번 일어나면 끝인 사고**다 — 저쪽 DB 를 가리킨 채 push 하면
// 진짜 아이 계정이 든 `children` 을 비롯한 표 일곱이 `DROP TABLE CASCADE` 되고,
// 콘솔에만 있는 RLS 정책은 어떤 파일에도 없어 되돌릴 방법이 없다.
// 그래서 「가드가 있다」가 아니라 **「가드가 실제로 튕긴다」**를 재야 한다.
//
// ⚠️ 이 검사가 지키는 것이 셋이다. 담이 두 겹이고, 거기에 「눈」이 하나 붙는다.
//   1. 화이트리스트 — 아는 대상이 아니면 터진다 (`푸시_가드`)
//   2. `tablesFilter` — 그 담을 지나가도 우리 23표 밖을 안 본다 (`우리_표_이름들`)
//   3. `schemaFilter` — 반대쪽이다. 드리즐킷은 기본으로 `public` 만 보므로,
//      `gq_admin` 이 목록에서 빠지면 관리 11표가 `generate` 에서 **통째로 빠진다**
//      (`우리_스키마들`)
//
// 🔴 2번은 **비면 담이 통째로 사라진다** — 드리즐이 빈 배열을 「필터 없음」으로 보기 때문이다.
//    그래서 개수를 센다. 목록이 조용히 비는 것이 이 파일이 잡는 가장 중요한 것이다.
//
// 🔴 3번이 없던 시절의 함정: 표가 `public` 에서 `gq_admin` 으로 옮겨가도 **이름은 한 글자도
//    안 바뀐다.** 그래서 2번을 재는 검사(이름만 본다)는 전부 초록인 채로 11표가 사라진다.
//    아래 `우리_스키마들` 절이 그 자리를 잰다.

import { getTableName, is } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'

import {
  대상,
  우리_스키마들,
  우리_표_이름들,
  파괴적_명령인가,
  안전한_대상인가,
  푸시_가드,
} from '@/llm/db/push-guard'
import * as 스키마 from '@/llm/db/schema'

/** 우리 로컬 개발 DB. `.env.local` 이 가리키는 곳과 같은 모양이다. */
const 로컬 = 'postgresql://postgres:pw@localhost:5433/goodquestion_ts'

/** 저쪽 라이브 DB 모양 (호스트는 실물이 아니라 형태만). */
const 저쪽 = 'postgresql://postgres:pw@db.xxxxxxxx.supabase.co:5432/postgres'

/** 드리즐킷이 실제로 받는 argv 모양. 앞 둘은 노드와 실행 파일이다. */
function argv(...명령: string[]): string[] {
  return ['/usr/bin/node', '/repo/node_modules/.bin/drizzle-kit', ...명령]
}

describe('파괴적_명령인가', () => {
  it('push 를 잡는다', () => {
    expect(파괴적_명령인가(argv('push'))).toBe('push')
  })

  it('옛 판의 `push:pg` 꼴도 잡는다', () => {
    expect(파괴적_명령인가(argv('push:pg'))).toBe('push:pg')
  })

  it('DB 를 안 건드리는 명령은 그냥 지나간다', () => {
    expect(파괴적_명령인가(argv('generate'))).toBeNull()
    expect(파괴적_명령인가(argv('check'))).toBeNull()
    expect(파괴적_명령인가(argv())).toBeNull()
  })

  it('앞 두 자리(노드·실행 파일 경로)는 안 본다 — 경로에 push 가 들어 있어도', () => {
    expect(파괴적_명령인가(['/home/push/node', '/repo/push/drizzle-kit', 'generate'])).toBeNull()
  })
})

describe('대상', () => {
  it('호스트와 DB 이름을 꺼낸다', () => {
    expect(대상(로컬)).toEqual({ host: 'localhost', database: 'goodquestion_ts' })
  })

  it('IPv6 의 대괄호를 벗긴다', () => {
    expect(대상('postgresql://u:p@[::1]:5433/goodquestion_ts')?.host).toBe('::1')
  })

  it('못 읽는 주소는 null — 모르면 거부한다', () => {
    expect(대상('이건 주소가 아니다')).toBeNull()
    expect(대상(undefined)).toBeNull()
    expect(안전한_대상인가(undefined)).toBe(false)
  })
})

describe('푸시_가드', () => {
  it('🔴 저쪽 DB 를 가리킨 push 를 터뜨린다', () => {
    expect(() => 푸시_가드(argv('push'), 저쪽)).toThrow(/막았다/)
  })

  it('터질 때 어디를 가리켰는지 말한다 — 사람이 원인을 바로 보게', () => {
    expect(() => 푸시_가드(argv('push'), 저쪽)).toThrow(/supabase\.co/)
  })

  it('우리 로컬 개발 DB 면 지나간다', () => {
    expect(() => 푸시_가드(argv('push'), 로컬)).not.toThrow()
  })

  it('⛔ 로컬이어도 `goodquestion`(파이썬 데모 백업)이면 막는다', () => {
    expect(() => 푸시_가드(argv('push'), 'postgresql://u:p@localhost:5433/goodquestion')).toThrow()
  })

  it('모르는 로컬 DB 도 막는다 — 화이트리스트지 블랙리스트가 아니다', () => {
    expect(() => 푸시_가드(argv('push'), 'postgresql://u:p@localhost:5433/뭔가딴것')).toThrow()
  })

  it('주소를 못 읽으면 막는다', () => {
    expect(() => 푸시_가드(argv('push'), undefined)).toThrow()
  })

  it('⭐ `generate` 는 저쪽 주소를 물고도 돈다 — DB 를 안 건드리기 때문이다', () => {
    expect(() => 푸시_가드(argv('generate'), 저쪽)).not.toThrow()
  })
})

describe('우리_표_이름들 (둘째 담)', () => {
  const 이름들 = 우리_표_이름들()

  it('🔴 비지 않는다 — 비면 드리즐이 「필터 없음」으로 보고 담이 사라진다', () => {
    expect(이름들.length).toBeGreaterThanOrEqual(18)
  })

  it('엔진 표와 관리 표를 다 담는다', () => {
    expect(이름들).toContain('story_scenes') // 엔진 7
    expect(이름들).toContain('runs') // 관리 11
    expect(이름들).toContain('test_children')
  })

  it('⛔ 저쪽 표는 하나도 없다 — 있으면 push 가 그 표를 관리 대상으로 본다', () => {
    for (const 저쪽표 of [
      'parents',
      'children',
      'child_consents',
      'reports',
      'wordbook',
      'analysis_versions',
      'child_recommendations',
    ]) {
      expect(이름들).not.toContain(저쪽표)
    }
  })

  // 🔴 보호자 리포트(이슈 #35)가 저쪽 `reports`·`wordbook` 과 **쓰임이 겹쳐 보이는** 표 둘을
  //    새로 세웠다. 겹쳐 보인다는 것이 곧 「그냥 저쪽 걸 쓰자」는 유혹이라, 바꿔치기가
  //    일어나면 여기가 빨개지게 짝으로 못박는다. 저쪽 표를 선언에 넣는 순간 `tablesFilter` 에
  //    들어가고, 그 옆에는 진짜 아이 계정 8행이 든 `children` 이 선다 (명세 6.2).
  it('⛔ 리포트는 저쪽 `reports`·`wordbook` 이 아니라 우리 `parent_reports`·`child_words` 다', () => {
    expect(이름들).toContain('parent_reports')
    expect(이름들).toContain('child_words')
    expect(이름들).not.toContain('reports')
    expect(이름들).not.toContain('wordbook')
  })
})

/**
 * 선언에서 뽑은 「표 이름 → 사는 스키마」 대응.
 *
 * `push-guard.ts` 의 `우리_스키마들()` 과 **같은 방식으로** 뽑는다 — 드리즐의 `is()` 가 좁히게
 * 두고, `pgTable(...)` 이 주는 `schema: undefined` 는 `?? 'public'` 으로 되살린다.
 * 그래야 이 검사가 「구현이 무엇을 셌는지」가 아니라 **선언이 무엇인지**를 재게 된다.
 */
// ⚠️ `Map<string, string>` 을 명시한다. 안 적으면 열쇠 타입이 `getTableName` 이 주는
//    **표 이름 리터럴 열여덟 개의 합집합**으로 좁혀져서, 아래 `.get(표)` 에 맨 `string` 을
//    넣는 곳이 TS2345 로 죽는다 (이 파일의 `우리_표_이름들` 함정과 같은 뿌리다).
const 표별_스키마 = new Map<string, string>(
  Object.values(스키마)
    .filter((v) => is(v, PgTable))
    .map((표) => [getTableName(표), getTableConfig(표).schema ?? 'public'] as const),
)

/** `gq_admin` 으로 옮겨간 관리 도구 11표 (결정 5 · 4차 인계). */
const 관리_11표 = [
  'runs',
  'llm_calls',
  'turn_conditions',
  'scores',
  'corrections',
  'review_criteria',
  'seed_revisions',
  'experiment_prompts',
  'goldenset_runs',
  'goldenset_results',
  'test_children',
]

/**
 * `public` 에 남는 엔진 12표 (미션 3표는 sql/005 · 이슈 #17, 리포트 2표는 sql/006 · 이슈 #35).
 *
 * ⚠️ 표 이름은 `story_characters` 다 — `schema.ts` 의 내보내는 이름(`characters`)과 다르다.
 * 여기서 재는 것은 **DB 에 찍히는 이름**이라 선언 쪽 이름을 쓰면 안 된다.
 */
const 엔진_12표 = [
  'stories',
  'story_characters',
  'story_scenes',
  'story_sessions',
  'messages',
  'utterance_analyses',
  'post_activity_results',
  'story_missions',
  'mission_sessions',
  'mission_messages',
  // 보호자 리포트는 본 제품이 읽고 쓰는 표라 관리 도구가 아니다 (이슈 #35)
  'parent_reports',
  'child_words',
]

describe('우리_스키마들 (schemaFilter)', () => {
  const 스키마들 = 우리_스키마들()

  it('🔴 `gq_admin` 과 `public` 을 둘 다 담는다 — 하나라도 빠지면 그쪽 표가 안 보인다', () => {
    expect(스키마들).toContain('public')
    expect(스키마들).toContain('gq_admin')
  })

  it('중복 없이, 정렬해서 준다', () => {
    expect(스키마들).toEqual([...new Set(스키마들)])
    expect(스키마들).toEqual([...스키마들].sort())
  })

  it('⚠️ 지금은 이 둘뿐이다 — 스키마가 하나 더 생기면 여기가 빨개져 사람이 보게 된다', () => {
    expect(스키마들).toEqual(['gq_admin', 'public'])
  })

  it('손으로 박은 목록이 아니다 — 선언이 말하는 스키마와 같다', () => {
    expect(스키마들).toEqual([...new Set(표별_스키마.values())].sort())
  })
})

// 🔴 여기가 **표 이름만 보는 검사로는 못 잡는 자리**다.
// 관리 11표가 `gq_admin.table(...)` 에서 `pgTable(...)` 로 되돌아가도 `우리_표_이름들()` 은
// 한 글자도 안 바뀐다. 그래서 이름이 아니라 **어느 스키마에 사는지**를 따로 잰다.
describe('표가 어느 스키마에 사는가 (이름만으로는 못 잡는다)', () => {
  it('🔴 관리 11표는 전부 `gq_admin` 이다', () => {
    for (const 표 of 관리_11표) {
      expect(표별_스키마.get(표), `${표} 가 사는 스키마`).toBe('gq_admin')
    }
  })

  it('엔진 12표는 `public` 에 남는다 — 같이 끌려가지 않았는지', () => {
    for (const 표 of 엔진_12표) {
      expect(표별_스키마.get(표), `${표} 가 사는 스키마`).toBe('public')
    }
  })

  it('⚠️ 23표가 이 둘로 다 갈린다 — 어느 쪽에도 안 든 새 표가 있으면 빨개진다', () => {
    expect([...표별_스키마.keys()].sort()).toEqual([...관리_11표, ...엔진_12표].sort())
  })
})
