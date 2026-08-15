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
          읽었던 이야기 이어서 볼까?
        </h2>
        {continueStories.length > 0 ? (
          /* 카드 넉 장이 한 줄로 서던 자리 — 배너는 폭을 다 쓰므로 세로로 쌓는다 */
          <div className="flex flex-col gap-4">
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

/**
 * 진행 중 이야기가 없을 때 — 이야기 찾아보기 CTA (시안 「이어하기 빈 상태 배너」 49:850).
 *
 * 세로 카드에서 **가로 배너**로 바뀌었다 (1270×116). 아이콘·문구는 왼쪽에 한 줄로 서고
 * 버튼이 오른쪽 끝에 붙는다 — 위아래 여백 26px 은 1270×116 에서 아이콘 64px 을 뺀 값이다.
 */
function EmptyContinueCard() {
  return (
    <div className="flex w-full items-center justify-between rounded-[20px] border-2 border-primary-line bg-story-bg px-7 py-[26px]">
      <div className="flex min-w-0 flex-1 items-center gap-[18px]">
        <div className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary-pale text-primary">
          <MaterialSymbol name="auto_stories" size={30} />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-[22px] leading-[1.4] font-extrabold text-ink-strong">
            아직 읽었던 이야기가 없어!
          </p>
          <p className="text-[16px] leading-[1.5] font-bold text-ink-faint">
            마음에 드는 이야기를 하나 골라서 함께 읽어볼까?
          </p>
        </div>
      </div>
      <Link
        href="/stories"
        className="flex h-[54px] shrink-0 items-center justify-center rounded-lg bg-primary-strong px-6 text-[18px] leading-[1.5] font-extrabold text-white"
      >
        이야기 찾아볼래!
      </Link>
    </div>
  );
}
