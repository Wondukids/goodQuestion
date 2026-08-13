"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Story } from "@/lib/story-types";

/** 완성한 이야기 한 권 — 아이가 직접 말한 리텔링(시안 17)이 함께 꽂힌다. */
export type ShelfEntry = {
  story: Story;
  /** 말하기 후 활동에서 저장된 "내가 말한 이야기" 텍스트 */
  retelling: string;
};

/* 책마다 색·높이·두께가 조금씩 다르게 — slug 해시로 결정한다.
   Math.random 은 서버·클라이언트 렌더가 어긋나 hydration 이 깨지므로 쓰지 않는다. */
const SPINE_COLORS = [
  { bg: "#fd7c51", text: "#ffffff" }, // brand-900
  { bg: "#f6eedd", text: "#3b2f24" }, // warm
  { bg: "#6fbcdd", text: "#ffffff" }, // primary
  { bg: "#3b2f24", text: "#f6eedd" }, // 짙은 양장본
  { bg: "#ffffff", text: "#3b2f24" },
  { bg: "#45a9d3", text: "#ffffff" }, // primary-strong
  { bg: "#f2c14e", text: "#3b2f24" },
  { bg: "#fd6735", text: "#ffffff" }, // point-strong
];
const SPINE_HEIGHTS = [186, 196, 208, 218];
const SPINE_WIDTHS = [42, 48, 54, 60];

function seedOf(id: string) {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return hash;
}

/** 선반에 세로로 꽂힌 책등 하나 — 제목이 세로쓰기로 들어가고, 누르면 리텔링 카드가 뜬다. */
function BookSpine({ entry, onOpen }: { entry: ShelfEntry; onOpen: () => void }) {
  const { story } = entry;
  const seed = seedOf(story.id);
  /* seed 가 2^31 을 넘으면 부호 있는 >> 는 음수가 되므로 >>> 를 쓴다. */
  const color = SPINE_COLORS[seed % SPINE_COLORS.length];
  const height = SPINE_HEIGHTS[(seed >>> 3) % SPINE_HEIGHTS.length];
  const width = SPINE_WIDTHS[(seed >>> 6) % SPINE_WIDTHS.length];

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ width, height, backgroundColor: color.bg, color: color.text }}
      className="relative flex shrink-0 cursor-pointer flex-col items-center gap-2.5 rounded-[3px] pt-3 pb-2.5 transition-transform duration-200 hover:-translate-y-3"
    >
      {/* 표지 장식 띠 */}
      <span className="h-0.5 w-5 shrink-0 bg-current opacity-30" />

      {/* 제목 — 실제 책등처럼 세로쓰기. 길면 왼쪽으로 줄바꿈되고 넘치면 잘린다. */}
      <span
        style={{ writingMode: "vertical-rl" }}
        className="min-h-0 flex-1 overflow-hidden text-[14px] leading-tight font-extrabold"
      >
        {story.title}
      </span>

      {/* 다 읽은 도장 — 출판사 마크 자리 */}
      <span className="shrink-0 text-[11px] opacity-80">★</span>

      {/* 책등 곡면 — 왼쪽은 밝고 오른쪽은 어두운 빛 */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[3px] bg-gradient-to-r from-white/25 via-white/0 to-black/20"
      />
    </button>
  );
}

/** 책을 누르면 뜨는 리텔링 카드(시안 17) — 바깥 클릭·ESC·닫기 버튼으로 닫는다. */
function RetellingCard({
  entry,
  onClose,
}: {
  entry: ShelfEntry;
  onClose: () => void;
}) {
  const { story, retelling } = entry;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${story.title} — 내가 말한 이야기`}
        onClick={(event) => event.stopPropagation()}
        className="flex w-[420px] flex-col overflow-hidden rounded-[20px] border border-primary-line bg-surface shadow-story"
      >
        <div className="relative h-[233px] w-full shrink-0">
          <Image
            src={story.thumbnail}
            alt=""
            fill
            sizes="420px"
            className="object-cover"
          />
          <span className="absolute top-3 right-4 rounded-full bg-primary px-3.5 py-3 text-[14px] font-bold text-white">
            다 읽었어요!
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="absolute top-3 left-3 flex size-9 cursor-pointer items-center justify-center rounded-full bg-black/35 text-[16px] font-bold text-white"
          >
            ✕
          </button>
        </div>

        <div className="flex w-full flex-col gap-4 px-5 py-6">
          <h3 className="text-[24px] font-extrabold text-ink">{story.title}</h3>

          <div className="flex w-full flex-col gap-2 rounded-xl bg-primary-soft/60 p-4">
            <span className="text-[13px] font-bold text-ink-mid">
              내가 말한 이야기
            </span>
            <p className="text-[16px] leading-[1.6] text-ink">{retelling}</p>
          </div>

          <Link
            href={`/stories/${story.id}`}
            className="flex w-full items-center justify-center rounded-lg bg-primary px-10 py-4 text-[18px] font-extrabold text-white"
          >
            다시 읽기
          </Link>
        </div>
      </div>
    </div>
  );
}

/** 마이페이지 "내가 만든 이야기" — 나무 책장 칸에 완성한 책이 한 권씩 꽂힌다. */
export function Bookshelf({ entries }: { entries: ShelfEntry[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = entries.find((entry) => entry.story.id === openId) ?? null;

  return (
    <div className="px-[60px]">
      {/* 책장 칸 — 안쪽 위 그림자로 깊이를 주고, 바닥이 선반 판이다 */}
      <div className="rounded-[20px] border border-line bg-warm shadow-[0_8px_16px_rgba(74,62,49,0.1),inset_0_14px_28px_rgba(59,47,36,0.08)]">
        <div className="flex items-end gap-1 overflow-x-auto px-7 pt-10 [scrollbar-width:none]">
          {entries.map((entry) => (
            <BookSpine
              key={entry.story.id}
              entry={entry}
              onOpen={() => setOpenId(entry.story.id)}
            />
          ))}
        </div>
        <div className="h-[18px] rounded-b-[20px] bg-line" />
      </div>

      {open && <RetellingCard entry={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}
