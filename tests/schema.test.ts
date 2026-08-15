// `db/schema.ts` 의 표 선언이 **살아 있는 DB** 와 어긋나면 여기서 빨개진다.
//
// 파이썬 `tests/test_표정의.py` 의 자리다 (이슈 #26 · 관리 표 8개 이식).
//
// ## 왜 필요한가
//
// 스키마의 정의는 `sql/001_schema.sql` · `sql/003_admin.sql` 이고 `db/schema.ts` 는
// 그것을 타입스크립트로 **베낀 사본**이다. 사본은 조용히 낡는다 — 누가 sql 파일에 컬럼을
// 하나 더해도 선언은 모르고, 그러면 질의가 런타임에야 죽는다.
// ⚠️ 여기서는 사본이 스키마 주인이기도 하다(`drizzle-kit push` 가 DB 를 만든다).
//    그래서 「선언 ↔ DB」 대조만으로는 **선언에서 아예 빠뜨린 것**을 못 잡는다 — 선언에 없으면
//    DB 에도 없어 양쪽이 사이좋게 틀린다. 그 구멍은 「sql 파일 ↔ 선언」을 곧바로 견주는
//    두 검사가 막는다 (표 이름 · 이름 붙은 제약. 아래 1번과 6번).
//
// ## 무엇을 대조하나
//
// 1. **표 이름** — sql 파일의 `CREATE TABLE` ↔ `db/schema.ts` 의 `pgTable` (DB 없이 돈다)
// 2. **표 이름** — 선언 ↔ DB 에 실제로 선 표
// 3. **컬럼 이름 · 타입 · NULL 허용 · 기본값** — 앞의 셋은 파이썬 판이 대조하던 그대로다.
//    기본값은 한 칸 더 간 것이다 — `clock_timestamp()` 를 `now()` 로 흘리면 같은 초에 저장한
//    칸들의 순서가 사라지는데, 컬럼·타입 대조로는 그게 안 잡힌다.
// 4. **이름 붙은 제약(CHECK · UNIQUE)** — 파이썬 판보다 한 칸 더 간다.
//    ⭐ 이식에서 가장 잘 새는 것이 CHECK 다. 컬럼은 안 쓰면 눈에 띄지만
//    빠뜨린 CHECK 는 **아무도 안 아프고 잘못된 행만 들어온다.**
// 5. **FK · PK** — **이름이 아니라 내용으로** 견준다
//    (`run_id → runs(id) ON DELETE cascade`). 드리즐이 제약 이름을 스스로 짓기 때문에
//    이름을 견주면 이름 규칙 검사가 되어 버린다. 반면 `ON DELETE` 는 내용이고,
//    003 의 FK 가 001 의 CASCADE 를 무력화한 파이썬 판의 사고가 바로 이 자리였다
//    (`db/schema.ts` 관리 도구 절 머리말).
// 6. **sql 파일이 이름 붙여 건 제약** ↔ 선언 (DB 없이 돈다). 4번이 못 보는 자리를 막는다.
// 7. **그 CHECK 가 어떤 칸을 보는지** — sql 파일 ↔ 선언 (DB 없이 돈다).
//    ⚠️ 4·6번은 **이름만** 견준다. 그래서 「`dialogue_scene_needs_all_parts` 에서
//    `conflict` 한 줄을 뺀다」 같은 고침이 이름을 안 바꾸므로 **셋 다 초록으로 통과한다.**
//    결정 74 가 고친 것이 바로 그 본문이라, 본문을 재는 자리를 여기 하나 냈다.
// 8. **실제로 튕기나** — 살아 있는 DB 에 나쁜 행을 넣어 본다 (되돌린다).
//    1~7 은 전부 「적힌 것끼리」 견준다. 「셋 다 고쳤다」와 「DB 가 막는다」는 다른 말이다.
//
// 인덱스는 대조하지 않는다. 없어도 결과가 안 바뀌기 때문이다.
//
// ## 견주는 단위는 **`스키마.표`** 다
//
// 관리 도구 11표는 `gq_admin` 에, 엔진 7표는 `public` 에 선다 (결정 5 · 4차). 맨 이름만 견주면
// 「선언은 `gq_admin.runs` 인데 DB 에는 `public.runs` 가 서 있다」를 **못 본다** — 양쪽 다 `runs`
// 라서 사이좋게 초록이다. 표가 옮겨가는 이식에서 정확히 새는 자리가 거기라, 1~7 을 전부
// `스키마.표` 로 올려 견준다. sql 파일도 선언도 `public` 은 안 적으므로(드리즐은 `schema` 를
// `undefined` 로 준다) 없으면 `public` 으로 채워 정규화한다. DB 를 뒤지는 질의도 스키마를 손으로
// 박지 않고 **선언에서 뽑은 값**으로 건다 — 표가 또 옮겨가도 이 파일은 안 고친다.
//
// ## DB 가 없으면 **건너뛴다** — 조용히 통과시키지 않는다
//
// `tests/repo.test.ts` 와 같은 문지기다. `describe.skip` 이라 보고에 「skipped」로 뜬다.

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SQL, is, sql } from 'drizzle-orm'
import { PgDialect, PgTable, getTableConfig } from 'drizzle-orm/pg-core'
import type { PgColumn } from 'drizzle-orm/pg-core'
import { afterAll, describe, expect, it } from 'vitest'

