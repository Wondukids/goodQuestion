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
import { comitative } from "./name";
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
 * - 단, 다음 스텝이 대화 씬이면(nextDialogue) 자동으로 안 넘어간다 — 마지막
 *   컷 위에 「◯◯와의 대화 시작!」 버튼을 세우고 아이가 누르길 기다린다.
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
  startCut,
  nextDialogue,
  ref,
}: {
  step: CutsStep;
  onEnded: () => void;
  /**
   * 재생을 시작할 컷 번호(0부터) — 세션 재개(play.tsx)가 직전 컷 묶음의
   * 마지막 컷만 틀 때 쓴다. 첫 렌더에서만 읽고, 범위 밖 값은 안전하게 잘라낸다.
   */
  startCut?: number;
  /** 바로 다음 스텝이 대화 씬이면 그 화자 — 마지막 컷을 다 튼 뒤 자동으로
      넘어가지 않고 「대화 시작」 버튼을 세운다. 버튼을 누르면 onEnded. */
  nextDialogue?: { speaker: string } | null;
  /** 건너뛰기 버튼(play.tsx)이 컷 단위로 넘길 수 있게 여는 핸들 */
  ref?: Ref<CutsPlayerHandle>;
}) {
  const [position, setPosition] = useState(() => ({
    /* 빈 묶음이면 min 이 -1 이 되니 max 로 0 을 보장한다 */
    cut: Math.max(0, Math.min(startCut ?? 0, step.cuts.length - 1)),
    line: 0,
  }));
  /* 마지막 컷까지 다 틀고 대화 시작 버튼을 세워 둔 상태 */
  const [waiting, setWaiting] = useState(false);
  const cut = step.cuts[position.cut] ?? null;
  const line = cut?.lines[position.line] ?? null;
  const isLastCut = position.cut === step.cuts.length - 1;

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

  /* 마지막 대사가 끝났다 — 다음이 대화 씬이면 넘어가지 않고 버튼을 세운다.
     마지막 컷을 화면에 그대로 둬야 해서 position 을 끝 너머로 밀지 않는다 */
  const lineEnded = () => {
    if (nextDialogue && isLastCut && cut && position.line === cut.lines.length - 1) {
      setWaiting(true);
      return;
    }
    advance();
  };

  /* 컷을 다 지나면 스텝 종료 */
  useEffect(() => {
    if (!cut) onEnded();
  }, [cut, onEnded]);

  /* 대사 없는 컷 — 잠깐 보여 주고 자동으로 넘어간다.
     대사 없는 마지막 컷 앞에 대화 씬이 기다리면 곧바로 버튼을 세운다 */
  useEffect(() => {
    if (!cut || cut.lines.length > 0) return;
    if (nextDialogue && isLastCut) {
      setWaiting(true);
      return;
    }
    const timer = setTimeout(advance, HOLD_MS);
    return () => clearTimeout(timer);
  }, [cut, advance, nextDialogue, isLastCut]);

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
              <div className="relative h-full w-full overflow-hidden">
                {cut.image && (
                  <Image
                    src={assetUrl("image", cut.image)}
                    alt=""
                    fill
                    unoptimized
                    priority
                    /* 전체 화면을 채우고(cover), 카메라 연출이 없는 컷은
                       홀짝을 번갈아 천천히 흐른다 — 저장된 연출과는 안 겹친다 */
                    className={`object-cover ${
                      cut.effect.camera === "none"
                        ? position.cut % 2 === 0
                          ? "cut-drift-a"
                          : "cut-drift-b"
                        : ""
                    }`}
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
          onEnded={lineEnded}
          onError={lineEnded}
        />
      )}

      {/* 자막 — 시안처럼 화면 가로를 채우는 밝은 바에 왼쪽 정렬.
          대화 시작 버튼이 서 있으면 글이 버튼 밑으로 들어가지 않게 오른쪽을 비운다 */}
      {line && line.text !== "" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-6 px-6">
          <p
            className={`flex min-h-[80px] items-center rounded-2xl bg-white/95 py-4 pl-8 text-[22px] font-bold leading-[1.5] text-ink shadow-panel ${
              waiting && nextDialogue ? "pr-32" : "pr-8"
            }`}
          >
            {line.speaker !== "내레이션" && (
              <span className="mr-2 shrink-0 text-[18px] font-extrabold text-primary-strong">
                {line.speaker}
              </span>
            )}
            {line.text}
          </p>
        </div>
      )}

      {/* 다음 대화 씬으로 들어가는 버튼 — 자막 바의 오른쪽 끝에 겹쳐 앉고
          (bottom-6 + 바 최소 높이 80px = 버튼 지름), 화자 이름 배지는 바 위로 뜬다 */}
      {waiting && nextDialogue && (
        <div className="absolute bottom-6 right-10 flex flex-col items-end gap-1.5">
          <span className="rounded-lg bg-brand-900 px-3 py-1.5 text-[14px] font-extrabold text-white shadow-panel">
            {nextDialogue.speaker}
            {comitative(nextDialogue.speaker)}의 대화 시작!
          </span>
          <button
            type="button"
            onClick={onEnded}
            aria-label={`${nextDialogue.speaker}${comitative(nextDialogue.speaker)}의 대화 시작`}
            className="flex size-20 items-center justify-center rounded-full bg-primary/30"
          >
            <span className="flex size-16 items-center justify-center rounded-full bg-primary shadow-panel">
              <Image
                src="/figma/icons/arrow-left.svg"
                alt=""
                width={32}
                height={32}
                className="rotate-180 brightness-0 invert"
              />
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
