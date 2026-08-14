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

/** 홈 이어하기 카드(시안 21-480) — 300×297, 썸네일 밑에 제목·정보와 이어서 보기 버튼. */
export function ContinueStoryCard({ story }: { story: ContinueStory }) {
  return (
    <div className="flex h-[297px] w-[300px] shrink-0 flex-col items-center gap-6 rounded-[20px] border-[3px] border-primary-line bg-white px-4 pt-5 pb-4 drop-shadow-[0_0_15px_rgb(0_0_0_/_0.1)]">
      <div className="relative h-[105px] w-full shrink-0 overflow-hidden rounded-xl">
        <Image
          src={story.thumbnail}
          alt=""
          fill
          sizes="268px"
          className="object-cover"
          priority
        />
        {/* 장면 데이터(story_scenes)가 아직 없어 진행률을 못 구하면 바를 생략한다. */}
        {typeof story.progress === "number" && (
          <div className="absolute bottom-0 left-0 h-2 w-full overflow-hidden bg-[#515151]">
            <div
              className="h-2 rounded-r-md bg-[#fa4f52]"
              style={{ width: `${story.progress * 100}%` }}
            />
          </div>
        )}
      </div>

      <div className="flex w-full flex-1 flex-col gap-2.5 font-gothic">
        <h3 className="text-[17px] font-extrabold text-[#2d2620]">
          {story.title}
        </h3>
        <p className="text-[13px] font-bold text-[#2d2620]/72">
          {storyMeta(story)}
        </p>
      </div>

      <Link
        href={`/stories/${story.id}`}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-[11px] font-gothic text-[15px] font-extrabold text-white"
      >
        <MaterialSymbol name="play_arrow" size={15} />
        이어서 보기
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
