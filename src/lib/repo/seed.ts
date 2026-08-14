// 시드 작업대의 저장 계층 — `characters`·`story_scenes` 의 **작업값**과 그 개정 이력.
//
// 파이썬 `src/goodquestion_admin/저장.py` 의 시드 갈래를 옮긴 것이다 (이슈 #26 화면-2) —
// `시드_목록` · `시드_수정` · `시드_개정_읽기` · `시드_되돌리기` · `시드_파일과_다름` ·
// `시드_내보내기_자료` · `최신_시드_개정`, 그리고 그 넷이 쓰던 사적 함수 다섯.
//
// ## ⛔ 여기에 화면 말이 없다
//
// 「정본/초안」 같은 이름표도, 시드 파일에서 읽은 대조값도 이 층에 없다 (`lib/service/seed.ts`).
// 여기가 아는 것은 **어느 칸을 고칠 수 있나**와 **무엇이 DB 에 남았나**뿐이다.
//
// ## 커밋은 부르는 쪽이 한다 (결정 18)
//
// `repo/db.ts` 머리말과 같다. 이 파일도 트랜잭션을 여닫지 않는다.
// ⚠️ 그래서 파이썬 라우트가 `with conn.transaction()` 으로 감싸던 「거절당하면 되돌린다」는
//    여기 없다. 드리즐/postgres-js 는 문장 하나가 실패해도 다음 문장을 막지 않으므로
//    (파이썬 psycopg 는 트랜잭션이 죽어 더는 못 읽었다) 화면을 다시 그리는 데 문제가 없다.

