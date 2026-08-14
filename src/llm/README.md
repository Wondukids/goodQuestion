# `src/llm` — 대화 엔진 도메인

도메인별 폴더 가르기의 첫 조각. 아이 발화를 받아 캐릭터 반응을 만들어 내는 **대화 엔진
한 덩어리**가 전부 여기 있다. 옛 `src/lib/{llm,service,repo,domain,engine,prompts}` ·
`src/lib/{config,log,scoring,elements}.ts` · `src/db` · `src/app/api/_lib/envelope.ts` 가
자리를 옮긴 것이고, 파일 내용은 바뀌지 않았다 (임포트 경로만).

`src/lib` 에는 이제 **아이 앱 쪽**(이야기 목록·아이 프로필·추천·Supabase)만 남는다.
두 도메인은 DB 도 다르다 — 이쪽은 `DATABASE_URL`(drizzle), 저쪽은 Supabase.

## 층

호출은 **위에서 아래로만** 흐른다. 아래 층이 위 층을 부르면 그건 되돌릴 신호다.

| 층 | 폴더 | 하는 일 |
|---|---|---|
| controller | `controller/` | HTTP 경계. zod 로 요청을 읽고 · 서비스 하나를 부르고 · `envelope.ts` 로 응답 봉투를 씌운다. 그 셋 말고는 아무것도 안 한다 |
| service | `service/` | 한 요청이 끝나기까지의 절차. 레포와 엔진을 순서대로 엮는다 |
| repo | `repo/` | DB 만. drizzle 질의와 `getDb()` 연결이 여기서 끝난다 |
| engine | `engine/` | LLM 을 실제로 부르는 자리 — 프롬프트를 짜고, 답을 파싱한다 |
| domain | `domain/` | 순수 함수. `decide()` · 진행 판정. DB 도 LLM 도 모른다 |
| prompts | `prompts/` | 레포 루트 `prompts/` 의 템플릿을 읽고 채운다 |
| provider | `provider/` | 공급자 어댑터(제미나이·앤트로픽·오픈AI)와 분당 문지기 |
| db | `db/` | drizzle 스키마 · 시드 · 푸시 가드 |

낱개 파일 `config.ts`(설정·키·경로) · `log.ts` · `scoring.ts` · `elements.ts` 는 여러 층이
같이 쓰는 것들이라 뿌리에 둔다.

## 라우트가 `app/` 에 남은 이유

Next 는 라우트를 **파일 위치**로 찾는다. 그래서 `src/app/api/v1/*/route.ts` 는 옮길 수
없고, 대신 한 줄짜리 재-내보내기만 남겼다:

```ts
export { POST } from '@/llm/controller/dialogue'
```

핸들러 알맹이는 `controller/` 에 있다. **`route.ts` 에 로직을 적지 말 것** — 적는 순간
도메인 코드가 다시 `app/` 으로 새기 시작한다. 관리자 화면(`src/app/(admin)/*`)도 같은
이유로 `app/` 에 남아 있다. 그쪽은 이 도메인의 뷰이고, 서비스 층만 부른다.