import * as 스키마 from '@/llm/db/schema'
import { closeDb, getDb } from '@/llm/repo/db'

// ── 선언에서 표를 모은다 ──────────────────────────────────────────────────
//
// `import * as` 라 표를 하나 더해도 여기 손댈 것이 없다. 그게 목적이다.

// ⚠️ `Object.values(스키마)` 의 원소 타입은 표마다 다른 **구체 타입**이다
//    (`PgTableWithColumns<{ name: "stories"; … }>`). 거기에 `값 is PgTable` 술어를 바로 걸면
//    TS2677 이 난다 — 좁힌 타입(`PgTable<TableConfig>`)이 원래 타입에 안 들어가기 때문이다.
//    그래서 **한 번 넓혀 받는다.** `as` 로 뭉갠 것과 반대 방향이다: 좁은 타입을 `unknown` 으로
//    넓히는 것은 그냥 대입이고, 다시 좁히는 일은 런타임의 `is(값, PgTable)` 이 한다.
const 스키마의_값들: unknown[] = Object.values(스키마)

function 표인가(값: unknown): 값 is PgTable {
  return is(값, PgTable)
}

const 선언된_표 = 스키마의_값들.filter(표인가).map((표) => getTableConfig(표))

/** 견주는 단위. 스키마를 안 적은 쪽(`public`)을 채워 넣는다 — 드리즐은 `undefined` 로 준다. */
function 전체이름(표: { name: string; schema: string | undefined }): string {
  return `${표.schema ?? 'public'}.${표.name}`
}

const 선언된_표_이름 = 선언된_표.map((표) => 전체이름(표)).sort()

/** DB 질의에 걸 스키마 목록. 손으로 박지 않고 선언에서 뽑는다. */
const 선언된_스키마 = [...new Set(선언된_표.map((표) => 표.schema ?? 'public'))].sort()

function 선언찾기(표이름: string) {
  return 선언된_표.find((표) => 전체이름(표) === 표이름)!
}

// ── sql 파일이 만드는 표 이름 ─────────────────────────────────────────────

// ⚠️ 이 파일은 **레포 루트의 `tests/`** 에 있어 한 칸만 올라간다
//    (우리 레포에서는 `web/tests/` 라 두 칸이었다 — 착지 ④에서 고친 자리).
const 레포루트 = join(dirname(fileURLToPath(import.meta.url)), '..')
// 스키마는 있을 수도 없을 수도 있다 — 003 은 `CREATE TABLE gq_admin.runs`, 001 은 맨 이름이다.
const 표만들기 =
  /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:([a-z_][a-z0-9_]*)\.)?([a-z_][a-z0-9_]*)/gi

function sql파일_읽기(파일이름: string): string {
  return readFileSync(join(레포루트, 'sql', 파일이름), 'utf-8')
}

function sql파일의_표들(파일이름: string): string[] {
  // ⚠️ 스키마 자리(1번 그룹)는 안 맞으면 런타임에 `undefined` 다. 타입은 `string` 이지만
  //    (`noUncheckedIndexedAccess` 가 꺼져 있다) `전체이름` 이 그 자리를 `public` 으로 메운다.
  return [...sql파일_읽기(파일이름).matchAll(표만들기)].map((맞은것) =>
    전체이름({ name: 맞은것[2], schema: 맞은것[1] }),
  )
}

