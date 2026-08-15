# 갈래 후-4 — 후활동 API 넷 (이슈 #45)

> 이 워크트리는 **혼자 도는 갈래**다. 앞 대화도 프로젝트 메모리도 없다.
> 이 문서 하나로 시작할 수 있게 썼다. **먼저 끝까지 읽어라.**

## ⓪ 여기가 무슨 프로젝트인가

6~9세 아이가 옛이야기(「방귀 뀌는 며느리」) 속 캐릭터와 **말로 대화하는** 앱이다.
이야기를 다 보고 나면 활동이 하나 더 있다 — **말하기 후 활동**. 장면 카드 넉 장을
이야기 순서대로 놓고(1단계), 그 카드와 **핵심 단어 12개**를 보면서 줄거리를 통째로
들려주는(2단계) 활동이다.

**앞 갈래 넷이 조각을 다 만들어 두었다. 그런데 아무도 부르지 않는다.**
표도 있고, 판정 엔진도 있고, 리포트 만드는 시점도 옮겨 뒀는데 **HTTP 로 내는 자리가 없다.**

## ① 네가 할 일 — 한 줄

**API 넷을 내서 앞 갈래들의 조각을 하나로 잇는다. 네가 마지막 관문이다.**

이 갈래가 서기 전에는 아이 앱이 후활동을 서버와 주고받을 길이 아예 없다.

## ② 🟢 이미 다 있는 것 — 새로 만들지 마라

| 있는 것 | 어디 | 무엇 |
|---|---|---|
| 표 둘 | `src/llm/db/schema.ts` | `post_activity_results`(세션당 한 행) · `post_activity_keywords` — ⭕ 로컬·팀 DB 에 **이미 섰다** |
| 카드·단어 값 | DB `stories.post_activity_config` | 카드 넉 장·정답 순서(`answer_order`)·섞인 순서(`tray_order`) |
| **판정 엔진** | `src/post-activity/` | `judgeRetellingKeywords()` — 규칙 → LLM 한 번 → 근거 대조를 다 한다 |
| **리포트 시점** | `src/report/service/generate.ts` | `queueReport()` — ⭕ 이미 「후활동을 기다리게」 고쳐져 있다 |
| 받아쓰기(STT) | `src/stt/server.ts` | `recognizeSpeech(오디오, 채널)` · `SttError` |
| 봉투 | `src/session/controller/envelope.ts` | `ok()` · `fail()` · `failed()` |
| 층 규칙 | `src/session/README.md` | 🔴 **읽어라.** 라우트는 한 줄 재-내보내기 |

## ③ 시작하기 전에 읽을 것

| 순서 | 파일 | 무엇 |
|---|---|---|
| 1 | `docs/말하기후활동_명세.md` **5절** | 🔴 **정본.** API 넷 A~D · 오류 코드 |
| 2 | 같은 문서 4.2·4.3 | 칸의 뜻. 특히 `is_order_correct` 와 `analyzed_at` |
| 3 | `src/session/controller/missions.ts` | 컨트롤러가 어떻게 생겼는지 (같은 결로 써라) |
| 4 | `src/session/service/mission.ts` | 서비스 층의 결 |
| 5 | `src/post-activity/README.md` · `index.ts` | 판정 엔진을 어떻게 부르나 |

이슈 원문: `gh issue view 45`

## ④ 환경 세팅 — 이것부터

```bash
pnpm install                                                    # node_modules 가 없다
cp "C:/Users/rlaqu/Documents/GitHub/goodQuestion-wondukids/.env.local" .env.local
npx next typegen                       # .next/types 가 없어 typecheck 가 7개 헛터진다
```

🔴 검사를 돌릴 때는 `DATABASE_URL` 을 **로컬로** 바꿔라. 본선 값은 팀의 라이브 Supabase 라
레포 가드가 DB 검사를 막는다.

```
DATABASE_URL="postgresql://postgres:gqlocal@127.0.0.1:5432/goodquestion_ts"
```

로컬 도커 `gq-pg` 에 **007 까지 먹여져 있다.** ⛔ `drizzle-kit push` 금지.
⛔ 팀 Supabase 에 쓰지 마라 (읽기만 해도 그 주소로는 vitest 를 돌리지 마라).

## ⑤ 만들 것 — 라우트 넷

로직은 `src/session/controller/post-activity.ts`, `src/app/api/**/route.ts` 는 **한 줄
재-내보내기**다. 서비스 층은 `src/session/service/post-activity.ts`.

| | 길 | 무엇 |
|---|---|---|
| A | `GET /api/sessions/{sid}/post-activity` | 활동 열기 — `config` + 지금까지의 `result` |
| B | `POST …/post-activity/order` | 순서 제출 (누를 때마다) |
| C | `POST …/post-activity/retelling` | 녹음 보내기 → 받아쓰기 → 판정 |
| D | `POST …/post-activity/complete` | 활동 종료 — ⭐ **리포트를 띄운다** |

