"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";

/**
 * 미션 화면의 시안 캔버스.
 *
 * 미션마다 시안 크기가 달라서 캔버스를 통째로 줄여 화면에 맞춘다. 안쪽에서는
 * 시안 좌표를 px 그대로 쓰면 된다 — 이 감싸개가 없으면 미션마다 좌표를 다시
 * 환산해야 한다.
 *
 * `design` 을 주면 **무대와 좌표계를 따로** 둔다. 미션1 이 그 경우다: 시안은
 * 1092×820 인데 무대는 미션2·마무리와 같은 1366×1024 로 선다. 좌표를 한 줄도
 * 안 고치고 무대만 갈아 끼우는 길이다 — 손으로 환산하면 스무 곳 남짓을 곱해야
 * 하고, 그 반올림이 그대로 어긋남으로 남는다.
 */
export function MissionCanvas({
  width,
  height,
  design,
  className = "",
  children,
}: {
  /** 무대 크기 — 화면에서 이만큼을 차지한다 */
  width: number;
  height: number;
  /** 안쪽 좌표계. 없으면 무대와 같다 (미션2·마무리) */
  design?: { w: number; h: number };
  /** 바깥 상자에 얹을 클래스 (모서리 둥글기 등) */
  className?: string;
  children: ReactNode;
}) {
  const scale = useFitScale(width, height);
  const inner = design ?? { w: width, h: height };

  /* 좌표계를 무대에 채운다. 미션1 은 가로세로비가 0.17% 어긋나(1.3317 대 1.3340)
     축마다 배율이 아주 조금 다르다 — 1366 폭에서 2px 남짓이라 눈에 안 잡히고,
     대신 무대 오른쪽에 빈 띠가 남지 않는다. design 이 없으면 둘 다 scale 이다. */
  const scaleX = (scale * width) / inner.w;
  const scaleY = (scale * height) / inner.h;

  return (
    <div
      style={{ width: width * scale, height: height * scale }}
      className={`relative overflow-hidden ${className}`}
    >
      <div
        style={{
          width: inner.w,
          height: inner.h,
          transform: `scale(${scaleX}, ${scaleY})`,
          transformOrigin: "top left",
        }}
        className="relative"
      >
        {children}
      </div>
    </div>
  );
}

/** 화면(여백 48px 제외)에 들어가는 배율. 시안보다 키우지는 않는다. */
function useFitScale(width: number, height: number) {
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const fit = () =>
      setScale(
        Math.min(
          1,
          (window.innerWidth - 48) / width,
          (window.innerHeight - 48) / height,
        ),
      );
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [width, height]);

  return scale;
}
