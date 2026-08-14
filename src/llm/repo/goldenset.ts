// 골든셋 판과 그 결과 (이슈 #26 · 화면-골든셋).
//
// 파이썬 `src/goodquestion_admin/저장.py` 의 골든셋 갈래 다섯을 옮긴 것이다
// (`골든셋_판_만들기` · `골든셋_결과_넣기` · `골든셋_판_끝내기` · `골든셋_판_목록` · `골든셋_판_결과`).
//
// ## 왜 결과를 한 건씩, 호출 직후에 넣나
//
// 30건을 돌리다 20번째에서 막히면 앞 19건은 **남아야 한다.** 그래서 판을 먼저 만들고
// 호출이 돌아올 때마다 한 행씩 넣는다. `created_at` 이 `clock_timestamp()` 인 것도
// 같은 이유다 — 한 트랜잭션 안에서도 호출 간격이 보존돼야 「어디서 느려졌나」가 보인다.
//
// ## 판정 불가와 「틀렸다」는 CHECK 가 갈라 준다
//
// `goldenset_results_judgment_check` 가 `unjudged_reason` 과 `got_*` 셋의 짝을 강제한다.
// 그래서 **여기서 그 짝을 다시 검사하지 않는다** — 어기면 DB 가 거절한다.

import { and, asc, desc, eq, sql } from 'drizzle-orm'

import { goldenset_results, goldenset_runs } from '@/llm/db/schema'
import { LookupError } from '@/llm/domain/progress'

import type { Conn } from './db'

/** `goldenset_runs` 한 행. */
export type GoldensetRunRow = typeof goldenset_runs.$inferSelect

/** `goldenset_results` 한 행. */
export type GoldensetResultRow = typeof goldenset_results.$inferSelect

/**
 * 판 하나를 연다 (파이썬 `골든셋_판_만들기()`).
 *
 * ⚠️ `file_item_count` 는 **조각 크기가 아니라 정답지 파일 전체 건수**다. 10건씩 나눠
 *    돌려도 「73건짜리 파일의 한 조각」임이 남아야 나중에 판끼리 견줄 수 있다.
 */
export async function createGoldensetRun(
  conn: Conn,
  값: {
    file_name: string
    file_digest: string
    file_item_count: number
    prompt_digest: string
    prompt_label: string | null
    requested_model: string
    started_by: string | null
    note: string | null
  },
): Promise<GoldensetRunRow> {
  const 행들 = await conn.insert(goldenset_runs).values(값).returning()
  return 행들[0]
}

/** 항목 하나의 결과 (파이썬 `골든셋_결과_넣기()`). */
export async function insertGoldensetResult(
  conn: Conn,
  값: {
    goldenset_run_id: string
    item_id: string
    item_review: string
    unjudged_reason: string | null
    got_model: string | null
    expected_child_intent: string
    expected_validity: string
    expected_elements: readonly string[]
    got_child_intent: string | null
    got_validity: string | null
    got_elements: readonly string[] | null
    got_main_point: string | null
  },
): Promise<GoldensetResultRow> {
  const 행들 = await conn
    .insert(goldenset_results)
    .values({
      ...값,
      // 읽기 전용 배열로 와도 `text[]` 로 나가게 여기서 목록으로 굳힌다.
      expected_elements: [...값.expected_elements],
      got_elements: 값.got_elements === null ? null : [...값.got_elements],
    })
    .returning()
  return 행들[0]
}

/**
 * 판을 닫는다 (파이썬 `골든셋_판_끝내기()`).
 *
 * 끝난 시각은 **처음 한 번만** 찍는다. 시각이 `now()` 가 아니라 `clock_timestamp()` 인 것은
 * 한 트랜잭션에서 여러 판을 끝내도 순서가 남아야 하기 때문이다.
 *
 * ⚠️ 파이썬은 `note=coalesce(:note, note)` 로 「새 메모가 있을 때만 덮는다」를 SQL 로 썼다.
 *    여기서는 `note` 가 `null` 이면 **칸을 아예 안 건드린다** — 결과가 같고,
 *    타입 없는 `NULL` 파라미터를 `coalesce` 에 넣지 않아도 된다.
 */
export async function endGoldensetRun(
  conn: Conn,
  goldenset_run_id: string,
  { note = null }: { note?: string | null } = {},
): Promise<GoldensetRunRow> {
  const 행들 = await conn
    .update(goldenset_runs)
    .set({
      ended_at: sql`coalesce(${goldenset_runs.ended_at}, clock_timestamp())`,
      ...(note === null ? {} : { note }),
    })
    .where(eq(goldenset_runs.id, goldenset_run_id))
    .returning()
  if (행들.length === 0) throw new LookupError(`골든셋 판이 없다: ${goldenset_run_id}`)
  return 행들[0]
}

/** 판 목록 (최근 것이 위) — 파이썬 `골든셋_판_목록()`. */
export async function listGoldensetRuns(conn: Conn, limit: number): Promise<GoldensetRunRow[]> {
  return conn
    .select()
    .from(goldenset_runs)
    .orderBy(desc(goldenset_runs.started_at), desc(goldenset_runs.id))
    .limit(limit)
}

/** 판 하나. 없으면 터진다 — 「없는 판」을 빈 화면으로 보여 주면 안 돌린 것과 구별이 안 된다. */
export async function readGoldensetRun(
  conn: Conn,
  goldenset_run_id: string,
): Promise<GoldensetRunRow> {
  const 행들 = await conn
    .select()
    .from(goldenset_runs)
    .where(eq(goldenset_runs.id, goldenset_run_id))
    .limit(1)
  if (행들.length === 0) throw new LookupError(`골든셋 판이 없다: ${goldenset_run_id}`)
  return 행들[0]
}

/** 판 하나의 결과들 (넣은 차례대로) — 파이썬 `골든셋_판_결과()`. */
export async function readGoldensetRunResults(
  conn: Conn,
  goldenset_run_id: string,
): Promise<GoldensetResultRow[]> {
  return conn
    .select()
    .from(goldenset_results)
    .where(eq(goldenset_results.goldenset_run_id, goldenset_run_id))
    .orderBy(asc(goldenset_results.created_at), asc(goldenset_results.id))
}

/**
 * 이 판에 이 항목의 결과가 이미 있나.
 *
 * `goldenset_results_run_item_key` 가 (판, 항목) 중복을 막으므로 한 건씩 다시 돌릴 때
 * 부르는 쪽이 미리 볼 수 있게 둔다.
 */
export async function hasGoldensetResult(
  conn: Conn,
  { goldenset_run_id, item_id }: { goldenset_run_id: string; item_id: string },
): Promise<boolean> {
  const 행들 = await conn
    .select({ id: goldenset_results.id })
    .from(goldenset_results)
    .where(
      and(
        eq(goldenset_results.goldenset_run_id, goldenset_run_id),
        eq(goldenset_results.item_id, item_id),
      ),
    )
    .limit(1)
  return 행들.length > 0
}
