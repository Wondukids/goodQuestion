/**
 * 보호자 리포트(시안 47-1865 · 47-2045)가 그리는 값.
 *
 * 발화 분석 파이프라인이 아직 없다 — schema.sql 에서 reports ·
 * utterance_analyses 는 "추후 확장" 으로 묶여 있고 채우는 코드도 없다.
 * 그래서 시안의 수치를 그대로 목업으로 두고, 화면에 드러나는 아이 이름만
 * 실제 값으로 갈아 끼운다. 나중에 분석이 붙으면 이 파일만 조회로 바꾸면 된다.
 */

/** 레이더 한 축. label 은 시안이 찍어 둔 이름표 좌표(차트 382×264 기준). */
export type RadarAxis = {
  name: string;
  /** 0~100. 축 길이의 비율로 쓴다 */
  value: number;
  color: string;
  label: { x: number; y: number };
};

/** 역량별 분석 카드 한 장. tint 는 근거 발화 박스 바탕. */
export type SkillDetail = {
  name: string;
  color: string;
  tint: string;
  summary: string;
  quote: string;
  good: string;
  improve: string;
};

/** 어휘 자세히 보기 3단 중 한 칸. */
export type WordGroup = {
  title: string;
  icon: string;
  color: string;
  /** 칩 바탕 — 질문한 어휘만 회색이라 따로 받는다 */
  chipBg: string;
  words: string[];
  /** 접힌 개수 표시("외 3개") — 없으면 표시하지 않는다 */
  more?: string;
};

/** 이야기 주제 이어가기(탭2 왼쪽)의 질문 한 장. */
export type StoryQuestion = {
  type: string;
  scene: string;
  quote: string;
  question: string;
  followUp: string;
};

/** 일상생활로 연결하기(탭2 오른쪽)의 질문 한 장. */
export type DailyQuestion = {
  type: string;
  question: string;
  intent: string;
};

const RADAR: RadarAxis[] = [
  { name: "관점과 공감", value: 78, color: "#6fbcdd", label: { x: 191, y: 12 } },
  { name: "감정 표현", value: 85, color: "#fd7c51", label: { x: 310.5, y: 89 } },
  { name: "상호작용", value: 82, color: "#a78bfa", label: { x: 252.5, y: 206 } },
  { name: "생각과 이유", value: 58, color: "#7bc47f", label: { x: 128, y: 206 } },
  { name: "결과와 해결", value: 64, color: "#ea63d4", label: { x: 65, y: 89 } },
];

const SKILLS: SkillDetail[] = [
  {
    name: "어휘",
    color: "#45a9d3",
    tint: "#eaf6fb",
    summary: "마음을 나타내는 낱말을 상황에 맞게 골라 썼어요",
    quote: "“며느리가 부끄러워했어요. 얼굴이 빨개졌대요.”",
    good: "‘부끄럽다·당당하다’ 같은 마음 낱말 7개를 새로 썼어요",
    improve: "‘좋다/싫다’ 대신 더 구체적인 낱말을 함께 찾아보면 좋아요",
  },
  {
    name: "표현",
    color: "#fd7649",
    tint: "#fff3ec",
    summary: "인물의 말투와 기분을 목소리에 담아 실감나게 말했어요",
    quote: "“나무꾼이 ‘어! 내 도끼가 아니에요!’ 하고 크게 말했어요.”",
    good: "인물이 되어 말하는 장면이 특히 자연스러웠어요",
    improve: "장면을 설명하는 말도 한 문장 덧붙이면 더 좋아요",
  },
  {
    name: "논리",
    color: "#5aa860",
    tint: "#f0f8f1",
    summary: "‘왜냐하면’으로 이유를 붙여 말하기 시작했어요",
    quote: "“사람들이 이상하게 볼까 봐 무서웠기 때문이에요.”",
    good: "이유를 붙인 문장이 이번 활동에서 5번 나왔어요",
    improve: "‘그래서 어떻게 됐어?’로 결과까지 이어 말해보면 좋아요",
  },
];

const WORD_GROUPS: WordGroup[] = [
  {
    title: "주요 어휘",
    icon: "record_voice_over",
    color: "#45a9d3",
    chipBg: "#eaf6fb",
    words: ["부끄럽다", "당당하다", "참다", "신기하다"],
    more: "외 3개",
  },
  {
    title: "질문한 어휘",
    icon: "help",
    color: "#a78bfa",
    chipBg: "#efefef",
    words: ["며느리", "배나무"],
  },
  {
    title: "반복해서 쓴 표현",
    icon: "repeat",
    color: "#5aa860",
    chipBg: "#f0f8f1",
    words: ["“왜냐하면”", "“그래서”", "“진짜”"],
  },
];

