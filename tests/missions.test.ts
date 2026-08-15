// 미션 표 3개 (sql/005_missions.sql · 이슈 #17) — 「끝났다」의 세 조건을 잰다.
//
//   1. 시드가 반복 안전하다 — upsert 두 번 = 행 수 불변 (code 기준)
//   2. 같은 (session, mission) 의 in_progress 시도 2개는 `ux_mission_sessions_active` 가 막는다
//   3. `purpose='mission_summary'` 인 `llm_calls` 행이 들어간다 (005 의 CHECK 확장)
//
// 표 정의 자체(컬럼·제약·FK)가 DB 와 맞는지는 tests/schema.test.ts 가 전수 대조한다 —
// 여기서는 **행이 실제로 들어가고 막히는가**만 잰다 (같은 파일 「나쁜 행이 정말 튕기나」와 같은 결).
//
// ## 진짜 DB 를 쓰고, 끝나면 되돌린다
//
// tests/repo.test.ts 와 같은 방식이다 — 트랜잭션을 열고 검사가 끝나면 **무조건 롤백**한다.
// 시드 검사도 그 안에서 돌므로 몇 번을 돌려도 DB 에 행이 남지 않는다.
//
// ## DB 가 없으면 **건너뛴다** — 조용히 통과시키지 않는다

import { randomUUID } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'

import { mission_sessions, stories, story_missions, story_scenes } from '@/llm/db/schema'
import { seed } from '@/llm/db/seed'
import type { Attempt } from '@/llm/provider'
import { closeDb, getDb, type Conn } from '@/llm/repo/db'
import { createRun, insertAttempts } from '@/llm/repo/runs'
import { createSession } from '@/llm/repo/sessions'

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
    `\n[missions.test] Postgres 에 못 붙어 미션 표 검사를 건너뛴다 (도커가 꺼져 있나?)\n` +
      `               ${못붙는_이유}\n` +
      `               되살리려면: 도커 gq-pg 를 켜고 DATABASE_URL 을 확인한다\n\n`,
  )
}
const 검사 = 못붙는_이유 === null ? describe : describe.skip

afterAll(async () => {
  await closeDb()
})

// ── 트랜잭션을 열고 끝나면 되돌린다 ────────────────────────────────────────

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

// ── 검사용 미션 씨앗 — 진짜 시드와 섞이지 않게 검사용 이야기 아래에 세운다 ──

