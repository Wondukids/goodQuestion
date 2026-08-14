"use client";

import type { CSSProperties } from "react";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MaterialSymbol } from "@/components/ui/material-symbol";

/**
 * 하단 네비(시안 21-821). 아이콘은 시안에서 추출한 단색 글리프 SVG
 * (public/figma/icons/nav)를 mask 로 깔고 currentColor 로 칠한다 —
 * 활성/비활성 색이 경로에 따라 바뀐다.
 */
function mask(name: string): CSSProperties {
  const url = `url(/figma/icons/nav/${name}.svg)`;
  return {
    maskImage: url,
    maskSize: "100% 100%",
    WebkitMaskImage: url,
    WebkitMaskSize: "100% 100%",
  };
}

/* 시안의 lucide:home — 24 박스 안 8.33%/12.5% 인셋, 스트로크만큼 바깥으로 번진다 */
function HomeIcon() {
  return (
    <span aria-hidden className="relative size-6">
      <span className="absolute inset-[8.33%_12.5%_12.5%_12.5%]">
        <span
          className="absolute inset-[-5.26%_-5.56%] bg-current"
          style={mask("home")}
        />
      </span>
    </span>
  );
}

/* 시안의 boxicons:book — 책 몸통과 페이지 줄, 두 조각을 겹친다 */
function BookIcon() {
  return (
    <span aria-hidden className="relative size-6">
      <span
        className="absolute top-1/4 right-[29.17%] bottom-[66.67%] left-[33.33%] bg-current"
        style={mask("book-top")}
      />
      <span
        className="absolute inset-[8.33%_12.5%] bg-current"
        style={mask("book-body")}
      />
    </span>
  );
}

/* 시안의 bookmark-rounded — 24 박스 중앙의 16×20 */
function BookmarkIcon() {
  return (
    <span aria-hidden className="relative size-6">
      <span
        className="absolute top-1/2 left-1/2 h-5 w-4 -translate-x-1/2 -translate-y-1/2 bg-current"
        style={mask("bookmark")}
      />
    </span>
  );
}

/* 시안의 person-rounded — 24 박스를 꽉 채운다 */
function PersonIcon() {
  return (
    <span aria-hidden className="relative size-6">
      <span className="absolute inset-0 bg-current" style={mask("person")} />
    </span>
  );
}

/* comingSoon 탭은 이동하지 않고 준비 중 팝업을 띄운다 — /wordbook 화면이 아직 없다. */
const TABS = [
  { href: "/home", label: "홈", Icon: HomeIcon, comingSoon: false },
  { href: "/stories", label: "이야기", Icon: BookIcon, comingSoon: false },
  { href: "/wordbook", label: "단어장", Icon: BookmarkIcon, comingSoon: true },
  { href: "/mypage", label: "마이페이지", Icon: PersonIcon, comingSoon: false },
] as const;

export function BottomNav() {
  const pathname = usePathname();
  const [comingSoonOpen, setComingSoonOpen] = useState(false);

  return (
    <>
      <nav className="fixed bottom-0 left-0 z-20 h-[91px] w-full bg-story-bg drop-shadow-[0_-12px_16px_rgb(0_0_0_/_0.1)]">
        <ul className="flex h-full">
          {TABS.map((tab) => {
            const active = pathname.startsWith(tab.href);
            const itemClass = `flex flex-col items-center justify-center gap-1 overflow-hidden rounded-[20px] px-5 py-2 ${
              active
                ? "h-[71px] bg-primary-strong/15 text-primary-strong"
                : "text-ink-strong"
            }`;

            return (
              <li key={tab.href} className="flex flex-1 items-center justify-center p-2.5">
                {tab.comingSoon ? (
                  <button
                    type="button"
                    onClick={() => setComingSoonOpen(true)}
                    className={`${itemClass} cursor-pointer`}
                  >
                    <tab.Icon />
                    <span className="text-[20px] font-extrabold">
                      {tab.label}
                    </span>
                  </button>
                ) : (
                  <Link
                    href={tab.href}
                    aria-current={active ? "page" : undefined}
                    className={itemClass}
                  >
                    <tab.Icon />
                    <span className="text-[20px] font-extrabold">
                      {tab.label}
                    </span>
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {comingSoonOpen && (
        <ComingSoonDialog onClose={() => setComingSoonOpen(false)} />
      )}
    </>
  );
}

/** 준비 중 안내 팝업 — 바깥을 눌러도 닫힌다. icon 은 public/figma/icons/ms 의 아이콘 이름. */
export function ComingSoonDialog({
  onClose,
  icon = "bookmark",
  message = "단어장은 곧 만나볼 수 있어요.",
}: {
  onClose: () => void;
  icon?: string;
  message?: string;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="준비 중"
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="flex w-[420px] flex-col items-center gap-5 rounded-[24px] bg-white px-10 py-9 shadow-[0_12px_32px_rgb(0_0_0_/_0.18)]"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="flex size-20 items-center justify-center rounded-full bg-primary-pale text-primary">
          <MaterialSymbol name={icon} size={36} />
        </span>
        <div className="flex flex-col items-center gap-1.5 leading-[1.6]">
          <p className="text-[22px] font-extrabold text-ink-strong">
            준비 중입니다!
          </p>
          <p className="text-[17px] font-bold text-[#8a8a8a]">{message}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-[52px] w-full cursor-pointer items-center justify-center rounded-lg bg-primary-strong text-[18px] font-extrabold text-white"
        >
          확인
        </button>
      </div>
    </div>
  );
}
