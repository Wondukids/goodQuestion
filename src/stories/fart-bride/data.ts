/**
 * 재생 순서 정의 — 영상 5파트 사이에 인터랙티브 4씬이 끼어드는 구조.
 *
 * part1[씬1-3] → 씬4 대화 → part2[씬5-6] → 씬7 대화 → part3[씬8-9]
 * → 씬10 대화 → part4[씬11-15] → 씬16 대화 → part5[씬17-18]
 *
 * 원본: content/stories/fart-bride/database/story_database.json (대사·성우 매핑).
 * 에셋은 public/stories/fart-bride/ 로 복사하면서 ASCII 이름으로 바꿨다.
 * 씬 10 의 미니게임 단계는 아직 미정이라 건너뛴다 (PART3·PART5 에 제작 예정).
 */

const BASE = "/stories/fart-bride";

export type SpeechLine = {
  /** 자막용 텍스트. "ㅇㅇ" 은 아이 이름 자리 — 치환은 아직 안 한다. */
  text: string;
  /** 사전 녹음 음성 경로 */
  audio: string;
};

export type VideoStep = {
  kind: "video";
  id: string;
  label: string;
  src: string;
};

export type InteractiveStep = {
  kind: "interactive";
  id: string;
  sceneId: number;
  speaker: {
    label: string;
    /** Google Gemini 2.5 Flash TTS 보이스 이름 */
    voice: "Leda" | "Schedar" | "Sadachbia" | "Despina";
    /** Gemini-TTS 말투 연기 지시 (input.prompt) */
    stylePrompt: string;
  };
  question: { image: string; lines: SpeechLine[] };
  answer: { image: string; lines: SpeechLine[] };
};

export type Step = VideoStep | InteractiveStep;

/** story_database.json 의 meta.sttDefaults */
export const STT_DEFAULTS = {
  maxListenSec: 10,
  retryCount: 1,
  proceedOnSilence: true,
};

export const SEQUENCE: Step[] = [
  {
    kind: "video",
    id: "part1",
    label: "1부 · 도입",
    src: `${BASE}/video/part1.mp4`,
  },
  {
    kind: "interactive",
    id: "scene4",
    sceneId: 4,
    speaker: {
      label: "며느리",
      voice: "Leda",
      stylePrompt:
        "다정하고 조심스러운 젊은 여성이 아이에게 속마음을 털어놓듯, 부드럽고 따뜻하게 말해 주세요.",
    },
    question: {
      image: `${BASE}/image/s4-question.png`,
      lines: [
        {
          text: "ㅇㅇ아, 내 방귀가 너무 크다는 걸 알면 가족들이 나를 이상하게 생각하지 않을까?",
          audio: `${BASE}/sound/s4-question-1.wav`,
        },
      ],
    },
    answer: {
      image: `${BASE}/image/s4-answer.png`,
      lines: [
        {
          text: "그렇구나. 그래도 아직은 못 말하겠어, 조금만 더 참아 볼게.",
          audio: `${BASE}/sound/s4-answer-1.wav`,
        },
      ],
    },
  },
  {
    kind: "video",
    id: "part2",
    label: "2부 · 방귀 폭발",
    src: `${BASE}/video/part2.mp4`,
  },
  {
    kind: "interactive",
    id: "scene7",
    sceneId: 7,
    speaker: {
      label: "시아버지",
      voice: "Schedar",
      stylePrompt:
        "근엄하지만 속정 있는 할아버지가 못마땅한 듯하면서도 아이에게는 낮고 부드러운 목소리로 말해 주세요.",
    },
    question: {
      image: `${BASE}/image/s7-question.png`,
      lines: [
        {
          text: "아이고, 이게 무슨 일이냐! 우리 집안이 다 흔들리는구나! 이렇게 창피한 며느리랑 함께 못 살겠다! 그렇지 않니?",
          audio: `${BASE}/sound/s7-question-1.wav`,
        },
      ],
    },
    answer: {
      image: `${BASE}/image/s7-answer.png`,
      lines: [
        {
          text: "흥, 그래도 도저히 이런 며느리와는 함께 살 수 없으니 친정으로 데려다줘야겠다.",
          audio: `${BASE}/sound/s7-answer-1.wav`,
        },
      ],
    },
  },
  {
    kind: "video",
    id: "part3",
    label: "3부 · 배나무",
    src: `${BASE}/video/part3.mp4`,
  },
  {
    kind: "interactive",
    id: "scene10",
    sceneId: 10,
    speaker: {
      label: "이장님",
      voice: "Sadachbia",
      stylePrompt:
        "쾌활한 마을 어른이 너털웃음을 섞어 감탄하듯, 활기차고 정겹게 말해 주세요.",
    },
    question: {
      image: `${BASE}/image/s10-question.png`,
      lines: [
        {
          text: "이 배나무는 해마다 탐스러운 배가 열리지만, 너무 높아서 아무도 딸 수가 없었단다.",
          audio: `${BASE}/sound/s10-question-1.wav`,
        },
      ],
    },
    answer: {
      image: `${BASE}/image/s10-answer.png`,
      lines: [
        {
          text: "아이고, 방귀 뀌는 며느리 덕분에 온 마을이 배 잔치를 할 수 있겠구려, 고맙소!",
          audio: `${BASE}/sound/s10-answer-1.wav`,
        },
      ],
    },
  },
  {
    kind: "video",
    id: "part4",
    label: "4부 · 방귀 나갑니다!",
    src: `${BASE}/video/part4.mp4`,
  },
  {
    kind: "interactive",
    id: "scene16",
    sceneId: 16,
    speaker: {
      label: "며느리",
      voice: "Leda",
      stylePrompt:
        "홀가분해진 젊은 여성이 아이에게 고마움을 전하듯, 밝고 따뜻하게 말해 주세요.",
    },
    question: {
      image: `${BASE}/image/s16-question.png`,
      lines: [
        {
          text: "ㅇㅇ이 덕분에 내 방귀가 누군가에게 도움이 될 수 있다는 걸 처음 알았어.",
          audio: `${BASE}/sound/s16-question-1.wav`,
        },
        {
          text: "이제는 방귀 소리가 큰 걸 부끄러워하지 않아도 될까?",
          audio: `${BASE}/sound/s16-question-2.wav`,
        },
      ],
    },
    answer: {
      image: `${BASE}/image/s16-answer.png`,
      lines: [
        {
          text: "이제는 부끄러워하며 숨기지 않고, 조심해서 좋은 일에 써 볼게.",
          audio: `${BASE}/sound/s16-answer-1.wav`,
        },
      ],
    },
  },
  {
    kind: "video",
    id: "part5",
    label: "5부 · 마무리",
    src: `${BASE}/video/part5.mp4`,
  },
];
