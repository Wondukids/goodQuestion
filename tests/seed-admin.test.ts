// 시드 작업대 검사 (이슈 #26 화면-2) — `lib/service/seed.ts` · `lib/repo/seed.ts`.
//
// 파이썬 `tests/test_admin_seed.py` 자리다. 두 갈래로 갈린다.
//
//   1. **글자만 다루는 것** — 폼 값 읽기 · 시드 파일 파서 · 내보내기 SQL 조립.
//      DB 없이 돈다. 시드 파일은 레포의 진짜 `sql/002_seed_banggui.sql` 을 읽는다 —
//      대조 화면이 그 파일 모양에 기대고 있으므로 **진짜 파일이 아니면 재는 뜻이 없다.**
//   2. **진짜 DB 를 쓰는 것** — 개정 이력·되돌리기·CHECK 위반 옮기기.
//      `tests/repo.test.ts` 와 같은 방식이다: 트랜잭션을 열고 끝나면 **무조건 롤백**한다.
//      DB 에 못 붙으면 `describe.skip` 이라 vitest 보고에 「skipped」로 뜬다 —
//      통과로 보이면 「검사가 다 초록인데 시드 화면은 한 번도 안 돌아 본」 상태가 된다.
//
// ⛔ LLM 은 이 화면과 아무 상관이 없다. `tests/setup.ts` 의 F-1 그물이 그것을 지킨다.

import { randomUUID } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'

import { characters, seed_revisions, stories, story_scenes } from '@/db/schema'
import { ValueError } from '@/lib/domain/progress'
import { closeDb, getDb, type Conn } from '@/lib/repo/db'
import {
  latestSeedRevision,
  listSeed,
  seedFileDiffers,
  undoSeedRevision,
  updateSeedCell,
  대화_장면_입장_경고,
  시드파일_표이름,
  같은_값,
} from '@/lib/repo/seed'
import {
  CHECK_위반,
  DB가_거절한_이유,
  saveSeedCell,
  seedExportSql,
  seedWorkbench,
  undoSeedCell,
  sql_문자열,
  sql_배열,
  sql_숫자,
  값_읽기,
  빈_칸_경고,
  시드_파일_값들,
  시드_파일_경로,
  주석_제거,
  최상위_쉼표로_나누기,
  칸_id,
  칸_이름,
  칸자리_이름,
} from '@/lib/service/seed'

// ═══════════════════════════════════════════════════════════════════════════
// 1. 글자만 다루는 것
// ═══════════════════════════════════════════════════════════════════════════

describe('값_읽기 — 사람이 친 글자를 칸 모양대로', () => {
  it('턴 수는 정수만 받는다', () => {
    expect(값_읽기(' 4 ', 'max_turns')).toBe(4)
    expect(() => 값_읽기('1.5', 'preferred_turns')).toThrow(ValueError)
    expect(() => 값_읽기('네 번', 'max_turns')).toThrow('턴 수는 정수여야 한다')
  })

  it('목록 칸은 줄바꿈과 쉼표로 가르고 빈 줄을 떨어낸다', () => {
    expect(값_읽기('가르치기\n\n평가하기, 끝내기', 'forbidden')).toEqual([
      '가르치기',
      '평가하기',
      '끝내기',
    ])
  })

  it('요구 요소는 **화면 이름을 코드로 되돌린다** — 모르는 이름은 그대로 둔다', () => {
    expect(값_읽기('공감, 해결, ZZZ', 'required_elements')).toEqual([
      'EMPATHY',
      'SOLUTION',
      'ZZZ',
    ])
  })

  it('걱정 문장은 문자열 사전이어야 한다', () => {
    expect(값_읽기('{"SOLUTION": "어쩌지…"}', 'remaining_worries')).toEqual({
      SOLUTION: '어쩌지…',
    })
    expect(() => 값_읽기('{', 'remaining_worries')).toThrow('걱정 문장은 JSON 객체여야 한다')
    expect(() => 값_읽기('["가"]', 'remaining_worries')).toThrow(ValueError)
    expect(() => 값_읽기('{"SOLUTION": 3}', 'remaining_worries')).toThrow(ValueError)
  })

  it('글 칸은 **다듬지 않는다** — 줄바꿈도 따옴표도 그대로다', () => {
    expect(값_읽기(' 앞뒤 공백\n둘째 줄 ', 'persona')).toBe(' 앞뒤 공백\n둘째 줄 ')
  })
})

