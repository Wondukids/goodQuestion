/**
 * 미니게임 미션2 — "친구의 고민을 다시 보기" 의 문구·에셋 정의.
 *
 * 미션1(배 따기 소품 고르기)과는 전혀 다른 미션이다. 시안 캔버스도
 * 1366×1024 로 다르고, 대화 패널 생김새도 따로다 — 코드도 따로 둔다.
 *
 * 시안(Figma 3FKEq3j8N6aIuRdfZO32VH, 페이지 1):
 *   01_친구선택(41:545) → 02_카드확대(41:567·584·601·618)
 *   → 03_발화중(41:635) → 04·05_며느리반응(41:740·41:678)
 *   → 06_친구선택_2회차(41:718) → 07_미션완료(41:700)
 *   → 08_되묻기_짧은답변(41:661)
 *
 * 며느리 대사는 녹음(content/stories/mission2/*.wav)을 따른다 — 문구를 바꾸려면
 * 녹음부터 다시 해야 한다. 음성은 본편처럼 public 에 ASCII 이름으로 복사해 뒀다.
 * 되묻기(reask)만은 녹음이 없어 글로만 보여 준다.
 * "ㅇㅇ" 은 아이 이름 자리 — name.ts 의 fillChildName 이 채운다.
 */

import type { TtsVoice } from "@/tts/voices";

const ASSETS = "/figma/minigame/friend-mission";
const SOUND = "/stories/fart-bride/sound";

export const BRIDE = {
  name: "며느리",
  avatar: `${ASSETS}/bride-avatar.png`,
  /* data.ts 씬4·씬16 의 며느리와 같은 성우·말투 */
  voice: "Leda" as TtsVoice,
  stylePrompt:
    "다정하고 조심스러운 젊은 여성이 아이에게 속마음을 털어놓듯, 부드럽고 따뜻하게 말해 주세요.",
};

/** 며느리 포즈 — 단계마다 다른 그림을 쓴다 (시안 01·02·03·04·06·07·08) */
export const BRIDE_POSE = {
  point: `${ASSETS}/bride-point.png`, // 01 친구 고르기
  point2: `${ASSETS}/bride-point2.png`, // 06 두 번째부터 (시안에서 좌우 뒤집어 쓴다)
  listen: `${ASSETS}/bride-listen.png`, // 02 카드 확대, 아이 차례를 기다린다
  think: `${ASSETS}/bride-think.png`, // 03 아이 말을 듣는 중
  worry: `${ASSETS}/bride-worry.png`, // 08 짧은 답변에 되묻는다
  smile: `${ASSETS}/bride-smile.png`, // 05 아이 말을 듣고 반가워한다
  joy: `${ASSETS}/bride-joy.png`, // 07 미션 완료
};

export const SCENE = {
  background: `${ASSETS}/bg.jpg`,
  childAvatar: `${ASSETS}/child-avatar.png`,
  childAvatarActive: `${ASSETS}/child-avatar-active.png`,
};

/** 며느리 대사 한 줄 — 화면에 보여 줄 글과 사전 녹음 음성 경로 (되묻기는 녹음이 없다) */
export type MissionLine = {
  text: string;
  audio?: string;
};

export type Friend = {
  id: string;
  name: string;
  /** 카드에 적히는 고민 — 결과 화면에서는 취소선이 그어진다 */
  trouble: string;
  /** 이 친구를 고르면 며느리가 묻는 말 (친구마다 녹음이 따로 있다) */
  ask: MissionLine;
  /**
   * 아이가 너무 짧게 답했을 때 며느리가 되묻는 말 (시안 08).
   * 시안에 있는 건 "목소리가 큰 친구" 하나뿐이라, 나머지는 각자의
   * trouble 문장에서 같은 방식으로 뽑았다. 녹음이 없어 글로만 보여 준다.
   */
  reask: string;
  image: string;
};

