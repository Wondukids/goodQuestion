"use client";

import Image from "next/image";
import { useState } from "react";
import { birthYearRange } from "@/lib/birth-year";

export function BirthYearStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (birthYear: number) => void;
}) {
  const { min, max } = birthYearRange();
  /* 타이핑 중에는 "20" 같은 미완성 값도 화면에 있어야 하므로 초안을 따로 들고 있다가
     포커스가 빠질 때 범위 안이면 반영하고, 아니면 마지막 값으로 되돌린다. */
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    const typed = Number(draft);
    if (draft !== null && typed >= min && typed <= max) onChange(typed);
    setDraft(null);
  };

  return (
    <div className="flex w-full items-center gap-3">
      <StepperButton
        icon="remove"
        label="출생연도 한 해 앞당기기"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
      />

      <div className="flex min-w-0 flex-1 items-center justify-center gap-0.5 rounded-2xl bg-auth-bg py-3 font-extrabold">
        <input
          value={draft ?? value}
          onChange={(event) =>
            setDraft(event.target.value.replace(/\D/g, "").slice(0, 4))
          }
          onBlur={commit}
          onKeyDown={(event) => {
            /* 폼 안이라 Enter 를 두면 그대로 등록된다. 값만 반영하고 멈춘다. */
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          onFocus={(event) => event.target.select()}
          inputMode="numeric"
          aria-label={`아이 출생연도 (${min}~${max})`}
          className="w-[4ch] bg-transparent text-center text-[26px] text-ink outline-none"
        />
        <span className="text-[17px] text-ink-soft">년</span>
      </div>

      <StepperButton
        icon="add"
        label="출생연도 한 해 늦추기"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
      />
    </div>
  );
}

function StepperButton({
  icon,
  label,
  disabled,
  onClick,
}: {
  icon: "add" | "remove";
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary disabled:opacity-40"
    >
      <Image
        src={`/figma/icons/${icon}.svg`}
        alt=""
        width={24}
        height={24}
        className="size-6"
      />
    </button>
  );
}
