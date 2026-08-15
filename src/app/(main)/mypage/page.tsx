import { MyPageView } from "@/components/mypage/mypage-view";
import { getWeekAttendance } from "@/lib/attendance";
import { getChildStats } from "@/lib/child-stats";
import { requireSelectedChild } from "@/lib/selected-child";
import { listStories } from "@/lib/stories";
import { listChildSessions } from "@/lib/story-sessions";

/* 시안 41-1700 — 하단 네비의 "마이페이지" 탭. 화면 구성은 MyPageView 에 있다. */
export default async function MyPage() {
  const child = await requireSelectedChild();
  const [stories, sessions, week, stats] = await Promise.all([
    listStories(),
    listChildSessions(child.id),
    getWeekAttendance(child.id),
    getChildStats(child.id),
  ]);

  return (
    <MyPageView
      child={child}
      stories={stories}
      sessions={sessions}
      week={week}
      stats={stats}
    />
  );
}
