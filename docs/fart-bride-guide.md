# 방귀 뀌는 며느리 — 재생 구현 & STT·TTS 가이드

동화 재생 화면과 음성 파이프라인(STT·TTS)이 어떻게 짜여 있는지, 작업할 때
어디를 건드리면 되는지 정리한 문서. 재생 쪽을 처음 만지는 팀원 기준으로 썼다.
작성: 2026-08-12, `api_team` 브랜치 기준.

관련 문서: 요금·과금 주체는 [billing.md](./billing.md), LLM 반응 생성 교체는
[llm-guide.md](./llm-guide.md), 원본 데이터 스키마는
[content/stories/fart-bride/database/README.md](../content/stories/fart-bride/database/README.md).

## 1. 폴더 지도

| 경로 | 역할 |
|---|---|
| `src/app/stories/[id]/play/page.tsx` | 재생 라우트. 선택된 아이 이름을 조회해 재생 화면에 넘기는 것만 한다 |
| `src/stories/index.ts` | 이야기 레지스트리 — id → 재생 화면 컴포넌트, 공통 props(`PlayScreenProps`) |
| `src/stories/fart-bride/play.tsx` | 시퀀서 — 영상↔대화 진행, 시작/끝 화면, 책 넘김 연출 |
| `src/stories/fart-bride/interactive-scene.tsx` | 대화 씬 — 질문 → 녹음 → STT → 반응(TTS) → 답변 |
| `src/stories/fart-bride/data.ts` | 재생 순서(`SEQUENCE`)와 대사·에셋 경로·화자 정의 |
| `src/stories/fart-bride/subtitles.ts` | 영상 자막 (자동 생성 — **직접 수정 금지**, 8절 참고) |
| `src/stories/fart-bride/name.ts` | 아이 이름 조사 처리 (아/야, 이) |
| `src/app/api/fart-bride/stt/route.ts` | 아이 음성 → 텍스트 (Google Cloud STT) |
| `src/app/api/fart-bride/tts/route.ts` | 텍스트 → 캐릭터 음성 (Gemini TTS, 폴백 2단) |
| `public/stories/fart-bride/{video,image,sound}` | 재생용 에셋 (ASCII 파일명으로 변환된 복사본) |
| `content/stories/fart-bride/` | 원본 에셋 + `story_database.json` (영상 제작·데이터 관리용) |

팀 규칙: **이야기 하나 = 폴더 하나**(`src/stories/<id>/`). 담당자는 자기 폴더
안에서만 작업하고, 폴더 밖은 `index.ts` 등록 한 줄이 전부다. API 라우트도
`/api/<이야기 id>/...` 로 이야기별로 나눈다.

## 2. 재생 흐름 (play.tsx)

```
part1 → 씬4 대화 → part2 → 씬7 대화 → part3 → 씬10 대화 → part4 → 씬16 대화 → part5
```

- 영상 5파트 사이에 대화 4씬이 끼어드는 구조. 순서는 `data.ts` 의 `SEQUENCE`
  배열이 전부다 — 항목을 추가/제거하면 진행 점(상단 점들)까지 따라온다.
- **"이야기 시작" 버튼은 빼면 안 된다.** 소리 있는 자동재생을 허용받기 위한
  사용자 제스처다. 빼면 브라우저가 영상·음성 소리를 막는다.
- 책 넘김 연출: 시작·다시 보기로 첫 파트에 들어갈 때만 재생된다. 대화 씬
  진입·이탈은 이야기 흐름이 끊기지 않게 넘김 없이 바로 전환한다. 키프레임은
  `globals.css` 의 `page-turn`, 판단 로직은 `play.tsx` 의 `turning`.
- 영상 파트(`PartVideo`)는 `onEnded` 로 다음 스텝, `onTimeUpdate` 로 자막
  큐를 고른다. 영상이 음성 파일을 그대로 이어붙인 것이라 자막 타이밍 오차는
  0.05초 이내다.
- 상단 바의 "건너뛰기"는 테스트용이다. 시안 8~17 디자인이 아직 없어서 지금
  UI 는 기능 테스트용 최소 구성이다.