// ── sql 파일이 **이름 붙여** 건 제약 ──────────────────────────────────────
//
// 이 검사만 「sql 파일 ↔ 선언」을 곧바로 견준다. 나머지는 「선언 ↔ DB」인데,
// DB 를 `drizzle-kit push` 가 선언대로 만들므로 **선언에서 빠뜨린 CHECK 는 DB 에도 없다** —
// 즉 대조를 아무리 해도 안 잡힌다. 여기가 그 구멍을 막는 자리다.
//
// ⚠️ 이름이 안 붙은 제약(`CHECK (status IN …)` 처럼 컬럼 옆에 바로 쓴 것)은 못 본다.
//    포스트그레스가 지어 주는 이름(`stories_status_check`)을 여기서 흉내 내면
//    작명 규칙 검사가 되기 때문이다. 003 의 제약은 전부 이름이 붙어 있어 다 걸린다.
//
// ⚠️ **한 방향이다** — 「sql 파일에 있는데 선언에 없는 것」만 잡는다. 반대로 sql 파일에서만
//    제약을 지우면 아무 데도 안 걸린다(2026-08-13 결정 74 를 넣으며 깨뜨려 확인했다).
//    반대 방향을 막으려면 예외 목록이 있어야 하는데, 드리즐이 스키마 주인이 된 뒤로 001 은
//    이식 원본으로 남아 언제든 갈릴 수 있어 그 목록이 곧 낡는다. 그래서 안 건다.
//    (2026-08-13 현재 칸은 양쪽이 같다 — `stories.slug` · `story_scenes.code` ·
//     `utterance_analyses.created_at` 을 001 에 마저 적어 넣었다.)
const 이름붙은_제약 = /CONSTRAINT\s+([a-z_][a-z0-9_]*)\s+(?:CHECK|UNIQUE|PRIMARY\s+KEY)/gi

function sql파일의_제약이름들(파일이름: string): string[] {
  return [...sql파일_읽기(파일이름).matchAll(이름붙은_제약)].map((맞은것) => 맞은것[1])
}

// ── 그 CHECK 의 **본문** ─────────────────────────────────────────────────
//
// 이름만 견주면 본문을 통째로 갈아도 안 걸린다. 그렇다고 글자 그대로 견줄 수도 없다 —
// 선언 쪽은 드리즐이 `"story_scenes"."conflict"` 로 찍고 괄호·줄바꿈이 다르다.
// 그래서 **그 표의 칸 이름 중 무엇이 본문에 나오는가**만 뽑아 견준다.
// 서식에 안 흔들리고, 정작 새는 자리(칸 하나가 한쪽에서 빠지는 것)는 잡는다.

/** `CONSTRAINT 이름 CHECK ( … )` 의 괄호 안. 괄호 짝은 정규식으로 못 세어 손으로 센다. */
function sql파일의_CHECK본문(파일이름: string): Map<string, string> {
  const 글 = sql파일_읽기(파일이름)
  const 머리 = /CONSTRAINT\s+([a-z_][a-z0-9_]*)\s+CHECK\s*\(/gi
  const 본문 = new Map<string, string>()

  for (const 맞은것 of 글.matchAll(머리)) {
    let 자리 = 맞은것.index + 맞은것[0].length // 여는 괄호 **다음** 글자
    let 깊이 = 1
    for (; 자리 < 글.length && 깊이 > 0; 자리 += 1) {
      if (글[자리] === '(') 깊이 += 1
      else if (글[자리] === ')') 깊이 -= 1
    }
    본문.set(맞은것[1], 글.slice(맞은것.index + 맞은것[0].length, 자리 - 1))
  }
  return 본문
}

/** 본문에 나오는 그 표의 칸 이름들. 따옴표 안 문자열은 칸 이름과 헷갈리므로 먼저 지운다. */
function 언급된_칸(본문: string, 칸이름들: string[]): string[] {
  const 문자열_뺀_본문 = 본문.replace(/'(?:[^']|'')*'/g, ' ')
  return 칸이름들.filter((이름) => new RegExp(`\\b${이름}\\b`).test(문자열_뺀_본문)).sort()
}

/** 선언 쪽 제약 이름 — CHECK · UNIQUE(표 단위 · 컬럼 단위) · 이름 붙인 PK 를 다 모은다. */
function 선언된_제약이름들(): string[] {
  return 선언된_표
    .flatMap((표) => [
      ...표.checks.map((하나) => 하나.name),
      // ⚠️ `uniqueConstraints[].name` 과 `columns[].uniqueName` 은 타입이 `string | undefined` 다
      //    (드리즐이 이름을 안 지어 줄 수 있다). 이름이 없으면 견줄 것도 없으므로 떨군다.
      ...표.uniqueConstraints.map((하나) => 하나.name),
      ...표.columns.filter((칸) => 칸.isUnique).map((칸) => 칸.uniqueName),
      ...표.primaryKeys.map((하나) => 하나.getName()),
    ])
    .filter((이름): 이름 is string => 이름 !== undefined)
}

// ── 타입 이름을 같은 잣대로 ───────────────────────────────────────────────
//
// 한쪽은 우리가 쓴 것(`varchar`), 한쪽은 DB 에서 읽어 온 것(`character varying`)이라
// 글자 그대로는 못 견준다. 둘 다 **Postgres 가 쓰는 이름**으로 맞춰 놓고 비교한다.

