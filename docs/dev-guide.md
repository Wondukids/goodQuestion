# 개발자 모드 가이드 — `/dev` 도구 3종과 `/api/dev` 라우트

배포 화면과 무관하게 팀 내부에서만 쓰는 개발 도구 모음. `/dev` 아래 페이지 3개와
그 페이지들이 부르는 `/api/dev` 라우트가 전부다. 작성: 2026-08-14, `api_team` 브랜치 기준.

관련 문서: STT·TTS 모듈 자체는 [frontend-guide.md](./frontend-guide.md),
재생 화면 전반은 [fart-bride-guide.md](./fart-bride-guide.md),
API 요청·응답 계약은 [api-spec.md](./api-spec.md).

## 1. 접속 방법

로그인·권한 체크가 **없다**. 개발 서버를 띄우고 주소를 직접 입력하면 바로 열린다.
메인 앱 어디에도 링크가 없으므로 URL 을 아는 것이 곧 접속 방법이다.

```bash
pnpm dev          # Next 개발 서버 (기본 http://localhost:3000)
```

| 주소 | 도구 | 용도 |
|---|---|---|
| `/dev/voice-test` | 음성 테스트 | STT·TTS 를 이야기 화면 밖에서 따로 확인 |
| `/dev/git` | 커밋 그래프 | 저장소 커밋 그래프 보기 + 체크아웃·워크트리 |
| `/dev/video-maker` | 영상 제작 도우미 | 컷 이미지·음성으로 애니매틱 미리보기 + 컷 편집 |

`/dev` 페이지들은 `(main)` 레이아웃 **밖**에 있다 — 배포 화면의 헤더·네비게이션이
붙지 않고, 로그인 리다이렉트도 타지 않는다. 새 개발 도구를 만들 때도 같은 위치
(`src/app/dev/<이름>/page.tsx`, API 는 `src/app/api/dev/<이름>/route.ts`)에 둔다.

## 2. `/dev/voice-test` — STT·TTS 개인 테스트

실제 재생 흐름과 **같은 헬퍼**(`src/stt`, `src/tts`)를 그대로 호출한다. 키 설정·
모델 폴백·마이크 녹음이 이야기 화면과 동일하게 재현되므로, 여기서 되면 재생
화면에서도 된다.

- **TTS**: 텍스트·성우(Despina 내레이션 / Leda 며느리 / Schedar 시아버지 /
  Sadachbia 이장님)·말투 프롬프트를 넣고 합성. 결과에 어느 모델 경로로 나갔는지
  (`X-TTS-Model`)와 소요 시간·용량이 표시된다.
- **Gemini 전용 토글**: 켜면 폴백 없이 `gemini-api-2.5-flash-tts` 로 고정 —
  실패가 폴백에 가려지지 않고 에러로 드러난다. 폴백 3단 구조는
  [fart-bride-guide.md](./fart-bride-guide.md) 5절 참고.
- **대본 불러오기**: `src/stories/fart-bride/script.ts` 의 섹션별 대사를 골라
  텍스트·성우를 한 번에 채운다.
- **STT**: 마이크 녹음 → 전사. 전사가 실패해도 녹음 재생은 되도록 만들어져 있어
  마이크 문제인지 STT 문제인지 구분할 수 있다.

TTS·STT 키(`.env`)가 없으면 해당 기능만 에러가 난다 — 페이지 자체는 뜬다.

## 3. `/dev/git` — 커밋 그래프

전 브랜치 커밋 그래프(최근 200개, topo 순)를 그리고, 상단에 현재 브랜치·HEAD·
워킹트리 오염(dirty) 파일 수·워크트리 목록을 보여 준다.

커밋을 **우클릭**하면:

| 메뉴 | 하는 일 |
|---|---|
| 체크아웃 | `git checkout <ref>` — 워킹트리가 더러우면 git 에러가 그대로 뜬다 |
| 워크트리 만들기 | 저장소 **옆** `<repo>-worktrees/<이름>` 에 `git worktree add` (해시는 detached) |
| 워크트리 제거 | 목록에 있는 워크트리만 `git worktree remove` |
| 해시 복사 | 커밋 해시를 클립보드로 |

