/**
 * 굿퀘스천 스키마 (Drizzle · Postgres 16)
 *
 * 근거: sql/001_schema.sql (엔진) · sql/003_admin.sql (관리 도구) 를 옮긴 것이다.
 * 그 두 파일의 근거 문서는 docs/기준/db구조.md (원본 PDF 전사본) 이다.
 *
 * ⚠️ 원본 SQL 의 주석을 통째로 옮겼다. 원본 문서에서 무엇을 왜 바꿨는지가
 *    그 주석에만 적혀 있기 때문이다 (docs/설계/이식목록.md 3절).
 *
 * ── 이 레포에서 만들지 않는 테이블 ───────────────────────────────
 *   parents / children / child_consents : 인증·계정 영역이라 범위 밖
 *   reports / analysis_versions / wordbook : 원문이 "추후 확장"으로 분류
 *
 * ── 원문에 없어서 001 에서 보탠 것 ──────────────────────────────
 *   원본 문서에는 PK/FK/NOT NULL/UNIQUE/DEFAULT/CHECK/인덱스 표기가 전혀 없다.
 *   제약은 (a) 컬럼 표의 `필수 Y/선택`, (b) 구조도의 (PK)/(FK) 표기에서만 왔다.
 *   그 위에 아래를 보탰다.
 *     1. PRIMARY KEY / REFERENCES  ← 구조도의 (PK)/(FK) 표기를 SQL 로 옮긴 것
 *     2. NOT NULL                  ← 컬럼 표의 `필수 = Y`
 *     3. CHECK (... IN ...)        ← 원문이 값을 "빠짐없이" 나열한 열거형에만.
 *                                     child_intent 는 원문 목록이 "등"으로 열려 있어 CHECK 를 걸지 않았다.
 *     4. UNIQUE                    ← 구조도가 1:0..1 로 표기한 관계
 *     5. DEFAULT                   ← 카운터·타임스탬프처럼 값이 없으면 못 쓰는 컬럼
 *     6. ON DELETE CASCADE         ← 부모가 사라지면 남아 있을 이유가 없는 자식 행
 *     7. 인덱스                     ← 외래키 조회용
 *   위 7개는 원문에 근거가 없는 판단이다. 원본 작성자와 다르게 정했다면 여기부터 고치면 된다.
 *
 * ── 파이썬 판에서 달라진 것 (2026-08-12 이식) ────────────────────
 *   1. `stories.slug` · `story_scenes.code` 를 처음부터 넣는다.
 *      파이썬 쪽에는 `characters.code` 만 있었고 나머지 둘은 `stories.title` 이 조회·조인
 *      키였다 — UNIQUE 도 없어서 제목이 같은 이야기가 둘이면 조용히 섞였다. 여기서 끊는다.
 *      ⚠️ `stories` 쪽 열쇠는 `code` 가 아니라 **`slug`** 다 (2026-08-13 결정 3 · 4차).
 *      저쪽(팀 레포 Supabase)에는 `code` 칸이 없고 `slug`(NOT NULL·UNIQUE)가 이미 있어,
 *      우리가 `code` 를 새로 만들면 저쪽 41행을 건드리는 유일한 조항이 된다. 그래서 맞춘다.
 *   2. `EMOTION` → `EMPATHY`. docs/설계/스펙확정_연동기준.md 확정 F.
 *   3. 컬럼 이름 = 코드 이름. 변환하지 않는다 (CLAUDE.md). 그래서 속성도 snake_case 다.
 *   4. 이야기 등장인물 표의 **DB 이름은 `story_characters`** 다 (결정 70). 저쪽이 `characters`
 *      라는 낱말을 이미 아이 아바타 프리셋 뜻으로 쓰기 때문이다. 내보내는 심볼은 `characters`
 *      그대로라 코드 쪽은 한 글자도 안 바뀐다.
 *   5. 관리 도구 11표는 `public` 이 아니라 **`gq_admin` 스키마**에 선다 (결정 5 · 4차).
 *      엔진 7표만 `public` 에 남는다. 내보내는 심볼 이름은 그대로다. 아래 관리 도구 절 참조.
 */

import { sql } from 'drizzle-orm'
import {
  bigint,
  bigserial,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

// ─────────────────────────────────────────────────────────────
// 4. stories — 이야기
// ─────────────────────────────────────────────────────────────
export const stories = pgTable(
  'stories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // 저쪽(팀 레포 Supabase) 이야기의 URL 슬러그. 예: fart-bride
    // 우리는 이 칸을 **조인 키로** 쓴다 (2026-08-13 결정 3 · 4차). 저쪽에 이미
    // `NOT NULL`·`UNIQUE` 로 서 있는 칸이라, 우리 식별자(`code`)를 새로 만드는 대신
    // 여기에 맞췄다 — 그러면 저쪽 `stories` 41행을 건드리는 조항이 하나도 안 남는다.
    // ⚠️ 콘텐츠 원본 문서의 식별자(`s_banggui_daughter_in_law_001`)는 이 칸이 아니다.
    //    그 값은 docs/기준/콘텐츠_방귀뀌는며느리.md 에 기록으로 남는다.
    slug: varchar('slug').notNull(),
    title: varchar('title').notNull(),
    summary: text('summary').notNull(),
    difficulty: varchar('difficulty').notNull(),
    topics: text('topics').array(),
    estimated_minutes: smallint('estimated_minutes'),
    // 카드 내용·정답 순서·재구성 핵심 단어. 별도 카드 테이블을 만들지 않는다.
    post_activity_config: jsonb('post_activity_config'),
    status: varchar('status').notNull(),
  },
  (t) => [
    unique('stories_slug_key').on(t.slug),
    check('stories_status_check', sql`${t.status} IN ('draft', 'published', 'archived')`),
  ],
)

