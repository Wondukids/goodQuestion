# 후-5 · 이슈 #46 — 앱 화면을 후활동 API 넷에 잇는다

> 이 문서 하나만 읽고 일할 수 있게 썼다. 브랜치 `rlaqudwn1/issue-46-post-activity-front`

## 0. 한 줄

**화면은 이미 다 만들어져 있다.** `src/stories/fart-bride/minigame/finale.tsx` 는 순서
맞추기도 녹음도 다 돈다 — 지금은 `/dev/minigame` 에서 상수를 보고 혼자 돌 뿐이다.
이 갈래가 할 일은 **그 화면을 서버 API 넷에 잇는 것**이다. 화면을 새로 그리는 게 아니다.

⛔ **문구·색·좌표·연출은 한 글자도 바꾸지 않는다.**

## 1. 정본

- 무엇을 바꾸나 — `docs/말하기후활동_명세.md` **8절 「프론트 변경 목록」** (다섯 줄)
- API 계약 — **5절 A~D** (요청·응답·오류 코드)
- 끝났다는 조건 — **9절 수용 기준 1·2·10**

앞 갈래 넷이 이미 붙었다: 표(#42) · 리포트 시점(#43) · 판정 엔진(#44) · **API 넷(#45)**.
서버는 다 서 있다. 이 갈래는 **앱만** 고친다.

## 2. 서버가 내주는 것 (#45 가 방금 붙였다 — `src/session/controller/post-activity.ts`)

봉투는 세션 API 그대로다: 성공 `{ ok: true, data }` · 실패 `{ ok: false, error: { code, message, retryable } }`.

| | 길 | 보내는 것 | 받는 것 |
|---|---|---|---|
| A | `GET /api/sessions/{sid}/post-activity` | 없음 | `{ config, result }` |
| B | `POST …/post-activity/order` | `{ submitted_order: string[] }` | `{ is_correct, attempt_count }` |
| C | `POST …/post-activity/retelling` | **녹음 바이너리 본문** | `{ empty: true }` 또는 `{ text, analyzed, keywords }` |
| D | `POST …/post-activity/complete` | `{ reason: 'finished' \| 'left' }` | `{ report: 'queued' \| 'exists' }` |

- `config` — `{ cards: [{id,title,keywords}], answer_order: string[], tray_order: string[] }`.
  **읽은 그대로** 온다. 이게 정본이고 화면 상수가 아니다 (수용 2).
- `result` — `{ submitted_order, is_order_correct, attempt_count, retelling_text, completed_at }`.
  아직 아무것도 안 했으면 전부 `null`/`0` 이다. **중간에 나갔다 돌아온 아이의 자리를 되살리는
  재료**다 — 쓸지 말지는 이 갈래가 판단해라 (명세는 「함께 준다」까지만 정했다).

### 오류 코드

| 코드 | HTTP | 뜻 |
|---|---|---|
| `SESSION_NOT_FOUND` | 404 | 그런 세션이 없다 |
| `POST_ACTIVITY_NOT_CONFIGURED` | 404 | **이 이야기엔 후활동이 없다** → 버튼을 아예 안 그린다 |
| `POST_ACTIVITY_NOT_ALLOWED` | 409 | 이야기가 아직 안 끝났다 |
| `BAD_REQUEST` | 400 | 앱 버그다 |
| `STT_FAILED` | 502 | 받아쓰기 실패 (`retryable: true`) |

## 3. 🔴 모르고 넘어가면 사고 나는 것 여섯

### ① 녹음은 `multipart/form-data` 가 **아니다**

명세 5.C 는 multipart 라고 적었지만 **실제 서버는 그렇게 안 받는다.** #45 가 대화 턴
API 의 실제 관례를 따랐다:

```
POST …/post-activity/retelling
Content-Type: application/octet-stream
X-Audio-Channels: <채널 수>
body: 녹음 바이너리 그대로
```

`src/stories/fart-bride/session-api.ts` 에 턴을 보내는 함수가 이미 그 모양으로 있다 —
**그것을 그대로 베껴라.** 서버 코드는 `src/session/controller/post-activity.ts` 의
`POST_retelling` 이다 (`request.arrayBuffer()` + `x-audio-channels` 헤더).

### ② 받아쓰기는 이제 앱이 안 한다

지금 `finale.tsx:421` 이 `transcribeAudio(clip.audio, clip.channels)` 를 직접 부른다.
**그 자리를 `retelling` API 로 바꾼다.** 받아쓰기는 서버가 하고, 앱은 녹음만 보낸다.
(`@/stt/client` 를 이 화면에서 안 쓰게 된다.)

### ③ 「판정 실패」는 오류가 아니다

`{ text, analyzed: false, keywords: null }` 이 **200 으로** 온다. 아이 화면은 그때도
**끝까지 진행된다** (F4·F8 · 수용 10). 빨간 화면을 띄우지 마라. 서버가 죽어도 아이의
말은 이미 저장돼 있다.

`{ empty: true }` 는 아무 말도 안 담긴 것이다 — 지금 화면이 무음일 때 하는 연출을 그대로 쓴다.

### ④ 끝 화면을 **떠나는 모든 길**에서 `complete(reason:'left')` 를 부른다

명세 8절 ①. 다시 보기 · 이야기 소개로 · 뒤로가기 — **전부**다. 이 신호가 리포트를
만드는 자리다(F11). 안 부르면 보호자가 리포트를 열 때까지 리포트가 없다.

「마치기」를 눌렀으면 `reason:'finished'` 다. **두 번 불러도 안전하다** — 마치고 나서
끝 화면을 떠나면 `finished` 뒤에 `left` 가 한 번 더 가는데 서버가 그것을 삼킨다.
그러니 「이미 불렀나」를 앱이 관리하려 들지 마라. 실패해도 팝업은 닫힌다 (F4).

### ⑤ 순서 판정은 화면이 하던 대로 두고, API 는 **기록용**으로 함께 부른다

명세 8절 ③. 「맞은 카드는 남기고 나머지만 트레이로」(`finale.tsx:83-89`)는 **지금 그대로**다.
서버 응답(`is_correct`)을 **기다리지 않는다** — 아이 화면이 네트워크를 기다리면 안 된다.
「다 놓았어요!」를 누를 때마다 `order` 를 부르고 답은 흘려도 된다.

### ⑥ ⛔ 미션 1·2 코드에 손대지 않는다

`minigame-popup.tsx` 의 `mission === 1` · `mission === 2` 갈래(55~63행)와
`mission1*.tsx` · `mission2*.tsx` 는 **한 줄도 안 건드린다.** 후활동은 `mission === 3` 이고
**미션 세션 배선 넷(`wiring`)을 안 쓴다** — 자기 API 를 쓴다 (명세 8절 ②).

이름이 다 「미니게임」으로 묶여 보여도 다른 활동이다. 이 지시는 사람이 두 번 못박았다.

## 4. 손댈 파일 (명세 8절)

| 파일 | 무엇 |
|---|---|
| `src/stories/fart-bride/session-api.ts` | 후활동 API 넷을 부르는 함수를 **여기에** 더한다 (기존 관례·오류 처리 그대로) |
| `src/stories/fart-bride/play.tsx` | 끝 화면에 「이야기 순서 맞추기」 버튼 · `MinigamePopup mission={3}` · 떠나는 길마다 `complete('left')` |
| `src/stories/fart-bride/minigame-popup.tsx` | `mission === 3` 에 세션 배선을 넘긴다 (64행 갈래) |
| `src/stories/fart-bride/minigame/finale.tsx` | 상수 대신 서버 `config` · `order` 호출 · 녹음을 `retelling` 으로 · 「마치기」에 `complete('finished')` |
| `src/stories/fart-bride/minigame/finale-script.ts` | `keywords`·`TRAY_ORDER` 는 **서버 값이 정본**이 된다. 상수는 비상용으로 **남겨 둔다** (지우지 마라) |
| `src/app/dev/minigame/*` | 목 어댑터에 후활동 API 넷을 더해 서버 없이도 전 흐름이 돈다 (`mock-mission-api.ts` 와 같은 결) |

⛔ **손대지 않는 곳** — `src/session/**` · `src/llm/**` · `src/post-activity/**` ·
`src/report/**` · `prompts/**` · `sql/**` · 미션 1·2 · 관리자 화면.
(서버는 #45 가 끝냈다. 서버를 고쳐야 할 것 같으면 **고치지 말고 커밋 본문에 적어라.**)

## 5. 끝내는 조건

- 명세 9절 **수용 1·2·10**
  1. 이야기를 끝까지 보면 끝 화면에 「이야기 순서 맞추기」 버튼이 있고, 누르면 활동이 열린다.
  2. 카드 제목·필수 단어가 **DB 값**으로 그려진다 — `post_activity_config` 를 고치면 화면이 바뀐다.
  10. LLM 을 죽여 놓고 돌려도 화면은 끝까지 진행된다.
- `pnpm test` · `pnpm typecheck` 통과. `pnpm lint` 가 **변경 전보다 늘지 않는다.**
  (손대기 전 숫자를 먼저 재 두고 견줘라 — 이미 빨간 것이 몇 개 있다.)
- 검사는 화면 단위로 짜라 (`tests/report-screen.test.ts` 가 그 결의 본보기다).

## 6. 잔손

- `.env.local` 의 `DATABASE_URL` 은 **로컬 도커**(`127.0.0.1:5432/goodquestion_ts`)여야
  검사가 돈다. 팀 Supabase 를 가리키면 검사가 스스로 막는다 (일부러 그렇다).
- 새 워크트리에서 `pnpm typecheck` 가 `LayoutProps`/`PageProps` 로 여러 개 터지면
  `npx next typegen` 을 한 번 돌린다 (`.next/types` 가 없어서다).
- 커밋 메시지는 한국어. 무엇을 왜 골랐는지, 명세에 없어 **네가 정한 것**은 「되돌려도 된다」로
  적어 둬라.
- PR 은 열지 마라. 커밋하고 브랜치에 푸시만 하면 본선 쪽에서 확인하고 합친다.
