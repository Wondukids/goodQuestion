import { Suspense } from "react";
import { ContinueStoryCard } from "@/components/story/story-card";
import { requireSelectedChild } from "@/lib/selected-child";
import { listStories } from "@/lib/stories";
import { listChildSessions } from "@/lib/story-sessions";
import {
  PersonalizedSections,
  PersonalizedSectionsSkeleton,
} from "./sections";

export default async function HomePage() {
  const child = await requireSelectedChild();
  const [stories, sessions] = await Promise.all([
    listStories(),
    listChildSessions(child.id),
  ]);

  /* 진행 중 세션 중 가장 최근 것(목록이 최근 활동 순). 장면 데이터가 아직 없어
     진행률은 못 구하므로 카드에는 "진행중" 배지만 보여 준다. */
  const continueSession = sessions.find(
    (session) => session.status === "in_progress",
  );
  const continueStory = continueSession
    ? stories.find((story) => story.id === continueSession.slug)
    : undefined;

  return (
    <main className="flex flex-col gap-[60px] pt-2 pb-12">
      {continueStory && (
        <section className="flex flex-col gap-5">
          <h2 className="px-[60px] text-[28px] font-extrabold text-ink">
            이어서 볼까요?
          </h2>
          <div className="flex flex-wrap content-start items-start gap-[30px] px-12">
            <ContinueStoryCard story={{ ...continueStory, progress: null }} />
          </div>
        </section>
      )}

      {/* 추천 콜드스타트(LLM 생성)가 홈 전체를 붙들지 않도록 아래 섹션만 스트리밍한다. */}
      <Suspense fallback={<PersonalizedSectionsSkeleton />}>
        <PersonalizedSections
          child={child}
          stories={stories}
          sessions={sessions}
          continueSlug={continueStory?.id ?? null}
        />
      </Suspense>
    </main>
  );
}