// ─────────────────────────────────────────────────────────────
// 4.5 story_characters — 이야기 등장인물  ※ 원문에 없는 테이블 (결정 7)
//
// 🔴 **DB 이름은 `story_characters`, 내보내는 심볼은 `characters` 다** (결정 70).
//    저쪽(팀 레포)은 `characters` 라는 낱말을 이미 **아이 아바타 프리셋** 뜻으로 쓴다
//    (`children.character_id` · `src/lib/characters.ts`). 같은 이름을 다른 뜻으로 넣으면
//    `children.character_id`(varchar, 아바타)와 `story_scenes.character_id`(uuid, 등장인물)가
//    한 스키마에 나란히 앉는다. 이름으로 그 혼동을 막는다.
//    심볼을 그대로 둔 것은 우리 코드 쪽을 한 글자도 안 바꾸기 위해서다.
//
// 캐릭터 LLM 이 "누구로서" 말할지를 담는다. 분석 LLM 은 이 테이블을 절대 보지 않는다
// (docs/기준/대화작동규칙.md:81 — character_name 을 분석 입력에 넣지 않는다).
//
// ── 여기(캐릭터)와 저기(장면)를 가르는 기준 ─────────────────────
//   장면이 바뀌어도 안 변하는 것 → 이 테이블
//   장면마다 달라지는 것        → story_scenes
//
//   「방귀 뀌는 며느리」의 며느리는 대화1(sc_banggui_03)과 대화4(sc_banggui_09) 두 번 나온다.
//   말투는 두 번 다 같지만, 대화1의 며느리는 방귀를 부끄러워하고
//   대화4의 며느리는 그 방귀가 남을 도왔다는 걸 안 뒤다. 입장이 정반대다.
//   그래서 입장(scene_stance)과 걱정(remaining_worries)은 story_scenes 로 내려보냈다.
//
// guidance_style 은 docs/기준/대화작동규칙.md:275 의 guidanceStyle 이다.
// 원문이 "캐릭터별 표현 방식"이라고만 하고 값 형식을 정해 두지 않아 자유 텍스트로 둔다.
// ─────────────────────────────────────────────────────────────
export const characters = pgTable(
  'story_characters',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    story_id: uuid('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    // 콘텐츠 문서가 쓰는 사람이 읽는 식별자. 예: ch_banggui_daughter_in_law
    // (docs/기준/콘텐츠_방귀뀌는며느리.md:196-202)
    code: varchar('code').notNull(),
    name: varchar('name').notNull(),
    // 성격·처지. 이야기 내내 변하지 않는 부분만 적는다.
    persona: text('persona').notNull(),
    speech_style: text('speech_style').notNull(),
    // 부족한 사고 요소를 "어떻게" 드러낼지. 무엇을 드러낼지는 story_scenes.remaining_worries.
    guidance_style: text('guidance_style').notNull(),
    // 이 캐릭터가 하면 안 되는 것. 프롬프트에 그대로 붙는다.
    forbidden: text('forbidden').array().notNull().default([]),
  },
  (t) => [
    unique('story_characters_story_id_code_key').on(t.story_id, t.code),
    index('idx_story_characters_story_id').on(t.story_id),
  ],
)

