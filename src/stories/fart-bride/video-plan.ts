/**
 * video-plan.json 의 타입과 조회 헬퍼.
 *
 * video-plan.json 은 story_database.json 에서 생성한 영상 컷 시퀀스다 —
 * 손으로 고쳐도 되지만, 원본을 고쳤다면 build_video_plan.mjs 로 다시
 * 생성하는 쪽이 안전하다 (json 안의 regenerate 명령 참고).
 */

import plan from "./video-plan.json";

export type PlanLine = {
  speaker: string;
  text: string;
  /** content/stories/fart-bride/source/sound 의 파일명 */
  audio: string;
  /** 오디오 길이(초) — assets 인덱스에 없으면 null */
  durationSec: number | null;
};

/** 컷이 떠 있는 동안 카메라가 하는 일 (frontendlib 의 카메라·왜곡 연출) */
export type CameraEffect =
  | "none"
  | "zoom-in"
  | "zoom-out"
  | "punch-zoom"
  | "ken-burns-left"
  | "ken-burns-right"
  | "pan-left"
  | "pan-right"
  | "tilt-up"
  | "tilt-down"
  | "orbit"
  | "dutch"
  | "shake"
  | "shake-loop"
  | "punch"
  | "glitch"
  | "chromatic";

/** 컷이 나타날 때의 등장 연출 (frontendlib 의 Reveal·SlideIn·RandomBars) */
export type EnterEffect =
  | "none"
  | "fade"
  | "fade-black"
  | "pop"
  | "scale"
  | "zoom-fade"
  | "slide-left"
  | "slide-right"
  | "slide-up"
  | "slide-down"
  | "wipe-left"
  | "wipe-right"
  | "wipe-up"
  | "wipe-down"
  | "wipe-diagonal"
  | "iris"
  | "split"
  | "blinds"
  | "checkerboard"
  | "random-bars"
  | "flip"
  | "flip-vertical"
  | "rotate"
  | "blur"
  | "bounce";

/** 컷 위에 겹치는 화면 오버레이 (frontendlib 의 레터박스·비네트·플래시) */
export type OverlayEffect =
  | "none"
  | "letterbox"
  | "vignette"
  | "vignette-red"
  | "vignette-pulse"
  | "flash";

/** overlay 는 나중에 추가된 선택 필드 — 기존 video-plan.json 에는 없을 수 있다 */
export type CutEffect = { camera: CameraEffect; enter: EnterEffect; overlay?: OverlayEffect };

export const DEFAULT_EFFECT: CutEffect = { camera: "none", enter: "none", overlay: "none" };

export const CAMERA_EFFECT_LABELS: Record<CameraEffect, string> = {
  none: "없음 (고정)",
  "zoom-in": "줌 인 — 천천히 다가간다",
  "zoom-out": "줌 아웃 — 천천히 물러난다",
  "punch-zoom": "펀치 줌 — 순간 확 다가왔다 복귀",
  "ken-burns-left": "켄 번즈 — 확대하며 왼쪽으로 훑기",
  "ken-burns-right": "켄 번즈 — 확대하며 오른쪽으로 훑기",
  "pan-left": "팬 — 왼쪽으로 훑기",
  "pan-right": "팬 — 오른쪽으로 훑기",
  "tilt-up": "틸트 — 위로 훑기",
  "tilt-down": "틸트 — 아래로 훑기",
  orbit: "오빗 — 주위를 천천히 돈다",
  dutch: "더치 앵글 — 비스듬히 기울어짐 (불안)",
  shake: "셰이크 — 컷 시작에 한 번 흔들림",
  "shake-loop": "셰이크 반복 — 계속 흔들림 (긴장·지진)",
  punch: "펀치 — 옆으로 확 밀렸다 복귀 (방향 충격)",
  glitch: "글리치 — 지지직 깨짐 (한 번)",
  chromatic: "색수차 — 색이 번지는 글리치 (반복)",
};

export const ENTER_EFFECT_LABELS: Record<EnterEffect, string> = {
  none: "없음 (바로 등장)",
  fade: "페이드 인",
  "fade-black": "페이드 스루 블랙 — 검은 화면을 거쳐",
  pop: "팝 인 — 살짝 튀며 등장",
  scale: "스케일 — 작게 시작해 커지며",
  "zoom-fade": "줌 페이드 — 줄어들며 페이드 인",
  "slide-left": "슬라이드 — 왼쪽에서",
  "slide-right": "슬라이드 — 오른쪽에서",
  "slide-up": "슬라이드 — 위에서",
  "slide-down": "슬라이드 — 아래에서",
  "wipe-left": "와이프 — 왼쪽부터 드러남",
  "wipe-right": "와이프 — 오른쪽부터 드러남",
  "wipe-up": "와이프 — 위부터 드러남",
  "wipe-down": "와이프 — 아래부터 드러남",
  "wipe-diagonal": "와이프 — 대각선으로 드러남",
  iris: "아이리스 — 원이 커지며 드러남",
  split: "스플릿 — 가운데서 양쪽으로 열림",
  blinds: "블라인드 — 가로 줄이 펼쳐지며",
  checkerboard: "체커 타일 — 타일마다 쓸어내며",
  "random-bars": "랜덤 바 — 세로 막대가 무작위로",
  flip: "플립 — 카드 뒤집듯 (가로)",
  "flip-vertical": "플립 — 카드 뒤집듯 (세로)",
  rotate: "로테이트 — 기울어진 채 커지며",
  blur: "블러 — 흐릿하다가 선명해지며",
  bounce: "바운스 — 떨어져 튕기며 정착",
};

export const OVERLAY_EFFECT_LABELS: Record<OverlayEffect, string> = {
  none: "없음",
  letterbox: "레터박스 — 위아래 검은 띠 (시네마틱)",
  vignette: "비네트 — 가장자리 어둡게 (집중)",
  "vignette-red": "붉은 비네트 — 위기·피격",
  "vignette-pulse": "비네트 펄스 — 조였다 풀리기 반복 (긴장)",
  flash: "플래시 — 컷 시작에 번쩍",
};

export type PlanCut = {
  /** 컷 번호 — linear 씬은 "1", 인터랙티브 씬은 "4-1"(질문)/"4-2"(답변) */
  id: string;
  scene: number;
  chapter: string;
  title: string;
  kind: "linear" | "question" | "answer";
  /** content/stories/fart-bride/source/image 의 파일명 */
  image: string;
  needsNewImage: boolean;
  screenTransition: boolean;
  /** 이 컷 뒤에 끼어드는 플레이 단계 — 영상 재생 시에는 건너뛴다 */
  after: "stt" | "stt-minigame" | null;
  /** 컷 연출 — 도우미 페이지에서 바꾸고 저장할 수 있다 */
  effect: CutEffect;
  lines: PlanLine[];
  /** lines 오디오 길이 합(초) */
  durationSec: number;
};

export type VideoPlan = {
  story: string;
  title: string;
  generatedFrom: string;
  regenerate: string;
  assetBase: string;
  cuts: PlanCut[];
};

/* json 임포트의 리터럴 추론("after": string 등)을 선언 타입으로 좁힌다 */
export const VIDEO_PLAN = plan as unknown as VideoPlan;

/** 소스 에셋을 dev 라우트(/api/dev/story-assets)로 서빙하는 URL */
export function assetUrl(kind: "image" | "sound", file: string): string {
  return `${VIDEO_PLAN.assetBase}/${kind}/${encodeURIComponent(file)}`;
}
