"use client";

import { useState } from "react";
import { ComingSoonDialog } from "@/components/layout/bottom-nav";

/* 시안 0:1083 "아직 계정이 없나요? 회원가입".
   가입 화면은 아직 없어서 누르면 준비 중 팝업만 띄운다. */
export function SignUpLink() {
  const [comingSoonOpen, setComingSoonOpen] = useState(false);

  return (
    <>
      <div className="flex w-full items-center justify-center gap-2 py-2 text-[14px] font-bold whitespace-nowrap">
        <span className="text-[#8a8a8a]">아직 계정이 없나요?</span>
        <button
          type="button"
          onClick={() => setComingSoonOpen(true)}
          className="cursor-pointer text-ink-deep underline-offset-4 hover:underline"
        >
          회원가입
        </button>
      </div>

      {comingSoonOpen && (
        <ComingSoonDialog
          icon="group"
          message="회원가입은 개발 예정입니다."
          onClose={() => setComingSoonOpen(false)}
        />
      )}
    </>
  );
}