// ─────────────────────────────────────────────────────────────
// 5. story_scenes — 장면
//
// character_opening / character_closing 은 여기 저장된 고정 텍스트다. 생성하지 않는다.
// (원문 「참고」에 "고정 마지막 대사는 두지 않는다"는 상반된 문장이 한 줄 있으나,
//  같은 문서의 컬럼 표·6번 절·8번 절과 CLAUDE.md 경계 4가 모두 컬럼 유지 쪽이다.)
//
// preferred_turns / max_turns 가 대화작동규칙 문서의 minTurns / maxTurns 다.
// 전역 상수가 아니라 장면마다 다른 값이다.
//
// ── 두 종류의 장면이 한 테이블에 산다 (결정 11) ────────────────
//   대화 장면 5개 중 4개(sc_banggui_03/05/07/09) — 아이가 말한다. 대사·목표·턴이 다 있다
//   전개 장면 5개(sc_banggui_01/02/04/06/08)     — 아이가 말하지 않는다. 그 값들이 전부 없다
//
// 그래서 대화 관련 컬럼의 NOT NULL 을 풀었다. 대신 그냥 풀어 두면
// "대사 없는 대화 장면"이 들어올 수 있으므로 CHECK 로 조건부 필수를 건다.
// 대화 장면인지 아닌지는 character_id 로 가른다.
//
// ── 두 종류가 각자 제 본문을 갖는다 (결정 74) ──────────────────
//   전개 장면 → scene_description  |  대화 장면 → conflict
//
// 시드는 처음부터 그렇게 되어 있었지만 규칙이 아니라 관행이었다. 아래 두 CHECK 가 그것을 조인다.
// ⚠️ 「한쪽만 있어야 한다」까지는 안 막는다 — 둘 다 채운 행도 통과한다.
//    저쪽 레포가 scene_description 을 「모든 장면의 소개문」으로 읽으면 대화 장면에도 값을
//    채워야 한다. 물어볼 자리가 없어졌다 — 저쪽 story_scenes 는 0행이고 저쪽 코드가 이 표를
//    한 줄도 읽지 않는다(2026-08-13 실측). 그래서 **읽는 쪽이 우리뿐**이라 우리 관행이 곧 규칙이다
//    (docs/설계/팀레포_통보서.md · 합의안 4절 질문 6).
//    상호 배타는 우리가 지키는 관행이고, CHECK 가 재는 것은 "제 본문이 비었나"다.
// ─────────────────────────────────────────────────────────────
export const story_scenes = pgTable(
  'story_scenes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    story_id: uuid('story_id')
      .notNull()
      .references(() => stories.id, { onDelete: 'cascade' }),
    // 콘텐츠 문서가 쓰는 사람이 읽는 식별자. sc_banggui_01–09 가 scene_order 1–9 와 그대로 대응한다.
    // 파이썬 판에는 없던 컬럼이다.
    code: varchar('code').notNull(),
    scene_order: smallint('scene_order').notNull(),
    scene_description: text('scene_description'),
    conflict: text('conflict'),
    // 원문 컬럼. 전개 장면은 원문에서 '-' 라 nullable 로 바꿨다.
    character_name: varchar('character_name'),
    // character_id 가 있으면 이 장면은 대화 장면이다. story_characters.name 이 정본이고
    // character_name 은 표시용 사본이다.
    character_id: uuid('character_id').references(() => characters.id),
    // 이 장면에서 캐릭터가 어느 편에 서 있는지.
    // 대화2의 시아버지는 아이와 대립하는 입장이라 며느리와 같은 재료를 주면 안 된다.
    scene_stance: text('scene_stance'),
    // 사고 요소 코드 → 그 요소가 아직 없을 때 캐릭터가 입 밖에 낼 걱정 한 문장.
    //   { "SOLUTION": "그럼 난 어떻게 하면 좋을까…" }
    // docs/기준/대화작동규칙.md:271 의 remainingWorries[guidanceTarget] 이다.
    // 요소 코드(SOLUTION)를 캐릭터 대사로 미리 번역해 두는 표. 이게 없으면 GUIDED 모드가
    // "해결 방법을 말해 줄래?" 같은 교육용 말투로 무너진다(:273 — 교육용 fallback 금지).
    remaining_worries: jsonb('remaining_worries')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    character_opening: text('character_opening'),
    character_closing: text('character_closing'),
    scene_goal: text('scene_goal'),
    // 허용 값: DECISION, REASON, PERSPECTIVE, SOLUTION, RESULT, EMPATHY, REQUEST
    // (EMOTION 은 EMPATHY 로 확정됐다 — docs/설계/스펙확정_연동기준.md F)
    // 배열 원소까지 CHECK 로 막지는 않았다.
    required_elements: text('required_elements').array(),
    // 요소 코드 → 이 장면에서 아이 발화가 그 요소를 충족했다고 볼 기준 문장.
    //   { "SOLUTION": "그림을 어떻게 하면 좋을까?" }
    // 분석 LLM 입력용 기준이며, 관리자 검수용 review_criteria 와는 다르다.
    // 기준이 없는 전개 장면과 기존 시드는 빈 사전으로 둔다.
    element_criteria: jsonb('element_criteria')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    // 목표 달성으로 끝내려면 아이가 최소 몇 번 말해야 하는지. 2026-08-05 확정 (결정 2)
    preferred_turns: smallint('preferred_turns'),
    max_turns: smallint('max_turns'),
  },
  (t) => [
    unique('story_scenes_story_id_scene_order_key').on(t.story_id, t.scene_order),
    unique('story_scenes_story_id_code_key').on(t.story_id, t.code),
    index('idx_story_scenes_character_id').on(t.character_id),

    // 대화 장면이면 대화에 필요한 재료가 전부 있어야 한다.
    // 전개 장면(character_id IS NULL)에는 이 조건을 걸지 않는다.
    // (제약 이름은 ASCII 로 둔다. 한글 식별자는 psql 파이프·드라이버에서 깨지기 쉽다.)
    // ⚠️ conflict 는 늦게 붙었다 (결정 74). 그전에는 여덟 칸만 봐서
    //    「갈등 없는 대화 장면」이 조용히 통과했다 — 분석 LLM 입력의 한 조각이 빈 채로.
    check(
      'dialogue_scene_needs_all_parts',
      sql`${t.character_id} IS NULL
        OR (    ${t.character_name}    IS NOT NULL
            AND ${t.character_opening} IS NOT NULL
            AND ${t.character_closing} IS NOT NULL
            AND ${t.scene_stance}      IS NOT NULL
            AND ${t.scene_goal}        IS NOT NULL
            AND ${t.required_elements} IS NOT NULL
            AND ${t.preferred_turns}   IS NOT NULL
            AND ${t.max_turns}         IS NOT NULL
            AND ${t.conflict}          IS NOT NULL)`,
    ),

    // 전개 장면은 지문이 곧 본문이다 (결정 74).
    // 이걸 안 걸면 story_id·code·scene_order 만 있는 빈 장면이 들어온다 —
    // 위 CHECK 는 전개 장면을 좌변(character_id IS NULL)에서 그냥 통과시키기 때문이다.
    check(
      'narration_scene_needs_description',
      sql`${t.character_id} IS NOT NULL OR ${t.scene_description} IS NOT NULL`,
    ),

    // 최소 턴이 최대 턴보다 크면 목표 달성으로는 영영 못 끝난다.
    check(
      'preferred_turns_not_over_max',
      sql`${t.preferred_turns} IS NULL OR ${t.max_turns} IS NULL OR ${t.preferred_turns} <= ${t.max_turns}`,
    ),
  ],
)

// ─────────────────────────────────────────────────────────────
// 6. story_sessions — 이야기 진행 기록
//
// 진행 모드와 장면 종료는 여기 저장된 상태를 보고 서버 규칙이 정한다. LLM 이 정하지 않는다.
// missing_elements 는 컬럼으로 두지 않는다.
//   missing_elements = story_scenes.required_elements - story_sessions.accumulated_elements
//
// ⚠️ child_id 는 uuid NOT NULL 인데 참조할 표가 여기 없다 — 일부러다.
//    실제 환경에서는 그 자리에 본 제품 children.id 가 들어온다. 우리는 그 값을
//    불투명하게 받아 흘려보낼 뿐 누구인지 모른다. FK 를 걸지 말 것.
// ─────────────────────────────────────────────────────────────
export const story_sessions = pgTable(
  'story_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // children 테이블은 이 레포 범위 밖이라 FK 를 걸 대상이 없다. 값만 들고 있는다.
    child_id: uuid('child_id').notNull(),
    story_id: uuid('story_id')
      .notNull()
      .references(() => stories.id),
    current_scene_id: uuid('current_scene_id').references(() => story_scenes.id),
    current_child_turn_count: smallint('current_child_turn_count').notNull().default(0),
    accumulated_elements: text('accumulated_elements').array().notNull().default([]),
    last_detected_elements: text('last_detected_elements').array().notNull().default([]),
    last_response_mode: varchar('last_response_mode'),
    last_guidance_target: varchar('last_guidance_target'),
    // 신규 요소 없이 이어진 턴 수. 2번 연속이면 유도.
    turns_without_new_element: smallint('turns_without_new_element').notNull().default(0),
    // SHORT/UNCLEAR/OFF_TOPIC 연속 횟수. 2번 연속이면 유도.
    consecutive_low_information_turns: smallint('consecutive_low_information_turns')
      .notNull()
      .default(0),
    scene_goal_met: boolean('scene_goal_met').notNull().default(false),
    scene_end_reason: varchar('scene_end_reason'),
    status: varchar('status').notNull(),
    started_at: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completed_at: timestamp('completed_at', { withTimezone: true }),
    last_activity_at: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'story_sessions_last_response_mode_check',
      sql`${t.last_response_mode} IN ('NORMAL', 'GUIDED', 'CLOSING')`,
    ),
    check(
      'story_sessions_scene_end_reason_check',
      sql`${t.scene_end_reason} IN ('GOAL_MET', 'MAX_TURNS')`,
    ),
    check(
      'story_sessions_status_check',
      sql`${t.status} IN ('in_progress', 'post_activity', 'completed', 'stopped')`,
    ),
    index('idx_story_sessions_child_id').on(t.child_id),
    index('idx_story_sessions_story_id').on(t.story_id),
  ],
)

