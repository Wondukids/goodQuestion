"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { fetchReportList } from "@/lib/report-api";

/**
 * 보호자 리포트로 들어가는 문(시안 21-1449).
 * 누르면 보호자 확인 모달(시안 21-1347)이 뜨고, 아직 비밀번호를 저장하는 곳이
 * 없어서 아무 숫자든 4자리가 차면 리포트로 넘어간다.
 *
 * 아직 안 읽은 리포트가 있으면 제목 옆에 점을 찍는다 (결정 R24). 목록을 못 받으면
 * 점만 없다 — 마이페이지가 리포트 API 때문에 막히지 않게 조용히 넘긴다.
 */
export function ParentReportCard({
  childName,
  childId,
}: {
  childName: string;
  childId: string;
}) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const reports = await fetchReportList(childId);
        if (!cancelled) setUnread(reports.some((report) => report.unread));
      } catch {
        /* 점은 다음에 들어올 때 다시 확인한다 */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [childId]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-[18px] rounded-[20px] border border-surface-muted bg-story-bg px-[26px] py-6 text-left"
      >
        <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary-strong/12 text-primary-strong">
          <MaterialSymbol name="description" size={28} />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1.5 font-gothic">
          <span className="flex items-center gap-2 text-[21px] font-extrabold text-ink-strong">
            보호자 리포트
            {unread && (
              <span
                aria-label="안 읽은 리포트가 있어요"
                className="size-2.5 rounded-full bg-[#fd7649]"
              />
            )}
          </span>
          <span className="text-[15px] leading-[1.45] font-extrabold text-[#707070]">
            {childName}의 말하기 성장 기록과 가정 학습 가이드를 확인해요
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 font-gothic text-[15px] font-extrabold text-[#3d3d3d]">
          리포트 보기
          <MaterialSymbol name="chevron_right" size={16} />
        </span>
      </button>

      {open && <ParentGateDialog onClose={() => setOpen(false)} />}
    </>
  );
}

/** 보호자 확인 모달(시안 21-1347) — 숫자 4자리를 채우면 리포트로 이동한다. */
export function ParentGateDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const complete = pin.length === 4;

  /* 4자리가 차면 점이 그려질 틈만 주고 바로 넘어간다. */
  useEffect(() => {
    if (!complete) return;
    const timer = setTimeout(() => router.push("/report"), 250);
    return () => clearTimeout(timer);
  }, [complete, router]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="보호자 확인"
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="flex w-[540px] flex-col items-center gap-[22px] rounded-[24px] bg-story-bg px-10 pt-9 pb-8 shadow-[0_12px_16px_rgb(0_0_0_/_0.2)]"
        onClick={(event) => {
          event.stopPropagation();
          inputRef.current?.focus();
        }}
      >
        <span className="flex size-16 items-center justify-center rounded-full bg-surface-muted text-[#8a8a8a]">
          <MaterialSymbol name="lock" size={30} />
        </span>

        <div className="flex w-full flex-col items-center gap-2.5">
          <p className="text-[26px] font-extrabold text-ink-strong">
            보호자님 확인이 필요해요
          </p>
          {/* 아직 비밀번호를 저장하는 곳이 없어 **아무 숫자나** 통한다. 회색 안내로 두면
              진짜 비밀번호를 찾는 줄 알고 멈춘다 — 눈에 걸리게 붉게 굵게 둔다. */}
          <p className="text-center text-[19px] leading-[1.5] font-extrabold text-danger">
            아무 숫자 4자리를 입력해주세요
          </p>
        </div>

        {/* 실제 입력은 투명 입력창 하나가 받고, 칸은 자릿수만 보여 준다 */}
        <div className="relative flex items-center gap-3.5">
          <input
            ref={inputRef}
            autoFocus
            value={pin}
            onChange={(event) =>
              setPin(event.target.value.replace(/\D/g, "").slice(0, 4))
            }
            type="password"
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="비밀번호 4자리"
            className="absolute inset-0 cursor-default opacity-0"
          />
          {[0, 1, 2, 3].map((index) => (
            <span
              key={index}
              className={`pointer-events-none flex h-[84px] w-[72px] items-center justify-center rounded-2xl border-2 bg-story-bg font-gothic text-[28px] font-extrabold text-ink-strong ${
                index < pin.length ? "border-primary-strong" : "border-primary-pale"
              }`}
            >
              {index < pin.length ? "●" : ""}
            </span>
          ))}
        </div>

        <div className="flex w-full gap-3 font-gothic text-[19px] font-extrabold">
          <button
            type="button"
            onClick={onClose}
            className="flex min-w-0 flex-1 cursor-pointer items-center justify-center rounded-xl bg-surface-muted px-5 py-[18px] text-[#8a8a8a]"
          >
            돌아가기
          </button>
          <button
            type="button"
            disabled={!complete}
            onClick={() => router.push("/report")}
            className="flex min-w-0 flex-1 cursor-pointer items-center justify-center rounded-xl bg-primary-strong px-5 py-[18px] text-white disabled:opacity-50"
          >
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
