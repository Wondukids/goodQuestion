/**
 * 미니게임 미션1 — "배를 어떻게 딸까?" 소품 고르기의 문구·에셋 정의.
 *
 * 시안(Figma 3FKEq3j8N6aIuRdfZO32VH, 페이지 1):
 *   01_탐색(41:1008) → 02·03·04_소품선택(41:1064·41:1115·41:1166)
 *   → 06_정답(41:1269) → 07·08_대화(41:1321·41:1373) → 09_마지막대사(41:1425)
 *
 * 대사와 설명은 줄바꿈 자리까지 시안 그대로다 — 고치려면 시안부터 고쳐야 한다.
 * 에셋은 시안에서 내보내 public/figma/minigame/pear-mission/ 에 담아 뒀다.
 */

import type { TtsVoice } from "@/tts/voices";

const ASSETS = "/figma/minigame/pear-mission";

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

export type MissionProp = {
  id: string;
  name: string;
  /** 말풍선 설명 — 시안의 두 줄을 그대로 나눠 둔다 */
  desc: [string, string];
  image: string;
};

/** 배나무 아래 놓인 소품 셋 — 화면에 놓이는 순서다 */
export const PROPS: MissionProp[] = [
  {
    id: "sokuri",
    name: "소쿠리",
    desc: ["물건을 담는", "대나무 바구니예요."],
    image: `${ASSETS}/prop-sokuri.png`,
  },
  {
    id: "bojagi",
    name: "보자기",
    desc: ["물건을 감쌀 수", "있어요."],
    image: `${ASSETS}/prop-bojagi.png`,
  },
  {
    id: "byeotjip",
    name: "볏짚",
    desc: ["바닥에 깔아 둘 수", "있어요."],
    image: `${ASSETS}/prop-byeotjip.png`,
  },
];

/**
 * 이장님 대사 — 단계마다 한 줄이다.
 * inspect 는 소품을 눌러 본 뒤부터 고른 뒤(06)까지 이어지는 같은 대사라,
 * 고르는 사이에 음성이 다시 나오지 않는다 (시안 02 와 06 이 같은 문장).
 */
export const LINES = {
  explore: "오호, 며느리의 방귀로 말인가? 그럼 어떻게 배를 안전하게 딸수 있을까?",
  inspect: "오호! 그런데 이걸로 어떻게 해야 안전하게 딸 수 있는거요.",
  talk: "흠, 그런데 며느리가 부끄럽다고 안 해 주면 어쩌나…",
  finish:
    "그래! 그렇게 말하면 되겠구려!\n아이고, 방귀 뀌는 며느리 덕분에 온 마을이 배 잔치를 할 수 있겠구려, 고맙소!",
} as const;

/** 01_탐색 화면 한가운데 뜨는 안내 문구 */
export const GUIDE_TEXT = "궁금한 물건을 눌러보세요!";
