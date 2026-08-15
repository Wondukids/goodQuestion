// 캐릭터 보기 화면이 읽는 것 — 캐릭터 3명 · 장면 9개 · 「시드 파일과 다른가」 (이슈 #26 화면-6).
//
// 파이썬 `src/goodquestion_admin/저장.py` 의 `시드_목록()`·`시드_파일과_다름()` 중
// **읽는 절반**만 옮긴 것이다.
//
// ## ⛔ 여기서 고치지 않는다
//
// `/characters` 는 **보는 자리**다 (파이썬 `routes/characters.py` 머리말 — 「고치는 주소가
// 없다」). 그래서 이 파일에는 캐릭터·장면을 **쓰는** 함수가 없다. 시드를 고치는 길은
// 시드 편집 화면 하나뿐이고, 두 곳에서 고치면 어느 쪽이 정본인지 흐려진다.
//
// ## ⚠️ 그런데 왜 `INSERT` 가 하나 있나 — `__seed_file__` 기준점
//
// 「지금 DB 값이 `sql/002_seed_banggui.sql` 과 다른가」를 말하려면 **어디서부터 세는지**가
// 있어야 한다. 파이썬은 그 자리를 `seed_revisions` 안에 `table_name = '__seed_file__'` 인
// 특별한 행으로 두었다 — 시드를 다시 넣어 행 id 가 통째로 바뀌면 새 기준점을 남기고,
// 그 뒤에 쌓인 개정이 있으면 「파일과 다르다」다.
//
// ⭐ 기준점을 남기는 것은 **콘텐츠를 고치는 것이 아니다.** 「지금 이 시드 파일을 봤다」는
//    표시일 뿐이라 읽기 전용 화면에서 일어나도 값이 달라지지 않는다.
//
// 🔴 **시드 편집 화면 트랙과 겹치는 자리다.** 저쪽도 `시드_목록()` 을 옮긴다 — 그쪽이 서면
//    기준점 로직은 한 곳으로 모아야 한다 (보고에 적어 뒀다).

import { and, asc, desc, eq, gt, ne } from 'drizzle-orm'

import { characters, seed_revisions, stories, story_scenes } from '@/llm/db/schema'

import type { Conn } from './db'

/** `seed_revisions` 에서 기준점 행을 가리키는 이름. 진짜 표 이름이 아니다. */
export const 시드파일_표시 = '__seed_file__'

/** 캐릭터 한 행 + 이야기 제목. 칸 이름은 DB 컬럼 그대로다. */
export type SeedCharacterRow = typeof characters.$inferSelect & { story_title: string }

/**
 * 장면 한 행 + 이야기 제목 + 캐릭터 코드.
 *
 * ⚠️ `repo/content.ts` 의 `SceneRow` 와 **다른 모양**이다. 저쪽은 엔진이 쓰는 재료라
 * `story_scenes.id` 를 `scene_id` 로 바꿔 받지만, 이 화면은 시드 표를 **그대로** 보여 주는
 * 자리라 컬럼 이름을 하나도 안 바꾼다.
 */
export type SeedSceneRow = typeof story_scenes.$inferSelect & {
  story_title: string
  character_code: string
}

/**
 * 캐릭터 전부 (이야기 제목 · 이름 순).
 *
 * ⛔ 이야기 하나로 좁히지 않는다 — 파이썬 `시드_목록()` 이 그랬고, 이 화면은 「우리가 지어낸
 *    값이 무엇인가」를 통째로 훑는 자리다.
 */
export async function listSeedCharacters(conn: Conn): Promise<SeedCharacterRow[]> {
  return conn
    .select({
      id: characters.id,
      story_id: characters.story_id,
      code: characters.code,
      name: characters.name,
      persona: characters.persona,
      speech_style: characters.speech_style,
      guidance_style: characters.guidance_style,
      forbidden: characters.forbidden,
      story_title: stories.title,
    })
    .from(characters)
    .innerJoin(stories, eq(stories.id, characters.story_id))
    .orderBy(asc(stories.title), asc(characters.name), asc(characters.id))
}

/**
 * **대화 장면**만 (이야기 제목 · `scene_order` 순).
 *
 * ⭐ 전개 장면이 빠지는 것은 실수가 아니다 — `characters` 를 `INNER JOIN` 하므로
 * 캐릭터가 없는 전개 장면 5개는 애초에 안 걸린다. 화면 제목도 「대화 장면 N개」다.
 * 이 화면이 보는 것은 **캐릭터에 딸린 값**(말투·입장·걱정 문장)이고 전개 지문에는 그게 없다.
 * (파이썬 `저장.시드_목록()` 과 같다. 이식이라 그대로 뒀다.)
 */