import { and, asc, desc, eq, gt, ne, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

import { characters, seed_revisions, stories, story_scenes } from '@/db/schema'
import { LookupError, ValueError } from '@/lib/domain/progress'

import type { Conn } from './db'

/**
 * 시드 파일 기준점이 쓰는 가짜 표 이름.
 *
 * 「이 시점의 캐릭터·장면 목록을 시드 파일이 부어 놓은 것으로 친다」는 표시 한 줄이다.
 * 이 행보다 뒤에 쌓인 개정이 있으면 화면 값이 시드 파일과 갈렸다는 뜻이다.
 */
export const 시드파일_표이름 = '__seed_file__'

// 대화 장면에는 이 장면에서의 입장이 반드시 있어야 한다 (2026-08-11 사람이 정함).
// `dialogue_scene_needs_all_parts` CHECK 가 NULL 을 막지만 **빈 문자열은 그냥 지나간다** —
// 화면에서 칸을 비우면 들어오는 것이 바로 그 빈 문자열이라 여기서 한 번 더 막는다.
export const 대화_장면_입장_경고 =
  '대화 장면은 「이 장면에서의 입장」을 비울 수 없습니다. ' +
  '캐릭터가 어느 편에 서 있는지 없이 대사를 짓게 됩니다.'

/** 고칠 수 있는 시드 칸. 표 이름은 화면에서 오므로 여기서 걸러 낸다. */
export const 고칠_수_있는_칸: Readonly<Record<string, readonly string[]>> = {
  characters: ['persona', 'speech_style', 'guidance_style', 'forbidden'],
  story_scenes: [
    'scene_stance',
    'remaining_worries',
    'required_elements',
    'preferred_turns',
    'max_turns',
  ],
}

/**
 * 한 칸에 들어갈 수 있는 값. 칸마다 모양이 다르다 —
 * 글(`persona`) · 목록(`forbidden`) · 사전(`remaining_worries`) · 수(`max_turns`).
 */
export type SeedValue = string | number | string[] | Record<string, string>

/** 표·칸 이름을 드리즐 컬럼으로. 문자열이 SQL 로 새어 들어가지 않게 여기서 갈아 끼운다. */
const 칸_컬럼: Readonly<Record<string, Readonly<Record<string, AnyPgColumn>>>> = {
  characters: {
    persona: characters.persona,
    speech_style: characters.speech_style,
    guidance_style: characters.guidance_style,
    forbidden: characters.forbidden,
  },
  story_scenes: {
    scene_stance: story_scenes.scene_stance,
    remaining_worries: story_scenes.remaining_worries,
    required_elements: story_scenes.required_elements,
    preferred_turns: story_scenes.preferred_turns,
    max_turns: story_scenes.max_turns,
  },
}

// ---------------------------------------------------------------------------
// 행 모양
// ---------------------------------------------------------------------------

/** `seed_revisions` 한 행. */
export type SeedRevisionRow = typeof seed_revisions.$inferSelect

/** 캐릭터 한 행 + 이야기 제목·슬러그 + 칸별 출처. */
export interface SeedCharacterRow {
  id: string
  story_id: string
  story_title: string
  /** 내보내기 SQL 이 조인하는 열쇠. `title` 에는 UNIQUE 가 없어 열쇠로 못 쓴다. */
  story_slug: string
  code: string
  name: string
  persona: string
  speech_style: string
  guidance_style: string
  forbidden: string[]
  /** 칸 이름 → `canon` · `draft`. 마지막 개정이 적어 둔 값이고, 없으면 기본값이다. */
  origins: Record<string, string>
}

/** 대화 장면 한 행 + 이야기 제목·슬러그 + 캐릭터 코드 + 칸별 출처. */
export interface SeedSceneRow {
  id: string
  story_id: string
  story_title: string
  /** 내보내기 SQL 이 조인하는 열쇠. `title` 에는 UNIQUE 가 없어 열쇠로 못 쓴다. */
  story_slug: string
  code: string
  scene_order: number
  character_id: string | null
  character_code: string
  character_name: string | null
  scene_stance: string | null
  remaining_worries: Record<string, string>
  required_elements: string[] | null
  preferred_turns: number | null
  max_turns: number | null
  origins: Record<string, string>
}

export interface SeedList {
  characters: SeedCharacterRow[]
  scenes: SeedSceneRow[]
  /** 시드 파일 기준점(`__seed_file__`)을 뺀 개정 이력. 최근 것이 위. */
  revisions: SeedRevisionRow[]
}

// ---------------------------------------------------------------------------
// 목록
// ---------------------------------------------------------------------------

/** 시드 파일 지문 — 지금 DB 에 있는 캐릭터·장면 id 목록. */
interface 지문 {
  characters: string[]
  scenes: string[]
}

/** 두 지문이 같은가. **글자로 굳혀 견주지 않는다** — jsonb 는 키 순서를 제 맘대로 바꾼다. */
function 같은_지문(왼쪽: unknown, 오른쪽: 지문): boolean {
  if (왼쪽 === null || typeof 왼쪽 !== 'object') return false
  const 그것 = 왼쪽 as Partial<지문>
  return 같은_목록(그것.characters, 오른쪽.characters) && 같은_목록(그것.scenes, 오른쪽.scenes)
}

function 같은_목록(왼쪽: unknown, 오른쪽: readonly string[]): boolean {
  return (
    Array.isArray(왼쪽) &&
    왼쪽.length === 오른쪽.length &&
    왼쪽.every((값, 자리) => 값 === 오른쪽[자리])
  )
}

/**
 * 시드 작업대가 그리는 것 전부 (파이썬 `시드_목록()`).
 *
 * ⭐ **읽기만 하는 함수가 아니다.** 캐릭터·장면 목록이 지난 기준점과 다르면
 * `__seed_file__` 행을 하나 남긴다 — 시드를 새로 부었다는 뜻이라 「파일과 다름」 표시를
 * 여기서 0 으로 되돌려야 한다.
 */
export async function listSeed(conn: Conn): Promise<SeedList> {
  const 캐릭터들 = await conn
    .select({
      id: characters.id,
      story_id: characters.story_id,
      story_title: stories.title,
      story_slug: stories.slug,
      code: characters.code,
      name: characters.name,
      persona: characters.persona,
      speech_style: characters.speech_style,
      guidance_style: characters.guidance_style,
      forbidden: characters.forbidden,
    })
    .from(characters)
    .innerJoin(stories, eq(stories.id, characters.story_id))
    .orderBy(asc(stories.title), asc(characters.name), asc(characters.id))

  // ⭐ `innerJoin` 이라 **대화 장면만** 온다 (전개 장면에는 캐릭터가 없다 — 결정 11).
  //    화면 제목이 「대화 장면과 걱정 문장」인 것이 이 조인 때문이다.
  const 장면들 = await conn
    .select({
      id: story_scenes.id,
      story_id: story_scenes.story_id,
      story_title: stories.title,
      story_slug: stories.slug,
      code: story_scenes.code,
      scene_order: story_scenes.scene_order,
      character_id: story_scenes.character_id,
      character_code: characters.code,
      character_name: story_scenes.character_name,
      scene_stance: story_scenes.scene_stance,
      remaining_worries: story_scenes.remaining_worries,
      required_elements: story_scenes.required_elements,
      preferred_turns: story_scenes.preferred_turns,
      max_turns: story_scenes.max_turns,
    })
    .from(story_scenes)
    .innerJoin(stories, eq(stories.id, story_scenes.story_id))
    .innerJoin(characters, eq(characters.id, story_scenes.character_id))
    .orderBy(asc(stories.title), asc(story_scenes.scene_order), asc(story_scenes.id))

  const 파일_지문: 지문 = {
    characters: 캐릭터들.map((행) => String(행.id)).sort(),
    scenes: 장면들.map((행) => String(행.id)).sort(),
  }
  const 기준점 = await 최신_기준점(conn)
  if (기준점 === null || !같은_지문(기준점.new_value, 파일_지문)) {
    await conn.insert(seed_revisions).values({
      table_name: 시드파일_표이름,
      row_id: null,
      column_name: null,
      // 여기는 SQL NULL 이다 (JSON 의 `null` 이 아니다). 드리즐이 `null` 을 그대로 흘린다.
      old_value: null,
      new_value: 파일_지문,
      origin: 'canon',
      changed_by: null,
    })
  }

  const 개정들 = await conn
    .select()
    .from(seed_revisions)
    .where(ne(seed_revisions.table_name, 시드파일_표이름))
    .orderBy(desc(seed_revisions.created_at), desc(seed_revisions.id))

  // 같은 칸의 **가장 최근** 개정이 그 칸의 출처다. 목록이 이미 최신순이라 첫 것만 남긴다.
  //
  // ⚠️ 열쇠를 잇는 글자가 `\0` 인 것은 표·행·칸 이름에 절대 안 들어가기 때문이다.
  //    ⛔ **소스에 진짜 NUL 바이트를 박지 말 것** — 그러면 `file` 이 이 파일을 「data」로 보고
  //       `grep` 이 통째로 조용해진다 (2026-08-13에 실제로 겪었다). 이스케이프로 적는다.
  const 최신_출처 = new Map<string, string>()
  for (const 개정 of 개정들) {
    const 열쇠 = `${개정.table_name}\0${개정.row_id}\0${개정.column_name}`
    if (!최신_출처.has(열쇠)) 최신_출처.set(열쇠, 개정.origin)
  }
  const 출처 = (표: string, row_id: string, 칸: string, 기본: string) =>
    최신_출처.get(`${표}\0${row_id}\0${칸}`) ?? 기본

  return {
    characters: 캐릭터들.map((행) => ({
      ...행,
      origins: Object.fromEntries(
        고칠_수_있는_칸.characters.map((열) => [열, 출처('characters', 행.id, 열, 'draft')]),
      ),
    })),
    scenes: 장면들.map((행) => ({
      ...행,
      origins: Object.fromEntries(
        고칠_수_있는_칸.story_scenes.map((열) => [
          열,
          // 요구 요소와 최대 턴은 원문에서 온 값이다 (`sql/002` 머리말 — 원문 그대로인 것).
          출처(
            'story_scenes',
            행.id,
            열,
            열 === 'required_elements' || 열 === 'max_turns' ? 'canon' : 'draft',
          ),
        ]),
      ),
    })),
    revisions: 개정들,
  }
}

/** 가장 최근 시드 파일 기준점. 한 번도 안 남겼으면 `null`. */
async function 최신_기준점(conn: Conn): Promise<SeedRevisionRow | null> {
  const 행들 = await conn
    .select()
    .from(seed_revisions)
    .where(eq(seed_revisions.table_name, 시드파일_표이름))
    .orderBy(desc(seed_revisions.id))
    .limit(1)
  return 행들.length === 0 ? null : 행들[0]
}

/**
 * 화면 값이 시드 파일과 갈렸나 (파이썬 `시드_파일과_다름()`).
 *
 * 「기준점보다 뒤에 개정이 하나라도 있나」다. 값을 하나하나 견주지 않는 이유는,
 * 되돌리기로 값이 같아져도 **손댄 이력 자체**를 사람이 봐야 하기 때문이다.
 */
export async function seedFileDiffers(conn: Conn): Promise<boolean> {
  await listSeed(conn) // 캐릭터·장면 id 가 달라졌으면 새 기준점을 먼저 남긴다.
  const 기준점 = await 최신_기준점(conn)
  if (기준점 === null) return false
  const 행들 = await conn
    .select({ id: seed_revisions.id })
    .from(seed_revisions)
    .where(
      and(gt(seed_revisions.id, 기준점.id), ne(seed_revisions.table_name, 시드파일_표이름)),
    )
    .limit(1)
  return 행들.length > 0
}

/** 내보내기가 쓰는 것 — 목록에서 개정 이력만 뺀 것이다 (파이썬 `시드_내보내기_자료()`). */
export async function seedExportData(
  conn: Conn,
): Promise<{ characters: SeedCharacterRow[]; scenes: SeedSceneRow[] }> {
  const 자료 = await listSeed(conn)
  return { characters: 자료.characters, scenes: 자료.scenes }
}

/**
 * 지금까지 쌓인 시드 개정 번호 (파이썬 `최신_시드_개정()`). 한 건도 없으면 0.
 *
 * ⭐ 이 값이 `turn_conditions.seed_revision` 에 박제된다 (`db/schema.ts:474` — 잠시 뺐다가
 *    2026-08-13 에 되살렸다). 「그 칸이 아직 없다」고 적혀 있던 자리인데 **낡은 말이었다.**
 *
 * 🔴 **부르는 자리가 정해져 있다 — 장면 행을 읽기 전이다** (파이썬 `회차.턴_돌리기()` 의
 *    T083). 거꾸로 부르면 그 사이에 사람이 시드를 고쳤을 때 쓴 장면은 N 판인데 박히는 것은
 *    N+1 이 된다. 다섯 호출 경로가 전부 그 순서로 맞춰져 있다
 *    (`service/run.ts` 의 `submitTurn`·`resumeTurn` · `service/step.ts` 의 `decisionStep` ·
 *    `service/story.ts` 의 루프 · 차선으로 `service/turn.ts` 의 `runTurn`).
 */
export async function latestSeedRevision(conn: Conn): Promise<number> {
  const 행들 = await conn
    .select({ seed_revision: sql<number>`coalesce(max(${seed_revisions.id}), 0)::int` })
    .from(seed_revisions)
  return 행들[0].seed_revision
}

// ---------------------------------------------------------------------------
// 한 칸 고치기 · 되돌리기
// ---------------------------------------------------------------------------

/** 없거나 공백뿐이면 빈 값이다. 공백 한 칸을 「썼다」로 쳐 주지 않는다. */
function 비었나(값: unknown): boolean {
  return 값 === null || 값 === undefined || (typeof 값 === 'string' && 값.trim() === '')
}

/**
 * 캐릭터가 붙어 있으면 대화 장면이다 (결정 11 — `character_id` 로 가른다).
 *
 * 전개 장면에는 캐릭터가 없어 입장이 성립하지 않는다. 그래서 비워도 막지 않는다.
 */
async function 대화_장면인가(conn: Conn, row_id: string): Promise<boolean> {
  const 행들 = await conn
    .select({ character_id: story_scenes.character_id })
    .from(story_scenes)
    .where(eq(story_scenes.id, row_id))
    .limit(1)
  return 행들.length > 0 && 행들[0].character_id !== null
}

async function 입장을_비우는가(
  conn: Conn,
  { table_name, column_name, 값, row_id }: 칸자리 & { 값: unknown },
): Promise<boolean> {
  return (
    table_name === 'story_scenes' &&
    column_name === 'scene_stance' &&
    비었나(값) &&
    (await 대화_장면인가(conn, row_id))
  )
}

interface 칸자리 {
  table_name: string
  row_id: string
  column_name: string
}

/** 고칠 칸의 지금 값 하나. 행이 없으면 `null`. */
async function 칸_읽기(conn: Conn, { table_name, row_id, column_name }: 칸자리) {
  const 칸 = 칸_컬럼[table_name][column_name]
  const 표 = table_name === 'characters' ? characters : story_scenes
  const 행들 = await conn
    .select({ value: 칸 })
    .from(표)
    .where(eq(표.id, row_id))
    .limit(1)
  return 행들.length === 0 ? null : 행들[0]
}

async function 칸_쓰기(
  conn: Conn,
  { table_name, row_id, column_name, 값 }: 칸자리 & { 값: SeedValue | null },
): Promise<void> {
  const 고칠_것 = { [column_name]: 값 }
  const 행들 =
    table_name === 'characters'
      ? await conn
          .update(characters)
          .set(고칠_것 as Partial<typeof characters.$inferInsert>)
          .where(eq(characters.id, row_id))
          .returning({ id: characters.id })
      : await conn
          .update(story_scenes)
          .set(고칠_것 as Partial<typeof story_scenes.$inferInsert>)
          .where(eq(story_scenes.id, row_id))
          .returning({ id: story_scenes.id })
  if (행들.length === 0) throw new LookupError(`시드 행이 없다: ${table_name}/${row_id}`)
}

/** 두 값이 같은가. 목록·사전도 값으로 견준다 (파이썬 `==` 자리다). */
export function 같은_값(왼쪽: unknown, 오른쪽: unknown): boolean {
  if (왼쪽 === 오른쪽) return true
  if (Array.isArray(왼쪽) && Array.isArray(오른쪽)) {
    return 왼쪽.length === 오른쪽.length && 왼쪽.every((값, 자리) => 같은_값(값, 오른쪽[자리]))
  }
  if (
    typeof 왼쪽 === 'object' &&
    typeof 오른쪽 === 'object' &&
    왼쪽 !== null &&
    오른쪽 !== null &&
    !Array.isArray(왼쪽) &&
    !Array.isArray(오른쪽)
  ) {
    const 왼_키 = Object.keys(왼쪽 as Record<string, unknown>)
    const 오른_키 = Object.keys(오른쪽 as Record<string, unknown>)
    if (왼_키.length !== 오른_키.length) return false
    return 왼_키.every(
      (키) =>
        키 in (오른쪽 as Record<string, unknown>) &&
        같은_값(
          (왼쪽 as Record<string, unknown>)[키],
          (오른쪽 as Record<string, unknown>)[키],
        ),
    )
  }
  return false
}

/** 고칠 수 있는 칸인지 · 아는 출처인지. 아니면 던진다 (파이썬 `시드_수정()` 앞머리). */
function 칸을_확인한다(table_name: string, column_name: string, 무엇: string): void {
  if (!고칠_수_있는_칸[table_name]?.includes(column_name)) {
    throw new ValueError(`${무엇} 시드 칸: ${table_name}.${column_name}`)
  }
}

export interface SeedEdit {
  table_name: string
  row_id: string
  column_name: string
  new_value: SeedValue
  origin: string
  changed_by: string | null
}

/**
 * 시드 한 칸을 고치고 개정 한 줄을 남긴다 (파이썬 `시드_수정()`).
 *
 * ⛔ **개정 없이 값만 바꾸는 길은 없다.** 이력이 곧 「무엇을 검수해야 하나」이기 때문이다.
 */
export async function updateSeedCell(conn: Conn, 고침: SeedEdit): Promise<SeedRevisionRow> {
  const { table_name, row_id, column_name, new_value, origin, changed_by } = 고침
  칸을_확인한다(table_name, column_name, '고칠 수 없는')
  // 헌법 2.0.0 — `external` 을 뺐다. `unmarked` 는 읽기 전용 상태라 고를 수 없다.
  if (origin !== 'canon' && origin !== 'draft') {
    throw new ValueError(`모르는 시드 출처: ${origin}`)
  }
  if (await 입장을_비우는가(conn, { table_name, row_id, column_name, 값: new_value })) {
    throw new ValueError(대화_장면_입장_경고)
  }

  await listSeed(conn) // 현재 시드를 부은 기준점을 먼저 보장한다.

  const 현재 = await 칸_읽기(conn, { table_name, row_id, column_name })
  if (현재 === null) throw new LookupError(`시드 행이 없다: ${table_name}/${row_id}`)
  if (같은_값(현재.value, new_value)) throw new ValueError('이전 값과 새 값이 같다')

  await 칸_쓰기(conn, { table_name, row_id, column_name, 값: new_value })
  const 개정 = await conn
    .insert(seed_revisions)
    .values({
      table_name,
      row_id,
      column_name,
      old_value: 현재.value as SeedValue | null,
      new_value,
      origin,
      changed_by,
    })
    .returning()
  return 개정[0]
}

/** 개정 한 줄. 없으면 던진다 (파이썬 `시드_개정_읽기()`). */
export async function readSeedRevision(
  conn: Conn,
  revision_id: number,
): Promise<SeedRevisionRow> {
  const 행들 = await conn
    .select()
    .from(seed_revisions)
    .where(eq(seed_revisions.id, revision_id))
    .limit(1)
  if (행들.length === 0) throw new LookupError(`시드 개정이 없다: ${revision_id}`)
  return 행들[0]
}

/**
 * 그 개정의 **직전 값**으로 되돌리고, 되돌린 사실을 다시 한 줄 남긴다
 * (파이썬 `시드_되돌리기()`).
 *
 * ⛔ 개정을 지우지 않는다. 되돌림도 개정이다 — 이력이 줄어드는 길은 없다.
 */
export async function undoSeedRevision(
  conn: Conn,
  { revision_id, changed_by }: { revision_id: number; changed_by: string | null },
): Promise<SeedRevisionRow> {
  const 개정 = await readSeedRevision(conn, revision_id)
  if (개정.table_name === 시드파일_표이름 || 개정.row_id === null) {
    throw new ValueError('시드 파일 기준점은 되돌릴 수 없다')
  }
  const table_name = 개정.table_name
  const row_id = 개정.row_id
  const column_name = 개정.column_name ?? ''
  칸을_확인한다(table_name, column_name, '되돌릴 수 없는')

  const 현재 = await 칸_읽기(conn, { table_name, row_id, column_name })
  if (현재 === null) throw new LookupError(`시드 행이 없다: ${table_name}/${row_id}`)
  const 목표 = 개정.old_value as SeedValue | null
  if (같은_값(현재.value, 목표)) throw new ValueError('이미 직전 값으로 되돌아가 있다')
  if (await 입장을_비우는가(conn, { table_name, row_id, column_name, 값: 목표 })) {
    throw new ValueError(대화_장면_입장_경고)
  }

  await 칸_쓰기(conn, { table_name, row_id, column_name, 값: 목표 })
  const 되돌림 = await conn
    .insert(seed_revisions)
    .values({
      table_name,
      row_id,
      column_name,
      old_value: 현재.value as SeedValue | null,
      new_value: 목표,
      origin: 개정.origin,
      changed_by,
    })
    .returning()
  return 되돌림[0]
}
