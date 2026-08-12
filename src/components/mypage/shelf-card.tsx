import Image from "next/image";
import Link from "next/link";
import type { Story } from "@/lib/story-types";

/** 완성한 이야기 한 권 — 아이가 직접 말한 리텔링(시안 17)이 함께 꽂힌다. */
export type ShelfEntry = {
  story: Story;
  /** 말하기 후 활동에서 저장된 "내가 말한 이야기" 텍스트 */
  retelling: string;
};

export function ShelfCard({ entry }: { entry: ShelfEntry }) {
  const { story, retelling } = entry;

  return (
    <Link
      href={`/stories/${story.id}`}
      className="flex w-[295px] shrink-0 flex-col items-start overflow-hidden rounded-[20px] border border-primary-line bg-surface shadow-story"
    >
      <div className="relative h-[163.5px] w-full shrink-0">
        <Image
          src={story.thumbnail}
          alt=""
          fill
          sizes="295px"
          className="rounded-t-[20px] object-cover"
        />
        <span className="absolute top-3 right-4 rounded-full bg-primary px-3.5 py-3 text-[14px] font-bold text-white">
          다 읽었어요!
        </span>
      </div>

      <div className="flex w-full flex-col gap-4 bg-surface px-4 py-5">
        <h3 className="text-[20px] font-extrabold text-ink">{story.title}</h3>

        <div className="flex w-full flex-col gap-2 rounded-xl bg-primary-soft/60 p-3.5">
          <span className="text-[12px] font-bold text-ink-mid">
            내가 말한 이야기
          </span>
          <p className="line-clamp-3 text-[14px] leading-[1.6] text-ink">
            {retelling}
          </p>
        </div>
      </div>
    </Link>
  );
}
