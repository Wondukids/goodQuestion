// 리포트 재료 읽기 — 집계기(`domain/metrics.ts`)가 받는 행들을 **읽어 오기만** 한다.
//
// 🔴 `aggregateMetrics()` 는 DB 를 안 문다. 인자로 받는 `집계재료` 의 칸 여덟(세션·이야기·
//    장면·발화·분석·턴조건·미션시도·미션발화)과 `prior_activities` 를 채우는 것이 이 파일이다.
//
// ## 층 (`src/report/README.md`)
//
// repo 는 **SQL 이 사는 유일한 곳**이고 위층을 모른다. 그래서 여기서 지표를 세지 않고,
// LLM 도 부르지 않으며, 아무것도 판단하지 않는다 — 행을 그대로 올린다.
//
// ## 왜 세션 도메인과 달리 repo 를 두나
//
// `src/session` 에는 repo 가 없다 (새 표 0개 — 조회는 `llm/service` 의 문으로 받는다).
// 리포트는 사정이 다르다. 새 표 둘(`parent_reports`·`child_words`)을 우리가 세웠고,
// 집계에 필요한 **읽기 여덟**은 대화 진행과 아무 상관이 없어서 `llm/service` 에 얹으면
// 그쪽이 리포트 사정을 알게 된다.

import { and, asc, eq, isNull, lt, ne, or, sql } from 'drizzle-orm'

import {
  child_words,
  messages,
  mission_messages,
  mission_sessions,
  post_activity_keywords,
  post_activity_results,
  stories,
  story_missions,
  story_scenes,
  story_sessions,
  turn_conditions,
  utterance_analyses,
} from '@/llm/db/schema'
import type { Conn } from '@/llm/repo/db'
import type { 집계재료, 후활동재료 } from '@/report/domain/metrics'

/** 리포트가 붙는 활동 한 건의 신원. 문지기(누구 아이인가)와 생성 판정이 이것만 본다. */
export interface 세션신원 {
  session_id: string
  /** `children.id` 값. 우리는 누구인지 모르고 불투명하게 흘린다 (`schema.ts` story_sessions 절). */
  child_id: string
  /** `'in_progress' | 'post_activity' | 'completed' | 'stopped'` */
  status: string
  /**
   * 이 활동의 이야기에 **말하기 후 활동이 붙어 있나** (`stories.post_activity_config`).
   *
   * 리포트를 **언제** 만드는가가 이 값으로 갈린다 (후활동 명세 7.1 · F10·F13) —
   * 있으면 이야기가 끝나도 안 만들고 후활동이 끝나기를 기다리고, 없으면 지금처럼
   * 세션이 끝나는 자리에서 만든다. 판단은 `queueReport()` 가 하고 여기는 값만 올린다.
   */
  has_post_activity: boolean
}

/** 프롬프트에 실을 아이 (결정 R12). 못 찾으면 둘 다 `null` 이다. */
export interface 아이행 {
  name: string | null
  birth_year: number | null
}

// ---------------------------------------------------------------------------
// 신원 — 문지기가 쓴다
// ---------------------------------------------------------------------------

/**
 * 활동 한 건이 **누구 아이 것인가**. 없으면 `null`.
 *
 * ⛔ 여기서 「내 아이인가」를 판단하지 않는다. 그 판정은 저쪽(Supabase `children`)을 봐야
 *    하고 그건 controller 몫이다 (`controller/guard.ts`). repo 는 값만 올린다.
 *
 * ⚠️ 이야기를 함께 읽는다 (`has_post_activity`). `story_id` 는 `NOT NULL` + 외래키라
 *    `innerJoin` 이 행을 떨어뜨리지 않는다 — 세션이 있으면 이야기도 반드시 있다.
 */
export async function readSessionIdentity(
  conn: Conn,
  session_id: string,
): Promise<세션신원 | null> {
  const 행들 = await conn
    .select({
      session_id: story_sessions.id,
      child_id: story_sessions.child_id,
      status: story_sessions.status,
      has_post_activity: sql<boolean>`${stories.post_activity_config} is not null`,
    })
    .from(story_sessions)
    .innerJoin(stories, eq(stories.id, story_sessions.story_id))
    .where(eq(story_sessions.id, session_id))
    .limit(1)
  return 행들.length === 0 ? null : 행들[0]
}

// ---------------------------------------------------------------------------
// 집계 재료 여덟 칸
// ---------------------------------------------------------------------------

