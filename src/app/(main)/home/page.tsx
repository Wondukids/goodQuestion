import {
  ContinueStoryCard,
  StoryCard,
} from "@/components/story/story-card";
import { CONTINUE_STORY, NEW_STORIES } from "@/lib/mock-data";

export default function HomePage() {
  return (
    <main className="flex flex-col gap-[60px] pt-2 pb-12">
      <section className="flex flex-col gap-5">
        <h2 className="px-[60px] text-[28px] font-extrabold text-ink">
          이어서 볼까요?
        </h2>
        <div className="flex flex-wrap content-start items-start gap-[30px] px-12">
          <ContinueStoryCard story={CONTINUE_STORY} />
        </div>
      </section>

      <section className="flex flex-col gap-5">
        <h2 className="px-[60px] text-[28px] font-extrabold text-ink">
          새로운 이야기
        </h2>
        <div className="flex flex-wrap content-start items-start gap-x-[30px] gap-y-[60px] px-12">
          {NEW_STORIES.map((story) => (
            <StoryCard key={story.id} story={story} />
          ))}
        </div>
      </section>
    </main>
  );
}
