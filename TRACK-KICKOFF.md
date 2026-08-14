# TRACK-KICKOFF — 이슈 #6 · 세션 열기·조회 API

> 이 워크트리는 https://github.com/Wondukids/goodQuestion/issues/6 를 진행하는 트랙이다.
> 기반: `api_team` (PR #10 resume API + PR #11 세션 도메인 뼈대 머지 포함)
> 브랜치: `rlaqudwn1/issue-6-session-open`

## 정본 — 이것이 이긴다

1. 이슈 #6 본문 (위 링크)
2. `docs/이야기_세션_명세.md` — **4.1 · 4.2절이 계약의 전부다.** 4절 서두의 운영 전제
   (엔진 DATABASE_URL = 팀 Supabase Postgres · `startStory()` 대체)도 이 트랙 배경이다.
3. `src/session/README.md` — 층 규칙 (PR #11). llm 은 **service 층만** 부른다 —
   `llm/repo` import 는 린트가 막는다. 조회가 모자라면 `llm/service` 에 함수를 늘려라
   (PR #11 이 `run.ts` 에 한 방식 그대로).

## 한 줄 목표

`POST /api/sessions`(열기 = 시작 + 이어하기 + 따라잡기, 반복 안전)와
`GET /api/sessions/{id}`(읽기 전용 조회)를 세운다. 재개 지점 = 그 장면의 마지막 캐릭터
`messages` 행. 세션 생성 시 회차를 **한 트랜잭션으로 동반 생성** (`started_by='app'`,
`scope='story'` — 확정 결정 ⑥).

## 요점 (명세 4.1 · 4.2 요약 — 어긋나면 명세가 이긴다)

- 열기: `(child_id, story_id, 'in_progress')` 를 찾는다 → 없으면 세션+회차 생성 후
  `advanceScenes()` 로 첫 대화 장면까지 전진(여는 말 행이 여기서 생긴다) → 있으면 따라잡기
  (끝난 장면이면 다음 대화 장면까지 전진 · **회차 없는 legacy 행이면 회차를 만들어 붙인다**).
- 응답: `session_id · resumed · scene {scene_id, code} · last_character_line
  {message_id, text} · pending_turn` (`pendingTurn()` 재사용).
- 조회(GET)는 **상태를 바꾸지 않는다** + `status` · `progress {scene_order, total}`.
- 아이 확인(`selected_child` 쿠키 → child_id)은 컨트롤러 입구에서 한 번. 그 아래로는
  불투명 값. 봉투·오류 코드는 `src/session/controller/envelope.ts` 그대로.
- `startStory()` 서버 액션 (`src/app/stories/[id]/actions.ts`) 을 이 API 로 대체한다.
- 동시 시작 경쟁(중복 in_progress)은 #5 의 부분 유니크 인덱스 몫 — 이 트랙에선 무시하고
  그 사실만 PR 본문에 적어라.

## 수용 기준 (명세 8절 1·2·5 — 테스트로 옮겨라, `tests/session-resume.test.ts` 방식)

1. 새 아이·새 이야기 → 세션·회차 동반 생성, `scene.code = sc_banggui_03`,
   `last_character_line` = 그 장면 여는 말.
2. 같은 요청 반복 → 같은 `session_id` · `resumed: true` · 행 수 불변.
3. 회차 없는 legacy `in_progress` 세션 → 회차가 생기고 정상 진행.

## 검사 — 환경 주의 (전 트랙과 동일)

- DB 테스트는 `DATABASE_URL` 인라인: 로컬 도커 `gq-pg` 의 `goodquestion_ts`,
  비밀번호는 `docker inspect gq-pg` 의 `POSTGRES_PASSWORD`.
  (`.env.local` 의 DATABASE_URL 은 Supabase 라 테스트 가드가 막는다 — 고치지 말 것.)
- 전체 테스트의 프롬프트 CRLF 실패 10~12건 · lint 기존 프론트 3건은 기존 문제 — 스코프 아님.

## 완료 정의

- 위 수용 기준 3개가 테스트로 존재하고 초록 · `pnpm typecheck` 통과 · lint 신규 오류 0.
- PR 은 `api_team` 향, 본문에 이슈 #6 연결. 머지 전 이 킥오프 문서를 걷는 커밋(관례).

## 비스코프

턴 API(#7) · 화면(#8) · 잠금(#9) · 스키마(#5). `messages.client_turn_id` 없이 간다.
