import Image from "next/image";
import Link from "next/link";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { ContinueStory, Story } from "@/lib/story-types";

/* 홈 카드의 한 줄 정보 "정직 · 15분 · 7세" — 비어 있는 항목은 건너뛴다. */
function storyMeta(story: Story) {
  return [
    story.topic,
    story.minutes ? `${story.minutes}분` : "",
    story.difficulty,
  ]
    .filter(Boolean)
    .join(" · ");
}

/* 주제별 포인트 색 — 홈 주제 타일(시안 21-886)과 뱃지가 같이 쓴다. */
export const TOPIC_ACCENT: Record<string, string> = {
  다름: "#6fbcdd",
  자기이해: "#f0a83c",
  장점발견: "#fd7c51",
  "나눔·배려": "#e86a8f",
  용기: "#7bc47f",
  정직: "#45a9d3",
  감정: "#f0a83c",
  우정: "#4bb3c9",
  가족: "#d98b5f",
};

/** 주제 뱃지 — tinted 면 주제색 12% 바탕(가로 카드), 아니면 하늘색 고정(그리드 카드). */
function TopicBadge({ topic, tinted }: { topic: string; tinted?: boolean }) {
  if (!topic) return null;
  const accent = TOPIC_ACCENT[topic] ?? "#45a9d3";
  return (
    <span
      className="flex items-center gap-1 rounded-full px-[11px] py-[5px] font-gothic text-[12px] font-extrabold"
      style={
        tinted
          ? { backgroundColor: `${accent}1f`, color: accent }
          : { backgroundColor: "#daedf6", color: "#2c6d88" }
      }
    >
      <MaterialSymbol name="sell" size={11} />
      {topic}
    </span>
  );
}

function TimeBadge({ minutes }: { minutes: number | null }) {
  if (!minutes) return null;
  return (
    <span className="flex items-center gap-1 rounded-full bg-[#f2f2f2] px-[11px] py-[5px] font-gothic text-[12px] font-extrabold text-[#767676]">
      <MaterialSymbol name="timer" size={11} />
      {minutes}분
    </span>
  );
}

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

/** 홈 추천 섹션 카드(시안 21-840) — 411×341, 시작하기 알약 버튼이 제목 오른쪽에 뜬다.
    회색 안내줄에는 LLM 추천 이유를 쓰고, 폴백으로 줄거리를 넣는다. */
export function RecommendedStoryCard({
  story,
  reason,
}: {
  story: Story;
  reason: string | null;
}) {
  return (
    <Link
      href={`/stories/${story.id}`}
      className="flex h-[341px] w-[411px] shrink-0 flex-col rounded-[29px] border-[3px] border-primary-line bg-story-bg px-[19px] pt-[19px] drop-shadow-[0_0_15px_rgb(0_0_0_/_0.1)]"
    >
      <div className="relative h-[160px] w-full shrink-0 overflow-hidden rounded-[15px]">
        <Image
          src={story.thumbnail}
          alt=""
          fill
          sizes="367px"
          className="object-cover"
        />
        <DraftBadge story={story} />
      </div>

      <div className="relative mt-[35px] px-[5px]">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5 pr-[135px]">
            <h3 className="text-[25px] font-extrabold text-ink-strong">
              {story.title}
            </h3>
            <p className="text-[15px] font-extrabold text-[#8a8a8a]">
              {storyMeta(story)}
            </p>
          </div>
          <p className="line-clamp-2 text-[15px] font-bold text-[#8a8a8a]">
            {reason ?? story.summary}
          </p>
        </div>
        <span className="absolute top-0 right-0 flex items-center gap-2 rounded-full bg-primary-strong py-2.5 pr-[18px] pl-[22px] text-[16px] font-extrabold text-white">
          시작하기
          <MaterialSymbol name="chevron_right" size={18} />
        </span>
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

/** 홈 하단 가로 카드(시안 21-938) — 이어하기가 없을 때의 둘러보기 줄. 411×190. */
export function WideStoryCard({ story }: { story: Story }) {
  return (
    <Link
      href={`/stories/${story.id}`}
      className="flex h-[190px] min-w-0 overflow-hidden rounded-[20px] border border-primary-line bg-white shadow-story"
    >
      <div className="relative h-full w-[140px] shrink-0">
        <Image
          src={story.thumbnail}
          alt=""
          fill
          sizes="140px"
          className="object-cover"
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-4 px-[22px] py-[18px] font-gothic">
        <h3 className="text-[22px] font-extrabold text-ink">{story.title}</h3>
        <p className="line-clamp-2 text-[14px] font-extrabold text-[#8a8a8a]">
          {story.summary}
        </p>
        <div className="flex gap-1.5">
          <TopicBadge topic={story.topic} tinted />
          <TimeBadge minutes={story.minutes} />
        </div>
      </div>
    </Link>
  );
}

/** 그리드 카드(시안 21-632) — 홈 주제 탐색과 이야기 목록이 같이 쓴다.
    progress 를 주면 이야기 목록의 "읽던 이야기" 카드처럼 썸네일 밑에 진행바가 깔린다. */
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
      className="flex min-w-0 flex-col overflow-hidden rounded-[20px] border border-[#e4e9ee] bg-white shadow-[2px_5px_12px_0_rgb(74_62_49_/_0.08)]"
    >
      <div className="relative h-[168px] w-full shrink-0">
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
      <div className="flex flex-col gap-2 px-3.5 pt-3 pb-3.5 font-gothic">
        <h3 className="text-[18px] font-extrabold text-ink">{story.title}</h3>
        <p className="line-clamp-1 text-[13px] font-extrabold text-[#8a8a8a]">
          {story.summary}
        </p>
        <div className="flex gap-1.5">
          <TopicBadge topic={story.topic} />
          <TimeBadge minutes={story.minutes} />
        </div>
      </div>
    </Link>
  );
}