// ─────────────────────────────────────────────────────────────
// 7. messages — 대화 기록
//
// 캐릭터가 생성한 대사뿐 아니라 고정 첫 대사·마지막 대사도 재생 시점에 여기 저장한다.
// STT 변환에 실패해 확정 텍스트가 없으면 행을 만들지 않는다.
// ─────────────────────────────────────────────────────────────
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    session_id: uuid('session_id')
      .notNull()
      .references(() => story_sessions.id, { onDelete: 'cascade' }),
    scene_id: uuid('scene_id')
      .notNull()
      .references(() => story_scenes.id),
    speaker_type: varchar('speaker_type').notNull(),
    // 세션 전체를 통틀어 몇 번째 발화인지 (장면별이 아니다)
    turn_order: integer('turn_order').notNull(),
    text: text('text').notNull(),
    // 값에는 출처가 붙는다(헌법 원칙 IV). 지금 값은 합성 발화인
    // 'synthetic_adult' 하나뿐이며, 앞으로 값이 늘 수 있어 CHECK 를 걸지 않는다.
    utterance_source: varchar('utterance_source'),
    // 아이 발화에만 저장한다. 원본 음성 파일은 저장하지 않는다.
    stt_raw_text: text('stt_raw_text'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('messages_session_id_turn_order_key').on(t.session_id, t.turn_order),
    check(
      'messages_speaker_type_check',
      sql`${t.speaker_type} IN ('child', 'character', 'system')`,
    ),
    index('idx_messages_scene_id').on(t.scene_id),
  ],
)

// ─────────────────────────────────────────────────────────────
// 8. utterance_analyses — 발화 분석
//
// 아이 메시지만 분석하고, 메시지 한 건당 분석 한 건이다.
// 분석 LLM 은 아래 4개 컬럼만 채운다.
// 응답 모드·장면 목표 충족·종료 이유는 story_sessions 에서 서버 규칙이 확정한다.
// ⛔ 여기에 response_mode / scene_goal_met / scene_end_reason 을 절대 더하지 말 것 (CLAUDE.md 경계 1).
// ─────────────────────────────────────────────────────────────
export const utterance_analyses = pgTable(
  'utterance_analyses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // ⚠️ 이름을 **직접 준다.** 드리즐이 이름 없는 `.unique()` 에 붙이는 `…_unique` 는
    //    포스트그레스 기본 이름(`…_key`)과 다르다. 저쪽 DB 규약이 `…_key` 라, 이름을 안 주면
    //    저쪽에 얹을 때 에러가 아니라 **같은 칸에 유니크 인덱스가 조용히 둘** 생긴다.
    message_id: uuid('message_id')
      .notNull()
      .unique('utterance_analyses_message_id_key')
      .references(() => messages.id, { onDelete: 'cascade' }),
    // 원문 목록: QUESTION, OPINION, REASONING, SOLUTION, DECISION, PERSPECTIVE,
    //            EMOTION, REQUEST, CHALLENGE, PLAYFUL, OFF_TOPIC, SHORT_RESPONSE, UNCLEAR
    // 원문이 "등"으로 열어 두어 닫힌 목록인지 불확실하므로 CHECK 를 걸지 않았다.
    // (스펙확정 E — 값은 13개로 쓰되 DB 제약은 걸지 않는다.)
    child_intent: varchar('child_intent').notNull(),
    main_point: text('main_point'),
    // [{ "type": "REASON", "evidence": "억울하니까" }, ...] — 이번 발화 한 건에서 확인된 것만
    // ⚠️ `evidence` 는 **`null` 일 수 있다.** 분석 LLM 이 근거를 안 준 경우이고,
    //    빈 문자열로 바꾸지 않는다 — 「안 줬다」와 「빈칸이다」가 한 값이 되면
    //    후처리(`evidence` 대조로 요소를 버리는 것)의 판단 근거가 사라진다.
    detected_elements: jsonb('detected_elements')
      .$type<{ type: string; evidence: string | null }[]>()
      .notNull(),
    utterance_validity: varchar('utterance_validity').notNull(),
    // 어느 버전의 분석 프롬프트가 낸 결과인지. 프롬프트를 고쳐 가며 결과를 비교하려면 필요하다.
    // (원문 컬럼 표에는 없고 11번 절 참고에만 언급된 컬럼. 2026-08-05 추가하기로 결정)
    analysis_version: varchar('analysis_version').notNull().default('mvp_v1'),
    // ⚠️ 원문 컬럼 표에도 없고 우리 001 에도 없던 칸인데 **저쪽에는 있다**
    //    (`timestamptz NOT NULL DEFAULT now()`. 2026-08-13 라이브 실측).
    //    기본값이 있어 INSERT 는 안 죽지만, 선언에 없으면 드리즐로 **읽을 수가 없고**
    //    나중에 DDL 을 다시 뽑을 때 조용히 사라진다. 저쪽 모양 그대로 맞춘다.
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'utterance_analyses_utterance_validity_check',
      sql`${t.utterance_validity} IN ('VALID', 'SHORT', 'UNCLEAR', 'OFF_TOPIC', 'PLAYFUL')`,
    ),
  ],
)

