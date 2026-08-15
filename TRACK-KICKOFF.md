# 갈래 P-2 — 리포트 지표 집계기 (이슈 #36)

> 이 워크트리는 **혼자 도는 병렬 갈래**다. 앞 대화도 프로젝트 메모리도 없다.
> 이 문서 하나로 시작할 수 있게 썼다. **먼저 끝까지 읽어라.**

## ⓪ 여기가 무슨 프로젝트인가

6~9세 아이가 옛이야기(「방귀 뀌는 며느리」) 속 캐릭터와 **말로 대화하는** 앱이다.
아이가 한 말을 LLM 이 읽고 「감정을 말했나 · 까닭을 붙였나」 같은 **사고 요소 8종**을
찾아 DB 에 기록한다. 지금 만들려는 것은 그 기록을 모아 **활동이 끝난 뒤 보호자에게 보여 줄
리포트 한 장**이고, 그 리포트의 **숫자를 세는 부분**이 이 갈래다.

## ① 네가 할 일 — 한 줄

**읽어 온 DB 행들을 받아 `ReportMetrics` 하나를 돌려주는 순수 함수를 쓴다.**
DB 를 물지 않고 LLM 도 부르지 않는다. 같은 입력이면 언제나 같은 출력이다.

## ② 시작하기 전에 읽을 것 (전부 이 워크트리에 있다)

| 순서 | 파일 | 무엇 |
|---|---|---|
| 1 | `docs/보호자_리포트_명세.md` **4절** | 🔴 **정본.** 4.1 모양 · 4.2 축 점수 · 4.3 낱말 |
| 2 | `src/report/types.ts` | 네가 돌려줄 `ReportMetrics` 의 **선언**. 여기 있는 그대로 채운다 |
| 3 | `src/report/README.md` | 이 도메인의 층 규칙과 사고 나는 자리 셋 |
| 4 | `src/llm/elements.ts` | 사고 요소 8종 코드와 뜻 |
| 5 | `src/session/domain/progress.ts` | 이 레포의 **순수 함수 도메인**이 어떻게 생겼는지 본보기 |

이슈 원문도 볼 수 있다: `gh issue view 36`

## ③ 환경 세팅 — 이것부터

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

**다만 네 함수는 DB 를 안 문다** — 검사도 손으로 만든 행 객체로 돈다. 위 설정은 **다른
검사들을 깨지 않고 `pnpm test` 를 돌리기 위한** 것이다.

## ④ 만들 것 — `src/report/domain/metrics.ts`

DB 를 물지 않는다. **읽어 온 행들을 인자로 받는다.** 이 층은 DB 도 LLM 도 시각도 난수도
모른다 (`src/session/README.md` 의 층 규칙과 같다). 어떤 행이 오는지는 아래에 다 적었다.

### 받는 것 — 실제 표의 모양

