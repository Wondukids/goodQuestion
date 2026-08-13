// 사람 검수가 읽고 쓰는 저장 계층 (이슈 #26 화면-4).
//
// 파이썬 `src/goodquestion_admin/저장.py` 의 **검수 갈래만** 옮긴 것이다 —
// `채점_넣기` · `현재_채점들` · `검수_턴들` · `검수_기록들` · `보류_목록` ·
// `최신_기준_버전` · `기준_넣기` · `다시볼_판정들` · `교정_넣기` ·
// `분석_골든항목들` · `대사_내보내기_항목들` · `최신_사람검수_시각`.
//
// 표 셋이 이 파일의 전부다 (`sql/003_admin.sql` · `db/schema.ts`):
//
// | 표 | 무엇 |
// |---|---|
// | `scores` | 판정 한 칸. **덧붙이기 전용** — 고치지 않고 한 행 더 쌓는다 (FR-047) |
// | `corrections` | 「그럼 뭐였어야 하나」. `scores` 한 행에 딸린다 |
// | `review_criteria` | 장면·요소별 검수 기준. 판 번호를 올려 쌓고 옛 판을 안 지운다 |
//
// ## 🔴 점수가 어디에 붙는지가 이 파일의 핵심이다
//
// - `scores.run_id` — **어느 회차에서** 매겼나
// - `scores.message_id` — **어느 아이 발화**에 대한 판정인가 (분석·대사 둘 다 이 자리다)
// - `scores.llm_call_id` — 대사 검수일 때만. 그 대사를 낸 **캐릭터 호출**이다
// - `scores.criteria_version` — 매길 때 그 장면의 기준이 **몇 판**이었나
//
// ⭐ 대사 판정도 `message_id` 는 **아이 메시지**다. 캐릭터 메시지가 아니다 —
//    한 아이 발화에 분석 판정과 대사 판정이 나란히 붙어야 한 턴을 한 줄로 볼 수 있다.
//
// ## 손 SQL 을 남긴 자리
//
// 파이썬이 손 SQL 로 남긴 넷(`검수_턴들`·`검수_기록들`·`분석_골든항목들`·
// `대사_내보내기_항목들`)은 여기서도 손 SQL 이다. `LEFT JOIN LATERAL` 과 윈도 함수와
// `jsonb_agg` 가 한 문장에 겹쳐 있어 질의 빌더로 펴면 오히려 읽기 어려워진다.
// 창(`row_number() OVER`)이 필요한 `현재_채점들`·`보류_목록`·`다시볼_판정들` 도 같다.
//
// ⛔ 트랜잭션을 여닫지 않는다 (결정 18). 커밋 경계는 `lib/service/review.ts` 에 있다.

import { and, eq, sql } from 'drizzle-orm'

import { corrections, review_criteria, scores } from '@/db/schema'

import type { Conn } from './db'

/** `scores` 한 행. */
export type ScoreRow = typeof scores.$inferSelect
/** `corrections` 한 행. */
export type CorrectionRow = typeof corrections.$inferSelect
/** `review_criteria` 한 행. */
export type ReviewCriterionRow = typeof review_criteria.$inferSelect

/** 분석 LLM 이 낸 요소 한 칸. `utterance_analyses.detected_elements` 의 원소다. */
export interface DetectedElementRow {
  type: string
  evidence: string | null
}

// ---------------------------------------------------------------------------
// 판정 쓰기
// ---------------------------------------------------------------------------

/**
 * 판정 한 행을 **더한다** (파이썬 `채점_넣기`).
 *
 * 🔴 기존 행을 고치지 않는다 (FR-047). 다시 매기면 두 행이 되고, 「지금 판정」은
 * `currentScores()` 가 창으로 뽑는 최신 한 행이다. 앞 판정이 지워지면 「그때는 왜
 * 맞다고 봤나」가 사라진다.
 */
export async function insertScore(
  conn: Conn,
  값: {
    run_id: string
    message_id: string | null
    llm_call_id: string | null
    target: string
    check_name: string
    value: number | null
    comment: string | null
    violated_item: string | null
    graded_by: string
    criteria_version?: number | null
  },
): Promise<ScoreRow> {
  const 행들 = await conn
    .insert(scores)
    .values({ ...값, criteria_version: 값.criteria_version ?? null })
    .returning()
  return 행들[0]
}

