"use client";

import { useState } from "react";
import Link from "next/link";
import { HomeGuide } from "@/components/report/home-guide";
import { SpeechAnalysis } from "@/components/report/speech-analysis";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { ActivityChoice, Report } from "@/lib/report";

type Tab = "speech" | "guide";

/**
 * 보호자 리포트(시안 47-1865 · 47-2045).
 * 말하기 분석과 가정 연계 가이드를 헤더의 탭 하나로 갈아 끼운다.
 * 아이 화면이 아니라 상단·하단 네비 없이 (main) 레이아웃 밖에 산다.
 *
 * 값은 전부 `report` 로 받는다 — 조회와 상태는 `ReportScreen` 이 들고 있다.
 */
export function ReportView({
  report,
  characterId,
  activities,
  onSelectActivity,
  onRegenerate,
  regenerating,
  message,
}: {
  report: Report;
  characterId: string;
  activities: ActivityChoice[];
  onSelectActivity: (sessionId: string) => void;
  onRegenerate: () => void;
  regenerating: boolean;
  message: string | null;
}) {
  const [tab, setTab] = useState<Tab>("speech");
  /* 가이드를 한 번 열면 NEW 점과 안내 토스트를 걷는다. 처음 값은 「아직 안 읽은
     리포트인가」다 — 이미 읽은 리포트를 다시 열 때 새 것처럼 굴지 않는다 (계약 2절 ⑤). */
  const [guideSeen, setGuideSeen] = useState(!report.unread);
  const [activityOpen, setActivityOpen] = useState(false);

  const openGuide = () => {
    setTab("guide");
    setGuideSeen(true);
  };

  return (
    /* break-keep — 좁은 카드에 한국어 문장이 길게 들어간다. 브라우저 기본값은
       한글을 글자 단위로 끊어서 "낱말 7 / 개를" 처럼 어절이 갈라진다.
       시안(Figma)은 어절 단위로 끊으므로 여기서 맞춘다. */
    <main className="flex h-full flex-col bg-story-bg break-keep">
      <header className="relative flex h-[104px] shrink-0 items-center justify-between px-12">
        <div className="flex items-center gap-4">
          <Link
            href="/mypage"
            aria-label="마이페이지로"
            className="flex size-12 items-center justify-center rounded-3xl border-2 border-surface-muted bg-story-bg text-ink-strong"
          >
            <MaterialSymbol name="chevron_left" size={20} />
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-[26px] font-extrabold text-ink-strong">
              보호자 리포트
            </h1>
            <span className="flex items-center gap-1.5 rounded-full bg-surface-muted px-3.5 py-2 text-ink-mid">
              <MaterialSymbol name="lock" size={15} />
              <span className="text-[14px] font-bold">보호자 전용</span>
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-full bg-surface-muted py-1.5 pr-1.5 pl-2">
          <TabButton
            icon="insights"
            label="말하기 분석"
            active={tab === "speech"}
            onClick={() => setTab("speech")}
          />
          <TabButton
            icon="psychology"
            label="가정 연계 가이드"
            active={tab === "guide"}
            badge={!guideSeen}
            onClick={openGuide}
          />
        </div>

        <div className="flex items-center gap-3">
          {/* 문장이 아직 없는 리포트에서만 나온다 — 눈에 띄게 (계약 2절 ②) */}
          {report.needsNarrative && (
            <button
              type="button"
              onClick={onRegenerate}
              disabled={regenerating}
              className="flex cursor-pointer items-center gap-1.5 rounded-full bg-primary-strong px-[18px] py-3 text-story-bg disabled:opacity-50"
            >
              <MaterialSymbol name="cached" size={16} />
              <span className="text-[14px] font-extrabold whitespace-nowrap">
                {regenerating ? "만드는 중…" : "다시 만들기"}
              </span>
            </button>
          )}

          <ActivityPicker
            current={report.activity}
            activities={activities}
            currentId={report.sessionId}
            open={activityOpen}
            onToggle={() => setActivityOpen((was) => !was)}
            onSelect={(sessionId) => {
              setActivityOpen(false);
              onSelectActivity(sessionId);
            }}
          />
        </div>

        {!guideSeen && (
          <div className="pointer-events-none absolute top-[67px] left-[635px] flex w-[310px] flex-col items-center">
            <span
              aria-hidden
              className="-mb-1 h-[11px] w-[19px] bg-brand-900 [clip-path:polygon(50%_0%,100%_100%,0%_100%)]"
            />
            <p className="rounded-full bg-brand-900 px-4 py-3 font-gothic text-[14px] font-bold whitespace-nowrap text-story-bg shadow-[0_8px_10px_rgba(253,124,81,0.35)]">
              {report.toast}
            </p>
          </div>
        )}
      </header>

      <div className="px-12 pt-2">
        {message && (
          <p className="mb-3 flex items-center gap-2 rounded-xl bg-surface-muted px-4 py-3">
            <MaterialSymbol name="help" size={16} className="text-[#8a8a8a]" />
            <span className="text-[14px] font-bold text-[#575757]">{message}</span>
          </p>
        )}
        {tab === "speech" ? (
          <SpeechAnalysis report={report} characterId={characterId} />
        ) : (
          <HomeGuide guide={report.guide} />
        )}
      </div>
    </main>
  );
}