/**
 * 활동 한 건의 집계 재료를 통째로 읽는다. 세션이 없으면 `null`.
 *
 * 질의는 열 번이고 서로 기대지 않는다 — 세션 한 줄을 먼저 읽어 `story_id` 와 `child_id`
 * 를 얻은 뒤, 나머지 아홉을 **한꺼번에** 던진다.
 *
 * ⚠️ 순서에 기대지 않게 `messages` 는 `turn_order` 로, 장면은 `scene_order` 로 정렬해 올린다.
 *    집계기도 제 손으로 다시 정렬하지만(같은 입력 = 같은 출력), 읽는 사람이 로그와 대조할 때
 *    행 순서가 흔들리면 눈으로 못 맞춘다.
 */
export async function readReportMaterial(
  conn: Conn,
  session_id: string,
): Promise<(집계재료 & { child_id: string }) | null> {
  const 세션들 = await conn
    .select({
      story_id: story_sessions.story_id,
      child_id: story_sessions.child_id,
      status: story_sessions.status,
      started_at: story_sessions.started_at,
      completed_at: story_sessions.completed_at,
      last_activity_at: story_sessions.last_activity_at,
      story_slug: stories.slug,
      story_title: stories.title,
      post_activity_config: stories.post_activity_config,
    })
    .from(story_sessions)
    .innerJoin(stories, eq(stories.id, story_sessions.story_id))
    .where(eq(story_sessions.id, session_id))
    .limit(1)
  if (세션들.length === 0) return null
  const 세션 = 세션들[0]

  const [
    장면들,
    발화들,
    분석들,
    턴조건들,
    미션시도들,
    미션발화들,
    이전활동,
    후활동결과,
    후활동단어들,
  ] = await Promise.all([
    conn
      .select({
        id: story_scenes.id,
        code: story_scenes.code,
        scene_order: story_scenes.scene_order,
        vocabulary: story_scenes.vocabulary,
      })
      .from(story_scenes)
      .where(eq(story_scenes.story_id, 세션.story_id))
      .orderBy(asc(story_scenes.scene_order)),

    conn
      .select({
        id: messages.id,
        scene_id: messages.scene_id,
        speaker_type: messages.speaker_type,
        turn_order: messages.turn_order,
        text: messages.text,
      })
      .from(messages)
      .where(eq(messages.session_id, session_id))
      .orderBy(asc(messages.turn_order)),

    // 분석은 아이 발화에만 달린다. 세션으로 좁히려면 `messages` 를 타야 한다.
    conn
      .select({
        message_id: utterance_analyses.message_id,
        child_intent: utterance_analyses.child_intent,
        detected_elements: utterance_analyses.detected_elements,
        utterance_validity: utterance_analyses.utterance_validity,
      })
      .from(utterance_analyses)
      .innerJoin(messages, eq(messages.id, utterance_analyses.message_id))
      .where(eq(messages.session_id, session_id)),

    // 턴당 한 행이다 (`turn_conditions.message_id` 가 PK). 상호작용 축이 앞 턴의 판정을
    // 조건으로 쓰는 자리 둘에 필요한 칸만 뽑는다 —
    //   ① 「유도(GUIDED) 다음 발화가 살아났나」 → `response_mode`
    //   ② 「걱정 한 줄(soft-cue) 다음 발화가 그 요소를 말했나」 → `soft_cue` + `guidance_target`
    // ②는 2026-08-15 실측 뒤에 붙었다 (`report/domain/metrics.ts` 의 `상호작용_점수칸` 머리말).
    conn
      .select({
        message_id: turn_conditions.message_id,
        response_mode: turn_conditions.response_mode,
        guidance_target: turn_conditions.guidance_target,
        soft_cue: turn_conditions.soft_cue,
      })
      .from(turn_conditions)
      .innerJoin(messages, eq(messages.id, turn_conditions.message_id))
      .where(eq(messages.session_id, session_id)),

    // 미션 시도 — 두 표를 여기서 접어 올린다 (`미션시도행` 머리말: 조인은 부르는 쪽이 한다).
    // ⚠️ `abandoned` 시도도 뺀 것이 없다. 도중에 그만둔 미션에서도 아이는 말을 했고,
    //    「말한 문장 수」는 본 대화 + 미션 전부다 (결정 R23).
    conn
      .select({
        id: mission_sessions.id,
        scene_id: story_missions.scene_id,
        title: story_missions.title,
      })
      .from(mission_sessions)
      .innerJoin(story_missions, eq(story_missions.id, mission_sessions.mission_id))
      .where(eq(mission_sessions.session_id, session_id)),

    conn
      .select({
        id: mission_messages.id,
        mission_session_id: mission_messages.mission_session_id,
        turn_order: mission_messages.turn_order,
        speaker_type: mission_messages.speaker_type,
        text: mission_messages.text,
        analysis: mission_messages.analysis,
      })
      .from(mission_messages)
      .innerJoin(mission_sessions, eq(mission_sessions.id, mission_messages.mission_session_id))
      .where(eq(mission_sessions.session_id, session_id))
      .orderBy(asc(mission_messages.turn_order)),

    // 이 아이의 **이전** 완료 활동 수 (명세 4.3 — 0 이면 첫 활동이라 라벨이 바뀐다).
    // 🔴 「이번보다 먼저 시작한 것」으로 센다. `completed_at` 으로 세면 이번 활동이 아직
    //    안 끝난 판(중간에 그만둔 활동을 다시 만들 때)에서 기준이 사라진다.
    conn
      .select({ 수: sql<number>`count(*)::int` })
      .from(story_sessions)
      .where(
        and(
          eq(story_sessions.child_id, 세션.child_id),
          eq(story_sessions.status, 'completed'),
          ne(story_sessions.id, session_id),
          lt(story_sessions.started_at, 세션.started_at),
        ),
      ),

    // ── 말하기 후 활동 두 표 (이슈 #47 · 후활동 명세 4.2·4.3) ──────────────
    //
    // 세션당 한 행이다 (`session_id` 가 UNIQUE). 없으면 활동을 아예 안 한 것이다.
    conn
      .select({
        submitted_order: post_activity_results.submitted_order,
        is_order_correct: post_activity_results.is_order_correct,
        attempt_count: post_activity_results.attempt_count,
        retelling_text: post_activity_results.retelling_text,
        analyzed_at: post_activity_results.analyzed_at,
      })
      .from(post_activity_results)
      .where(eq(post_activity_results.session_id, session_id))
      .limit(1),

    // 단어 행은 결과 행에 달려 있지만 **세션으로 바로 좁힌다** — `result_id` 를 먼저 읽어
    // 오면 위 질의에 매여 한꺼번에 못 던진다 (`utterance_analyses` 를 `messages` 로 좁힌
    // 것과 같은 자리). 결과 행이 없으면 조인이 0행을 낸다.
    //
    // ⚠️ 차례를 SQL 로 세우지 않는다. 이 표에 순번 칸이 없어서 무엇으로 정렬해도 카드
    //    차례가 아니고(`card_id` 는 글자다), 그 일은 설정을 가진 집계기 몫이다.
    conn
      .select({
        card_id: post_activity_keywords.card_id,
        word: post_activity_keywords.word,
        status: post_activity_keywords.status,
        evidence: post_activity_keywords.evidence,
      })
      .from(post_activity_keywords)
      .innerJoin(
        post_activity_results,
        eq(post_activity_results.id, post_activity_keywords.result_id),
      )
      .where(eq(post_activity_results.session_id, session_id)),
  ])

  return {
    child_id: 세션.child_id,
    session: {
      status: 세션.status,
      started_at: 세션.started_at,
      completed_at: 세션.completed_at,
      last_activity_at: 세션.last_activity_at,
    },
    story: { slug: 세션.story_slug, title: 세션.story_title },
    // 장면 이름(`name`)은 `story_scenes` 에 칸이 없어 안 준다 — 그러면 집계기가
    // `scene_label` 을 「장면 N」까지만 만든다 (`장면행.name` 머리말).
    scenes: 장면들,
    messages: 발화들,
    analyses: 분석들,
    turn_conditions: 턴조건들,
    mission_sessions: 미션시도들,
    mission_messages: 미션발화들,
    prior_activities: 이전활동[0]?.수 ?? 0,
    post_activity:
      후활동결과.length === 0
        ? null
        : {
            result: 후활동결과[0],
            words: 후활동단어들,
            word_order: 단어차례(세션.post_activity_config),
          },
  }
}

