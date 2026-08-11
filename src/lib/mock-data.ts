/**
 * 화면 확인용 더미 데이터. Figma 시안(24 · 31 · 32)에 적힌 값을 그대로 옮겼다.
 * API 가 붙으면 이 파일을 걷어내면 된다.
 */

export type Child = {
  id: string;
  name: string;
  age: number;
  /** 프로필 원형까지 합성된 아바타 이미지 */
  avatar: string;
};

export const CHILDREN: Child[] = [
  { id: "jiwoo", name: "지우", age: 8, avatar: "/figma/avatars/jiwoo.png" },
  { id: "harin", name: "하린", age: 7, avatar: "/figma/avatars/harin.png" },
];

export type Story = {
  id: string;
  title: string;
  summary: string;
  thumbnail: string;
  chips: string[];
};

const FART_BRIDE: Omit<Story, "id"> = {
  title: "방귀 뀌는 며느리",
  summary: " 큰 방귀를 부끄러워하던 며느리가 자신의 다름을 장점으로 바꾸는 이야기",
  thumbnail: "/figma/stories/fart-bride.jpg",
  chips: ["장면 2/4", "다름", "20분"],
};

export type ContinueStory = Story & {
  /** 진행바 채움 비율 (0–1) */
  progress: number;
};

export const CONTINUE_STORY: ContinueStory = {
  id: "fart-bride",
  ...FART_BRIDE,
  progress: 127 / 295,
};

export const NEW_STORIES: Story[] = [
  { id: "fart-bride-1", ...FART_BRIDE },
  { id: "fart-bride-2", ...FART_BRIDE },
  { id: "fart-bride-3", ...FART_BRIDE },
];

/**
 * 동화 시작(7) 화면에 필요한 상세 정보.
 * 목록 카드보다 담는 게 많다 — 전면 이미지, 도입부, 주인공 상황, 아이가 맡을 역할.
 */
export type StoryDetail = {
  id: string;
  title: string;
  summary: string;
  /** 왼쪽 전면 이미지. 목록 썸네일과 다른 컷이라 따로 둔다. */
  hero: string;
  chips: string[];
  /** 전면 이미지 아래 도입 텍스트 */
  opening: { label: string; lines: string[] };
  /** 주인공이 지금 처한 상황 — 초상과 대사 */
  situation: { portrait: string; heading: string; lines: string[] };
  /** 아이가 맡을 역할. 제목의 이름은 선택된 아이에서 채운다. */
  role: { lines: string[] };
  /** 시작 버튼 위 안내 문구 */
  note: string;
};

const FART_BRIDE_DETAIL: Omit<StoryDetail, "id"> = {
  title: FART_BRIDE.title,
  summary: FART_BRIDE.summary,
  hero: "/figma/stories/fart-bride-hero.png",
  chips: ["전래동화", "용기", "약 20분", "난이도 중하"],
  opening: {
    label: "이야기의 시작",
    lines: [
      "옛날 어느 마을에 마음씨 착한 며느리가 살았어요.",
      "그런데 며느리에게는 남모를 비밀이 하나 있었지요…",
    ],
  },
  situation: {
    portrait: "/figma/stories/fart-bride-portrait.png",
    heading: "지금 며느리는…",
    lines: [
      "“방귀를 삼 년이나 꾹 참았더니 얼굴이 노래지고 배가 아파… ",
      "나 어떡하면 좋을까?”",
    ],
  },
  role: {
    lines: [
      "이야기 속 친구가 되어줘! ",
      "주인공의 고민을 잘 듣고, 네 생각을 목소리로 말해주면 돼!",
    ],
  },
  note: "20분 동안 4개의 장면을 며느리와 함께 여행해요",
};

/* 이야기 목록(6) — 상단 필터 칩. "전체" 는 필터를 걸지 않는다. */
export const STORY_TOPICS = [
  "전체",
  "다름",
  "자기이해",
  "장점발견",
  "나눔",
  "용기",
  "지혜",
  "우정",
  "가족",
] as const;

export type StoryTopic = (typeof STORY_TOPICS)[number];

/** 목록 카드는 요약문 없이 칩과 제목만 보여 준다(시안 6). */
export type BrowseStory = {
  id: string;
  title: string;
  topic: Exclude<StoryTopic, "전체">;
  /** 진행 상황 칩 — 시안이 "장면 2/4" 로 적어 둔 자리 */
  scene: string;
  minutes: number;
  thumbnail: string;
};

/* 제목은 같은 Figma 파일의 "동화_썸네일" 섹션에 있는 작품명에서 가져왔다.
   썸네일 이미지는 아직 한 장뿐이라 시안처럼 모두 같은 그림을 쓴다. */
const THUMBNAIL = "/figma/stories/fart-bride.jpg";

export const BROWSE_STORIES: BrowseStory[] = [
  { id: "gold-axe", title: "금도끼 은도끼", topic: "지혜", scene: "장면 2/4", minutes: 15, thumbnail: THUMBNAIL },
  { id: "fart-bride", title: "방귀 뀌는 며느리", topic: "다름", scene: "장면 2/4", minutes: 20, thumbnail: THUMBNAIL },
  { id: "kongjwi", title: "콩쥐팥쥐", topic: "용기", scene: "장면 1/4", minutes: 20, thumbnail: THUMBNAIL },
  { id: "sun-and-moon", title: "해와 달이 된 오누이", topic: "우정", scene: "장면 3/4", minutes: 15, thumbnail: THUMBNAIL },
  { id: "hokburi", title: "혹부리영감", topic: "장점발견", scene: "장면 2/4", minutes: 15, thumbnail: THUMBNAIL },
  { id: "heungbu", title: "흥부와 놀부", topic: "나눔", scene: "장면 1/4", minutes: 20, thumbnail: THUMBNAIL },
  { id: "rabbit-liver", title: "토끼의 간", topic: "자기이해", scene: "장면 4/4", minutes: 15, thumbnail: THUMBNAIL },
  { id: "green-frog", title: "청개구리", topic: "가족", scene: "장면 2/4", minutes: 20, thumbnail: THUMBNAIL },
];

/* 시안에 그려진 이야기가 아직 "방귀 뀌는 며느리" 하나뿐이라, 어느 목록에서 들어와도
   같은 상세로 떨어뜨린다. 작품이 늘면 여기서 id 별 상세로 갈라 두면 된다. */
const STORY_IDS = new Set<string>([
  CONTINUE_STORY.id,
  ...NEW_STORIES.map((story) => story.id),
  ...BROWSE_STORIES.map((story) => story.id),
]);

/** 없는 id 면 null — 페이지가 404 로 떨어뜨린다. */
export function getStoryDetail(id: string): StoryDetail | null {
  if (!STORY_IDS.has(id)) return null;
  return { id, ...FART_BRIDE_DETAIL };
}
