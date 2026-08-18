"use client";

import { useLayoutEffect, useState, type ReactNode } from "react";

/** 무대 둘레에 남길 여백(px) — 상하좌우 각각. 팝업은 이만큼만 빼고 화면을 채운다 */
const SCREEN_PADDING = 10;

/** 화면을 재기 전(서버 렌더·첫 렌더)에 쓸 크기 — 곧바로 실제 화면 크기로 바뀐다 */
const FALLBACK_STAGE = { w: 1366, h: 1024 };

/**
 * 미션 화면의 시안 캔버스.
 *
 * 무대는 **화면 전체에서 둘레 여백(SCREEN_PADDING)만 뺀 크기**로 선다. 안쪽에서는
 * 시안 좌표를 px 그대로 쓰면 되고, 이 감싸개가 그 좌표계를 무대에 맞춰 늘린다 —
 * 없으면 미션마다 좌표를 다시 환산해야 한다.
 *
 * ⚠️ 가로세로비는 **지키지 않는다.** 축마다 배율이 따로라 화면 비율이 시안(4:3)과
 *    다르면 그림이 그만큼 늘어난다 (16:9 화면이면 가로로 33%). 좌우에 띠를 남기지
 *    않고 꽉 채우기로 한 결정이다 (2026-08-18). 비율을 지켜야 하면 두 배율 중 작은
 *    쪽을 골라 양쪽에 쓰면 된다 — 대신 화면 일부가 빈 띠로 남는다.
 */
export function MissionCanvas({
  design,
  className = "",
  children,
}: {
  /** 안쪽 좌표계 — 시안 크기. 미션1 은 1092×820, 미션2·마무리는 1366×1024 */
  design: { w: number; h: number };
  /** 바깥 상자에 얹을 클래스 (모서리 둥글기 등) */
  className?: string;
  children: ReactNode;
}) {
  const stage = useStageSize();

  return (
    <div
      style={{ width: stage.w, height: stage.h }}
      className={`relative overflow-hidden ${className}`}
    >
      <div
        style={{
          width: design.w,
          height: design.h,
          transform: `scale(${stage.w / design.w}, ${stage.h / design.h})`,
          transformOrigin: "top left",
        }}
        className="relative"
      >
        {children}
      </div>
    </div>
  );
}

/** 화면에서 둘레 여백만 뺀 크기 — 무대가 이만큼을 차지한다 */
function useStageSize() {
  const [stage, setStage] = useState(FALLBACK_STAGE);

  useLayoutEffect(() => {
    const fit = () =>
      setStage({
        /* 창이 여백보다도 좁은 극단은 0·음수가 되지 않게 막는다 */
        w: Math.max(1, window.innerWidth - SCREEN_PADDING * 2),
        h: Math.max(1, window.innerHeight - SCREEN_PADDING * 2),
      });
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  return stage;
}
