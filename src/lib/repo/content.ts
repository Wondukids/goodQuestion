// 콘텐츠 읽기 — **코드**로 이야기·장면·캐릭터·앞선 전개를 찾는다.
//
// 파이썬 `src/goodquestion_api/콘텐츠.py`(56줄) + `src/goodquestion/db.py` 의 읽기 두 개
// (`장면들`·`장면_읽기`)를 옮긴 것이다 (이슈 #26 저장-3).
//
// **「무상태」는 세션 상태를 안 갖는다는 뜻이지 콘텐츠를 안 갖는다는 뜻이 아니다** (`CLAUDE.md`).
// 콘텐츠까지 부르는 쪽에 넘기면 관리자 페이지에서 시드를 고쳐도 저쪽이 모른다.
// 우리가 읽으면 **고친 다음 호출부터 바로 반영된다** — 배포·동기화 경로가 필요 없다.
//
// ## ⭐ 제목이 아니라 코드로 가리킨다 — 파이썬과 갈리는 자리
//
// 파이썬은 `stories` 에 열쇠 칸이 없어서 `_슬러그 = {"fart-bride": "방귀 뀌는 며느리"}` 표를
// 두고 **제목**으로 조회했다. `stories.title` 에는 UNIQUE 가 없어서 제목이 같은 이야기가
// 둘이면 조용히 섞였고, 제목은 사람이 화면에서 고칠 수 있는 값이다.
// 이제 `stories.slug` · `story_scenes.code` 가 DB 에 실제로 있으므로(시드가 채웠다)
// **임시 슬러그 표는 함께 사라진다** (`docs/설계/라우트계약.md` 1절 마지막 줄).
// ⚠️ 이야기 쪽 열쇠 이름은 `code` 가 아니라 **`slug`** 다 (2026-08-13 결정 3 · 4차) —
//    저쪽 DB 에 이미 있는 칸에 맞췄고, 값도 파이썬 `_슬러그` 와 같은 `fart-bride` 다.
//    바깥 이름(`story_code` 경로 조각)은 그대로 둔다. 라우트 계약이 그 이름으로 서 있다.
//
// ⛔ 이 층은 Drizzle 스키마만 안다 (`docs/설계/코드구조.md` 1절). eslint 가 막아 뒀다.
//    `domain/progress` 는 최하층이라 가져다 쓴다 — 파이썬 `콘텐츠.py` 도 `진행` 을 import 했다.

import { asc, eq } from 'drizzle-orm'

import { characters, stories, story_scenes } from '@/db/schema'
import { LookupError, precedingNarration } from '@/lib/domain/progress'

import type { Conn } from './db'

/**
 * 씬 키가 가리키는 장면이 없다. 재시도해도 같다 (404 `SCENE_NOT_FOUND`).
 *
 * 파이썬 `씬없음(LookupError)` 자리다. `LookupError` 를 상속하는 것도 그대로다 —
 * 「인자가 틀렸다(`ValueError`)」와 「목록에 없다」를 갈라 두려는 것이다.
 */
export class SceneNotFound extends LookupError {
  constructor(message: string) {
    super(message)
    this.name = 'SceneNotFound'
  }
}

/**
 * 장면 한 행 — `story_scenes` 에 `characters` 를 붙인 것.
 *
 * 분석 LLM 은 이 중 캐릭터 쪽을 절대 보지 않는다 (`docs/기준/대화작동규칙.md:81`).
 *
 * ⚠️ **딱 한 칸만 이름이 다르다** — `story_scenes.id` 는 `characters.id` 와 부딪혀
 * `scene_id` 로 받는다. `messages.scene_id` 가 이미 그 값을 그 이름으로 부른다.
 * (파이썬 `db.py` 머리말과 같은 규칙이다.)
 */
const 장면_컬럼 = {
  scene_id: story_scenes.id,
  story_id: story_scenes.story_id,
  // 파이썬 판에는 없던 칸이다. 이제 이것이 장면을 가리키는 열쇠다.
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
  character_code: characters.code,
  persona: characters.persona,
  speech_style: characters.speech_style,
  guidance_style: characters.guidance_style,
  forbidden: characters.forbidden,
}

/** 장면 한 행. 키가 DB 컬럼 이름 그대로인 평범한 객체다 (변환 층을 두지 않는다). */
export interface SceneRow {
  scene_id: string
  story_id: string
  code: string
  scene_order: number
  scene_description: string | null
  conflict: string | null
  character_name: string | null
  character_id: string | null
  scene_stance: string | null
  remaining_worries: Record<string, string>
  character_opening: string | null
  character_closing: string | null
  scene_goal: string | null
  required_elements: string[] | null
  element_criteria: Record<string, string>
  preferred_turns: number | null
  max_turns: number | null
  // 아래 다섯은 `characters` 에서 온다. 전개 장면(캐릭터 없음)이면 전부 null 이다.
  character_code: string | null
  persona: string | null
  speech_style: string | null
  guidance_style: string | null
  forbidden: string[] | null
}

