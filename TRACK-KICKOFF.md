# TRACK-KICKOFF — 이슈 #19 미션 API

> 이 트랙: 브랜치 `rlaqudwn1/issue-19-mission-api` · 베이스 `api_team`(`1c791f0` —
> **#17 스키마·#18 엔진이 방금 머지된 판**이다).
> 병렬로 본선 세션이 PR #29(프론트 배선)의 충돌을 풀고 있다 — `src/stories/**` 는
> 절대 만지지 마라. 관례: 머지 전 마지막 커밋에서 이 파일을 걷어낸다.

## 목표

미션의 서버 입구 셋(선택 이벤트·미션 턴·complete)과 기존 턴 응답의 `미션시작` 확장을
만든다. 이슈: https://github.com/Wondukids/goodQuestion/issues/19
**정본: `docs/미션_명세.md` 7절** (4·5절 파이프라인·트리거 규칙 포함). 이슈 본문의
「끝났다」 조건이 곧 수용 기준이다.

## 먼저 읽을 것 (명세보다 실물 우선)

방금 머지된 재료의 **실제 타입·시그니처**에 맞춰라 — 명세와 어긋나 보이면 실물이 정본:

- `src/llm/domain/mission.ts` — `decideMissionTrigger()`·`decideMissionTurn()` (#18)
- `src/llm/engine/mission.ts` — 재료 조립 + `mission_reply`/`mission_summary` 호출 (#18)
- `src/llm/db/schema.ts` 의 미션 3표 + `sql/005_missions.sql` (#17)
- `src/llm/db/seed.ts` 의 `story_missions` 2행 config (#17)
- `src/session/README.md` — 층 경계. **`src/session` 은 `llm/repo`·`llm/engine` 직접
  import 금지(eslint 강제)** — 조회·실행이 더 필요하면 `llm/service` 에 함수를 늘린다.
- `src/llm/service/turn.ts`·`step.ts`·`run.ts` — 기존 턴 3단과 문지기(`pendingTurn`,
  메모리 `inProgress` 잠금). 미션 API 도 이 잠금을 공유한다.
- `src/session/controller/envelope.ts` — 아이 앱 봉투·오류 코드 표 (여기에
  `MISSION_IN_PROGRESS`·`MISSION_NOT_ACTIVE` 409 를 더한다).
- 최근 픽스 `9b44dd5`(세션 열기 이어하기 판정 「실제 진행」) — E 확장이 같은 코드를
  만진다. 그 판정 로직을 존중하고 위에 얹어라.

## 할 일 (명세 7절 A~E)

- **A. 턴 응답 확장** — 판단 단계 직후 `decideMissionTrigger()` 를 돌려(그 씬에 미션이
  있고 완료 시도가 없을 때만) 발동 시: `mission_sessions` 행 생성 + 대사 단계는
  `direction.kind="bridge_into_mission"` 으로 다리 대사 생성 + 응답
  `next: { kind:"미션시작", mission:{ mission_session_id, code, mission_type, config } }`.
  다리 대사 단계에서 죽으면 일반 미완 턴 — **resume 응답에도 `미션시작` 재적재**
  (미션 세션 행은 판정 커밋에서 이미 생겼으므로 반복 안전).
- **B. `POST /api/sessions/{sid}/missions/{msid}/events`** —
  `{type: prop_select|friend_select|more|skip, value}`. `selections` 기록 + 그 스텝
  고정 대사를 `mission_messages` 캐릭터 행(fixed)으로 저장하고 응답에 실어 준다.
  `more=no` 또는 카드 소진이면 `done:true, line:null`.
- **C. `POST …/missions/{msid}/turns`** — 오디오(octet-stream + `X-Audio-Channels`) →
  STT → 분석(기존 `analysis`, 씬 `element_criteria`) → `decideMissionTurn()`(요소 합산은
  `accumulated_elements` 만 — 씬 턴 수·유도 카운터 불변) → `mission_reply` 대사.
  무음은 `{empty:true}` 상태 불변. 되묻기(SHORT/UNCLEAR 스텝당 1회)면 `dialogue:null`
  + reask fixed_line. **LLM 결과까지 모아 마지막에 일괄 커밋** — 502 면 미션 상태 불변
  (`llm_calls` 는 실패도 남는 기존 규칙대로 트랜잭션 밖). 미션 턴 resume 은 없다(M4).
- **D. `POST …/missions/{msid}/complete`** — 반복 안전(완료면 저장된 요약 재반환).
  `mission_summary` 로 요약 생성 → `summary_text`+`completed` → 본 대화 `messages` 에
  요약 캐릭터 행(`utterance_source='mission_summary'`) → 닫힘 판정은
  `required − accumulated` **산식만** (**`decide()` 재호출·`turn_conditions` 박제 금지**).
  비면 `GOAL_MET` 로 닫고 같은 요청에서 다음 대화 씬까지 전진(`closing_line` 동봉),
  남으면 `next: 발화받기`(요약 재료에 남은 요소의 `remaining_worries` 한 줄).
- **E. 세션 열기 확장 + 가드** — 열기 응답에 `mission` 필드: 현재 씬의 `in_progress`
  시도는 `abandoned` 처리 후 **새 시도를 만들어** 동봉(M4). 완료된 미션은 재노출 금지.
  미션 진행 중 일반 턴 → 409 `MISSION_IN_PROGRESS`; 미션 API 에 시도가 in_progress
  아니면 409 `MISSION_NOT_ACTIVE`; 회차 잠금(`TURN_IN_PROGRESS`) 공유.
- 저장소 접근이 필요하면 `src/llm/repo/missions.ts` 류를 새로 만들고 `llm/service` 로
  노출하라(층 규칙). 라우트는 `src/app/api/sessions/[session_id]/missions/**/route.ts`
  한 줄 재-내보내기.

## 만지지 말 것

- `src/stories/**` (프론트 — 본선이 #29 충돌 해소 중), `docs/**`, `video-plan.json`
- `sql/**` 수정 금지 — 스키마가 더 필요하면 코드를 우회하지 말고 PR 본문에 제안.
- `src/llm/domain/mission.ts`·`engine/mission.ts`·프롬프트 2벌 — **import 는 자유,
  수정은 최소**로 하고 수정 시 PR 본문에 사유를 적어라.

## 끝났다고 말할 수 있는 조건 (이슈 #19 본문 = 명세 11절 1·3·5·7·8·9)

- 트리거 턴 응답에 미션시작·다리 대사, `mission_sessions` 행 생성 (SOLUTION 또는 2턴).
- 미션 턴 후 요소만 합산, 씬 턴 수 불변. 되묻기 1회 동작.
- complete 후 `messages` 요약 행 1개; 충족 시 같은 요청에서 씬 닫힘·다음 여는 말 저장.
- 껐다 켜면 새 시도 + 이전 `abandoned`, 합산 요소 유지.
- 미션 중 일반 턴 409; complete 반복 = 같은 요약; 미션 없는 씬(대화1·2) 무변화.
- 위를 검사로 박아라 — DB 검사는 로컬 도커, LLM 은 기존 테스트의 가짜 SDK 결을 따라 목.

## 환경 함정 (레포 공통)

- 새 체크아웃 — `pnpm install` 먼저. DB 테스트는 로컬 도커 `gq-pg`(`goodquestion_ts`,
  비번 `docker inspect gq-pg`) — `.env.local` 의 Supabase URL 은 테스트 가드에 막힌다.
  **팀 Supabase 에 005 적용은 사용자 몫 — 하지 마라.**
- 여러 검사 파일이 같은 도커 DB 를 동시에 쓰면 간섭 — 붉으면 그 파일만 단독 재실행.
- lint 기존 부채 3건(`play/page.tsx`·`interactive-scene.tsx`)은 건드리지 마라.

## 마무리

1. 커밋은 레포 스타일(한국어 현재형, 예: `feat(session): 미션 API 셋을 잇는다 — #19`).
2. 이 파일을 걷는 커밋 → 푸시 → `gh pr create --base api_team` (이슈 #19 링크 + 검증
   로그 요지). **머지는 하지 마라** — 본선이 판단한다.
3. 체크포인트마다 `orca worktree set --worktree active --comment "..."`.