export async function listSeedScenes(conn: Conn): Promise<SeedSceneRow[]> {
  return conn
    .select({
      id: story_scenes.id,
      story_id: story_scenes.story_id,
      code: story_scenes.code,
      scene_order: story_scenes.scene_order,
      scene_description: story_scenes.scene_description,
      conflict: story_scenes.conflict,
      character_name: story_scenes.character_name,
      character_id: story_scenes.character_id,
      scene_stance: story_scenes.scene_stance,
      remaining_worries: story_scenes.remaining_worries,
      character_opening: story_scenes.character_opening,
      character_closing: story_scenes.character_closing,
      scene_goal: story_scenes.scene_goal,
      required_elements: story_scenes.required_elements,
      element_criteria: story_scenes.element_criteria,
      preferred_turns: story_scenes.preferred_turns,
      max_turns: story_scenes.max_turns,
      // ⚠️ 화면에 새 칸이 생기지는 않는다 — 무엇을 그리는지는 `service/characters.ts` 의
      //    `장면_순서` 가 정하고 거기에는 안 넣었다 (이슈 #35 의 범위 밖이다).
      //    여기 적는 이유는 `SeedSceneRow` 가 `$inferSelect` 라 **표의 모든 칸**을 요구하기
      //    때문이다. 빠뜨리면 타입이 곧 빨개진다.
      vocabulary: story_scenes.vocabulary,
      story_title: stories.title,
      character_code: characters.code,
    })
    .from(story_scenes)
    .innerJoin(stories, eq(stories.id, story_scenes.story_id))
    // ⛔ `INNER JOIN` 이다. 전개 장면(캐릭터 없음)은 여기서 빠진다 — 위 머리말을 볼 것.
    .innerJoin(characters, eq(characters.id, story_scenes.character_id))
    .orderBy(asc(stories.title), asc(story_scenes.scene_order), asc(story_scenes.id))
}

/** 지금 DB 에 있는 캐릭터·장면 행 id 목록. 「시드를 다시 넣었나」는 이 값으로만 본다. */
export interface SeedFingerprint {
  characters: string[]
  scenes: string[]
}

/** 파이썬 `시드_목록()` 안의 `파일_지문`. 정렬해 둬야 행 순서가 바뀌어도 같은 값이 된다. */
export function seedFingerprint(
  캐릭터들: readonly { id: string }[],
  장면들: readonly { id: string }[],
): SeedFingerprint {
  return {
    characters: [...캐릭터들.map((행) => String(행.id))].sort(),
    scenes: [...장면들.map((행) => String(행.id))].sort(),
  }
}

/** 두 지문이 같은가. ⚠️ 통째 `JSON.stringify` 로 견주지 않는다 — jsonb 가 키 순서를 바꾼다. */
function 같은_지문인가(왼쪽: SeedFingerprint | null, 오른쪽: SeedFingerprint): boolean {
  if (왼쪽 === null) return false
  const 같은_목록 = (가: readonly string[] | undefined, 나: readonly string[]) =>
    Array.isArray(가) && 가.length === 나.length && 가.every((값, 자리) => 값 === 나[자리])
  return 같은_목록(왼쪽.characters, 오른쪽.characters) && 같은_목록(왼쪽.scenes, 오른쪽.scenes)
}

/**
 * 기준점을 확인하고, 지문이 달라졌으면 새로 남긴다. 그 기준점의 번호를 돌려준다.
 *
 * 파이썬 `시드_목록()` 이 목록을 뽑는 김에 하던 일을 떼어 낸 것이다.
 * **커밋은 부르는 쪽이 한다** (결정 18) — 여기서 트랜잭션을 여닫지 않는다.
 */
export async function ensureSeedFileBaseline(conn: Conn): Promise<number> {
  const 지문 = seedFingerprint(
    await conn.select({ id: characters.id }).from(characters),
    await conn.select({ id: story_scenes.id }).from(story_scenes),
  )

  const 기준점들 = await conn
    .select({ id: seed_revisions.id, new_value: seed_revisions.new_value })
    .from(seed_revisions)
    .where(eq(seed_revisions.table_name, 시드파일_표시))
    .orderBy(desc(seed_revisions.id))
    .limit(1)

  const 기준점 = 기준점들[0]
  if (기준점 !== undefined && 같은_지문인가(기준점.new_value as SeedFingerprint | null, 지문)) {
    return 기준점.id
  }

  const 넣은것 = await conn
    .insert(seed_revisions)
    .values({
      table_name: 시드파일_표시,
      row_id: null,
      column_name: null,
      // ⚠️ jsonb 칸의 `null` 은 SQL NULL 로 들어간다 (JSON 의 `null` 이 아니다).
      //    파이썬이 `null()` 로 못박아야 했던 자리인데 드리즐은 그냥 이렇게 된다.
      old_value: null,
      new_value: 지문,
      origin: 'canon',
      changed_by: null,
    })
    .returning({ id: seed_revisions.id })
  return 넣은것[0].id
}

/**
 * 지금 DB 값이 시드 파일과 다른가 (파이썬 `시드_파일과_다름()`).
 *
 * 기준점보다 **뒤에** 쌓인 개정이 하나라도 있으면 누군가 화면에서 고쳤다는 뜻이다.
 */
export async function seedFileDiffers(conn: Conn): Promise<boolean> {
  const 기준점_id = await ensureSeedFileBaseline(conn)
  const 뒤에_쌓인것 = await conn
    .select({ id: seed_revisions.id })
    .from(seed_revisions)
    .where(and(gt(seed_revisions.id, 기준점_id), ne(seed_revisions.table_name, 시드파일_표시)))
    .limit(1)
  return 뒤에_쌓인것.length > 0
}