describe('시드 파일 파서 — 대조용으로 읽기만 한다', () => {
  it('SQL 문자열 **밖**의 주석만 지운다', () => {
    expect(주석_제거("('가--나', 'x') -- 뒤에 붙은 설명\n('다')")).toBe(
      "('가--나', 'x') \n('다')",
    )
  })

  it('맨 바깥 쉼표로만 자른다 (배열·괄호·따옴표 안은 건너뛴다)', () => {
    expect(최상위_쉼표로_나누기("1, ARRAY['가', '나'], '쉼표, 안'")).toEqual([
      '1',
      "ARRAY['가', '나']",
      "'쉼표, 안'",
    ])
  })

  it('진짜 sql/002 에서 캐릭터 3명과 대화 장면 4개를 읽는다', () => {
    const 값 = 시드_파일_값들(시드_파일_경로())

    expect(Object.keys(값.characters).sort()).toEqual([
      'ch_banggui_daughter_in_law',
      'ch_banggui_father_in_law',
      'ch_banggui_village_chief',
    ])
    // 여러 줄로 이어 쓴 문자열 리터럴이 한 값으로 붙어야 한다.
    expect(값.characters.ch_banggui_daughter_in_law.persona).toContain('시집온 지 얼마 안 된')
    expect(값.characters.ch_banggui_daughter_in_law.forbidden.length).toBeGreaterThan(1)

    expect(Object.keys(값.scenes).map(Number).sort((가, 나) => 가 - 나)).toEqual([3, 5, 7, 9])
    const 장면3 = 값.scenes[3]
    expect(장면3.required_elements).toEqual(['PERSPECTIVE', 'EMPATHY', 'REASON', 'SOLUTION'])
    expect(장면3.preferred_turns).toBe(2)
    expect(장면3.max_turns).toBe(4)
    expect(Object.keys(장면3.remaining_worries).sort()).toEqual([
      'EMPATHY',
      'PERSPECTIVE',
      'REASON',
      'SOLUTION',
    ])
  })

  it('칸 수가 달라지면 조용히 넘어가지 않고 던진다', () => {
    // 화면은 이 예외를 「시드 파일을 못 읽었습니다」 띠로 바꾼다 — 500 이 되면 안 된다.
    expect(() => 시드_파일_값들('/없는/자리/002_seed_banggui.sql')).toThrow()
  })
})

describe('내보내기 SQL 조각', () => {
  it('따옴표를 겹쳐 막고, 빈 값은 NULL 로 적는다', () => {
    expect(sql_문자열("아이가 '응' 했다")).toBe("'아이가 ''응'' 했다'")
    expect(sql_문자열(null)).toBe('NULL')
    expect(sql_숫자(null)).toBe('NULL')
    expect(sql_숫자(4)).toBe('4')
  })

  it('빈 배열과 없는 배열을 가른다', () => {
    expect(sql_배열([])).toBe('ARRAY[]::text[]')
    expect(sql_배열(null)).toBe('NULL')
    expect(sql_배열(['가', '나'])).toBe("ARRAY['가', '나']::text[]")
  })

  it('빈 칸은 SQL 주석으로 **눈에 띄게** 남는다', () => {
    expect(빈_칸_경고('story_scenes', { scene_stance: null, max_turns: 4 }, [
      'scene_stance',
      'max_turns',
    ])).toEqual(['-- ⚠️ 비어서 NULL 로 적었다: 이 장면에서의 입장. 이대로 부으면 DB 가 거절할 수 있다.'])
    expect(빈_칸_경고('story_scenes', { max_turns: 4 }, ['max_turns'])).toEqual([])
  })
})

