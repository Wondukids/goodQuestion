"use client";

import type { ComponentPropsWithoutRef, CSSProperties } from "react";
import { DIRECTION_CLIP, DIRECTION_VECTOR, type Direction } from "./shared";

/**
 * 방향에 따라 동영상을 보여주는 연출 — 지정한 방향에서 영상이 등장한다.
 *  - effect "slide": 화면 밖에서 밀려 들어온다 (래퍼가 overflow-hidden 으로 자른다)
 *  - effect "wipe": 제자리에서 그 방향 가장자리부터 닦아내듯 드러난다
 * 들어오는 동안에도 영상은 재생 중이다. <video> 속성(src, muted, onEnded 등)은
 * 그대로 전달된다.
 *
 * <DirectionalVideo src="/....mp4" from="left" effect="wipe"
 *   wrapperClassName="h-full w-full" className="h-full w-full object-contain" onEnded={next} />
 */
export function DirectionalVideo({
  from = "right",
  effect = "slide",
  durationMs = 700,
  playKey = 0,
  wrapperClassName = "",
  className = "",
  autoPlay = true,
  playsInline = true,
  ...videoProps
}: {
  /** 들어오는 방향 */
  from?: Direction;
  effect?: "slide" | "wipe";
  /** 등장 연출 길이 (영상 재생 길이와 무관) */
  durationMs?: number;
  /** 바뀔 때마다 연출을 다시 재생한다 (첫 마운트 포함) */
  playKey?: string | number;
  /** 바깥 래퍼 클래스 — 크기·배치를 여기서 지정 */
  wrapperClassName?: string;
} & ComponentPropsWithoutRef<"video">) {
  const [x, y] = DIRECTION_VECTOR[from];
  const style =
    effect === "slide"
      ? {
          "--fx-tx": `calc(${x} * 100%)`,
          "--fx-ty": `calc(${y} * 100%)`,
          "--fx-duration": `${durationMs}ms`,
        }
      : {
          "--fx-clip": DIRECTION_CLIP[from],
          "--fx-duration": `${durationMs}ms`,
        };
  return (
    <div className={`overflow-hidden ${wrapperClassName}`}>
      <video
        key={playKey}
        className={`${effect === "slide" ? "fx-slide-in" : "fx-wipe-in"} ${className}`}
        style={style as CSSProperties}
        autoPlay={autoPlay}
        playsInline={playsInline}
        {...videoProps}
      />
    </div>
  );
}
