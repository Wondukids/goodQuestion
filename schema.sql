-- =============================================================================
--  아동 말하기 연습 AI 서비스 — Supabase(Postgres) 스키마
--  출처: Notion "DB 구조_260803_수정안"
--  생성 순서: 부모 테이블 → 자식 테이블 (FK 의존성 순)
--  규칙:
--    - PK/FK는 uuid, 기본값 gen_random_uuid() (parents.id 제외: auth.users.id 사용)
--    - enum 성격의 varchar 컬럼은 CHECK 제약으로 허용값 고정
--    - 1:1 관계는 UNIQUE 제약으로 강제
--    - 모든 FK에 인덱스 생성
-- =============================================================================

-- gen_random_uuid() 사용을 위해 (Supabase는 기본 활성화되어 있음)
create extension if not exists pgcrypto;

-- =============================================================================
--  MVP 필수 테이블
-- =============================================================================

-- 1. parents — 보호자 계정 -----------------------------------------------------
-- parents.id 는 Supabase Auth의 auth.users.id 와 동일하게 사용한다.
-- 이메일/비밀번호/인증은 Supabase Auth가 관리하며 별도 auth_user_id는 두지 않는다.
create table parents (
    id          uuid primary key references auth.users (id) on delete cascade,
    name        varchar(100) not null,
    created_at  timestamptz  not null default now()
);

-- 2. children — 아이 정보 ------------------------------------------------------
create table children (
    id           uuid primary key default gen_random_uuid(),
    parent_id    uuid        not null references parents (id) on delete cascade,
    name         varchar(100) not null,
    birth_year   smallint    not null check (birth_year between 2000 and 2100),
    -- 온보딩에서 고른 프리셋 캐릭터. 값은 src/lib/characters.ts 의 CHARACTERS 와 일치해야 한다.
    character_id varchar(20) not null default 'rabbit'
        check (character_id in ('rabbit', 'lion', 'fox', 'bear', 'dog', 'tiger')),
    created_at   timestamptz not null default now()
);
create index idx_children_parent_id on children (parent_id);

-- 3. child_consents — 아동 개인정보 처리 동의 ---------------------------------
create table child_consents (
    id                  uuid primary key default gen_random_uuid(),
    child_id            uuid        not null references children (id) on delete cascade,
    consent_version     varchar(50) not null,
    verification_method varchar(50) not null
        check (verification_method in ('authenticated_parent', 'institution_paper', 'mobile_verification')),
    consented_at        timestamptz not null default now(),
    withdrawn_at        timestamptz
);
create index idx_child_consents_child_id on child_consents (child_id);
-- 활성 동의 조회(철회되지 않은 동의)를 빠르게 하기 위한 부분 인덱스
create index idx_child_consents_active on child_consents (child_id) where withdrawn_at is null;

-- 4. stories — 이야기 ----------------------------------------------------------
create table stories (
    id                   uuid primary key default gen_random_uuid(),
    title                varchar(200) not null,
    summary              text         not null,
    difficulty           varchar(30)  not null,
    topics               text[],
    estimated_minutes    smallint,
    post_activity_config jsonb,
    status               varchar(20)  not null default 'draft'
        check (status in ('draft', 'published', 'archived')),
    created_at           timestamptz  not null default now()
);
-- 공개된 이야기 목록 조회 최적화
create index idx_stories_status on stories (status);

-- 5. story_scenes — 장면 -------------------------------------------------------
create table story_scenes (
    id                 uuid primary key default gen_random_uuid(),
    story_id           uuid        not null references stories (id) on delete cascade,
    scene_order        smallint    not null,
    scene_description  text        not null,
    conflict           text        not null,
    character_name     varchar(100) not null,
    character_opening  text        not null,
    character_closing  text        not null,
    scene_goal         text        not null,
    required_elements  text[]      not null,
    preferred_turns    smallint    not null check (preferred_turns > 0),
    max_turns          smallint    not null check (max_turns >= preferred_turns),
    -- 한 이야기 안에서 장면 순서는 유일해야 한다
    unique (story_id, scene_order)
);
create index idx_story_scenes_story_id on story_scenes (story_id);

