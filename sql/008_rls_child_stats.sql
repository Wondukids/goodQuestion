-- 표 셋에 읽기 정책을 붙인다 — `child_words` · `mission_sessions` · `mission_messages`.
--
-- ## 왜 필요한가
--
-- 셋 다 **RLS 는 켜져 있는데 정책이 하나도 없다.** 포스트그레스에서 그 조합은 「아무도 못
-- 읽는다」다. 서버 라우트는 드리즐이 DATABASE_URL 로 직접 붙어(RLS 우회) 멀쩡히 읽어 왔고,
-- 그래서 이 구멍이 지금까지 드러나지 않았다. 앱에서 supabase-js(로그인 세션)로 읽는
-- 자리가 생기자 조용히 0 이 나왔다 — 마이페이지의 「새로 배운 낱말」이 그 자리다.
--
-- 조용한 0 이 가장 나쁘다. 오류가 아니라 「기록이 없네」로 보인다.
--
-- ## 무엇을 여나
--
-- 이미 서 있는 두 표의 결을 그대로 따른다 (`001_schema.sql`):
--
--   story_sessions_own  USING owns_child(child_id)
--   messages_own        USING owns_session(session_id)
--
-- 보호자는 **자기 아이의 것만** 본다. 새로 여는 것도 딱 그만큼이다.
--
--   child_words         아이로 바로 이어진다        → owns_child(child_id)
--   mission_sessions    세션으로 이어진다            → owns_session(session_id)
--   mission_messages    시도를 거쳐 세션으로 이어진다 → EXISTS 로 한 단계 더 탄다
--
-- ⚠️ `FOR SELECT` 만 연다. 쓰기는 지금도 서버(드리즐)만 하고, 앱이 미션 기록을 직접
--    고칠 일은 없다. 읽기만 열어 두면 뚫린 만큼만 뚫린다.
--
-- 실행:
--   psql "$DATABASE_URL" -f sql/008_rls_child_stats.sql

BEGIN;

DROP POLICY IF EXISTS child_words_own ON child_words;
CREATE POLICY child_words_own ON child_words
    FOR SELECT USING (owns_child(child_id));

DROP POLICY IF EXISTS mission_sessions_own ON mission_sessions;
CREATE POLICY mission_sessions_own ON mission_sessions
    FOR SELECT USING (owns_session(session_id));

DROP POLICY IF EXISTS mission_messages_own ON mission_messages;
CREATE POLICY mission_messages_own ON mission_messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1
            FROM mission_sessions ms
            WHERE ms.id = mission_messages.mission_session_id
              AND owns_session(ms.session_id)
        )
    );

COMMIT;
