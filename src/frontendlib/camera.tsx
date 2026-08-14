"use client";

import type { CSSProperties, ReactNode } from "react";
import { DIRECTION_VECTOR, type Direction } from "./shared";

/**
 * 카메라 이동 연출 — 컷이 떠 있는 동안 화면을 훑거나 치는 효과 모음.
 * 모두 바깥 래퍼가 overflow-hidden 으로 잘라 주므로 확대·이동해도 넘치지 않고,
 * playKey 가 바뀔 때마다 다시 재생한다 (첫 마운트 포함).
 */

type CameraProps = {
  durationMs?: number;
  /** 바뀔 때마다 연출을 다시 재생한다 (첫 마운트 포함) */
  playKey?: string | number;
  className?: string;
  children: ReactNode;
};

function Clipped({
  fx,
  vars,
  playKey = 0,
  className = "",
  children,
}: {
  fx: string;
  vars: Record<string, string | number>;
  playKey?: string | number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`overflow-hidden ${className}`}>
      <div key={playKey} className={`${fx} h-full w-full`} style={vars as CSSProperties}>
        {children}
      </div>
    </div>
  );
}

/** 펀치 줌 — 순간 확 다가갔다가 원래대로 (타격·놀람) */
export function PunchZoom({
  scale = 1.18,
  origin = "center",
  durationMs = 400,
  ...props
}: CameraProps & { scale?: number; origin?: string }) {
  return (
    <Clipped
      fx="fx-punch-zoom"
      vars={{ "--fx-punch-scale": scale, "--fx-origin": origin, "--fx-duration": `${durationMs}ms` }}
      {...props}
    />
  );
}

/** 펀치 — 지정 방향으로 확 밀렸다가 복귀 (셰이크와 달리 방향이 있는 충격) */
export function Punch({
  from = "right",
  distance = 14,
  durationMs = 400,
  ...props
}: CameraProps & { from?: Direction; distance?: number }) {
  const [x, y] = DIRECTION_VECTOR[from];
  return (
    <Clipped
      fx="fx-punch"
      vars={{
        "--fx-tx": `${x * distance}px`,
        "--fx-ty": `${y * distance}px`,
        "--fx-duration": `${durationMs}ms`,
      }}
      {...props}
    />
  );
}

/** 팬·틸트 — 살짝 확대한 채 카메라가 지정 방향으로 천천히 훑는다.
 *  direction 은 카메라 이동 방향 (left/right = 팬, up/down = 틸트). */
export function CameraPan({
  direction = "right",
  driftPct = 3,
  zoom = 1.12,
  durationMs = 8000,
  ...props
}: CameraProps & { direction?: Direction; driftPct?: number; zoom?: number }) {
  /* 카메라가 가는 방향의 반대로 그림이 움직인다 */
  const [x, y] = DIRECTION_VECTOR[direction];
  return (
    <Clipped
      fx="fx-pan"
      vars={{
        "--fx-pan-scale": zoom,
        "--fx-from-x": `${x * driftPct}%`,
        "--fx-from-y": `${y * driftPct}%`,
        "--fx-to-x": `${-x * driftPct}%`,
        "--fx-to-y": `${-y * driftPct}%`,
        "--fx-duration": `${durationMs}ms`,
      }}
      {...props}
    />
  );
}

/** 켄 번즈 — 천천히 확대하며 동시에 훑는다 (사진을 영상처럼 보이게) */
export function KenBurns({
  direction = "left",
  driftPct = 3,
  zoomFrom = 1.1,
  zoomTo = 1.25,
  durationMs = 8000,
  ...props
}: CameraProps & {
  direction?: Direction;
  driftPct?: number;
  zoomFrom?: number;
  zoomTo?: number;
}) {
  const [x, y] = DIRECTION_VECTOR[direction];
  return (
    <Clipped
      fx="fx-ken-burns"
      vars={{
        "--fx-scale-from": zoomFrom,
        "--fx-scale-to": zoomTo,
        "--fx-from-x": `${x * driftPct}%`,
        "--fx-from-y": `${y * driftPct}%`,
        "--fx-to-x": `${-x * driftPct}%`,
        "--fx-to-y": `${-y * driftPct}%`,
        "--fx-duration": `${durationMs}ms`,
      }}
      {...props}
    />
  );
}

/** 오빗 — 살짝 확대한 채 원을 그리며 천천히 돈다 (대상 주위 궤도 흉내) */
export function Orbit({
  radiusPct = 2,
  zoom = 1.15,
  durationMs = 8000,
  loop = true,
  ...props
}: CameraProps & { radiusPct?: number; zoom?: number; loop?: boolean }) {
  return (
    <Clipped
      fx="fx-orbit"
      vars={{
        "--fx-orbit-r": `${radiusPct}%`,
        "--fx-orbit-scale": zoom,
        "--fx-duration": `${durationMs}ms`,
        "--fx-repeat": loop ? "infinite" : 1,
      }}
      {...props}
    />
  );
}

/** 더치 앵글 — 비스듬히 기울어져 불안감을 준다. 확대로 모서리를 가린다 */
export function DutchAngle({
  angle = -6,
  zoom = 1.2,
  durationMs = 700,
  ...props
}: CameraProps & { angle?: number; zoom?: number }) {
  return (
    <Clipped
      fx="fx-dutch"
      vars={{
        "--fx-angle": `${angle}deg`,
        "--fx-dutch-scale": zoom,
        "--fx-duration": `${durationMs}ms`,
      }}
      {...props}
    />
  );
}
