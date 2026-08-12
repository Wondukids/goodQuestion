import type { ComponentType } from "react";
import FartBridePlay from "./fart-bride/play";

/**
 * 이야기 id → 재생 화면 컴포넌트.
 *
 * 이야기 하나 = 폴더 하나(src/stories/<id>/). 담당자는 자기 폴더 안에서만 작업하고,
 * 폴더 밖에서 건드리는 건 아래 한 줄이 전부다. 그래서 담당자끼리 충돌하지 않는다.
 *
 * 여기의 id 는 URL 의 [id] 이자 mock-data 의 이야기 id 와 같은 값이어야 한다
 * (/stories/fart-bride/play → "fart-bride"). 유저 id 와는 무관하다.
 */
/** 모든 재생 화면이 공통으로 받는 props — 라우트가 채워서 넘긴다. */
export type PlayScreenProps = {
  /** 선택된 아이 이름 — 대화 씬에서 아이를 부를 때 쓴다. 없으면 부르지 않는다. */
  childName: string | null;
};

const PLAY_SCREENS: Record<string, ComponentType<PlayScreenProps>> = {
  "fart-bride": FartBridePlay,
};

/** 아직 재생 화면이 없는 이야기면 null — 라우트가 404 로 떨어뜨린다. */
export function getPlayScreen(id: string): ComponentType<PlayScreenProps> | null {
  return PLAY_SCREENS[id] ?? null;
}
