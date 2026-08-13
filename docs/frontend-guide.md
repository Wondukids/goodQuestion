# 프론트엔드 모듈 가이드 — 음성(STT·TTS)·연출 라이브러리·시퀀서

`api_team` 브랜치에서 공통 모듈로 분리한 세 묶음 — 음성 함수(`src/stt`, `src/tts`),
연출 라이브러리(`src/frontendlib`), 시퀀스 제어기(`sequencer.ts`) — 를 어떻게 쓰고
어디를 고치면 되는지 정리한 문서. 작성: 2026-08-13, `api_team` 브랜치 기준.

관련 문서: 재생 화면 전반은 [fart-bride-guide.md](./fart-bride-guide.md)
(그 문서의 폴더 지도 중 STT·TTS 위치는 이 리팩토링으로 바뀌었다 — 위치는 이 문서가
최신), API 요청·응답 계약은 [api-spec.md](./api-spec.md), LLM 반응 생성 교체는
[llm-guide.md](./llm-guide.md).

## 1. 무엇이 어디로 갔나

리팩토링 전에는 STT·TTS 로직이 라우트 핸들러와 `interactive-scene.tsx` 안에
흩어져 있었다. 지금은 역할별 모듈로 나뉘고, 라우트와 씬에는 얇은 호출부만 남았다.
**API 경로와 요청·응답 형식은 그대로다** — api-spec.md 는 수정 없이 유효하다.

| 경로 | 역할 |
|---|---|
| `src/stt/record.ts` | 마이크 녹음 (`startRecording`) — MediaRecorder·스트림 수명 관리 |
| `src/stt/client.ts` | 브라우저 → STT 라우트 호출 (`transcribeAudio`) |
| `src/stt/server.ts` | Google Cloud STT 호출 (`recognizeSpeech`) — **서버 전용** |
| `src/tts/voices.ts` | 성우 매핑 단일 소스 (`TTS_VOICES`, `TtsVoice`, `resolveVoice`) |
| `src/tts/client.ts` | 브라우저 → TTS 라우트 호출 (`requestSpeech`) |
| `src/tts/server.ts` | 3단 폴백 합성 (`synthesizeSpeech`) — **서버 전용** |
| `src/frontendlib/` | 연출 라이브러리 — 슬라이드·팝업·확대/축소·방향 영상·카메라 셰이크 |
| `src/stories/fart-bride/sequencer.ts` | 재생 진행 제어 (`useStorySequencer`) |
| `src/app/api/fart-bride/{stt,tts}/route.ts` | 요청 파싱·응답 변환만 하는 얇은 층 |

경계 규칙: `*/server.ts` 는 API 키(`process.env`)를 다루므로 **라우트 핸들러에서만
import** 한다. 클라이언트 컴포넌트는 `*/client.ts`·`record.ts`·`voices.ts` 만 쓴다.

## 2. STT 모듈 (`src/stt`)

```
[브라우저] startRecording ─(Blob)→ transcribeAudio ─HTTP→ [서버 라우트] recognizeSpeech → Google STT
```

| 함수 | 위치 | 하는 일 |
|---|---|---|
| `startRecording(onComplete)` | `record.ts` | 마이크 녹음 시작 → `Recording` 핸들 반환 |
| `Recording.stop()` | `record.ts` | 녹음 종료 — `onComplete(blob, channelCount)` 가 불린다 |
| `Recording.dispose()` | `record.ts` | 결과 없이 정리 (씬 이탈용) — `onComplete` 는 불리지 않는다 |
| `transcribeAudio(blob, channelCount)` | `client.ts` | STT 라우트 호출 → 텍스트. **무음이면 `""`** (에러 아님) |
| `recognizeSpeech(audio, channelCount)` | `server.ts` | Google STT 호출. 실패 시 `SttError { status, detail }` throw |

사용 예 (대화 씬과 같은 패턴):

