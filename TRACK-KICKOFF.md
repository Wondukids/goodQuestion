# 갈래 P-5 — 리포트 화면 배선 (이슈 #39)

> 이 워크트리는 **혼자 도는 병렬 갈래**다. 앞 대화도 프로젝트 메모리도 없다.
> 이 문서 하나로 시작할 수 있게 썼다. **먼저 끝까지 읽어라.**

## ⓪ 여기가 무슨 프로젝트인가

6~9세 아이가 옛이야기(「방귀 뀌는 며느리」) 속 캐릭터와 **말로 대화하는** 앱이다.
아이가 한 말을 LLM 이 읽고 「감정을 말했나 · 까닭을 붙였나」 같은 **사고 요소 8종**을
찾아 DB 에 기록한다. 활동이 끝나면 그 기록을 모아 **보호자에게 보여 줄 리포트 한 장**을
만드는데, 그 화면이 이 갈래다.

## ① 네가 할 일 — 한 줄

**화면은 이미 다 서 있다. 그 안에 박힌 하드코딩 목업을 API 값으로 갈아끼운다.**

## ② 🔴 오해하기 쉬운 자리 — 화면을 만들지 마라

리포트 화면은 다른 사람이 시안대로 만들어 넣었다 (PR #33, 2026-08-15 머지).
**컴포넌트 트리 · 좌표 · 색 · 반응형을 손대지 마라.** 이미 서 있다.

```
지금   page.tsx → buildReport(child.name)  → 상수 더미 (RADAR·SKILLS·WORD_GROUPS·…)
할 것  page.tsx → GET /api/reports/{id}    → 어댑터 → 같은 Report 모양
```

`src/lib/report.ts` 머리말이 이렇게 적어 뒀다 — 「나중에 분석이 붙으면 **이 파일만
조회로 바꾸면 된다**」. 그 말 그대로다. `Report` 타입이 `ReturnType<typeof buildReport>`
라서, **같은 모양을 내주면 컴포넌트는 한 줄도 안 고쳐도 된다.** 어댑터 한 겹이 몸통이다.

## ③ 시작하기 전에 읽을 것 (전부 이 워크트리에 있다)

| 순서 | 파일 | 무엇 |
|---|---|---|
| 1 | `docs/보호자_리포트_프론트_계약.md` | 🔴 **정본.** 1절 타입 · 2절 규칙 다섯 · **4절 샘플 응답 둘** |
| 2 | `src/lib/report.ts` | 🔴 **네 전장.** 249줄이 전부 목업 상수다 |
| 3 | `src/report/types.ts` | 서버가 주는 값의 선언 (`ParentReport` 등) |
| 4 | `src/components/report/*.tsx` | 화면 넷. **읽되 고치지 마라** |
| 5 | `docs/보호자_리포트_명세.md` 3절 | 시안 칸마다 값이 어디서 오는지 대조표 |

이슈 원문에 **어긋나는 자리 넷**이 코드까지 붙어 정리돼 있다: `gh issue view 39`

## ④ 환경 세팅 — 이것부터

이 워크트리에는 **git 이 추적하지 않는 파일이 없다.**

```bash
pnpm install                                                    # node_modules 가 없다
cp "C:/Users/rlaqu/Documents/GitHub/goodQuestion-wondukids/.env.local" .env.local
```

### 🔴 복사한 뒤 `DATABASE_URL` 을 반드시 로컬로 바꿔라

본선 `.env.local` 의 `DATABASE_URL` 은 **팀 레포의 라이브 Supabase** 를 가리킨다.
그 DB 에는 **진짜 아이 계정 8행**이 들어 있고, `vitest` 는 진짜 DB 에 행을 넣고 지운다.

```
DATABASE_URL="postgresql://postgres:gqlocal@127.0.0.1:5432/goodquestion_ts"
```

로컬 도커 컨테이너 `gq-pg` 가 이미 떠 있다. ⛔ `drizzle-kit push` 는 어떤 이유로도 치지 마라.

## ⑤ 🔴 API 가 아직 없다 — 그게 정상이다

네가 부를 네 경로는 **#38 갈래가 만드는 중이고 아직 없다.**

| 메서드 · 경로 | 언제 |
|---|---|
| `GET /api/children/{child_id}/reports` | 상단 활동 드롭다운을 채울 때 |
| `GET /api/reports/{session_id}` | 리포트 한 장을 그릴 때 |
| `POST /api/reports/{session_id}/read` | 보호자가 처음 열었을 때 |
| `POST /api/reports/{session_id}/regenerate` | 「다시 만들기」. **3회 넘으면 429** |

⛔ **이 라우트들을 네가 만들지 마라.** #38 의 몫이다. 겹치면 합칠 때 사람이 손으로 푼다.

**그래서 확인은 이렇게 한다** — 계약 문서 **4절의 샘플 응답 둘**을 그대로 붙여 넣어
검사로 돌린다. 그 둘이 이 화면이 마주칠 양극단이다.

- **4.1** 말을 잘한 아이 — 두 탭이 다 차는 판
- **4.2** 짧게만 답한 아이 · 첫 활동 — `narrative: null` · 축 0 · 빈 칸이 생기는 판

어댑터를 **순수 함수**로 떼어 두면 그 둘로 바로 잴 수 있다. 그렇게 짜라.

```ts
// 예시 — 이름과 자리는 네가 정해라
export function toReportView(report: ParentReport, childName: string): Report
```

리포트가 아직 없는 아이(활동 전)는 **실제로 생기는 상태**다. `404` 를 빈 화면이 아니라
안내로 받아라.

## ⑥ 🔴 계약과 어긋나는 자리 넷 — 어댑터가 흡수한다

**화면을 서버 쪽 모양으로 끌어오지 말고 어댑터가 맞춰 준다.**

### ① 오각형 값이 0~100 이다

`radar-chart.tsx:70·81` 이 `axis.value / 100` 을 쓴다. 그런데 서버가 주는
`axes[*].score` 는 **감지된 발화 수 그대로**다 (결정 R17 — 카드의 "이번 활동에서 5번
나왔어요"와 **같은 값**이라서 따로 계산하면 두 숫자가 어긋난다).

```ts
const max = Math.max(...Object.values(metrics.axes).map(a => a.score))
value = max === 0 ? 0 : Math.round(axis.score / max * 100)
```

⚠️ **`max === 0` 이면 오각형 대신 안내 문구**를 낸다 (계약 2절 ①). 발화가 아주 적은
활동에서 실제로 일어난다 — 샘플 4.2 가 그 판이다.

### ② 축 이름과 **순서**가 다르다

- 이름 — 화면은 「관점과 공감」(**공백 있음**), 서버는 `'관점과공감'`.
- 🔴 순서 — `RADAR` 배열은 **시계방향 좌표 순서**다:
  `관점과 공감 → 감정 표현 → 상호작용 → 생각과 이유 → 결과와 해결`.
  서버 `AxisName` 선언 순서와 **다르다.** `Object.values(axes)` 를 그대로 쓰면
  **오각형이 엉뚱하게 돈다.** 이름으로 찾아 배열 순서를 지켜라.
- `RadarAxis` 의 `color` 와 `label:{x,y}` 는 **화면 상수다. 서버에서 받지 않는다.**
  지금 있는 상수에서 이어 붙여라.

### ③ 인용이 글자로 박혀 있다

화면의 `SkillDetail.quote` · `highlight.quote` · `StoryQuestion.quote` 가 전부 문자열이다.
서버는 **`quote_message_id`** 로 준다 — LLM 이 없는 발화를 지어내 따옴표 안에 넣는 것을
막는 설계 전부가 여기 걸려 있다.

```ts
const quote = metrics.quotes.find(q => q.message_id === card.quote_message_id)
```

서버가 목록 밖 id 를 이미 버렸으므로 **찾으면 반드시 있다.** 다만 **`null` 이면 인용
없이 그린다.**

### ④ 목업 문구 하나가 결정 R22 를 어긴다

「표현」 카드 목업이 「인물의 말투와 기분을 **목소리에** 담아 실감나게 말했어요」다.
**음성을 저장하지 않으므로** 목소리·톤·크기를 말하는 문장은 금지다. 실제 값이 붙으면
사라지지만, **목업을 참고해 문구를 짜지 마라.**

## ⑦ 계약 2절이 요구하는 나머지

- `status === 'metrics_only'` → 문장 칸을 **빈 칸이 아니라 안내 문구**로 + 「다시 만들기」를
  눈에 띄게.
- `prior_activities === 0` → 「새로 쓴 낱말」 라벨을 **「처음 만난 낱말」**로.
- `completed === false`(중단한 활동) → 화면을 **숨기지 않는다.** 모자란 칸은
  「이번엔 모인 말이 적어요」로.
- `read_at === null` → 점을 찍고, 열 때 `POST .../read` 를 **한 번**.
- 상단 활동 드롭다운을 목록 API 로 채운다. ⚠️ 지금 `activity` 는
  `{ story: "「방귀 뀌는 며느리」", date: "8월 3일" }` **고정값**이다.
- 대상 아이는 선택된 아이 쿠키 그대로 (`requireSelectedChild()` — 이미 그렇게 돼 있다).
- 「대답이 짧을 땐 3단계」(`FOLLOW_UP_STEPS`)는 **서버에서 안 온다. 프론트 상수로 둔다.**
- 마이페이지 진입 카드(`src/components/mypage/parent-report-card.tsx`)는 **그대로 두고
  미읽음 점만** 붙인다.
- 미션 발화 인용의 `scene_label` 은 「미션 · 배 따기」 꼴로 온다 (2026-08-15 사람이 정함).
  **「장면 N ·」 꼴만 온다고 가정하지 마라.**

## ⑧ 끝났다고 말할 수 있는 조건

- [ ] 계약 4.1 샘플을 넣으면 두 탭이 다 찬다.
- [ ] 계약 4.2 샘플(`narrative: null` · 첫 활동 · 축 0)에서 화면이 안 깨지고
      안내 문구 · 「처음 만난 낱말」 · 「다시 만들기」가 전부 보인다.
- [ ] 축이 전부 0 인 활동에서 오각형 대신 안내 문구가 나온다.
- [ ] 오각형 다섯 꼭짓점이 **시안과 같은 자리의 축 이름**을 가리킨다 (순서 뒤집힘 없음).
- [ ] `quote_message_id` 가 `null` 인 카드가 인용 없이 그려진다.
- [ ] 리포트가 없는 아이(404)에서 빈 화면이 아니라 안내가 나온다.
- [ ] `src/lib/report.ts` 에 남은 하드코딩이 **화면 상수(색·좌표·고정 문구)뿐**이다.
- [ ] `pnpm typecheck` · `pnpm lint` 통과.
- [ ] `pnpm test` — **이 변경 전과 실패 개수가 같거나 줄었다.** 늘었으면 네가 깬 것이다.
      (시작하자마자 기준선을 한 번 재 두어라.)

## ⑨ 남의 갈래를 건드리지 마라

지금 **네 갈래가 동시에 돈다.**

| 갈래 | 만지는 곳 |
|---|---|
| P-1 (#35) | `sql/006_*.sql` · `src/llm/db/schema.ts` · `src/llm/db/seed.ts` |
| P-2 (#36) | `src/report/domain/` · `tests/report-metrics.test.ts` |
| P-3 (#37) | `prompts/report_*/` · `src/report/engine/` · `tests/prompts.test.ts` |
| **P-5 (너, #39)** | `src/lib/report.ts` · `src/app/report/page.tsx` · `parent-report-card.tsx` · 어댑터 검사 |

- ⛔ **`src/report/types.ts` 를 고치지 마라.** 네 갈래가 공유하는 계약이고 프론트 계약
  문서 1절을 그대로 옮긴 것이다. 모자란 게 있으면 **고치지 말고 마지막 답변에 적어라.**
- ⛔ **`src/app/api/**` 라우트를 만들지 마라.** #38 의 몫이다.
- ⛔ **`src/report/domain/` · `src/report/engine/` 에 손대지 마라.**
- ⛔ **`src/components/report/*.tsx` 의 레이아웃·색·좌표를 고치지 마라.** 값을 물리는
  일이지 화면을 고치는 일이 아니다. 정말 고쳐야 하면 **왜 고쳤는지 커밋 본문에 적어라.**

## ⑩ 다 하면

```bash
git add -A
git commit    # 아래 형식
git push -u origin rlaqudwn1/issue-39-report-screen
```

커밋 메시지는 이 레포의 결을 따른다 — **첫 줄은 한국어 한 문장, 끝에 ` — #39`**.
본문에는 「무엇을 왜」와 「확인한 것」을 적는다. 최근 커밋(`git log -3`)을 본보기로 봐라.

트레일러 두 줄을 끝에 붙인다:

```
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01FKq5C6XMcXiiNAqikbRdfi
```

⛔ **PR 을 열지 마라. 머지하지 마라.** 푸시까지만 하고, 무엇을 했고 무엇이 남았는지
마지막 답변에 적어라. 본선 세션이 갈래들을 모아 합친다.

## ⑪ 막히면

- 판단이 갈리는 자리가 나오면 **계약 문서를 이긴다고 생각하지 말고** 계약대로 하고,
  이상하다고 느낀 점을 마지막 답변에 적어라.
- 계약에 없는 것을 정해야 하면 **가장 되돌리기 쉬운 쪽**을 고르고 그 사실을 적어라.
- 이 레포의 **엔진 쪽 코드**(`src/llm` · `src/report`)는 한국어 식별자와 한국어 주석을
  쓰고, **아이 앱 화면 쪽**(`src/app` · `src/components` · `src/lib`)은 영어 식별자에
  한국어 주석이다. **주변 코드의 결을 따라라** — 네가 만지는 곳은 대부분 화면 쪽이다.