## 3. 대화 씬 (interactive-scene.tsx)

```
question(질문 음성) → listening(녹음) → transcribing(STT) → responding(반응 재생)
→ choice(다시 말하기 | 계속하기) → answer(정해진 답변) → onComplete
                                    ↑ 다시 말하기를 누르면 listening 으로 순환
```

- **녹음**: `getUserMedia` → `MediaRecorder`(webm/opus). 마이크가 스테레오면
  STT 설정과 어긋나 400 이 나므로, 트랙에서 읽은 채널 수를
  `X-Audio-Channels` 헤더로 STT 라우트에 보낸다.
- **무음 처리**: STT 가 `transcript: ""` 를 주면 1회 재시도, 그래도 무음이면
  답변 단계로 그냥 진행한다 (`STT_DEFAULTS` — 최대 10초 청취).
- **반응 생성**: 지금은 화자별 고정 문구(`REACTIONS`)다. LLM 으로 교체할
  예정 — 작업 방법은 [llm-guide.md](./llm-guide.md).
- **아이 이름 호명**: 씬에 들어오면 대사를 준비(`preparedLines`)한다.
  대사에 "ㅇㅇ" 자리 표시자가 있으면(씬 4·16) 이름을 넣어 캐릭터 목소리로
  TTS 생성, 없으면(씬 7·10) 질문 앞에 짧은 호명("지훈아!")을 붙인다.
  TTS 실패 시 원본 녹음으로 폴백 — 이름만 못 부를 뿐 진행은 된다.
- **정리 책임**: 언마운트 시 마이크 트랙과 blob URL 을 정리한다. 오디오나
  스트림을 새로 만들면 정리 useEffect 에도 추가할 것.
- 씬 10 의 미니게임 단계는 내용 미정이라 지금은 건너뛴다.

## 4. STT 라우트 (`/api/fart-bride/stt`)

- Google Cloud Speech-to-Text v1 `speech:recognize`, `WEBM_OPUS` · `ko-KR`.
- 요청: 녹음 blob 을 body 에 그대로(`application/octet-stream`),
  채널 수는 `X-Audio-Channels` 헤더로.
- 응답: `{ transcript: string }` — **무음이면 빈 문자열**이다 (에러 아님).
  재시도 판단은 클라이언트 몫.
- 키는 `GOOGLE_CLOUD_API_KEY` (서버 env 에만, 클라이언트 노출 금지).
- 과금은 15초 단위 올림. **"(Logged)" 옵션 금지** — 아이 음성이 Google 모델
  개선에 제공되는 조건이다. 자세한 건 [billing.md](./billing.md).

## 5. TTS 라우트 (`/api/fart-bride/tts`)

- 요청: `{ text, voice, stylePrompt? }` (JSON). 응답: 오디오 바이너리.
- **3단계 폴백** — 어느 경로로 나갔는지는 응답 헤더 `X-TTS-Model` 로 확인:
  1. Gemini API 2.5 Flash TTS (`GEMINI_API_KEY` 있을 때) — PCM 을 WAV 로 감싸 반환
  2. Cloud TTS 의 Gemini-TTS (`GOOGLE_CLOUD_API_KEY`, Vertex 권한 필요) — MP3
  3. Chirp3-HD (항상 동작하는 안전망) — MP3, **stylePrompt 미지원**
- 보이스 매핑 (두 모델이 같은 페르소나를 공유한다):

  | voice | 캐릭터 | 말투 |
  |---|---|---|
  | `Despina` | 내레이션 | 차분한 구연 |
  | `Leda` | 며느리 | 다정한 해요체 |
  | `Schedar` | 시아버지 | 근엄한 하게체 |
  | `Sadachbia` | 이장님 | 너털웃음 하오체 |

- `stylePrompt` 는 말투 연기 지시(Gemini 계열만 적용). 씬별 값은 `data.ts`
  의 `speaker.stylePrompt` 에 있다.