describe('경고를 어느 칸에 붙이나', () => {
  const row_id = '11111111-2222-3333-4444-555555555555'

  it('칸 자리 이름과 그 이름이 **같은 함수 짝**으로 오간다', () => {
    const 자리 = 칸_id('story_scenes', row_id, 'remaining_worries', 'SOLUTION')
    expect(자리).toBe(`칸-story_scenes-${row_id}-remaining_worries-SOLUTION`)
    expect(칸자리_이름(자리)).toBe('요소별 걱정 문장(해결)')
    expect(칸자리_이름(칸_id('characters', row_id, 'persona'))).toBe('성격·처지')
  })

  it('모르는 칸이면 화면에 안 내보낸다', () => {
    expect(칸자리_이름(칸_id('characters', row_id, 'zzz'))).toBeNull()
    expect(칸자리_이름('아무거나')).toBeNull()
    // 모르는 칸은 열 이름이 그대로 돌아온다 (파이썬 `출처.칸()` 과 같다).
    expect(칸_이름('characters', 'zzz')).toBe('zzz')
  })
})

describe('DB 가 거절한 것을 사람 말로', () => {
  it('싸여 있는 CHECK 위반을 벗겨 낸다', () => {
    const 진짜 = Object.assign(new Error('violates check constraint'), {
      code: '23514',
      constraint_name: 'preferred_turns_not_over_max',
    })
    const 싼것 = Object.assign(new Error('Failed query'), { cause: 진짜 })
    expect(CHECK_위반(싼것)).toBe('preferred_turns_not_over_max')
    expect(CHECK_위반(new Error('그냥 오류'))).toBeNull()
  })

  it('아는 제약은 사람 말로, 모르는 제약도 500 이 아니다', () => {
    expect(DB가_거절한_이유('dialogue_scene_needs_all_parts')).toBe(대화_장면_입장_경고)
    expect(DB가_거절한_이유('preferred_turns_not_over_max')).toBe(
      '선호 턴은 최대 턴보다 클 수 없습니다.',
    )
    expect(DB가_거절한_이유('모르는제약')).toContain('저장할 수 없습니다')
  })
})