/** 「그럼 뭐였어야 하나」. 점수 한 행에 딸린다 (파이썬 `교정_넣기`). */
export async function insertCorrection(
  conn: Conn,
  {
    score_id,
    target,
    corrected,
  }: { score_id: string; target: string; corrected: Record<string, unknown> },
): Promise<CorrectionRow> {
  const 행들 = await conn.insert(corrections).values({ score_id, target, corrected }).returning()
  return 행들[0]
}

/**
 * 같은 검사 대상에서 **가장 최근에 덧붙인** 판정만 (파이썬 `현재_채점들`).
 *
 * 「같은 칸」은 `(message_id, llm_call_id, target, check_name)` 넷이다.
 */
export async function currentScores(
  conn: Conn,
  { run_id }: { run_id: string },
): Promise<ScoreRow[]> {
  const 행들 = await conn.execute(sql`
    SELECT ranked.*
      FROM (
            SELECT s.*,
                   row_number() OVER (
                       PARTITION BY s.message_id, s.llm_call_id, s.target, s.check_name
                       ORDER BY s.created_at DESC, s.id DESC
                   ) AS latest_no
              FROM scores s
             WHERE s.run_id = ${run_id}
           ) ranked
     WHERE ranked.latest_no = 1
     ORDER BY ranked.created_at, ranked.id
  `)
  // 손 SQL 이라 드리즐이 칸을 못 검사한다. **형은 여기서 한 번만 못박는다.**
  return 행들 as unknown as (ScoreRow)[]
}

// ---------------------------------------------------------------------------
// 검수 화면이 읽는 것
// ---------------------------------------------------------------------------

/** 이 장면에 지금 걸려 있는 기준 문장 하나 (`review_criteria` 의 최신 판). */
export interface SceneCriterion {
  element: string
  criterion: string
  version: number
  origin: string
  written_by: string | null
  created_at: string
}

/** 검수할 턴 하나 — 아이 발화 한 건에 분석·대사·기준을 붙인 것. */
export interface ReviewTurn {
  message_id: string
  scene_id: string
  turn_order: number
  child_utterance: string
  utterance_source: string | null
  scene_order: number
  character_name: string | null
  scene_description: string | null
  conflict: string | null
  target_elements: string[] | null
  child_intent: string | null
  main_point: string | null
  detected_elements: DetectedElementRow[] | null
  utterance_validity: string | null
  previous_character_message: string | null
  /** ⭐ 이 턴에 캐릭터 대사가 없으면 `null`. **다음 턴 대사를 빌려 오지 않는다** (FR-048). */
  character_utterance: string | null
  /** 그 대사를 낸 캐릭터 호출. 대사 판정이 이 값을 `scores.llm_call_id` 로 단다. */
  llm_call_id: string | null
  criteria: SceneCriterion[]
  latest_criteria_version: number
}

/**
 * 이 회차에서 검수할 아이 발화 전부 (파이썬 `검수_턴들`).
 *
 * ⭐ **다음 턴 대사를 빌려 오지 않는다** (FR-048). 화자를 안 가리고 **바로 다음 한 행**만
 *    보고, 그게 같은 장면의 캐릭터일 때만 이 턴의 대사로 인정한다. `speaker_type =
 *    'character'` 로 걸러 버리면 실패한 턴이 다음 턴의 대사를 집어 오고, 기획자가 남의
 *    대사에 O/X 를 매긴 것이 그대로 골든셋으로 나간다.
 */
