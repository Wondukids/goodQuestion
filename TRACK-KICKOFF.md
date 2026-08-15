# 후-6 · 이슈 #47 — 후활동 결과를 보호자 리포트에 싣는다

> 이 문서 하나만 읽고 일할 수 있게 썼다. 브랜치 `rlaqudwn1/issue-47-post-activity-report`

## 0. 한 줄

아이가 말하기 후 활동(카드 순서 맞추기 → 핵심 단어로 줄거리 말하기)을 하면 그 결과가
`post_activity_results` · `post_activity_keywords` 두 표에 쌓인다. **지금은 아무도 그것을
보지 않는다.** 이 갈래가 그 두 표를 **리포트 지표에 얹고 「말하기 분석」 탭에 카드 하나로
그린다.**

## 1. 정본

- 지표 모양 — `docs/말하기후활동_명세.md` **7.2절** (`ReportMetrics` 에 붙는 한 덩이)
- 화면 — **7.3절** (카드 하나 · 순서 한 줄 + 단어 12칩)
- 끝났다는 조건 — **9절 수용 기준 11·12·15**

앞 갈래 다섯이 다 붙었다: 표(#42) · 리포트 시점(#43) · 판정 엔진(#44) · API 넷(#45).
데이터는 이미 들어오고 있다. 이 갈래는 **읽어서 보여주는 쪽**만 한다.

## 2. 🔴 다른 갈래가 지금 **같은 파일들**을 고치고 있다

`src/lib/report.ts` · `src/components/report/speech-analysis.tsx` ·
`tests/report-screen.test.ts` 는 **이번 주 내내 다른 갈래(#49·#50·#34 — 오각형 안내 문구)가
만지는 자리**다. 방금도 하나 들어왔다 (`907ea5b`).

그래서 이 갈래의 규칙:

- **`api_team` 최신에서 갈라져 나간다** (이 브랜치가 이미 그렇다).
- **덧붙이기만 해라.** 기존 타입·함수의 **모양을 바꾸지 마라.** `toReportView()` 안에서
  새 필드를 하나 더 만드는 식이지, 있는 구조를 재편하는 게 아니다.
- 끝내기 직전에 `git fetch && git merge origin/api_team` 을 한 번 해서 부딪히는 게 없나
  보고 커밋해라. 부딪히면 **네 쪽을 양보하고** 커밋 본문에 적어라.

## 3. 데이터가 어디 있나

```
post_activity_results   session_id(UNIQUE) · submitted_order · is_order_correct ·
                        attempt_count · retelling_text · analyzed_at · analysis_version · completed_at
post_activity_keywords  result_id → · card_id · word · status('used'|'similar'|'missing') ·
                        evidence · decided_by('rule'|'llm')
```

- 드리즐 선언은 `src/llm/db/schema.ts`, SQL 은 `sql/007_post_activity.sql`.
- **읽는 SQL 은 `src/llm/repo/post-activity.ts` 에 이미 있다** (#45 가 냈다) — 하지만 그건
  세션 도메인용이다. 리포트는 자기 repo 층(`src/report/repo/materials.ts`)에서 읽어라.
- `analyzed_at` 이 **NULL** 이면 「판정을 못 했다」다. 「단어를 하나도 안 썼다」(12행 전부
  `missing`)와 **다르다.** 그 둘을 화면에서 갈라야 한다.
- `evidence` 는 **NULL 일 수 있다** (안 쓴 단어). 빈 문자열이 아니라 NULL 이 정본이다.

## 4. 붙일 모양 (명세 7.2)

```ts
post_activity: {
  order: { correct: boolean; attempts: number; first_submission: string[] }
  /** 순서만 하고 나갔으면 null — 카드에 순서 줄만 보인다 */
  retelling: {
    analyzed: boolean          // false 면 판정을 못 했다 — 화면은 「담지 못했어요」
    text: string
    used: number; similar: number; missing: number
    words: { card_id: string; word: string; status: 'used'|'similar'|'missing'; evidence: string | null }[]
  } | null
} | null                        // 활동을 아예 안 했으면 null — 카드를 그리지 않는다
```

**`null` 이 세 겹이다.** 셋 다 화면이 다르게 그린다:

| | 언제 | 화면 |
|---|---|---|
| `post_activity: null` | 활동을 아예 안 했다 (결과 행이 없다) | 카드를 **안 그린다** |
| `retelling: null` | 순서만 맞추고 나갔다 | 순서 줄만 + 「줄거리는 아직 들려주지 않았어요」 |
| `analyzed: false` | 말은 했는데 판정을 못 했다 | 말은 보여주고 「담지 못했어요」 |

## 5. 손댈 파일

| 파일 | 무엇 |
|---|---|
| `src/report/types.ts` | `ReportMetrics` 에 `post_activity` 한 덩이 (59행 근처) |
| `src/report/repo/materials.ts` | `집계재료` 에 후활동 두 표를 읽어 담는다 (106행 근처가 모으는 자리) |
| `src/report/domain/metrics.ts` | `aggregateMetrics()`(594행)가 그 재료로 `post_activity` 를 만든다. **순수 함수다 — DB 를 물지 않는다** |
| `src/lib/report.ts` | 화면이 쓰는 모양으로 옮긴다 (`toReportView()` 300행). 색·라벨 상수는 `WORD_STYLE`·`NOTICE` 옆에 |
| `src/components/report/speech-analysis.tsx` | 「말하기 분석」 탭에 카드 하나 (7.3) |
| `tests/*` | 지표 검사 + 화면 검사. `tests/report-screen.test.ts` 가 화면 검사의 본보기다 |

⛔ **손대지 않는 곳** — `src/post-activity/**`(판정 엔진) · `prompts/**` ·
`src/session/**`(API) · `src/llm/service/post-activity.ts` · `sql/**` · 미션 1·2 ·
아이 앱 화면(`src/stories/**`). 앞 갈래들이 끝낸 자리다.

## 6. 🔴 모르고 넘어가면 사고 나는 것 다섯

### ① 기존 지표를 건드리지 않는다 (F15 · 수용 15)

`counts`·`words`·`axes` 는 **후활동을 해도 값이 변하지 않아야 한다.** 후활동 발화를
`child_utterances` 에 더하거나 낱말 세기에 섞지 마라. **덩이 하나를 옆에 놓는 것**이다.
그것을 재는 검사를 짜 둬라 — 이 갈래에서 가장 조용히 깨질 수 있는 자리다.

### ② 리포트는 **한 번 만들면 다시 안 만든다**

`queueReport()` 는 행이 이미 있으면 그냥 돌아간다. 그래서 **이미 만들어진 리포트에는
`post_activity` 가 안 실린다.** 목데이터 아이 11명의 리포트도 그렇다.

→ 확인하려면 그 세션의 리포트 행을 지우고 다시 만들거나, 보호자 화면의 **「다시 만들기」**를
쓴다. 「왜 안 나오지」로 한나절 태우기 쉬운 자리다.

### ③ 「참다」의 두 글자 바닥은 이미 걸려 있다

판정 엔진(#44)이 「참다」→「참」이 「참새」에 걸리는 것을 막아 뒀다(F14). **리포트의
낱말 세기(`src/report/engine/verify.ts` 의 `낱말이_발화에_있나()`)는 지금 동작이 맞다** —
성기게 잡아도 되는 자리다. **고치지 마라.** 두 곳의 규칙이 다른 것은 일부러다.

### ④ 리포트 **서술** 프롬프트는 안 건드린다 (명세 7.3 끝줄)

`report_analysis`·`report_guide` 는 이번 범위 밖이다. 후활동은 **숫자에만** 싣는다.
LLM 이 후활동을 문장으로 언급하게 만들지 마라.

### ⑤ 카드 12개가 아니라 **단어** 12개다

카드는 넉 장이고 각 카드에 단어 셋이 붙어 단어가 12개다 (`card_id` 로 묶인다).
칩을 그릴 때 카드별로 묶을지 한 줄로 늘어놓을지는 7.3 이 안 정했다 — **네가 정하고
커밋 본문에 「되돌려도 된다」로 적어라.**

## 7. 끝내는 조건

- 명세 9절 **수용 11·12·15**
  11. 「마치기」를 누르면 리포트가 만들어지고, 그 `metrics.post_activity` 에 단어 12개가 실린다.
  12. 활동을 안 하고 끝 화면을 떠나도 리포트가 만들어진다 — `post_activity` 는 `null`.
  15. 기존 지표(`counts.child_utterances`·`words`)는 후활동을 해도 값이 변하지 않는다.
- `pnpm test` · `pnpm typecheck` 통과. `pnpm lint` 가 **변경 전보다 늘지 않는다.**
  (손대기 전 숫자를 먼저 재 두고 견줘라 — 이미 빨간 것이 몇 개 있다.)

## 8. 잔손

- `.env.local` 의 `DATABASE_URL` 은 **로컬 도커**(`127.0.0.1:5432/goodquestion_ts`)여야
  검사가 돈다. 팀 Supabase 를 가리키면 검사가 스스로 막는다 (일부러 그렇다).
- 새 워크트리에서 `pnpm typecheck` 가 `LayoutProps`/`PageProps` 로 여러 개 터지면
  `npx next typegen` 을 한 번 돌린다.
- 커밋 메시지는 한국어. 명세에 없어 **네가 정한 것**은 「되돌려도 된다」로 적어 둬라.
- PR 은 열지 마라. 커밋하고 브랜치에 푸시만 하면 본선 쪽에서 확인하고 합친다.