describe('같은_값 — 목록·사전도 값으로 견준다', () => {
  it('이전 값과 새 값이 같은지 가른다', () => {
    expect(같은_값(['가', '나'], ['가', '나'])).toBe(true)
    expect(같은_값(['가', '나'], ['나', '가'])).toBe(false)
    expect(같은_값({ A: '1' }, { A: '1' })).toBe(true)
    expect(같은_값({ A: '1' }, { A: '1', B: '2' })).toBe(false)
    expect(같은_값(4, 4)).toBe(true)
    expect(같은_값(null, null)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. 진짜 DB 를 쓰는 것
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
    `\n[seed-admin.test] Postgres 에 못 붙어 시드 화면 검사를 건너뛴다 (도커가 꺼져 있나?)\n` +
      `                  ${못붙는_이유}\n\n`,
  )
}
const 검사 = 못붙는_이유 === null ? describe : describe.skip

afterAll(async () => {
  await closeDb()
})

class 되돌림 extends Error {}

/** 이 안에서 넣은 행은 검사가 끝나면 전부 사라진다. */
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
  story_title: string
  story_slug: string
  character_id: string
  /** 대화 장면 */
  scene_id: string
  /** 전개 장면 — 캐릭터가 없어 시드 화면에 **안 뜬다** */
  narration_id: string
}

/** 이야기 하나 + 캐릭터 하나 + 대화 장면 하나 + 전개 장면 하나. */
async function 콘텐츠_넣기(tx: Conn): Promise<씨앗> {
  const 꼬리 = randomUUID().slice(0, 8)
  const [이야기] = await tx
    .insert(stories)
    .values({
      slug: `s-seed-${꼬리}`,
      title: `시드검사 이야기 ${꼬리}`,
      summary: '검사용',
      difficulty: '보통',
      status: 'draft',
    })
    .returning({ id: stories.id, title: stories.title, slug: stories.slug })

  const [캐릭터] = await tx
    .insert(characters)
    .values({
      story_id: 이야기.id,
      code: 'ch_seed_test',
      name: '검사용 며느리',
      persona: '처음 성격',
      speech_style: '처음 말투',
      guidance_style: '처음 드러내는 방식',
      forbidden: ['가르치기'],
    })
    .returning({ id: characters.id })

  const [대화] = await tx
    .insert(story_scenes)
    .values({
      story_id: 이야기.id,
      code: 'sc_seed_02',
      scene_order: 2,
      conflict: '갈등',
      character_id: 캐릭터.id,
      character_name: '검사용 며느리',
      character_opening: '첫 대사',
      character_closing: '마지막 대사',
      scene_stance: '처음 입장',
      scene_goal: '장면 목표',
      required_elements: ['EMPATHY', 'SOLUTION'],
      remaining_worries: { EMPATHY: '내 마음을 모르겠어…', SOLUTION: '어떻게 하지…' },
      preferred_turns: 2,
      max_turns: 4,
    })
    .returning({ id: story_scenes.id })

  const [전개] = await tx
    .insert(story_scenes)
    .values({
      story_id: 이야기.id,
      code: 'sc_seed_01',
      scene_order: 1,
      scene_description: '전개 지문',
    })
    .returning({ id: story_scenes.id })

  return {
    story_id: 이야기.id,
    story_title: 이야기.title,
    story_slug: 이야기.slug,
    character_id: 캐릭터.id,
    scene_id: 대화.id,
    narration_id: 전개.id,
  }
}

검사('시드 목록', () => {
  it('대화 장면만 뜨고, 칸마다 기본 출처가 붙는다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const 자료 = await listSeed(tx)

      const 장면 = 자료.scenes.find((행) => 행.id === 씨.scene_id)
      expect(장면).toBeDefined()
      expect(자료.scenes.some((행) => 행.id === 씨.narration_id)).toBe(false)
      // 원문에서 온 값 둘만 `canon` 이다 (`sql/002` 머리말 — 원문 그대로인 것).
      expect(장면!.origins.required_elements).toBe('canon')
      expect(장면!.origins.max_turns).toBe('canon')
      expect(장면!.origins.scene_stance).toBe('draft')
      expect(장면!.origins.preferred_turns).toBe('draft')

      const 캐릭터 = 자료.characters.find((행) => 행.id === 씨.character_id)
      expect(캐릭터!.story_title).toBe(씨.story_title)
      expect(캐릭터!.origins.persona).toBe('draft')
    })
  })

  it('캐릭터·장면이 늘면 기준점을 한 줄 남기고, 그대로면 안 남긴다', async () => {
    await 트랜잭션(async (tx) => {
      await 콘텐츠_넣기(tx)
      await listSeed(tx)
      const 처음 = await 기준점_수(tx)
      await listSeed(tx)
      expect(await 기준점_수(tx)).toBe(처음) // 지문이 같으면 안 쌓인다

      await 콘텐츠_넣기(tx)
      await listSeed(tx)
      expect(await 기준점_수(tx)).toBe(처음 + 1)
    })
  })

  it('개정이 쌓이기 전에는 시드 파일과 다르지 않다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      expect(await seedFileDiffers(tx)).toBe(false)

      await updateSeedCell(tx, {
        table_name: 'characters',
        row_id: 씨.character_id,
        column_name: 'persona',
        new_value: '고친 성격',
        origin: 'draft',
        changed_by: '검사',
      })
      expect(await seedFileDiffers(tx)).toBe(true)
    })
  })
})

