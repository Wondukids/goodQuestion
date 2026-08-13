"use client";

import type { ReactNode } from "react";

/**
 * 팝업 — 어두운 배경 위로 패널이 통통 튀며 나타난다.
 * open 이 false 면 아무것도 그리지 않는다 (닫힘 연출 없이 즉시 제거 —
 * slide-transition 과 같은 방식). 패널 생김새(배경·라운드·패딩)는 호출부가
 * className 으로 정한다.
 *
 * <Popup open={open} onClose={() => setOpen(false)} className="rounded-3xl bg-white p-8">
 */
export function Popup({
  open,
  onClose,
  className = "",
  children,
}: {
  open: boolean;
  /** 배경을 눌렀을 때 — 없으면 배경으로는 닫히지 않는다 */
  onClose?: () => void;
  /** 패널에 얹을 클래스 */
  className?: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <button
        type="button"
        aria-label="팝업 닫기"
        onClick={onClose}
        className="fx-fade-in absolute inset-0 cursor-default bg-black/50"
      />
      <div role="dialog" aria-modal="true" className={`fx-pop-in relative ${className}`}>
        {children}
      </div>
    </div>
  );
}
