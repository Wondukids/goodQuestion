"use client";

import type { ReactNode } from "react";
import {
  CameraPan,
  CameraShake,
  ChromaticAberration,
  DutchAngle,
  Flash,
  Glitch,
  KenBurns,
  Letterbox,
  Orbit,
  Punch,
  PunchZoom,
  RandomBars,
  Reveal,
  SlideIn,
  Vignette,
  ZoomIn,
  ZoomOut,
} from "@/frontendlib";
import type { CameraEffect, EnterEffect, OverlayEffect } from "./video-plan";

/**
 * video-plan 의 연출 이름 → frontendlib 컴포넌트 래퍼 3종.
 *
 * 컷 미리보기(/dev/video-maker)와 실제 재생 화면(cuts-player)이 같은
 * 매핑을 쓴다 — 도우미에서 확인한 연출이 재생에서 그대로 나오게 하기 위해서다.
 * playKey 가 바뀔 때마다 연출을 다시 재생한다.
 */

/** 컷이 떠 있는 동안의 카메라 연출 래퍼 */
export function CameraLayer({
  effect,
  durationMs,
  playKey,
  children,
}: {
  effect: CameraEffect;
  durationMs: number;
  playKey: string;
  children: ReactNode;
}) {
  switch (effect) {
    case "zoom-in":
      return (
        <ZoomIn durationMs={durationMs} playKey={playKey} className="h-full w-full">
          {children}
        </ZoomIn>
      );
    case "zoom-out":
      return (
        <ZoomOut durationMs={durationMs} playKey={playKey} className="h-full w-full">
          {children}
        </ZoomOut>
      );
    case "punch-zoom":
      return (
        <PunchZoom playKey={playKey} className="h-full w-full">
          {children}
        </PunchZoom>
      );
    case "ken-burns-left":
    case "ken-burns-right":
      return (
        <KenBurns
          direction={effect === "ken-burns-left" ? "left" : "right"}
          durationMs={durationMs}
          playKey={playKey}
          className="h-full w-full"
        >
          {children}
        </KenBurns>
      );
    case "pan-left":
    case "pan-right":
    case "tilt-up":
    case "tilt-down":
      return (
        <CameraPan
          direction={
            effect === "pan-left"
              ? "left"
              : effect === "pan-right"
                ? "right"
                : effect === "tilt-up"
                  ? "up"
                  : "down"
          }
          durationMs={durationMs}
          playKey={playKey}
          className="h-full w-full"
        >
          {children}
        </CameraPan>
      );
    case "orbit":
      return (
        <Orbit durationMs={durationMs} playKey={playKey} className="h-full w-full">
          {children}
        </Orbit>
      );
    case "dutch":
      return (
        <DutchAngle playKey={playKey} className="h-full w-full">
          {children}
        </DutchAngle>
      );
    case "shake":
      return (
        <CameraShake playKey={playKey} intensity={10} durationMs={600} className="h-full w-full">
          {children}
        </CameraShake>
      );
    case "shake-loop":
      return (
        <CameraShake loop playKey={playKey} intensity={6} durationMs={900} className="h-full w-full">
          {children}
        </CameraShake>
      );
    case "punch":
      return (
        <Punch playKey={playKey} className="h-full w-full">
          {children}
        </Punch>
      );
    case "glitch":
      return (
        <Glitch playKey={playKey} className="h-full w-full">
          {children}
        </Glitch>
      );
    case "chromatic":
      return (
        <ChromaticAberration playKey={playKey} className="h-full w-full">
          {children}
        </ChromaticAberration>
      );
    default:
      return <div className="h-full w-full">{children}</div>;
  }
}

/** 컷 등장 전환 래퍼 — playKey 가 바뀔 때마다 다시 재생 */
export function EnterLayer({
  effect,
  playKey,
  children,
}: {
  effect: EnterEffect;
  playKey: string;
  children: ReactNode;
}) {
  switch (effect) {
    case "slide-left":
    case "slide-right":
    case "slide-up":
    case "slide-down":
      return (
        <SlideIn
          from={
            effect === "slide-left"
              ? "left"
              : effect === "slide-right"
                ? "right"
                : effect === "slide-up"
                  ? "up"
                  : "down"
          }
          playKey={playKey}
          className="h-full w-full"
        >
          {children}
        </SlideIn>
      );
    case "wipe-left":
    case "wipe-right":
    case "wipe-up":
    case "wipe-down":
      return (
        <Reveal
          variant="wipe"
          direction={
            effect === "wipe-left"
              ? "left"
              : effect === "wipe-right"
                ? "right"
                : effect === "wipe-up"
                  ? "up"
                  : "down"
          }
          playKey={playKey}
          className="h-full w-full"
        >
          {children}
        </Reveal>
      );
    case "random-bars":
      return (
        <RandomBars playKey={playKey} className="h-full w-full">
          {children}
        </RandomBars>
      );
    case "none":
      return <div className="h-full w-full">{children}</div>;
    default:
      /* 나머지는 이름만 Reveal variant 로 바꿔 그대로 재생한다 */
      return (
        <Reveal
          variant={
            effect === "wipe-diagonal"
              ? "wipe-diagonal"
              : effect === "checkerboard"
                ? "checker"
                : effect === "flip"
                  ? "flip-y"
                  : effect === "flip-vertical"
                    ? "flip-x"
                    : effect
          }
          playKey={playKey}
          className="h-full w-full"
        >
          {children}
        </Reveal>
      );
  }
}

/** 컷 위에 겹치는 화면 오버레이 래퍼 — 카메라·등장과 독립으로 얹는다 */
export function OverlayLayer({
  effect,
  playKey,
  children,
}: {
  effect: OverlayEffect;
  playKey: string;
  children: ReactNode;
}) {
  switch (effect) {
    case "letterbox":
      return (
        <Letterbox playKey={playKey} className="h-full w-full">
          {children}
        </Letterbox>
      );
    case "vignette":
      return (
        <Vignette playKey={playKey} className="h-full w-full">
          {children}
        </Vignette>
      );
    case "vignette-red":
      return (
        <Vignette color="rgba(190, 30, 30, 0.5)" playKey={playKey} className="h-full w-full">
          {children}
        </Vignette>
      );
    case "vignette-pulse":
      return (
        <Vignette pulse playKey={playKey} className="h-full w-full">
          {children}
        </Vignette>
      );
    case "flash":
      return (
        <Flash playKey={playKey} className="h-full w-full">
          {children}
        </Flash>
      );
    default:
      return <div className="h-full w-full">{children}</div>;
  }
}