const 같은_타입: Record<string, string> = {
  varchar: 'character varying',
  // serial 계열은 「정수 + 기본값 nextval」의 줄임말이다. DB 에는 정수로 선다.
  bigserial: 'bigint',
  serial: 'integer',
  smallserial: 'smallint',
  int: 'integer',
  int4: 'integer',
  int8: 'bigint',
  bool: 'boolean',
}

function 타입글자(글: string): string {
  const 소문자 = 글.toLowerCase()
  return 같은_타입[소문자] ?? 소문자
}

// ── 기본값도 같은 잣대로 ──────────────────────────────────────────────────
//
// 선언 쪽은 세 모양이다 — SQL 조각(`sql\`clock_timestamp()\``) · 값(`'draft'` · `0` · `[]`) ·
// 시퀀스(`bigserial`). DB 쪽은 `pg_get_expr` 이 준 한 줄이고 캐스트가 붙는다
// (`'draft'::character varying` · `'{}'::jsonb`). 캐스트를 떼고 견준다.

const 방언 = new PgDialect()

/** `bigserial`·`serial` — 값이 아니라 시퀀스다. DB 쪽은 `nextval(…)` 이면 맞는 것으로 본다. */
const 자동증가 = Symbol('자동증가')

function 선언한_기본값(칸: PgColumn): string | typeof 자동증가 | null {
  // `$defaultFn` 은 넣을 때 코드가 값을 만드는 것이라 DB 에는 기본값이 안 선다.
  if (!칸.hasDefault || 칸.defaultFn !== undefined) return null
  if (칸.default === undefined) return 자동증가
  if (is(칸.default, SQL)) return 방언.sqlToQuery(칸.default).sql
  // 배열 `[]` → `{}`, jsonb `{}` → `{}` 처럼 드라이버가 보내는 모양으로 바꾼 뒤 따옴표를 씌운다.
  const 값 = 칸.mapToDriverValue(칸.default)
  return typeof 값 === 'string' ? `'${값}'` : String(값)
}