async function 기준점_수(tx: Conn): Promise<number> {
  const 행들 = await tx
    .select({ 수: sql<number>`count(*)::int` })
    .from(seed_revisions)
    .where(eq(seed_revisions.table_name, 시드파일_표이름))
  return 행들[0].수
}

검사('한 칸 고치기', () => {
  it('값이 바뀌고 개정 한 줄이 남는다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const 개정 = await updateSeedCell(tx, {
        table_name: 'characters',
        row_id: 씨.character_id,
        column_name: 'forbidden',
        new_value: ['가르치기', '평가하기'],
        origin: 'canon',
        changed_by: 'tester@example.com',
      })

      expect(개정.old_value).toEqual(['가르치기'])
      expect(개정.new_value).toEqual(['가르치기', '평가하기'])
      expect(개정.origin).toBe('canon')
      expect(개정.changed_by).toBe('tester@example.com')

      const [행] = await tx
        .select({ forbidden: characters.forbidden })
        .from(characters)
        .where(eq(characters.id, 씨.character_id))
      expect(행.forbidden).toEqual(['가르치기', '평가하기'])

      // 다음 목록에서 그 칸의 출처가 개정을 따라간다.
      const 자료 = await listSeed(tx)
      expect(자료.characters.find((행) => 행.id === 씨.character_id)!.origins.forbidden).toBe(
        'canon',
      )
      expect(자료.revisions[0].id).toBe(개정.id) // 최근 것이 위
    })
  })

  it('고칠 수 없는 칸·모르는 출처·같은 값은 거절한다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const 기본 = {
        table_name: 'characters',
        row_id: 씨.character_id,
        column_name: 'persona',
        new_value: '다른 성격' as const,
        origin: 'draft',
        changed_by: null,
      }
      await expect(updateSeedCell(tx, { ...기본, column_name: 'name' })).rejects.toThrow(
        '고칠 수 없는 시드 칸',
      )
      await expect(updateSeedCell(tx, { ...기본, table_name: 'stories' })).rejects.toThrow(
        ValueError,
      )
      await expect(updateSeedCell(tx, { ...기본, origin: 'external' })).rejects.toThrow(
        '모르는 시드 출처',
      )
      await expect(
        updateSeedCell(tx, { ...기본, new_value: '처음 성격' }),
      ).rejects.toThrow('이전 값과 새 값이 같다')
    })
  })

  it('대화 장면의 입장은 비울 수 없다 — DB 에 닿기 전에 사람 말로 막는다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      await expect(
        updateSeedCell(tx, {
          table_name: 'story_scenes',
          row_id: 씨.scene_id,
          column_name: 'scene_stance',
          new_value: '   ',
          origin: 'draft',
          changed_by: null,
        }),
      ).rejects.toThrow(대화_장면_입장_경고)
    })
  })

  it('최신 시드 개정 번호가 개정을 따라 오른다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const 전 = await latestSeedRevision(tx)
      const 개정 = await updateSeedCell(tx, {
        table_name: 'story_scenes',
        row_id: 씨.scene_id,
        column_name: 'preferred_turns',
        new_value: 3,
        origin: 'draft',
        changed_by: null,
      })
      expect(await latestSeedRevision(tx)).toBe(Number(개정.id))
      expect(Number(개정.id)).toBeGreaterThan(전)
    })
  })
})

