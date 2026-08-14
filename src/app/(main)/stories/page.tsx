import { StoryBrowser } from "@/components/story/story-browser";
import { requireSelectedChild } from "@/lib/selected-child";
import { listStories } from "@/lib/stories";
import { listChildSessions } from "@/lib/story-sessions";
import type { Story } from "@/lib/story-types";
import { STORY_TOPICS, type StoryTopic } from "@/lib/story-types";

/* 시안 21-682 — 하단 네비의 "이야기" 탭.
   읽던 이야기(진행 중 세션)가 있으면 그 섹션부터, 없으면 새로운 이야기만 보인다.
   홈 주제 타일이 ?topic= 으로 들어오면 그 필터가 켜진 채 열린다. */
export default async function StoriesPage(props: PageProps<"/stories">) {
  const { topic } = await props.searchParams;
  const child = await requireSelectedChild();
  const [stories, sessions] = await Promise.all([
    listStories(),
    listChildSessions(child.id),
  ]);

  const continueStories = sessions
    .filter((session) => session.status === "in_progress")
    .map((session) => stories.find((story) => story.id === session.slug))
    .filter((story): story is Story => Boolean(story));

  const requested = Array.isArray(topic) ? topic[0] : topic;
  const initialTopic = (STORY_TOPICS as readonly string[]).includes(
    requested ?? "",
  )
    ? (requested as StoryTopic)
    : "전체";

  return (
    <main className="flex flex-col gap-[26px] px-12 pb-16">
      <h1 className="font-gothic text-[28px] font-extrabold text-ink">
        궁금한 이야기를 골라봐요!
      </h1>

      <StoryBrowser
        stories={stories}
        continueStories={continueStories}
        initialTopic={initialTopic}
      />
    </main>
  );
}
