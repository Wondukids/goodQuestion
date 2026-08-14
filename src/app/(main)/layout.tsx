import Image from "next/image";
import { BottomNav } from "@/components/layout/bottom-nav";
import { TopNav } from "@/components/layout/top-nav";
import { requireSelectedChild } from "@/lib/selected-child";

export default async function MainLayout({ children }: LayoutProps<"/">) {
  /* 홈·이야기 목록은 아이가 정해져야 열린다. 없으면 선택 화면으로 되돌린다. */
  const child = await requireSelectedChild();

  return (
    <div className="min-h-screen">
      {/* 시안 공통 하늘 배경 — 투명한 상단 네비 뒤까지 비치도록 화면에 고정 */}
      <div className="fixed inset-0 -z-10 bg-app-bg">
        <Image
          src="/figma/home-bg.png"
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover"
        />
      </div>
      <TopNav name={child.name} characterId={child.character_id} />
      <div className="pb-[91px]">{children}</div>
      <BottomNav />
    </div>
  );
}