const DAILY_QUESTIONS: DailyQuestion[] = [
  {
    type: "내 경험과 이유",
    question: "“{이름}도 부끄러웠던 적 있어? 왜 그런 마음이 들었어?”",
    intent: "자기 경험의 원인을 설명해보기",
  },
  {
    type: "이해와 배려",
    question: "“친구가 부끄러워하면 뭐라고 말해줄 거야?”",
    intent: "다른 사람의 감정을 헤아려보기",
  },
  {
    type: "결과 예상",
    question: "“그렇게 말해주면 친구 기분은 어떨까?”",
    intent: "행동 이후의 결과를 예상해보기",
  },
];

const STORY_QUESTIONS: StoryQuestion[] = [
  {
    type: "생각과 이유",
    scene: "장면 2 · 방귀를 참는 며느리",
    quote: "“며느리가 부끄러워했어요.”",
    question: "“왜 부끄러웠을까? 이유까지 말해줄래?”",
    followUp: "“몰라”라고 한다면 — “{이름}라면 그때 어땠을 것 같아?”",
  },
  {
    type: "관점과 공감",
    scene: "장면 3 · 들켜버린 큰 방귀",
    quote: "“가족들이 깜짝 놀랐어요.”",
    question: "“가족들은 그때 어떤 마음이었을까?”",
    followUp: "짧게 답한다면 — “{이름}가 시아버지였다면 뭐라고 했을까?”",
  },
  {
    type: "결과와 해결",
    scene: "장면 4 · 배나무 앞 방귀 대작전",
    quote: "“며느리가 배를 땄어요.”",
    question: "“배를 딴 다음에는 어떻게 됐을까?”",
    followUp: "막힌다면 — “마을 사람들은 뭐라고 했을까?”",
  },
];

/** 대답이 짧을 때 순서대로 던지는 세 마디. 번호 원의 색이 단계마다 진해진다. */
const FOLLOW_UP_STEPS = [
  {
    title: "다시 말해보기",
    example: "“방금 그 말 한 번만 더 해줄래?”",
    color: "#c9bcec",
  },
  {
    title: "이유 물어보기",
    example: "“왜 그렇게 생각했어?”",
    color: "#a78bfa",
  },
  {
    title: "상상 넓히기",
    example: "“만약에 반대였다면 어땠을까?”",
    color: "#7c5cd6",
  },
] as const;

/** 목업 문장에 박아 둔 {이름} 자리를 실제 아이 이름으로 바꾼다. */
const fill = (text: string, name: string) => text.replaceAll("{이름}", name);

export function buildReport(childName: string) {
  return {
    /** 헤더 기간 선택에 걸리는 활동 — 아직 고정값이다 */
    activity: { story: "「방귀 뀌는 며느리」", date: "8월 3일" },
    toast: `${childName}의 눈높이에 맞춘 대화를 확인해보세요!`,

    summary: {
      title: `${childName}의 말하기 리포트`,
      caption: `「방귀 뀌는 며느리」 활동 · 8월 3일 · 24분 대화`,
      stats: [
        { label: "말한 문장", value: "32개" },
        { label: "새로 쓴 낱말", value: "7개" },
        { label: "질문한 낱말", value: "4개" },
      ],
    },

    radar: {
      axes: RADAR,
      comment: "감정 표현과 상호작용이 특히 잘 드러났어요!",
    },

    skills: SKILLS,
    quoteLabel: `${childName}의 말`,

    highlight: {
      scene: "장면 3 · 들켜버린 큰 방귀",
      quote:
        "“며느리가 부끄러워했어요. 왜냐하면 사람들이 이상하게 볼까 봐 무서웠기 때문이에요.”",
      comment: `인물의 마음과 그 이유를 한 문장으로 이어 말해, ${childName}의 강점이 가장 잘 드러난 말이에요.`,
    },

    words: {
      caption: `이번 활동에서 ${childName}가 쓴 말`,
      groups: WORD_GROUPS,
      /** 피드백 문장 가운데 한 낱말만 파랗게 강조한다 */
      feedback: {
        before: "마음을 나타내는 낱말을 골라 쓰는 모습이 좋았어요. 오늘 저녁에는 ‘",
        accent: "신기하다",
        after: "’ 대신 쓸 수 있는 말을 함께 찾아보면 어휘가 더 넓어질 것 같아요!",
      },
    },

    guide: {
      reason: "이유·결과를 묻는 질문으로 골랐어요",
      story: {
        caption: "「방귀 뀌는 며느리」 속으로",
        questions: STORY_QUESTIONS.map((question) => ({
          ...question,
          quote: `${childName}: ${question.quote}`,
          followUp: fill(question.followUp, childName),
        })),
      },
      daily: {
        caption: "오늘 저녁 식탁에서",
        questions: DAILY_QUESTIONS.map((question) => ({
          ...question,
          question: fill(question.question, childName),
        })),
      },
      steps: FOLLOW_UP_STEPS,
    },
  };
}

export type Report = ReturnType<typeof buildReport>;
