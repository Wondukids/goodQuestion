import {
  ContinueStoryCard,
  StoryCard,
} from "@/components/story/story-card";
import { listStories } from "@/lib/stories";

/* 세션(story_sessions)이 붙기 전까지 이어하기 카드는 시안의 대표작을 목업 진행률로 보여 준다. */
const CONTINUE_SLUG = "fart-bride";
const CONTINUE_PROGRESS = 127 / 295;

export default async function HomePage() {
  const stories = await listStories();

  const continueStory = stories.find((story) => story.id === CONTINUE_SLUG);
  const newStories = stories
    .filter((story) => story.id !== CONTINUE_SLUG)
    .slice(0, 3);

  return (
    <main className="flex flex-col gap-[60px] pt-2 pb-12">
      {continueStory && (
        <section className="flex flex-col gap-5">
          <h2 className="px-[60px] text-[28px] font-extrabold text-ink">
            이어서 볼까요?
          </h2>
          <div className="flex flex-wrap content-start items-start gap-[30px] px-12">
            <ContinueStoryCard
              story={{ ...continueStory, progress: CONTINUE_PROGRESS }}
            />
          </div>
        </section>
      )}

      <section className="flex flex-col gap-5">
        <h2 className="px-[60px] text-[28px] font-extrabold text-ink">
          새로운 이야기
        </h2>
        <div className="flex flex-wrap content-start items-start gap-x-[30px] gap-y-[60px] px-12">
          {newStories.map((story) => (
            <StoryCard key={story.id} story={story} />
          ))}
        </div>
      </section>
    </main>
  );
}