| 표 | 어디 선언 | 이 갈래가 보는 칸 |
|---|---|---|
| `story_sessions` | `src/llm/db/schema.ts:276` | `status` · 시작/끝 시각 · `child_id` |
| `messages` | `:329` | `speaker_type`(`'child'`) · `turn_order` · `text` · `scene_id` |
| `utterance_analyses` | `:368` | `message_id` · `child_intent` · `detected_elements` · `utterance_validity` |
| `mission_messages` | `:521` | `speaker_type` · `text` · **`analysis` (jsonb — 위 네 칸의 사본)** |
| `turn_conditions` | `:695` (`gq_admin` 스키마) | `message_id`(PK) · `response_mode` |
| `story_scenes` | `:176` | `code` · `scene_order` · `vocabulary`(#35 가 붙이는 칸) |

- `detected_elements` 는 `[{ type: 'REASON', evidence: '억울하니까' | null }, …]` 다.
  **`evidence` 가 `null` 일 수 있다** — 빈 문자열로 바꾸지 마라.
- `utterance_validity` 는 `'VALID' | 'SHORT' | 'UNCLEAR' | 'OFF_TOPIC' | 'PLAYFUL'`.
- `turn_conditions.response_mode` 는 `'NORMAL' | 'GUIDED' | 'CLOSING'` (`src/llm/domain/decide.ts:99`).
- ⚠️ **미션 발화에는 `turn_conditions` 가 없다** — 미션 턴은 유도하지 않기 때문이다
  (`src/llm/domain/mission.ts:206`). 그래서 `reprompt_recovered` 는 본 대화에서만 센다.

### 세는 것

**counts** — 아이 발화 수. `messages` + `mission_messages` **둘 다** 센다 (결정 R23).
안 세면 「말한 문장 수」가 실제보다 적게 나온다.

**axes 다섯** (결정 R17) — 점수는 **그 축에 묶인 요소가 감지된 발화 수의 합**이다.

| 축 | 묶는 요소 |
|---|---|
| 관점과공감 | `PERSPECTIVE` + `EMPATHY` |
| 감정표현 | `EMOTION` |
| 생각과이유 | `DECISION` + `REASON` |
| 결과와해결 | `SOLUTION` + `RESULT` |
| 상호작용 | 요소가 아니다 (아래) |

🔴 **「이야기가 요구한 요소 대비 충족률」로 매기지 마라.** 「방귀 뀌는 며느리」 대화
4장면의 `required_elements` 합집합은 `PERSPECTIVE·EMPATHY·REASON·SOLUTION·REQUEST·RESULT`
여섯뿐이고 **`EMOTION` 과 `DECISION` 이 한 번도 없다**
(`src/llm/db/seed.ts:292 · :343 · :381 · :415`). 충족률로 매기면 시안의 「감정 표현」 축이
**항상 0**이 된다. 그래서 **감지 횟수 그대로** 센다 — 시안 카드의 "이번 활동에서 5번
나왔어요"와 **같은 값**이어야 한다. 정규화는 프론트가 그린다.

⚠️ 8요소 중 `REQUEST` 는 어느 축에도 안 들어간다 (결정 R4 — 뜻이 어긋나 안 쓴다).
**그래도 「빠뜨린 게 아니라 일부러 뺀 것」이 코드에 보이게 써라.**

**상호작용 = `child_questions` + `reprompt_recovered`**

- `child_questions` — `child_intent === 'QUESTION'` 인 아이 발화 수
- `reprompt_recovered` — `response_mode === 'GUIDED'` 인 턴 **다음** 아이 발화가
  `utterance_validity === 'VALID'` 인 횟수
- `child_turns` 는 `context` 에만 담고 **점수에 넣지 않는다** — 말수가 많을수록 커져
  「주고받았나」가 아니라 「많이 말했나」를 재게 된다

🔴 **이 공식은 실측 없이 정한 임의값이다** (위험 M1). 목데이터 10명(#40)을 돌려 본 뒤
조정한다. 그러니 **이 파일 한 곳에만** 두고, 상수는 이름을 붙여 바깥에 세워라.

**words** — `asked` · `repeated` · `main` 을 규칙이 만든다.

- `asked` — 아이의 `QUESTION` 발화 원문에 장면 낱말 목록(`story_scenes.vocabulary`)의
  낱말이 글자로 있으면 센다. **LLM 을 거치지 않는다** (결정 R15).
- `new` — 🔴 **이 갈래가 혼자 못 만든다.** LLM(#37)이 뽑은 낱말 목록을 받아
  `child_words` 와 대조하는 자리다. **낱말 목록을 인자로 받는 함수를 따로 내고**,
  안 주면 `new: []` 로 둔다 (명세 4.3 순서 그대로).

**quotes** — LLM 이 인용할 수 있는 후보 목록. `message_id · scene_code · scene_label ·
text · elements`. ⛔ **이 목록 밖의 발화는 인용될 수 없다.** `scene_label` 은 화면에 찍는
이름이라 `"장면 3 · 들켜버린 큰 방귀"` 꼴이다 (`scene_order` + 장면 이름).

⚠️ **미션 발화의 `scene_label` 은 아직 안 정해졌다** (미정 M7). 지금은 되돌리기 쉬운
쪽으로 정하고 **무엇으로 정했는지 마지막 답변에 적어라.**

**activity.prior_activities** — 이 아이의 **이전 완료 활동 수**. `0` 이면 첫 활동이고,
그때는 프론트가 「새로 쓴 낱말」 라벨을 「처음 만난 낱말」로 바꾼다 (계약 문서 2절 ③).

## ⑤ 검사 — `tests/report-metrics.test.ts`

DB 없이 도는 검사다. 손으로 만든 행 객체를 넣는다. 기존 순수 함수 검사
(`tests/progress.test.ts` · `tests/decide.test.ts`)의 결을 따라라.

- [ ] 같은 입력이면 항상 같은 출력이다 (LLM · 시각 · 난수 없음).
- [ ] **8요소가 5축에 빠짐없이 들어간다** — 빠뜨린 코드가 있으면 검사가 잡는다.
      (`REQUEST` 는 「일부러 뺐다」가 검사에도 보이게)
- [ ] 발화 3건짜리 활동에서도 안 터지고 `axes` 가 전부 0 인 결과를 낸다 (결정 R16).
- [ ] 미션 발화가 `child_utterances` 와 축 점수에 반영된다 (R23).
- [ ] `prior_activities = 0` 인 아이의 결과가 첫 활동으로 나온다.
- [ ] `GUIDED` 다음 발화가 `VALID` 일 때만 `reprompt_recovered` 가 오른다.
- [ ] `pnpm typecheck` · `pnpm lint` 통과.
- [ ] `pnpm test` — **이 변경 전과 실패 개수가 같거나 줄었다.** 늘었으면 네가 깬 것이다.

## ⑥ 남의 갈래를 건드리지 마라

지금 **세 갈래가 동시에 돈다.** 파일이 겹치면 합칠 때 사람이 손으로 푼다.

| 갈래 | 만지는 곳 |
|---|---|
| P-1 (#35) | `sql/006_*.sql` · `src/llm/db/schema.ts` · `src/llm/db/seed.ts` |
| **P-2 (너, #36)** | `src/report/domain/` · `tests/report-metrics.test.ts` |
| P-3 (#37) | `prompts/report_*/` · `src/report/engine/` · `tests/prompts.test.ts` |

- ⛔ **`src/report/types.ts` 를 고치지 마라.** 세 갈래가 공유하는 계약이고 프론트 계약
  문서 1절을 그대로 옮긴 것이다. 모자란 게 있으면 **고치지 말고 마지막 답변에 적어라.**
- ⛔ **`src/llm/db/schema.ts` 를 고치지 마라.** `story_scenes.vocabulary` 칸은 P-1 이 붙인다.
  네 브랜치에는 아직 그 칸이 없다 — **타입만 네 함수 인자 쪽에 적어 두고** 진행해라
  (`vocabulary: { word: string; meaning: string }[]`).
- 배선(`generateReport()` 호출 · API)은 **P-4(#38)의 몫**이다. 여기서 하지 마라.

## ⑦ 다 하면

```bash
git add -A
git commit    # 아래 형식
git push -u origin rlaqudwn1/issue-36-report-metrics
```

커밋 메시지는 이 레포의 결을 따른다 — **첫 줄은 한국어 한 문장, 끝에 ` — #36`**.
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