검사('되돌리기', () => {
  it('직전 값으로 돌리고 그 사실도 개정으로 남는다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const 개정 = await updateSeedCell(tx, {
        table_name: 'story_scenes',
        row_id: 씨.scene_id,
        column_name: 'scene_stance',
        new_value: '고친 입장',
        origin: 'draft',
        changed_by: null,
      })

      const 되돌림 = await undoSeedRevision(tx, {
        revision_id: Number(개정.id),
        changed_by: '되돌린 사람',
      })
      expect(되돌림.new_value).toBe('처음 입장')
      expect(되돌림.old_value).toBe('고친 입장')

      const [행] = await tx
        .select({ scene_stance: story_scenes.scene_stance })
        .from(story_scenes)
        .where(eq(story_scenes.id, 씨.scene_id))
      expect(행.scene_stance).toBe('처음 입장')

      // 두 번은 안 된다 — 이미 그 값이다.
      await expect(
        undoSeedRevision(tx, { revision_id: Number(개정.id), changed_by: null }),
      ).rejects.toThrow('이미 직전 값으로 되돌아가 있다')
    })
  })

  it('시드 파일 기준점은 되돌릴 수 없다', async () => {
    await 트랜잭션(async (tx) => {
      await 콘텐츠_넣기(tx)
      await listSeed(tx)
      const [기준점] = await tx
        .select({ id: seed_revisions.id })
        .from(seed_revisions)
        .where(eq(seed_revisions.table_name, 시드파일_표이름))
        .orderBy(sql`${seed_revisions.id} desc`)
        .limit(1)
      await expect(
        undoSeedRevision(tx, { revision_id: Number(기준점.id), changed_by: null }),
      ).rejects.toThrow('시드 파일 기준점은 되돌릴 수 없다')
    })
  })

  it('없는 개정이면 못 찾았다고 말한다', async () => {
    await 트랜잭션(async (tx) => {
      await expect(undoSeedCell({ revision_id: 999_999_999 }, tx)).rejects.toThrow(
        '시드 개정이 없다',
      )
    })
  })
})

검사('서비스 — 폼에서 온 글자로 저장한다', () => {
  // 🔴 **파이썬과 같은 자리다** — 걱정 문장 한 칸을 사람 말로 저장하면 지금은 거절당한다.
  //    `_값_읽기()` 가 `json_key` 갈림보다 **먼저** 돌아 JSON 이 아니면 던지기 때문이고,
  //    파이썬에도 이 경로를 재는 검사가 없었다. 이식은 그대로 옮기는 일이라 고치지 않았다 —
  //    고치기로 하면 `saveSeedCell()` 의 순서를 뒤집고 이 검사를 뒤집는다.
  it('걱정 문장 한 칸은 (파이썬과 똑같이) JSON 이 아니면 거절당한다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      await expect(
        saveSeedCell(
          {
            table_name: 'story_scenes',
            row_id: 씨.scene_id,
            column_name: 'remaining_worries',
            value: '새 걱정 문장',
            origin: 'draft',
            json_key: 'SOLUTION',
          },
          tx,
        ),
      ).rejects.toThrow('걱정 문장은 JSON 객체여야 한다')
    })
  })

  it('요구 요소는 화면 이름으로 쳐도 코드로 들어간다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      await saveSeedCell(
        {
          table_name: 'story_scenes',
          row_id: 씨.scene_id,
          column_name: 'required_elements',
          value: '공감, 까닭',
          origin: 'canon',
        },
        tx,
      )
      const [행] = await tx
        .select({ required_elements: story_scenes.required_elements })
        .from(story_scenes)
        .where(eq(story_scenes.id, 씨.scene_id))
      expect(행.required_elements).toEqual(['EMPATHY', 'REASON'])
    })
  })

  it('비울 수 없는 칸을 비우면 기계 말이 아니라 사람 말이 온다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      await expect(
        saveSeedCell(
          {
            table_name: 'characters',
            row_id: 씨.character_id,
            column_name: 'persona',
            value: '   ',
            origin: 'draft',
          },
          tx,
        ),
      ).rejects.toThrow('이 칸은 비워 둘 수 없습니다.')
    })
  })

  it('🔴 DB 가 CHECK 로 거절한 것도 사람 말로 온다 (500 이 아니다)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      // preferred_turns(2) > max_turns(4)... 를 뒤집는다 → `preferred_turns_not_over_max`
      await expect(
        saveSeedCell(
          {
            table_name: 'story_scenes',
            row_id: 씨.scene_id,
            column_name: 'preferred_turns',
            value: '9',
            origin: 'draft',
          },
          tx,
        ),
      ).rejects.toThrow('선호 턴은 최대 턴보다 클 수 없습니다.')
    })
  })
})

