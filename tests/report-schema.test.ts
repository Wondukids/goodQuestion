// 보호자 리포트 표 2개 + 낱말 시드 (sql/006_parent_report.sql · 이슈 #35) — 「끝났다」의 조건을 잰다.
//
//   1. 같은 `session_id` 로 리포트를 두 번 넣으면 **행이 늘지 않고 덮어써진다** (R1 · R19)
//   2. `status` 가 두 값 밖이면 CHECK 가 튕긴다. `narrative` 는 비워도 들어간다 (R18)
//   3. 같은 `(child_id, word)` 는 UNIQUE 가 막는다 — 「새로 쓴 낱말」의 잣대가 이것이다 (R6)
//   4. 시드가 **대화 장면 넷 전부**에 `vocabulary` 를 넣고, 두 번 돌려도 늘지 않는다 (R20)
//
// 표 정의 자체(컬럼·타입·제약·FK)가 DB 와 맞는지는 `tests/schema.test.ts` 가 전수 대조하고,
// 저쪽 표를 선언에 넣지 않았는지는 `tests/push-guard.test.ts` 가 잰다. 여기서 재는 것은
// **행이 실제로 들어가고 막히는가**뿐이다 (`tests/missions.test.ts` 와 같은 결).
//
// 🔴 4번이 이 파일에서 제일 잘 새는 자리다. 아이가 말하는 곳은 대화 장면 넷뿐이라
//    거기가 비면 「질문한 낱말」이 영영 0으로 나오는데, **아무도 안 아프다** — 리포트는
//    그냥 0을 찍고 만다. 그래서 개수를 센다.
//
// ## 진짜 DB 를 쓰고, 끝나면 되돌린다
//
// `tests/missions.test.ts` 와 같은 방식이다 — 트랜잭션을 열고 끝나면 **무조건 롤백**한다.
// 시드 검사도 그 안에서 돌므로 몇 번을 돌려도 DB 에 행이 남지 않는다.
//
// ## DB 가 없으면 **건너뛴다** — 조용히 통과시키지 않는다

import { randomUUID } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'

import { child_words, parent_reports, stories, story_scenes } from '@/llm/db/schema'
import { seed } from '@/llm/db/seed'
import { closeDb, getDb, type Conn } from '@/llm/repo/db'
import { createSession } from '@/llm/repo/sessions'
import type { ReportMetrics } from '@/report/types'

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
    `\n[report-schema.test] Postgres 에 못 붙어 리포트 표 검사를 건너뛴다 (도커가 꺼져 있나?)\n` +
      `                    ${못붙는_이유}\n` +
      `                    되살리려면: 도커 gq-pg 를 켜고 DATABASE_URL 을 확인한다\n\n`,
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

// ── 검사용 씨앗 — 진짜 시드와 섞이지 않게 검사용 이야기 아래에 세운다 ──────

/** 리포트를 매달 세션 하나. `parent_reports.session_id` 가 FK 라 진짜 세션이 있어야 한다. */
async function 세션_씨앗(tx: Conn): Promise<{ session_id: string; child_id: string }> {
  const 꼬리 = randomUUID().slice(0, 8)
  const [이야기] = await tx
    .insert(stories)
    .values({
      slug: `s-rp-${꼬리}`,
      title: `리포트 검사 ${꼬리}`,
      summary: '리포트 표만 재는 이야기',
      difficulty: '보통',
      status: 'draft',
    })
    .returning({ id: stories.id })

  const child_id = randomUUID()
  const session_id = await createSession(tx, { story_id: 이야기.id, child_id })
  return { session_id, child_id }
}

/**
 * 지표 한 덩이. 모양의 정본은 `src/report/types.ts` 이고 값을 채우는 것은 #36 이다.
 * 여기서는 **jsonb 가 그대로 들고 나오는가**만 보므로 최소한으로 채운다.
 */
