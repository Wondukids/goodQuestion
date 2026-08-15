// 말하기 후 활동 표 둘 — `post_activity_results` · `post_activity_keywords` (이슈 #45).
//
// 표는 이슈 #42 가 세웠고(`sql/007_post_activity.sql`), 여기는 **넣고 읽는 SQL 만** 산다.
// 정본은 `docs/말하기후활동_명세.md` 4.2·4.3 이다.
//
// ## 왜 `src/post-activity/` 가 아니라 여기인가
//
// 그 도메인에는 **repo 층이 없다** (`src/post-activity/README.md`) — 판정 엔진은 넣을 값을
// 돌려줄 뿐이다. 그리고 이 표 둘은 엔진 스키마(`src/llm/db/schema.ts`)에 서 있고,
// 세션 도메인은 repo 를 직접 못 문다 (`src/session/README.md` — eslint 가 막는다).
// 그래서 SQL 은 여기, 세션 도메인이 여는 문은 `src/llm/service/post-activity.ts` 다.
//
// ## 🔴 「덮지 않는다」가 SQL 안에 있다
//
// 순서 제출은 **누를 때마다** 온다. `submitted_order`(첫 제출) · `is_order_correct`(끝내
// 맞췄나) · `attempt_count`(누른 횟수) 셋이 회차마다 서로 다르게 움직이는데,
// 읽고-판단하고-쓰면 두 번 눌린 사이에 값이 어긋난다. 그래서 upsert 한 문장에 담았다 —
// `coalesce` 가 「첫 것을 지킨다」를, `or` 가 「한 번 참이면 계속 참」을 맡는다 (F7·F18).

import { eq, sql } from 'drizzle-orm'

import { post_activity_keywords, post_activity_results, stories, story_sessions } from '@/llm/db/schema'
import type { 단어판정 } from '@/post-activity/types'

import type { Conn } from './db'

/** `post_activity_results` 한 행. 칸 이름은 DB 컬럼 그대로다. */
export type PostActivityResultRow = typeof post_activity_results.$inferSelect

/**
 * 후활동을 열기 전에 봐야 하는 것 전부 — 세션 상태와 그 이야기의 설정·제목·요지.
 *
 * ⛔ 여기서 문지기를 세우지 않는다. `status` 로 409 를, `config` 로 404 를 가르는 것은
 *    부르는 쪽(`src/session/service/post-activity.ts`)이다. repo 는 값만 올린다.
 */
export interface 후활동세션 {
  session_id: string
  /** `'in_progress' | 'post_activity' | 'completed' | 'stopped'` */
  status: string
  /** 판정 LLM 에 「무슨 이야기인가」로 실린다 (`후활동이야기`) */
  story: { title: string; summary: string }
  /** `stories.post_activity_config` 를 **읽은 그대로**. 없으면 `null` (그 이야기엔 후활동이 없다) */
  config: unknown
}

// ---------------------------------------------------------------------------
// 읽기
// ---------------------------------------------------------------------------

/**
 * 세션 하나와 그 이야기의 후활동 설정. 세션이 없으면 `null`.
 *
 * ⚠️ `story_id` 는 NOT NULL + 외래키라 `innerJoin` 이 행을 떨어뜨리지 않는다
 *    (`readSessionIdentity()` 와 같은 자리).
 */
export async function readPostActivitySession(
  conn: Conn,
  session_id: string,
): Promise<후활동세션 | null> {
  const 행들 = await conn
    .select({
      session_id: story_sessions.id,
      status: story_sessions.status,
      title: stories.title,
      summary: stories.summary,
      config: stories.post_activity_config,
    })
    .from(story_sessions)
    .innerJoin(stories, eq(stories.id, story_sessions.story_id))
    .where(eq(story_sessions.id, session_id))
    .limit(1)
  if (행들.length === 0) return null
  const 행 = 행들[0]
  return {
    session_id: 행.session_id,
    status: 행.status,
    story: { title: 행.title, summary: 행.summary },
    config: 행.config ?? null,
  }
}

/** 이 세션의 후활동 결과 한 행. 아직 아무것도 안 했으면 `null` (F8 — 순서 단계가 첫 저장이다). */
export async function readPostActivityResult(
  conn: Conn,
  session_id: string,
): Promise<PostActivityResultRow | null> {
  const 행들 = await conn
    .select()
    .from(post_activity_results)
    .where(eq(post_activity_results.session_id, session_id))
    .limit(1)
  return 행들.length === 0 ? null : 행들[0]
}

// ---------------------------------------------------------------------------
// 쓰기
// ---------------------------------------------------------------------------

/**
 * 순서 제출 한 번 (명세 5.B). **행이 없으면 여기서 만든다** (F8).
 *
 * 한 문장이 셋을 동시에 지킨다 (이 파일 머리말):
 * - `submitted_order` — `coalesce` 로 **첫 제출만** 남는다. 두 번째부터는 안 덮는다 (F7)
 * - `is_order_correct` — `or` 라 한 번 참이면 계속 참이다. 「끝내 맞췄나」다 (F18)
 * - `attempt_count` — 누를 때마다 하나씩 오른다 (통과한 회차 포함)
 *
 * ⚠️ `coalesce(…, false) or excluded…` 는 첫 제출이 틀렸을 때 NULL 이 아니라 `false` 를
 *    남긴다 — 「아직 안 냈다」(NULL)와 「내 봤는데 못 맞췄다」(false)가 갈려야 한다.
 */
