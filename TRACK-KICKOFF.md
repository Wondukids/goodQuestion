# 갈래 후-1 — 후활동 스키마·시드 (이슈 #42)

> 이 워크트리는 **혼자 도는 갈래**다. 앞 대화도 프로젝트 메모리도 없다.
> 이 문서 하나로 시작할 수 있게 썼다. **먼저 끝까지 읽어라.**

## ⓪ 여기가 무슨 프로젝트인가

6~9세 아이가 옛이야기(「방귀 뀌는 며느리」) 속 캐릭터와 **말로 대화하는** 앱이다.
아이가 이야기를 다 보고 나면 활동이 하나 더 있다 — **말하기 후 활동**. 장면 카드 넉 장을
이야기 순서대로 놓고(1단계), 맞춘 카드와 「핵심 단어」를 보면서 줄거리를 통째로 들려주는
(2단계) 활동이다.

**화면은 이미 다 만들어져 있다** (`src/stories/fart-bride/minigame/finale.tsx`).
비어 있는 것은 **그 화면이 아무 데도 연결되어 있지 않다**는 것이다 — 카드도 단어도 코드
상수에 박혀 있고, 아이가 무엇을 했는지 서버에 하나도 안 남는다.

그 화면을 서버·DB 에 잇는 일이 갈래 여섯(#42~#47)이고 **네가 그 첫째**다.

```
#41 말하기 후 활동 (부모)
 ├─ #42 후-1 스키마·시드              ← 너다. 나머지 전부를 막고 있다
 ├─ #43 후-2 리포트 시점 이관         (너를 기다린다)
 ├─ #44 후-3 판정 엔진·프롬프트       (너를 기다린다)
 ├─ #45 후-4 API 넷
 ├─ #46 후-5 프론트 배선
 └─ #47 후-6 리포트 지표·화면
```

## ① 네가 할 일 — 한 줄

**표 하나를 새로 세우고, 칸 둘을 늘리고, 이야기 행에 카드·단어를 심는다.**

작아 보이지만 **다섯 갈래가 전부 네 표 이름과 칸 이름 위에 선다.** 명세와 다르게 지으면
뒤가 다 어긋난다. 이름은 명세 4절 그대로 쓴다.

## ② 🟢 이미 있는 것 — 새로 만들지 마라

| 있는 것 | 어디 | 무엇 |
|---|---|---|
| 결과 표 | `sql/001_schema.sql` 9번 · `src/llm/db/schema.ts:433` | `post_activity_results` — **이미 서 있다.** 다섯 칸이 전부 빈 채로 |
| 담을 칸 | `sql/001_schema.sql:47` · `schema.ts:97` | `stories.post_activity_config jsonb` — **칸만 있고 NULL** |
| 카드·단어의 실제 값 | `src/stories/fart-bride/minigame/finale-script.ts` | `SCENE_CARDS`(45~68행) · `TRAY_ORDER`(75행) |
| 본보기 커밋 | `git show 5bda28a` | 표 둘을 세우며 **무엇을 함께 고쳤는지** 다 들어 있다. 먼저 봐라 |
| 마이그레이션 결 | `sql/006_parent_report.sql` | 파일 머리말·주석의 결 |

🟢 **명세 4.1 의 config JSON 은 `finale-script.ts` 의 상수와 글자까지 같다.** 새로 지어내지
말고 그대로 옮겨라. (`id`·`title`·`keywords` 넉 장, `tray_order` 는 `TRAY_ORDER` 와 같다.)

## ③ 시작하기 전에 읽을 것

| 순서 | 파일 | 무엇 |
|---|---|---|
| 1 | `docs/말하기후활동_명세.md` **4절** | 🔴 **정본.** 4.1 config · 4.2 칸 뜻 · 4.3 새 표 DDL · 4.4 함께 고칠 곳 |
| 2 | 같은 문서 **1절** | 결정 18건. 특히 **F1 · F3 · F18** 이 네 것이다 |
| 3 | `git show 5bda28a` | 표를 늘릴 때 함께 고친 파일 목록 |
| 4 | `tests/schema.test.ts` 100~140행 | sql 파일을 **어떻게 읽는지**(파서). ⑥에서 쓴다 |

이슈 원문: `gh issue view 42`

## ④ 환경 세팅 — 이것부터

```bash
pnpm install                                                    # node_modules 가 없다
cp "C:/Users/rlaqu/Documents/GitHub/goodQuestion-wondukids/.env.local" .env.local
```

### 🔴 검사를 돌릴 때는 `DATABASE_URL` 을 로컬로 바꿔라

본선 `.env.local` 의 `DATABASE_URL` 은 **팀의 라이브 Supabase** 를 가리킨다. 거기에는
진짜 아이 계정 행이 있고, `vitest` 는 DB 에 행을 넣고 지운다. 레포 가드가 로컬 아닌
주소면 DB 검사를 **막으므로** 그대로 두면 DB 검사가 통째로 안 돈다.

```
DATABASE_URL="postgresql://postgres:gqlocal@127.0.0.1:5432/goodquestion_ts"
```

로컬 도커 컨테이너 `gq-pg`(postgres:16)가 떠 있고 **006 까지 먹여져 있다.**
네가 만든 007 을 먹여야 새 표가 생긴다:

```bash
docker cp sql/007_post_activity.sql gq-pg:/tmp/007.sql
docker exec gq-pg psql "postgresql://postgres:gqlocal@127.0.0.1:5432/goodquestion_ts" -f /tmp/007.sql
```

- ⛔ **`drizzle-kit push` 는 어떤 이유로도 치지 마라.** 선언에 없는 표를 지운다.
- ⛔ **팀 Supabase 에 007 을 먹이지 마라.** 머지한 뒤 본선이 넣는다. 네 일은 파일까지다.

## ⑤ 만들 것 — 파일 셋

### (1) `sql/007_post_activity.sql` — 네 덩이 (명세 4.4)

1. `ALTER TABLE post_activity_results` — `analyzed_at timestamptz` · `analysis_version varchar`
2. `CREATE TABLE post_activity_keywords` — 명세 4.3 DDL 그대로
3. `UPDATE stories SET post_activity_config = '…'::jsonb WHERE slug = 'fart-bride'`
4. `CREATE INDEX idx_post_activity_keywords_word`

칸 뜻은 주석으로 못박아라. 특히 이 둘은 **뜻이 이름에서 안 읽힌다**:

- `is_order_correct` = 🔴 **「끝내 맞췄나」** (F18). 「첫 제출이 정답이었나」가 **아니다** —
  그건 `attempt_count = 1` 로 안다. 못 맞추고 나갔으면 `false`.
- `analyzed_at` 이 NULL = **판정을 못 했다**(LLM 실패·아직 안 말함). 「단어를 하나도 안 썼다」와
  다르다 — 그쪽은 `analyzed_at` 이 차고 단어 행이 전부 `missing` 이다.

### (2) `src/llm/db/schema.ts` — 드리즐 선언

- `post_activity_results` 에 칸 둘 추가 (433행 근처)
- `post_activity_keywords` 새 선언. `UNIQUE (result_id, card_id, word)` ·
  `CHECK status IN ('used','similar','missing')` · `CHECK decided_by IN ('rule','llm')` ·
  `result_id` 는 `ON DELETE CASCADE`
- ⚠️ **제약에 이름을 직접 줘라.** 이 레포는 드리즐이 지어 주는 `…_unique` 꼴을 안 쓴다
  (`post_activity_results_session_id_key` 가 본보기다 — `schema.ts:438`).

### (3) `src/llm/db/seed.ts` — 이야기 정의에 config

`const 이야기 = { … }`(92행)에 `post_activity_config` 를 나란히 둔다. 007 의 `UPDATE` 와
**같은 값**이어야 한다.

## ⑥ 🔴 함께 고칠 검사 둘 — 안 고치면 빨간불이 난다

### `tests/schema.test.ts` — 007 을 **파일 목록 네 곳**에 더한다

지금 `001` · `003` · `005` · `006` 만 읽는다. 007 을 안 더하면 「sql 파일의 표가 전부
선언에 있고 그 반대도 그렇다」 검사가 **새 표를 「선언에만 있는 표」로 보고 깨진다.**

고칠 자리 넷 — `적힌_표`(277행 근처) · 파일별 표 목록을 세는 `it`(288행 근처) ·
`적힌_제약`(340행 근처) · `적힌_본문`(352행 근처).

⚠️ 파서(`sql파일의_표들`, 110행)는 **`CREATE TABLE` 만 본다.** `ALTER TABLE` 로 는 칸은
안 읽는다. 그러니 `sql파일의_표들('007_post_activity.sql')` 은
`['public.post_activity_keywords']` 하나다. 직접 돌려 확인하고 적어라.

### `tests/push-guard.test.ts` — 목록이 아니라 **개수와 분류**를 센다

이 파일은 표 이름을 손으로 안 박고 `schema.ts` 선언에서 뽑는다. 그래도 「23표」를 세는
자리와 「어느 쪽에도 안 든 새 표가 있으면 빨개진다」(245행) 자리가 있다. 표가 하나 늘면
그 숫자와 분류에 새 표를 넣어라. 머리말 주석의 「23표」도 함께 고쳐라 — 낡은 주석이
다음 사람을 속인다.

## ⑦ 🔴 놓치면 사고 나는 것

### ① 시드만으로는 값이 안 들어간다

`seed.ts` 는 **`stories` 만 `onConflictDoNothing`** 이다(2026-08-13 결정 4 · 4차 —
`seed.ts:646` 주석). 저쪽 DB 에 `fart-bride` 행이 이미 있어 **시드를 다시 돌려도
`post_activity_config` 가 안 채워진다.** 그래서 **007 의 `UPDATE` 가 정본**이고 `seed.ts` 는
새 DB 를 처음 세울 때만 쓴다. 둘 다 두되 값이 갈리지 않게 하라.

### ② 그림 파일·칩 색은 config 에 넣지 않는다

시안에서 나온 앱 자산이라 앱이 `id` 로 잇는다. config 에는 **글자만** 들어간다.

### ③ 값이 화면 상수와 한 글자라도 달라지면 안 된다

`finale-script.ts` 와 대조해라. 나중에 #46 이 화면을 서버 값으로 갈아 끼울 때
카드 제목·단어가 달라지면 그때 아무도 못 찾는다.

### ④ 다시 판정하면 단어 행을 **모두 지우고 다시 넣는다** (명세 4.3)

그래서 `UNIQUE (result_id, card_id, word)` 와 `ON DELETE CASCADE` 가 둘 다 필요하다.
지금은 표만 세우면 되지만, 그 제약이 없으면 #44 가 곧바로 막힌다.

### ⑤ 판정한 단어는 12개 **전부** 행이 생긴다

`missing` 도 행으로 남는다. 「없는 것」을 세려면 행이 있어야 한다. 표를 그 전제로 설계해라
(그래서 `evidence` 는 NULL 을 허용한다).

## ⑧ 손대지 마라

- ⛔ **미션 1·2** — `story_missions` · `mission_sessions` · `mission_messages`,
  `mission1-script.ts` · `mission2-script.ts`. 이름이 다 「미니게임」으로 묶여 보이지만
  **다른 활동**이다 (명세 3절). 이번 일과 코드도 표도 안 겹친다.
- ⛔ **`finale.tsx` · `finale-script.ts`** — #46 것이다. 이번엔 **읽기만** 해라.
- ⛔ **`src/report/**`** — #43 · #47 것이다.
- ⛔ **세션 상태 CHECK 제약** (`story_sessions.status` 의 `'post_activity'`). 끝내 안 쓰이는
  값이지만 **지우지 않는다** — 팀 DB 와 맞춘 값이다 (명세 4.5 · 11절).
- ⛔ **API·컨트롤러·서비스** — #45 것이다. 표까지가 네 갈래다.

## ⑨ 다 하면

- [ ] 이슈 「수용 기준」 셋을 직접 확인한다 (`gh issue view 42`) — 특히 로컬 DB 에서
      `stories` 의 `fart-bride` 행을 읽어 config 가 나오는지, 같은
      `(result_id, card_id, word)` 를 두 번 넣으면 막히는지 **실제로 넣어 봐라.**
- [ ] `pnpm typecheck` 통과 · `pnpm lint` 는 **변경 전과 같은지**만 본다 (레포에 기존 경고가
      많다).
- [ ] `pnpm test` — **기준선 대비 실패가 늘지 않았다.** 🔴 **시작하자마자 아무것도 고치기 전에
      한 번 돌려 기준선을 재 둬라.** DB 검사가 시간제한에서 흔들려 돌릴 때마다 숫자가 다르다.

```bash
git add -A
git commit    # 아래 형식
git push -u origin rlaqudwn1/issue-42-post-activity
```

커밋 메시지는 이 레포의 결을 따른다 — **첫 줄은 한국어 한 문장, 끝에 ` — #42`**.
본문에 「무엇을 왜」와 「확인한 것」. `git log -3` 을 본보기로 봐라. 끝에 트레일러:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

⛔ **PR 을 열지 마라. 머지하지 마라.** 푸시까지만 하고 마지막 답변에 상황을 적어라.
본선 세션이 합치고, 팀 Supabase 에는 그다음에 넣는다.

## ⑩ 막히면

- 판단이 갈리면 **명세를 이긴다고 생각하지 말고** 명세대로 하고, 이상한 점을 적어라.
- 명세에 없는 것을 정해야 하면 **가장 되돌리기 쉬운 쪽**을 고르고 그 사실을 적어라.
- 이 레포의 엔진 쪽 코드(`src/llm` · `src/report` · `src/session`)는 **한국어 식별자와
  한국어 주석**을 쓴다. 주변 코드의 결을 따라라.
- 🔴 **표 이름·칸 이름을 명세와 다르게 바꾸고 싶어지면 바꾸지 말고 보고해라.** 뒤의 다섯
  갈래가 그 이름 위에 선다.
