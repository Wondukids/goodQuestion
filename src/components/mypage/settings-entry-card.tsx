"use client";

import { useState } from "react";
import { ComingSoonDialog } from "@/components/layout/bottom-nav";
import { MaterialSymbol } from "@/components/ui/material-symbol";

/** 설정 및 기타 진입 카드(시안 21-1458) — 설정 화면이 아직 없어 준비 중 팝업을 띄운다. */
export function SettingsEntryCard() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-[18px] rounded-[20px] border border-surface-muted bg-story-bg px-[26px] py-6 text-left"
      >
        <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-[#8a8a8a]/12 text-[#707070]">
          <MaterialSymbol name="settings" size={28} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5 font-gothic">
          <span className="text-[21px] font-extrabold text-ink-strong">
            설정 및 기타
          </span>
          <span className="text-[15px] leading-[1.45] font-extrabold text-[#707070]">
            알림·공지사항·고객센터·이용 안내·로그아웃
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 font-gothic text-[15px] font-extrabold text-[#3d3d3d]">
          설정 열기
          <MaterialSymbol name="chevron_right" size={16} />
        </span>
      </button>

      {open && (
        <ComingSoonDialog
          icon="settings"
          message="설정은 곧 만나볼 수 있어요."
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