/**
 * `stories.post_activity_config` 에서 **칩을 그릴 차례**만 떠 온다 (카드 넉 장 × 단어 셋).
 *
 * ⛔ **여기서 설정을 검사하지 않는다.** 세션 도메인에는 zod 로 읽고 안 맞으면 **던지는**
 *    자리가 있지만(`src/session/service/post-activity.ts` 의 `설정을_읽는다`), 그쪽은 활동을
 *    **열어 주는** 길이라 안 맞으면 아이가 못 논다. 이쪽은 이미 끝난 활동을 **보여 주는**
 *    길이다 — 설정이 그새 어그러졌다고 리포트가 통째로 안 나오면 그게 더 나쁘다.
 *    그래서 읽히는 만큼만 읽고 나머지는 빈 목록으로 둔다 (그러면 읽어 온 차례가 남는다).
 */
function 단어차례(config: unknown): 후활동재료['word_order'] {
  if (typeof config !== 'object' || config === null) return []
  const { cards } = config as { cards?: unknown }
  if (!Array.isArray(cards)) return []

  const 차례: { card_id: string; word: string }[] = []
  for (const 카드 of cards) {
    if (typeof 카드 !== 'object' || 카드 === null) continue
    const { id, keywords } = 카드 as { id?: unknown; keywords?: unknown }
    if (typeof id !== 'string' || !Array.isArray(keywords)) continue
    for (const 단어 of keywords) {
      if (typeof 단어 === 'string') 차례.push({ card_id: id, word: 단어 })
    }
  }
  return 차례
}