async function 미션_씨앗(tx: Conn): Promise<{ session_id: string; mission_id: string }> {
  const 꼬리 = randomUUID().slice(0, 8)
  const [이야기] = await tx
    .insert(stories)
    .values({
      slug: `s-ms-${꼬리}`,
      title: `미션 검사 ${꼬리}`,
      summary: '미션 표만 재는 이야기',
      difficulty: '보통',
      status: 'draft',
    })
    .returning({ id: stories.id })
  // 미션이 매달릴 씬 하나면 된다 — 대화 재료까지는 필요 없다 (FK 는 story_scenes.id 만 본다).
  const [장면] = await tx
    .insert(story_scenes)
    .values({
      story_id: 이야기.id,
      code: `sc_ms_${꼬리}`,
      scene_order: 1,
      scene_description: '미션 검사용 전개',
    })
    .returning({ id: story_scenes.id })
  const [미션] = await tx
    .insert(story_missions)
    .values({
      story_id: 이야기.id,
      scene_id: 장면.id,
      code: `ms_test_${꼬리}`,
      title: '검사용 미션',
      mission_type: 'prop_choice',
      mission_goal: '검사용 미션 목적 한 문장',
      config: { trigger: { any_elements: ['SOLUTION'], min_turns: 2 } },
    })
    .returning({ id: story_missions.id })
  const session_id = await createSession(tx, { story_id: 이야기.id, child_id: randomUUID() })
  return { session_id, mission_id: 미션.id }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. 시드 — story_missions 2행 upsert
// ═══════════════════════════════════════════════════════════════════════════

/** 「방귀 뀌는 며느리」에 달린 미션 행들. (미션 code, 씬 code, config) 로 돌려준다. */
async function 방귀_미션들(tx: Conn) {
  return tx
    .select({
      code: story_missions.code,
      scene_code: story_scenes.code,
      mission_type: story_missions.mission_type,
      mission_goal: story_missions.mission_goal,
      config: story_missions.config,
    })
    .from(story_missions)
    .innerJoin(stories, eq(story_missions.story_id, stories.id))
    .innerJoin(story_scenes, eq(story_missions.scene_id, story_scenes.id))
    .where(eq(stories.slug, 'fart-bride'))
    .orderBy(story_missions.code)
}

검사('시드 — story_missions 2행 (이슈 #17)', () => {
  it('⭐ 두 번 돌려도 행 수가 그대로다 — (story_id, code) upsert', async () => {
    await 트랜잭션(async (tx) => {
      const 첫 = await seed(tx)
      expect(첫.story_missions).toBe(2)
      const 첫_행들 = await 방귀_미션들(tx)
      expect(첫_행들).toHaveLength(2)

      await seed(tx)
      expect(await 방귀_미션들(tx)).toHaveLength(2)
    })
  })

  it('씬은 code 로 이어진다 — pear→07 · friend→09, 씬당 1개', async () => {
    await 트랜잭션(async (tx) => {
      await seed(tx)
      const 행들 = await 방귀_미션들(tx)
      expect(행들.map((행) => [행.code, 행.scene_code, 행.mission_type])).toEqual([
        ['ms_banggui_friend', 'sc_banggui_09', 'card_help'],
        ['ms_banggui_pear', 'sc_banggui_07', 'prop_choice'],
      ])
    })
  })

  it('config 가 명세 6절의 모양이다 — 열쇠가 늘거나 줄면 #18·#20 이 어긋난다', async () => {
    await 트랜잭션(async (tx) => {
      await seed(tx)
      const [친구, 배따기] = await 방귀_미션들(tx)

      const 배 = 배따기.config as Record<string, unknown>
      expect(Object.keys(배).sort()).toEqual(['closing', 'items', 'reask', 'steps', 'trigger'])
      expect(배.trigger).toEqual({ any_elements: ['SOLUTION'], min_turns: 2 })
      expect((배.items as unknown[]).length).toBe(3)
      expect((배.steps as { key: string }[]).map((스텝) => 스텝.key)).toEqual(['use', 'request'])

      const 친 = 친구.config as Record<string, unknown>
      expect(Object.keys(친).sort()).toEqual([
        'ask',
        'cards',
        'closing',
        'intro',
        'more',
        'more_pick',
        'trigger',
      ])
      expect(친.trigger).toEqual({ any_elements: ['PERSPECTIVE'], min_turns: 2 })
      const 카드들 = 친.cards as Record<string, string>[]
      // 넷째는 녹음 사정으로 힘이 센 친구 대신 장난을 많이 치는 친구다 (프론트 대본과 동일)
      expect(카드들.map((카) => 카.id)).toEqual(['scared', 'loud', 'talkative', 'playful'])
      for (const 카 of 카드들) {
        expect(Object.keys(카).sort()).toEqual(['id', 'name', 'reask', 'trouble'])
      }
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. mission_sessions — in_progress 는 세션당 1개
// ═══════════════════════════════════════════════════════════════════════════

검사('mission_sessions — 같은 (session, mission) 의 진행 중 시도는 1개뿐이다', () => {
  it('⭐ 두 번째 in_progress 는 ux_mission_sessions_active 가 막는다', async () => {
    await 트랜잭션(async (tx) => {
      const { session_id, mission_id } = await 미션_씨앗(tx)
      await tx.insert(mission_sessions).values({ session_id, mission_id })

      const 오류 = await tx
        .insert(mission_sessions)
        .values({ session_id, mission_id })
        .then(
          () => null,
          (e: unknown) => e,
        )
      expect(튕긴_제약(오류)).toBe('ux_mission_sessions_active')
    })
  })

  it('앞 시도가 abandoned 면 새 in_progress 가 들어간다 — 부분 인덱스라 기록은 남는다 (M4)', async () => {
    await 트랜잭션(async (tx) => {
      const { session_id, mission_id } = await 미션_씨앗(tx)
      const [첫시도] = await tx
        .insert(mission_sessions)
        .values({ session_id, mission_id })
        .returning({ id: mission_sessions.id })

      // 이탈 → abandoned. 복귀는 새 행으로 처음부터다 (재개 없음).
      await tx
        .update(mission_sessions)
        .set({ status: 'abandoned' })
        .where(eq(mission_sessions.id, 첫시도.id))
      await tx.insert(mission_sessions).values({ session_id, mission_id })

      const 행들 = await tx
        .select({ status: mission_sessions.status })
        .from(mission_sessions)
        .where(eq(mission_sessions.session_id, session_id))
      expect(행들.map((행) => 행.status).sort()).toEqual(['abandoned', 'in_progress'])
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. llm_calls — 미션 purpose 확장 (005 의 CHECK)
// ═══════════════════════════════════════════════════════════════════════════

/** repo.test.ts 의 시도() 와 같은 꼴 — 미션 용도만 갈아 끼운다. */
function 시도(고칠_것: Partial<Attempt> = {}): Attempt {
  return {
    purpose: 'mission_summary',
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    effort: 'low',
    system_text: '시스템',
    user_text: '사용자',
    response_text: '네 덕분에 정했어!',
    input_tokens: 100,
    output_tokens: 20,
    duration_ms: 1234,
    ok: true,
    error: null,
    ...고칠_것,
  }
}

검사('gq_admin.llm_calls — 미션 호출 둘이 기록에 남는다', () => {
  it("⭐ purpose='mission_summary'·'mission_reply' 행이 들어간다", async () => {
    await 트랜잭션(async (tx) => {
      const { session_id } = await 미션_씨앗(tx)
      const 회차 = await createRun(tx, {
        session_id,
        scope: 'story',
        scene_order: null,
        started_by: '검사',
        analysis_model: 'gemini-3.5-flash-lite',
        analysis_effort: 'low',
        character_model: 'gemini-3.5-flash-lite',
        character_effort: 'low',
        default_utterance_source: 'synthetic_adult',
        prompt_version: 'mvp_v1',
      })

      const 넣음 = await insertAttempts(tx, {
        run_id: 회차.id,
        message_id: null,
        attempts: [시도(), 시도({ purpose: 'mission_reply', response_text: '보자기라니 좋은 생각이구려!' })],
      })

      expect(넣음.map((행) => [행.purpose, 행.attempt_no])).toEqual([
        ['mission_summary', 1],
        ['mission_reply', 1],
      ])
    })
  })
})
