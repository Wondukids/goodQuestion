-- 굿퀘스천 관리자 도구 전용 스키마.
-- 이 파일은 본 제품으로 이식되지 않는다.
-- 헌법 원칙 II: 스키마는 sql/*.sql 에만 두고 역할로 가른다
-- (001=엔진, 003=관리 도구).
--
-- ⚠️ 파이썬 `src/goodquestion_admin/tables.py` 는 이 파일의 사본이었는데 **이제 낡았다.**
--    아래 11표가 `gq_admin` 으로 옮겨간 것을 따라가지 않는다 — 파이썬은 아카이빙 대상이라
--    (이슈 #26) 같이 고치지 않는다. 지금 이 파일과 짝을 맞추는 사본은 `web/db/schema.ts` 다.

-- ─────────────────────────────────────────────────────────────
-- 표 11개가 앉을 스키마 (결정 5 · 4차)
--
-- `public` 에 두지 않는 이유 둘 — PostgREST 노출과 이름 충돌이 한 번에 없어진다.
-- ⚠️ 대신 저쪽(팀 레포 Supabase) `ensure_rls` 이벤트 트리거는 `public` 만 보므로
--    **RLS 자동 켜짐도 없어진다.** 그래서 권한을 명시로 걷는다.
--
-- `sql/004_저쪽DB_맞춤.sql` ①번 절과 같은 문장이다. 004 는 저쪽 DB 에 한 번 돌리는 맞춤 DDL 이고
-- 이 파일은 우리 DB 의 정의라, 어느 쪽으로 세워도 같은 모양이 되게 양쪽에 둔다.
-- ─────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS gq_admin;

-- `anon`·`authenticated` 는 수파베이스가 만드는 롤이다. 맨 Postgres(우리 DB)에는 없으므로
-- 있을 때만 걷는다 — 없다고 여기서 멈추면 검증을 못 돌린다.
DO $$
DECLARE 롤 text;
BEGIN
    FOREACH 롤 IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 롤) THEN
            EXECUTE format('revoke all on schema gq_admin from %I', 롤);
            EXECUTE format(
                'alter default privileges in schema gq_admin revoke all on tables from %I', 롤);
        END IF;
    END LOOP;
END $$;

CREATE TABLE gq_admin.runs (
    id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id               uuid        NOT NULL UNIQUE REFERENCES story_sessions (id),
    scope                    varchar     NOT NULL,
    scene_order              smallint,
    started_by               varchar,
    analysis_model           varchar,
    analysis_effort          varchar,
    character_model          varchar,
    character_effort         varchar,
    default_utterance_source varchar     NOT NULL,
    prompt_version           varchar     NOT NULL,
    experiment_note          text,
    scored_at                timestamptz,
    started_at               timestamptz NOT NULL DEFAULT now(),
    ended_at                 timestamptz,
    CONSTRAINT runs_scope_check CHECK (scope IN ('scene', 'story')),
    CONSTRAINT runs_scene_order_check CHECK (
        (scope = 'scene' AND scene_order IS NOT NULL)
        OR (scope = 'story' AND scene_order IS NULL)
    )
);

CREATE TABLE gq_admin.llm_calls (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          uuid        NOT NULL REFERENCES gq_admin.runs (id),
    message_id      uuid        REFERENCES messages (id),
    purpose         varchar     NOT NULL,
    attempt_no      smallint    NOT NULL,
    provider        varchar     NOT NULL,
    model           varchar     NOT NULL,
    effort          varchar,
    system_text     text        NOT NULL,
    user_text       text        NOT NULL,
    response_text   text,
    input_tokens    integer,
    output_tokens   integer,
    duration_ms     integer     NOT NULL,
    ok              boolean     NOT NULL,
    error           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT llm_calls_purpose_check CHECK (purpose IN ('analysis', 'character')),
    CONSTRAINT llm_calls_attempt_no_check CHECK (attempt_no >= 1),
    CONSTRAINT llm_calls_duration_ms_check CHECK (duration_ms >= 0)
);

CREATE TABLE gq_admin.scores (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id           uuid        NOT NULL REFERENCES gq_admin.runs (id),
    message_id       uuid        REFERENCES messages (id),
    llm_call_id      uuid        REFERENCES gq_admin.llm_calls (id),
    target           varchar     NOT NULL,
    check_name       varchar     NOT NULL,
    value            real,
    comment          text,
    violated_item    varchar,
    graded_by        varchar     NOT NULL,
    criteria_version integer,
    created_at       timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT scores_target_check CHECK (target IN ('analysis', 'utterance')),
    CONSTRAINT scores_value_check CHECK (value IS NULL OR value IN (0.0, 1.0))
);

CREATE TABLE gq_admin.corrections (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    score_id   uuid        NOT NULL REFERENCES gq_admin.scores (id),
    target     varchar     NOT NULL,
    corrected  jsonb       NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT corrections_target_check CHECK (target IN ('analysis', 'utterance'))
);

CREATE TABLE gq_admin.review_criteria (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    scene_id   uuid        NOT NULL REFERENCES story_scenes (id),
    element    varchar     NOT NULL,
    criterion  text        NOT NULL,
    version    integer     NOT NULL,
    origin     varchar     NOT NULL DEFAULT 'draft',
    written_by varchar,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT review_criteria_version_check CHECK (version >= 1),
    CONSTRAINT review_criteria_origin_check CHECK (origin IN ('draft', 'canon')),
    CONSTRAINT review_criteria_scene_element_version_key UNIQUE (scene_id, element, version)
);

CREATE TABLE gq_admin.seed_revisions (
    id          bigserial   PRIMARY KEY,
    table_name  varchar     NOT NULL,
    row_id      uuid,
    column_name varchar,
    old_value   jsonb,
    new_value   jsonb,
    origin      varchar     NOT NULL,
    changed_by  varchar,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT seed_revisions_origin_check CHECK (origin IN ('canon', 'draft'))
);

-- 턴별 상태 스냅샷 (FR-011 · FR-012 · SC-005).
-- `story_sessions` 는 매 턴 덮어써서 지난 턴의 모드·누적 요소·카운터를 되살릴 수 없다.
-- 그래서 판정 당시의 값을 여기 박제한다 (FR-025 와 같은 원리).
--
-- ⚠️ `missing_elements` 는 **여기에도 두지 않는다** (`CLAUDE.md` 경계 5).
--    `required_elements − accumulated_elements` 로 매번 계산한다.
--
-- 아래 두 묶음은 `runner.턴결과` 의 `저장된_상태`(= `[상태]` 줄) 와
-- `판정`(= `[판정]` 줄) 을 컬럼 이름·순서까지 그대로 옮긴 것이다.
-- 엔진은 이 표를 모른다. 부르는 쪽(`goodquestion_admin`)이 받아 적는다.
CREATE TABLE gq_admin.turn_conditions (
    message_id     uuid    PRIMARY KEY REFERENCES messages (id),
    run_id         uuid    NOT NULL REFERENCES gq_admin.runs (id),
    seed_revision  bigint  NOT NULL,
    prompt_version varchar NOT NULL,

    -- [상태] 줄 — story_sessions 에 저장된 값 (이번 턴 반영 후)
    current_child_turn_count         integer NOT NULL,
    accumulated_elements             text[]  NOT NULL,
    last_response_mode               varchar,
    turns_without_new_element        integer NOT NULL,
    consecutive_low_information_turns integer NOT NULL,

    -- [판정] 줄 — decide() 가 돌려준 Decision
    response_mode    varchar NOT NULL,
    guidance_target  varchar,
    soft_cue         boolean NOT NULL,
    reaction_key     varchar NOT NULL,
    scene_goal_met   boolean NOT NULL,
    scene_end_reason varchar
);

CREATE TABLE gq_admin.experiment_prompts (
    run_id uuid    NOT NULL REFERENCES gq_admin.runs (id),
    name   varchar NOT NULL,
    body   text    NOT NULL,
    CONSTRAINT experiment_prompts_name_check CHECK (name IN ('analysis', 'character')),
    CONSTRAINT experiment_prompts_pkey PRIMARY KEY (run_id, name)
);

-- 골든셋 축1 — 분석 LLM 라벨 측정의 원자료.
-- 이름표는 사람이 잊을 수 있으므로 정답지와 프롬프트의 원문 지문을 함께 박제한다.
CREATE TABLE gq_admin.goldenset_runs (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    file_name       varchar     NOT NULL,
    file_digest     varchar     NOT NULL,
    file_item_count smallint    NOT NULL,
    prompt_digest   varchar     NOT NULL,
    prompt_label    varchar,
    -- 설정에서 1순위로 요청한 모델. 실제로 답한 모델은 goldenset_results.got_model 이다.
    requested_model varchar     NOT NULL,
    started_by      varchar,
    note            text,
    started_at      timestamptz NOT NULL DEFAULT clock_timestamp(),
    ended_at        timestamptz
);

CREATE TABLE gq_admin.goldenset_results (
    id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    goldenset_run_id      uuid        NOT NULL REFERENCES gq_admin.goldenset_runs (id),
    item_id               varchar     NOT NULL,
    item_review           varchar     NOT NULL,
    unjudged_reason       text,
    -- 호출에 실제로 성공한 모델. 응답을 라벨로 못 바꾼 경우에도 알 수 있다.
    got_model             varchar,
    expected_child_intent varchar     NOT NULL,
    expected_validity     varchar     NOT NULL,
    expected_elements     text[]      NOT NULL,
    got_child_intent      varchar,
    got_validity          varchar,
    got_elements          text[],
    got_main_point        text,
    created_at            timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT goldenset_results_run_item_key UNIQUE (goldenset_run_id, item_id),
    CONSTRAINT goldenset_results_judgment_check CHECK (
        (unjudged_reason IS NOT NULL
         AND got_child_intent IS NULL
         AND got_validity IS NULL
         AND got_elements IS NULL)
        OR
        (unjudged_reason IS NULL
         AND got_child_intent IS NOT NULL
         AND got_validity IS NOT NULL
         AND got_elements IS NOT NULL)
    )
);

-- ─────────────────────────────────────────────────────────────
-- 9. test_children — 시험용 아이 (결정 46)
--
-- ⚠️ 이것은 `children` 이 아니다.
--    본 제품의 `children` 은 이 레포 범위 밖이고(CLAUDE.md DB 절 · 헌법 원칙 V ·
--    sql/001_schema.sql:6 · docs/기준/db구조.md:19), 여기 있는 것은 회차를 돌려 보려고
--    우리가 지어낸 시험값이다. 본 제품으로 이식하지 않는다.
--
-- ⚠️ 이름을 일부러 `children` 으로 안 지었다 — 나중에 본 제품에 진짜 `children` 이
--    생겨도 안 부딪히게. `parent_id` 도 두지 않는다(두면 `parents` 가 딸려 온다).
--
-- ✏️ 이 표의 모든 행은 **합성**이다 (헌법 원칙 IV). 실제 아이 정보가 아니다.
--
-- 근거는 docs/기준/db구조.md 2장이되 그대로 베끼지 않았다 —
--   뺀 것 : parent_id (결정 46 — parents 를 안 만든다)
--   더한 것: note   (검수하는 사람이 「왜 이 값인가」를 읽는다)
-- ─────────────────────────────────────────────────────────────

CREATE TABLE gq_admin.test_children (
    id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- story_sessions.child_id 에 이 값을 넣는다. FK 는 걸지 않는다 —
    -- 001(엔진)이 003(관리 도구)을 참조하면 이식 경계가 뒤집힌다(헌법 원칙 II).
    name        varchar     NOT NULL,
    -- docs/기준/db구조.md 2장 — 만 나이 대신 출생연도만 둔다. 연도 기준 연령이다.
    birth_year  smallint    NOT NULL,
    -- ✏️ 왜 이 값을 만들었는지. 지어낸 값이므로 근거가 함께 있어야 한다.
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ✏️ 전부 합성. 대상 나이는 **만 6~9세**다 (인터뷰 Q19 · 🕓 잠정).
--    2026년 기준 연도 연령이므로 birth_year 는 2017~2020 이다.
--    ⭐ 이름을 고른 기준이 하나 더 있다 — **받침 있는 이름과 없는 이름을 섞었다.**
--    Q12(아이 이름 `ㅇㅇ` 치환)의 딸린 질문이 「받침 규칙(`ㅇㅇ아`/`ㅇㅇ이`)」인데
--    아직 미답이다. 답이 오면 두 경우를 다 시험할 수 있게 미리 갈라 두었다.
INSERT INTO gq_admin.test_children (name, birth_year, note) VALUES
    ('민준', 2020, '✏️ 시험용. 만 6세 — 대상 나이의 아래 끝. 받침 있는 이름(준)'),
    ('지우', 2019, '✏️ 시험용. 만 7세. 받침 없는 이름(우)'),
    ('서아', 2018, '✏️ 시험용. 만 8세. 받침 없는 이름(아)'),
    ('하준', 2017, '✏️ 시험용. 만 9세 — 대상 나이의 위 끝. 받침 있는 이름(준)');

-- ⚠️ 인덱스 **이름 자체에는** 스키마를 붙이지 않는다. 이름은 표가 속한 스키마 안에서만 유일하면 된다.
CREATE INDEX idx_runs_session          ON gq_admin.runs (session_id);
CREATE INDEX idx_runs_started_at       ON gq_admin.runs (started_at DESC);
CREATE INDEX idx_llm_calls_run         ON gq_admin.llm_calls (run_id);
CREATE INDEX idx_llm_calls_message     ON gq_admin.llm_calls (message_id);
CREATE INDEX idx_scores_run            ON gq_admin.scores (run_id);
CREATE INDEX idx_scores_message        ON gq_admin.scores (message_id);
CREATE INDEX idx_review_criteria_scene ON gq_admin.review_criteria (scene_id, element);
CREATE INDEX idx_turn_conditions_run   ON gq_admin.turn_conditions (run_id);
CREATE INDEX idx_goldenset_results_run ON gq_admin.goldenset_results (goldenset_run_id);
CREATE INDEX idx_goldenset_runs_started_at ON gq_admin.goldenset_runs (started_at DESC);

-- ─────────────────────────────────────────────────────────────
-- 권한 한 번 더 — 이미 선 표에 대고 직접 걷는다
--
-- 위 `alter default privileges` 는 **앞으로 만들 표**에만 듣는다. 표가 다른 경로로 먼저 서고
-- 나중에 이 파일이 도는 순서(예: 저쪽 DB 에 004 → drizzle 마이그레이션 → 003)에서는
-- 그 문장이 이미 늦었다. 그래서 선 표에 대고 한 번 더 건다.
--
-- ⛔ **RLS 는 켜지 않는다.** 「`ensure_rls` 가 `public` 만 보니 여기서는 명시로 켜자」가
--    4차 인계의 메모였는데, 켜고 정책을 하나도 안 두면 권한 없는 롤이 **에러가 아니라 0행**을
--    받는다. 이 레포에서 가장 비싼 실패는 조용한 실패다 — 저쪽 `story_scenes` 의 INSERT 정책
--    부재가 「이야기에 장면이 없다」는 엉뚱한 말로 죽는 것과 같은 모양이다.
--    REVOKE 는 `permission denied for table runs` 로 **시끄럽게** 죽는다. 그쪽을 고른다.
--    (우리는 `postgres` = `rolbypassrls` 로 붙으므로 어느 쪽이든 우리에겐 차이가 없다.)
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE 롤 text;
BEGIN
    FOREACH 롤 IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 롤) THEN
            EXECUTE format('revoke all on all tables in schema gq_admin from %I', 롤);
            EXECUTE format('revoke all on all sequences in schema gq_admin from %I', 롤);
        END IF;
    END LOOP;
END $$;
