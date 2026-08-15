# 갈래 P-4 — 리포트 API·생성 배선 (이슈 #38)

> 이 워크트리는 **혼자 도는 병렬 갈래**다. 앞 대화도 프로젝트 메모리도 없다.
> 이 문서 하나로 시작할 수 있게 썼다. **먼저 끝까지 읽어라.**

## ⓪ 여기가 무슨 프로젝트인가

6~9세 아이가 옛이야기(「방귀 뀌는 며느리」) 속 캐릭터와 **말로 대화하는** 앱이다.
아이가 한 말을 LLM 이 읽고 「감정을 말했나 · 까닭을 붙였나」 같은 **사고 요소 8종**을
찾아 DB 에 기록한다. 활동이 끝나면 그 기록을 모아 **보호자에게 보여 줄 리포트 한 장**을
만든다.

## ① 네가 할 일 — 한 줄

**앞 갈래 셋이 만들어 둔 조각을 이어 붙이고 HTTP 로 낸다. 네가 마지막 관문이다.**

이 갈래가 서기 전에는 **아무도 리포트를 만들지 않는다.** 표도 있고, 숫자를 세는 함수도
있고, 문장을 쓰는 엔진도 있는데 **부르는 사람이 없다.**

## ② 🟢 이미 다 있는 것 — 새로 만들지 마라

| 있는 것 | 어디 | 무엇 |
|---|---|---|
| 표 셋 | `sql/006_parent_report.sql` | `parent_reports` · `child_words` · `story_scenes.vocabulary` |
| 드리즐 선언 | `src/llm/db/schema.ts` | 위 표들이 이미 선언돼 있다 |
| 값의 모양 | `src/report/types.ts` | `ParentReport` · `ReportMetrics` · `ReportNarrative` · `ReportListItem` |
| **숫자 세기** | `src/report/domain/metrics.ts` | `aggregateMetrics(재료)` · `applyExtractedWords(...)` |
| **문장 쓰기** | `src/report/engine/index.ts` | `generateNarrative({ metrics, child })` |
| 층 규칙·생성 흐름 | `src/report/README.md` | 읽어라 |

`src/report/engine/index.ts` 머리말이 부르는 법을 이미 적어 뒀다:

```ts
const 결과 = await generateNarrative({ metrics, child })
결과.narrative   // 화면이 받을 서술. 둘 다 실패했으면 null
결과.words       // child_words 와 대조할 낱말 목록 (명세 4.3)
결과.dropped     // 대조에서 버린 것 — 로그로 남길 것
```

🔴 **`aggregateMetrics` 는 DB 를 안 문다. 읽어 온 행을 받는다.** 그 행을 읽어 오는
**repo 층이 없다 — 그게 네 일의 절반이다.** 받는 모양은 `src/report/domain/metrics.ts` 의
`집계재료` 인터페이스에 다 적혀 있다 (`세션행` · `이야기행` · `장면행` · `발화행` ·
`분석행` · `턴조건행` · `미션시도행` · `미션발화행`).

## ③ 시작하기 전에 읽을 것

| 순서 | 파일 | 무엇 |
|---|---|---|
| 1 | `docs/보호자_리포트_명세.md` **7·8절** | 🔴 **정본.** API 넷 · 문지기 · 생성 흐름 ①~⑤ |
| 2 | `src/report/README.md` | 층 규칙과 사고 나는 자리 셋 |
| 3 | `src/report/domain/metrics.ts` 의 `집계재료` | 네가 읽어 와야 할 행의 모양 |
| 4 | `src/session/README.md` | 🔴 **층 규칙의 본보기.** 라우트는 한 줄 재-내보내기 |
| 5 | `src/session/controller/sessions.ts` · `service/open.ts` | 컨트롤러·서비스가 어떻게 생겼는지 |
| 6 | `docs/보호자_리포트_프론트_계약.md` 3절 | 화면이 부르는 순서 |

이슈 원문: `gh issue view 38`

## ④ 환경 세팅 — 이것부터

```bash
pnpm install                                                    # node_modules 가 없다
cp "C:/Users/rlaqu/Documents/GitHub/goodQuestion-wondukids/.env.local" .env.local
```

### 🔴 검사를 돌릴 때는 `DATABASE_URL` 을 로컬로 바꿔라

본선 `.env.local` 의 `DATABASE_URL` 은 **팀의 라이브 Supabase** 를 가리킨다.
그 DB 에는 **진짜 아이 계정 14행**이 있고, `vitest` 는 진짜 DB 에 행을 넣고 지운다.
레포 가드(`검사_대상_가드`)가 로컬 아닌 주소면 DB 검사를 **막는다** — 그래서 그대로 두면
DB 검사 20개 파일이 통째로 안 돈다.

```
DATABASE_URL="postgresql://postgres:gqlocal@127.0.0.1:5432/goodquestion_ts"
```

