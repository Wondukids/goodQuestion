"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { CHARACTERS, type Character } from "@/lib/characters";

/**
 * 캐릭터 고르기 — 남자·여자 캐릭터가 위아래 두 줄로 놓이고,
 * 각 줄은 6개 중 3개씩 보이는 가로 스크롤이다. 처음엔 » 만 보이고
 * 스크롤(스와이프)이나 버튼으로 넘기면 « 도 나타난다.
 */
export function CharacterPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const boys = CHARACTERS.filter((c) => !c.id.endsWith("-girl"));
  const girls = CHARACTERS.filter((c) => c.id.endsWith("-girl"));

  return (
    <div className="flex max-w-full flex-col gap-4">
      <h2 className="text-[18px] font-extrabold text-ink">캐릭터 고르기</h2>

      <CharacterRow
        title="남자 캐릭터"
        characters={boys}
        value={value}
        onChange={onChange}
      />
      <CharacterRow
        title="여자 캐릭터"
        characters={girls}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}

/* 카드 200px + 사이 12px — 3장이 딱 보이는 창 폭 */
const CARD = 200;
const GAP = 12;
const WINDOW_WIDTH = CARD * 3 + GAP * 2;

function CharacterRow({
  title,
  characters,
  value,
  onChange,
}: {
  title: string;
  characters: Character[];
  value: string;
  onChange: (id: string) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [canPrev, setCanPrev] = useState(false);
  const [canNext, setCanNext] = useState(false);

  const update = () => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanPrev(el.scrollLeft > 8);
    setCanNext(el.scrollLeft < el.scrollWidth - el.clientWidth - 8);
  };

  useEffect(update, []);

  const flip = (direction: 1 | -1) => {
    scrollerRef.current?.scrollBy({
      left: direction * (WINDOW_WIDTH + GAP),
      behavior: "smooth",
    });
  };

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[15px] font-extrabold text-ink-soft">{title}</p>

      <div className="relative" style={{ width: WINDOW_WIDTH }}>
        <div
          ref={scrollerRef}
          onScroll={update}
          role="radiogroup"
          aria-label={title}
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {characters.map((character) => {
            const selected = character.id === value;

            return (
              <button
                key={character.id}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={character.label}
                onClick={() => onChange(character.id)}
                className={`relative size-[200px] shrink-0 cursor-pointer snap-start overflow-hidden rounded-xl border border-primary bg-surface ${
                  selected ? "ring-3 ring-primary" : ""
                }`}
              >
                <Image
                  src={character.src}
                  alt=""
                  width={character.intrinsic.width}
                  height={character.intrinsic.height}
                  style={{
                    left: character.crop.left,
                    top: character.crop.top,
                    width: character.crop.width,
                    height: character.crop.height,
                  }}
                  className="absolute max-w-none"
                />
              </button>
            );
          })}
        </div>

        {canPrev && <RowArrow direction="prev" onClick={() => flip(-1)} />}
        {canNext && <RowArrow direction="next" onClick={() => flip(1)} />}
      </div>
    </div>
  );
}

/** 줄 양옆에 반쯤 겹쳐 얹는 넘김 버튼 — 넘길 수 있는 방향에만 보인다. */
function RowArrow({
  direction,
  onClick,
}: {
  direction: "prev" | "next";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={direction === "prev" ? "이전 캐릭터 보기" : "다음 캐릭터 보기"}
      onClick={onClick}
      className={`absolute top-1/2 flex size-[52px] -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-[#e4e9ee] bg-white/95 text-[#3d3d3d] drop-shadow-[0_4px_6px_rgb(74_62_49_/_0.15)] ${
        direction === "prev" ? "-left-[26px] rotate-180" : "-right-[26px]"
      }`}
    >
      <MaterialSymbol name="chevron_right" size={24} />
    </button>
  );
}
