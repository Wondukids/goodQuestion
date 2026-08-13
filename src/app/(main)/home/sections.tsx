import {
  RecommendedStoryCard,
  StoryCard,
} from "@/components/story/story-card";
import { getRecommendations } from "@/lib/recommendations";
import type { SelectedChild } from "@/lib/selected-child";
import type { ChildStorySession } from "@/lib/story-sessions";
import type { Story } from "@/lib/story-types";

const TITLE_CLASS = "px-[60px] text-[28px] font-extrabold text-ink";
const ROW_CLASS =
  "flex flex-wrap content-start items-start gap-x-[30px] gap-y-[60px] px-12";

const NEW_COUNT = 3;

/**
 * 홈의 아래 두 섹션(추천·새로운 이야기).
 *
 * 추천 캐시가 없을 때는 LLM 생성 때문에 몇 초 걸릴 수 있어, 페이지가 아니라
 * 이 컴포넌트 단위로 Suspense 에 얹는다. 캐시가 있으면 DB 읽기 한 번이라 즉시다.
 * 새로운 이야기는 위 섹션들에 이미 나온 작품을 빼고 최신순으로 채운다.
 */
export async function PersonalizedSections({
  child,
  stories,
  sessions,
  continueSlug,
}: {
  child: SelectedChild;
  stories: Story[];
  sessions: ChildStorySession[];
  continueSlug: string | null;
}) {
  const recommendations = await getRecommendations(child, stories, sessions);

  const shownSlugs = new Set(
    [continueSlug, ...recommendations.map(({ story }) => story.id)].filter(
      Boolean,
    ),
  );
  const newStories = stories
    .filter((story) => !shownSlugs.has(story.id))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, NEW_COUNT);

  return (
    <>
      {recommendations.length > 0 && (
        <section className="flex flex-col gap-5">
          <h2 className={TITLE_CLASS}>{child.name}에게 추천해요</h2>
          <div className={ROW_CLASS}>
            {recommendations.map(({ story, reason }) => (
              <RecommendedStoryCard
                key={story.id}
                story={story}
                reason={reason}
              />
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-5">
        <h2 className={TITLE_CLASS}>새로운 이야기</h2>
        <div className={ROW_CLASS}>
          {newStories.map((story) => (
            <StoryCard key={story.id} story={story} />
          ))}
        </div>
      </section>
    </>
  );
}

/** 추천을 처음 만드는 동안(콜드스타트)만 보이는 자리 표시. */
export function PersonalizedSectionsSkeleton() {
  return (
    <section className="flex flex-col gap-5">
      <div className="mx-[60px] h-[34px] w-[260px] animate-pulse rounded-lg bg-chip" />
      <div className={ROW_CLASS}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-[420px] w-[295px] animate-pulse rounded-[20px] bg-chip"
          />
        ))}
      </div>
    </section>
  );
}
