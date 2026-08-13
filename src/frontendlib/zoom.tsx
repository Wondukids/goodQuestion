"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * 시간에 따른 확대/축소 — 카메라가 천천히 다가가는(ZoomIn)/물러나는(ZoomOut) 연출.
 * 씬 배경에 깔고 durationMs 를 씬 길이에 맞추면 된다. 바깥 래퍼가 overflow-hidden
 * 으로 잘라 주므로 확대돼도 화면 밖으로 넘치지 않는다.
 *
 * <ZoomIn durationMs={10000} className="absolute inset-0"><Image ... /></ZoomIn>
 */
type ZoomProps = {
  durationMs?: number;
  /** 확대 중심 (transform-origin 값, 예: "50% 30%") */
  origin?: string;
  /** 가감속 곡선 — 기본은 일정 속도(linear) */
  easing?: string;
  /** 바뀔 때마다 연출을 다시 재생한다 (첫 마운트 포함) */
  playKey?: string | number;
  className?: string;
  children: ReactNode;
};

function Zoom({
  from,
  to,
  durationMs = 8000,
  origin = "center",
  easing = "linear",
  playKey = 0,
  className = "",
  children,
}: ZoomProps & { from: number; to: number }) {
  return (
    <div className={`overflow-hidden ${className}`}>
      <div
        key={playKey}
        className="fx-zoom h-full w-full"
        style={
          {
            "--fx-scale-from": from,
            "--fx-scale-to": to,
            "--fx-duration": `${durationMs}ms`,
            "--fx-ease": easing,
            "--fx-origin": origin,
          } as CSSProperties
        }
      >
        {children}
      </div>
    </div>
  );
}

/** 시간에 따른 확대 — 1 에서 scaleTo(기본 1.15)까지 서서히 커진다 */
export function ZoomIn({ scaleTo = 1.15, ...props }: ZoomProps & { scaleTo?: number }) {
  return <Zoom from={1} to={scaleTo} {...props} />;
}

/** 시간에 따른 축소 — scaleFrom(기본 1.15)에서 1 까지 서서히 물러난다 */
export function ZoomOut({ scaleFrom = 1.15, ...props }: ZoomProps & { scaleFrom?: number }) {
  return <Zoom from={scaleFrom} to={1} {...props} />;
}