/**
 * 이 아이가 **지난 활동까지** 쓴 낱말 (명세 6.2). 새 낱말을 가르는 잣대다.
 *
 * 🔴 `except_session_id` 를 주면 **그 활동이 처음 넣은 낱말은 뺀다.** 「다시 만들기」(R19)가
 *    이 인자의 존재 이유다 — 첫 생성 때 ⑤가 넣어 둔 낱말이 그대로 잣대에 들어가면 다시
 *    만든 리포트의 새 낱말이 **0개**가 된다. 명세 4.3 이 ⑤를 ④ 뒤로 미룬 것과 같은 이유이고,
 *    한 판 안의 순서만으로는 **판을 넘어선 이 자리**를 막지 못한다.
 *
 * ⚠️ `first_session_id` 가 `NULL` 인 행(세션이 지워진 낱말)은 그대로 남긴다. 그 낱말을 어느
 *    활동에서 처음 썼는지 모를 뿐, 이 아이가 쓴 적이 있다는 사실은 그대로다.
 */
export async function readChildWords(
  conn: Conn,
  child_id: string,
  except_session_id?: string,
): Promise<string[]> {
  const 행들 = await conn
    .select({ word: child_words.word })
    .from(child_words)
    .where(
      except_session_id === undefined
        ? eq(child_words.child_id, child_id)
        : and(
            eq(child_words.child_id, child_id),
            or(
              isNull(child_words.first_session_id),
              ne(child_words.first_session_id, except_session_id),
            ),
          ),
    )
  return 행들.map((행) => 행.word)
}

// ---------------------------------------------------------------------------
// 아이 이름·나이 — 저쪽 표를 **선언에 넣지 않고** 읽는다
// ---------------------------------------------------------------------------
//
// 🔴 `children` 은 저쪽(팀 레포) 표다. 우리 드리즐 선언에 넣으면 `drizzle-kit push` 가 보는
//    표 목록에 들어가고, 그 표에는 **진짜 아이 계정**이 들어 있다 (`db/push-guard.ts`).
//    그래서 손 SQL 로 **읽기만** 한다 — 선언은 한 글자도 안 늘어난다.
//
// ⚠️ 표가 없을 수도 있다 (로컬 도커 DB 에는 `children` 이 없다). 없는 표에 그냥 질의하면
//    **트랜잭션이 통째로 죽는다** — 검사는 트랜잭션 안에서 도므로 그 뒤 질의가 전부
//    「current transaction is aborted」로 넘어진다. 그래서 `to_regclass` 로 먼저 묻는다.
//    없는 이름에도 NULL 을 돌려줄 뿐 절대 안 터지는 함수다.

async function 표가_있나(conn: Conn, 이름: string): Promise<boolean> {
  const 행들 = (await conn.execute(
    sql`select to_regclass(${이름}) is not null as 있나`,
  )) as unknown as { 있나: boolean }[]
  return 행들[0]?.있나 === true
}

/**
 * 아이 이름·출생연도. 못 찾으면 둘 다 `null` 이다.
 *
 * 보는 자리는 둘이고 순서가 있다:
 * 1. `children` — 실제 제품의 아이 (저쪽 표. 손 SQL 로 읽기만)
 * 2. `gq_admin.test_children` — 회차를 돌릴 때 고르는 시험용 아이 (우리 표, 결정 46)
 *
 * ⛔ 못 찾았다고 이름을 지어내지 않는다. 「모른다」를 그대로 올리고, 프롬프트에 무엇을
 *    실을지는 service 층이 정한다.
 */
export async function readChildInfo(conn: Conn, child_id: string): Promise<아이행> {
  for (const 표 of ['public.children', 'gq_admin.test_children']) {
    if (!(await 표가_있나(conn, 표))) continue
    const 행들 = (await conn.execute(
      sql`select name, birth_year from ${sql.raw(표)} where id = ${child_id}::uuid limit 1`,
    )) as unknown as { name: string | null; birth_year: number | null }[]
    if (행들.length > 0) {
      return { name: 행들[0].name ?? null, birth_year: 행들[0].birth_year ?? null }
    }
  }
  return { name: null, birth_year: null }
}
