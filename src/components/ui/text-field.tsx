"use client";

import Image from "next/image";
import { useId, useState } from "react";

type TextFieldProps = {
  label: string;
  name: string;
  type?: "text" | "email" | "password";
  placeholder?: string;
  /** 지우기 버튼 노출 여부 (Figma 34 의 입력 필드) */
  clearable?: boolean;
};

export function TextField({
  label,
  name,
  type = "text",
  placeholder,
  clearable = false,
}: TextFieldProps) {
  const id = useId();
  const [value, setValue] = useState("");

  return (
    <div className="flex w-full flex-col gap-2.5">
      <label htmlFor={id} className="text-[16px] font-extrabold text-ink">
        {label}
      </label>

      <div className="flex w-full items-center gap-3 rounded-2xl border-2 border-ink/20 bg-surface px-[18px] py-4">
        <input
          id={id}
          name={name}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-[18px] text-ink outline-none placeholder:text-ink-soft"
        />

        {clearable && value.length > 0 && (
          <button
            type="button"
            onClick={() => setValue("")}
            aria-label={`${label} 지우기`}
            className="size-6 shrink-0"
          >
            <Image
              src="/figma/icons/clear.svg"
              alt=""
              width={24}
              height={24}
              className="size-6"
            />
          </button>
        )}
      </div>
    </div>
  );
}