검사('작업대 화면 자료', () => {
  it('시드 파일 값·요소 이름·개정 이름이 함께 붙어 온다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      await updateSeedCell(tx, {
        table_name: 'story_scenes',
        row_id: 씨.scene_id,
        column_name: 'scene_stance',
        new_value: '고친 입장',
        origin: 'draft',
        changed_by: null,
      })

      const 자료 = await seedWorkbench(tx)
      expect(자료.file_read_error).toBeNull()
      expect(자료.file_differs).toBe(true)

      const 장면 = 자료.scenes.find((행) => 행.id === 씨.scene_id)!
      // 검사용 장면은 시드 파일에 없다 — 그래도 화면은 뜬다 (`값 없음` 이 뜬다).
      expect(장면.file_values).toBeNull()
      expect(장면.required_element_names).toEqual(['공감', '해결'])

      const 개정 = 자료.revisions.find((행) => 행.row_id === 씨.scene_id)!
      expect(개정.display_name).toBe('장면 2 · 이 장면에서의 입장')
    })
  })
})

검사('내보내기 SQL — ⭐ 이 왕복이 끊기면 콘텐츠 정본 관리가 죽는다', () => {
  it('캐릭터와 장면을 옮겨 붙일 UPDATE 로 낸다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      await updateSeedCell(tx, {
        table_name: 'characters',
        row_id: 씨.character_id,
        column_name: 'persona',
        new_value: "아이가 '응' 했다",
        origin: 'draft',
        changed_by: null,
      })

      const 본문 = await seedExportSql(tx)

      expect(본문.startsWith('-- 관리자 화면에서 내보낸 시드 작업값')).toBe(true)
      expect(본문).toContain('BEGIN;')
      expect(본문.trimEnd().endsWith('COMMIT;')).toBe(true)
      expect(본문).toContain('UPDATE story_characters c')
      expect(본문).toContain('UPDATE story_scenes sc')
      // 따옴표가 겹쳐 막혀 있어야 그대로 부을 수 있다.
      expect(본문).toContain("SET persona = '아이가 ''응'' 했다',")
      // 출처가 주석으로 남아 무엇이 검수 대상인지 SQL 에서도 보인다.
      expect(본문).toContain('검사용 며느리 출처: persona=초안')
      // 🔴 열쇠는 **슬러그**와 코드다. 파이썬은 제목으로 조인했는데 `title` 에는 UNIQUE 가
      //    없어, 제목을 고치면 이 SQL 이 0행을 갱신하고 조용히 성공했다 (2026-08-13 · 2-d 의 H).
      expect(본문).toContain(`AND s.slug = '${씨.story_slug}'`)
      expect(본문).not.toContain('AND s.title =')
      expect(본문).toContain("AND c.code = 'ch_seed_test';")
      expect(본문).toContain('AND sc.scene_order = 2;')
      // 걱정 문장은 열쇠를 정렬해 적는다 — 같은 값이면 같은 글자가 나온다.
      expect(본문).toContain('remaining_worries = \'{"EMPATHY"')
    })
  })

  // ⚠️ 「빈 칸이 오면 NULL 과 경고 주석」은 위 `빈_칸_경고` 검사가 잰다. DB 로는 못 만든다 —
  //    화면에 뜨는 장면은 전부 대화 장면이고, 대화 장면은 CHECK 가 빈 칸을 막는다.
})