로컬 도커 컨테이너 `gq-pg`(postgres:16)가 떠 있다. **006 을 로컬에 먹여야 표가 생긴다:**

```bash
docker cp sql/006_parent_report.sql gq-pg:/tmp/006.sql
docker exec gq-pg psql "postgresql://postgres:gqlocal@127.0.0.1:5432/goodquestion_ts" -f /tmp/006.sql
```

⛔ **`drizzle-kit push` 는 어떤 이유로도 치지 마라.** 선언에 없는 표를 지운다.

### 🟢 팀 Supabase 쪽은 본선이 이미 준비해 뒀다

**표 셋과 낱말 시드는 2026-08-15 에 팀 Supabase 에 적용을 마쳤다.** 네가 적용할 필요 없다.
게다가 거기에는 **진짜 데이터가 있다** — 활동 14건(완주 4건) · 아이 발화 56건 ·
발화분석 56건 · 턴판정 56건 · 미션 발화 17건.

쓸 만한 완주 활동 셋 (실기 확인용):

| `story_sessions.id` | 아이 발화 | 요소 종류 |
|---|---|---|
| `749571ff-d0e6-4355-b704-520a18a8f1c7` | 22 | 7 |
| `b4615358-a361-423a-94b8-c69c946f821a` | 12 | 4 |
| `94519425-021c-4a85-8352-a80e3d046d24` | 10 | 2 |

**실기 확인은 이렇게 한다** — 검사가 다 통과한 뒤, `DATABASE_URL` 을 잠깐 팀 Supabase 로
되돌리고 위 세션 하나로 `generateReport()` 를 한 번 돌려 본다.

- ⭕ `parent_reports` · `child_words` 에 쓰는 것은 **괜찮다.** 우리 표이고 지금 비어 있다.
- ⛔ 그 밖의 표(`children` · `messages` · `story_sessions` …)에 **쓰지 마라. 읽기만.**
- ⛔ 그 상태로 `vitest` 를 돌리지 마라. 확인이 끝나면 **로컬 주소로 되돌려라.**
- 💰 리포트 한 장에 **LLM 2회**가 나간다. 한두 번이면 되고, 반복은 지표만(①까지) 돌려라.

## ⑤ 만들 것 (1) — 라우트 넷

로직은 `src/report/controller/`, `src/app/api/**/route.ts` 는 **한 줄 재-내보내기**다
(`src/session/README.md` 규칙 — ⛔ `route.ts` 에 로직 금지).

| 메서드 · 경로 | 무엇 | 응답 |
|---|---|---|
| `GET /api/children/{child_id}/reports` | 리포트가 있는 활동 목록 (드롭다운) | `ReportListItem[]` |
| `GET /api/reports/{session_id}` | 리포트 한 장 | `ParentReport` |
| `POST /api/reports/{session_id}/read` | 읽음 표시 | `204` |
| `POST /api/reports/{session_id}/regenerate` | 다시 만들기 | `ParentReport` |

- 🔴 **문지기** — 로그인한 보호자의 `parents.id` 로 `children` 을 타고 내려가 그 세션이
  **자기 아이 것인지** 확인한다. 아니면 **404** — `403` 이 아니다. **존재 여부도 알리지
  않는다.** 리포트에는 아이 발화 원문이 그대로 실린다.
- 🔴 **재생성 제한** — `regenerated >= 3` 이면 **429**. 보호자 손에 비용이 달려 있다.
  숫자는 **설정값**으로 둔다 (`src/llm/config.ts` 근처 결을 따라라). 코드에 박지 마라.
- 응답 봉투는 **아이 앱 계약과 같은 결**로 맞춰라 (`src/session/controller/envelope.ts`).
  프론트 계약 문서 4절 샘플이 봉투 없는 알맹이라면, 그 알맹이가 `data` 에 들어가는 식이다.
  **어느 쪽으로 정했는지 마지막 답변에 적어라.**

## ⑥ 만들 것 (2) — 생성 흐름 (명세 8절)

```
활동 종료 (status → completed)
  ├─① 지표 집계        aggregateMetrics(재료).  순수 함수, LLM 0회
  │                    ↳ 실패하면 여기서 끝. 행을 만들지 않는다
  ├─②③ generateNarrative({metrics, child})   ← 안에서 두 LLM 을 동시에 부른다
  │                    ↳ 둘 다 실패하면 narrative=null → status='metrics_only' (R18)
  ├─④ 저장             parent_reports upsert (session_id 로)
  └─⑤ 낱말 누적        child_words 에 새 낱말 넣기
```

🔴 **⑤는 ④가 성공한 뒤에만 돈다.** 먼저 넣으면 「다시 만들기」를 눌렀을 때 그 낱말들이
이미 있어서 **새 낱말이 0개**가 된다 (명세 4.3).

