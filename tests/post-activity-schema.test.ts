// 후활동 단어 표 + 이야기 config (sql/007_post_activity.sql · 이슈 #42) — 「끝났다」의 조건을 잰다.
//
//   1. `stories.post_activity_config` 를 읽으면 카드 넉 장·정답 순서·섞인 순서가 나온다 (F1)
//   2. 🔴 그 값이 **네 곳에서 글자까지 같다** — 007 · seed.ts · 화면 상수 · DB 행
//   3. 같은 `(result_id, card_id, word)` 를 두 번 넣으면 UNIQUE 가 막는다 (명세 4.3)
//   4. `status`·`decided_by` 가 정해진 값 밖이면 CHECK 가 튕긴다. `evidence` 는 비워도 들어간다
//   5. 결과 행을 지우면 단어 12행이 같이 사라진다 (ON DELETE CASCADE — 「다시 판정」의 자리)
//
// 표 정의 자체(컬럼·타입·제약·FK)가 DB 와 맞는지는 `tests/schema.test.ts` 가 전수 대조하고,
// 표가 `tablesFilter` 에 들었는지는 `tests/push-guard.test.ts` 가 잰다. 여기서 재는 것은
// **행이 실제로 들어가고 막히는가**뿐이다 (`tests/report-schema.test.ts` 와 같은 결).
//
// 🔴 2번이 이 파일에서 제일 잘 새는 자리다. #46 이 화면을 서버 값으로 갈아 끼울 때 카드
//    제목이나 단어가 한 글자라도 다르면 **아무도 안 아프다** — 화면은 그냥 다른 글자를 그리고,
//    판정은 아이가 말하지도 않은 단어를 찾는다. 그래서 네 곳을 한자리에서 견준다.
//
// ⛔ 미션 1·2 는 이 파일과 아무 관계가 없다 (명세 3절). 그쪽은 `tests/missions.test.ts` 다.
//
// ## 진짜 DB 를 쓰고, 끝나면 되돌린다
//
// `tests/report-schema.test.ts` 와 같은 방식이다 — 트랜잭션을 열고 끝나면 **무조건 롤백**한다.
// 몇 번을 돌려도 DB 에 행이 남지 않는다.
//
// ## DB 가 없으면 **건너뛴다** — 조용히 통과시키지 않는다
//
// 1·2 의 「DB 행」 부분과 3~5 는 DB 가 있어야 돌고, 2 의 「007 ↔ seed ↔ 화면 상수」는
// 파일끼리 견주는 것이라 DB 없이도 돈다.

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { eq, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'

import { post_activity_keywords, post_activity_results, stories } from '@/llm/db/schema'
import { 후활동_config } from '@/llm/db/seed'
import { closeDb, getDb, type Conn } from '@/llm/repo/db'
import { createSession } from '@/llm/repo/sessions'
import { SCENES, TRAY_ORDER } from '@/stories/fart-bride/minigame/finale-script'

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
    `\n[post-activity-schema.test] Postgres 에 못 붙어 후활동 표 검사를 건너뛴다 (도커가 꺼져 있나?)\n` +
      `                           ${못붙는_이유}\n` +
      `                           되살리려면: 도커 gq-pg 를 켜고 DATABASE_URL 을 확인한다\n\n`,
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

// ── 검사용 씨앗 — 진짜 콘텐츠와 섞이지 않게 검사용 이야기 아래에 세운다 ──────

/** 단어를 매달 결과 행 하나. `result_id` 가 FK 라 진짜 결과 행이 있어야 한다. */
async function 결과_씨앗(tx: Conn): Promise<string> {
  const 꼬리 = randomUUID().slice(0, 8)
  const [이야기] = await tx
    .insert(stories)
    .values({
      slug: `s-pa-${꼬리}`,
      title: `후활동 검사 ${꼬리}`,
      summary: '후활동 표만 재는 이야기',
      difficulty: '보통',
      status: 'draft',
    })
    .returning({ id: stories.id })

  const session_id = await createSession(tx, { story_id: 이야기.id, child_id: randomUUID() })
  const [결과] = await tx
    .insert(post_activity_results)
    .values({ session_id })
    .returning({ id: post_activity_results.id })
  return 결과.id
}

/** 카드 하나에 셋씩, 판정된 단어 12행. `missing` 도 행으로 남는다 (명세 4.3). */
function 단어_12행(result_id: string) {
  return 후활동_config.cards.flatMap((카드) =>
    카드.keywords.map((word) => ({
      result_id,
      card_id: 카드.id,
      word,
      status: 'missing',
      decided_by: 'rule',
    })),
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 1·2. stories.post_activity_config — 네 곳이 글자까지 같다 (F1 · 명세 4.1)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * sql/007 의 `UPDATE … SET post_activity_config = '…'::jsonb` 안에 적힌 값.
 *
 * ⚠️ 값에 홑따옴표가 들어가면(SQL 에서는 `''`) 여기서 글이 잘려 `JSON.parse` 가 터진다.
 *    조용히 지나가는 것이 아니라 **빨개지므로** 그때 이 함수를 고치면 된다.
 */
function sql파일의_config(): unknown {
  const 레포루트 = join(dirname(fileURLToPath(import.meta.url)), '..')
  const 글 = readFileSync(join(레포루트, 'sql', '007_post_activity.sql'), 'utf-8')
  const 맞은것 = /SET\s+post_activity_config\s*=\s*'([\s\S]*?)'::jsonb/i.exec(글)
  if (맞은것 === null) {
    throw new Error('sql/007_post_activity.sql 에서 post_activity_config 를 못 찾았다')
  }
  return JSON.parse(맞은것[1])
}

/** 화면 상수(`finale-script.ts`)를 config 모양으로 옮긴 것. 그림·칩 색은 넣지 않는다 (명세 4.1). */
function 화면상수의_config() {
  return {
    cards: SCENES.map((장) => ({ id: 장.id, title: 장.title, keywords: 장.keywords })),
    answer_order: SCENES.map((장) => 장.id),
    tray_order: TRAY_ORDER,
  }
}

describe('post_activity_config — 값이 네 곳에서 같다 (F1)', () => {
  it('🔴 sql/007 과 seed.ts 가 같은 값이다 — 갈리면 어느 쪽이 들어갔는지 아무도 모른다', () => {
    expect(sql파일의_config()).toEqual(후활동_config)
  })

  it('🔴 화면 상수(finale-script.ts)와도 같다 — #46 이 화면을 서버 값으로 갈아 끼울 자리다', () => {
    expect(후활동_config).toEqual(화면상수의_config())
  })

  it('카드 넉 장 · 카드마다 단어 셋 · 섞인 순서는 정답과 다르다', () => {
    expect(후활동_config.cards).toHaveLength(4)
    for (const 카드 of 후활동_config.cards) {
      expect(카드.keywords, `${카드.id} 의 단어`).toHaveLength(3)
    }
    // `cards` 의 차례가 곧 정답이지만, 읽는 쪽이 헷갈리지 않게 따로 적은 값이라 짝이 맞아야 한다
    expect(후활동_config.answer_order).toEqual(후활동_config.cards.map((카드) => 카드.id))
    // 트레이가 정답 순서로 깔리면 아이가 아무것도 안 하고 맞춘다
    expect(후활동_config.tray_order).not.toEqual(후활동_config.answer_order)
    expect([...후활동_config.tray_order].sort()).toEqual([...후활동_config.answer_order].sort())
  })
})

검사('post_activity_config — DB 에서 읽힌다 (수용 기준 2)', () => {
  it('⭐ fart-bride 행을 읽으면 카드 넉 장·정답 순서·섞인 순서가 나온다', async () => {
    const [행] = await getDb()
      .select({ config: stories.post_activity_config })
      .from(stories)
      .where(eq(stories.slug, 'fart-bride'))

    // 🔴 여기가 빨개지면 그 DB 에 `sql/007_post_activity.sql` 을 안 먹인 것이다
    expect(행?.config, 'fart-bride 행에 post_activity_config 가 없다 — 007 을 먹였나?').toEqual(
      후활동_config,
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3~5. post_activity_keywords — 단어 하나가 한 행 (F3 · 명세 4.3)
// ═══════════════════════════════════════════════════════════════════════════

검사('post_activity_keywords — 판정한 단어는 12개 전부 행이 된다 (F3)', () => {
  it('⭐ 12행이 그대로 들어간다 — `missing` 도 행으로 남는다 (없는 것을 세려면 행이 있어야 한다)', async () => {
    await 트랜잭션(async (tx) => {
      const result_id = await 결과_씨앗(tx)
      await tx.insert(post_activity_keywords).values(단어_12행(result_id))

      const 행들 = await tx
        .select({ card_id: post_activity_keywords.card_id, word: post_activity_keywords.word })
        .from(post_activity_keywords)
        .where(eq(post_activity_keywords.result_id, result_id))

      expect(행들).toHaveLength(12)
      // 안 쓴 단어에는 인용할 아이 말이 없다 — `evidence` 가 NULL 인 것이 정상이다 (명세 6절 ③)
      const [하나] = await tx
        .select({ evidence: post_activity_keywords.evidence })
        .from(post_activity_keywords)
        .where(eq(post_activity_keywords.result_id, result_id))
        .limit(1)
      expect(하나.evidence).toBeNull()
    })
  })

  it('⭐ 같은 (result_id, card_id, word) 를 두 번 넣으면 UNIQUE 가 막는다 (수용 기준 3)', async () => {
    await 트랜잭션(async (tx) => {
      const result_id = await 결과_씨앗(tx)
      const 한줄 = {
        result_id,
        card_id: 'endure',
        word: '시집',
        status: 'used',
        evidence: '시집와서',
        decided_by: 'rule',
      }
      await tx.insert(post_activity_keywords).values(한줄)

      // ⚠️ 유니크 위반은 트랜잭션을 죽인다 — 세이브포인트 안에서 부딪히고 거기서만 되돌린다.
      let 제약: string | null = null
      try {
        await tx.transaction(async (안) => {
          await 안.insert(post_activity_keywords).values(한줄)
        })
      } catch (오류) {
        제약 = 튕긴_제약(오류)
      }
      expect(제약).toBe('post_activity_keywords_result_id_card_id_word_key')
    })
  })

  it('카드가 다르면 같은 단어가 따로 들어간다 — 열쇠는 (결과, 카드, 단어) 셋이다', async () => {
    await 트랜잭션(async (tx) => {
      const result_id = await 결과_씨앗(tx)
      await tx.insert(post_activity_keywords).values([
        { result_id, card_id: 'endure', word: '방귀', status: 'missing', decided_by: 'rule' },
        { result_id, card_id: 'burst', word: '방귀', status: 'used', decided_by: 'rule' },
      ])

      const 행들 = await tx
        .select({ card_id: post_activity_keywords.card_id })
        .from(post_activity_keywords)
        .where(eq(post_activity_keywords.result_id, result_id))
      expect(행들).toHaveLength(2)
    })
  })

  it('status 가 세 값 밖이면 CHECK 가 튕긴다', async () => {
    await 트랜잭션(async (tx) => {
      const result_id = await 결과_씨앗(tx)

      let 제약: string | null = null
      try {
        await tx.transaction(async (안) => {
          await 안.insert(post_activity_keywords).values({
            result_id,
            card_id: 'endure',
            word: '시집',
            // 「비슷한 말」을 뜻으로 적어 넣는 실수를 DB 가 막는가
            status: 'partial',
            decided_by: 'llm',
          })
        })
      } catch (오류) {
        제약 = 튕긴_제약(오류)
      }
      expect(제약).toBe('post_activity_keywords_status_check')
    })
  })

  it('decided_by 가 두 값 밖이면 CHECK 가 튕긴다 — 어느 단이 판정했는지가 흐려지지 않게', async () => {
    await 트랜잭션(async (tx) => {
      const result_id = await 결과_씨앗(tx)

      let 제약: string | null = null
      try {
        await tx.transaction(async (안) => {
          await 안.insert(post_activity_keywords).values({
            result_id,
            card_id: 'endure',
            word: '시집',
            status: 'used',
            decided_by: 'human',
          })
        })
      } catch (오류) {
        제약 = 튕긴_제약(오류)
      }
      expect(제약).toBe('post_activity_keywords_decided_by_check')
    })
  })

  it('🔴 결과 행을 지우면 단어 12행이 같이 사라진다 — 「다시 판정」이 여기에 선다 (명세 4.3)', async () => {
    await 트랜잭션(async (tx) => {
      const result_id = await 결과_씨앗(tx)
      await tx.insert(post_activity_keywords).values(단어_12행(result_id))

      await tx.delete(post_activity_results).where(eq(post_activity_results.id, result_id))

      const 남은 = await tx
        .select({ id: post_activity_keywords.id })
        .from(post_activity_keywords)
        .where(eq(post_activity_keywords.result_id, result_id))
      expect(남은, 'CASCADE 가 없으면 다시 판정할 때 옛 단어가 남는다').toHaveLength(0)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// post_activity_results 의 새 칸 둘 (명세 4.2)
// ═══════════════════════════════════════════════════════════════════════════

검사('post_activity_results — 판정 자취 두 칸 (명세 4.2)', () => {
  it('🔴 판정 전에는 analyzed_at 이 NULL 이다 — 「판정을 못 했다」와 「단어를 하나도 안 썼다」가 갈린다', async () => {
    await 트랜잭션(async (tx) => {
      const result_id = await 결과_씨앗(tx)

      const [갓생긴] = await tx
        .select({
          analyzed_at: post_activity_results.analyzed_at,
          analysis_version: post_activity_results.analysis_version,
          attempt_count: post_activity_results.attempt_count,
        })
        .from(post_activity_results)
        .where(eq(post_activity_results.id, result_id))

      expect(갓생긴.analyzed_at).toBeNull()
      expect(갓생긴.analysis_version).toBeNull()
      expect(갓생긴.attempt_count, '제출 횟수의 기본값이 0 이 아니면 세는 자리가 어긋난다').toBe(0)

      // 단어를 하나도 안 쓴 쪽 — 12행이 전부 `missing` 인데 `analyzed_at` 은 **차 있다**
      await tx.insert(post_activity_keywords).values(단어_12행(result_id))
      await tx
        .update(post_activity_results)
        .set({ analyzed_at: new Date(), analysis_version: 'retelling_v1' })
        .where(eq(post_activity_results.id, result_id))

      const [판정뒤] = await tx
        .select({
          analyzed_at: post_activity_results.analyzed_at,
          analysis_version: post_activity_results.analysis_version,
        })
        .from(post_activity_results)
        .where(eq(post_activity_results.id, result_id))

      expect(판정뒤.analyzed_at).not.toBeNull()
      expect(판정뒤.analysis_version).toBe('retelling_v1')
    })
  })
})
