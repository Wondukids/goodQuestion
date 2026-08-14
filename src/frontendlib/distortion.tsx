"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * 왜곡 연출 — 글리치·색수차. children 의 사본을 두어 장 겹쳐서 만들기 때문에
 * 이미지·배경처럼 정적인 내용을 감싸는 용도다 (버튼 등 인터랙션 요소는 넣지 말 것).
 * playKey 가 바뀔 때마다 다시 재생한다 (첫 마운트 포함).
 */

type DistortionProps = {
  /** 바뀔 때마다 연출을 다시 재생한다 (첫 마운트 포함) */
  playKey?: string | number;
  className?: string;
  children: ReactNode;
};

/** 글리치 — 화면이 지지직 깨지며 가로 밴드가 어긋난다 (사이버·이상 상태) */
export function Glitch({
  shift = 10,
  durationMs = 600,
  loop = false,
  playKey = 0,
  className = "",
  children,
}: DistortionProps & {
  /** 조각이 어긋나는 거리(px) */
  shift?: number;
  durationMs?: number;
  /** true 면 계속 지지직거린다 */
  loop?: boolean;
}) {
  const vars = {
    "--fx-duration": `${durationMs}ms`,
    "--fx-repeat": loop ? "infinite" : 1,
  } as CSSProperties;
  return (
    <div key={playKey} className={`relative overflow-hidden ${className}`}>
      <div className="fx-glitch-jitter h-full w-full" style={vars}>
        {children}
      </div>
      <div
        aria-hidden
        className="fx-glitch-slice pointer-events-none absolute inset-0"
        style={{ ...vars, "--fx-glitch-shift": `${shift}px` } as CSSProperties}
      >
        {children}
      </div>
      <div
        aria-hidden
        className="fx-glitch-slice pointer-events-none absolute inset-0"
        style={
          {
            ...vars,
            "--fx-glitch-shift": `${-shift * 0.7}px`,
            animationDelay: "120ms",
          } as CSSProperties
        }
      >
        {children}
      </div>
    </div>
  );
}

/** 색수차 — 색을 튼 사본이 좌우로 벌어졌다 모이며 번진다 (피격·이상 상태) */
export function ChromaticAberration({
  offset = 4,
  durationMs = 1200,
  loop = true,
  playKey = 0,
  className = "",
  children,
}: DistortionProps & {
  /** 색이 벌어지는 최대 거리(px) */
  offset?: number;
  durationMs?: number;
  /** true 면 계속 벌어졌다 모인다 */
  loop?: boolean;
}) {
  const vars = {
    "--fx-chroma": `${offset}px`,
    "--fx-duration": `${durationMs}ms`,
    "--fx-repeat": loop ? "infinite" : 1,
  } as CSSProperties;
  return (
    <div key={playKey} className={`relative overflow-hidden ${className}`}>
      {children}
      <div
        aria-hidden
        className="fx-chroma-copy pointer-events-none absolute inset-0"
        style={{ ...vars, "--fx-chroma-dir": 1, filter: "hue-rotate(120deg)" } as CSSProperties}
      >
        {children}
      </div>
      <div
        aria-hidden
        className="fx-chroma-copy pointer-events-none absolute inset-0"
        style={{ ...vars, "--fx-chroma-dir": -1, filter: "hue-rotate(-120deg)" } as CSSProperties}
      >
        {children}
      </div>
    </div>
  );
}