-- 6. story_sessions — 이야기 진행 기록 ----------------------------------------
create table story_sessions (
    id                                uuid primary key default gen_random_uuid(),
    child_id                          uuid        not null references children (id) on delete cascade,
    story_id                          uuid        not null references stories (id),
    current_scene_id                  uuid        references story_scenes (id),
    current_child_turn_count          smallint    not null default 0,
    accumulated_elements              text[]      not null default '{}',
    last_detected_elements            text[]      not null default '{}',
    last_response_mode                varchar(20)
        check (last_response_mode in ('NORMAL', 'GUIDED', 'CLOSING')),
    last_guidance_target              varchar(30),
    turns_without_new_element         smallint    not null default 0,
    consecutive_low_information_turns smallint    not null default 0,
    scene_goal_met                    boolean     not null default false,
    scene_end_reason                  varchar(20)
        check (scene_end_reason in ('GOAL_MET', 'MAX_TURNS')),
    status                            varchar(20) not null default 'in_progress'
        check (status in ('in_progress', 'post_activity', 'completed', 'stopped')),
    started_at                        timestamptz not null default now(),
    completed_at                      timestamptz,
    last_activity_at                  timestamptz not null default now()
);
create index idx_story_sessions_child_id on story_sessions (child_id);
create index idx_story_sessions_story_id on story_sessions (story_id);
create index idx_story_sessions_current_scene_id on story_sessions (current_scene_id);
-- 아이별 진행 중 세션 / 이어하기 조회
create index idx_story_sessions_child_status on story_sessions (child_id, status);

-- 7. messages — 대화 기록 ------------------------------------------------------
create table messages (
    id           uuid primary key default gen_random_uuid(),
    session_id   uuid        not null references story_sessions (id) on delete cascade,
    scene_id     uuid        not null references story_scenes (id),
    speaker_type varchar(20) not null
        check (speaker_type in ('child', 'character', 'system')),
    turn_order   integer     not null,
    text         text        not null,
    stt_raw_text text,
    created_at   timestamptz not null default now(),
    -- 세션 내 발화 순서는 유일
    unique (session_id, turn_order)
);
create index idx_messages_session_id on messages (session_id);
create index idx_messages_scene_id on messages (scene_id);

-- 8. utterance_analyses — 발화 분석 (아이 메시지 1건당 1건) --------------------
create table utterance_analyses (
    id                 uuid primary key default gen_random_uuid(),
    -- message_id UNIQUE → messages 1 : 1 utterance_analyses
    message_id         uuid        not null unique references messages (id) on delete cascade,
    child_intent       varchar(30) not null,
    main_point         text,
    detected_elements  jsonb       not null default '[]',
    utterance_validity varchar(20) not null
        check (utterance_validity in ('VALID', 'SHORT', 'UNCLEAR', 'OFF_TOPIC', 'PLAYFUL')),
    -- 분석 버전 문자열(MVP에서는 별도 테이블 대신 이 컬럼에 'mvp_v1' 등 저장)
    analysis_version   varchar(50),
    created_at         timestamptz not null default now()
);

-- 9. post_activity_results — 말하기 후 활동 결과 (세션당 1건) ------------------
create table post_activity_results (
    id              uuid primary key default gen_random_uuid(),
    -- session_id UNIQUE → story_sessions 1 : 1 post_activity_results
    session_id      uuid        not null unique references story_sessions (id) on delete cascade,
    submitted_order text[],
    is_order_correct boolean,
    attempt_count   smallint    not null default 0,
    retelling_text  text,
    completed_at    timestamptz
);

-- =============================================================================
--  추후 확장 테이블 (현재 MVP 구현 필수 아님)
-- =============================================================================

-- 10. reports — 보호자 리포트 --------------------------------------------------
create table reports (
    id          uuid primary key default gen_random_uuid(),
    session_id  uuid not null references story_sessions (id) on delete cascade,
    summary     text,
    strengths   jsonb,
    next_focus  jsonb,
    created_at  timestamptz not null default now()
);
create index idx_reports_session_id on reports (session_id);

-- 11. analysis_versions — 분석 버전 관리 --------------------------------------
create table analysis_versions (
    id             uuid primary key default gen_random_uuid(),
    version_name   varchar(50) not null,
    model_name     varchar(100),
    prompt_summary text
);

-- 12. wordbook — 단어장 --------------------------------------------------------
create table wordbook (
    id              uuid primary key default gen_random_uuid(),
    child_id        uuid not null references children (id) on delete cascade,
    word            varchar(100) not null,
    meaning         text,
    source_scene_id uuid references story_scenes (id),
    created_at      timestamptz not null default now()
);
create index idx_wordbook_child_id on wordbook (child_id);

-- 13. child_recommendations — 홈 추천 캐시 (LLM 큐레이션 결과) -----------------
create table child_recommendations (
    id           uuid primary key default gen_random_uuid(),
    child_id     uuid not null references children (id) on delete cascade,
    story_id     uuid not null references stories (id) on delete cascade,
    reason       text not null,
    rank         smallint not null,
    generated_at timestamptz not null default now(),
    unique (child_id, rank)
);
create index idx_child_recommendations_child on child_recommendations (child_id);