function 지표(문장수: number): ReportMetrics {
  return {
    activity: {
      story_slug: 'fart-bride',
      story_title: '방귀 뀌는 며느리',
      played_at: '2026-08-03T19:12:00+09:00',
      duration_minutes: 24,
      completed: true,
      prior_activities: 0,
    },
    counts: { child_utterances: 문장수, new_words: 0, asked_words: 0 },
    axes: {
      관점과공감: { score: 0, parts: {} },
      감정표현: { score: 0, parts: {} },
      생각과이유: { score: 0, parts: {} },
      결과와해결: { score: 0, parts: {} },
      상호작용: { score: 0, parts: {} },
    },
    words: { main: [], asked: [], repeated: [], new: [] },
    quotes: [],
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. parent_reports — 활동 하나에 리포트 하나 (R1)
// ═══════════════════════════════════════════════════════════════════════════

검사('parent_reports — 활동 하나에 리포트 하나 (R1 · R19)', () => {
  it('⭐ 같은 session_id 로 두 번 넣으면 행이 늘지 않고 덮어써진다 — 「다시 만들기」의 자리', async () => {
    await 트랜잭션(async (tx) => {
      const { session_id, child_id } = await 세션_씨앗(tx)

      await tx
        .insert(parent_reports)
        .values({ session_id, child_id, status: 'metrics_only', metrics: 지표(12) })

      // R19 의 「다시 만들기」가 하는 일 — 새 행이 아니라 같은 열쇠로 덮어쓴다.
      await tx
        .insert(parent_reports)
        .values({ session_id, child_id, status: 'complete', metrics: 지표(32) })
        .onConflictDoUpdate({
          target: parent_reports.session_id,
          set: { status: 'complete', metrics: 지표(32), regenerated: 1 },
        })

      const 행들 = await tx
        .select({
          status: parent_reports.status,
          metrics: parent_reports.metrics,
          regenerated: parent_reports.regenerated,
        })
        .from(parent_reports)
        .where(eq(parent_reports.session_id, session_id))

      expect(행들, '리포트가 두 장이 됐다').toHaveLength(1)
      expect(행들[0].status).toBe('complete')
      expect(행들[0].metrics.counts.child_utterances).toBe(32)
      expect(행들[0].regenerated).toBe(1)
    })
  })

  it('덮어쓸 생각 없이 두 번 넣으면 UNIQUE 가 막는다 — 조용히 두 장이 되지 않는다', async () => {
    await 트랜잭션(async (tx) => {
      const { session_id, child_id } = await 세션_씨앗(tx)
      const 한장 = { session_id, child_id, status: 'complete' as const, metrics: 지표(1) }

      await tx.insert(parent_reports).values(한장)

      // ⚠️ 유니크 위반은 트랜잭션을 죽인다 — 세이브포인트 안에서 부딪히고 거기서만 되돌린다.
      let 제약: string | null = null
      try {
        await tx.transaction(async (안) => {
          await 안.insert(parent_reports).values(한장)
        })
      } catch (오류) {
        제약 = 튕긴_제약(오류)
      }
      expect(제약).toBe('parent_reports_session_id_key')
    })
  })

  it('🔴 LLM 이 실패해도 숫자는 남는다 — narrative 가 NULL 인 metrics_only (R18)', async () => {
    await 트랜잭션(async (tx) => {
      const { session_id, child_id } = await 세션_씨앗(tx)

      await tx
        .insert(parent_reports)
        .values({ session_id, child_id, status: 'metrics_only', metrics: 지표(32) })

      const [행] = await tx
        .select({ narrative: parent_reports.narrative, regenerated: parent_reports.regenerated })
        .from(parent_reports)
        .where(eq(parent_reports.session_id, session_id))

      expect(행.narrative).toBeNull()
      expect(행.regenerated, '기본값이 0 이 아니면 재생성 한도가 처음부터 어긋난다').toBe(0)
    })
  })

  it('status 가 두 값 밖이면 CHECK 가 튕긴다', async () => {
    await 트랜잭션(async (tx) => {
      const { session_id, child_id } = await 세션_씨앗(tx)

      let 제약: string | null = null
      try {
        await tx.transaction(async (안) => {
          await 안
            .insert(parent_reports)
            // 타입은 두 값만 받으므로 DB 제약을 재려면 여기서 한 번 뚫는다.
            .values({ session_id, child_id, status: 'done' as never, metrics: 지표(1) })
        })
      } catch (오류) {
        제약 = 튕긴_제약(오류)
      }
      expect(제약).toBe('parent_reports_status_check')
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. child_words — 아이별 누적 낱말 (R6)
// ═══════════════════════════════════════════════════════════════════════════

검사('child_words — 같은 아이의 같은 낱말은 한 번뿐 (R6)', () => {
  it('⭐ 같은 (child_id, word) 를 두 번 넣으면 UNIQUE 가 막는다', async () => {
    await 트랜잭션(async (tx) => {
      const child_id = randomUUID()
      await tx.insert(child_words).values({ child_id, word: '부끄럽다' })

      let 제약: string | null = null
      try {
        await tx.transaction(async (안) => {
          await 안.insert(child_words).values({ child_id, word: '부끄럽다' })
        })
      } catch (오류) {
        제약 = 튕긴_제약(오류)
      }
      expect(제약).toBe('child_words_child_id_word_key')
    })
  })

  it('아이가 다르면 같은 낱말이 따로 쌓인다 — 누적은 아이별이다', async () => {
    await 트랜잭션(async (tx) => {
      const 아이1 = randomUUID()
      const 아이2 = randomUUID()
      await tx.insert(child_words).values([
        { child_id: 아이1, word: '당당하다', meaning: '부끄러워하지 않고 떳떳하다' },
        { child_id: 아이2, word: '당당하다' },
      ])

      const 아이1_낱말 = await tx
        .select({ word: child_words.word, meaning: child_words.meaning })
        .from(child_words)
        .where(eq(child_words.child_id, 아이1))

      expect(아이1_낱말).toEqual([{ word: '당당하다', meaning: '부끄러워하지 않고 떳떳하다' }])
      // 뜻은 장면 낱말 목록에 있을 때만 붙는다 — 없으면 NULL 이고 그것이 정상이다
      const [아이2_낱말] = await tx
        .select({ meaning: child_words.meaning })
        .from(child_words)
        .where(eq(child_words.child_id, 아이2))
      expect(아이2_낱말.meaning).toBeNull()
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. 시드 — 장면별 어려운 낱말 (R20)
// ═══════════════════════════════════════════════════════════════════════════

/** 「방귀 뀌는 며느리」의 장면을 (code, 대화 장면인가, 낱말 목록) 으로 돌려준다. */
async function 방귀_장면들(tx: Conn) {
  return tx
    .select({
      code: story_scenes.code,
      character_id: story_scenes.character_id,
      vocabulary: story_scenes.vocabulary,
    })
    .from(story_scenes)
    .innerJoin(stories, eq(story_scenes.story_id, stories.id))
    .where(eq(stories.slug, 'fart-bride'))
    .orderBy(story_scenes.scene_order)
}

/** 대화 장면 넷. `character_id` 가 있으면 대화 장면이다 (schema.ts story_scenes 절). */
const 대화_넷 = ['sc_banggui_03', 'sc_banggui_05', 'sc_banggui_07', 'sc_banggui_09']

/**
 * ⚠️ 아래 셋만 시각 제한을 늘려 둔다 (기본은 5초다).
 *
 * 느린 코드라서가 아니라 **자물쇠를 기다리기 때문**이다 — 시드는 「방귀 뀌는 며느리」의
 * `stories`·`story_scenes` **같은 행**을 upsert 하는데, 다른 검사 파일들이 같은 행을 물고
 * 자기 트랜잭션 안에서 돌고 있다. vitest 가 파일을 나란히 돌리므로 그 대기가 5초를 넘을 수
 * 있고, 그때 5초 제한은 「검사가 틀렸다」가 아니라 **「그날 DB 가 붐볐다」**를 빨갛게 만든다.
 * (`tests/missions.test.ts` 의 같은 모양 검사가 이미 그렇게 흔들린다.)
 */
const 시드_제한 = 30_000

검사('시드 — 장면별 어려운 낱말 (R20 · R15)', () => {
  it('🔴 대화 장면 넷 전부에 낱말이 한 개 이상 있다 — 여기가 비면 「질문한 낱말」이 영영 0이다', async () => {
    await 트랜잭션(async (tx) => {
      await seed(tx)
      const 장면들 = await 방귀_장면들(tx)

      const 대화장면 = 장면들.filter((장) => 장.character_id !== null)
      expect(대화장면.map((장) => 장.code)).toEqual(대화_넷)

      for (const 장 of 대화장면) {
        expect(장.vocabulary.length, `${장.code} 에 낱말이 없다`).toBeGreaterThanOrEqual(1)
      }
    })
  }, 시드_제한)

  it('낱말마다 뜻이 붙어 있다 — 뜻이 `child_words.meaning` 이 된다 (명세 4.3 3번)', async () => {
    await 트랜잭션(async (tx) => {
      await seed(tx)
      const 빈_뜻 = (await 방귀_장면들(tx)).flatMap((장) =>
        장.vocabulary
          .filter((낱) => 낱.word.trim() === '' || 낱.meaning.trim() === '')
          .map((낱) => `${장.code}: ${JSON.stringify(낱)}`),
      )
      expect(빈_뜻).toEqual([])
    })
  }, 시드_제한)

  it('⭐ 두 번 돌려도 낱말이 늘지 않는다 — (story_id, code) upsert', async () => {
    await 트랜잭션(async (tx) => {
      await seed(tx)
      const 첫 = await 방귀_장면들(tx)

      await seed(tx)
      const 둘 = await 방귀_장면들(tx)

      expect(둘).toHaveLength(첫.length)
      expect(둘.map((장) => [장.code, 장.vocabulary])).toEqual(
        첫.map((장) => [장.code, 장.vocabulary]),
      )
    })
  }, 시드_제한)
})