/** `stories` 한 행. 스키마에서 그대로 뽑는다 — 칸을 두 곳에 적으면 갈린다. */
export type StoryRow = typeof stories.$inferSelect

/** 이야기 하나를 `slug` 로 읽는다. 없으면 던진다. */
export async function readStory(conn: Conn, story_code: string): Promise<StoryRow> {
  const 행들 = await conn.select().from(stories).where(eq(stories.slug, story_code)).limit(1)
  if (행들.length === 0) throw new SceneNotFound(`모르는 이야기다: ${story_code}`)
  return 행들[0]
}

/** 이야기 목록. 회차 시작 화면이 고르게 하려면 필요하다. */
export async function listStories(conn: Conn): Promise<StoryRow[]> {
  return conn.select().from(stories).orderBy(asc(stories.title), asc(stories.id))
}

/**
 * 이야기의 장면 전부를 `scene_order` 순으로. **전개 장면도 함께다** (결정 11).
 *
 * `nextStep()` 이 이 목록을 통째로 받아 다음 할 일을 고른다.
 */
export async function scenesOfStory(conn: Conn, story_code: string): Promise<SceneRow[]> {
  return conn
    .select(장면_컬럼)
    .from(story_scenes)
    .innerJoin(stories, eq(stories.id, story_scenes.story_id))
    .leftJoin(characters, eq(characters.id, story_scenes.character_id))
    .where(eq(stories.slug, story_code))
    .orderBy(asc(story_scenes.scene_order))
}

/** 같은 이야기 안의 장면 전부. `story_id` 를 이미 들고 있을 때 쓴다. */
export async function scenesOfStoryId(conn: Conn, story_id: string): Promise<SceneRow[]> {
  return conn
    .select(장면_컬럼)
    .from(story_scenes)
    .leftJoin(characters, eq(characters.id, story_scenes.character_id))
    .where(eq(story_scenes.story_id, story_id))
    .orderBy(asc(story_scenes.scene_order))
}

/** 장면 하나를 id 로. 세션의 `current_scene_id` 로 찾는 자리다. */
export async function readScene(conn: Conn, scene_id: string): Promise<SceneRow> {
  const 행들 = await conn
    .select(장면_컬럼)
    .from(story_scenes)
    .leftJoin(characters, eq(characters.id, story_scenes.character_id))
    .where(eq(story_scenes.id, scene_id))
    .limit(1)
  if (행들.length === 0) throw new SceneNotFound(`장면이 없다: ${scene_id}`)
  return 행들[0]
}

/**
 * (장면 한 행, 앞선 전개 장면들) 을 돌려준다.
 *
 * `precedingNarration` 은 **전개 장면만**이고 현재보다 앞선 것까지다
 * (결정 25 — 뒷이야기 스포일러 금지).
 *
 * ⚠️ 경로가 두 토막인 것은 스키마가 `UNIQUE (story_id, code)` 이기 때문이다 —
 *    씬 코드 하나만으로는 전역에서 유일하지 않다 (`docs/설계/라우트계약.md` 6절).
 */
export async function findScene(
  conn: Conn,
  { story_code, scene_code }: { story_code: string; scene_code: string },
): Promise<{ scene: SceneRow; preceding: readonly SceneRow[] }> {
  const 장면_전부 = await scenesOfStory(conn, story_code)
  if (장면_전부.length === 0) {
    // 이야기가 아예 없는 것과 장면이 없는 것을 갈라 말해 준다.
    await readStory(conn, story_code)
    throw new SceneNotFound(`이야기에 장면이 없다: ${story_code}`)
  }

  const 장면 = 장면_전부.find((행) => 행.code === scene_code)
  if (장면 === undefined) {
    throw new SceneNotFound(`${story_code} 에 ${scene_code} 장면이 없다`)
  }
  // `precedingNarration` 은 최하층이라 세 칸(`scene_id`·`scene_order`·`character_id`)만 아는
  // 좁은 타입으로 받고 낸다. 걸러 낸 것은 **우리가 넣은 그 행 그대로**라 여기서 되돌린다.
  const 앞선 = precedingNarration(장면_전부, 장면) as readonly SceneRow[]
  return { scene: 장면, preceding: 앞선 }
}

/** 대화 장면이 아니면 부를 이유가 없는 호출들이 쓴다 (아이가 말하지 않는 장면이다). */
export function requireDialogueScene(scene: SceneRow): SceneRow {
  if (scene.character_id === null) {
    throw new SceneNotFound(`${scene.code} 는 전개 장면이라 대화가 없다`)
  }
  return scene
}
