// 🔴 `drizzle-kit push` 사고 가드 (이슈 #26 · 「다음 할 일」 0)
//
// ## 무엇을 막나
//
// `push` 는 `db/schema.ts` 를 DB 에 그대로 찍어 낸다 — **선언에 없는 표는 지운다.**
// `drizzle.config.ts` 는 `DATABASE_URL` 하나만 보고 그 값에 아무 필터가 없어서,
// 저쪽(팀 레포 Supabase)을 가리킨 채 한 번 돌리면 우리 선언에 없는 저쪽 표 일곱 —
// `parents` · `children` · `child_consents` · `reports` · `wordbook` ·
// `analysis_versions` · `child_recommendations` — 이 `DROP TABLE CASCADE` 된다.
// 🔴 `children` 8행은 **진짜 아이 계정**이다.
//
// 게다가 저쪽 RLS 정책은 **콘솔에만 있고 어떤 파일에도 없다**(`schema.sql` 에도 없다).
// 표가 살아남아도 정책은 되돌릴 방법이 없다.
//
// ## 어떻게 막나 — 두 겹이다
//
// 1. **화이트리스트** (`푸시_가드`) — 「저쪽이면 막는다」가 아니라 **「아는 곳이 아니면 막는다」**.
//    새 호스트가 생겨도 기본이 거부다.
// 2. **`tablesFilter`** (`우리_표_이름들`) — 1번을 어떻게든 지나가도 push 가 **우리 18표 밖을
//    아예 안 본다.** 명령줄과 상관없이 서는 담이라 1번이 조용히 사라져도 남는다.
//
// ⚠️ 저쪽 스키마를 바꿔야 하면 push 가 아니라 `generate` 로 SQL 을 뽑아 사람이 읽고
//    마이그레이션으로 적용한다. 이건 이 레포의 영구 규칙이다 (CLAUDE.md · 요청서 머리말).
//
// ## 담이 아니라 **눈**인 것 — `schemaFilter` (`우리_스키마들`)
//
// 관리 도구 11표가 `public` 에서 `gq_admin` 스키마로 옮겨갔다 (결정 5). 그런데 드리즐킷의
// `schemaFilter` 는 **기본값이 `['public']`** 이라, 그대로 두면 `generate` · `push` 가
// `gq_admin` 을 **아예 못 본다** — 11표가 마이그레이션에서 통째로 빠지고 아무도 안 아프다.
// 위 둘이 「너무 많이 보는 것」을 막는 담이라면 이건 **「너무 적게 보는 것」을 막는** 자리다.
//
// 🔴 두 목록 다 **손으로 박지 않는다** — `db/schema.ts` 선언에서 뽑는다.
//    박아 두면 스키마나 표가 하나 더 생긴 날 목록만 낡고, 낡은 것을 알려 주는 사람이 없다.

import { getTableName, is } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'

import * as 스키마 from './schema'

/** 대상 DB 를 통째로 다시 찍는 명령. 옛 판의 `push:pg` 꼴도 같이 잡는다. */
const 파괴적 = ['push']

/** 화이트리스트 — 여기서만 `push` 가 돈다. */
const 허용_호스트 = ['localhost', '127.0.0.1', '::1']

/**
 * ⛔ `goodquestion` 은 파이썬 데모 백업이라 **일부러 뺐다** (CLAUDE.md).
 * 호스트가 로컬이어도 그쪽을 가리키면 막는다.
 */
const 허용_DB = ['goodquestion_ts']

/**
 * 검사가 물어도 되는 대상인가 — `tests/setup.ts` 가 쓴다.
 *
 * 🔴 **`push` 만 위험한 게 아니다.** `vitest` 는 진짜 DB 에 행을 **넣고 지운다**
 *    (`tests/` 27파일 중 DB 를 무는 것이 11파일). 그래서 `DATABASE_URL` 이 저쪽
 *    라이브를 가리킨 채 `npx vitest run` 을 치면 **남의 DB 에 검사용 쓰레기가 쌓인다.**
 *
 * ⭐ 이 위험은 2026-08-13 에 실물이 됐다 — 루트 `.env.local` 하나로 env 를 모으면서
 *    저쪽 라이브 주소가 **이 워크트리의 기본값**이 됐다. 그날은 「셸로 로컬 주소를 실어서」
 *    피했는데, 그건 사람 기억에 기대는 방식이라 언젠가 잊는다.
 *
 * ⚠️ **주소가 아예 없으면 막지 않는다.** DB 를 안 무는 검사 사백여 건은 그대로 돌아야 하고,
 *    DB 검사는 어차피 제 자리에서 「DATABASE_URL 이 없다」로 죽는다. 여기서 겹쳐 막으면
 *    CI 처럼 DB 없이 도는 자리를 못 쓴다.
 *
 * 화이트리스트는 `push` 와 **같은 것을 쓴다** — 목록이 둘이 되면 한쪽만 낡는다.
 */
export function 검사_대상_가드(url: string | undefined): void {
  if (url === undefined || url.trim() === '') return
  if (안전한_대상인가(url)) return

  const t = 대상(url)
  const 어디 = t === null ? '(DATABASE_URL 을 읽지 못했다)' : `${t.host} / ${t.database}`

  throw new Error(
    [
      '',
      '🔴 검사를 막았다 — `DATABASE_URL` 이 우리 로컬 개발 DB 가 아니다.',
      '',
      `   대상: ${어디}`,
      `   허용: ${허용_호스트.join('·')} 의 ${허용_DB.join('·')} 뿐`,
      '',
      '   검사는 진짜 DB 에 행을 넣고 지운다. 저쪽(팀 레포) 라이브를 가리킨 채 돌리면',
      '   남의 DB 에 검사용 회차·메시지가 쌓이고, 지우는 검사가 남의 행을 지울 수도 있다.',
      '',
      '   저쪽 DB 로 무언가를 하려면 검사가 아니라 —',
      '     • 회차를 돌린다      : npx tsx tools/완주-저쪽DB.ts',
      '     • 표를 들여다본다    : npx tsx tools/저쪽DB-지켜보기.ts',
      '   로컬로 돌리려면 `web/.env.local` 에 로컬 `DATABASE_URL` 한 줄을 두면 된다',
      '   (`web/` 가 레포 루트보다 먼저 읽히고 먼저 읽은 값이 이긴다).',
      '',
    ].join('\n'),
  )
}