export async function reviewTurns(
  conn: Conn,
  { run_id }: { run_id: string },
): Promise<ReviewTurn[]> {
  const 행들 = await conn.execute(sql`
    SELECT m.id AS message_id,
           m.scene_id,
           m.turn_order,
           m.text AS child_utterance,
           m.utterance_source,
           sc.scene_order,
           sc.character_name,
           sc.scene_description,
           sc.conflict,
           sc.required_elements AS target_elements,
           ua.child_intent,
           ua.main_point,
           ua.detected_elements,
           ua.utterance_validity,
           previous_message.text AS previous_character_message,
           -- ⭐ 이 턴에 캐릭터 대사가 없으면 NULL 이다. **다음 턴 대사를 빌려 오지 않는다.**
           CASE WHEN next_message.speaker_type = 'character'
                 AND next_message.scene_id = m.scene_id
                THEN next_message.text END AS character_utterance,
           character_call.id AS llm_call_id,
           COALESCE(criteria.criteria, '[]'::jsonb) AS criteria,
           COALESCE(criteria.latest_version, 0) AS latest_criteria_version
      FROM runs r
      JOIN messages m
        ON m.session_id = r.session_id
       AND m.speaker_type = 'child'
      JOIN story_scenes sc ON sc.id = m.scene_id
 LEFT JOIN utterance_analyses ua ON ua.message_id = m.id
 LEFT JOIN LATERAL (
            SELECT before.text
              FROM messages before
             WHERE before.session_id = m.session_id
               AND before.scene_id = m.scene_id
               AND before.speaker_type = 'character'
               AND before.turn_order < m.turn_order
          ORDER BY before.turn_order DESC
             LIMIT 1
           ) previous_message ON true
 LEFT JOIN LATERAL (
            -- **바로 다음 메시지 한 행**만 본다. 화자를 안 가리고 집는 것이 핵심이다.
            SELECT nxt.speaker_type, nxt.scene_id, nxt.text
              FROM messages nxt
             WHERE nxt.session_id = m.session_id
               AND nxt.turn_order > m.turn_order
          ORDER BY nxt.turn_order, nxt.id
             LIMIT 1
           ) next_message ON true
 LEFT JOIN LATERAL (
            SELECT lc.id
              FROM llm_calls lc
             WHERE lc.run_id = r.id
               AND lc.message_id = m.id
               AND lc.purpose = 'character'
               AND lc.ok
          ORDER BY lc.attempt_no DESC, lc.created_at DESC
             LIMIT 1
           ) character_call ON true
 LEFT JOIN LATERAL (
            SELECT jsonb_agg(
                       jsonb_build_object(
                           'element', current.element,
                           'criterion', current.criterion,
                           'version', current.version,
                           'origin', current.origin,
                           'written_by', current.written_by,
                           'created_at', current.created_at
                       ) ORDER BY current.element
                   ) AS criteria,
                   max(current.version) AS latest_version
              FROM (
                    SELECT DISTINCT ON (rc.element) rc.*
                      FROM review_criteria rc
                     WHERE rc.scene_id = m.scene_id
                  ORDER BY rc.element, rc.version DESC, rc.created_at DESC
                   ) current
           ) criteria ON true
     WHERE r.id = ${run_id}
  ORDER BY m.turn_order, m.id
  `)
  // 손 SQL 이라 드리즐이 칸을 못 검사한다. **형은 여기서 한 번만 못박는다.**
  return 행들 as unknown as (ReviewTurn)[]
}

/** 이 회차에 사람이 남긴 판정 한 줄 (교정·장면·기준 판을 붙인 것). */
export interface ReviewRecord extends ScoreRow {
  /** 같은 칸에서 가장 최근 판정인가. 「(현재)」 표시의 근거다. */
  is_latest: boolean
  corrected: Record<string, unknown> | null
  scene_order: number | null
  character_name: string | null
  latest_criteria_version: number
  /** 매긴 뒤 기준 판이 올라갔나 (FR-044e · SC-020). */
  needs_review: boolean
}

/**
 * 이 회차의 **사람** 판정 전부, 최근 것이 위 (파이썬 `검수_기록들`).
 *
 * ⚠️ `graded_by <> 'auto'` — 자동 채점은 이 화면의 이력에 섞지 않는다.
 */
export async function reviewRecords(
  conn: Conn,
  { run_id }: { run_id: string },
): Promise<ReviewRecord[]> {
  const 행들 = await conn.execute(sql`
    SELECT ranked.*,
           correction.corrected,
           sc.scene_order,
           sc.character_name,
           COALESCE(criteria.latest_version, 0) AS latest_criteria_version,
           ranked.criteria_version IS NOT NULL
               AND ranked.criteria_version < COALESCE(criteria.latest_version, 0)
               AS needs_review
      FROM (
            SELECT s.*,
                   row_number() OVER (
                       PARTITION BY s.message_id, s.llm_call_id, s.target, s.check_name
                       ORDER BY s.created_at DESC, s.id DESC
                   ) = 1 AS is_latest
              FROM scores s
             WHERE s.run_id = ${run_id} AND s.graded_by <> 'auto'
           ) ranked
 LEFT JOIN messages m ON m.id = ranked.message_id
 LEFT JOIN story_scenes sc ON sc.id = m.scene_id
 LEFT JOIN LATERAL (
            SELECT c.corrected
              FROM corrections c
             WHERE c.score_id = ranked.id
          ORDER BY c.created_at DESC, c.id DESC
             LIMIT 1
           ) correction ON true
 LEFT JOIN LATERAL (
            SELECT max(rc.version) AS latest_version
              FROM review_criteria rc
             WHERE rc.scene_id = m.scene_id
           ) criteria ON true
  ORDER BY ranked.created_at DESC, ranked.id DESC
  `)
  // 손 SQL 이라 드리즐이 칸을 못 검사한다. **형은 여기서 한 번만 못박는다.**
  return 행들 as unknown as (ReviewRecord)[]
}

