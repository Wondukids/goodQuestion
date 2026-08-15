-- 보호자 리포트 표 2개 + `story_scenes.vocabulary` 한 칸 (이슈 #35 · 갈래 P-1).
--
-- 정본: docs/보호자_리포트_명세.md 6절 — DDL 은 그 절 그대로다. 배경·용어는 같은 문서 0~2절.
--
-- ## 세 조각
--
--   parent_reports          — 활동 한 건에 리포트 한 장 (R1). 숫자와 문장을 나눠 담는다 (R10)
--   child_words             — 아이별 누적 낱말. 「새로 쓴 낱말」을 가리는 잣대다 (R6)
--   story_scenes.vocabulary — 장면마다 적어 두는 어려운 낱말 목록 (R20)
--
-- ## 왜 숫자와 문장을 한 표 안에서 가르나 (R10 · R18)
--
-- `metrics` 는 규칙이 센 것이라 같은 활동이면 몇 번을 돌려도 같은 값이고, `narrative` 는
-- LLM 이 쓴 것이라 돌릴 때마다 달라진다. 갈라 두면 **LLM 이 실패해도 숫자가 담긴 리포트가
-- 남는다** — 그때가 `status = 'metrics_only'` 이고 `narrative` 는 NULL 이다.
--
-- ## ⛔ 저쪽(팀 레포) 표를 쓰지 않는다
--
-- 저쪽에 `reports` 와 `wordbook` 이 **비어 있는 채로 이미 서 있다.** 쓰임이 겹쳐 보여도
-- 쓰지 않는다 — 저쪽 표를 우리 드리즐 선언에 넣으면 `drizzle-kit push` 가 보는 표 목록
-- (`tablesFilter`)에 들어가고, 그 옆에는 **진짜 아이 계정 8행이 든 `children`** 이 선다
-- (`src/llm/db/push-guard.ts` 머리말). 그래서 `wordbook` 대신 `child_words` 를 새로 세운다.
-- 둘을 합칠지는 팀과 따로 정한다 (명세 6.2).
--
-- ## `child_id` 에 FK 가 없는 이유
--
-- `children` 은 저쪽 표라 이 레포에 참조할 대상이 없다. `story_sessions.child_id` 가 이미
-- 같은 이유로 FK 없이 서 있고(001 의 6번 절 머리말), 그 자리를 그대로 따라간다.
--
-- ## 실행
--
-- 005 처럼 **새 표를 세우는 정본**이면서, 이미 선 DB(로컬 도커 `gq-pg` · 팀 Supabase)에는
-- 004 처럼 그대로 먹이는 마이그레이션이다. 그래서 `IF NOT EXISTS` 를 쓴다 — **두 번 돌려도
-- 안 터진다.**
--   psql "$DATABASE_URL" -f sql/006_parent_report.sql
--
-- ⚠️ `story_scenes.vocabulary` 는 **001 에도 적어 넣었다.** 001 은 「처음 만들 때」의 정본이라
--    거기만 고치면 이미 선 DB 가 옛 모양을 들고 있고, 여기만 고치면 새로 세운 DB 에 칸이 없다.
--    004 가 CHECK 를 고칠 때와 같은 처리다.

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- parent_reports — 보호자 리포트 한 장 (R1 · R10)
--
-- 활동(세션)이 `completed` 가 되는 순간 뒤에서 만들어져 여기 남는다 (R2).
-- 「다시 만들기」(R19)는 새 행을 만들지 않고 `session_id` 로 **덮어쓴다** — 그래서 UNIQUE 다.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS parent_reports (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- 활동 하나에 리포트 하나 (R1). 재생성은 이 열쇠로 덮어쓴다
    session_id    uuid        NOT NULL UNIQUE REFERENCES story_sessions (id) ON DELETE CASCADE,
    -- children.id 값. story_sessions.child_id 와 같은 이유로 FK 를 걸지 않는다
    child_id      uuid        NOT NULL,
    status        varchar     NOT NULL CHECK (status IN ('metrics_only', 'complete')),
    -- 규칙이 센 숫자·목록 (명세 4절). 같은 활동이면 몇 번을 돌려도 같은 값이다
    metrics       jsonb       NOT NULL,
    -- LLM 이 쓴 문장 (명세 5절). 🔴 LLM 이 실패하면 NULL 이다 (R18)
    narrative     jsonb,
    -- 어느 모델이 썼나
    model         varchar,
    -- {"report_analysis": "sha256…", "report_guide": "…"}
    -- 골든셋이 쓰는 promptDigest() 와 **같은 함수로** 찍는다 (src/llm/service/goldenset.ts).
    -- 프롬프트를 고친 뒤 어느 리포트가 옛 판인지 이걸로 가른다
    prompt_digest jsonb,
    generated_at  timestamptz NOT NULL DEFAULT now(),
    -- 보호자가 처음 연 시각. NULL 이면 탭 옆에 빨간 점이 뜬다 (명세 3.2)
    read_at       timestamptz,
    -- 다시 만들기를 몇 번 했나. 남용 방지 한도를 API 가 이 값으로 건다 (R19 · 명세 7절)
    regenerated   smallint    NOT NULL DEFAULT 0
);

-- 드롭다운(「지난 활동 목록」)이 아이 하나의 리포트를 최신 순으로 훑는다 — 명세 7절 첫 API
CREATE INDEX IF NOT EXISTS idx_parent_reports_child
    ON parent_reports (child_id, generated_at DESC);

-- ─────────────────────────────────────────────────────────────
-- child_words — 아이별 누적 낱말 (R6)
--
-- 「새로 쓴 낱말 7개」의 잣대다. 이번 활동에서 뽑힌 낱말 중 여기 **없던** 것이 새 낱말이다.
--
-- 🔴 넣는 시점이 중요하다 — 리포트 저장이 성공한 **뒤에** 넣는다 (명세 4.3 · 8절 ⑤).
--    먼저 넣으면 「다시 만들기」를 눌렀을 때 그 낱말들이 이미 있어 새 낱말이 0개가 된다.
--
-- ⚠️ 첫 활동이면 이 표가 비어 있어 쓴 낱말이 전부 새 낱말이 된다. 그래서 화면은 이전 완료
--    활동 수(`metrics.activity.prior_activities`)를 보고 「처음 만난 낱말」로 이름을 바꾼다.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS child_words (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- children.id 값. parent_reports.child_id 와 같은 이유로 FK 를 걸지 않는다
    child_id         uuid        NOT NULL,
    -- 기본형으로 적는다 (「부끄러웠어요」→「부끄럽다」). 쪼개는 일은 LLM 이 한다 (R21)
    word             varchar     NOT NULL,
    -- 장면 낱말 목록(story_scenes.vocabulary)에 있으면 붙는다. 없으면 NULL
    meaning          text,
    -- 세션이 지워져도 낱말은 남는다 — 이 아이가 그 낱말을 썼다는 사실은 그대로이기 때문이다
    first_session_id uuid        REFERENCES story_sessions (id) ON DELETE SET NULL,
    -- 「어느 장면에서 배운 말인가」. story_scenes.code 값이지만 FK 는 걸지 않는다 —
    -- 시드에서 장면이 갈려도 아이가 그 낱말을 쓴 기록은 남아야 한다
    first_scene_code varchar,
    created_at       timestamptz NOT NULL DEFAULT now(),

    -- 같은 아이의 같은 낱말은 한 번만. 두 번째 활동에서 다시 써도 새 낱말이 아니다 (R6)
    UNIQUE (child_id, word)
);

-- ─────────────────────────────────────────────────────────────
-- story_scenes.vocabulary — 장면마다의 어려운 낱말 목록 (R20)
--
--   [{ "word": "며느리", "meaning": "아들의 아내" }, { "word": "배나무", "meaning": "배가 열리는 나무" }]
--
-- 두 곳에서 쓴다.
--   ① 「질문한 낱말」 — 아이의 QUESTION 발화 원문에 이 목록의 낱말이 있으면 센다.
--      LLM 을 거치지 않는다 (R15 · 명세 4.3 4번)
--   ② 「새로 쓴 낱말」의 **뜻** — child_words.meaning 이 여기서 온다
--
-- 장면마다 나눠 적는 이유는 「어느 장면에서 배운 말인가」가 남아 `child_words.first_scene_code`
-- 와 이어지기 때문이다. 값은 `src/llm/db/seed.ts` 가 장면 정의 옆에서 넣는다.
-- ─────────────────────────────────────────────────────────────
ALTER TABLE story_scenes ADD COLUMN IF NOT EXISTS vocabulary jsonb NOT NULL DEFAULT '[]';

COMMIT;
