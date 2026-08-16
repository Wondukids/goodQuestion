import { MyPageView } from "@/components/mypage/mypage-view";
import { getChildStats } from "@/lib/child-stats";
import { requireSelectedChild } from "@/lib/selected-child";
import { listStories } from "@/lib/stories";
import { listChildSessions } from "@/lib/story-sessions";

/* 시안 20(61:1356) — 하단 네비의 "마이페이지" 탭. 화면 구성은 MyPageView 에 있다.
   이번 주 출석은 시안에서 빠졌다 — 기록은 이야기를 시작할 때 계속 쌓이므로
   (`markAttendance`) 화면만 걷어냈고, 카드는 `attendance-card.tsx` 에 남아 있다. */
export default async function MyPage() {
  const child = await requireSelectedChild();
  const [stories, sessions, stats] = await Promise.all([
    listStories(),
    listChildSessions(child.id),
    getChildStats(child.id),
  ]);

  return (
    <MyPageView
      child={child}
      stories={stories}
      sessions={sessions}
      stats={stats}
    />
  );
}