/** 보류 한 줄 — 판정이 `null` 인 최신 점수에 그 발화를 붙인 것. */
export interface PendingScore extends ScoreRow {
  scene_id: string
  turn_order: number
  child_utterance: string
  scene_order: number
  character_name: string | null
}

/**
 * 아직 못 정한 판정 전부, 회차를 가리지 않는다 (파이썬 `보류_목록`).
 *
 * 🔴 보류는 **분모에서 빠진다** (FR-045a·b) — 「모르겠다」를 「지킴」으로 세면 위반율이
 * 조용히 낮아진다. 그래서 값을 `null` 로 남기고, 그 자리를 여기 모아 **기준을 정할 일감**
 * 으로 보여 준다.
 */
export async function pendingScores(conn: Conn): Promise<PendingScore[]> {
  const 행들 = await conn.execute(sql`
    SELECT ranked.*,
           m.scene_id,
           m.turn_order,
           m.text AS child_utterance,
           sc.scene_order,
           sc.character_name
      FROM (
            SELECT s.*,
                   row_number() OVER (
                       PARTITION BY s.message_id, s.llm_call_id, s.target, s.check_name
                       ORDER BY s.created_at DESC, s.id DESC
                   ) AS latest_no
              FROM scores s
             WHERE s.graded_by <> 'auto'
           ) ranked
      JOIN messages m ON m.id = ranked.message_id
      JOIN story_scenes sc ON sc.id = m.scene_id
     WHERE ranked.latest_no = 1 AND ranked.value IS NULL
     ORDER BY ranked.created_at, ranked.id
  `)
  // 손 SQL 이라 드리즐이 칸을 못 검사한다. **형은 여기서 한 번만 못박는다.**
  return 행들 as unknown as (PendingScore)[]
}

/**
 * 매긴 뒤 기준 판이 올라간 **분석** 판정 (파이썬 `다시볼_판정들`).
 *
 * 잣대가 바뀌었으니 그 판정은 다시 봐야 한다 (FR-044e · SC-020). 새 기준으로 다시 매기면
 * 새 판 번호를 달고 나가므로 여기서 저절로 빠진다.
 */
export async function staleScores(
  conn: Conn,
  { run_id }: { run_id: string },
): Promise<(ScoreRow & { scene_id: string; turn_order: number; latest_criteria_version: number })[]> {
  const 행들 = await conn.execute(sql`
    SELECT s.*,
           m.scene_id,
           m.turn_order,
           COALESCE(criteria.latest_version, 0) AS latest_criteria_version
      FROM scores s
      JOIN messages m ON m.id = s.message_id
 LEFT JOIN LATERAL (
            SELECT max(rc.version) AS latest_version
              FROM review_criteria rc
             WHERE rc.scene_id = m.scene_id
           ) criteria ON true
     WHERE s.run_id = ${run_id}
       AND s.graded_by <> 'auto'
       AND s.target = 'analysis'
       AND COALESCE(s.criteria_version, 0) < COALESCE(criteria.latest_version, 0)
     ORDER BY s.created_at, s.id
  `)
  // 손 SQL 이라 드리즐이 칸을 못 검사한다. **형은 여기서 한 번만 못박는다.**
  return 행들 as unknown as (ScoreRow & { scene_id: string; turn_order: number; latest_criteria_version: number })[]
}

// ---------------------------------------------------------------------------
// 기준 문장
// ---------------------------------------------------------------------------

/** 이 장면·이 요소의 마지막 판 번호. 없으면 0 (파이썬 `최신_기준_버전`). */
export async function latestCriterionVersion(
  conn: Conn,
  { scene_id, element }: { scene_id: string; element: string },
): Promise<number> {
  const 행들 = await conn
    .select({ version: sql<number>`coalesce(max(${review_criteria.version}), 0)::int` })
    .from(review_criteria)
    .where(and(eq(review_criteria.scene_id, scene_id), eq(review_criteria.element, element)))
  return 행들[0].version
}

