import Link from "next/link";
import { Suspense } from "react";
import { ContinueStoryLive } from "@/components/story/continue-story-live";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { requireSelectedChild } from "@/lib/selected-child";
import { listStories } from "@/lib/stories";
import { listChildSessions, type ChildStorySession } from "@/lib/story-sessions";
import type { Story } from "@/lib/story-types";
import {
  PersonalizedSections,
  PersonalizedSectionsSkeleton,
} from "./sections";

/* 이어하기 한 줄에 놓는 카드 수 — 300px 카드 4장 + 사이 23px = 1269 로 1270 폭에 꼭 맞는다. */
const CONTINUE_COUNT = 4;

export default async function HomePage() {
  const child = await requireSelectedChild();
  const [stories, sessions] = await Promise.all([
    listStories(),
    listChildSessions(child.id),
  ]);

  /* 진행 중 세션(최근 활동 순) → 이야기. 진행률은 카드가 세션 API
     (GET /api/sessions/{id})로 채운다 — 이슈 #8. */
  const continueStories = sessions
    .filter((session) => session.status === "in_progress")
    .map((session) => ({
      session,
      story: stories.find((story) => story.id === session.slug),
    }))
    .filter(
      (pair): pair is { session: ChildStorySession; story: Story } =>
        Boolean(pair.story),
    )
    .slice(0, CONTINUE_COUNT);

  return (
    <main className="flex flex-col gap-[60px] pb-16">
      <section className="flex flex-col gap-4 px-12">
        <h2 className="px-4 text-[24px] leading-[1.6] font-extrabold text-ink-strong">
          읽던 이야기 이어서 볼까?
        </h2>
        {continueStories.length > 0 ? (
          <div className="flex flex-wrap gap-[23px]">
            {continueStories.map(({ session, story }) => (
              <ContinueStoryLive
                key={session.id}
                story={story}
                sessionId={session.id}
              />
            ))}
          </div>
        ) : (
          <EmptyContinueCard />
        )}
      </section>

      {/* 추천 콜드스타트(LLM 생성)가 홈 전체를 붙들지 않도록 아래 섹션만 스트리밍한다. */}
      <Suspense fallback={<PersonalizedSectionsSkeleton />}>
        <PersonalizedSections
          child={child}
          stories={stories}
          sessions={sessions}
          hasContinue={continueStories.length > 0}
        />
      </Suspense>
    </main>
  );
}

/* 진행 중 이야기가 없을 때(시안 21-828) — 이야기 고르러 가기 CTA 카드 */
function EmptyContinueCard() {
  return (
    <div className="flex w-full flex-col items-center gap-5 rounded-[20px] border-2 border-primary-line bg-story-bg px-10 py-[30px]">
      <div className="flex size-20 items-center justify-center rounded-full bg-primary-pale text-primary">
        <MaterialSymbol name="auto_stories" size={34} />
      </div>
      <div className="flex flex-col items-center gap-0.5 leading-[1.6]">
        <p className="text-[20px] font-extrabold text-ink-strong">
          아직 읽던 이야기가 없어!
        </p>
        <p className="text-[18px] font-bold text-[#8a8a8a]">
          마음에 드는 이야기를 하나 골라서 함께 읽어볼까?
        </p>
      </div>
      <Link
        href="/stories"
        className="flex h-[54px] items-center justify-center rounded-lg bg-primary-strong px-6 text-[20px] leading-[1.6] font-extrabold text-white"
      >
        이야기 고르러 가기
      </Link>
    </div>
  );
}