봉투는 `{ ok: true, data }` / `{ ok: false, error }` 다. 명세 5절이 각 응답의 모양을
글자까지 적어 두었으니 **그대로** 내라.

### 🔴 B — 순서 제출에서 틀리기 쉬운 것 셋

- **서버가 `answer_order` 와 대조해 `is_correct` 를 스스로 계산한다.** 앱이 보낸 판정을
  받지 마라.
- **`submitted_order` 는 첫 호출에만 쓴다** — 이미 값이 있으면 **덮지 않는다** (F7).
  「한 번에 맞췄나」와 「어떤 카드를 헷갈렸나」가 둘 다 남아야 한다.
- **`is_order_correct` 는 「끝내 맞췄나」**다 (F18). 맞은 회차에 `true` 로 올리고, 그 뒤로
  내리지 않는다. 「첫 제출이 정답이었나」는 `attempt_count = 1` 로 안다.
- 행이 없으면 **이때 만든다** — 순서 단계가 곧 첫 저장 시점이다 (F8).

### 🔴 C — 녹음 받기에서 틀리기 쉬운 것 넷

- **받아쓴 글을 판정보다 먼저 저장한다.** 판정이 실패해도 아이 말은 남아야 한다.
- **LLM 판정 실패는 오류가 아니다** — `{ text, analyzed: false, keywords: null }` 로
  **200** 을 준다. `analyzed_at` 은 NULL 로 남는다. 아이 화면은 끝까지 진행된다 (F4·F8).
- 아무 말도 안 담겼으면 `{ empty: true }` — **아무것도 저장하지 않는다.**
- 다시 판정하면 그 결과의 단어 행을 **모두 지우고 다시 넣는다** (명세 4.3).

