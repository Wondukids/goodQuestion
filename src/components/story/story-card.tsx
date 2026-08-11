import Image from "next/image";
import Link from "next/link";
import type { BrowseStory, ContinueStory, Story } from "@/lib/mock-data";

function Chips({ chips }: { chips: string[] }) {
  return (
    <div className="flex w-full gap-1.5">
      {chips.map((chip) => (
        <span
          key={chip}
          className="rounded-md bg-chip px-3.5 py-1.5 text-[12px] font-bold text-ink"
        >
          {chip}
        </span>
      ))}
    </div>
  );
}

function Body({ story }: { story: Story }) {
  return (
    <div className="flex w-[263px] flex-col gap-5">
      <Chips chips={story.chips} />
      <div className="flex flex-col gap-3">
        <h3 className="text-[20px] font-extrabold text-ink">{story.title}</h3>
        <p className="text-[16px] leading-[1.6] text-black">{story.summary}</p>
      </div>
    </div>
  );
}

const CARD_CLASS =
  "flex w-[295px] shrink-0 flex-col items-start justify-center overflow-hidden rounded-[20px] border border-primary-line bg-surface shadow-story";

export function StoryCard({ story }: { story: Story }) {
  return (
    <Link href={`/stories/${story.id}`} className={CARD_CLASS}>
      <div className="relative h-[199px] w-full">
        <Image
          src={story.thumbnail}
          alt=""
          fill
          sizes="295px"
          className="rounded-t-[20px] object-cover"
        />
      </div>
      <div className="flex w-full flex-col items-start bg-surface px-4 pt-5 pb-7">
        <Body story={story} />
      </div>
    </Link>
  );
}

/**
 * 이야기 목록(6)의 카드 — 높이 327 고정, 썸네일 163.5 아래에 칩과 제목만 온다.
 * 홈의 StoryCard 와 달리 요약문이 없고 남는 아래 공간은 비워 둔다.
 */
export function StoryBrowseCard({ story }: { story: BrowseStory }) {
  return (
    <Link href={`/stories/${story.id}`} className={`${CARD_CLASS} h-[327px]`}>
      <div className="relative h-[163.5px] w-full shrink-0">
        <Image
          src={story.thumbnail}
          alt=""
          fill
          sizes="295px"
          className="rounded-t-[20px] object-cover"
        />
      </div>
      <div className="flex w-full flex-1 flex-col gap-5 bg-surface px-4 py-5">
        <Chips chips={[story.scene, story.topic, `${story.minutes}분`]} />
        <h3 className="text-[20px] font-extrabold text-ink">{story.title}</h3>
      </div>
    </Link>
  );
}

export function ContinueStoryCard({ story }: { story: ContinueStory }) {
  return (
    <div className={CARD_CLASS}>
      <div className="relative h-[199px] w-full overflow-hidden rounded-t-[20px]">
        <Image
          src={story.thumbnail}
          alt=""
          fill
          sizes="295px"
          className="object-cover"
          priority
        />

        <span className="absolute top-3 right-4 rounded-full bg-[#333] px-3.5 py-3 text-[14px] font-bold text-white">
          진행중
        </span>

        {/* 하단 그라디언트 + 제목 */}
        <div className="absolute inset-x-0 bottom-0 h-[105px] bg-gradient-to-t from-black/55 from-[57.619%] to-[#666]/0 to-[92.857%]">
          <span className="absolute bottom-[28px] left-1/2 -translate-x-1/2 text-[20px] font-extrabold whitespace-nowrap text-[#f3f3f3]">
            {story.title}
          </span>
        </div>

        <div className="absolute bottom-0 left-0 h-2 w-full overflow-hidden bg-[#515151]">
          <div
            className="h-2 rounded-r-md bg-[#fa4f52]"
            style={{ width: `${story.progress * 100}%` }}
          />
        </div>
      </div>

      <div className="flex w-full flex-col gap-5 bg-surface px-4 py-5">
        <Body story={story} />
        <Link
          href={`/stories/${story.id}`}
          className="flex w-full items-center justify-center rounded-lg bg-primary px-10 py-4 text-[18px] font-extrabold text-white"
        >
          시작
        </Link>
      </div>
    </div>
  );
}
