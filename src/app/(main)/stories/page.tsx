import { StoryBrowser } from "@/components/story/story-browser";
import { listStories } from "@/lib/stories";

/* 시안 6 — 하단 네비의 "이야기" 탭.
   상단 네비가 140px 이라 제목은 별도 여백 없이 시안의 y=140 에 그대로 앉는다. */
export default async function StoriesPage() {
  const stories = await listStories();

  return (
    <main className="flex flex-col gap-5 pb-12">
      <h1 className="px-[60px] text-[28px] font-extrabold text-ink">
        궁금한 이야기를 골라봐요!
      </h1>

      <StoryBrowser stories={stories} />
    </main>
  );
}
