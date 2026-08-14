# TRACK-KICKOFF — 이슈 #4 · 세션 도메인 뼈대

> 이 워크트리는 https://github.com/Wondukids/goodQuestion/issues/4 를 진행하는 트랙이다.
> 기반: `api_team` (PR #10 — 이슈 #2 resume API — 머지 포함)
> 브랜치: `rlaqudwn1/issue-4-session-skeleton`

## 정본 — 이것이 이긴다

1. 이슈 #4 본문 (위 링크)
2. `docs/이야기_세션_명세.md` — 1절 결정 ①(세션 도메인이 순서, `src/llm` 은 LLM만) · 9절
3. `src/llm/README.md` — 층 규칙 (controller → service → repo, 위에서 아래로만)

## 한 줄 목표

`src/session` 의 층(controller · service · domain)을 확정하고, 이슈 #2 가 임시로
빌려 쓴 `@/llm/repo/*` 직접 접근을 `llm/service` 경유로 정리하고, 그 경계를
eslint 규칙으로 못 박는다. **새 기능 없음** — 구조와 규칙만.

## 작업 순서 제안

1. `src/llm/README.md` 로 층 규칙을 익힌다.
2. `src/session/service/turn-resume.ts` 머리말의 임시 차용 주석을 읽는다 —
   `@/llm/repo/db`(Conn·getDb)와 `@/llm/repo/sessions`(readSessionWithStory 등)를
   직접 부르고 있다. 필요한 조회를 `llm/service` 에 함수로 늘려 그쪽만 부르게 바꾼다.
3. eslint 에 경계 규칙 추가: `src/session/**` 에서 `@/llm/repo/*` · `@/llm/engine/*`
   import 금지 (`no-restricted-imports` 또는 기존 방식과 맞는 것).
4. `src/session/domain/` 자리를 만든다 (재개 판정 순수 함수가 들어올 자리 —
   지금은 비어 있어도 된다. 층의 존재와 규칙이 이 이슈의 산출물이다).
5. 기존 `tests/session-resume.test.ts` 초록 유지가 리팩터링의 안전망이다.

## 검사 — 환경 주의 둘

- DB 게이트 테스트는 `DATABASE_URL` 을 **인라인으로** 넣어야 돈다. 로컬 도커
  컨테이너 `gq-pg` 의 `goodquestion_ts`, 비밀번호는
  `docker inspect gq-pg` 의 `POSTGRES_PASSWORD` 값:
  `DATABASE_URL="postgresql://postgres:<그 값>@localhost:5432/goodquestion_ts" pnpm vitest run tests/session-resume.test.ts`
  (이 폴더 `.env.local` 의 `DATABASE_URL` 은 Supabase 라 테스트 가드가 막는다 — 고치지 말 것.)
- 전체 `pnpm test` 에서 프롬프트 검사 10건이 깨져 보인다 — autocrlf 로 md 가 CRLF 로
  체크아웃된 **기존 환경 문제**다 (`'{analysis_material}\r'`). 이 트랙 스코프 아님.
  `pnpm lint` 의 기존 프론트 오류 3건(`play/page.tsx`·`interactive-scene.tsx`)도 손대지 않는다.

## 완료 정의

- 이슈 #4 조건: 세션 도메인이 `llm/repo` 를 직접 import 하면 린트가 막는다.
- `pnpm typecheck` 통과 · lint 는 **신규 오류 0** · `session-resume` DB 테스트 초록.
- PR 은 `api_team` 을 향한다. 본문에 이슈 #4 연결. 머지 전에 이 킥오프 문서를 걷는
  커밋을 얹는다 (#2 트랙의 관례).

## 비스코프 — 손대지 말 것

#5 스키마 · #6 세션 열기/조회 · #7 턴 API · #8 화면 · #9 잠금. 전부 별도 트랙이다.