export async function submitPostActivityOrder(
  conn: Conn,
  { session_id, submitted_order, is_correct }: {
    session_id: string
    submitted_order: readonly string[]
    is_correct: boolean
  },
): Promise<PostActivityResultRow> {
  const 행들 = await conn
    .insert(post_activity_results)
    .values({
      session_id,
      submitted_order: [...submitted_order],
      is_order_correct: is_correct,
      attempt_count: 1,
    })
    .onConflictDoUpdate({
      target: post_activity_results.session_id,
      set: {
        submitted_order: sql`coalesce(${post_activity_results.submitted_order}, excluded.submitted_order)`,
        is_order_correct: sql`coalesce(${post_activity_results.is_order_correct}, false) or excluded.is_order_correct`,
        attempt_count: sql`${post_activity_results.attempt_count} + 1`,
      },
    })
    .returning()
  return 행들[0]
}

/**
 * 받아쓴 줄거리를 저장한다 — **판정보다 먼저다** (명세 5.C · F4·F8).
 *
 * 🔴 같은 자리에서 `analyzed_at`·`analysis_version` 을 **NULL 로 되돌린다.** 다시 말한
 * 줄거리에 지난 판정이 붙어 있으면 「이 글을 판정한 결과」가 거짓이 된다. 단어 행도
 * 부르는 쪽이 이어서 지운다 (명세 4.3 — 다시 판정하면 모두 지우고 다시 넣는다).
 *
 * 판정이 그 뒤에 실패하면 이 상태 그대로 남는다 — `analyzed_at` NULL 이 곧
 * 「판정을 못 했다」다 (명세 4.2). 「단어를 하나도 안 썼다」와 갈리는 자리가 여기다.
 */
export async function saveRetellingText(
  conn: Conn,
  { session_id, text }: { session_id: string; text: string },
): Promise<PostActivityResultRow> {
  const 행들 = await conn
    .insert(post_activity_results)
    .values({ session_id, retelling_text: text })
    .onConflictDoUpdate({
      target: post_activity_results.session_id,
      set: { retelling_text: text, analyzed_at: null, analysis_version: null },
    })
    .returning()
  return 행들[0]
}

/** 이 결과에 달린 단어 행을 **전부** 지운다 (명세 4.3 — 다시 판정하면 지우고 다시 넣는다). */
export async function clearPostActivityKeywords(conn: Conn, result_id: string): Promise<void> {
  await conn.delete(post_activity_keywords).where(eq(post_activity_keywords.result_id, result_id))
}

/**
 * 판정 결과를 얹는다 — 단어 12행 + `analyzed_at`·`analysis_version`.
 *
 * 🔴 **12개 전부 넣는다.** `missing` 도 행으로 남아야 「이 아이가 뭘 놓쳤나」를 셀 수 있다
 * (명세 4.3). 반만 넣지 않는 것은 판정 엔진 쪽 약속이고(`words` 가 `null` 이면 아예 안
 * 부른다), 여기서는 받은 것을 그대로 넣는다.
 */
export async function saveKeywordJudgement(
  conn: Conn,
  { result_id, words, version }: {
    result_id: string
    words: readonly 단어판정[]
    version: string
  },
): Promise<void> {
  if (words.length > 0) {
    await conn.insert(post_activity_keywords).values(
      words.map((것) => ({
        result_id,
        card_id: 것.card_id,
        word: 것.word,
        status: 것.status,
        evidence: 것.evidence,
        decided_by: 것.decided_by,
      })),
    )
  }
  await conn
    .update(post_activity_results)
    .set({ analyzed_at: sql`now()`, analysis_version: version })
    .where(eq(post_activity_results.id, result_id))
}

/**
 * 「마치기」를 눌렀다 — `completed_at` 을 채운다 (명세 5.D `reason: 'finished'`).
 *
 * ⭐ **반복 호출이 안전해야 한다** — 아이가 마치고 끝 화면을 떠나면 이 API 가 두 번 불린다.
 * `coalesce` 라 **처음 누른 시각이 그대로** 남는다 (`markReportRead()` 와 같은 결).
 *
 * ⛔ `reason: 'left'` 는 이 함수를 **안 부른다.** 그쪽은 아무것도 쓰지 않는다 —
 *    활동을 안 하고 떠난 아이에게 빈 결과 행을 세우면 리포트가 「후활동을 했다」로 읽는다
 *    (수용 기준 12 — 그때 `metrics.post_activity` 는 `null` 이어야 한다).
 */
export async function markPostActivityCompleted(conn: Conn, session_id: string): Promise<void> {
  await conn
    .insert(post_activity_results)
    .values({ session_id, completed_at: sql`now()` })
    .onConflictDoUpdate({
      target: post_activity_results.session_id,
      set: {
        completed_at: sql`coalesce(${post_activity_results.completed_at}, excluded.completed_at)`,
      },
    })
}
