# 외부 API 요금 가이드

동화 재생(STT·TTS)에 쓰는 외부 API 의 과금 구조, 예상 비용, 사용량 확인 방법.
작성: 2026-08-11 기준. 단가는 변동될 수 있으니 결정 전에 각 공식 요금 페이지에서 재확인할 것.
원화 환산은 1 USD ≈ 1,450원 가정(Cloud 콘솔 표시 환율).

## 1. 과금 주체 — 누구 계정으로 청구되나

| 기능 | API | 사용하는 키 (env 변수) | 청구 대상 |
|---|---|---|---|
| 아이 음성 인식 | Google Cloud Speech-to-Text | `GOOGLE_CLOUD_API_KEY` | 팀 Cloud 프로젝트 (`353736237653`) |
| 캐릭터 반응 음성 (메인) | Gemini API — 2.5 Flash TTS | `GEMINI_API_KEY` | 키를 발급한 **개인 계정** |
| 캐릭터 반응 음성 (폴백) | Google Cloud TTS — Chirp3-HD | `GOOGLE_CLOUD_API_KEY` | 팀 Cloud 프로젝트 |
| 로그인·DB | Supabase | `NEXT_PUBLIC_SUPABASE_*` | 팀 Supabase 프로젝트 |

TTS 는 Gemini → (실패 시) Chirp3-HD 순서로 시도한다. 어느 쪽이 응답했는지는
`/api/fart-bride/tts` 응답 헤더 `X-TTS-Model` 로 확인할 수 있다.

## 2. 서비스별 요금

### Google Cloud Speech-to-Text (실시간 인식, v1 `speech:recognize`)

- **매월 60분 무료**, 이후 약 $0.024/분 (≈ 35원/분)
- **15초 단위 올림** 과금 — 3초를 녹음해도 15초로 계산된다
- 요금표의 "Dynamic Batch"(더 싼 항목)는 일괄 처리 전용이라 실시간 대화에는 해당 없음
- **"(Logged)" 옵션은 켜지 말 것** — 더 싸지만 녹음 데이터를 Google 모델 개선에 제공하는
  조건이다. 아이 음성을 다루므로 금지.
- 공식 요금: <https://cloud.google.com/speech-to-text/pricing>

### Gemini API — 2.5 Flash TTS (캐릭터 반응, 메인)

- AI Studio 키의 기본 상태는 **무료 등급** — 결제 계정을 연결하지 않았다면 청구 자체가
  발생하지 않고, 대신 분당/일일 호출 한도가 있다. 한도 초과 시 호출이 거부되고 앱은
  Chirp3-HD 폴백으로 자동 전환된다 (재생이 끊기지는 않음).
- **무료 등급에서는 요청 데이터가 Google 제품 개선에 활용될 수 있다.** 이 앱이 Gemini 로
  보내는 것은 캐릭터 반응 문구(텍스트)뿐이고 아이 음성은 보내지 않는다. 이 전제가
  바뀌는 수정(예: 아이 답변 원문을 Gemini 로 전송)을 할 때는 유료 등급 전환을 검토할 것.
- 유료 전환 시(키 소유자가 결제 연결): 텍스트 입력 + 오디오 출력 토큰 과금.
  반응 한 건(문장 1~2개, 오디오 수 초)은 수 원 수준.
- 한도·요금: <https://ai.google.dev/pricing>

### Google Cloud TTS — Chirp3-HD (폴백)

- 글자 수 과금, Chirp3-HD 급 보이스 약 $30/100만 자 (무료 할당 별도)
- 반응 한 건이 60~80자 수준이라 유료 구간이어도 건당 2~3원 수준
- 공식 요금: <https://cloud.google.com/text-to-speech/pricing>

### Supabase

- 현재 무료 플랜 범위(인증·DB 사용량 미미)로 충분. 대시보드 Usage 에서 확인.

## 3. 1회 플레이 예상 비용

1회 플레이 = 영상 5파트 + 인터랙티브 대화 4회 기준. "다시 말하기"를 쓰면 그만큼 비례 증가.

| 항목 | 계산 | 비용 |
|---|---|---|
| STT | 대화 4회 × 15초(올림) = 1분 | 무료 60분 내 0원, 초과 시 ≈ 35원 |
| TTS (Gemini 무료 등급) | 반응 4건 | 0원 (한도 내) |
| TTS (Chirp3 폴백 시) | 반응 4건 × ~70자 ≈ 280자 | 무료 할당 내 0원, 유료 구간 ≈ 8~10원 |
| 영상·이미지·정답 음성 | 사전 제작 파일 재생 | 0원 |

→ **월 60회 플레이까지는 사실상 0원.** 초과분부터 STT 가 플레이당 ≈ 35원으로 비용의
대부분을 차지한다. 규모가 커지면 STT 최적화(녹음 길이 단축 등)가 첫 번째 절감 대상.

## 4. 사용량·청구 확인하는 곳

**팀 Cloud 프로젝트 (STT + TTS 폴백)**

- 청구 리포트: <https://console.cloud.google.com/billing> → 보고서 (서비스별 필터: Speech-to-Text / Text-to-Speech)
- API 호출량: <https://console.cloud.google.com/apis/dashboard> → 각 API → "측정항목"
- 이번 달 STT 무료 60분을 얼마나 썼는지도 여기 호출량(초 단위)으로 가늠한다

**개인 Gemini 키 (TTS 메인)**

- 사용량·한도: <https://aistudio.google.com> → API Keys / Usage
- 무료 등급이면 청구서 자체가 없다. 결제를 연결한 경우에만 위 Cloud 청구 리포트에
  (키 소유자 본인 프로젝트로) 잡힌다.

**Supabase**

- <https://supabase.com/dashboard> → 프로젝트 → Usage

## 5. 요금 사고 방지 체크리스트

- [ ] Cloud 콘솔 결제 → **예산 및 알림**에서 월 예산(예: ₩10,000) 알림 설정 (팀 프로젝트 소유자)
- [ ] API 키의 "API 제한"을 필요한 API 만 허용한 상태로 유지
- [ ] STT "(Logged)" 옵션 사용 금지 유지
- [ ] 실제 키 값은 `.env.local` 에만 둔다 — `.env.example` 은 키 이름만 (커밋되는 파일)
- [ ] `X-TTS-Model` 헤더가 계속 `chirp3-hd-fallback` 이면 Gemini 한도/오류 상태를 확인