/**
 * 헤더 오른쪽의 활동 고르개.
 *
 * 시안에는 펼친 그림이 없어 닫힌 알약(테두리 · 책 아이콘 · 아래 화살표)을 그대로 두고
 * 목록만 아래에 붙였다. 목록을 못 채우면 다른 활동의 리포트로 갈 길이 없다 (계약 3절).
 */
function ActivityPicker({
  current,
  activities,
  currentId,
  open,
  onToggle,
  onSelect,
}: {
  current: { story: string; date: string };
  activities: ActivityChoice[];
  currentId: string;
  open: boolean;
  onToggle: () => void;
  onSelect: (sessionId: string) => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex cursor-pointer items-center gap-3 rounded-full border border-surface-muted px-[18px] py-3 text-[#3d3d3d]"
      >
        <MaterialSymbol name="menu_book" size={17} />
        <span className="text-[14px] font-extrabold whitespace-nowrap">
          {current.story} · {current.date}
        </span>
        <MaterialSymbol
          name="keyboard_arrow_down"
          size={16}
          className="text-[#8a8a8a]"
        />
      </button>

      {open && (
        <>
          {/* 바깥을 누르면 닫힌다 */}
          <span
            aria-hidden
            onClick={onToggle}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div
            role="menu"
            className="absolute top-[calc(100%+8px)] right-0 z-20 flex max-h-[320px] w-[300px] flex-col overflow-y-auto rounded-2xl border border-surface-muted bg-story-bg py-2 shadow-[0_8px_16px_rgba(0,0,0,0.12)]"
          >
            {activities.length === 0 ? (
              <p className="px-4 py-2.5 text-[14px] font-bold text-ink-faint">
                다른 활동이 아직 없어요
              </p>
            ) : (
              activities.map((activity) => (
                <button
                  key={activity.sessionId}
                  type="button"
                  role="menuitem"
                  onClick={() => onSelect(activity.sessionId)}
                  className={`flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-left text-[14px] font-extrabold ${
                    activity.sessionId === currentId
                      ? "text-primary-strong"
                      : "text-[#3d3d3d]"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {activity.story} · {activity.date}
                  </span>
                  {/* 아직 안 읽은 리포트 (계약 2절 ⑤) */}
                  {activity.unread && (
                    <span
                      aria-label="안 읽음"
                      className="size-2 shrink-0 rounded-full bg-[#fd7649]"
                    />
                  )}
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** 헤더 가운데 알약 안의 탭 하나. badge 는 아직 안 본 탭에 붙는 점. */
function TabButton({
  icon,
  label,
  active,
  badge = false,
  onClick,
}: {
  icon: string;
  label: string;
  active: boolean;
  badge?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex cursor-pointer items-center gap-1.5 rounded-full px-[18px] py-[9px] whitespace-nowrap ${
        active
          ? "bg-story-bg text-primary-strong shadow-[0_1px_1.5px_rgba(0,0,0,0.1)]"
          : "text-[#8a8a8a]"
      }`}
    >
      <MaterialSymbol name={icon} size={18} />
      <span className={`text-[15px] ${active ? "font-extrabold" : "font-bold"}`}>
        {label}
      </span>
      {badge && (
        <span aria-hidden className="size-2 rounded-full bg-[#fd7649]" />
      )}
    </button>
  );
}
