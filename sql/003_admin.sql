-- 굿퀘스천 관리자 도구 전용 스키마.
-- 이 파일은 본 제품으로 이식되지 않는다.
-- 헌법 원칙 II: 스키마는 sql/*.sql 에만 두고 역할로 가른다
-- (001=엔진, 003=관리 도구).

CREATE TABLE runs (
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

CREATE TABLE llm_calls (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id          uuid        NOT NULL REFERENCES runs (id),
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

CREATE TABLE scores (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id           uuid        NOT NULL REFERENCES runs (id),
    message_id       uuid        REFERENCES messages (id),
    llm_call_id      uuid        REFERENCES llm_calls (id),
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

CREATE TABLE corrections (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    score_id   uuid        NOT NULL REFERENCES scores (id),
    target     varchar     NOT NULL,
    corrected  jsonb       NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT corrections_target_check CHECK (target IN ('analysis', 'utterance'))
);

CREATE TABLE review_criteria (
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

CREATE TABLE seed_revisions (
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
CREATE TABLE turn_conditions (
    message_id     uuid    PRIMARY KEY REFERENCES messages (id),
    run_id         uuid    NOT NULL REFERENCES runs (id),
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

CREATE TABLE experiment_prompts (
    run_id uuid    NOT NULL REFERENCES runs (id),
    name   varchar NOT NULL,
    body   text    NOT NULL,
    CONSTRAINT experiment_prompts_name_check CHECK (name IN ('analysis', 'character')),
    CONSTRAINT experiment_prompts_pkey PRIMARY KEY (run_id, name)
);

-- 골든셋 축1 — 분석 LLM 라벨 측정의 원자료.
-- 이름표는 사람이 잊을 수 있으므로 정답지와 프롬프트의 원문 지문을 함께 박제한다.
CREATE TABLE goldenset_runs (
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

CREATE TABLE goldenset_results (
    id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    goldenset_run_id      uuid        NOT NULL REFERENCES goldenset_runs (id),
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

CREATE TABLE test_children (
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
INSERT INTO test_children (name, birth_year, note) VALUES
    ('민준', 2020, '✏️ 시험용. 만 6세 — 대상 나이의 아래 끝. 받침 있는 이름(준)'),
    ('지우', 2019, '✏️ 시험용. 만 7세. 받침 없는 이름(우)'),
    ('서아', 2018, '✏️ 시험용. 만 8세. 받침 없는 이름(아)'),
    ('하준', 2017, '✏️ 시험용. 만 9세 — 대상 나이의 위 끝. 받침 있는 이름(준)');

CREATE INDEX idx_runs_session          ON runs (session_id);
CREATE INDEX idx_runs_started_at       ON runs (started_at DESC);
CREATE INDEX idx_llm_calls_run         ON llm_calls (run_id);
CREATE INDEX idx_llm_calls_message     ON llm_calls (message_id);
CREATE INDEX idx_scores_run            ON scores (run_id);
CREATE INDEX idx_scores_message        ON scores (message_id);
CREATE INDEX idx_review_criteria_scene ON review_criteria (scene_id, element);
CREATE INDEX idx_turn_conditions_run   ON turn_conditions (run_id);
CREATE INDEX idx_goldenset_results_run ON goldenset_results (goldenset_run_id);
CREATE INDEX idx_goldenset_runs_started_at ON goldenset_runs (started_at DESC);
