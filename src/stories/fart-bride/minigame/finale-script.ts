/**
 * 마무리(말하기 후 활동) — 이야기 카드 순서를 맞추고, 핵심 단어를 보며
 * 아이가 줄거리를 통째로 들려주는 활동의 문구·에셋 정의.
 *
 * 미니게임 미션들과 달리 팝업 안에서 두 단계가 이어진다:
 *   1 카드순서맞추기(41:1482) → 2 키워드로 줄거리말하기(41:1571)
 * 시안: Figma 3FKEq3j8N6aIuRdfZO32VH 의 「마무리」 섹션(41:1481).
 *
 * 카드 그림은 이야기 원본 컷(content/stories/fart-bride/source/image)을
 * 카드 크기로 줄여 public 으로 옮긴 것이다 — 시안은 회색 자리 표시였다.
 */

const ASSETS = "/figma/minigame/finale";

export const SCENE = {
  tap: `${ASSETS}/tap.svg`,
  close: `${ASSETS}/close.svg`,
  mic: `${ASSETS}/mic.svg`,
  swap: "/figma/icons/ms/swap_horiz.svg",
  drag: "/figma/icons/ms/drag_indicator.svg",
  chevron: "/figma/icons/ms/chevron_right.svg",
};

export type StoryScene = {
  id: string;
  /** 카드에 적히는 장면 이름 */
  title: string;
  /** 2단계에서 보여 주는 핵심 단어 셋 */
  keywords: string[];
  /** 핵심 단어 칩 색 — 장면마다 다르다 (시안 2단계) */
  chip: string;
  image: string;
};

/**
 * 이야기 순서 — 이 배열 순서가 정답이다.
 *
 * 시안 2단계의 1번 카드 이름은 "시집온 새 며느리" 인데, 기획에서 정한 정답은
 * "방귀를 참는 며느리" 라 그쪽을 따랐다 (핵심 단어는 양쪽에 다 맞는다).
 * 2번 핵심 단어도 시안에는 "방귀·방귀·기둥" 으로 방귀가 겹쳐 있어
 * 둘째를 "깜짝" 으로 바꿨다 — 시안이 고쳐지면 여기도 맞추면 된다.
 */
export const SCENES: StoryScene[] = [
  {
    id: "endure",
    title: "방귀를 참는 며느리",
    keywords: ["시집", "참다", "걱정"],
    chip: "bg-primary-strong/15 text-primary",
    image: `${ASSETS}/scene-1.jpg`,
  },
  {
    id: "burst",
    title: "들켜버린 큰 방귀",
    keywords: ["방귀", "깜짝", "기둥"],
    chip: "bg-brand-900/15 text-brand-900",
    image: `${ASSETS}/scene-2.jpg`,
  },
  {
    id: "pear",
    title: "배나무 앞 방귀 대작전",
    keywords: ["배나무", "힘껏", "우수수"],
    chip: "bg-[#f0a83c]/15 text-[#f0a83c]",
    image: `${ASSETS}/scene-3.jpg`,
  },
  {
    id: "pride",
    title: "마을의 자랑이 된 며느리",
    keywords: ["당당하다", "칭찬", "고마워"],
    chip: "bg-[#7bc47f]/15 text-[#7bc47f]",
    image: `${ASSETS}/scene-4.jpg`,
  },
];

/** 트레이에 처음 깔리는 순서 (시안 01) — 정답 순서와 섞여 있어야 한다 */
export const TRAY_ORDER = ["pear", "pride", "endure", "burst"];

/** 트레이 카드가 조금씩 기울어 놓인 각도 (시안 01) */
export const TRAY_TILT = [-2.99, 0, -2.13, 0.85];

export const TEXT = {
  badge: "말하기 후 활동",
  title: "이야기 순서 맞추기",
  steps: ["순서 맞추기", "핵심 단어 활용하여 말하기"],

  orderGuide: "이야기를 순서대로 놓아줘!",
  slotEmpty: "여기에 놓아줘!",
  trayHint: "카드를 눌러서 위 칸에 놓아요 (끌어다 놓아도 돼요)",
  orderHint: "4장을 다 놓으면 이야기에 꼭 필요한 핵심 단어가 나타나요",
  /** 순서가 틀렸을 때 — 자리가 맞는 카드는 그대로 두고 나머지만 돌려보낸다 */
  orderWrong: "자리가 맞는 카드는 그대로 두었어. 나머지를 다시 놓아볼까?",
  /** 하나도 못 맞혔을 때는 "그대로 두었어" 가 거짓말이 된다 */
  orderWrongNone: "아직이야! 이야기가 시작되는 장면부터 다시 놓아볼까?",
  orderSubmit: "다 놓았어요!",

  tellGuide:
    "순서를 모두 맞췄어! 이제 카드와 핵심 단어를 보면서 '방귀 뀌는 며느리' 이야기를 편하게 들려줘!",
  keywordLabel: "핵심 단어",
  tellReady: "마이크를 누르고 이야기를 들려줘!",
  /** "ㅇㅇ" 자리에 아이 이름이 들어간다 */
  tellRecording: "지금 ㅇㅇ 목소리를 듣고 있어!",
  tellRecorded: "다 말했어! 보내볼까?",
  tellSending: "이야기를 담고 있어…",
  tellDone: "이야기를 잘 들었어. 고마워!",
  tellSubmit: "보내기",
  tellFinish: "마치기",
};

/**
 * 최대 녹음 시간(초).
 *
 * STT 서버가 동기 엔드포인트(speech:recognize)를 쓴다 — 구글이 1분까지만
 * 받아 준다. 줄거리를 통째로 말하는 활동이라 한도 직전까지 열어 두되,
 * 넘기지는 않게 55초에서 자동으로 멈춘다.
 */
export const MAX_TELL_SEC = 55;
