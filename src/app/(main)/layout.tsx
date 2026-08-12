import { BottomNav } from "@/components/layout/bottom-nav";
import { TopNav } from "@/components/layout/top-nav";
import { requireSelectedChild } from "@/lib/selected-child";

export default async function MainLayout({ children }: LayoutProps<"/">) {
  /* 홈·이야기 목록은 아이가 정해져야 열린다. 없으면 선택 화면으로 되돌린다. */
  const child = await requireSelectedChild();

  return (
    <div className="min-h-screen bg-app-bg">
      <TopNav name={child.name} characterId={child.character_id} />
      <div className="pb-[91px]">{children}</div>
      <BottomNav />
    </div>
  );
}