```tsx
import { transcribeAudio } from "@/stt/client";
import { startRecording } from "@/stt/record";

const recording = await startRecording(async (blob, channels) => {
  const text = await transcribeAudio(blob, channels); // 무음이면 ""
});
// "다 말했어요" 버튼  → recording.stop()
// 씬 이탈(언마운트)   → recording.dispose()  — 결과 콜백 없이 마이크만 정리
```

- 채널 수를 같이 넘기는 이유: 스테레오 마이크면 opus 헤더와 STT 설정이 어긋나
  400 이 난다. `startRecording` 이 트랙에서 읽어 `onComplete` 로 주니 그대로
  전달만 하면 된다.
- 무음 재시도 정책(1회 재시도 후 답변으로 진행)은 모듈이 아니라 호출부(씬)
  책임이다 — `data.ts` 의 `STT_DEFAULTS` 참고.

## 3. TTS 모듈 (`src/tts`)

| 함수 | 위치 | 하는 일 |
|---|---|---|
| `requestSpeech({ text, voice, stylePrompt? })` | `client.ts` | TTS 라우트 호출 → 오디오 `Blob`. 실패 시 서버 메시지로 throw |
| `synthesizeSpeech(text, voice?, stylePrompt?)` | `server.ts` | 3단 폴백 합성 → `{ audio, contentType, model }`. 실패 시 `TtsError` throw |
| `resolveVoice(voice)` | `voices.ts` | 허용 밖 이름이 오면 내레이션(`Despina`)으로 |

사용 예:

```tsx
import { requestSpeech } from "@/tts/client";

const speech = await requestSpeech({ text: "안녕!", voice: "Leda" });
const url = URL.createObjectURL(speech); // <audio src={url}> 로 재생
// 다 쓰면 URL.revokeObjectURL(url) — blob URL 정리는 호출부 책임
```

- 3단 폴백(Gemini API → Cloud Gemini-TTS → Chirp3-HD)과 `X-TTS-Model` 확인법은
  그대로다 — [fart-bride-guide.md](./fart-bride-guide.md) 5절 참고.
- 보이스 이름·타입은 `voices.ts` 가 단일 소스다. `data.ts` 의 `speaker.voice`
  타입(`TtsVoice`)도 여기서 온다. 성우를 추가하면 이 파일 하나만 고친다.
- 클라이언트 헬퍼의 엔드포인트는 지금 `/api/fart-bride/{stt,tts}` 로 고정이다.
  다른 이야기에서 쓰게 되면 라우트를 공용으로 옮기거나 엔드포인트 인자를 추가할 것.

## 4. 연출 라이브러리 (`src/frontendlib`)

공통 규칙 세 가지:

- **`playKey`** — 값이 바뀔 때마다 연출을 다시 재생한다 (첫 마운트 포함).
  `SlideTransition` 의 `transitionKey` 와 같은 방식.
- 스타일은 `effects.css` 의 `fx-*` 키프레임에 있고 `app/globals.css` 가
  `@import` 로 불러온다. 시간·방향·강도는 컴포넌트가 `--fx-*` CSS 변수로 넘긴다.
- 기본 타이밍은 책 넘김과 같은 `0.7s cubic-bezier(0.3, 0.1, 0.3, 1)`.

| 컴포넌트 | 연출 | 주요 props |
|---|---|---|
| `SlideIn` | 지정 방향에서 밀려 들어옴 | `from`, `distance`, `durationMs`, `delayMs` |
| `Popup` | 어두운 배경 + 패널이 튀며 등장 | `open`, `onClose`, `className`(패널 모양) |
| `ZoomIn` | 시간에 따라 서서히 확대 | `scaleTo`(기본 1.15), `durationMs`(기본 8초), `origin` |
| `ZoomOut` | 시간에 따라 서서히 축소 | `scaleFrom`(기본 1.15), `durationMs`, `origin` |
| `DirectionalVideo` | 지정 방향에서 영상 등장 | `from`, `effect`(`"slide"`/`"wipe"`) + `<video>` 속성 전부 |
| `CameraShake` | 감쇠하며 흔들림 | `intensity`(px), `durationMs`, `loop` |