- 단독 테스트:

  ```bash
  curl -X POST http://localhost:3000/api/fart-bride/tts \
    -H "Content-Type: application/json" \
    -d '{"text":"안녕! 나는 며느리야.","voice":"Leda"}' \
    -o /tmp/tts.wav -D -
  ```

## 6. 아이 이름이 씬까지 오는 길

```
/children 아이 카드 클릭 → selectChild 서버 액션 (src/app/children/actions.ts)
→ selected_child 쿠키 (httpOnly, 30일) → 재생 라우트 getChildName()
→ childName prop → FartBridePlay → InteractiveScene
```

- 쿠키가 없으면 계정의 첫 아이로 폴백, 그마저 없으면 `null` (호명 생략).
- 조사 규칙은 `name.ts`: 받침 있으면 "지훈아"·"지훈이", 없으면 "수아야"·"수아".
  마지막 글자가 한글이 아니면 받침 없음으로 취급.

## 7. 환경 변수

| 키 | 용도 |
|---|---|
| `GOOGLE_CLOUD_API_KEY` | STT + TTS 폴백 (팀 Cloud 프로젝트 청구) |
| `GEMINI_API_KEY` | TTS 메인 (키 발급한 개인 계정, 무료 등급) |
| `NEXT_PUBLIC_SUPABASE_*` | 로그인·children 테이블 |

실제 값은 `.env.local` 에만. `.env.example` 은 Stop 훅이 키 이름만 자동으로
채우니 값이 섞여 커밋되지 않게만 주의. 키를 추가하면 서버 재시작 필요.

## 8. 에셋·데이터 갱신

- 원본(한글 파일명)은 `content/stories/fart-bride/`, 재생용(ASCII 파일명)은
  `public/stories/fart-bride/` 다. 파일을 교체하면 **양쪽 다** 반영할 것.
- `story_database.json` 이 대사·성우·에셋의 단일 소스다. 파일을 추가·교체한
  뒤에는 `database/build_assets.ps1` 로 인덱스를 재생성·검증한다.
- 자막(`subtitles.ts`)은 손으로 고치지 말고 재생성한다:

  ```bash
  node content/stories/fart-bride/database/build_subtitles.mjs
  ```

  음성 길이 기반으로 타이밍을 다시 계산해 파일을 덮어쓴다.
- 알려진 데이터 이슈(교체 필요 이미지 8장, 파일명 불일치 등)는
  [database/README.md](../content/stories/fart-bride/database/README.md) 하단 목록 참고.

## 9. 테스트 체크리스트

1. `pnpm dev` (또는 `npm run dev`) → 로그인 → `/children` 에서 **아이 카드
   클릭** (이름 쿠키가 여기서 심어진다) → 이야기 선택 → "이야기 시작".
2. 빠르게 확인할 것:
   - 첫 파트에서 책 넘김이 한 번 재생되는가, 소리가 나는가
   - 영상 자막이 음성과 맞는가
   - 씬 4 질문이 아이 이름으로 시작하는가 (TTS 생성 1~2초 지연은 정상)
   - 마이크 권한 거부 시 에러 UI 와 "건너뛰고 계속" 이 동작하는가
   - 아무 말 안 했을 때: 재시도 1회 → 답변으로 진행되는가
   - TTS 가 어느 모델로 나갔는지 (`X-TTS-Model`, 네트워크 탭)
3. 씬 이동은 상단 "건너뛰기", 처음부터는 끝 화면의 "다시 보기".

## 10. 새 이야기 추가하기

1. `src/stories/<이야기 id>/` 폴더를 만들고 재생 화면 컴포넌트를 작성한다
   (`PlayScreenProps` — `childName` 을 받는다).
2. `src/stories/index.ts` 의 `PLAY_SCREENS` 에 한 줄 등록한다.
3. 이야기 id 는 URL(`/stories/<id>/play`)이자 `mock-data` 의 이야기 id 와
   같은 값이어야 한다.
4. 서버 라우트가 필요하면 `src/app/api/<이야기 id>/` 아래에 만든다.
5. 에셋은 `public/stories/<이야기 id>/` 에 ASCII 파일명으로.
