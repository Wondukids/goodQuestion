"use client";

import type { CSSProperties, ReactNode } from "react";
import { DIRECTION_VECTOR, type Direction } from "./shared";

/**
 * 슬라이드 — children 이 지정한 방향에서 제자리로 밀려 들어온다.
 * 화면 전환(키 교체) 방식의 슬라이드는 components/ui/slide-transition.tsx 가 따로 있다
 * — 이 컴포넌트는 화면 안 요소 하나를 등장시키는 연출용이다.
 *
 * <SlideIn from="left" durationMs={500}>...</SlideIn>
 */
export function SlideIn({
  from = "right",
  distance,
  durationMs = 700,
  delayMs = 0,
  playKey = 0,
  className = "",
  children,
}: {
  /** 들어오는 방향 — 어느 쪽에서 출발하는지 */
  from?: Direction;
  /** 이동 거리(px). 생략하면 요소 자기 크기(100%)만큼 */
  distance?: number;
  durationMs?: number;
  delayMs?: number;
  /** 바뀔 때마다 연출을 다시 재생한다 (첫 마운트 포함) */
  playKey?: string | number;
  className?: string;
  children: ReactNode;
}) {
  const [x, y] = DIRECTION_VECTOR[from];
  const offset = distance === undefined ? "100%" : `${distance}px`;
  return (
    <div
      key={playKey}
      className={`fx-slide-in ${className}`}
      style={
        {
          "--fx-tx": `calc(${x} * ${offset})`,
          "--fx-ty": `calc(${y} * ${offset})`,
          "--fx-duration": `${durationMs}ms`,
          "--fx-delay": `${delayMs}ms`,
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}