// ─────────────────────────────────────────────────────────────
// 9. post_activity_results — 말하기 후 활동 결과
//
// 세션당 최종 결과 한 건만 저장한다. 시도별 과정은 남기지 않는다.
// ─────────────────────────────────────────────────────────────
export const post_activity_results = pgTable('post_activity_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  // 이름을 직접 준다 — 위 `utterance_analyses.message_id` 와 같은 이유다 (`…_unique` 금지).
  session_id: uuid('session_id')
    .notNull()
    .unique('post_activity_results_session_id_key')
    .references(() => story_sessions.id, { onDelete: 'cascade' }),
  submitted_order: text('submitted_order').array(),
  is_order_correct: boolean('is_order_correct'),
  attempt_count: smallint('attempt_count').notNull().default(0),
  retelling_text: text('retelling_text'),
  completed_at: timestamp('completed_at', { withTimezone: true }),
})

// ═════════════════════════════════════════════════════════════
// 관리 도구 전용 (sql/003_admin.sql). 본 제품으로 이식되지 않는다.
//
// 🔴 **원본 11개를 다 옮긴다** (2026-08-13). 그전 판정(`docs/설계/이식목록.md` 1절)은
//    `runs`·`llm_calls` 둘만 옮기고 나머지를 버렸는데, 관리자 화면 넷
//    (시드 편집 · 검수 · 골든셋 · 캐릭터+프롬프트 실험실)이 전부 이 표들을 쓴다.
//    화면을 얹으려면 표가 먼저 서야 하므로 8개를 마저 옮겼다.
//      runs · llm_calls · turn_conditions — 회차 · 호출 · 턴 판정 (먼저 서 있었다)
//      scores · corrections · review_criteria — 검수 화면
//      seed_revisions — 시드 편집 화면
//      experiment_prompts — 프롬프트 실험실
//      goldenset_runs · goldenset_results — 골든셋
//      test_children — 회차를 돌릴 때 고르는 시험용 아이 (합성값)
//
// ⚠️ 파이썬 판에서 003 의 FK 다섯이 001 의 CASCADE 를 무력화했다 —
//    회차가 한 번이라도 돈 세션은 DELETE FROM story_sessions 가 막혔다.
//    의도인지 사고인지 적힌 데가 없어서, 여기서는 ON DELETE CASCADE 를 명시한다.
//    세션을 지우면 그 회차 기록도 같이 사라지는 것이 맞다 (실험 기록이므로).
//    🔴 **8개를 옮길 때도 같은 잣대를 썼다** — 003 의 FK 는 전부 `onDelete: 'cascade'` 다.
//       `review_criteria.scene_id` 도 그렇다: 맨 REFERENCES 로 두면 001 의
//       stories → story_scenes CASCADE 가 같은 방식으로 막힌다.
//
// ── 🔴 이 11표는 `public` 이 아니라 `gq_admin` 에 선다 (결정 5 · 4차) ──
//
// 저쪽(팀 레포 Supabase) DB 에 같이 세우기 때문이다. `public` 에 두면 둘이 걸린다 —
//   1. PostgREST 가 `public` 을 그대로 REST 로 노출한다. 검수·실험 기록이 API 면이 된다.
//   2. 이름이 부딪힐 여지가 있다 (`runs`·`scores` 같은 흔한 낱말이다).
//
// ⚠️ 대신 **RLS 자동 켜짐이 없어진다.** 저쪽 `ensure_rls` 이벤트 트리거는 `public` 만 보므로
//    `gq_admin` 의 새 표에는 걸리지 않는다. 그래서 막는 자리가 옮겨간다 —
//    `anon`·`authenticated` 의 권한을 **명시로 걷는다**. 그 REVOKE 는 `sql/004_저쪽DB_맞춤.sql`
//    ①번 절과 `sql/003_admin.sql` 머리에 있다. 여기(드리즐 선언)에는 권한을 적을 자리가 없다.
//
// ⚠️ 관리 표에서 `public` 표로 가는 FK(`runs.session_id → story_sessions.id` 등)는 그대로 산다.
//    드리즐이 스키마를 넘는 참조를 알아서 찍는다.
// ═════════════════════════════════════════════════════════════
export const gq_admin = pgSchema('gq_admin')

export const runs = gq_admin.table(
  'runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // 이름을 직접 준다 — 위 `utterance_analyses.message_id` 와 같은 이유다 (`…_unique` 금지).
    session_id: uuid('session_id')
      .notNull()
      .unique('runs_session_id_key')
      .references(() => story_sessions.id, { onDelete: 'cascade' }),
    scope: varchar('scope').notNull(),
    scene_order: smallint('scene_order'),
    started_by: varchar('started_by'),
    analysis_model: varchar('analysis_model'),
    analysis_effort: varchar('analysis_effort'),
    character_model: varchar('character_model'),
    character_effort: varchar('character_effort'),
    default_utterance_source: varchar('default_utterance_source').notNull(),
    prompt_version: varchar('prompt_version').notNull(),
    experiment_note: text('experiment_note'),
    scored_at: timestamp('scored_at', { withTimezone: true }),
    started_at: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    ended_at: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    check('runs_scope_check', sql`${t.scope} IN ('scene', 'story')`),
    check(
      'runs_scene_order_check',
      sql`(${t.scope} = 'scene' AND ${t.scene_order} IS NOT NULL)
        OR (${t.scope} = 'story' AND ${t.scene_order} IS NULL)`,
    ),
    // ⚠️ 둘 다 `sql/003_admin.sql:233-234` 에 있는데 이식하며 빠져 있었다 (2026-08-13 되살렸다).
    //    `listRunsWithStory()` 가 `started_at DESC` 로만 정렬하고, 회차 화면 전부가
    //    `session_id` 로 조인한다.
    index('idx_runs_session').on(t.session_id),
    index('idx_runs_started_at').on(t.started_at.desc()),
  ],
)

