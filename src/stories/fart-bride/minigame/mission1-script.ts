/**
 * 미니게임 미션1 — "배를 어떻게 딸까?" 소품 고르기의 문구·에셋 정의.
 *
 * 시안(Figma 3FKEq3j8N6aIuRdfZO32VH, 페이지 1):
 *   01_탐색(41:1008) → 02·03·04_소품선택(41:1064·41:1115·41:1166)
 *   → 06_정답(41:1269) → 07·08_대화(41:1321·41:1373) → 09_마지막대사(41:1425)
 *
 * 소품 설명은 줄바꿈 자리까지 시안 그대로다 — 고치려면 시안부터 고쳐야 한다.
 * 이장님 대사는 녹음(content/stories/mission1/*.wav)을 따른다 — 문구를 바꾸려면
 * 녹음부터 다시 해야 한다. 음성은 본편처럼 public 에 ASCII 이름으로 복사해 뒀다.
 * 에셋은 시안에서 내보내 public/figma/minigame/pear-mission/ 에 담아 뒀다.
 */

import type { TtsVoice } from "@/tts/voices";

const ASSETS = "/figma/minigame/pear-mission";
const SOUND = "/stories/fart-bride/sound";

export const CHIEF = {
  name: "마을 이장님",
  avatar: `${ASSETS}/chief-avatar.png`,
  body: `${ASSETS}/chief.png`,
  /* data.ts 씬10 의 이장님과 같은 성우·말투 — 이야기에서 미니게임으로 넘어와도
     목소리가 바뀌지 않는다 */
  voice: "Sadachbia" as TtsVoice,
  stylePrompt:
    "쾌활한 마을 어른이 너털웃음을 섞어 감탄하듯, 활기차고 정겹게 말해 주세요.",
};

export const SCENE = {
  background: `${ASSETS}/bg.jpg`,
  tree: `${ASSETS}/tree.png`,
  halo: `${ASSETS}/halo.svg`,
  bubble: `${ASSETS}/speech-bubble.svg`,
  mic: `${ASSETS}/mic.svg`,
  volume: `${ASSETS}/volume-2.svg`,
  arrow: "/figma/icons/ms/arrow_forward.svg",
};

/** 이장님 대사 한 줄 — 화면에 보여 줄 글과 사전 녹음 음성 경로 */
export type MissionLine = {
  text: string;
  audio: string;
};

export type MissionProp = {
  id: string;
  name: string;
  /** 말풍선 설명 — 시안의 두 줄을 그대로 나눠 둔다 */
  desc: [string, string];
  image: string;
  /** 이 소품을 살펴볼 때 이장님이 묻는 말 (소품마다 녹음이 따로 있다) */
  ask: MissionLine;
};

/** 배나무 아래 놓인 소품 셋 — 화면에 놓이는 순서다 */
export const PROPS: MissionProp[] = [
  {
    id: "sokuri",
    name: "소쿠리",
    desc: ["물건을 담는", "대나무 바구니예요."],
    image: `${ASSETS}/prop-sokuri.png`,
    ask: {
      text: "소쿠리말인가? 소쿠리를 어떻게 사용해야 배를 안전하게 딸 수 있겠는가?",
      audio: `${SOUND}/m1-pick-sokuri.wav`,
    },
  },
  {
    id: "bojagi",
    name: "보자기",
    desc: ["물건을 감쌀 수", "있어요."],
    image: `${ASSETS}/prop-bojagi.png`,
    ask: {
      text: "보자기말인가? 보자기로 어떻게 해야 배를 안전하게 딸 수 있겠는가?",
      audio: `${SOUND}/m1-pick-bojagi.wav`,
    },
  },
  {
    id: "byeotjip",
    name: "볏짚",
    desc: ["바닥에 깔아 둘 수", "있어요."],
    image: `${ASSETS}/prop-byeotjip.png`,
    ask: {
      text: "짚말인가? 짚으로 어떻게 해야 배를 안전하게 딸 수 있겠는가?",
      audio: `${SOUND}/m1-pick-byeotjip.wav`,
    },
  },
];

/**
 * 이장님 대사 — 단계마다 한 줄이다. 소품을 살펴보는 동안(inspect·reveal)은
 * 위 PROPS 의 ask 가 대신 쓰인다 — 같은 소품이면 눌러 볼 때와 고른 뒤의
 * 문장이 같아, 고르는 사이에 음성이 다시 나오지 않는다 (시안 02 와 06).
 */
export const LINES = {
  explore: {
    text: "오호, 며느리의 방귀로 말인가? 그러면 어떻게 해야 배를 안전하게 딸 수 있겠는가?",
    audio: `${SOUND}/m1-question-1.wav`,
  },
  talk: {
    text: "그것 좋은 생각이군. 그런데 며느리가 부끄럽다고 안 해 주면 어쩌나… 뭐라고 부탁을 해야 할까?",
    audio: `${SOUND}/m1-question-2.wav`,
  },
  finish: {
    text: "그래! 그렇게 말하면 되겠구려!",
    audio: `${SOUND}/m1-finish.wav`,
  },
} as const satisfies Record<string, MissionLine>;

/** 01_탐색 화면 한가운데 뜨는 안내 문구 */
export const GUIDE_TEXT = "궁금한 물건을 눌러보세요!";
