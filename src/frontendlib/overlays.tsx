"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * 화면 오버레이 연출 — 내용물은 건드리지 않고 위에 겹치는 효과 모음
 * (레터박스·비네트·플래시). children 을 감싸고 그 위에 오버레이를 얹는다.
 * playKey 가 바뀔 때마다 다시 재생한다 (첫 마운트 포함).
 */

type OverlayProps = {
  /** 바뀔 때마다 연출을 다시 재생한다 (첫 마운트 포함) */
  playKey?: string | number;
  className?: string;
  children: ReactNode;
};

/** 레터박스 — 위아래 검은 띠가 들어와 시네마틱한 화면비를 만든다 */
export function Letterbox({
  barPct = 12,
  durationMs = 700,
  playKey = 0,
  className = "",
  children,
}: OverlayProps & { barPct?: number; durationMs?: number }) {
  const vars = { "--fx-duration": `${durationMs}ms` } as CSSProperties;
  return (
    <div className={`relative overflow-hidden ${className}`}>
      {children}
      <div
        key={playKey}
        aria-hidden
        className="pointer-events-none absolute inset-0"
      >
        <div
          className="fx-bar-top absolute inset-x-0 top-0 bg-black"
          style={{ height: `${barPct}%`, ...vars }}
        />
        <div
          className="fx-bar-bottom absolute inset-x-0 bottom-0 bg-black"
          style={{ height: `${barPct}%`, ...vars }}
        />
      </div>
    </div>
  );
}

/** 비네트 — 가장자리를 어둡게 해 집중시킨다. 붉은색이면 피격·위기 표시 */
export function Vignette({
  color = "rgba(0, 0, 0, 0.55)",
  innerPct = 52,
  pulse = false,
  durationMs,
  playKey = 0,
  className = "",
  children,
}: OverlayProps & {
  /** 가장자리 색 — 기본 검정, "rgba(200,30,30,0.5)" 처럼 붉게도 */
  color?: string;
  /** 어두워지기 시작하는 반경(%) — 작을수록 좁게 조인다 */
  innerPct?: number;
  /** true 면 진해졌다 옅어지기를 반복 (긴장 연출) */
  pulse?: boolean;
  durationMs?: number;
}) {
  return (
    <div className={`relative ${className}`}>
      {children}
      <div
        key={playKey}
        aria-hidden
        className={`fx-vignette ${pulse ? "fx-vignette-pulse" : ""} pointer-events-none absolute inset-0`}
        style={
          {
            "--fx-vig-color": color,
            "--fx-vig-inner": `${innerPct}%`,
            ...(durationMs !== undefined ? { "--fx-duration": `${durationMs}ms` } : {}),
          } as CSSProperties
        }
      />
    </div>
  );
}

/** 플래시 — 화면이 순간 번쩍였다가 사라진다 (번개·폭발·스킬 발동) */
export function Flash({
  color = "#fff",
  peak = 1,
  durationMs = 450,
  playKey = 0,
  className = "",
  children,
}: OverlayProps & { color?: string; peak?: number; durationMs?: number }) {
  return (
    <div className={`relative ${className}`}>
      {children}
      <div
        key={playKey}
        aria-hidden
        className="fx-flash pointer-events-none absolute inset-0"
        style={
          {
            "--fx-flash-color": color,
            "--fx-flash-peak": peak,
            "--fx-duration": `${durationMs}ms`,
          } as CSSProperties
        }
      />
    </div>
  );
}