export const llm_calls = gq_admin.table(
  'llm_calls',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    run_id: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    message_id: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    purpose: varchar('purpose').notNull(),
    attempt_no: smallint('attempt_no').notNull(),
    // 어느 공급자가 실제로 응답했는지. fallback 이 돌았는지 눈으로 봐야 한다 (CLAUDE.md 로그 규칙).
    provider: varchar('provider').notNull(),
    model: varchar('model').notNull(),
    effort: varchar('effort'),
    system_text: text('system_text').notNull(),
    user_text: text('user_text').notNull(),
    response_text: text('response_text'),
    input_tokens: integer('input_tokens'),
    output_tokens: integer('output_tokens'),
    duration_ms: integer('duration_ms').notNull(),
    ok: boolean('ok').notNull(),
    error: text('error'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('llm_calls_purpose_check', sql`${t.purpose} IN ('analysis', 'character')`),
    check('llm_calls_attempt_no_check', sql`${t.attempt_no} >= 1`),
    check('llm_calls_duration_ms_check', sql`${t.duration_ms} >= 0`),
    index('idx_llm_calls_run_id').on(t.run_id),
    index('idx_llm_calls_message_id').on(t.message_id),
  ],
)

// 턴별 상태 스냅샷 (FR-011 · FR-012 · SC-005).
// `story_sessions` 는 매 턴 덮어써서 지난 턴의 모드·누적 요소·카운터를 되살릴 수 없다.
// 그래서 판정 당시의 값을 여기 박제한다 (FR-025 와 같은 원리).
//
// ⚠️ `missing_elements` 는 **여기에도 두지 않는다** (`CLAUDE.md` 경계 5).
//    `required_elements − accumulated_elements` 로 매번 계산한다.
//
// 아래 두 묶음은 `[상태]` 줄과 `[판정]` 줄을 **컬럼 이름·순서까지 그대로** 옮긴 것이다.
// 엔진은 이 표를 모른다. 부르는 쪽(`service/turn.ts`)이 받아 적는다.
//
// ── 원본 `sql/003_admin.sql:115` 에서 갈린 자리 (2026-08-13 · 이슈 #26) ──
//
//  1. ✅ **`seed_revision` 을 되살렸다** (2026-08-13). 잠시 뺐던 이유는 값의 출처인
//     `seed_revisions` 표가 안 옮겨져 **항상 0 인 NOT NULL 컬럼**이 되기 때문이었다.
//     그 표가 섰고 `repo/seed.latestSeedRevision()` 이 값을 주므로 원본대로 돌아왔다.
//     이 칸이 있어야 「도중에 시드를 고친 회차」를 턴 단위로 가려낼 수 있다 (FR-060b).
//
//  2. **FK 를 `cascade` 로 걸었다.** 원본은 맨 `REFERENCES` 라
//     `001` 의 CASCADE 를 무력화하는 쪽이었다 — 회차가 한 번이라도 돈 세션은
//     `DELETE FROM story_sessions` 가 막혔다. 같은 함정을 되풀이하지 않는다.
export const turn_conditions = gq_admin.table(
  'turn_conditions',
  {
    // 한 턴 = 한 아이 메시지. PK 라 **턴당 한 행**이고, 판정을 다시 돌려도 안 늘어난다.
    message_id: uuid('message_id')
      .primaryKey()
      .references(() => messages.id, { onDelete: 'cascade' }),
    run_id: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    // 이 턴이 **어느 판의 시드**를 보고 돌았나 (`seed_revisions` 의 마지막 번호).
    // FK 를 걸지 않는 것은 원본과 같다 — 0(개정이 한 건도 없다)이 유효한 값이기 때문이다.
    seed_revision: bigint('seed_revision', { mode: 'number' }).notNull(),
    // 회차에서 베껴 박제한다. 중복이지만 **박제가 이 표의 목적**이다.
    prompt_version: varchar('prompt_version').notNull(),

    // [상태] 줄 — story_sessions 에 저장된 값 (이번 턴 반영 후)
    current_child_turn_count: integer('current_child_turn_count').notNull(),
    accumulated_elements: text('accumulated_elements').array().notNull(),
    last_response_mode: varchar('last_response_mode'),
    turns_without_new_element: integer('turns_without_new_element').notNull(),
    consecutive_low_information_turns: integer('consecutive_low_information_turns').notNull(),

    // [판정] 줄 — decide() 가 돌려준 Decision
    response_mode: varchar('response_mode').notNull(),
    guidance_target: varchar('guidance_target'),
    soft_cue: boolean('soft_cue').notNull(),
    reaction_key: varchar('reaction_key').notNull(),
    scene_goal_met: boolean('scene_goal_met').notNull(),
    scene_end_reason: varchar('scene_end_reason'),
  },
  (t) => [index('idx_turn_conditions_run').on(t.run_id)],
)

// ─────────────────────────────────────────────────────────────
// scores — 검수 한 칸.
//
// `value` 는 0.0 / 1.0 / 모름(NULL) 셋뿐이다. 「반쯤 맞다」를 못 적게 막은 것이다.
// `target` 이 무엇을 채점했는지 가른다 — 분석 결과(analysis) 인가 캐릭터 대사(utterance) 인가.
// `criteria_version` 은 `review_criteria.version` 을 가리키지만 FK 가 아니다 (원본도 그렇다) —
// 행 id 가 아니라 판 번호이고, 그 판의 기준 행이 요소마다 여럿이기 때문이다.
// ─────────────────────────────────────────────────────────────
export const scores = gq_admin.table(
  'scores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    run_id: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    message_id: uuid('message_id').references(() => messages.id, { onDelete: 'cascade' }),
    llm_call_id: uuid('llm_call_id').references(() => llm_calls.id, { onDelete: 'cascade' }),
    target: varchar('target').notNull(),
    check_name: varchar('check_name').notNull(),
    value: real('value'),
    comment: text('comment'),
    violated_item: varchar('violated_item'),
    graded_by: varchar('graded_by').notNull(),
    criteria_version: integer('criteria_version'),
    // 같은 초 안에 여러 건이 들어와도 순서가 남게 clock_timestamp() 다.
    // (now() 는 트랜잭션이 시작한 시각이라 한 번에 저장한 칸들이 전부 같은 값이 된다.)
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    check('scores_target_check', sql`${t.target} IN ('analysis', 'utterance')`),
    check('scores_value_check', sql`${t.value} IS NULL OR ${t.value} IN (0.0, 1.0)`),
    index('idx_scores_run').on(t.run_id),
    index('idx_scores_message').on(t.message_id),
  ],
)