일부러 `--force` 옵션이 **없다**. 실패하면 git 의 stderr 가 상단 알림에 그대로
보이니, 커밋·스태시 후 다시 시도한다. 강제로 밀어야 하는 상황이면 터미널에서
직접 할 일이다.

## 4. `/dev/video-maker` — 영상 제작 도우미

컷 이미지 + 녹음 음성으로 이야기를 미리 보고(애니매틱), 컷 구성을 그 자리에서
편집한다:

- **이미지 교체** — 소스 폴더의 이미지 중에서 선택
- **대사 연결·순서 변경** — 사운드 파일이 실제로 존재하는 대사만 선택지에 뜬다
- **컷 연출** — 등장 전환 + 카메라 효과 (`src/frontendlib` 효과를 그대로 재사용)

"저장"을 누르면 `src/stories/fart-bride/video-plan.json` 에 그대로 기록된다.
저장 포맷은 `content/stories/fart-bride/database/build_video_plan.mjs` 출력과
동일해서, 손 편집과 스크립트 재생성이 섞여도 diff 가 깨끗하다.

원본 에셋은 `content/stories/fart-bride/source/{image,sound}` 에서 읽는다.
`public` 으로 복사하지 않는 이유: 원본이 수십 MB 인 데다 제작 단계라 교체가 잦아,
복사본이 생기면 어느 쪽이 최신인지 헷갈린다. 이 폴더가 없으면 목록이 비거나
에러가 나니, 에셋을 받은 뒤에 열 것.

## 5. `/api/dev` 라우트 요약

| 라우트 | 메서드 | 하는 일 |
|---|---|---|
| `/api/dev/git` | GET | 커밋 로그·HEAD·브랜치·dirty 수·워크트리 목록 |
| `/api/dev/git/action` | POST | `checkout` / `worktree-add` / `worktree-remove` 실행 |
| `/api/dev/story-assets/list` | GET | 소스 폴더의 이미지·사운드 파일명 목록 |
| `/api/dev/story-assets/{image,sound}/<파일>` | GET | 원본 에셋 서빙 (`Cache-Control: no-cache`) |
| `/api/dev/video-plan` | POST | 편집한 플랜을 `video-plan.json` 에 저장 |

안전장치가 이미 들어 있으니 고칠 때 유지할 것:

- git 은 `execFile` 인자 배열로만 호출 — 셸 해석이 없다. ref 는 해시·브랜치명
  형태만 통과하고 `-` 로 시작하는 값(옵션 위장)·`..` 은 거부한다.
- 에셋 라우트는 `..` 세그먼트로 소스 폴더 밖을 읽지 못하게 경로를 검증한다.
- 워크트리 제거는 실제 워크트리 목록에 있는 경로만 — 임의 폴더 삭제 방지.
- video-plan 저장은 `story: "fart-bride"` + 비어 있지 않은 `cuts` 배열 모양을
  검증한다 — 다른 데이터를 통째로 덮어쓰는 사고 방지.

## 6. 주의 — 배포에 내보내지 말 것

`/dev`·`/api/dev` 에는 인증이 없고, 서버에서 **git 을 실행하고 파일을 쓰는**
라우트가 포함돼 있다. 로컬 개발 머신에서만 쓰는 전제로 만들어졌다.

- 현재 `NODE_ENV` 가드나 미들웨어 차단이 **없다** — `next build` 하면 프로덕션
  번들에도 그대로 포함된다. 외부에 배포하는 날이 오면 그 전에 `/dev`·`/api/dev`
  를 빌드에서 제외하거나 접근을 막는 작업이 먼저다.
- 같은 이유로, 개발 서버를 외부망에 노출(터널링·`--hostname 0.0.0.0` 등)한 채로
  두지 말 것.
