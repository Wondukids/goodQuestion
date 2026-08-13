"use client";

import type { ReactNode } from "react";

/**
 * 파워포인트 화면 전환에서 따온 슬라이드 전환 효과.
 * transitionKey 가 바뀔 때마다 children 을 새로 그리며 전환 애니메이션을 재생한다.
 *
 * key 교체 방식이라 이전 슬라이드는 즉시 사라진다 — 이전 슬라이드가 함께
 * 움직여야 완성되는 효과(밀어내기 등)는 "새 슬라이드가 들어오는" 절반만 재현.
 * 애니메이션 정의는 globals.css 의 slide-* 블록에 있다.
 */

export type SlideTransitionEffect =
  | "none" // 없음 — 즉시 전환
  | "fade" // 밝기 변화
  | "push" // 밀어내기 — 오른쪽에서 밀려 들어옴
  | "wipe" // 닦아내기 — 왼쪽부터 닦아내듯 드러남
  | "zoom" // 확대/축소 — 작게 시작해 커지며 나타남
  | "flip"; // 넘기기 — 세로축 기준으로 펼쳐짐

export function SlideTransition({
  effect,
  transitionKey,
  className = "",
  children,
}: {
  effect: SlideTransitionEffect;
  /** 슬라이드 식별값 — 바뀔 때마다 전환이 재생된다 (첫 마운트 포함) */
  transitionKey: string | number;
  /** 바깥 래퍼에 얹을 클래스 — 배경으로 쓸 때 "absolute inset-0" 등 */
  className?: string;
  children: ReactNode;
}) {
  return (
    /* flip 의 입체감용 perspective — 다른 효과에는 영향이 없다 */
    <div className={`[perspective:2000px] ${className}`}>
      <div
        key={transitionKey}
        className={`relative h-full w-full ${effect === "none" ? "" : `slide-${effect}`}`}
      >
        {children}
      </div>
    </div>
  );
}