// ─────────────────────────────────────────────────────────────
// corrections — 검수하는 사람이 고쳐 적은 값.
//
// 점수 한 칸에 딸린다. 「틀렸다」 옆에 「그럼 뭐였어야 하나」를 남기는 자리다.
// `corrected` 의 모양은 `target` 에 따라 다르므로 (분석 결과 조각 / 고친 대사)
// 스키마로 좁히지 않고 jsonb 그대로 둔다.
// ─────────────────────────────────────────────────────────────
export const corrections = gq_admin.table(
  'corrections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    score_id: uuid('score_id')
      .notNull()
      .references(() => scores.id, { onDelete: 'cascade' }),
    target: varchar('target').notNull(),
    corrected: jsonb('corrected').$type<Record<string, unknown>>().notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('corrections_target_check', sql`${t.target} IN ('analysis', 'utterance')`)],
)

// ─────────────────────────────────────────────────────────────
// review_criteria — 장면·요소별 검수 기준.
//
// ⚠️ `story_scenes.element_criteria` 와 **다른 것이다.**
//    저쪽은 분석 LLM 입력에 실리는 기준이고, 이쪽은 사람이 채점할 때 보는 기준이다.
//
// `version` 이 판 번호다. 기준을 고치면 새 판을 쌓고 옛 판을 지우지 않는다 —
// 지난 회차의 점수가 어느 잣대로 매겨졌는지(`scores.criteria_version`)가 남아야 한다.
// `origin` 은 출처 표기다 (헌법 원칙 IV). 2026-08-11 현재 값은 둘뿐이다.
// ─────────────────────────────────────────────────────────────
export const review_criteria = gq_admin.table(
  'review_criteria',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    scene_id: uuid('scene_id')
      .notNull()
      .references(() => story_scenes.id, { onDelete: 'cascade' }),
    element: varchar('element').notNull(),
    criterion: text('criterion').notNull(),
    version: integer('version').notNull(),
    origin: varchar('origin').notNull().default('draft'),
    written_by: varchar('written_by'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('review_criteria_scene_element_version_key').on(t.scene_id, t.element, t.version),
    check('review_criteria_version_check', sql`${t.version} >= 1`),
    check('review_criteria_origin_check', sql`${t.origin} IN ('draft', 'canon')`),
    index('idx_review_criteria_scene').on(t.scene_id, t.element),
  ],
)

