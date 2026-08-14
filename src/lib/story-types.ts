/**
 * 이야기 도메인 타입. 클라이언트 컴포넌트(story-browser 등)에서도 쓰므로
 * server-only 인 lib/stories.ts 와 분리해 둔다.
 */

/** 동화 시작 화면(시안 7)의 문구 묶음 — stories.intro jsonb 와 같은 모양. */
export type StoryIntro = {
  /** 전면 이미지 아래 도입 텍스트 */
  opening: string[];
  /** 주인공이 지금 처한 상황 — 이름과 대사 */
  situation: { name: string; heading: string; lines: string[] };
  /** 시작 버튼 위 안내 문구 */
  note: string;
};

/** draft: 제작 중(목록에 배지로 표시, 입장 불가) · published: 공개 · archived: 숨김 */
export type StoryStatus = "draft" | "published" | "archived";

export type Story = {
  /** URL /stories/[id] 와 재생 화면 레지스트리(src/stories)의 키 — stories.slug */
  id: string;
  status: StoryStatus;
  title: string;
  summary: string;
  topic: string;
  minutes: number | null;
  difficulty: string;
  thumbnail: string;
  /** 시작 화면 전면(2:3) 이미지. 없으면 썸네일 블러 채움으로 대체한다. */
  hero: string | null;
  intro: StoryIntro | null;
  /** stories.created_at — 홈 "새로운 이야기" 정렬 기준 */
  createdAt: string;
};

export type ContinueStory = Story & {
  /** 진행바 채움 비율 (0–1). 장면 데이터가 없어 못 구하면 null — 배지만 보여 준다. */
  progress: number | null;
};

/* 이야기 목록(6) — 상단 필터 칩. "전체" 는 필터를 걸지 않는다.
   stories.topics 에 들어 있는 값과 맞춘다. */
export const STORY_TOPICS = [
  "전체",
  "자기이해",
  "장점발견",
  "용기",
  "정직",
  "감정",
  "우정",
  "나눔·배려",
  "가족",
  "다름",
] as const;

export type StoryTopic = (typeof STORY_TOPICS)[number];
