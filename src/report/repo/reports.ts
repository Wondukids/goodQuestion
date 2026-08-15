// 리포트 두 표를 읽고 쓴다 — `parent_reports` · `child_words` (명세 6.1·6.2).
//
// ## 이 파일이 지키는 것 둘
//
// 1. **활동 하나에 리포트 하나** (결정 R1). 저장은 언제나 `session_id` 로 덮어쓰는 upsert 다 —
//    활동을 두 번 끝내도 행이 늘지 않는다.
// 2. **`regenerated` 는 시키는 자리에서만 는다.** 자동 생성이 다시 돌아도 남용 한도가
//    닳으면 안 되기 때문이다 (명세 7절 · R19). 그래서 인자로 받는다.
//
// ⛔ 낱말을 언제 넣는지(리포트 저장이 성공한 **뒤에**)는 여기 규칙이 아니라 순서이고,
//    그 순서는 service 층이 안다 (`src/report/README.md` 생성 흐름 ⑤).

import { and, desc, eq, isNull, sql } from 'drizzle-orm'

import { child_words, parent_reports, stories, story_sessions } from '@/llm/db/schema'
import type { Conn } from '@/llm/repo/db'
import type { ReportListItem, ReportMetrics, ReportNarrative, ReportStatus } from '@/report/types'

/** `parent_reports` 한 행. 칸 이름은 DB 컬럼 그대로다. */
export type ReportRow = typeof parent_reports.$inferSelect

/** 저장할 것 한 벌 (`generated_at` 은 DB 가 찍는다). */
export interface 저장할_리포트 {
  session_id: string
  child_id: string
  status: ReportStatus
  metrics: ReportMetrics
  /** LLM 이 둘 다 실패했으면 `null` — 그때가 `status='metrics_only'` 다 (R18) */
  narrative: ReportNarrative | null
  /** 실제로 답한 모델. 안 불렸으면 `null` */
  model: string | null
  /** `{"report_analysis": "sha256…", "report_guide": "…"}` (명세 6.1) */
  prompt_digest: Record<string, string> | null
  /** `true` 면 `regenerated` 를 1 올린다. 자동 생성은 안 올린다 (R19) */
  bump_regenerated: boolean
}

/** 리포트 한 행. 없으면 `null`. */
export async function readReport(conn: Conn, session_id: string): Promise<ReportRow | null> {
  const 행들 = await conn
    .select()
    .from(parent_reports)
    .where(eq(parent_reports.session_id, session_id))
    .limit(1)
  return 행들.length === 0 ? null : 행들[0]
}

/**
 * 리포트 한 장을 저장한다 — `session_id` 로 **덮어쓴다** (R1 · 명세 8절 ④).
 *
 * 덮어쓸 때 손대지 않는 칸 둘:
 * - `read_at` — 보호자가 언제 처음 열었나는 다시 만들어도 사실 그대로다.
 * - `regenerated` — `bump_regenerated` 가 `true` 일 때만 1 오른다.
 */
export async function upsertReport(conn: Conn, 것: 저장할_리포트): Promise<ReportRow> {
  const 행들 = await conn
    .insert(parent_reports)
    .values({
      session_id: 것.session_id,
      child_id: 것.child_id,
      status: 것.status,
      metrics: 것.metrics,
      narrative: 것.narrative,
      model: 것.model,
      prompt_digest: 것.prompt_digest,
    })
    .onConflictDoUpdate({
      target: parent_reports.session_id,
      set: {
        child_id: 것.child_id,
        status: 것.status,
        metrics: 것.metrics,
        narrative: 것.narrative,
        model: 것.model,
        prompt_digest: 것.prompt_digest,
        // 다시 만든 시각이 곧 `generated_at` 이다 — 목록이 이 값으로 최신순을 잡는다.
        generated_at: sql`now()`,
        regenerated: 것.bump_regenerated
          ? sql`${parent_reports.regenerated} + 1`
          : sql`${parent_reports.regenerated}`,
      },
    })
    .returning()
  return 행들[0]
}

/**
 * 읽음 표시 (명세 7절 · 3.2 빨간 점).
 *
 * **처음 연 시각을 지키려고 `read_at IS NULL` 일 때만 찍는다.** 두 번 눌러도 시각이 안 밀린다.
 * 행이 없으면 아무 일도 일어나지 않는다 — 있는지는 부르는 쪽이 이미 보고 왔다.
 */
export async function markReportRead(conn: Conn, session_id: string): Promise<void> {
  await conn
    .update(parent_reports)
    .set({ read_at: sql`now()` })
    .where(and(eq(parent_reports.session_id, session_id), isNull(parent_reports.read_at)))
}

