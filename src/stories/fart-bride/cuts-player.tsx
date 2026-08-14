"use client";

import Image from "next/image";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
  type Ref,
} from "react";
import type { CutsStep } from "./data";
import { CameraLayer, EnterLayer, OverlayLayer } from "./cut-effect-layers";
import { assetUrl } from "./video-plan";

/**
 * 컷 묶음(CutsStep) 재생기 — mp4 파트 대신 video-plan.json 의 컷을
 * 이미지 + 녹음 음성 + 저장된 연출(등장·카메라·오버레이)로 재생한다.
 * /dev/video-maker 미리보기와 같은 연출 래퍼(cut-effect-layers)를 써서
 * 도우미에서 확인한 화면이 그대로 나온다.
 *
 * - 컷의 대사를 순서대로 재생하고, 다 끝나면 다음 컷으로.
 * - 대사 없는 컷은 HOLD_MS 만큼 보여 주고 넘어간다.
 * - 음성 파일이 없거나 깨져도 이야기가 멈추지 않게 다음 대사로 건너뛴다.
 * - 마지막 컷이 끝나면 onEnded — 시퀀서가 다음 스텝으로 넘긴다.
 */

/** 대사 없는 컷을 보여 주는 시간 */
const HOLD_MS = 3000;

export type CutsPlayerHandle = {
  /** 지금 컷 하나만 건너뛴다 — 마지막 컷이었으면 onEnded 로 이어진다 */
  skipCut: () => void;
};

export function CutsPlayer({
  step,
  onEnded,
  ref,
}: {
  step: CutsStep;
  onEnded: () => void;
  /** 건너뛰기 버튼(play.tsx)이 컷 단위로 넘길 수 있게 여는 핸들 */
  ref?: Ref<CutsPlayerHandle>;
}) {
  const [position, setPosition] = useState({ cut: 0, line: 0 });
  const cut = step.cuts[position.cut] ?? null;
  const line = cut?.lines[position.line] ?? null;

  useImperativeHandle(
    ref,
    () => ({
      skipCut: () => setPosition((p) => ({ cut: p.cut + 1, line: 0 })),
    }),
    [],
  );

  const advance = useCallback(() => {
    setPosition((p) => {
      const current = step.cuts[p.cut];
      if (current && p.line + 1 < current.lines.length)
        return { cut: p.cut, line: p.line + 1 };
      return { cut: p.cut + 1, line: 0 };
    });
  }, [step.cuts]);

  /* 컷을 다 지나면 스텝 종료 */
  useEffect(() => {
    if (!cut) onEnded();
  }, [cut, onEnded]);

  /* 대사 없는 컷 — 잠깐 보여 주고 자동으로 넘어간다 */
  useEffect(() => {
    if (!cut || cut.lines.length > 0) return;
    const timer = setTimeout(advance, HOLD_MS);
    return () => clearTimeout(timer);
  }, [cut, advance]);

  if (!cut) return null;

  return (
    <div className="relative h-full w-full bg-black">
      <div key={cut.id} className="absolute inset-0">
        <OverlayLayer effect={cut.effect.overlay ?? "none"} playKey={cut.id}>
          <EnterLayer effect={cut.effect.enter} playKey={cut.id}>
            <CameraLayer
              effect={cut.effect.camera}
              durationMs={Math.max(cut.durationSec, 4) * 1000}
              playKey={cut.id}
            >
              <div className="relative h-full w-full">
                {cut.image && (
                  <Image
                    src={assetUrl("image", cut.image)}
                    alt=""
                    fill
                    unoptimized
                    priority
                    className="object-contain"
                  />
                )}
              </div>
            </CameraLayer>
          </EnterLayer>
        </OverlayLayer>
      </div>

      {line && (
        <audio
          key={`${cut.id}:${position.line}`}
          src={assetUrl("sound", line.audio)}
          autoPlay
          onEnded={advance}
          onError={advance}
        />
      )}

      {line && line.text !== "" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center px-10">
          <p className="max-w-[900px] rounded-2xl bg-black/55 px-6 py-4 text-center text-[22px] font-bold leading-[1.5] text-white">
            {line.speaker !== "내레이션" && (
              <span className="mr-2 text-[18px] text-amber-300">{line.speaker}</span>
            )}
            {line.text}
          </p>
        </div>
      )}
    </div>
  );
}