```tsx
import { CameraShake, DirectionalVideo, Popup, SlideIn, ZoomIn } from "@/frontendlib";

<SlideIn from="left" durationMs={500}>...</SlideIn>
<Popup open={open} onClose={() => setOpen(false)} className="rounded-3xl bg-white p-8">...</Popup>
<ZoomIn durationMs={10000} className="absolute inset-0"><Image ... /></ZoomIn>
<DirectionalVideo src="/stories/....mp4" from="down" effect="wipe" onEnded={next} />
<CameraShake playKey={boomCount} intensity={12}>...</CameraShake>
```

- `ZoomIn`/`ZoomOut` 은 래퍼가 `overflow-hidden` 으로 잘라 준다 — 씬 배경을
  씬 길이에 맞춰 천천히 당기는(Ken Burns) 용도로 쓰면 된다.
- `Popup` 은 닫힘 연출 없이 즉시 사라진다 (`SlideTransition` 과 같은 정책).
  패널 배경·라운드·패딩은 호출부 `className` 으로 정한다.
- 화면 전환(키 교체) 슬라이드는 기존 `components/ui/slide-transition.tsx` 를
  그대로 쓴다 — `SlideIn` 은 화면 안 요소 하나를 등장시키는 용도라 역할이 다르다.
- 새 연출 추가: `effects.css` 에 `fx-<이름>` 키프레임+클래스, 컴포넌트 파일 하나,
  `index.ts` 에 export 한 줄이면 끝.

## 5. 시퀀서 (`src/stories/fart-bride/sequencer.ts`)

역할이 세 파일로 나뉜다:

```
data.ts (SEQUENCE)               → 순서 정의: 어떤 파트·씬이 어떤 차례인지
sequencer.ts (useStorySequencer) → 진행 제어: 현재 위치·이동·책 넘김 판단
play.tsx                         → 그리기: 상태 렌더 + 버튼에 컨트롤 연결
```

| 반환값 | 뜻 |
|---|---|
| `steps` | 스텝 목록 — 진행 점 UI 에 그대로 사용 |
| `stepIndex` / `step` | 현재 위치(0부터) / 현재 스텝 (끝나면 `null`) |
| `started` / `finished` | "이야기 시작"을 눌렀는지 / 끝까지 봤는지 |
| `turning` | 이번 전환에 책 넘김 연출을 쓸지 |
| `start()` / `next()` / `previous()` | 시작 / 다음 / 이전 |
| `goTo(2)` 또는 `goTo("scene7")` | 번호·id 로 점프 (범위 밖이면 무시) |
| `restart()` | 처음부터 다시 보기 |

- 책 넘김 판단은 **직전에 실제로 보고 있던 스텝**(`cameFrom`) 기준이다 —
  `goTo` 로 점프해도 자연스럽다. 대화 씬을 거치는 전환은 넘기지 않고,
  시작·다시 보기로 들어갈 때는 넘긴다.
- 개발 중 특정 씬만 확인하고 싶으면 임시 버튼에 `goTo("scene7")` 을 연결하면 된다.
- 다른 이야기에서 재사용: `useStorySequencer(mySteps)` 처럼 스텝 배열을 넘기면
  된다 (기본값이 방귀 뀌는 며느리의 `SEQUENCE`).

## 6. 테스트 체크리스트

1. `npm run dev` → 재생 화면 진입 ("이야기 시작" 버튼은 자동재생 허용 제스처 —
   빼면 안 된다).
2. 빠르게 확인할 것:
   - 대화 씬: 녹음 → "다 말했어요" → 반응 재생이 이전과 똑같이 도는가
     (리팩토링 후에도 동작 불변이 정상)
   - 씬을 나가면 브라우저 마이크 표시가 꺼지는가 (`dispose` 경로)
   - TTS 가 어느 모델로 나갔는지 (`X-TTS-Model` 응답 헤더, 네트워크 탭)
   - 진행 점·건너뛰기·다시 보기가 시퀀서 컨트롤로 동작하는가
3. 검증 상태: 이 리팩토링 기준(2026-08-13) `tsc --noEmit`·ESLint·`next build`
   모두 통과.
