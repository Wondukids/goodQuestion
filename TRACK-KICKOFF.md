# 갈래 P-1 — 리포트 스키마·시드 (이슈 #35)

> 이 워크트리는 **혼자 도는 병렬 갈래**다. 앞 대화도 프로젝트 메모리도 없다.
> 이 문서 하나로 시작할 수 있게 썼다. **먼저 끝까지 읽어라.**

## ⓪ 여기가 무슨 프로젝트인가

6~9세 아이가 옛이야기(「방귀 뀌는 며느리」) 속 캐릭터와 **말로 대화하는** 앱이다.
아이가 한 말을 LLM 이 읽고 「감정을 말했나 · 까닭을 붙였나」 같은 **사고 요소 8종**을
찾아 기록한다. 지금 만들려는 것은 그 기록을 모아 **활동이 끝난 뒤 보호자에게 보여 줄
리포트 한 장**이고, 이 갈래는 그 리포트를 **담을 표를 세우는** 일이다.

## ① 네가 할 일 — 한 줄

**`parent_reports` · `child_words` 두 표를 세우고 `story_scenes` 에 낱말 목록 칸을 붙인다.**
DDL 은 이미 정해져 있다. 새로 설계할 것이 없다.

## ② 시작하기 전에 읽을 것 (전부 이 워크트리에 있다)

| 순서 | 파일 | 무엇 |
|---|---|---|
| 1 | `docs/보호자_리포트_명세.md` **6절** | 🔴 **DDL 정본.** 여기 적힌 그대로 쓴다 |
| 2 | `docs/보호자_리포트_명세.md` 1절 | 확정 결정 24건 (R1~R24). 왜 이렇게 정했는지가 다 있다 |
| 3 | `src/report/README.md` | 이 도메인의 층 규칙과 사고 나는 자리 셋 |
| 4 | `src/llm/db/push-guard.ts` **머리말 1~34줄** | 🔴 **읽지 않고 DB 를 건드리지 마라** |
| 5 | `sql/004_scene_skipped.sql` | 마이그레이션 파일의 생김새 본보기 |

이슈 원문도 볼 수 있다: `gh issue view 35`

## ③ 환경 세팅 — 이것부터 (안 하면 아무것도 안 돈다)

이 워크트리에는 **git 이 추적하지 않는 파일이 없다.** 두 가지를 손으로 가져와야 한다.

```bash
# 1) 의존성 — 워크트리에는 node_modules 가 없다
pnpm install

# 2) 환경변수 — 본선 절대경로에서 복사한다
cp "C:/Users/rlaqu/Documents/GitHub/goodQuestion-wondukids/.env.local" .env.local
```

### 🔴 복사한 뒤 `DATABASE_URL` 을 반드시 로컬로 바꿔라

본선 `.env.local` 의 `DATABASE_URL` 은 **팀 레포의 라이브 Supabase** 를 가리킨다.
그 DB 에는 **진짜 아이 계정 8행**이 든 `children` 표가 있다. 그대로 두고 작업하지 마라.

```
DATABASE_URL="postgresql://postgres:gqlocal@127.0.0.1:5432/goodquestion_ts"
```

로컬 도커 컨테이너 `gq-pg`(postgres:16)가 이미 떠 있고, 그 안의 `goodquestion_ts` 에
`public` 10표 + `gq_admin` 11표가 이미 서 있다. `docker ps` 로 확인하고, 안 떠 있으면
띄우고 나서 시작해라.

```bash
docker exec gq-pg psql -U postgres -d goodquestion_ts -c "\d story_scenes"
```

### ⛔ `drizzle-kit push` 를 어떤 이유로도 치지 마라

`push` 는 선언에 없는 표를 **지운다.** 이 레포의 영구 규칙은 「저쪽 스키마를 바꿔야 하면
`push` 가 아니라 `generate` 로 SQL 을 뽑아 사람이 읽고 마이그레이션으로 적용한다」이다.
이 갈래에서 DB 에 뭔가를 적용하는 방법은 **`sql/006_parent_report.sql` 을 psql 로 먹이는 것**
하나뿐이다.

## ④ 만들 것 셋

### 1. `sql/006_parent_report.sql`

명세 6.1 · 6.2 · 6.3 의 DDL 셋을 한 파일에. 기존 `sql/00*.sql` 과 같은 결로 쓴다
(이미 서 있는 DB 를 따라잡히는 용도이므로 `IF NOT EXISTS` 를 쓴다).

- `parent_reports` — `session_id UNIQUE` (활동 하나에 리포트 하나, 재생성은 **덮어쓴다**) ·
  `status CHECK (status IN ('metrics_only','complete'))` · `metrics jsonb NOT NULL` ·
  `narrative jsonb`(LLM 실패 시 NULL) · `model` · `prompt_digest jsonb` · `generated_at` ·
  `read_at` · `regenerated smallint NOT NULL DEFAULT 0` ·
  인덱스 `(child_id, generated_at DESC)`
- `child_words` — `UNIQUE (child_id, word)` · `meaning` · `first_session_id` ·
  `first_scene_code` · `created_at`
- `ALTER TABLE story_scenes ADD COLUMN IF NOT EXISTS vocabulary jsonb NOT NULL DEFAULT '[]'`