/** 카드가 놓이는 순서 그대로 (시안 01) */
export const FRIENDS: Friend[] = [
  {
    id: "scared",
    name: "겁이 많은 친구",
    trouble: "겁이 많아서 겁쟁이라는 말을 들어요.",
    ask: {
      text: "겁이 많은 친구한테는 내가 어떻게 이야기해주면 좋을까?",
      audio: `${SOUND}/m2-ask-scared.wav`,
    },
    reask: "정말? 겁쟁이라고 놀림받았는데도 괜찮을까?",
    image: `${ASSETS}/friend-scared.png`,
  },
  {
    id: "loud",
    name: "목소리가 큰 친구",
    trouble: "목소리가 커서 시끄럽다는 말을 들어요.",
    ask: {
      text: "목소리가 큰 친구한테는 내가 어떻게 이야기해주면 좋을까?",
      audio: `${SOUND}/m2-ask-loud.wav`,
    },
    reask: "정말? 시끄럽다고 놀림받았는데도 괜찮을까?",
    image: `${ASSETS}/friend-loud.png`,
  },
  {
    id: "talkative",
    name: "말이 많은 친구",
    trouble: "말이 많아서 그만하라는 말을 들어요.",
    ask: {
      text: "말이 많은 친구한테는 내가 어떻게 이야기해주면 좋을까?",
      audio: `${SOUND}/m2-ask-talkative.wav`,
    },
    reask: "정말? 그만하라는 말을 들었는데도 괜찮을까?",
    image: `${ASSETS}/friend-talkative.png`,
  },
  {
    /* 녹음이 "장난을 많이 치는 친구" 로 나와 힘이 센 친구를 대신한다.
       카드 그림은 아직 힘이 센 친구 것 — 새 그림이 오면 바꿔야 한다. */
    id: "playful",
    name: "장난을 많이 치는 친구",
    trouble: "장난을 많이 쳐서 짓궂다는 말을 들어요.",
    ask: {
      text: "장난을 많이 치는 친구한테는 내가 어떻게 이야기해주면 좋을까?",
      audio: `${SOUND}/m2-ask-playful.wav`,
    },
    reask: "정말? 짓궂다고 놀림받았는데도 괜찮을까?",
    image: `${ASSETS}/friend-strong.png`,
  },
];

/** 며느리 대사 — 단계마다 한 줄. 카드를 고른 뒤의 질문은 위 FRIENDS 의 ask 다. */
export const LINES = {
  /** 01 첫 화면 */
  intro: {
    text: "나한테 용기를 줘서 고마워. 내 주위에도 나처럼 고민이 있는 친구들이 있는데 너가 도와줄 수 있어?",
    audio: `${SOUND}/m2-intro.wav`,
  },
  /** 05 아이 말을 듣고 나서 — 여기서 "다른 친구도/이제 괜찮아요" 를 고른다 */
  react: {
    text: "좋은 생각이다. 혹시, 다른 친구 고민도 도와줄 수 있어?",
    audio: `${SOUND}/m2-react.wav`,
  },
  /** 06 두 번째부터의 친구 고르기 */
  more: {
    text: "또 도와주고 싶은 친구는 누구야?",
    audio: `${SOUND}/m2-more.wav`,
  },
  /** 07 마무리 */
  done: {
    text: "도와줘서 고마워! 덕분에 내 친구들도 나처럼 용기를 얻었을 것 같아.",
    audio: `${SOUND}/m2-finish.wav`,
  },
} as const satisfies Record<string, MissionLine>;

/** 카드 위에 뜨는 안내 문구 (시안 01·06) */
export const GUIDE_TEXT = "누구부터 도와줄까? 한 명을 눌러줘";

/** 결과 카드에 붙는 말머리 (시안 05) */
export const RESULT_LABEL = "ㅇㅇ이가 발견한 멋진 점";

/* 「6자 미만이면 되묻기」 클라이언트 규칙은 서버 판정(SHORT/UNCLEAR · M9)으로
   대체돼 지웠다 — 되묻기 문구(reask)만 폴백 사본으로 남는다 (이슈 #20). */
