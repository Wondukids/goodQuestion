-- 말하기 후 활동 — 단어 표 하나 + 결과 표에 칸 둘 + 이야기에 카드·단어 (이슈 #42 · 갈래 후-1).
--
-- 정본: docs/말하기후활동_명세.md 4절 — DDL 도 config 값도 그 절 그대로다. 배경·용어는 0~2절.
--
-- ## 네 조각
--
--   post_activity_results  — 칸 둘을 늘린다 (`analyzed_at` · `analysis_version`. 명세 4.2)
--   post_activity_keywords — 새 표. 필수 단어 하나가 한 행이다 (F3 · 명세 4.3)
--   stories.post_activity_config — `fart-bride` 행에 카드 넉 장과 단어 12개를 심는다 (F1 · 4.1)
--   idx_post_activity_keywords_word — 「이 단어는 아이들이 잘 안 쓰나」를 세는 인덱스
--
-- ## ⛔ 미션 1·2 와는 아무 관계가 없다
--
-- `story_missions`·`mission_sessions`·`mission_messages`(sql/005)는 **이야기 도중**에 끼어드는
-- 다른 활동이다. 이름이 다 「미니게임」으로 묶여 보여도 표도 코드도 흐름도 겹치지 않는다
-- (명세 3절). 이 파일은 005 의 어느 표도 건드리지 않는다.
--
-- ## 왜 「안 씀」도 행으로 남기나 (명세 4.3)
--
-- 판정한 단어는 **12개 전부** 행이 생긴다. `missing` 도 남는다 — 「이 아이가 어떤 단어를
-- 놓쳤나」를 SQL 한 줄로 세려면 없는 것에도 행이 있어야 한다. 그래서 `evidence` 는 NULL 을
-- 허용한다 (안 쓴 단어에는 인용할 아이 말이 없다).
--
-- 다시 판정하면 그 `result_id` 의 행을 **모두 지우고 다시 넣는다.** 지우는 쪽은 `ON DELETE
-- CASCADE` 가, 겹쳐 넣는 쪽은 `UNIQUE (result_id, card_id, word)` 가 받친다.
--
-- ## `analyzed_at` 이 NULL 인 것과 「단어를 하나도 안 썼다」는 다른 말이다 (명세 4.2)
--
-- NULL = **판정을 못 했다** (LLM 이 실패했거나 아이가 아직 말을 안 했다). 단어를 하나도 안 쓴
-- 쪽은 `analyzed_at` 이 차 있고 `post_activity_keywords` 12행이 전부 `missing` 이다.
-- 이 둘을 한 값으로 뭉개면 보호자 화면이 「LLM 이 죽은 것」을 「아이가 못한 것」으로 보여 준다.
--
-- ## 🔴 config 값은 시드가 아니라 **여기가 정본이다** (명세 4.1 · 시드 주의)
--
-- `src/llm/db/seed.ts` 는 `stories` 만 `onConflictDoNothing` 이라(2026-08-13 결정 4 · 4차)
-- 이미 선 `fart-bride` 행에는 시드를 다시 돌려도 이 칸이 **안 들어간다.** 그래서 값은 아래
-- `UPDATE` 가 넣고, `seed.ts` 의 이야기 정의에는 **같은 값**을 나란히 둔다 (새 DB 를 처음
-- 세울 때 쓰는 자리다).
--
-- ⛔ 그림 파일·칩 색은 config 에 넣지 않는다. 시안에서 나온 앱 자산이라 앱이 `id` 로 잇는다
--    (`src/stories/fart-bride/minigame/finale-script.ts` 의 `image`·`chip`).
--
-- ## 실행
--
-- 006 처럼 **새 표를 세우는 정본**이면서, 이미 선 DB(로컬 도커 `gq-pg` · 팀 Supabase)에는
-- 그대로 먹이는 마이그레이션이다. `IF NOT EXISTS` 를 써서 **두 번 돌려도 안 터진다.**
--   psql "$DATABASE_URL" -f sql/007_post_activity.sql
--
-- ⚠️ `post_activity_results` 의 두 칸은 **001 에도 적어 넣었다.** 001 은 「처음 만들 때」의
--    정본이라 여기만 고치면 새로 세운 DB 에 칸이 없다 — 006 이 `story_scenes.vocabulary` 를
--    넣을 때와 같은 처리다.

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- post_activity_results — 판정 자취 두 칸 (명세 4.2)
--
-- 이미 서 있던 다섯 칸의 뜻도 여기서 못박는다. 🔴 `is_order_correct` 는
-- **「끝내 맞췄나」**다 (F18) — 「첫 제출이 정답이었나」가 **아니다.** 그건 `attempt_count = 1`
-- 로 안다. 못 맞추고 나갔으면 `false` 다. 이름을 안 바꾼 것은 팀 DB 에 이미 선 칸이라
-- 바꾸면 마이그레이션이 하나 더 들기 때문이다.
--
--   submitted_order  text[]      아이의 **첫 제출** 순서 (틀렸어도 그대로). F7
--   is_order_correct boolean     🔴 끝내 맞췄나. F18
--   attempt_count    smallint    「다 놓았어요!」를 누른 횟수 (통과한 회차 포함)
--   retelling_text   text        서버가 받아쓴 아이 줄거리 원문
--   completed_at     timestamptz 「마치기」를 누른 시각. 중간에 나갔으면 NULL
-- ─────────────────────────────────────────────────────────────

-- 판정을 끝낸 시각. 🔴 NULL 이면 **판정을 못 한 것**이다 (위 머리말)
ALTER TABLE post_activity_results ADD COLUMN IF NOT EXISTS analyzed_at timestamptz;

-- 어느 판 프롬프트가 낸 결과인가. 'retelling_v1' 로 시작한다 (명세 4.2 · 6절).
-- ⚠️ `utterance_analyses.analysis_version` 과 이름은 같지만 다른 프롬프트를 가리킨다.
--    그쪽은 NOT NULL DEFAULT 'mvp_v1' 이고, 여기는 **판정 전에 행이 먼저 생기므로** NULL 이다.
ALTER TABLE post_activity_results ADD COLUMN IF NOT EXISTS analysis_version varchar;

-- ─────────────────────────────────────────────────────────────
-- post_activity_keywords — 필수 단어 하나가 한 행 (F3 · 명세 4.3)
--
-- 「이 아이가 어떤 단어를 놓쳤나」와 「이 단어는 아이들이 잘 안 쓰나」를 SQL 한 줄로 센다.
-- 결과 행 하나에 12행이 달린다 (카드 넉 장 × 단어 셋).
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS post_activity_keywords (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- 다시 판정하면 이 열쇠로 싹 지우고 다시 넣는다 (명세 4.3)
    result_id  uuid        NOT NULL REFERENCES post_activity_results (id) ON DELETE CASCADE,
    -- 어느 카드(장면)의 단어인가. `stories.post_activity_config` 의 `cards[].id` 값이다
    -- ('endure' · 'burst' · 'pear' · 'pride'). 카드 표가 따로 없어 FK 를 걸 대상이 없다
    card_id    varchar     NOT NULL,
    -- 필수 단어 그대로. 같은 카드의 `keywords[]` 에 적힌 글자다
    word       varchar     NOT NULL,
    -- 판정 3단계 (F2) — 'used' 그대로 씀 · 'similar' 비슷한 말로 씀 · 'missing' 안 씀
    status     varchar     NOT NULL CHECK (status IN ('used', 'similar', 'missing')),
    -- 그렇게 본 근거 — 아이 말 **원문에서 떼어 온 조각**이다 (명세 6절 ③).
    -- 🔴 지어낸 문장이면 버린다. `missing` 이면 인용할 말이 없으므로 NULL 이다
    evidence   text,
    -- 'rule' 규칙이 글자로 찾음 · 'llm' 판정 LLM 이 비슷한 말로 봄 (명세 6.1 ①②).
    -- 보호자에게 보여 주는 값이 아니라, 판정이 틀렸을 때 어느 단이 틀렸는지 가르는 값이다
    decided_by varchar     NOT NULL CHECK (decided_by IN ('rule', 'llm')),
    created_at timestamptz NOT NULL DEFAULT now(),

    -- 한 결과에 같은 카드의 같은 단어는 한 번만. 다시 판정할 때 겹쳐 들어오는 것을 막는다
    UNIQUE (result_id, card_id, word)
);

-- 「이 단어는 아이들이 잘 안 쓰나」— 아이를 가로질러 단어 하나를 훑는다 (F3)
CREATE INDEX IF NOT EXISTS idx_post_activity_keywords_word
    ON post_activity_keywords (word);

-- ─────────────────────────────────────────────────────────────
-- stories.post_activity_config — 「방귀 뀌는 며느리」의 카드 넉 장 (F1 · 명세 4.1)
--
-- 값은 화면 상수(`finale-script.ts` 의 `SCENES`·`TRAY_ORDER`)와 **글자까지 같다.** #46 이
-- 화면을 서버 값으로 갈아 끼울 때 한 글자라도 다르면 그때는 아무도 못 찾는다.
--
-- `cards` 의 차례가 곧 정답 순서지만, 읽는 쪽이 헷갈리지 않게 `answer_order` 를 따로 적는다.
-- `tray_order` 는 처음 트레이에 깔리는 (섞인) 순서다 — 정답과 같으면 안 된다.
--
-- ⚠️ 덮어쓴다. 이 칸은 저쪽(팀 레포) `stories` 41행에서 **비어 있던** 칸이라 우리가 채운다
--    (저쪽 값을 지키는 나머지 여섯 칸과 다르다 — 결정 4 · 4차).
-- ─────────────────────────────────────────────────────────────
UPDATE stories
   SET post_activity_config = '{
  "cards": [
    { "id": "endure", "title": "방귀를 참는 며느리",     "keywords": ["시집", "참다", "걱정"] },
    { "id": "burst",  "title": "들켜버린 큰 방귀",       "keywords": ["방귀", "깜짝", "기둥"] },
    { "id": "pear",   "title": "배나무 앞 방귀 대작전",  "keywords": ["배나무", "힘껏", "우수수"] },
    { "id": "pride",  "title": "마을의 자랑이 된 며느리", "keywords": ["당당하다", "칭찬", "고마워"] }
  ],
  "answer_order": ["endure", "burst", "pear", "pride"],
  "tray_order":   ["pear", "pride", "endure", "burst"]
}'::jsonb
 WHERE slug = 'fart-bride';

COMMIT;
