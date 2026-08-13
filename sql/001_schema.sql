-- 굿퀘스천 MVP 스키마 (Postgres 16)
--
-- 근거 문서: docs/기준/db구조.md (원본 PDF 전사본). 이 파일은 그 문서를 SQL 로 옮긴 것이다.
--
-- ── 이 레포에서 만들지 않는 테이블 ───────────────────────────────
--   parents / children / child_consents : 인증·계정 영역이라 범위 밖
--   reports / analysis_versions / wordbook : 원문이 "추후 확장"으로 분류
--
-- ── 원문에 없어서 이 파일에서 보탠 것 (전부 여기 적는다) ──────────
--   원본 문서에는 PK/FK/NOT NULL/UNIQUE/DEFAULT/CHECK/인덱스 표기가 전혀 없다.
--   제약은 (a) 컬럼 표의 `필수 Y/선택`, (b) 구조도의 (PK)/(FK) 표기에서만 왔다.
--   그 위에 아래를 보탰다.
--     1. PRIMARY KEY / REFERENCES  ← 구조도의 (PK)/(FK) 표기를 SQL 로 옮긴 것
--     2. NOT NULL                  ← 컬럼 표의 `필수 = Y`
--     3. CHECK (... IN ...)        ← 원문이 값을 "빠짐없이" 나열한 열거형에만.
--                                     child_intent 는 원문 목록이 "등"으로 열려 있어 CHECK 를 걸지 않았다.
--     4. UNIQUE                    ← 구조도가 1:0..1 로 표기한 관계
--     5. DEFAULT                   ← 카운터·타임스탬프처럼 값이 없으면 못 쓰는 컬럼
--     6. ON DELETE CASCADE         ← 부모가 사라지면 남아 있을 이유가 없는 자식 행
--     7. 인덱스                     ← 외래키 조회용
--   위 7개는 원문에 근거가 없는 판단이다. 원본 작성자와 다르게 정했다면 여기부터 고치면 된다.
--
-- ── 원문에 없는 테이블을 하나 보탰다 ─────────────────────────────
--   characters : 캐릭터 LLM 이 "누구로서" 말할지를 담는다. 아래 4.5 절 참고.
--   DB 문서에는 이 테이블이 없고 story_scenes.character_name (varchar) 한 칸이 전부인데,
--   MVP 요건(docs/조사/굿퀘스천_엑셀.md:99)이 "캐릭터의 성격과 입장을 유지한 추가 질문"을 요구하고
--   대화작동규칙이 guidanceStyle 을 "캐릭터별 표현 방식"이라 부르므로(:275) 담을 곳이 필요하다.
--   2026-08-05 결정 7 (docs/결정/결정기록.md).

-- ─────────────────────────────────────────────────────────────
-- 4. stories — 이야기
-- ─────────────────────────────────────────────────────────────
CREATE TABLE stories (
    id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    title                varchar     NOT NULL,
    summary              text        NOT NULL,
    difficulty           varchar     NOT NULL,
    topics               text[],
    estimated_minutes    smallint,
    -- 카드 내용·정답 순서·재구성 핵심 단어. 별도 카드 테이블을 만들지 않는다.
    post_activity_config jsonb,
    status               varchar     NOT NULL
        CHECK (status IN ('draft', 'published', 'archived'))
);

-- ─────────────────────────────────────────────────────────────
-- 4.5 characters — 캐릭터  ※ 원문에 없는 테이블 (결정 7)
--
-- 캐릭터 LLM 이 "누구로서" 말할지를 담는다. 분석 LLM 은 이 테이블을 절대 보지 않는다
-- (docs/기준/대화작동규칙.md:81 — character_name 을 분석 입력에 넣지 않는다).
--
-- ── 여기(캐릭터)와 저기(장면)를 가르는 기준 ─────────────────────
--   장면이 바뀌어도 안 변하는 것 → 이 테이블
--   장면마다 달라지는 것        → story_scenes
--
--   「방귀 뀌는 며느리」의 며느리는 대화1(sc_banggui_03)과 대화4(sc_banggui_09) 두 번 나온다.
--   말투는 두 번 다 같지만, 대화1의 며느리는 방귀를 부끄러워하고
--   대화4의 며느리는 그 방귀가 남을 도왔다는 걸 안 뒤다. 입장이 정반대다.
--   그래서 입장(scene_stance)과 걱정(remaining_worries)은 story_scenes 로 내려보냈다.
--
-- ── 한 행의 모양 (며느리 예시 — 아직 데이터로 넣지 않았다) ────────
--   code           : ch_banggui_daughter_in_law
--   name           : 방귀쟁이 며느리
--   persona        : 시집온 지 얼마 안 된 며느리. 시댁 식구들에게 잘 보이고 싶어 한다.
--   speech_style   : 옛이야기 말투. 아이에게 존댓말을 쓰지 않고 또래처럼 편하게 말한다.
--   guidance_style : 아이를 가르치듯 묻지 않고, 자기 걱정을 소리 내어 말하는 방식으로 드러낸다.
--   forbidden      : {아이 대신 해결책을 말하기, 장면을 스스로 끝내기, 뒷이야기 미리 말하기}
--
-- guidance_style 은 docs/기준/대화작동규칙.md:275 의 guidanceStyle 이다.
-- 원문이 "캐릭터별 표현 방식"이라고만 하고 값 형식을 정해 두지 않아 자유 텍스트로 둔다.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE characters (
    id             uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id       uuid    NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
    -- 콘텐츠 문서가 쓰는 사람이 읽는 식별자. 예: ch_banggui_daughter_in_law
    -- (docs/기준/콘텐츠_방귀뀌는며느리.md:196-202)
    code           varchar NOT NULL,
    name           varchar NOT NULL,
    -- 성격·처지. 이야기 내내 변하지 않는 부분만 적는다.
    persona        text    NOT NULL,
    speech_style   text    NOT NULL,
    -- 부족한 사고 요소를 "어떻게" 드러낼지. 무엇을 드러낼지는 story_scenes.remaining_worries.
    guidance_style text    NOT NULL,
    -- 이 캐릭터가 하면 안 되는 것. 프롬프트에 그대로 붙는다.
    forbidden      text[]  NOT NULL DEFAULT '{}',

    UNIQUE (story_id, code)
);