/**
 * 기준 문장 한 줄을 **새 판으로 쌓는다** (파이썬 `기준_넣기`).
 *
 * 🔴 판 번호는 **장면 단위**로 오른다(요소 단위가 아니다). 어느 요소의 기준을 고쳤든
 * 그 장면의 잣대가 바뀐 것이고, 그래야 `scores.criteria_version` 하나로 「옛 잣대인가」를
 * 가릴 수 있다.
 *
 * 🔴 `origin` 은 언제나 `'draft'` 다 (FR-044d · 헌법 원칙 IV). 전문가 확인 전에는
 * 품질의 근거로 쓰지 않는다 — 여기서 사람이 고를 수 있게 열어 두지 않는다.
 */
export async function insertCriterion(
  conn: Conn,
  {
    scene_id,
    element,
    criterion,
    written_by,
  }: { scene_id: string; element: string; criterion: string; written_by: string | null },
): Promise<ReviewCriterionRow> {
  const 다음_판 = sql<number>`(
    select coalesce(max(rc.version), 0) + 1
      from review_criteria rc
     where rc.scene_id = ${scene_id}
  )`
  const 행들 = await conn
    .insert(review_criteria)
    .values({ scene_id, element, criterion, version: 다음_판, origin: 'draft', written_by })
    .returning()
  return 행들[0]
}

// ---------------------------------------------------------------------------
// 내보내기 — 사람이 확정한 것만
// ---------------------------------------------------------------------------

/** 골든셋 한 줄이 될 재료. `corrected` 가 그 줄의 정답이다. */
export interface AnalysisGoldenRow {
  score_id: string
  message_id: string
  value: number
  comment: string | null
  graded_by: string
  reviewed_at: Date
  child_utterance: string
  utterance_source: string | null
  scene_order: number
  character_name: string | null
  scene_description: string | null
  conflict: string | null
  target_elements: string[] | null
  previous_character_message: string | null
  corrected: {
    child_intent: string
    main_point: string | null
    detected_elements: string[]
    utterance_validity: string
  }
}

/**
 * 사람이 **확정한 분석 검수**만 (파이썬 `분석_골든항목들` · FR-049).
 *
 * 담기는 조건 셋을 다 만족해야 한다.
 * - 같은 칸의 **최신** 판정이고
 * - `graded_by <> 'auto'` — 자동 채점은 정답지가 아니다
 * - 값이 있고(보류 제외), **지킴이거나 교정이 딸린 넘음**이다
 *
 * 「넘음인데 교정이 없는」 것은 담지 않는다 — 틀렸다는 것만 알고 정답을 모르는 줄이라
 * 정답지가 될 수 없다.
 */
export async function analysisGoldenRows(conn: Conn): Promise<AnalysisGoldenRow[]> {
  const 행들 = await conn.execute(sql`
    WITH latest AS (
        SELECT s.*,
               row_number() OVER (
                   PARTITION BY s.message_id, s.target, s.check_name
                   ORDER BY s.created_at DESC, s.id DESC
               ) AS latest_no
          FROM scores s
         WHERE s.graded_by <> 'auto' AND s.target = 'analysis'
    )
    SELECT latest.id AS score_id,
           latest.message_id,
           latest.value,
           latest.comment,
           latest.graded_by,
           latest.created_at AS reviewed_at,
           m.text AS child_utterance,
           m.utterance_source,
           sc.scene_order,
           sc.character_name,
           sc.scene_description,
           sc.conflict,
           sc.required_elements AS target_elements,
           previous_message.text AS previous_character_message,
           CASE WHEN latest.value = 0.0 THEN correction.corrected
                ELSE jsonb_build_object(
                     'child_intent', ua.child_intent,
                     'main_point', ua.main_point,
                     'detected_elements', COALESCE(
                         (SELECT jsonb_agg(element.value ->> 'type')
                            FROM jsonb_array_elements(ua.detected_elements) element),
                         '[]'::jsonb
                     ),
                     'utterance_validity', ua.utterance_validity
                ) END AS corrected
      FROM latest
      JOIN messages m ON m.id = latest.message_id
      JOIN story_scenes sc ON sc.id = m.scene_id
      JOIN utterance_analyses ua ON ua.message_id = m.id
 LEFT JOIN LATERAL (
            SELECT before.text
              FROM messages before
             WHERE before.session_id = m.session_id
               AND before.scene_id = m.scene_id
               AND before.speaker_type = 'character'
               AND before.turn_order < m.turn_order
          ORDER BY before.turn_order DESC
             LIMIT 1
           ) previous_message ON true
 LEFT JOIN LATERAL (
            SELECT c.corrected
              FROM corrections c
             WHERE c.score_id = latest.id AND c.target = 'analysis'
          ORDER BY c.created_at DESC, c.id DESC
             LIMIT 1
           ) correction ON true
     WHERE latest.latest_no = 1
       AND latest.value IS NOT NULL
       AND (latest.value = 1.0 OR correction.corrected IS NOT NULL)
  ORDER BY latest.created_at, latest.id
  `)
  // 손 SQL 이라 드리즐이 칸을 못 검사한다. **형은 여기서 한 번만 못박는다.**
  return 행들 as unknown as (AnalysisGoldenRow)[]
}