/**
 * 아이 하나의 리포트 목록 — 상단 활동 드롭다운 (명세 7절 첫 API).
 *
 * `generated_at DESC` 로 낸다. `idx_parent_reports_child` 가 그 순서로 서 있다.
 * `played_at` 은 **활동을 시작한 시각**이고 `metrics.activity.played_at` 과 같은 값이다 —
 * 두 곳에서 다른 값이 뜨지 않게 지표를 다시 세지 않고 세션 행에서 그대로 읽는다.
 */
export async function listReports(conn: Conn, child_id: string): Promise<ReportListItem[]> {
  const 행들 = await conn
    .select({
      session_id: parent_reports.session_id,
      story_title: stories.title,
      played_at: story_sessions.started_at,
      status: parent_reports.status,
      read_at: parent_reports.read_at,
    })
    .from(parent_reports)
    .innerJoin(story_sessions, eq(story_sessions.id, parent_reports.session_id))
    .innerJoin(stories, eq(stories.id, story_sessions.story_id))
    .where(eq(parent_reports.child_id, child_id))
    .orderBy(desc(parent_reports.generated_at))

  return 행들.map((행) => ({
    session_id: 행.session_id,
    story_title: 행.story_title,
    played_at: 행.played_at.toISOString(),
    status: 행.status as ReportStatus,
    unread: 행.read_at === null,
  }))
}

/**
 * 리포트가 **아직 없는** 끝난 활동들 — 보호자 열람 시 받침이 쓴다 (후활동 명세 F12).
 *
 * 후활동이 있는 이야기는 세션이 끝나도 리포트를 안 만든다 (F10). 아이가 활동을 안 하고
 * **앱을 그냥 꺼버리면** 만들라는 신호가 영영 안 오는데, 그 구멍을 메우는 자리가 여기다.
 *
 * 🔴 **끝난 활동만 올린다.** 도중에 그만둔 활동(`in_progress`)에 리포트를 만들면 아이가
 *    이어서 놀던 이야기가 「끝난 것」처럼 목록에 뜬다. `queueReport()` 도 같은 것을 다시
 *    보지만(그 문지기가 이 갈래의 마지막 방어선이다), 애초에 안 올리는 편이 싸다.
 *
 * 최근 순(`completed_at DESC`)이고 `한도` 개까지다 — 한 번 열 때 몇 장까지 띄울지는
 * 부르는 쪽(service)이 정한다. 밀린 것이 더 있으면 그다음 열람이 이어 받는다.
 */
export async function 리포트없는_활동들(
  conn: Conn,
  child_id: string,
  한도: number,
): Promise<string[]> {
  const 행들 = await conn
    .select({ session_id: story_sessions.id })
    .from(story_sessions)
    .leftJoin(parent_reports, eq(parent_reports.session_id, story_sessions.id))
    .where(
      and(
        eq(story_sessions.child_id, child_id),
        eq(story_sessions.status, 'completed'),
        isNull(parent_reports.session_id),
      ),
    )
    // ⚠️ `desc` 는 포스트그레스에서 NULL 이 **먼저** 온다. 끝난 활동인데 끝난 시각이 비어
    //    있는 행(옛 데이터)이 최근 것을 밀어내지 않게 뒤로 보낸다.
    .orderBy(sql`${story_sessions.completed_at} desc nulls last`)
    .limit(한도)
  return 행들.map((행) => 행.session_id)
}

/** `child_words` 에 넣을 낱말 하나 (명세 6.2). */
export interface 넣을_낱말 {
  word: string
  /** 장면 낱말 목록에 있으면 붙는다. 없으면 `null` */
  meaning: string | null
  first_session_id: string
  first_scene_code: string | null
}

/**
 * 새 낱말을 누적 목록에 넣는다 (명세 8절 ⑤).
 *
 * 🔴 **리포트 저장이 성공한 뒤에만** 부른다. 먼저 넣으면 「다시 만들기」를 눌렀을 때 그
 *    낱말들이 이미 있어 새 낱말이 0개가 된다 (명세 4.3).
 *
 * 같은 아이의 같은 낱말은 한 번만 남는다 — 이미 있으면 **그냥 지나간다.** 뜻이나 처음 만난
 * 장면을 덮어쓰지 않는 이유는 `first_*` 가 「처음」의 기록이기 때문이다.
 */
export async function insertChildWords(
  conn: Conn,
  child_id: string,
  낱말들: readonly 넣을_낱말[],
): Promise<number> {
  if (낱말들.length === 0) return 0
  const 넣은것 = await conn
    .insert(child_words)
    .values(
      낱말들.map((것) => ({
        child_id,
        word: 것.word,
        meaning: 것.meaning,
        first_session_id: 것.first_session_id,
        first_scene_code: 것.first_scene_code,
      })),
    )
    .onConflictDoNothing({ target: [child_words.child_id, child_words.word] })
    .returning({ id: child_words.id })
  return 넣은것.length
}
