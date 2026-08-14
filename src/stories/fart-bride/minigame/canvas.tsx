"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";

/**
 * 미션 화면의 시안 캔버스.
 *
 * 미션마다 시안 크기가 달라서(미션1 1092×820, 미션2 1366×1024) 캔버스를
 * 통째로 줄여 화면에 맞춘다. 안쪽에서는 시안 좌표를 px 그대로 쓰면 된다 —
 * 이 감싸개가 없으면 미션마다 좌표를 다시 환산해야 한다.
 */
export function MissionCanvas({
  width,
  height,
  className = "",
  children,
}: {
  width: number;
  height: number;
  /** 바깥 상자에 얹을 클래스 (모서리 둥글기 등) */
  className?: string;
  children: ReactNode;
}) {
  const scale = useFitScale(width, height);

  return (
    <div
      style={{ width: width * scale, height: height * scale }}
      className={`relative overflow-hidden ${className}`}
    >
      <div
        style={{
          width,
          height,
          transform: `scale(${scale})`,
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