// ─────────────────────────────────────────────────────────────
// seed_revisions — 시드 값이 바뀐 이력.
//
// 관리자 페이지에서 콘텐츠를 고칠 때마다 한 행씩 쌓인다. 「고친 다음 호출부터 바로
// 반영된다」(CLAUDE.md)를 뒤집어 말하면 **회차가 어느 판을 보고 돌았는지 알 수 없다**는 뜻이고,
// 그 번호를 여기서 얻는다 (`COALESCE(MAX(id), 0)`).
//
// ✅ **`turn_conditions.seed_revision` 이 이 번호를 박제한다** (2026-08-13 되살렸다).
//    이 표가 안 옮겨져 있던 동안에는 「항상 0 인 NOT NULL 컬럼」이 되는 것을 피해 뺐었다.
//
// `row_id` 에 FK 를 걸지 않는다 — 여러 표(`stories`·`story_scenes`·`characters`…)의 행을
// 한 표에 모아 가리키기 때문이다. 어느 표인지는 `table_name` 이 말한다.
// ─────────────────────────────────────────────────────────────
export const seed_revisions = gq_admin.table(
  'seed_revisions',
  {
    // bigserial — 번호는 DB 가 매긴다. 이 번호 자체가 「몇 번째 판인가」다.
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    table_name: varchar('table_name').notNull(),
    row_id: uuid('row_id'),
    column_name: varchar('column_name'),
    old_value: jsonb('old_value'),
    new_value: jsonb('new_value'),
    origin: varchar('origin').notNull(),
    changed_by: varchar('changed_by'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('seed_revisions_origin_check', sql`${t.origin} IN ('canon', 'draft')`)],
)

// ─────────────────────────────────────────────────────────────
// experiment_prompts — 회차에서만 쓰는 실험용 프롬프트.
//
// ⚠️ **정본은 `prompts/*.md` 다** (CLAUDE.md 경계 6). 여기 있는 것은 실험용이고,
//    확정본은 사람이 파일로 옮긴다. 이 표에서 md 로 돌아가는 화살표는 없다.
//
// PK 가 (run_id, name) 이라 회차당 프롬프트는 종류별 하나뿐이다.
// ─────────────────────────────────────────────────────────────
export const experiment_prompts = gq_admin.table(
  'experiment_prompts',
  {
    run_id: uuid('run_id')
      .notNull()
      .references(() => runs.id, { onDelete: 'cascade' }),
    name: varchar('name').notNull(),
    body: text('body').notNull(),
  },
  (t) => [
    primaryKey({ name: 'experiment_prompts_pkey', columns: [t.run_id, t.name] }),
    check('experiment_prompts_name_check', sql`${t.name} IN ('analysis', 'character')`),
  ],
)

// ─────────────────────────────────────────────────────────────
// goldenset_runs — 골든셋 축1 · 분석 LLM 라벨 측정의 원자료.
//
// 이름표(`file_name`·`prompt_label`)는 사람이 잊거나 덮어쓸 수 있으므로
// 정답지와 프롬프트의 **원문 지문**(`*_digest`)을 함께 박제한다.
// ─────────────────────────────────────────────────────────────
export const goldenset_runs = gq_admin.table(
  'goldenset_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    file_name: varchar('file_name').notNull(),
    file_digest: varchar('file_digest').notNull(),
    file_item_count: smallint('file_item_count').notNull(),
    prompt_digest: varchar('prompt_digest').notNull(),
    prompt_label: varchar('prompt_label'),
    // 설정에서 1순위로 요청한 모델. 실제로 답한 모델은 goldenset_results.got_model 이다.
    requested_model: varchar('requested_model').notNull(),
    started_by: varchar('started_by'),
    note: text('note'),
    // 한 회차 안에서 여러 건이 같은 초에 들어와도 순서가 남게 clock_timestamp() 다.
    started_at: timestamp('started_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    ended_at: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [index('idx_goldenset_runs_started_at').on(t.started_at.desc())],
)

// ─────────────────────────────────────────────────────────────
// goldenset_results — 골든셋 한 문항의 결과.
//
// 정답지(`expected_*`)와 받은 값(`got_*`)을 나란히 둔다.
// `unjudged_reason` 이 채워지면 그 문항은 **판정 못 한 것**이고 `got_*` 셋은 전부 비어 있다.
// 판정 실패와 「틀렸다」를 섞지 않으려는 것이고, CHECK 가 그 짝을 강제한다.
// ⚠️ `got_main_point` 는 그 짝에 안 들어간다 — 판정에 안 쓰는 참고 텍스트라서다.
// ─────────────────────────────────────────────────────────────
export const goldenset_results = gq_admin.table(
  'goldenset_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    goldenset_run_id: uuid('goldenset_run_id')
      .notNull()
      .references(() => goldenset_runs.id, { onDelete: 'cascade' }),
    item_id: varchar('item_id').notNull(),
    item_review: varchar('item_review').notNull(),
    unjudged_reason: text('unjudged_reason'),
    // 호출에 실제로 성공한 모델. 응답을 라벨로 못 바꾼 경우에도 알 수 있다.
    got_model: varchar('got_model'),

    // 정답지 — 사람이 적어 둔 값
    expected_child_intent: varchar('expected_child_intent').notNull(),
    expected_validity: varchar('expected_validity').notNull(),
    expected_elements: text('expected_elements').array().notNull(),

    // 받은 값 — 분석 LLM 이 답한 것
    got_child_intent: varchar('got_child_intent'),
    got_validity: varchar('got_validity'),
    got_elements: text('got_elements').array(),
    got_main_point: text('got_main_point'),

    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (t) => [
    unique('goldenset_results_run_item_key').on(t.goldenset_run_id, t.item_id),
    check(
      'goldenset_results_judgment_check',
      sql`(${t.unjudged_reason} IS NOT NULL
         AND ${t.got_child_intent} IS NULL
         AND ${t.got_validity} IS NULL
         AND ${t.got_elements} IS NULL)
        OR
        (${t.unjudged_reason} IS NULL
         AND ${t.got_child_intent} IS NOT NULL
         AND ${t.got_validity} IS NOT NULL
         AND ${t.got_elements} IS NOT NULL)`,
    ),
    index('idx_goldenset_results_run').on(t.goldenset_run_id),
  ],
)

// ─────────────────────────────────────────────────────────────
// test_children — 시험용 아이 (결정 46)
//
// ⚠️ 이것은 `children` 이 아니다.
//    본 제품의 `children` 은 이 레포 범위 밖이고(CLAUDE.md DB 절 · 헌법 원칙 V ·
//    sql/001_schema.sql:6 · docs/기준/db구조.md:19), 여기 있는 것은 회차를 돌려 보려고
//    우리가 지어낸 시험값이다. 본 제품으로 이식하지 않는다.
//
// ⚠️ 이름을 일부러 `children` 으로 안 지었다 — 나중에 본 제품에 진짜 `children` 이
//    생겨도 안 부딪히게. `parent_id` 도 두지 않는다(두면 `parents` 가 딸려 온다).
//
// ✏️ 이 표의 모든 행은 **합성**이다 (헌법 원칙 IV). 실제 아이 정보가 아니다.
//
// 근거는 docs/기준/db구조.md 2장이되 그대로 베끼지 않았다 —
//   뺀 것 : parent_id (결정 46 — parents 를 안 만든다)
//   더한 것: note   (검수하는 사람이 「왜 이 값인가」를 읽는다)
//
// ⚠️ `story_sessions.child_id` 에 이 표의 id 를 넣지만 **FK 는 걸지 않는다** —
//    001(엔진)이 003(관리 도구)을 참조하면 이식 경계가 뒤집힌다(헌법 원칙 II).
//    실제 환경에서는 그 자리에 본 제품 `children.id` 가 들어온다.
//
// ⚠️ 원본 `sql/003_admin.sql:227` 은 표를 만든 자리에서 네 행을 INSERT 한다.
//    여기서는 그 행을 안 옮겼다 — Drizzle 스키마는 **표의 정의**만 담고
//    값은 `db/seed.ts` 가 넣는 것이 이 레포의 갈래다 (sql/002 도 같은 선으로 갈렸다).
//    ✅ 그 네 명은 `db/seed.ts` 에 들어와 있다 (2026-08-13). 003 의 INSERT 값 그대로다.
// ─────────────────────────────────────────────────────────────
export const test_children = gq_admin.table('test_children', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name').notNull(),
  // docs/기준/db구조.md 2장 — 만 나이 대신 출생연도만 둔다. 연도 기준 연령이다.
  birth_year: smallint('birth_year').notNull(),
  // ✏️ 왜 이 값을 만들었는지. 지어낸 값이므로 근거가 함께 있어야 한다.
  note: text('note'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
