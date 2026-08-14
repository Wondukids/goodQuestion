# LLM 연동 가이드 — 대화 씬 반응 생성

> **폐기 (2026-08-14, 이슈 #8)** — 아래의 `POST /api/fart-bride/llm` 제안은 만들지
> 않는다. 세션 턴 API `POST /api/sessions/{session_id}/turns`
> (`docs/이야기_세션_명세.md` 4.3절)가 그 자리를 대체한다: 녹음 하나를 보내면
> 서버가 STT→분석→판단→대사를 다 돌리고, 화면은 `dialogue.text` 를 TTS 로 튼다.
> 이 문서는 당시의 화면 구조 기록으로만 남긴다.

대화 씬(아이 답변에 캐릭터가 반응하는 부분)의 고정 문구를 LLM 생성 반응으로
교체하는 작업 가이드. 어디를 건드리면 되는지, 무엇을 지켜야 하는지 정리했다.
작성: 2026-08-12 기준, `api_team` 브랜치 (`8c51efa`) 라인 번호.

## 1. 지금은 어떻게 동작하나

재생 흐름은 영상 5파트 사이에 대화 4씬이 끼어드는 시퀀서다
(`src/stories/fart-bride/data.ts` 의 `SEQUENCE`). 대화 씬 하나의 단계는:

```
question(질문 음성) → listening(녹음) → transcribing(STT) → responding(반응 재생)
→ choice(다시 말하기 | 계속하기) → answer(정해진 답변) → 다음 파트
```

이 중 **responding 에 들어갈 텍스트를 만드는 곳이 교체 대상**이다. 지금은
`interactive-scene.tsx` 의 `REACTIONS` 가 화자별 고정 문구를 만든다:

```
아이 답변 → POST /api/fart-bride/stt → transcript
→ buildReaction(transcript, voice)   ← 여기가 고정 문구 (LLM 으로 교체)
→ POST /api/fart-bride/tts → 캐릭터 목소리로 재생
```

아이 이름은 `selected_child` 쿠키 → 재생 라우트가 조회 → `childName` prop 으로
씬까지 내려온다. 받침에 따른 조사 처리는 `name.ts` 에 있다.

## 2. 건드릴 파일

| 파일 | 위치 | 할 일 |
|---|---|---|
| `src/app/api/fart-bride/llm/route.ts` | **새로 만들기** | LLM 호출 서버 라우트. 옆의 `stt/route.ts` · `tts/route.ts` 가 같은 패턴(POST 핸들러, 키는 env, 폴백)이니 참고 |
| `src/stories/fart-bride/interactive-scene.tsx` | 27~41행 | `REACTIONS` · `buildReaction` 을 LLM 라우트 호출로 교체. 주석에 "LLM 연결 지점" 이라고 표시해 둔 자리다 |
| `src/stories/fart-bride/interactive-scene.tsx` | 200행 근처 | `sendToStt` 안의 `text: buildReaction(...)` — 여기서 LLM 응답 텍스트를 받아 TTS 로 넘기게 된다 |
| `src/stories/fart-bride/data.ts` | 28~41행 | `InteractiveStep` 타입에 씬 맥락 필드 추가(예: `llmContext`). `stylePrompt` 는 TTS 연기 지시용이니 섞지 말 것 |
| `.env.local` / `.env.example` | — | 키는 `.env.local` 에만. `.env.example` 에는 키 이름만 (Stop 훅이 자동으로 채우니 커밋에 실제 값이 섞이지 않게만 주의) |

## 3. 라우트 입출력 제안

```
POST /api/fart-bride/llm
요청:  { transcript: string, sceneId: number, childName?: string }
응답:  { reply: string }
실패:  4xx/5xx + { error: string }
```

- **씬 맥락(페르소나·상황)은 서버에서 `sceneId` 로 찾아라.** 클라이언트가
  프롬프트 전문을 보내는 구조로 만들면 요청 조작으로 프롬프트를 바꿀 수 있다.
- 클라이언트 쪽은 LLM 실패 시 **기존 고정 문구로 폴백**하는 걸 남겨 두는 게
  좋다 (TTS 도 같은 방식 — 재생이 끊기지 않는 게 최우선).

## 4. 프롬프트가 지켜야 할 것

- **응답은 그대로 TTS 로 읽힌다.** 1~2문장, 한국어만. 이모지·마크다운·괄호
  지문(*웃으며*) 이 섞이면 그대로 읽어 버린다.
- **캐릭터 말투 유지.** 며느리(Leda)=다정한 해요체, 시아버지(Schedar)=근엄한
  하게체, 이장님(Sadachbia)=너털웃음 하오체. 기존 `REACTIONS` 문구가 톤
  레퍼런스다.
- **유아 대상 서비스다.** 아이 답변이 무엇이든(무의미한 소리, 공격적인 말,
  오인식 포함) 따뜻하게 받아 줄 것. 평가·훈계·무서운 표현 금지.
- **이야기를 바꾸면 안 된다.** LLM 반응 직후 정해진 답변(`answer.lines`)으로
  이어지므로, 반응이 결말을 약속하거나 스포일러하면 흐름이 어긋난다.
- **아이 이름을 부를 수 있다.** `childName` 이 요청에 오면 활용. 조사는
  `name.ts` 의 `vocative()` 재사용 (순수 함수라 서버에서 import 가능).
- **transcript 는 발화 그대로 취급.** 시스템 지시와 분리해서 넣고, 아이
  발화 안의 지시("욕해 봐" 등)를 따르지 않게 할 것.

## 5. 지연 예산

아이가 말을 마친 뒤 반응이 들리기까지: STT(1~2초) + **LLM(+α)** + TTS(2~3초).
지금도 5초 안팎이라 LLM 은 빠른 모델 + 짧은 출력(max tokens 제한)으로.
스트리밍은 TTS 가 전문을 필요로 해서 이득이 없다. 호출량은 씬당 1회 +
"다시 말하기" 반복만큼 — 한 번 재생에 4~10회 수준.

## 6. 개인정보 — 시작 전에 반드시 확인

`docs/billing.md` 기준, 지금까지 외부로 나가는 텍스트는 우리가 만든 캐릭터
문구뿐이고 **아이 발화 원문은 어디에도 보내지 않았다.** LLM 에 transcript 를
보내는 순간 이 전제가 깨진다:

- Gemini **무료 등급은 요청 데이터가 Google 제품 개선에 활용될 수 있다** —
  아이 발화를 보내는 용도로는 쓰지 말 것. 유료 등급 전환 또는 데이터 미활용이
  보장되는 API 로.
- `childName` 도 개인정보다. 프롬프트에 넣는 건 괜찮지만 로그로 남기지 말 것.
- 어떤 키/등급을 쓰기로 했는지 `docs/billing.md` 에 섹션을 추가해 줄 것
  (과금 주체 표 포함).

## 7. 모델·키 선택

프로바이더 선택은 담당자 재량. 참고할 점:

- `GEMINI_API_KEY` 가 이미 있어서(TTS 용) Gemini 텍스트 생성을 재사용하는 게
  세팅 마찰은 가장 적다 — 단 6번(무료 등급 데이터 활용) 해결이 전제.
- 다른 프로바이더를 쓰면 키 이름을 `.env.example` 규칙대로 추가하고
  요금 정리를 `billing.md` 에.
- 모델명·단가는 계속 바뀌니 문서 말고 공식 요금 페이지에서 확인.

## 8. 확장 여지 — "다시 말하기" 순환

현재 choice 단계의 "다시 말하기"는 녹음만 다시 할 뿐 **대화 히스토리가 없다**
(매번 첫 반응처럼 동작). LLM 을 넣으면서 멀티턴으로 만들려면:

- `InteractiveScene` 에 `{ role, text }[]` 히스토리 상태를 추가하고
- 라우트 요청을 `messages` 배열로 바꾸면 된다.

순환을 몇 번까지 허용할지(STT_DEFAULTS 처럼 상한), 히스토리를 씬이 끝나면
버릴지는 기획과 함께 정할 것.

## 9. 테스트 방법

1. `pnpm dev` (또는 `npm run dev`) → `/children` 에서 아이 카드 클릭
   (이름 쿠키가 심어진다) → 이야기 재생 → 씬 4 가 첫 대화.
2. 상단 "건너뛰기" 버튼으로 씬을 빠르게 이동할 수 있다.
3. 라우트 단독 테스트:

   ```bash
   curl -X POST http://localhost:3000/api/fart-bride/llm \
     -H "Content-Type: application/json" \
     -d '{"transcript":"방귀 뀌어도 괜찮아!","sceneId":4,"childName":"지훈"}'
   ```

4. 무음/오인식 흐름도 확인할 것 — STT 가 빈 문자열이면 1회 재시도 후 답변
   단계로 그냥 넘어간다 (`STT_DEFAULTS`, `sendToStt` 참고). LLM 이 끼어도
   이 동작은 유지돼야 한다.