/** 대사 검수 내보내기 한 줄 (파이썬 `대사_내보내기_항목들`). */
export interface UtteranceExportRow {
  run_id: string
  message_id: string
  value: number
  comment: string | null
  violated_item: string | null
  graded_by: string
  reviewed_at: Date
  child_utterance: string
  utterance_source: string | null
  scene_order: number
  character_name: string | null
  character_utterance: string | null
  corrected: Record<string, unknown> | null
}

/**
 * 사람이 확정한 **대사 검수**만 (파이썬 `대사_내보내기_항목들`).
 *
 * ⚠️ 여기서는 「같은 장면의 **뒤에 오는 첫** 캐릭터 메시지」로 대사를 집는다 —
 *    파이썬과 같다. `reviewTurns()` 의 「바로 다음 한 행」과 다른 규칙인 것도 그대로 옮겼다.
 */
export async function utteranceExportRows(conn: Conn): Promise<UtteranceExportRow[]> {
  const 행들 = await conn.execute(sql`
    WITH latest AS (
        SELECT s.*,
               row_number() OVER (
                   PARTITION BY s.message_id, s.target, s.check_name
                   ORDER BY s.created_at DESC, s.id DESC
               ) AS latest_no
          FROM scores s
         WHERE s.graded_by <> 'auto' AND s.target = 'utterance'
    )
    SELECT latest.run_id,
           latest.message_id,
           latest.value,
           latest.comment,
           latest.violated_item,
           latest.graded_by,
           latest.created_at AS reviewed_at,
           m.text AS child_utterance,
           m.utterance_source,
           sc.scene_order,
           sc.character_name,
           character_message.text AS character_utterance,
           correction.corrected
      FROM latest
      JOIN messages m ON m.id = latest.message_id
      JOIN story_scenes sc ON sc.id = m.scene_id
 LEFT JOIN LATERAL (
            SELECT after.text
              FROM messages after
             WHERE after.session_id = m.session_id
               AND after.scene_id = m.scene_id
               AND after.speaker_type = 'character'
               AND after.turn_order > m.turn_order
          ORDER BY after.turn_order
             LIMIT 1
           ) character_message ON true
 LEFT JOIN LATERAL (
            SELECT c.corrected
              FROM corrections c
             WHERE c.score_id = latest.id AND c.target = 'utterance'
          ORDER BY c.created_at DESC, c.id DESC
             LIMIT 1
           ) correction ON true
     WHERE latest.latest_no = 1 AND latest.value IS NOT NULL
  ORDER BY latest.created_at, latest.id
  `)
  // 손 SQL 이라 드리즐이 칸을 못 검사한다. **형은 여기서 한 번만 못박는다.**
  return 행들 as unknown as (UtteranceExportRow)[]
}

/**
 * 사람이 마지막으로 무언가를 남긴 시각 (파이썬 `최신_사람검수_시각`).
 *
 * 셋을 한 줄로 본다 — 판정 · 교정 · 기준 문장. 내보낸 파일이 이 시각보다 오래됐으면
 * 화면이 「정답지가 낡았다」고 알린다.
 */
export async function latestHumanReviewAt(conn: Conn): Promise<Date | null> {
  const 행들 = await conn.execute(sql`
    SELECT max(changes.changed_at) AS changed_at
      FROM (
            SELECT s.created_at AS changed_at FROM scores s WHERE s.graded_by <> 'auto'
             UNION ALL
            SELECT c.created_at
              FROM corrections c
              JOIN scores s ON s.id = c.score_id
             WHERE s.graded_by <> 'auto'
             UNION ALL
            SELECT rc.created_at FROM review_criteria rc
           ) changes
  `)
  const 첫 = 행들[0] as { changed_at: Date | null } | undefined
  return 첫?.changed_at ?? null
}