-- ─────────────────────────────────────────────────────────────
-- 5. story_scenes — 장면
--
-- character_opening / character_closing 은 여기 저장된 고정 텍스트다. 생성하지 않는다.
-- (원문 「참고」에 "고정 마지막 대사는 두지 않는다"는 상반된 문장이 한 줄 있으나,
--  같은 문서의 컬럼 표·6번 절·8번 절과 CLAUDE.md 경계 4가 모두 컬럼 유지 쪽이다.)
--
-- preferred_turns / max_turns 가 대화작동규칙 문서의 minTurns / maxTurns 다.
-- 전역 상수가 아니라 장면마다 다른 값이다.
-- ─────────────────────────────────────────────────────────────
-- ── 두 종류의 장면이 한 테이블에 산다 (결정 11) ────────────────
--   대화 장면 5개 중 4개(sc_banggui_03/05/07/09) — 아이가 말한다. 대사·목표·턴이 다 있다
--   전개 장면 5개(sc_banggui_01/02/04/06/08)     — 아이가 말하지 않는다. 그 값들이 전부 없다
--
-- 그래서 대화 관련 컬럼의 NOT NULL 을 풀었다. 대신 그냥 풀어 두면
-- "대사 없는 대화 장면"이 들어올 수 있으므로 CHECK 로 조건부 필수를 건다.
-- 대화 장면인지 아닌지는 character_id 로 가른다.
--
-- ── 두 종류가 각자 제 본문을 갖는다 (결정 74) ──────────────────
--   전개 장면 → scene_description  |  대화 장면 → conflict
--
-- 시드는 처음부터 그렇게 되어 있었지만 규칙이 아니라 관행이었다. 아래 두 CHECK 가 그것을 조인다.
-- ⚠️ 「한쪽만 있어야 한다」까지는 안 막는다 — 둘 다 채운 행도 통과한다.
--    저쪽 레포가 scene_description 을 「모든 장면의 소개문」으로 읽으면 대화 장면에도 값을
--    채워야 하고, 그 답이 아직 안 왔다 (docs/설계/팀레포_요청서.md 2-1 · 합의안 4절 질문 6).
--    상호 배타는 우리가 지키는 관행이고, CHECK 가 재는 것은 "제 본문이 비었나"다.
CREATE TABLE story_scenes (
    id                uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
    story_id          uuid     NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
    scene_order       smallint NOT NULL,
    scene_description text,
    conflict          text,
    -- 원문 컬럼. 전개 장면은 원문에서 '-' 라 nullable 로 바꿨다.
    character_name    varchar,
    -- character_id 가 있으면 이 장면은 대화 장면이다. characters.name 이 정본이고
    -- character_name 은 표시용 사본이다.
    character_id      uuid     REFERENCES characters (id),
    -- 이 장면에서 캐릭터가 어느 편에 서 있는지.
    -- 대화2의 시아버지는 아이와 대립하는 입장이라 며느리와 같은 재료를 주면 안 된다.
    scene_stance      text,
    -- 사고 요소 코드 → 그 요소가 아직 없을 때 캐릭터가 입 밖에 낼 걱정 한 문장.
    --   { "SOLUTION": "그럼 난 어떻게 하면 좋을까…" }
    -- docs/기준/대화작동규칙.md:271 의 remainingWorries[guidanceTarget] 이다.
    -- 요소 코드(SOLUTION)를 캐릭터 대사로 미리 번역해 두는 표. 이게 없으면 GUIDED 모드가
    -- "해결 방법을 말해 줄래?" 같은 교육용 말투로 무너진다(:273 — 교육용 fallback 금지).
    remaining_worries jsonb    NOT NULL DEFAULT '{}',
    character_opening text,
    character_closing text,
    scene_goal        text,
    -- 허용 값: DECISION, REASON, PERSPECTIVE, SOLUTION, RESULT, EMOTION, EMPATHY, REQUEST
    -- 배열 원소까지 CHECK 로 막지는 않았다.
    required_elements text[],
    -- 요소 코드 → 이 장면에서 아이 발화가 그 요소를 충족했다고 볼 기준 문장.
    --   { "SOLUTION": "그림을 어떻게 하면 좋을까?" }
    -- 분석 LLM 입력용 기준이며, 관리자 검수용 review_criteria(sql/003_admin.sql)와는 다르다.
    -- 기준이 없는 전개 장면과 기존 시드는 빈 사전으로 둔다.
    element_criteria jsonb    NOT NULL DEFAULT '{}',
    -- 목표 달성으로 끝내려면 아이가 최소 몇 번 말해야 하는지. 2026-08-05 확정 (결정 2)
    preferred_turns   smallint,
    max_turns         smallint,

    UNIQUE (story_id, scene_order),

    -- 대화 장면이면 대화에 필요한 재료가 전부 있어야 한다.
    -- 전개 장면(character_id IS NULL)에는 이 조건을 걸지 않는다.
    -- (제약 이름은 ASCII 로 둔다. 한글 식별자는 psql 파이프·드라이버에서 깨지기 쉽다.)
    -- ⚠️ conflict 는 늦게 붙었다 (결정 74). 그전에는 여덟 칸만 봐서
    --    「갈등 없는 대화 장면」이 조용히 통과했다 — 분석 LLM 입력의 한 조각이 빈 채로.
    CONSTRAINT dialogue_scene_needs_all_parts CHECK (
        character_id IS NULL
        OR (    character_name    IS NOT NULL
            AND character_opening IS NOT NULL
            AND character_closing IS NOT NULL
            AND scene_stance      IS NOT NULL
            AND scene_goal        IS NOT NULL
            AND required_elements IS NOT NULL
            AND preferred_turns   IS NOT NULL
            AND max_turns         IS NOT NULL
            AND conflict          IS NOT NULL)
    ),

    -- 전개 장면은 지문이 곧 본문이다 (결정 74).
    -- 이걸 안 걸면 story_id·code·scene_order 만 있는 빈 장면이 들어온다 —
    -- 위 CHECK 는 전개 장면을 좌변(character_id IS NULL)에서 그냥 통과시키기 때문이다.
    CONSTRAINT narration_scene_needs_description CHECK (
        character_id IS NOT NULL OR scene_description IS NOT NULL
    ),

    -- 최소 턴이 최대 턴보다 크면 목표 달성으로는 영영 못 끝난다.
    CONSTRAINT preferred_turns_not_over_max CHECK (
        preferred_turns IS NULL OR max_turns IS NULL OR preferred_turns <= max_turns
    )
);

