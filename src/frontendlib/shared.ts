/** 연출이 들어오는 방향 — 화면의 어느 쪽에서 시작하는지 */
export type Direction = "left" | "right" | "up" | "down";

/** direction → translate 부호 (x, y). 그 방향 밖에서 제자리로 들어온다. */
export const DIRECTION_VECTOR: Record<Direction, readonly [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

/** direction → 와이프 시작 clip-path — 그 방향 가장자리부터 드러난다 */
export const DIRECTION_CLIP: Record<Direction, string> = {
  left: "inset(0 100% 0 0)",
  right: "inset(0 0 0 100%)",
  up: "inset(0 0 100% 0)",
  down: "inset(100% 0 0 0)",
};
