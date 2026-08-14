"use client";

import type { CSSProperties, ReactNode } from "react";
import { DIRECTION_CLIP, type Direction } from "./shared";

/**
 * 등장 전환 모음 — 요소 하나가 나타나는 방식을 variant 로 고른다.
 * 슬라이드 계열은 slide-in.tsx 의 SlideIn 이 따로 있다 (방향·거리 옵션이 많아서).
 * playKey 가 바뀔 때마다 다시 재생한다 (첫 마운트 포함).
 *
 * <Reveal variant="iris" durationMs={700}>...</Reveal>
 */

export type RevealVariant =
  | "fade"
  | "pop"
  | "scale"
  | "zoom-fade"
  | "fade-black"
  | "wipe"
  | "wipe-diagonal"
  | "iris"
  | "split"
  | "blinds"
  | "checker"
  | "flip-x"
  | "flip-y"
  | "rotate"
  | "blur"
  | "bounce";

const VARIANT_CLASS: Record<RevealVariant, string> = {
  fade: "fx-fade-in",
  pop: "fx-pop-in",
  scale: "fx-scale-in",
  "zoom-fade": "fx-zoom-fade-in",
  "fade-black": "fx-fade-black-in",
  wipe: "fx-wipe-in",
  "wipe-diagonal": "fx-wipe-diag-in",
  iris: "fx-iris-in",
  split: "fx-split-in",
  blinds: "fx-blinds-in",
  checker: "fx-checker-in",
  "flip-x": "fx-flip-x-in",
  "flip-y": "fx-flip-y-in",
  rotate: "fx-rotate-in",
  blur: "fx-blur-in",
  bounce: "fx-bounce-in",
};

export function Reveal({
  variant,
  direction = "left",
  origin,
  durationMs,
  playKey = 0,
  className = "",
  children,
}: {
  variant: RevealVariant;
  /** wipe 전용 — 드러나기 시작하는 방향 */
  direction?: Direction;
  /** iris 전용 — 원이 커지는 중심 ("50% 50%" 형태) */
  origin?: string;
  /** 생략하면 variant 별 기본 시간 */
  durationMs?: number;
  /** 바뀔 때마다 연출을 다시 재생한다 (첫 마운트 포함) */
  playKey?: string | number;
  className?: string;
  children: ReactNode;
}) {
  const vars: Record<string, string> = {};
  if (durationMs !== undefined) vars["--fx-duration"] = `${durationMs}ms`;
  if (variant === "wipe") vars["--fx-clip"] = DIRECTION_CLIP[direction];
  if (origin !== undefined) vars["--fx-origin"] = origin;
  return (
    <div
      key={playKey}
      className={`${VARIANT_CLASS[variant]} ${className}`}
      style={vars as CSSProperties}
    >
      {children}
    </div>
  );
}

/* playKey 문자열 → 시드 → 매번 다른 막대 순서 (렌더 간 결정적이라 SSR 안전) */
function shuffledDelays(count: number, seedSource: string | number): number[] {
  let seed = 0;
  for (const ch of String(seedSource)) seed = (seed * 31 + ch.charCodeAt(0)) & 0x7fffffff;
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const j = seed % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const delays = new Array<number>(count);
  order.forEach((bar, rank) => {
    delays[bar] = rank;
  });
  return delays;
}

/** 랜덤 바 — 세로 막대가 무작위 순서로 나타나며 드러난다.
 *  children 을 막대 수만큼 잘라 겹치므로 이미지 같은 정적 내용 전용이다. */
export function RandomBars({
  bars = 9,
  durationMs = 700,
  playKey = 0,
  className = "",
  children,
}: {
  bars?: number;
  durationMs?: number;
  /** 바뀔 때마다 순서를 새로 섞어 다시 재생한다 (첫 마운트 포함) */
  playKey?: string | number;
  className?: string;
  children: ReactNode;
}) {
  const delays = shuffledDelays(bars, playKey);
  const barFade = Math.min(250, durationMs * 0.4);
  const step = bars > 1 ? (durationMs - barFade) / (bars - 1) : 0;
  const width = 100 / bars;
  return (
    <div key={playKey} className={`relative ${className}`}>
      {delays.map((rank, i) => (
        <div
          key={i}
          className="fx-fade-in absolute inset-0"
          style={
            {
              clipPath: `inset(0 ${(bars - 1 - i) * width}% 0 ${i * width}%)`,
              "--fx-duration": `${barFade}ms`,
              animationDelay: `${rank * step}ms`,
            } as CSSProperties
          }
        >
          {children}
        </div>
      ))}
    </div>
  );
}
