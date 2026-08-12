import type { ComponentType } from "react";
import FartBridePlay from "./fart-bride/play";

/**
 * 이야기 id → 재생 화면 컴포넌트.
 *
 * 이야기 하나 = 폴더 하나(src/stories/<id>/). 담당자는 자기 폴더 안에서만 작업하고,
 * 폴더 밖에서 건드리는 건 아래 한 줄이 전부다. 그래서 담당자끼리 충돌하지 않는다.
 *
 * 여기의 id 는 URL 의 [id] 이자 stories 테이블의 slug 와 같은 값이어야 한다
 * (/stories/fart-bride/play → "fart-bride"). 유저 id 와는 무관하다.
 */
const PLAY_SCREENS: Record<string, ComponentType> = {
  "fart-bride": FartBridePlay,
};

/** 아직 재생 화면이 없는 이야기면 null — 라우트가 404 로 떨어뜨린다. */
export function getPlayScreen(id: string): ComponentType | null {
  return PLAY_SCREENS[id] ?? null;
}