> ⚠️ **명세와 실제 코드가 어긋나는 자리 하나.** 명세 5.C 는 `multipart/form-data` 라고
> 적었지만, 실제 대화 턴 API(`src/session/controller/turn.ts:34`)는 **녹음을 본문에 그대로
> 싣고 채널 수를 `x-audio-channels` 헤더**로 받는다. 명세의 뜻은 「대화 턴 API 와 같은
> 모양」이므로 **실제 관례를 따르고, 그 사실을 커밋 본문과 마지막 답변에 적어라.**
> (앱을 배선하는 #46 갈래가 그 모양대로 보내야 한다.)

### 🔴 D — 활동 종료: 여기가 리포트를 띄우는 자리다

- `reason: 'finished'` → `completed_at` 을 채운다 · `'left'` → **NULL 로 둔다.**
- **둘 다 리포트를 띄운다** (F11) — `queueReport(session_id)` 를 부르고 **기다리지 않는다.**
- 🔴 **`후활동을_기다린다` 곁다리를 넘기지 마라.** 그건 「세션이 끝나는 자리」 전용이다.
  여기서 넘기면 후활동이 있는 이야기의 리포트가 **영영** 안 만들어진다.
  (`queueReport()` 머리말의 표를 읽어라 — 네 자리가 거기 적혀 있다.)
- **반복 호출은 안전해야 한다.** 아이가 마치고 끝 화면을 떠나면 이 API 가 두 번 불린다.
  두 번째는 아무 일도 안 일어나야 한다.
- **세션 상태는 건드리지 마라** — 이미 `completed` 다 (F10).

## ⑥ 🔴 그 밖에 놓치면 사고 나는 것

### ① 세션 상태 `post_activity` 를 되살리지 마라

한때 그러려다 **접었다**(F5). 활동을 안 하고 앱을 꺼버린 아이의 세션이 그 상태에 영영
갇힌다. 체크 제약에 값이 남아 있지만 **쓰지 않는 값**이다.

### ② 문지기 — 아직 안 끝난 이야기

세션이 `completed` 가 아니면 409 `POST_ACTIVITY_NOT_ALLOWED`.
그 이야기에 `post_activity_config` 가 없으면 404 `POST_ACTIVITY_NOT_CONFIGURED` —
앱은 그때 활동 버튼을 **아예 그리지 않는다.**

### ③ 오류 코드 이름이 기존과 어긋나는 자리

명세 5.E 는 STT 실패를 `STT_FAILED`(502·`retryable: true`)로 적었는데, 기존 턴 API 는
`STT_UNAVAILABLE` 을 쓴다. **명세를 따르고 어긋남을 적어라** — 앱 갈래(#46)가 그 이름으로
받는다.

### ④ `llm_calls` 에 판정 호출을 남기려면 CHECK 를 넓혀야 한다

`llm_calls_purpose_check` 가 아직 넷만 받는다 (`src/llm/db/schema.ts:841`).
`'retelling_keywords'` 를 남기려면 **마이그레이션 `sql/008` 이 하나 더 든다.**
🟡 **판정 자체는 그 표를 안 타므로 안 남겨도 돌아간다.** 남길지 말지 네가 정하고,
남긴다면 `sql/005_missions.sql` 이 같은 CHECK 를 넓힌 방식을 그대로 따라라
(⚠️ 그 경우 팀 DB 적용이 또 필요하니 **마지막 답변에 반드시 적어라**).

### ⑤ 판정을 못 하면 `words` 가 `null` 로 온다

①규칙이 찾아 둔 `used` 까지 함께 버려진다 — 일부러 그렇다. 반만 판정한 12행을 저장하면
화면이 나머지를 「아이가 안 썼어요」로 읽는다. **그때는 단어 행을 아예 저장하지 마라.**

## ⑦ 손대지 마라

- ⛔ **`src/post-activity/**`** — 판정 엔진은 앞 갈래가 끝냈다. 버그를 찾았으면 **고치지 말고
   보고해라** (정말 못 넘어갈 자리면 최소한으로 고치고 커밋 본문에 왜인지 적어라).
- ⛔ **`prompts/**`** — 프롬프트 글을 고치면 검사(태그 짝 90쌍)가 함께 흔들린다.
- ⛔ **`src/report/**`** — 리포트 시점 이관은 끝났다. `queueReport()` 를 **부르기만** 해라.
- ⛔ **`src/report/types.ts`** — 공유 계약. `metrics.post_activity` 를 채우는 것은 #47 이다.
- ⛔ **화면 파일** (`finale.tsx` · `finale-script.ts` · `play.tsx` · `minigame-popup.tsx`) —
   #46 것이다. 앱 배선은 네 일이 아니다.
- ⛔ **미션 1·2** (`mission_*` · `src/session/controller/missions.ts` · `service/mission.ts`) —
   이름이 다 「미니게임」으로 묶여 보이지만 **다른 활동**이다 (명세 3절). 본보기로 **읽기만** 해라.
- ⛔ `sql/001`~`007` 을 고치지 마라. 표는 다 서 있다 (⑥④의 경우만 예외로 `008` 을 새로).

## ⑧ 다 하면

- [ ] 명세 9절의 **수용 기준 3·4·5·6·10** 을 검사로 남긴다:
      3. 두 번 틀리고 세 번째에 맞추면 → `submitted_order` = **첫 번째** 순서 ·
         `attempt_count` = 3 · `is_order_correct` = true
      4. 순서만 맞추고 닫으면 행이 남고 `retelling_text` 는 NULL
      5. 줄거리를 말하면 `retelling_text` 가 차고 단어 **12행**이 생긴다
      10. **LLM 을 죽여 놓고 돌려도** 200 · `analyzed: false` · `retelling_text` 는 저장됨 ·
          `analyzed_at` 은 NULL
- [ ] 11·12·14 도 확인한다 — 「마치기」로 리포트가 생기고, 활동을 건너뛰고 떠나도 생기고,
      **이야기가 끝난 것만으로는 안 생긴다.**
- [ ] 🔴 **LLM·STT 는 갈아 끼워 검사한다.** 진짜 API 를 치지 마라(돈이 나가고 흔들린다).
- [ ] `pnpm typecheck` 통과 · `pnpm lint` 는 변경 전과 같은지만 본다.
- [ ] `pnpm test` — **기준선 대비 실패가 늘지 않았다.** 🔴 시작하자마자 아무것도 고치기 전에
      한 번 돌려 기준선을 재 둬라. DB 검사가 5초 제한에서 흔들려 회차마다 크게 다르다
      (같은 트리에서 2·21·48 실패가 나온 적이 있다). **짝지어 견줘라.**

```bash
git add -A
git commit    # 첫 줄은 한국어 한 문장, 끝에 ` — #45`
git push -u origin rlaqudwn1/issue-45-post-activity-api
```

본문에 「무엇을 왜」와 「확인한 것」. `git log -3` 을 본보기로 봐라. 끝에 트레일러:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

⛔ **PR 을 열지 마라. 머지하지 마라.** 푸시까지만 하고 마지막 답변에 상황을 적어라.

**마지막 답변에 꼭 적을 것** — ⑤의 녹음 전송 모양(본문+헤더)과 ⑥③의 오류 코드 이름,
그리고 `sql/008` 을 만들었는지. **그 셋을 다음 갈래(#46 앱 화면)가 그대로 받아야 한다.**

## ⑨ 막히면

- 판단이 갈리면 **명세를 이긴다고 생각하지 말고** 명세대로 하고, 이상한 점을 적어라.
- 명세에 없는 것을 정해야 하면 **가장 되돌리기 쉬운 쪽**을 고르고 그 사실을 적어라.
- 엔진 쪽 코드(`src/llm` · `src/report` · `src/session` · `src/post-activity`)는
  **한국어 식별자와 한국어 주석**을 쓴다. 주변 코드의 결을 따라라.
