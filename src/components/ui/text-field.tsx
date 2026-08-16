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
  /** 숫자만 받는 칸(출생연도 등) — 숫자 자판을 띄우고 숫자가 아닌 글자는 걸러낸다. */
  numeric?: boolean;
  maxLength?: number;
  /** 브라우저·비밀번호 관리자에게 칸의 뜻을 알려 준다 (로그인 칸에서 쓴다) */
  autoComplete?: string;
  required?: boolean;
};

/** 라벨 + 입력 한 칸(시안 336:1414) — 로그인·아이 등록이 같이 쓴다. */
export function TextField({
  label,
  name,
  type = "text",
  placeholder,
  clearable = false,
  numeric = false,
  maxLength,
  autoComplete,
  required = false,
}: TextFieldProps) {
  const id = useId();
  const [value, setValue] = useState("");

  return (
    <div className="flex w-full flex-col gap-2.5">
      <label
        htmlFor={id}
        className="pl-2 text-[16px] leading-[1.5] font-extrabold text-ink-strong"
      >
        {label}
      </label>

      <div className="flex w-full items-center gap-3 rounded-lg border border-[#bdbdbd] bg-story-bg px-[18px] py-4">
        <input
          id={id}
          name={name}
          type={type}
          placeholder={placeholder}
          value={value}
          maxLength={maxLength}
          autoComplete={autoComplete}
          required={required}
          inputMode={numeric ? "numeric" : undefined}
          onChange={(event) =>
            setValue(
              numeric
                ? event.target.value.replace(/\D/g, "")
                : event.target.value,
            )
          }
          className="min-w-0 flex-1 bg-transparent text-[18px] leading-[1.5] text-ink-strong outline-none placeholder:text-ink-faint"
        />

        {clearable && value.length > 0 && (
          <button
            type="button"
            onClick={() => setValue("")}
            aria-label={`${label} 지우기`}
            className="size-6 shrink-0 cursor-pointer"
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
