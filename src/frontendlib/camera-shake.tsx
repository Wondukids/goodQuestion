"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * 카메라 셰이크 — children 전체가 진폭이 줄어들며 흔들린다 (폭발·충격 연출).
 * playKey 가 바뀔 때마다 한 번 흔들리고(첫 마운트 포함), loop 면 계속 흔들린다.
 *
 * <CameraShake playKey={boomCount} intensity={12}>...</CameraShake>
 */
export function CameraShake({
  intensity = 8,
  durationMs = 500,
  loop = false,
  playKey = 0,
  className = "",
  children,
}: {
  /** 흔들림 진폭(px) */
  intensity?: number;
  durationMs?: number;
  /** true 면 감쇠 패턴을 반복하며 계속 흔들린다 (지진·긴장 연출) */
  loop?: boolean;
  /** 바뀔 때마다 연출을 다시 재생한다 (첫 마운트 포함) */
  playKey?: string | number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      key={playKey}
      className={`fx-shake ${className}`}
      style={
        {
          "--fx-shake": `${intensity}px`,
          "--fx-duration": `${durationMs}ms`,
          "--fx-repeat": loop ? "infinite" : 1,
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}
