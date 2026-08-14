# TRACK-KICKOFF — 이슈 #17 미션 스키마·시드

> 이 트랙: 브랜치 `rlaqudwn1/issue-17-mission-schema` · 베이스 `api_team`(`852a15a`).
> 병렬 트랙 #18(도메인·엔진)·#20(프론트)이 동시에 돈다 — **파일 경계를 지켜라**(아래).
> 관례: 머지 전 마지막 커밋에서 이 파일을 걷어낸다.

## 목표

미션(미니게임) 대화를 담을 표 3개와 시드를 만든다.
이슈: https://github.com/Wondukids/goodQuestion/issues/17
**정본: `docs/미션_명세.md` 6절** — DDL 이 통째로 적혀 있다. 먼저 읽어라(1·2·3절 포함).

## 할 일

1. `sql/005_missions.sql` — 명세 6절 DDL 그대로:
   - `story_missions` (정의, `UNIQUE(scene_id)` 씬당 1개)
   - `mission_sessions` (시도, `status in_progress|completed|abandoned`,
     in_progress 부분 유니크 인덱스 `ux_mission_sessions_active`)
   - `mission_messages` (대화 + 아이 행 분석 jsonb 사본, `line_source fixed|generated|summary`)
   - `gq_admin.llm_calls.purpose` CHECK 에 `'mission_reply'`·`'mission_summary'` 추가.
     **제약 이름은 실물 DB 에서 확인**(`sql/003_admin.sql:77` 근처가 원본).
   - 기존 마이그레이션(001~004)의 문체·주석 스타일을 따른다.
2. 드리즐 사본 — `src/llm/db/schema.ts` 에 세 표 추가 (기존 표들의 주석·네이밍 결 그대로).
3. 시드 — `src/llm/db/seed.ts` 에 `story_missions` 2행 upsert (`code` 기준):
   - `ms_banggui_pear` → `sc_banggui_07` / `ms_banggui_friend` → `sc_banggui_09`
     (scene_id 는 code 로 찾아 연결한다 — 기존 seed 가 씬을 잇는 방식 참고).
   - config 값은 명세 6절 예시가 뼈대. **대사·소품·친구 문구의 원문은 프론트에 있다**:
     `src/stories/fart-bride/minigame/mission1-script.ts` (소품 3개·이장님 대사),
     `mission2-script.ts` (친구 4명 trouble/reask·며느리 대사). 글자 그대로 옮겨라.
   - `mission_goal` 은 명세 3절의 미션 목적 한 문장.

## 만지지 말 것 (다른 트랙 소유)

- `src/llm/domain/**`, `src/llm/engine/**`, `prompts/**`, `tests/prompts.test.ts` → #18
- `src/stories/**`, `src/session/**`, `src/app/**` → #20·#19
- config jsonb 의 **모양**은 명세 6절이 정본 — 임의로 바꾸지 마라. 바꿔야 할 이유가
  생기면 코드를 고치지 말고 PR 본문에 제안으로 적어라 (#18·#20 이 같은 모양을 본다).

## 끝났다고 말할 수 있는 조건 (이슈 #17 본문과 동일)

- 마이그레이션이 로컬 도커 DB 에 적용되고 시드가 반복 안전(upsert 두 번 = 행 수 불변).
- 같은 (session, mission) 에 in_progress 시도 2개 → 유니크 인덱스가 막는다.
- `purpose='mission_summary'` 인 `llm_calls` 행이 들어간다.
- 테스트: 기존 DB 테스트 스타일로 위 셋을 검사하는 테스트를 추가한다.

## 환경 함정 (레포 공통 — 실제로 겪은 것들)

- **DB 테스트는 로컬 도커 `gq-pg`** (`goodquestion_ts`, 비번은 `docker inspect gq-pg`).
  레포 `.env.local` 의 DATABASE_URL 은 팀 Supabase 라 테스트 가드에 막힌다 —
  DATABASE_URL 을 인라인으로 지정해 돌려라. **팀 Supabase 에 마이그레이션 적용은 금지**
  (사용자 몫).
- 여러 검사 파일이 같은 도커 DB 를 동시에 쓰면 간섭으로 붉어질 수 있다 —
  의심되면 그 파일만 따로 돌려 확인.
- 새 체크아웃이라 `pnpm install` 먼저. lint 기존 오류 3건(`play/page.tsx`·
  `interactive-scene.tsx` react-hooks)은 이 트랙 책임이 아니다 — 건드리지 마라.

## 마무리

1. 커밋은 레포 스타일(한국어 현재형 "~한다", 예: `feat(db): 미션 표 셋과 시드를 세운다`).
2. 이 파일을 걷는 커밋을 마지막에 얹고, 브랜치를 origin 에 푸시.
3. `gh pr create --base api_team` — 본문에 이슈 `#17` 링크와 검증 로그 요지.
   **머지는 사용자 몫** — 머지하지 마라.
4. 진행 체크포인트마다 `orca worktree set --worktree active --comment "..."` 로 카드
   상태를 남겨라 (예: "DDL 완료, 시드 작성 중").
