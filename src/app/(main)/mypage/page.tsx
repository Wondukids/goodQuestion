import { MyPageView } from "@/components/mypage/mypage-view";
import { requireSelectedChild } from "@/lib/selected-child";
import { listStories } from "@/lib/stories";
import { listChildSessions } from "@/lib/story-sessions";

/* 시안 21-1367 — 하단 네비의 "마이페이지" 탭. 화면 구성은 MyPageView 에 있다. */
export default async function MyPage() {
  const child = await requireSelectedChild();
  const [stories, sessions] = await Promise.all([
    listStories(),
    listChildSessions(child.id),
  ]);

  return <MyPageView child={child} stories={stories} sessions={sessions} />;
}
