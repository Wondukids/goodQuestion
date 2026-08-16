import Image from "next/image";
import Link from "next/link";
import { topicChipStyle } from "@/components/story/topic-tiles";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { ContinueStory, Story } from "@/lib/story-types";

/** 썸네일 위 오른쪽 상단 배지 — 이어하기 카드의 "진행중" 과 같은 모양.
    draft 도 시작 화면까지는 들어가고, 그 안의 시작 버튼이 "제작 중" 으로 잠긴다. */
function DraftBadge({ story }: { story: Story }) {
  if (story.status !== "draft") return null;
  return (
    <span className="absolute top-3 right-4 rounded-full bg-[#333]/80 px-3.5 py-3 text-[14px] font-bold text-white">
      제작 중
    </span>
  );
}

/**
 * 추천 카드 뱃지 종류 — 썸네일 왼쪽 위 알약과 카드 안 색조를 함께 정한다.
 *
 * 시안(49:862)은 카드 세 장이 각각 다른 색을 입고 있는데, 그 색은 이야기 주제가
 * 아니라 **뱃지 종류**를 따라간다(주제 칩·추천 이유 바가 뱃지와 같은 계열이다).
 * 그래서 주제별 색표가 아니라 이 표를 쓴다.
 */
type RecommendBadge = "match" | "new" | "popular";

const RECOMMEND_BADGES: Record<
  RecommendBadge,
  {
    label: (childName: string) => string;
    icon: string;
    /** 알약 바탕 */
    solid: string;
    /** 칩·추천 이유 바 바탕 */
    tint: string;
    /** 칩·추천 이유 바 글자 */
    ink: string;
  }
> = {
  match: {
    label: (childName) => `${childName} 맞춤`,
    icon: "auto_awesome",
    solid: "#fd7649",
    tint: "#fff1eb",
    ink: "#fd7649",
  },
  new: {
    label: () => "새로 나왔어요",
    icon: "fiber_new",
    solid: "#45a9d3",
    tint: "#eaf6fb",
    ink: "#185067",
  },
  popular: {
    label: () => "인기 많아요",
    icon: "local_fire_department",
    solid: "#5aa860",
    tint: "#f0f8f1",
    ink: "#2f6b36",
  },
};

/** 추천 순위 → 뱃지. 「새로 나왔어요 · 인기 많아요」를 뒷받침할 데이터가 아직 없어,
    지금은 시안 그대로 자리 순서대로 입힌다(1등만 실제로 아이 맞춤 추천이다). */
export const RECOMMEND_BADGE_ORDER: RecommendBadge[] = [
  "match",
  "new",
  "popular",
];

/**
 * 홈 추천 섹션 카드(시안 49:863) — 408×495 세로 카드.
 *
 * 411×341 가로형에서 바뀌었다. 썸네일이 232px 로 카드 폭을 꽉 채우고 그 위 왼쪽에
 * 추천 뱃지가 뜬다. 아래 257px 이 본문인데 위쪽에 칩 줄·제목·줄거리가 붙고,
 * 바닥에 LLM 추천 이유가 색 바 한 줄로 깔린다("시작하기" 버튼은 없어지고
 * 카드 전체가 링크다).
 *
 * 본문 높이가 257 로 고정이라 줄거리·이유는 두 줄까지만 보여준다 — 둘 다 두 줄이어도
 * 213px(패딩 뺀 안쪽) 안에 들어간다. 한 줄씩일 때가 시안과 똑같은 배치다.
 */
export function RecommendedStoryCard({
  story,
  reason,
  badge,
  childName,
}: {
  story: Story;
  reason: string | null;
  badge: RecommendBadge;
  childName: string;
}) {
  const palette = RECOMMEND_BADGES[badge];

  return (
    <Link
      href={`/stories/${story.id}`}
      className="flex h-[495px] w-[408px] shrink-0 flex-col overflow-hidden rounded-[20px] border-[3px] border-primary-line bg-story-bg shadow-[0_0_26px_0_rgb(0_0_0_/_0.1)]"
    >
      <div className="relative h-[232px] w-full shrink-0 bg-[#d6d6d6]">
        <Image
          src={story.thumbnail}
          alt=""
          fill
          sizes="402px"
          className="object-cover"
        />
        <span
          className="absolute top-5 left-5 flex items-center gap-[5px] rounded-full px-3.5 py-2 text-[14px] font-extrabold text-[#fcfcfc] drop-shadow-[0_3px_4px_rgb(0_0_0_/_0.15)]"
          style={{ backgroundColor: palette.solid }}
        >
          <MaterialSymbol name={palette.icon} size={16} />
          {palette.label(childName)}
        </span>
        <DraftBadge story={story} />
      </div>

      <div className="flex flex-1 flex-col justify-between px-6 pt-5 pb-6">
        <div className="flex flex-col gap-5">
          <div className="flex gap-1.5">
            {story.topic && (
              <span
                className="rounded-md px-3.5 py-1.5 text-[14px] font-bold"
                style={{ backgroundColor: palette.tint, color: palette.ink }}
              >
                {story.topic}
              </span>
            )}
            {story.minutes && (
              <span className="rounded-md bg-surface-muted px-3.5 py-1.5 text-[14px] font-bold text-ink-mid">
                {story.minutes}분
              </span>
            )}
          </div>
          <div className="flex flex-col gap-2.5">
            <h3 className="text-[24px] font-extrabold text-ink-strong">
              {story.title}
            </h3>
            <p className="line-clamp-2 text-[16px] leading-[1.6] font-normal text-ink-faint">
              {story.summary}
            </p>
          </div>
        </div>

        <div
          className="flex items-center gap-[7px] rounded-[10px] px-3 py-[13px] text-[16px] font-extrabold"
          style={{ backgroundColor: palette.tint, color: palette.ink }}
        >
          <MaterialSymbol name="auto_awesome" size={16} />
          <span className="line-clamp-2">{reason ?? story.summary}</span>
        </div>
      </div>
    </Link>
  );
}

