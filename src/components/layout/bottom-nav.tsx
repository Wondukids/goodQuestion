"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 아이콘은 Figma 에서 상태 색이 구워진 채로 내려온다.
 * 시안(31)에 존재하는 상태는 "홈 활성 / 나머지 비활성" 뿐이라 그대로 사용한다.
 */
const TABS = [
  { href: "/home", label: "홈", icon: "/figma/icons/tab-home.svg", size: 24 },
  {
    href: "/stories",
    label: "이야기",
    icon: "/figma/icons/tab-story.svg",
    size: 26,
  },
  {
    href: "/wordbook",
    label: "단어장",
    icon: "/figma/icons/tab-wordbook.svg",
    size: 26,
  },
  {
    href: "/mypage",
    label: "마이페이지",
    icon: "/figma/icons/tab-mypage.svg",
    size: 26,
  },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 z-20 h-[91px] w-full bg-story-bg drop-shadow-[0_-12px_16px_rgb(0_0_0_/_0.1)]">
      <ul className="flex h-full">
        {TABS.map((tab) => {
          const active = pathname.startsWith(tab.href);

          return (
            <li key={tab.href} className="flex flex-1 items-center justify-center p-2.5">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center justify-center gap-1 overflow-hidden rounded-[20px] px-5 py-2 ${
                  active ? "h-[71px] bg-primary/20" : ""
                }`}
              >
                <Image
                  src={tab.icon}
                  alt=""
                  width={tab.size}
                  height={tab.size}
                  style={{ width: tab.size, height: tab.size }}
                />
                <span
                  className={`font-jua text-[20px] ${
                    active ? "text-primary" : "text-[#1e1e1e]"
                  }`}
                >
                  {tab.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
