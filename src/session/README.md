# `src/session` — 이야기 세션 도메인

대화 진행의 **순서**가 사는 곳이다. 아이 앱 계약(`/api/sessions/*`)의 컨트롤러·서비스가
여기 있고, `src/llm` 은 LLM 엔진으로 남는다 (설계 rev.2 결정 ① ·
`docs/이야기_세션_명세.md` 1절).

## 층

호출은 **위에서 아래로만** 흐른다 (`src/llm/README.md` 와 같은 규칙).

| 층 | 폴더 | 하는 일 |
|---|---|---|
| controller | `controller/` | HTTP 경계. 요청을 읽고 · 서비스 하나를 부르고 · 아이 앱 봉투(`envelope.ts` — `{ok, data}` / `{ok:false, error}`)로 싼다 |
| service | `service/` | 한 요청의 시퀀스. **순서는 이 층만 안다** |
| domain | `domain/` | 순수 함수 — 진행 판정. DB 도 LLM 도 모른다 |

## 경계 — llm 은 service 층으로만

이 도메인에는 repo 층이 없다 (새 표 0개 — 상태는 엔진 DB 의 `story_sessions`·`messages`·
`runs` 그대로다). 필요한 읽기·실행은 **`@/llm/service/*` 함수로만** 받는다.
`@/llm/repo/*` · `@/llm/engine/*` 직접 import 는 eslint 가 막는다 (이슈 #4).

조회가 더 필요해지면 **`llm/service` 에 함수를 늘려라** — 경계를 뚫지 말고.
`sessionPendingTurn()`(세션 → 회차 → 미완 턴, 404/409 가름)이 그렇게 생긴 첫 문이다.

## 라우트가 `app/` 에 남은 이유

`src/app/api/sessions/**/route.ts` 는 한 줄 재-내보내기만 한다 — Next 가 라우트를
파일 위치로 찾기 때문이다 (`src/llm/README.md` 의 같은 절). **`route.ts` 에 로직 금지.**