🔴 **부르는 자리** — 세션이 `completed` 로 바뀌는 지점에서 `generateReport(session_id)` 를
**`await` 하지 않고** 부른다. 실패해도 **아이 화면이 멈추면 안 된다.**
(세션을 닫는 자리는 `src/session/service/` 안에 있다. 찾아서 거기 건다.)

- `model` 과 `prompt_digest` 를 함께 박제한다 — `promptDigest()` (`src/llm/service/goldenset.ts`).
  프롬프트를 고친 뒤 어느 리포트가 옛 판인지 이걸로 가른다.
- 낱말은 `generateNarrative` 가 돌려준 `결과.words` 를 `applyExtractedWords(...)` 에 태워
  `metrics.words.new` 를 채운 **뒤에** 저장한다 (명세 4.3 순서 그대로).

### ⚠️ 아직 안 정해진 것 — M8

**리포트 생성 실패를 어디에 남길지**가 안 정해졌다 (기존 `runs` 로그에 붙일지 새 자리).
**가장 되돌리기 쉬운 쪽**을 골라 구현하고, 무엇으로 정했는지 마지막 답변에 적어라.

## ⑦ 끝났다고 말할 수 있는 조건

- [ ] 활동을 끝내면 `parent_reports` 에 행이 **하나** 생기고, 다시 끝내도 **늘지 않는다.**
- [ ] LLM 을 일부러 실패시키면 `status='metrics_only'` 로 저장되고 **숫자가 남는다.**
- [ ] 남의 아이 `session_id` 로 부르면 **404** (403 아님).
- [ ] 네 번째 재생성이 **429**.
- [ ] 리포트 생성이 아이의 활동 종료 응답을 **늦추지 않는다.**
- [ ] `child_words` 가 **저장 뒤에** 채워진다 — 재생성해도 새 낱말이 0 이 되지 않는다.
- [ ] `pnpm typecheck` · `pnpm lint` 통과.
- [ ] `pnpm test` — **기준선 대비 실패가 늘지 않았다.** 🔴 **시작하자마자 기준선을 재 둬라.**
      (참고 기준선 — typecheck 0 · eslint 1198(오류 626·경고 572) · vitest 실패 1 · 오류 23.
      실패 1건은 `tests/safety.test.ts` 시간초과, 오류 23건은 DB 주소 때문이다. 로컬 주소로
      바꾸면 오류 쪽 숫자는 달라진다 — **네가 잰 값을 기준선으로 삼아라.**)

## ⑧ 남의 갈래를 건드리지 마라

**#39(화면 배선)가 지금 다른 워크트리에서 돌고 있다.**

| 갈래 | 만지는 곳 |
|---|---|
| **P-4 (너, #38)** | `src/report/controller/` · `src/report/service/` · `src/report/repo/` · `src/app/api/reports/**` · `src/app/api/children/**` · 세션 종료 자리 · 관련 검사 |
| P-5 (#39, 도는 중) | `src/lib/report.ts` · `src/app/report/page.tsx` · `src/components/report/**` |

- ⛔ **`src/report/types.ts` 를 고치지 마라.** 네 갈래가 공유하는 계약이다. 모자라면
  **고치지 말고 마지막 답변에 적어라.**
- ⛔ **`src/report/domain/metrics.ts` · `src/report/engine/**` 을 고치지 마라.** 앞 갈래가
  끝낸 것이다. 버그를 찾았으면 **고치지 말고 보고해라** (정말 못 넘어갈 자리면 최소한으로
  고치고 커밋 본문에 왜인지 적어라).
- ⛔ **화면 파일(`src/lib/report.ts` · `src/components/report/**`)에 손대지 마라.** #39 것이다.
- ⛔ `src/llm/db/schema.ts` 를 고치지 마라. 표는 다 서 있다.

## ⑨ 다 하면

```bash
git add -A
git commit    # 아래 형식
git push -u origin rlaqudwn1/issue-38-report-api
```

커밋 메시지는 이 레포의 결을 따른다 — **첫 줄은 한국어 한 문장, 끝에 ` — #38`**.
본문에 「무엇을 왜」와 「확인한 것」. `git log -3` 을 본보기로 봐라. 트레일러 두 줄:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FKq5C6XMcXiiNAqikbRdfi
```

⛔ **PR 을 열지 마라. 머지하지 마라.** 푸시까지만 하고 마지막 답변에 상황을 적어라.
본선 세션이 합친다.

## ⑩ 막히면

- 판단이 갈리면 **명세를 이긴다고 생각하지 말고** 명세대로 하고, 이상한 점을 적어라.
- 명세에 없는 것을 정해야 하면 **가장 되돌리기 쉬운 쪽**을 고르고 그 사실을 적어라.
- 이 레포의 엔진 쪽 코드(`src/llm` · `src/report` · `src/session`)는 **한국어 식별자와
  한국어 주석**을 쓴다. 주변 코드의 결을 따라라.
