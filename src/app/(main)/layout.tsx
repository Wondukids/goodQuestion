import { BottomNav } from "@/components/layout/bottom-nav";
import { TopNav } from "@/components/layout/top-nav";
import { CHILDREN } from "@/lib/mock-data";

export default function MainLayout({ children }: LayoutProps<"/">) {
  /* 선택된 아이 — 아이 선택(32)에서 넘어온 값으로 교체될 자리 */
  const currentChild = CHILDREN[0];

  return (
    <div className="min-h-screen bg-app-bg">
      <TopNav child={currentChild} />
      <div className="pb-[91px]">{children}</div>
      <BottomNav />
    </div>
  );
}
