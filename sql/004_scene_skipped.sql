-- 이미 만들어진 DB 에 `scene_end_reason = 'SKIPPED'` 을 허용시킨다 (스킵 API).
--
-- `001_schema.sql` 은 **처음 만들 때**의 정본이라 거기만 고치면 이미 서 있는 DB
-- (팀 Supabase · 로컬 도커 `gq-pg`)는 옛 CHECK 를 그대로 들고 있다. 이 파일은 그 간극만 메운다.
--
-- ## SKIPPED 가 필요한 이유
--
-- 장면을 넘기는 유일한 손잡이가 `scene_end_reason` 이다 (`domain/progress.nextStep()` —
-- 대화 장면인데 이 칸이 차 있으면 다음 장면으로 간다). 아이가 대화 씬을 건너뛰면
-- 서버도 같이 넘어가야 하는데, `GOAL_MET`·`MAX_TURNS` 를 적으면 **기록이 거짓말이 된다** —
-- 목표를 채운 적도 최대 턴에 닿은 적도 없다.
--
-- ## 이 값은 오래 남지 않는다
--
-- 다음 장면에 들어가면 `enterScene()` 이 이 칸을 비운다. 그러니 이것은 「전진을 일으키는
-- 순간용 값」이고, **「이 장면을 건너뛰었다」의 영구 근거는 `messages` 다** — 건너뛴 장면에는
-- 여는 말 한 행만 있고 아이 행이 0개다. (예외: 마지막 대화를 건너뛰면 회차가 닫히면서
-- 이 값이 그대로 남는다 — 그래서 CHECK 를 반드시 고쳐야 한다.)
--
-- 실행:
--   psql "$DATABASE_URL" -f sql/004_scene_skipped.sql

BEGIN;

ALTER TABLE story_sessions
    DROP CONSTRAINT IF EXISTS story_sessions_scene_end_reason_check;

ALTER TABLE story_sessions
    ADD CONSTRAINT story_sessions_scene_end_reason_check
    CHECK (scene_end_reason IN ('GOAL_MET', 'MAX_TURNS', 'SKIPPED'));

COMMIT;
