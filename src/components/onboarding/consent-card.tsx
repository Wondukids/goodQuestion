"use client";

import Image from "next/image";
import { useState } from "react";
import { CONSENT_CLAUSES, CONSENT_VERSION } from "@/lib/consent";

/** 아이 등록 앞단의 개인정보 처리동의(시안 75). 체크해야 "다음" 이 열린다. */
export function ConsentCard({ onAgree }: { onAgree: () => void }) {
  const [checked, setChecked] = useState(false);

  return (
    <div className="flex w-[680px] max-w-full flex-col gap-6 rounded-3xl bg-surface p-10 drop-shadow-[0_8px_12px_rgb(0_0_0_/_0.05)]">
      <div className="flex flex-col gap-2 leading-[1.4]">
        <h1 className="text-[24px] font-extrabold text-ink-deep">
          아동 개인정보 처리동의
        </h1>
        <p className="text-[14px] text-[#8a8a8a]">
          Good Question 서비스 제공을 위해 아동의 개인정보 수집 및 이용 동의가
          필요합니다.
        </p>
      </div>

      <div className="flex h-[340px] flex-col gap-4 overflow-y-auto rounded-xl bg-surface-muted p-5">
        <p className="text-[13px] font-bold text-[#575757]">
          [안내문 버전: {CONSENT_VERSION} | 확인 방식: 온라인 보호자 확인
          (authenticated_parent)]
        </p>
        <div className="flex flex-col gap-3.5">
          {CONSENT_CLAUSES.map((clause) => (
            <section key={clause.title} className="flex flex-col gap-1">
              <h2 className="text-[14px] font-extrabold text-ink-strong">
                {clause.title}
              </h2>
              <ul className="text-[13px] leading-[1.5] text-[#575757]">
                {clause.items.map((item) => (
                  <li key={item}>• {item}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>

      <label className="flex cursor-pointer items-center gap-2.5 py-1">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => setChecked(event.target.checked)}
          className="peer sr-only"
        />
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[#d6d6d6] peer-checked:bg-primary">
          {checked && (
            <Image
              src="/figma/icons/check.svg"
              alt=""
              width={14}
              height={14}
              className="size-[14px]"
            />
          )}
        </span>
        <span className="text-[15px] leading-[1.4] font-extrabold text-ink-strong">
          위 내용을 확인하였으며, 아동의 개인정보 처리에 동의합니다.
        </span>
      </label>

      <button
        type="button"
        onClick={onAgree}
        disabled={!checked}
        className="h-[61px] w-full rounded-lg bg-primary text-[22px] leading-[1.5] font-extrabold text-white disabled:bg-primary-line"
      >
        다음
      </button>
    </div>
  );
}
