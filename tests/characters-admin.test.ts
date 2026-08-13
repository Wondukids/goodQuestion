// 캐릭터 보기 화면 검사 — 파이썬 `tests/test_admin_characters.py` 11개를 옮긴 것 (화면-6).
//
// 이 화면의 존재 이유는 하나다 — **원문에서 온 값과 우리가 지어낸 값을 눈으로 가르는 것.**
// 그 가름의 정본은 `sql/002_seed_banggui.sql` 머리말이므로, 여기서 제일 중요한 검사는
// **`service/characters.ts` 의 출처 표가 그 머리말과 어긋나면 빨간불**이 되는 것이다.
//
// ## 옮기면서 모양이 달라진 것 — 「깨졌다」로 세지 말 것
//
// - 파이썬은 `client.get("/characters").text` 에서 글자를 찾았다. 여기서는 **화면이 그리는
//   자료**(`charactersView()`)를 본다. React 서버 컴포넌트를 검사에서 렌더하는 장치가
//   이 레포에 없고, 있어도 그것은 Jinja 문자열 검사와 같은 「틀 기술 전제」다
//   (`tests/admin.test.ts` 머리말이 그 넷을 버린 것과 같은 잣대다).
// - 「고치는 주소가 없다」는 라우트 표 대신 **폴더를 훑어** 본다 (`app/` 은 파일이 곧 라우트다).

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'

import { characters, seed_revisions, stories, story_scenes } from '@/db/schema'
import { PROJECT_ROOT, WEB_ROOT } from '@/lib/config'
import {
  ensureSeedFileBaseline,
  listSeedCharacters,
  listSeedScenes,
  seedFileDiffers,
  seedFingerprint,
  시드파일_표시,
} from '@/lib/repo/characters-admin'
import { closeDb, getDb, type Conn } from '@/lib/repo/db'
import {
  charactersView,
  needsReview,
  originField,
  지어낸_값,
  원문,
  표시_없음,
  캐릭터_칸,
  장면_칸,
} from '@/lib/service/characters'

// ═══════════════════════════════════════════════════════════════════════════
// 1. 출처 표가 시드 파일 머리말과 어긋나지 않는다 (DB 없이 돈다)
// ═══════════════════════════════════════════════════════════════════════════

const 시드_파일 = path.join(PROJECT_ROOT, 'sql', '002_seed_banggui.sql')
const 시드_글 = readFileSync(시드_파일, 'utf-8')
const 모든_칸 = { ...캐릭터_칸, ...장면_칸 }

/** 그 칸 이름이 이 글에 낱말로 나오나. */
function 나오나(글: string, 이름: string): boolean {
  return new RegExp(`\\b${이름}\\b`).test(글)
}

/** ✏️ 가 붙은 줄에 이름이 나온 칸 전부 (파이썬 `_시드에서_지어낸_칸()`). */
function 시드에서_지어낸_칸(): string[] {
  const 찾은 = new Set<string>()
  for (const 줄 of 시드_글.split('\n')) {
    if (!줄.includes('✏️')) continue
    for (const 이름 of Object.keys(모든_칸)) if (나오나(줄, 이름)) 찾은.add(이름)
  }
  return [...찾은]
}

/** 「원문 그대로인 것:」 목록. 줄이 `/` 로 끝나면 다음 줄까지 이어진다. */
function 시드에서_원문_칸(): string[] {
  const 줄들 = 시드_글.split('\n')
  const 시작 = 줄들.findIndex((줄) => 줄.includes('원문 그대로인 것'))
  expect(시작, '시드 머리말에 「원문 그대로인 것」 목록이 없다').toBeGreaterThanOrEqual(0)

  const 블록: string[] = []
  for (let 자리 = 시작; 자리 < 줄들.length; 자리 += 1) {
    블록.push(줄들[자리])
    if (!줄들[자리].trimEnd().endsWith('/')) break
  }
  const 글 = 블록.join(' ')
  return Object.keys(모든_칸).filter((이름) => 나오나(글, 이름))
}

function 어느_표(이름: string): string {
  return 이름 in 캐릭터_칸 ? 'characters' : 'story_scenes'
}

