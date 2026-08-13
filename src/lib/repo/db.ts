// DB 연결. **여기가 드리즐 인스턴스를 만드는 유일한 곳이다.**
//
// 파이썬 `src/goodquestion/db.py` 의 `연결()` 자리다 (이슈 #26 저장-3~5).
//
// ## 커밋은 부르는 쪽이 한다 (결정 18)
//
// 이 파일도, `repo/*.ts` 의 어떤 함수도 트랜잭션을 여닫지 않는다.
// 한 턴의 경계는 서비스 층에 있고, 검사는 트랜잭션을 열어 끝나면 되돌린다
// (파이썬 `tests/conftest.py` 의 `db` 픽스처와 같은 방식).
// 그래서 repo 함수는 전부 첫 인자로 `Conn` 을 받는다 — 그 자리에 드리즐 인스턴스가
// 오든 트랜잭션이 오든 같은 코드가 돈다.
//
// ## 스키마 제네릭을 넘기지 않는 이유
//
// `db.query.*` (관계 질의)를 쓰지 않는다. 표는 `@/db/schema` 에서 직접 가져다 쓰므로
// 스키마를 제네릭으로 넘길 이유가 없고, 넘기면 `PostgresJsDatabase<스키마>` 와
// 트랜잭션 타입이 갈려 `Conn` 하나로 묶을 수 없게 된다.

import { drizzle } from 'drizzle-orm/postgres-js'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import postgres from 'postgres'

import { loadSettings } from '@/lib/config'

/**
 * repo 함수가 받는 것. **드리즐 인스턴스와 트랜잭션 둘 다 여기 들어간다.**
 *
 * `PgTransaction` 이 `PgDatabase` 를 상속하므로 둘의 공통 조상으로 받는다.
 */
export type Conn = PgDatabase<PostgresJsQueryResultHKT>

let 연결됨: { db: Conn; client: postgres.Sql } | null = null

/**
 * 드리즐 인스턴스. 처음 부를 때 붙고 그 뒤로는 같은 것을 돌려준다.
 *
 * 결정 19 — DB 가 유일한 정본이라 없으면 실행기가 돌지 않는다. 주소가 없으면 여기서 터진다.
 */
export function getDb(): Conn {
  if (연결됨 !== null) return 연결됨.db

  const database_url = loadSettings().database_url
  if (!database_url) {
    throw new Error('DATABASE_URL 이 없다 (web/.env.local 을 확인할 것)')
  }

  const client = postgres(database_url)
  연결됨 = { db: drizzle(client), client }
  return 연결됨.db
}

/**
 * 연결을 닫는다. **검사와 스크립트용이다** — 안 닫으면 프로세스가 안 끝난다.
 *
 * 웹 서버에서는 부르지 않는다. 다음에 `getDb()` 를 부르면 새로 붙는다.
 */
export async function closeDb(): Promise<void> {
  const 지금 = 연결됨
  연결됨 = null
  if (지금 !== null) await 지금.client.end()
}
