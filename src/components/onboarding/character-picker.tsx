"use client";

import Image from "next/image";
import { CHARACTERS } from "@/lib/characters";

export function CharacterPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex w-[624px] max-w-full flex-col gap-4">
      <h2 className="text-[18px] font-extrabold text-ink">캐릭터 고르기</h2>

      <div
        role="radiogroup"
        aria-label="캐릭터 고르기"
        className="flex flex-wrap content-center items-center gap-3"
      >
        {CHARACTERS.map((character) => {
          const selected = character.id === value;

          return (
            <button
              key={character.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={character.label}
              onClick={() => onChange(character.id)}
              className={`relative size-[200px] shrink-0 overflow-hidden rounded-xl border border-primary bg-surface ${
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
    </div>
  );
}
