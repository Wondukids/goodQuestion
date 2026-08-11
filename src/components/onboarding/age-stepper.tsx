"use client";

import Image from "next/image";

const MIN_AGE = 4;
const MAX_AGE = 13;

export function AgeStepper({
  value,
  onChange,
}: {
  value: number;
  onChange: (age: number) => void;
}) {
  return (
    <div className="flex w-full items-center gap-3">
      <StepperButton
        icon="remove"
        label="나이 한 살 줄이기"
        disabled={value <= MIN_AGE}
        onClick={() => onChange(Math.max(MIN_AGE, value - 1))}
      />

      <output className="flex min-w-0 flex-1 items-center justify-center gap-0.5 rounded-2xl bg-auth-bg py-3 font-extrabold">
        <span className="text-[26px] text-ink">{value}</span>
        <span className="text-[17px] text-ink-soft">세</span>
      </output>

      <StepperButton
        icon="add"
        label="나이 한 살 늘리기"
        disabled={value >= MAX_AGE}
        onClick={() => onChange(Math.min(MAX_AGE, value + 1))}
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