/** argv 에 파괴적 명령이 있으면 그 낱말을, 없으면 `null`. */
export function 파괴적_명령인가(argv: readonly string[]): string | null {
  for (const 낱말 of argv.slice(2)) {
    const 앞 = 낱말.split(':')[0]
    if (파괴적.includes(앞)) return 낱말
  }
  return null
}

/** 접속 문자열에서 호스트와 DB 이름만 꺼낸다. 못 읽으면 `null` (그때는 막는 쪽으로 판정한다). */
export function 대상(url: string | undefined): { host: string; database: string } | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return {
      host: u.hostname.replace(/^\[|\]$/g, ''), // IPv6 는 `[::1]` 로 온다
      database: decodeURIComponent(u.pathname.replace(/^\//, '')),
    }
  } catch {
    return null
  }
}

/** 화이트리스트에 든 대상인가. **못 읽은 주소는 아니라고 본다** (모르면 거부). */
export function 안전한_대상인가(url: string | undefined): boolean {
  const t = 대상(url)
  if (t === null) return false
  return 허용_호스트.includes(t.host) && 허용_DB.includes(t.database)
}

/**
 * `drizzle.config.ts` 가 불린다. 파괴적 명령 + 모르는 대상이면 **여기서 터진다.**
 *
 * ⚠️ 터뜨리는 것 말고 다른 일을 하지 않는다 — `generate` 는 DB 를 안 건드리므로
 *    저쪽 주소를 물고도 그대로 돈다.
 */
export function 푸시_가드(argv: readonly string[], url: string | undefined): void {
  const 명령 = 파괴적_명령인가(argv)
  if (명령 === null) return
  if (안전한_대상인가(url)) return

  const t = 대상(url)
  const 어디 = t === null ? '(DATABASE_URL 을 읽지 못했다)' : `${t.host} / ${t.database}`

  throw new Error(
    [
      '',
      `🔴 \`drizzle-kit ${명령}\` 을 막았다 — 대상이 우리 로컬 개발 DB 가 아니다.`,
      '',
      `   대상: ${어디}`,
      `   허용: ${허용_호스트.join('·')} 의 ${허용_DB.join('·')} 뿐`,
      '',
      '   push 는 `db/schema.ts` 에 없는 표를 지운다. 저쪽(팀 레포) DB 를 가리킨 채 돌리면',
      '   진짜 아이 계정이 든 `children` 을 비롯한 표 일곱이 DROP TABLE CASCADE 되고,',
      '   콘솔에만 있는 RLS 정책은 되돌릴 방법이 없다.',
      '',
      '   저쪽 스키마를 바꾸려면 push 가 아니라 —',
      '     1) `npx drizzle-kit generate` 로 SQL 을 뽑고',
      '     2) 사람이 읽고',
      '     3) 마이그레이션으로 적용한다.',
      '',
    ].join('\n'),
  )
}

/**
 * `db/schema.ts` 가 선언한 표 이름 전부. `drizzle.config.ts` 의 `tablesFilter` 가 이걸 쓴다.
 *
 * 🔴 **비면 안 된다.** 드리즐은 빈 필터를 「필터 없음」으로 보므로, 이 목록이 조용히 비면
 * 담이 통째로 사라진다. `tests/push-guard.test.ts` 가 개수를 세는 이유다.
 */
export function 우리_표_이름들(): string[] {
  return Object.values(스키마)
    .filter((v) => is(v, PgTable))
    .map((표) => getTableName(표))
    .sort()
}

/**
 * `db/schema.ts` 가 선언한 표들이 **어느 스키마에 사는지** 전부. `drizzle.config.ts` 의
 * `schemaFilter` 가 이걸 쓴다.
 *
 * 🔴 **`['public','gq_admin']` 을 손으로 박지 않는다.** 스키마가 하나 더 생기는 날
 * 여기만 낡으면 그 스키마의 표가 `generate` 에서 조용히 빠진다 — 아무도 안 아픈 종류의 사고다.
 *
 * ⚠️ `pgTable(...)` 로 그냥 선언한 표는 드리즐이 `schema: undefined` 로 준다. 「스키마가 없다」가
 * 아니라 **「기본 스키마(`public`)」**라는 뜻이라 `?? 'public'` 으로 되살린다.
 *
 * ⚠️ `is(v, PgTable)` 로 거르는 모양은 위 `우리_표_이름들()` 과 같다. 여기서 명시 타입 술어
 * (`(v): v is PgTable`)를 쓰면 TS2345 가 난다 — `Object.values()` 가 준 표별 구체 타입에
 * `PgTable` 이 대입되지 않기 때문이다. 드리즐의 `is()` 가 좁히게 그대로 둔다.
 */
export function 우리_스키마들(): string[] {
  const 스키마들 = Object.values(스키마)
    .filter((v) => is(v, PgTable))
    .map((표) => getTableConfig(표).schema ?? 'public')
  return [...new Set(스키마들)].sort()
}
