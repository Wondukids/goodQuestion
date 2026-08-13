"use client";

import { useCallback, useState } from "react";
import { SEQUENCE, type Step } from "./data";

/**
 * 이야기 시퀀스 제어기 — 재생 진행을 이 파일 하나에서 전부 관리한다.
 *
 * - 순서 "정의"(어떤 파트·씬이 어떤 차례로 나오는지)는 data.ts 의 SEQUENCE.
 *   순서를 바꾸고 싶으면 그 배열을 고치면 된다.
 * - 진행 "제어"(시작·다음·이전·특정 씬 점프·다시 보기·책 넘김 여부)는 이 훅.
 *   화면(play.tsx)은 여기서 주는 상태를 그리고 이벤트에 컨트롤을 연결만 한다.
 */

export type StorySequencer = {
  /** 스텝 목록 — 진행 점 UI 등에 그대로 쓴다 */
  steps: Step[];
  /** "이야기 시작"을 눌렀는지 — 소리 있는 자동재생 허용을 위한 사용자 제스처 */
  started: boolean;
  /** 현재 스텝 번호(0부터). 끝났으면 steps.length */
  stepIndex: number;
  /** 현재 스텝 — 끝났으면 null */
  step: Step | null;
  /** 마지막 스텝까지 지나 이야기가 끝났는지 */
  finished: boolean;
  /** 이번 전환에 책 넘김 연출을 쓸지 — 대화 씬을 거치는 전환은 넘기지 않는다 */
  turning: boolean;
  /** 첫 화면에서 이야기 시작 */
  start: () => void;
  /** 다음 스텝으로 (영상 종료·씬 완료·건너뛰기) */
  next: () => void;
  /** 이전 스텝으로 — 첫 스텝이면 그대로 */
  previous: () => void;
  /** 특정 스텝으로 점프 — 번호(0부터) 또는 id("part2", "scene7"). 범위 밖이면 무시 */
  goTo: (target: number | string) => void;
  /** 처음부터 다시 보기 */
  restart: () => void;
};

export function useStorySequencer(steps: Step[] = SEQUENCE): StorySequencer {
  const [started, setStarted] = useState(false);
  /* cameFrom: 직전에 보고 있던 스텝 번호 — 책 넘김 여부 판단용.
     null 은 처음 시작·다시 보기로 들어온 경우다. */
  const [position, setPosition] = useState<{
    index: number;
    cameFrom: number | null;
  }>({ index: 0, cameFrom: null });

  const { index, cameFrom } = position;
  const finished = index >= steps.length;
  const step = finished ? null : steps[index];

  /* 대화 씬은 이야기 흐름이 끊기지 않도록 진입·이탈 모두 넘김 없이 바로 전환.
     책 넘김은 대화를 거치지 않고 영상으로 들어갈 때만 — 시작·다시 보기 포함. */
  const cameFromStep = cameFrom === null ? null : steps[cameFrom];
  const turning = step?.kind === "video" && cameFromStep?.kind !== "interactive";

  const start = useCallback(() => setStarted(true), []);

  const next = useCallback(
    () =>
      setPosition((p) => ({
        index: Math.min(p.index + 1, steps.length),
        cameFrom: p.index,
      })),
    [steps.length],
  );

  const previous = useCallback(
    () =>
      setPosition((p) => ({
        index: Math.max(p.index - 1, 0),
        cameFrom: p.index,
      })),
    [],
  );

  const goTo = useCallback(
    (target: number | string) => {
      const targetIndex =
        typeof target === "number"
          ? target
          : steps.findIndex((s) => s.id === target);
      if (targetIndex < 0 || targetIndex >= steps.length) return;
      setPosition((p) => ({ index: targetIndex, cameFrom: p.index }));
    },
    [steps],
  );

  const restart = useCallback(() => setPosition({ index: 0, cameFrom: null }), []);

  return {
    steps,
    started,
    stepIndex: index,
    step,
    finished,
    turning,
    start,
    next,
    previous,
    goTo,
    restart,
  };
}