⚠️ `child_id` 에 **FK 를 걸지 않는다.** `children` 은 저쪽(팀 레포) 표이고,
`story_sessions.child_id` 가 이미 같은 이유로 FK 없이 서 있다. 그 자리를 따라간다.

### 2. 드리즐 선언 — `src/llm/db/schema.ts`

두 표와 한 칸을 더한다. 기존 `pgTable(...)` 선언들과 **같은 모양**으로 쓴다
(`story_sessions` 근처를 본보기로).

🔴 **표가 21 → 23 이 된다. `push-guard.ts` 의 두 목록은 선언에서 뽑으므로 자동 반영이다 —
손으로 박지 마라.** 박아 두면 표가 하나 더 생긴 날 목록만 낡는다.

⛔ **`reports` 와 `wordbook` 을 선언에 넣지 마라.** 비어 있고 쓰임이 겹쳐 보여도 저쪽
표다. 넣는 순간 `tablesFilter` 에 들어가고, 그 옆에 진짜 아이 계정이 든 `children` 이 선다.
그래서 `wordbook` 대신 `child_words` 를 **새로** 세우는 것이다.

### 3. 시드 — 장면별 어려운 낱말

`src/llm/db/seed.ts` 의 장면 정의 옆에 `vocabulary` 를 나란히 둔다.
형식은 `[{ "word": "며느리", "meaning": "아들의 아내" }]`.

**「방귀 뀌는 며느리」의 대화 장면 4개 전부**에 한 개 이상 들어가야 한다. 낱말은 그 장면의
`scene_description` 을 읽고 **6~9세에게 어려울 말**을 고른다 (예: 며느리 · 배나무 · 시아버지).
이 값이 나중에 「질문한 낱말」의 뜻이 되고 `child_words.first_scene_code` 와 이어진다.

시드는 **반복 안전(upsert)** 해야 한다 — 두 번 돌려도 행이 늘지 않아야 한다.

## ⑤ 끝났다고 말할 수 있는 조건

- [ ] `sql/006_parent_report.sql` 이 로컬 `goodquestion_ts` 에 적용되고, **두 번 돌려도** 안 터진다.
- [ ] `pnpm db:seed` 를 두 번 돌려도 행이 늘지 않는다.
- [ ] 같은 `session_id` 로 리포트를 두 번 넣으면 행이 늘지 않고 덮어써진다 (직접 psql 로 확인).
- [ ] 같은 `(child_id, word)` 를 두 번 넣으면 유니크가 막는다.
- [ ] `reports` · `wordbook` 이 드리즐 선언에 **없다** — 검사로 못박는다
      (`tests/push-guard.test.ts` 또는 `tests/db-guard.test.ts` 근처에 한 줄).
- [ ] 대화 장면 4개 전부에 `vocabulary` 가 한 개 이상 들어 있다.
- [ ] `pnpm typecheck` · `pnpm lint` 통과.
- [ ] `pnpm test` — **이 변경 전과 실패 개수가 같거나 줄었다.** 늘었으면 네가 깬 것이다.

## ⑥ 남의 갈래를 건드리지 마라

지금 **세 갈래가 동시에 돈다.** 파일이 겹치면 합칠 때 사람이 손으로 푼다.

| 갈래 | 만지는 곳 |
|---|---|
| **P-1 (너, #35)** | `sql/006_*.sql` · `src/llm/db/schema.ts` · `src/llm/db/seed.ts` · 스키마 검사 |
| P-2 (#36) | `src/report/domain/` · `tests/report-metrics.test.ts` |
| P-3 (#37) | `prompts/report_*/` · `src/report/engine/` · `tests/prompts.test.ts` |

⛔ **`src/report/types.ts` 를 고치지 마라.** 세 갈래가 공유하는 계약이고, 프론트 계약
문서 1절을 그대로 옮긴 것이다. 이 갈래에는 고칠 이유가 없다.

## ⑦ 다 하면

```bash
git add -A
git commit    # 아래 형식
git push -u origin rlaqudwn1/issue-35-report-schema
```

커밋 메시지는 이 레포의 결을 따른다 — **첫 줄은 한국어 한 문장, 끝에 ` — #35`**.
본문에는 「무엇을 왜」와 「확인한 것」을 적는다. 최근 커밋(`git log -3`)을 본보기로 봐라.

트레일러 두 줄을 끝에 붙인다:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FKq5C6XMcXiiNAqikbRdfi
```

⛔ **PR 을 열지 마라. 머지하지 마라.** 푸시까지만 하고, 무엇을 했고 무엇이 남았는지
마지막 답변에 적어라. 본선 세션이 세 갈래를 모아 합친다.

## ⑧ 막히면

- 판단이 갈리는 자리가 나오면 **명세를 이긴다고 생각하지 말고** 명세대로 하고,
  이상하다고 느낀 점을 마지막 답변에 적어라.
- 명세에 없는 것을 정해야 하면 **가장 되돌리기 쉬운 쪽**을 고르고 그 사실을 적어라.
- 이 레포의 코드는 **한국어 식별자와 한국어 주석**을 쓴다. 주변 코드의 결을 따라라.