describe('출처 표 ↔ sql/002_seed_banggui.sql 머리말', () => {
  it('시드가 지어냈다고 적은 칸은 화면도 초안으로 본다', () => {
    const 칸들 = 시드에서_지어낸_칸()
    expect(칸들.length, '✏️ 가 붙은 칸을 하나도 못 찾았으면 이 검사는 아무것도 안 지킨다').toBeGreaterThan(0)
    for (const 이름 of 칸들) {
      expect(originField(어느_표(이름), 이름).origin, `${이름} 이 어긋났다`).toBe(지어낸_값)
    }
  })

  it('시드가 원문이라고 적은 칸은 화면도 정본으로 본다', () => {
    const 칸들 = 시드에서_원문_칸()
    expect(칸들.length).toBeGreaterThan(0)
    for (const 이름 of 칸들) {
      expect(originField(어느_표(이름), 이름).origin, `${이름} 이 어긋났다`).toBe(원문)
    }
  })

  it('머리말이 안 적은 칸은 모름으로 남기고 원문으로 채우지 않는다', () => {
    const 표시 = originField('story_scenes', '이런_칸은_없다')
    expect(표시.origin).toBe(표시_없음)
    expect(표시.origin).not.toBe(원문)
    expect(needsReview('story_scenes', '이런_칸은_없다')).toBe(true)
  })

  it('conflict 는 머리말 목록에 빠져 있어도 지어낸 값이다', () => {
    const 표시 = originField('story_scenes', 'conflict')
    expect(표시.origin).toBe(지어낸_값)
    // 어디를 보고 그렇게 읽었는지가 화면에 뜬다
    expect(표시.source).toContain('152')
  })

  it('원문에서 온 값은 검수 대상이 아니다', () => {
    expect(needsReview('story_scenes', 'character_opening')).toBe(false)
    expect(needsReview('story_scenes', 'scene_goal')).toBe(false)
    // 결정 12 로 우리가 역산해 지어낸 것들이 검수 대상이다
    expect(needsReview('characters', 'persona')).toBe(true)
    expect(needsReview('characters', 'speech_style')).toBe(true)
    expect(needsReview('story_scenes', 'remaining_worries')).toBe(true)
    expect(needsReview('story_scenes', 'scene_stance')).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. 「고치는 주소가 없다」 — 폴더를 훑는다
// ═══════════════════════════════════════════════════════════════════════════

const 화면_폴더 = path.join(WEB_ROOT, 'app', '(admin)', 'characters')

describe('캐릭터 보기 화면은 읽기 전용이다', () => {
  it('폴더에 쓰는 길이 없다 — 서버 액션도 라우트 핸들러도 폼도', () => {
    const 파일들 = readdirSync(화면_폴더, { recursive: true, encoding: 'utf-8' }).filter((이름) =>
      /\.tsx?$/.test(이름),
    )
    expect(파일들.length, '화면 파일을 하나도 못 찾았으면 이 검사는 아무것도 안 지킨다').toBeGreaterThan(0)

    for (const 이름 of 파일들) {
      const 글 = readFileSync(path.join(화면_폴더, 이름), 'utf-8')
      expect(이름, '라우트 핸들러가 생기면 POST 가 열린다').not.toMatch(/^route\.tsx?$/)
      expect(글, `${이름} 에 서버 액션이 생겼다`).not.toContain("'use server'")
      expect(글, `${이름} 에 폼이 생겼다`).not.toMatch(/<form/)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. 화면이 그리는 자료 (DB 를 탄다)
// ═══════════════════════════════════════════════════════════════════════════

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
    `\n[characters-admin.test] Postgres 에 못 붙어 화면 자료 검사를 건너뛴다 (도커가 꺼져 있나?)\n` +
      `            ${못붙는_이유}\n\n`,
  )
}
const DB검사 = 못붙는_이유 === null ? describe : describe.skip

afterAll(async () => {
  await closeDb()
})

class 되돌림 extends Error {}

async function 트랜잭션(본문: (tx: Conn) => Promise<void>): Promise<void> {
  try {
    await getDb().transaction(async (tx) => {
      await 본문(tx)
      throw new 되돌림('검사가 끝났으니 되돌린다')
    })
  } catch (오류) {
    if (!(오류 instanceof 되돌림)) throw 오류
  }
}

interface 씨앗 {
  story_id: string
  character_id: string
  대화_scene_id: string
  전개_scene_id: string
}

/** 이야기 하나 + 캐릭터 하나 + 대화 장면 하나 + 전개 장면 하나. */
async function 콘텐츠_넣기(tx: Conn): Promise<씨앗> {
  const 꼬리 = Math.random().toString(36).slice(2, 10)

  const [이야기] = await tx
    .insert(stories)
    .values({
      code: `s_test_${꼬리}`,
      title: `검사용 이야기 ${꼬리}`,
      summary: '검사용',
      difficulty: '보통',
      status: 'draft',
    })
    .returning({ id: stories.id })

  const [캐릭터] = await tx
    .insert(characters)
    .values({
      story_id: 이야기.id,
      code: 'ch_test_daughter_in_law',
      name: '방귀쟁이 며느리',
      persona: '시집온 지 얼마 안 된 며느리',
      speech_style: '옛이야기 말투',
      guidance_style: '자기 걱정을 소리 내어 말한다',
      forbidden: ['설명하지 않는다'],
    })
    .returning({ id: characters.id })

  const 넣은_장면들 = await tx
    .insert(story_scenes)
    .values([
      {
        story_id: 이야기.id,
        code: 'sc_test_01',
        scene_order: 1,
        scene_description: '전개 지문 하나',
      },
      {
        story_id: 이야기.id,
        code: 'sc_test_02',
        scene_order: 2,
        scene_description: '장면 지문',
        conflict: '검사용 갈등',
        character_id: 캐릭터.id,
        character_name: '며느리',
        character_opening: '첫 대사',
        character_closing: '마지막 대사',
        scene_stance: '아직 참고 있다',
        scene_goal: '장면 목표',
        required_elements: ['EMOTION', 'SOLUTION'],
        remaining_worries: { EMOTION: '나도 내 마음을 잘 모르겠어' },
        preferred_turns: 2,
        max_turns: 4,
      },
    ])
    .returning({ id: story_scenes.id, code: story_scenes.code })

  const 자리 = Object.fromEntries(넣은_장면들.map((행) => [행.code, 행.id]))
  return {
    story_id: 이야기.id,
    character_id: 캐릭터.id,
    전개_scene_id: 자리['sc_test_01'],
    대화_scene_id: 자리['sc_test_02'],
  }
}

/** 시드 파일 기준점이 지금 몇 줄인가 (`tests/seed-admin.test.ts` 의 같은 이름 함수와 같은 관례다). */
async function 기준점_수(tx: Conn): Promise<number> {
  const 행들 = await tx
    .select({ 수: sql<number>`count(*)::int` })
    .from(seed_revisions)
    .where(sql`${seed_revisions.table_name} = ${시드파일_표시}`)
  return 행들[0].수
}

DB검사('화면 자료', () => {
  it('캐릭터와 장면 값이 한 화면에 다 나온다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const 본것 = await charactersView(tx)

      const 캐릭터 = 본것.characters.find((하나) => 하나.id === 씨.character_id)
      expect(캐릭터).toBeDefined()
      expect(캐릭터!.name).toBe('방귀쟁이 며느리')
      const 캐릭터_값 = Object.fromEntries(캐릭터!.fields.map((칸) => [칸.column, 칸.value]))
      expect(캐릭터_값.persona).toBe('시집온 지 얼마 안 된 며느리')
      expect(캐릭터_값.speech_style).toBe('옛이야기 말투')
      expect(캐릭터_값.forbidden).toEqual(['설명하지 않는다'])

      const 장면 = 본것.scenes.find((하나) => 하나.id === 씨.대화_scene_id)
      expect(장면).toBeDefined()
      const 장면_값 = Object.fromEntries(장면!.fields.map((칸) => [칸.column, 칸.value]))
      // ⭐ 시드 편집 화면에는 없는 칸들이다 — 여기서만 본다
      expect(장면_값.character_opening).toBe('첫 대사')
      expect(장면_값.character_closing).toBe('마지막 대사')
      expect(장면_값.scene_goal).toBe('장면 목표')
      expect(장면_값.conflict).toBe('검사용 갈등')
      expect(장면_값.required_elements).toEqual(['EMOTION', 'SOLUTION'])
    })
  })

  it('칸이 정본과 초안으로 갈려 세어진다', async () => {
    await 트랜잭션(async (tx) => {
      await 콘텐츠_넣기(tx)
      const 본것 = await charactersView(tx)

      expect(본것.counts.canon).toBeGreaterThan(0)
      expect(본것.counts.draft).toBeGreaterThan(0)
      // 캐릭터 넷은 전부 초안, 장면의 고정 대사는 정본이다
      const 캐릭터_출처 = new Set(본것.characters.flatMap((하나) => 출처들(하나.fields)))
      expect([...캐릭터_출처]).toEqual([지어낸_값])
      const 첫대사 = 본것.scenes[0].fields.find((칸) => 칸.column === 'character_opening')
      expect(첫대사?.origin).toBe(원문)
      expect(첫대사?.origin_label).toBe('정본')
      expect(첫대사?.review_needed).toBe(false)
    })
  })

  it('걱정 문장이 요소별로 갈려 나온다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const 본것 = await charactersView(tx)
      const 장면 = 본것.scenes.find((하나) => 하나.id === 씨.대화_scene_id)

      expect(장면!.worries).toEqual({ EMOTION: '나도 내 마음을 잘 모르겠어' })
      // 통째 JSON 한 덩이가 아니라 표에 뿌릴 수 있는 모양이어야 한다
      expect(Object.keys(장면!.worries)).toEqual(['EMOTION'])
      // 걱정 문장 칸 자체는 위 목록에서 빠지지 않는다 (화면이 따로 그린다)
      expect(장면!.fields.some((칸) => 칸.column === 'remaining_worries')).toBe(true)
    })
  })

  it('전개 장면은 이 화면에 안 나온다 (대화 장면만이다)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const 장면들 = await listSeedScenes(tx)

      expect(장면들.some((행) => 행.id === 씨.대화_scene_id)).toBe(true)
      expect(장면들.some((행) => 행.id === 씨.전개_scene_id)).toBe(false)
    })
  })

  it('시드를 고치면 파일과 다르다는 사실을 여기서도 알린다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      expect(await seedFileDiffers(tx)).toBe(false)

      // 시드 편집 화면이 남기는 개정 한 줄 (그 화면은 다른 트랙이 옮긴다)
      await tx.insert(seed_revisions).values({
        table_name: 'characters',
        row_id: 씨.character_id,
        column_name: 'persona',
        old_value: '시집온 지 얼마 안 된 며느리',
        new_value: '기획자가 고친 성격',
        origin: 'draft',
        changed_by: 'tester',
      })

      expect(await seedFileDiffers(tx)).toBe(true)
      expect((await charactersView(tx)).file_differs).toBe(true)
    })
  })

  it('지문이 그대로면 기준점을 또 남기지 않는다', async () => {
    await 트랜잭션(async (tx) => {
      await 콘텐츠_넣기(tx)
      // ⚠️ 전체 개수를 세지 않는다 — `seed_revisions` 에는 사람이 시드 화면을 쓰며
      //    커밋한 기준점이 이미 쌓여 있다. 이 트랜잭션은 되돌려도 그 행들은 남으므로
      //    「몇 개인가」가 아니라 **이 트랜잭션이 몇 줄 늘렸나**를 본다.
      const 처음 = await 기준점_수(tx)

      const 첫_id = await ensureSeedFileBaseline(tx)
      expect(await 기준점_수(tx), '콘텐츠가 늘었으니 기준점 한 줄이 남아야 한다').toBe(처음 + 1)

      const 두번째_id = await ensureSeedFileBaseline(tx)
      expect(두번째_id).toBe(첫_id)
      expect(await 기준점_수(tx), '지문이 그대로면 더 안 쌓인다').toBe(처음 + 1)
    })
  })

  it('지문은 캐릭터·장면 id 를 정렬해 담는다', async () => {
    await 트랜잭션(async (tx) => {
      await 콘텐츠_넣기(tx)
      const 지문 = seedFingerprint(await listSeedCharacters(tx), await listSeedScenes(tx))
      expect(지문.characters).toEqual([...지문.characters].sort())
      expect(지문.scenes).toEqual([...지문.scenes].sort())
    })
  })
})

/** 칸 목록에서 출처만. (`flatMap` 안에서 두 번 쓰려고 뺐다.) */
function 출처들(칸들: readonly { origin: string }[]): string[] {
  return 칸들.map((칸) => 칸.origin)
}