function 기본값글자(글: string | null): string {
  if (글 === null) return '(없음)'
  return 글
    .replace(/::[a-z0-9_ [\]".]+/gi, '') // ::character varying · ::jsonb · ::text[]
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

// ── ON DELETE — 드리즐은 말로, DB 는 한 글자로 적는다 ─────────────────────

const 지울때_글자: Record<string, string> = {
  a: 'no action',
  r: 'restrict',
  c: 'cascade',
  n: 'set null',
  d: 'set default',
}

// ── DB 가 있나 (repo.test.ts 와 같은 문지기) ──────────────────────────────

async function 붙어보기(): Promise<string | null> {
  try {
    await getDb().execute(sql`select 1`)
    return null
  } catch (오류) {
    if (오류 instanceof Error && 오류.cause instanceof Error) {
      return `${오류.cause.name}: ${오류.cause.message}`
    }
    return 오류 instanceof Error ? `${오류.name}: ${오류.message}` : String(오류)
  }
}

const 못붙는_이유 = await 붙어보기()
if (못붙는_이유 !== null) {
  process.stderr.write(
    `\n[schema.test] Postgres 에 못 붙어 표 정의 대조를 건너뛴다 (도커가 꺼져 있나?)\n` +
      `              ${못붙는_이유}\n` +
      `              되살리려면: 도커 goodquestion-postgres 를 켜고 web/.env.local 의 DATABASE_URL 을 확인한다\n\n`,
  )
}
const 검사 = 못붙는_이유 === null ? describe : describe.skip

afterAll(async () => {
  await closeDb()
})

// ── DB 없이 도는 검사 ─────────────────────────────────────────────────────

describe('sql 파일과 표 선언', () => {
  it('sql 파일의 표가 전부 schema.ts 에 있고, 그 반대도 그렇다', () => {
    const 적힌_표 = [
      ...sql파일의_표들('001_schema.sql'),
      ...sql파일의_표들('003_admin.sql'),
      ...sql파일의_표들('005_missions.sql'),
      ...sql파일의_표들('006_parent_report.sql'),
      ...sql파일의_표들('007_post_activity.sql'),
    ].sort()

    expect(선언된_표_이름).toEqual(적힌_표)
  })

  it('001 은 엔진, 003 은 관리 도구 — 이 선이 곧 이식 경계다', () => {
    // 헌법 원칙 II · V. 관리 표는 본 제품으로 안 간다.
    // ⭐ 스키마까지 적어 둔 목록이라 「11표가 `gq_admin` 에 선다」(결정 5 · 4차)를 여기서 못 박는다.
    //    하나가 `public` 으로 되돌아가면 이 검사가 먼저 빨개진다 (DB 없이도 돈다).
    expect(sql파일의_표들('001_schema.sql').sort()).toEqual([
      'public.messages',
      'public.post_activity_results',
      'public.stories',
      // ⚠️ 표 이름은 `story_characters` 인데 **내보내는 심볼은 `characters`** 다 (결정 70).
      //    저쪽이 `characters` 를 아이 아바타 프리셋 뜻으로 이미 쓴다.
      'public.story_characters',
      'public.story_scenes',
      'public.story_sessions',
      'public.utterance_analyses',
    ])
    expect(sql파일의_표들('003_admin.sql').sort()).toEqual([
      'gq_admin.corrections',
      'gq_admin.experiment_prompts',
      'gq_admin.goldenset_results',
      'gq_admin.goldenset_runs',
      'gq_admin.llm_calls',
      'gq_admin.review_criteria',
      'gq_admin.runs',
      'gq_admin.scores',
      'gq_admin.seed_revisions',
      'gq_admin.test_children',
      'gq_admin.turn_conditions',
    ])
    // 미션 3표는 엔진 쪽(`public`)이다 — 본 제품이 읽고 쓰는 표라 관리 도구가 아니다 (이슈 #17).
    expect(sql파일의_표들('005_missions.sql').sort()).toEqual([
      'public.mission_messages',
      'public.mission_sessions',
      'public.story_missions',
    ])
    // 보호자 리포트 2표도 엔진 쪽이다 (이슈 #35).
    // ⛔ 저쪽(팀 레포)의 `reports`·`wordbook` 은 여기 없다 — 쓰임이 겹쳐 보여도 계정 영역 표라
    //    선언에 넣지 않는다 (보호자 리포트 명세 6.2 · `db/push-guard.ts` 머리말).
    //    그 짝은 `tests/push-guard.test.ts` 가 이름 목록으로 한 번 더 못박는다.
    expect(sql파일의_표들('006_parent_report.sql').sort()).toEqual([
      'public.child_words',
      'public.parent_reports',
    ])
    // 후활동 단어 표도 엔진 쪽이다 (이슈 #42).
    // ⚠️ **한 표뿐이다.** 007 은 `post_activity_results` 의 칸도 둘 늘리지만 그건
    //    `ALTER TABLE` 이고, 위 파서는 `CREATE TABLE` 만 본다 (그 표는 001 에서 이미 걸린다).
    expect(sql파일의_표들('007_post_activity.sql').sort()).toEqual([
      'public.post_activity_keywords',
    ])
  })

  it('sql 파일이 이름 붙여 건 제약이 전부 schema.ts 에 있다', () => {
    const 적힌_제약 = [
      ...sql파일의_제약이름들('001_schema.sql'),
      ...sql파일의_제약이름들('003_admin.sql'),
      ...sql파일의_제약이름들('005_missions.sql'),
      ...sql파일의_제약이름들('006_parent_report.sql'),
      ...sql파일의_제약이름들('007_post_activity.sql'),
    ]
    const 선언한_제약 = new Set(선언된_제약이름들())

    // 「sql 파일에는 있는데 선언에 없는 제약」— 옮기다 흘린 것이다
    expect(적힌_제약.filter((이름) => !선언한_제약.has(이름))).toEqual([])
  })

  it('그 CHECK 가 보는 칸까지 sql 파일과 선언이 같다', () => {
    const 적힌_본문 = new Map([
      ...sql파일의_CHECK본문('001_schema.sql'),
      ...sql파일의_CHECK본문('003_admin.sql'),
      ...sql파일의_CHECK본문('005_missions.sql'),
      ...sql파일의_CHECK본문('006_parent_report.sql'),
      ...sql파일의_CHECK본문('007_post_activity.sql'),
    ])

    const 어긋난: string[] = []
    for (const 표 of 선언된_표) {
      const 칸이름들 = 표.columns.map((칸) => 칸.name)
      for (const 하나 of 표.checks) {
        const 파일_본문 = 적힌_본문.get(하나.name)
        // sql 파일에 아예 없는 제약은 바로 위 검사가 잡는다. 여기서 두 번 울리지 않는다.
        if (파일_본문 === undefined) continue

        const 파일쪽 = 언급된_칸(파일_본문, 칸이름들)
        const 선언쪽 = 언급된_칸(방언.sqlToQuery(하나.value).sql, 칸이름들)
        if (파일쪽.join(' ') !== 선언쪽.join(' ')) {
          어긋난.push(`${전체이름(표)}.${하나.name}: sql=[${파일쪽}] 선언=[${선언쪽}]`)
        }
      }
    }

    expect(어긋난).toEqual([])
  })
})

// ── 살아 있는 DB 와 대조 ──────────────────────────────────────────────────

type 실제컬럼 = { column_name: string; 타입: string; nullable: boolean; 기본값: string | null }
type 실제제약 = { conname: string; contype: string }
type 실제FK = { 컬럼들: string; 대상표: string; 대상컬럼들: string; 지울때: string }
type 실제PK = { 컬럼들: string }

검사('표 선언 ↔ 살아 있는 DB', () => {
  it('선언한 표가 DB 에 다 있다', async () => {
    // ⚠️ `schemaname` 을 `'public'` 으로 박으면 `gq_admin` 표가 전부 「DB 에 없다」로 나온다.
    //    선언에서 뽑은 목록으로 건다 — 배열을 넣으면 드리즐이 `IN ($1, $2)` 로 편다.
    const 있는_표 = (
      await getDb().execute<{ 이름: string }>(sql`
        SELECT schemaname || '.' || tablename AS 이름
          FROM pg_tables
         WHERE schemaname IN ${선언된_스키마}
      `)
    ).map((행) => 행.이름)

    const 없는_표 = 선언된_표_이름.filter((이름) => !있는_표.includes(이름))
    // 「선언에는 있는데 DB 에 없는 표」— drizzle-kit push 를 안 돌렸나, 아니면 스키마가 어긋났나
    expect(없는_표).toEqual([])
  })

  // 아래 넷은 표 하나를 `${표이름}::regclass` 로 집는다. 이름이 `gq_admin.runs` 라 스키마째 집히고,
  // ⚠️ 그 자리에 표가 없으면 **질의가 터진다** (조용히 0행이 아니다). 선언과 DB 의 스키마가
  //    어긋나면 바로 위 검사가 목록으로 알려 주고 여기서는 그 표의 이름을 달고 빨개진다.
  it.each(선언된_표_이름)('%s — 컬럼 이름·타입·NULL·기본값이 DB 와 같다', async (표이름) => {
    const 선언 = 선언찾기(표이름)
    const 실제 = await getDb().execute<실제컬럼>(sql`
      SELECT a.attname                              AS column_name,
             format_type(a.atttypid, a.atttypmod)   AS 타입,
             NOT a.attnotnull                       AS nullable,
             pg_get_expr(d.adbin, d.adrelid)        AS 기본값
        FROM pg_attribute a
        LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
       WHERE a.attrelid = ${표이름}::regclass
         AND a.attnum > 0
         AND NOT a.attisdropped
    `)

    const 선언_이름 = 선언.columns.map((칸) => 칸.name).sort()
    const 실제_이름 = 실제.map((칸) => 칸.column_name).sort()
    expect(선언_이름, `${표이름}: 컬럼 이름이 다르다`).toEqual(실제_이름)

    const 실제표 = new Map(실제.map((칸) => [칸.column_name, 칸]))
    const 다른_타입 = 선언.columns
      .filter((칸) => 타입글자(칸.getSQLType()) !== 타입글자(실제표.get(칸.name)!.타입))
      .map((칸) => `${칸.name}: 선언=${칸.getSQLType()} DB=${실제표.get(칸.name)!.타입}`)
    expect(다른_타입, `${표이름}: (선언, DB) 타입이 다르다`).toEqual([])

    const 다른_NULL = 선언.columns
      .filter((칸) => !칸.notNull !== 실제표.get(칸.name)!.nullable)
      .map((칸) => `${칸.name}: 선언=${칸.notNull ? 'NOT NULL' : 'NULL'}`)
    expect(다른_NULL, `${표이름}: (선언, DB) NULL 허용이 다르다`).toEqual([])

    const 다른_기본값 = 선언.columns
      .filter((칸) => {
        const 선언값 = 선언한_기본값(칸)
        const 실제값 = 실제표.get(칸.name)!.기본값
        if (선언값 === 자동증가) return !(실제값 ?? '').startsWith('nextval(')
        return 기본값글자(선언값) !== 기본값글자(실제값)
      })
      .map((칸) => {
        const 선언값 = 선언한_기본값(칸)
        return `${칸.name}: 선언=${선언값 === 자동증가 ? 'nextval(…)' : 기본값글자(선언값)} DB=${기본값글자(실제표.get(칸.name)!.기본값)}`
      })
    expect(다른_기본값, `${표이름}: (선언, DB) 기본값이 다르다`).toEqual([])
  })

  it.each(선언된_표_이름)('%s — 이름 붙은 CHECK·UNIQUE 가 DB 와 같다', async (표이름) => {
    const 선언 = 선언찾기(표이름)
    const 실제 = await getDb().execute<실제제약>(sql`
      SELECT conname, contype::text AS contype
        FROM pg_constraint
       WHERE conrelid = ${표이름}::regclass
         AND contype IN ('c', 'u')
    `)

    const 실제만 = (종류: string) =>
      실제
        .filter((하나) => 하나.contype === 종류)
        .map((하나) => 하나.conname)
        .sort()

    // ⚠️ 컬럼에 바로 붙인 `.unique()` 는 `uniqueConstraints` 에 안 들어온다 (거기는
    //    두 번째 인자 배열에 적은 것만이다). 양쪽을 합쳐야 DB 와 개수가 맞는다.
    const 선언한_unique = [
      ...선언.uniqueConstraints.map((하나) => 하나.name),
      ...선언.columns.filter((칸) => 칸.isUnique).map((칸) => 칸.uniqueName),
    ]
      .filter((이름): 이름 is string => 이름 !== undefined)
      .sort()

    expect(
      선언.checks.map((하나) => 하나.name).sort(),
      `${표이름}: CHECK 제약이 다르다`,
    ).toEqual(실제만('c'))
    expect(선언한_unique, `${표이름}: UNIQUE 제약이 다르다`).toEqual(실제만('u'))
  })

  // FK·PK 는 **이름이 아니라 내용**으로 견준다 (머리말 5번).
  // 한 줄의 모양: `run_id → public.story_sessions(id) ON DELETE cascade`
  // ⭐ 가리키는 표도 `스키마.표` 로 적는다. 관리 표에서 엔진 표로 가는 FK 가 스키마를 넘으므로
  //    (`gq_admin.runs.session_id → public.story_sessions.id`) 맨 이름만 견주면
  //    「같은 이름의 다른 표를 가리킨다」를 못 본다.
  it.each(선언된_표_이름)('%s — FK 가 가리키는 곳과 ON DELETE 가 DB 와 같다', async (표이름) => {
    const 선언 = 선언찾기(표이름)
    const 실제 = await getDb().execute<실제FK>(sql`
      SELECT (SELECT string_agg(a.attname, ',' ORDER BY 짝.차례)
                FROM unnest(c.conkey) WITH ORDINALITY 짝(칸번호, 차례)
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = 짝.칸번호)  AS 컬럼들,
             대상틀.nspname || '.' || 대상.relname                                        AS 대상표,
             (SELECT string_agg(a.attname, ',' ORDER BY 짝.차례)
                FROM unnest(c.confkey) WITH ORDINALITY 짝(칸번호, 차례)
                JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = 짝.칸번호)  AS 대상컬럼들,
             c.confdeltype::text                                                           AS 지울때
        FROM pg_constraint c
        JOIN pg_class 대상 ON 대상.oid = c.confrelid
        JOIN pg_namespace 대상틀 ON 대상틀.oid = 대상.relnamespace
       WHERE c.conrelid = ${표이름}::regclass
         AND c.contype = 'f'
    `)

    const 선언한_FK = 선언.foreignKeys
      .map((하나) => {
        const 가리키는곳 = 하나.reference()
        const 이쪽 = 가리키는곳.columns.map((칸) => 칸.name).join(',')
        const 저쪽 = 가리키는곳.foreignColumns.map((칸) => 칸.name).join(',')
        const 대상표 = 전체이름(getTableConfig(가리키는곳.foreignTable))
        return `${이쪽} → ${대상표}(${저쪽}) ON DELETE ${하나.onDelete ?? 'no action'}`
      })
      .sort()

    const 실제_FK = 실제
      .map(
        (하나) =>
          `${하나.컬럼들} → ${하나.대상표}(${하나.대상컬럼들}) ON DELETE ${지울때_글자[하나.지울때] ?? 하나.지울때}`,
      )
      .sort()

    expect(선언한_FK, `${표이름}: FK 가 다르다`).toEqual(실제_FK)
  })

  it.each(선언된_표_이름)('%s — PK 컬럼이 DB 와 같다', async (표이름) => {
    const 선언 = 선언찾기(표이름)
    const 실제 = await getDb().execute<실제PK>(sql`
      SELECT (SELECT string_agg(a.attname, ',' ORDER BY 짝.차례)
                FROM unnest(c.conkey) WITH ORDINALITY 짝(칸번호, 차례)
                JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = 짝.칸번호) AS 컬럼들
        FROM pg_constraint c
       WHERE c.conrelid = ${표이름}::regclass
         AND c.contype = 'p'
    `)

    // 컬럼에 붙인 `.primaryKey()` 와 `primaryKey({ columns })` 둘 다 모은다.
    const 선언한_PK = [
      ...선언.columns.filter((칸) => 칸.primary).map((칸) => 칸.name),
      ...선언.primaryKeys.flatMap((하나) => 하나.columns.map((칸) => 칸.name)),
    ].sort()

    const 실제_PK = (실제[0]?.컬럼들 ?? '')
      .split(',')
      .filter((이름) => 이름 !== '')
      .sort()

    expect(선언한_PK, `${표이름}: PK 컬럼이 다르다`).toEqual(실제_PK)
  })
})

// ── 나쁜 행이 정말 튕기나 (결정 74) ───────────────────────────────────────
//
// 위의 것들은 전부 **적힌 것끼리** 견준다. 셋(sql 파일·선언·DB)이 사이좋게 느슨해도
// 아무도 안 아프고 잘못된 행만 들어온다 — 결정 74 가 고친 자리가 정확히 그것이었다
// (`dialogue_scene_needs_all_parts` 가 여덟 칸만 봐서 「갈등 없는 대화 장면」이 통과했다).
// 그래서 여기서는 넣어 보고, **언제나 되돌린다.**
//
// ⚠️ 「제 본문이 있는 행은 들어간다」도 같이 잰다. 안 그러면 제약이 모든 행을 튕겨도 초록이다.

class 되돌림 extends Error {}

/** 드리즐이 오류를 한 겹 감싸므로 cause 를 따라 내려가며 제약 이름을 찾는다. */
function 튕긴_제약(오류: unknown): string | null {
  let 하나: unknown = 오류
  while (하나 instanceof Error) {
    const 이름 = (하나 as unknown as { constraint_name?: unknown }).constraint_name
    if (typeof 이름 === 'string') return 이름
    하나 = 하나.cause
  }
  return null
}

검사('story_scenes — 장면은 제 본문이 있어야 들어간다', () => {
  type 새장면 = typeof 스키마.story_scenes.$inferInsert

  /** 장면 한 행을 넣어 본다. 통과하면 null, 튕기면 그 제약 이름. **행은 남지 않는다.** */
  async function 넣어보기(
    장면: (story_id: string, character_id: string) => 새장면,
  ): Promise<string | null> {
    const 꼬리 = randomUUID().slice(0, 8)
    try {
      await getDb().transaction(async (tx) => {
        const [이야기] = await tx
          .insert(스키마.stories)
          .values({
            slug: `s-chk-${꼬리}`,
            title: `CHECK 검사 ${꼬리}`,
            summary: '제약만 재는 이야기',
            difficulty: 'easy',
            status: 'draft',
          })
          .returning({ id: 스키마.stories.id })
        const [캐릭터] = await tx
          .insert(스키마.characters)
          .values({
            story_id: 이야기.id,
            code: `ch_chk_${꼬리}`,
            name: '며느리',
            persona: '성격',
            speech_style: '말투',
            guidance_style: '방식',
          })
          .returning({ id: 스키마.characters.id })

        await tx.insert(스키마.story_scenes).values(장면(이야기.id, 캐릭터.id))
        throw new 되돌림('넣어 봤으니 되돌린다')
      })
      return null // 여기까지 오지 않는다 — 되돌림이 위에서 던진다
    } catch (오류) {
      if (오류 instanceof 되돌림) return null
      const 제약 = 튕긴_제약(오류)
      if (제약 !== null) return 제약
      throw 오류
    }
  }

  const 대화장면 = (story_id: string, character_id: string): 새장면 => ({
    story_id,
    character_id,
    code: `sc_chk_${randomUUID().slice(0, 8)}`,
    scene_order: 1,
    conflict: '참자니 병이 나고 뀌자니 쫓겨난다',
    character_name: '며느리',
    character_opening: '나는 어쩌면 좋으냐',
    character_closing: '고맙구나',
    scene_stance: '아직 참고 있다',
    scene_goal: '아이가 며느리 마음을 말한다',
    required_elements: ['EMPATHY'],
    preferred_turns: 2,
    max_turns: 4,
  })

  const 전개장면 = (story_id: string): 새장면 => ({
    story_id,
    code: `sc_chk_${randomUUID().slice(0, 8)}`,
    scene_order: 1,
    scene_description: '며느리가 방귀를 참고 있다',
  })

  it('제 본문이 있으면 두 종류 다 들어간다', async () => {
    expect(await 넣어보기(대화장면), '대화 장면이 튕겼다').toBeNull()
    expect(await 넣어보기(전개장면), '전개 장면이 튕겼다').toBeNull()
  })

  it('대화 장면인데 conflict 가 비면 튕긴다', async () => {
    expect(
      await 넣어보기((s, c) => ({ ...대화장면(s, c), conflict: null })),
    ).toBe('dialogue_scene_needs_all_parts')
  })

  it('전개 장면인데 scene_description 이 비면 튕긴다', async () => {
    expect(
      await 넣어보기((s) => ({ ...전개장면(s), scene_description: null })),
    ).toBe('narration_scene_needs_description')
  })
})