/**
 * 홈 이어하기 배너(시안 「이어보기 배너」 49:976) — 1270×116 가로 한 줄.
 *
 * 세로 카드(300×297)에서 배너로 바뀌었다. 썸네일 134×76 이 왼쪽, 가운데가 제목과
 * 진행 줄(진행바 + 「2/4장면」), 오른쪽 끝이 「이어서 볼래!」다. 빈 상태 배너와 높이가
 * 같아 둘 중 무엇이 뜨든 그 자리의 크기가 흔들리지 않는다.
 *
 * href 를 주면 그리로 간다 — 세션이 있으면 재생 화면 직접 진입 (이슈 #8).
 */
export function ContinueStoryBanner({
  story,
  href,
}: {
  story: ContinueStory;
  href?: string;
}) {
  const progress = story.progress;

  return (
    <div className="flex h-[116px] w-full items-center gap-[18px] rounded-[20px] border-2 border-primary-strong bg-story-bg px-6 drop-shadow-[0_6px_8px_rgb(69_169_211_/_0.15)]">
      <div className="relative h-[76px] w-[134px] shrink-0 overflow-hidden rounded-xl">
        <Image
          src={story.thumbnail}
          alt=""
          fill
          sizes="134px"
          className="object-cover"
          priority
        />
      </div>

      <div className="flex h-[78px] min-w-0 flex-1 flex-col justify-between py-2">
        <h3 className="truncate font-gothic text-[20px] leading-[1.35] font-extrabold text-ink-strong">
          {story.title}
        </h3>
        {/* 장면 데이터(story_scenes)가 아직 없어 진행을 못 구하면 이 줄이 통째로 빠진다. */}
        {progress && (
          <div className="flex items-center gap-2.5">
            <div className="h-2.5 w-[200px] overflow-hidden rounded-full bg-[#e2eef4]">
              <div
                className="h-full rounded-full bg-[#fa4f52]"
                style={{
                  width: `${Math.min(progress.order / progress.total, 1) * 100}%`,
                }}
              />
            </div>
            <p className="text-[16px] leading-[1.6] font-bold text-ink-strong">
              <span className="font-extrabold text-[#226f90]">
                {progress.order}
              </span>
              /{progress.total}장면
            </p>
          </div>
        )}
      </div>

      <Link
        href={href ?? `/stories/${story.id}`}
        className="flex h-[54px] shrink-0 items-center justify-center rounded-lg bg-primary-strong px-6 text-[18px] leading-[1.5] font-extrabold text-white"
      >
        이어서 볼래!
      </Link>
    </div>
  );
}

/**
 * 그리드 카드(시안 49:922) — 홈 주제 둘러보기와 이야기 목록이 같이 쓴다. 300×354.
 *
 * 21-632 에서 바뀌었다: 칩 줄이 맨 아래에서 **제목 위**로 올라가고 아이콘 달린 알약이
 * 네모 칩이 됐다. 글자도 커졌고(제목 18→20, 줄거리 13→16) 줄거리는 두 줄까지 보인다.
 *
 * 본문 183px 은 시안 고정값이다 — 칩 줄은 위, 제목·줄거리는 아래에 붙고 사이가 벌어진다.
 * 이야기마다 줄거리 길이가 달라도 카드 높이가 같아 그리드 줄이 어긋나지 않는다
 * (제목이 두 줄로 넘어가면 그만큼 아래 여백 30px 을 파고든다).
 *
 * progress 를 주면 이야기 목록의 "읽던 이야기" 카드처럼 썸네일 밑에 진행바가 깔린다.
 */
export function CompactStoryCard({
  story,
  progress,
}: {
  story: Story;
  progress?: number | null;
}) {
  return (
    <Link
      href={`/stories/${story.id}`}
      className="flex min-w-0 flex-col overflow-hidden rounded-[20px] border border-primary-line bg-story-bg shadow-[4px_8px_14px_0_rgb(74_62_49_/_0.1)]"
    >
      <div className="relative h-[169px] w-full shrink-0 bg-[#d6d6d6]">
        <Image
          src={story.thumbnail}
          alt=""
          fill
          sizes="300px"
          className="object-cover"
        />
        <DraftBadge story={story} />
        {/* 장면 데이터가 아직 없어 진행률을 못 구하면 바를 생략한다. */}
        {typeof progress === "number" && (
          <div className="absolute bottom-0 left-0 h-2 w-full overflow-hidden bg-[#515151]">
            <div
              className="h-2 rounded-r-md bg-[#fa4f52]"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        )}
      </div>
      <div className="flex h-[183px] flex-col justify-between px-5 pt-5 pb-[30px]">
        <div className="flex gap-1.5">
          {story.topic && (
            <span
              className="rounded-md px-3.5 py-1.5 text-[12px] font-extrabold"
              style={topicChipStyle(story.topic)}
            >
              {story.topic}
            </span>
          )}
          {story.minutes && (
            <span className="rounded-md bg-surface-muted px-3.5 py-1.5 text-[12px] font-bold text-ink-strong">
              {story.minutes}분
            </span>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="line-clamp-2 text-[20px] font-extrabold text-ink-strong">
            {story.title}
          </h3>
          <p className="line-clamp-2 text-[16px] leading-[1.6] font-normal text-ink-strong">
            {story.summary}
          </p>
        </div>
      </div>
    </Link>
  );
}
