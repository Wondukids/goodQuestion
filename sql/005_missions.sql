-- 미션(미니게임) 표 3개 + `gq_admin.llm_calls.purpose` 확장 (이슈 #17).
--
-- 정본: docs/미션_명세.md 6절 — DDL 은 그 절 그대로다. 배경·용어는 같은 문서 0~2절.
--
-- ## 왜 미션 대화는 `messages` 밖인가 (확정 결정 M5)
--
-- 미완 턴 판정 `pendingTurn()` 은 「마지막 아이 발화의 바로 다음 한 행」을 본다.
-- 미션 대화가 `messages` 에 섞이면 그 규칙이 깨지므로 `mission_messages` 에 따로 쌓고,
-- 본 대화에는 종료 요약 캐릭터 행 **1개만** 들어간다.
--
-- ## 세 층
--
--   story_missions   — 정의(콘텐츠 상수). 씬당 1개
--   mission_sessions — 한 플레이에서 미션 1회 시도
--   mission_messages — 미션 안 대화. 아이 행에는 분석 jsonb 사본이 붙는다
--
-- ## 실행
--
-- 001·003 처럼 처음 세울 때의 정본이면서, 이미 선 DB(로컬 도커 `gq-pg`)에는
-- 004 처럼 그대로 돌리는 마이그레이션이다:
--   psql "$DATABASE_URL" -f sql/005_missions.sql

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- story_missions — 미션 정의
--
-- 대화 씬에 끼어드는 미니게임 1종이 한 행이다. 값은 db/seed.ts 가 넣는다
-- (`ms_banggui_pear` · `ms_banggui_friend` 2행). 미션 없는 씬(대화1·2)은 행이 없어
-- 미션 명세의 어떤 경로도 타지 않는다.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE story_missions (
    id            uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id      uuid    NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
    scene_id      uuid    NOT NULL REFERENCES story_scenes (id),
    -- 콘텐츠 문서가 쓰는 사람이 읽는 식별자. 'ms_banggui_pear' / 'ms_banggui_friend'
    code          varchar NOT NULL,
    title         varchar NOT NULL,
    mission_type  varchar NOT NULL CHECK (mission_type IN ('prop_choice', 'card_help')),
    -- LLM 재료용 미션 목적 한 문장
    mission_goal  text    NOT NULL,
    -- 트리거·소품/카드·스텝·고정 대사. **모양의 정본은 docs/미션_명세.md 6절 config 예시다** —
    -- 여기 임의 키를 더하지 말 것 (#18 도메인·#20 프론트가 같은 모양을 본다).
    config        jsonb   NOT NULL,

    UNIQUE (story_id, code),
    UNIQUE (scene_id)                        -- 씬당 미션 1개 (MVP)
);

-- ─────────────────────────────────────────────────────────────
-- mission_sessions — 미션 시도
--
-- 한 플레이에서 미션 1회 시도가 한 행이다. 도중 이탈하면 `abandoned` 로 남고
-- 복귀 시 **새 행으로 처음부터** 한다 (확정 결정 M4 — 미션 턴의 이어 돌리기는 없다).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE mission_sessions (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id    uuid        NOT NULL REFERENCES story_sessions (id) ON DELETE CASCADE,
    mission_id    uuid        NOT NULL REFERENCES story_missions (id),
    status        varchar     NOT NULL DEFAULT 'in_progress'
        CHECK (status IN ('in_progress', 'completed', 'abandoned')),
    current_step  varchar,                   -- 관찰용. 재개엔 쓰지 않는다 (M4)
    selections    jsonb       NOT NULL DEFAULT '[]', -- [{step, kind, value, at}]
    summary_text  text,                      -- 종료 요약 (LLM 결과 원문)
    started_at    timestamptz NOT NULL DEFAULT now(),
    completed_at  timestamptz
);

-- 같은 미션의 진행 중 시도는 세션당 1개
CREATE UNIQUE INDEX ux_mission_sessions_active
    ON mission_sessions (session_id, mission_id) WHERE status = 'in_progress';

-- ─────────────────────────────────────────────────────────────
-- mission_messages — 미션 안 대화
--
-- 아이 발화·캐릭터 대사·system(무음 건너뜀)이 미션 순번대로 쌓인다.
-- 분석은 `utterance_analyses` 로 가지 않고 아이 행 안에 jsonb 사본으로 남는다
-- (관리자 채점 연동은 비스코프 — 명세 13절).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE mission_messages (
    id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    mission_session_id  uuid        NOT NULL REFERENCES mission_sessions (id) ON DELETE CASCADE,
    turn_order          integer     NOT NULL,    -- 미션 안 순번
    speaker_type        varchar     NOT NULL
        CHECK (speaker_type IN ('child', 'character', 'system')),
    step                varchar,                 -- 'use' | 'request' | 친구 id …
    text                text        NOT NULL,
    stt_raw_text        text,
    -- 아이 행만. utterance_analyses 와 같은 모양의 사본
    analysis            jsonb,
    line_source         varchar     CHECK (line_source IN ('fixed', 'generated', 'summary')),
    created_at          timestamptz NOT NULL DEFAULT now(),

    UNIQUE (mission_session_id, turn_order)
);

-- ─────────────────────────────────────────────────────────────
-- 미션 LLM 호출이 기록에 남도록 purpose 확장
--
-- 제약 이름은 실물 DB 에서 확인했다 (2026-08-14 로컬 gq-pg — `llm_calls_purpose_check`.
-- `sql/003_admin.sql` 이 이름 붙여 건 그대로다).
-- ─────────────────────────────────────────────────────────────
ALTER TABLE gq_admin.llm_calls DROP CONSTRAINT llm_calls_purpose_check;
ALTER TABLE gq_admin.llm_calls ADD CONSTRAINT llm_calls_purpose_check
    CHECK (purpose IN ('analysis', 'character', 'mission_reply', 'mission_summary'));

COMMIT;
