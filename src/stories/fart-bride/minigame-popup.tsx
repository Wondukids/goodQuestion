"use client";

import { Popup } from "@/frontendlib";
import { Mission1 } from "./minigame/mission1";
import { Mission2 } from "./minigame/mission2";

/**
 * 미니게임 팝업 — 재생 중인 이야기 위로 미션 화면을 띄운다.
 *
 * 미션끼리는 서로 남남이다 (시안 캔버스도 대화 패널도 다르다).
 * 여기서는 어느 미션을 띄울지만 고르고, 화면은 minigame/mission*.tsx 가 각자 그린다.
 *   1 — 배나무 아래 소품 고르기
 *   2 — 며느리 친구들의 고민 다시 보기
 * 미션을 끝내면 onComplete 로 알린다 — video-plan 의 after: "stt-minigame" 컷과
 * 이어질 자리다.
 */
export function MinigamePopup({
  open,
  mission,
  childName,
  onClose,
  onComplete,
}: {
  open: boolean;
  mission: 1 | 2;
  /** 선택된 아이 이름 — 미션2 에서 아이를 부를 때 쓴다 */
  childName: string | null;
  /** 배경 클릭·뒤로가기 — 미션을 접고 이야기로 돌아간다 */
  onClose: () => void;
  /** 미션 완료 */
  onComplete: () => void;
}) {
  return (
    <Popup open={open} onClose={onClose}>
      {mission === 1 ? (
        <Mission1 onComplete={onComplete} />
      ) : (
        <Mission2 childName={childName} onComplete={onComplete} onQuit={onClose} />
      )}
    </Popup>
  );
}