-- ─────────────────────────────────────────────────────────────
-- 6. story_sessions — 이야기 진행 기록
--
-- 진행 모드와 장면 종료는 여기 저장된 상태를 보고 서버 규칙이 정한다. LLM 이 정하지 않는다.
-- missing_elements 는 컬럼으로 두지 않는다.
--   missing_elements = story_scenes.required_elements - story_sessions.accumulated_elements
-- ─────────────────────────────────────────────────────────────
CREATE TABLE story_sessions (
    id                                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- children 테이블은 이 레포 범위 밖이라 FK 를 걸 대상이 없다. 값만 들고 있는다.
    child_id                          uuid        NOT NULL,
    story_id                          uuid        NOT NULL REFERENCES stories (id),
    current_scene_id                  uuid        REFERENCES story_scenes (id),
    current_child_turn_count          smallint    NOT NULL DEFAULT 0,
    accumulated_elements              text[]      NOT NULL DEFAULT '{}',
    last_detected_elements            text[]      NOT NULL DEFAULT '{}',
    last_response_mode                varchar
        CHECK (last_response_mode IN ('NORMAL', 'GUIDED', 'CLOSING')),
    last_guidance_target              varchar,
    -- 신규 요소 없이 이어진 턴 수. 2번 연속이면 유도.
    turns_without_new_element         smallint    NOT NULL DEFAULT 0,
    -- SHORT/UNCLEAR/OFF_TOPIC 연속 횟수. 2번 연속이면 유도.
    consecutive_low_information_turns smallint    NOT NULL DEFAULT 0,
    scene_goal_met                    boolean     NOT NULL DEFAULT false,
    scene_end_reason                  varchar
        CHECK (scene_end_reason IN ('GOAL_MET', 'MAX_TURNS')),
    status                            varchar     NOT NULL
        CHECK (status IN ('in_progress', 'post_activity', 'completed', 'stopped')),
    started_at                        timestamptz NOT NULL DEFAULT now(),
    completed_at                      timestamptz,
    last_activity_at                  timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────
-- 7. messages — 대화 기록
--
-- 캐릭터가 생성한 대사뿐 아니라 고정 첫 대사·마지막 대사도 재생 시점에 여기 저장한다.
-- STT 변환에 실패해 확정 텍스트가 없으면 행을 만들지 않는다.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE messages (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id   uuid        NOT NULL REFERENCES story_sessions (id) ON DELETE CASCADE,
    scene_id     uuid        NOT NULL REFERENCES story_scenes (id),
    speaker_type varchar     NOT NULL
        CHECK (speaker_type IN ('child', 'character', 'system')),
    -- 세션 전체를 통틀어 몇 번째 발화인지 (장면별이 아니다)
    turn_order   integer     NOT NULL,
    text         text        NOT NULL,
    -- 값에는 출처가 붙는다(헌법 원칙 IV). 지금 값은 합성 발화인
    -- 'synthetic_adult' 하나뿐이며, 앞으로 값이 늘 수 있어 CHECK 를 걸지 않는다.
    utterance_source varchar,
    -- 아이 발화에만 저장한다. 원본 음성 파일은 저장하지 않는다.
    stt_raw_text text,
    created_at   timestamptz NOT NULL DEFAULT now(),

    UNIQUE (session_id, turn_order)
);

-- ─────────────────────────────────────────────────────────────
-- 8. utterance_analyses — 발화 분석
--
-- 아이 메시지만 분석하고, 메시지 한 건당 분석 한 건이다.
-- 분석 LLM 은 아래 4개 컬럼만 채운다.
-- 응답 모드·장면 목표 충족·종료 이유는 story_sessions 에서 서버 규칙이 확정한다.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE utterance_analyses (
    id                 uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id         uuid    NOT NULL UNIQUE REFERENCES messages (id) ON DELETE CASCADE,
    -- 원문 목록: QUESTION, OPINION, REASONING, SOLUTION, DECISION, PERSPECTIVE,
    --            EMOTION, REQUEST, CHALLENGE, PLAYFUL, OFF_TOPIC, SHORT_RESPONSE, UNCLEAR
    -- 원문이 "등"으로 열어 두어 닫힌 목록인지 불확실하므로 CHECK 를 걸지 않았다.
    child_intent       varchar NOT NULL,
    main_point         text,
    -- [{ "type": "REASON", "evidence": "억울하니까" }, ...] — 이번 발화 한 건에서 확인된 것만
    detected_elements  jsonb   NOT NULL,
    utterance_validity varchar NOT NULL
        CHECK (utterance_validity IN ('VALID', 'SHORT', 'UNCLEAR', 'OFF_TOPIC', 'PLAYFUL')),
    -- 어느 버전의 분석 프롬프트가 낸 결과인지. 프롬프트를 고쳐 가며 결과를 비교하려면 필요하다.
    -- (원문 컬럼 표에는 없고 11번 절 참고에만 언급된 컬럼. 2026-08-05 추가하기로 결정)
    analysis_version   varchar NOT NULL DEFAULT 'mvp_v1'
);

-- ─────────────────────────────────────────────────────────────
-- 9. post_activity_results — 말하기 후 활동 결과
--
-- 세션당 최종 결과 한 건만 저장한다. 시도별 과정은 남기지 않는다.
-- ─────────────────────────────────────────────────────────────
CREATE TABLE post_activity_results (
    id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id       uuid        NOT NULL UNIQUE REFERENCES story_sessions (id) ON DELETE CASCADE,
    submitted_order  text[],
    is_order_correct boolean,
    attempt_count    smallint    NOT NULL DEFAULT 0,
    retelling_text   text,
    completed_at     timestamptz
);

-- ─────────────────────────────────────────────────────────────
-- 인덱스 (외래키 조회용)
-- story_scenes(story_id), messages(session_id), utterance_analyses(message_id),
-- post_activity_results(session_id) 는 위의 UNIQUE 제약이 이미 인덱스를 만든다.
-- ─────────────────────────────────────────────────────────────
CREATE INDEX idx_characters_story_id     ON characters (story_id);
CREATE INDEX idx_story_scenes_character_id ON story_scenes (character_id);
CREATE INDEX idx_story_sessions_child_id ON story_sessions (child_id);
CREATE INDEX idx_story_sessions_story_id ON story_sessions (story_id);
CREATE INDEX idx_messages_scene_id       ON messages (scene_id);
