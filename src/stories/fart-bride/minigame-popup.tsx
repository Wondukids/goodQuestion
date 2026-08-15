"use client";

import { Popup } from "@/frontendlib";
import { Finale } from "./minigame/finale";
import { Mission1 } from "./minigame/mission1";
import { Mission2 } from "./minigame/mission2";
import type { MissionApi, MissionCompleteResult, MissionConfig } from "./session-api";

/**
 * 미니게임 팝업 — 재생 중인 이야기 위로 활동 화면을 띄운다.
 *
 * 활동끼리는 서로 남남이다 (시안 캔버스도 대화 패널도 다르다).
 * 여기서는 무엇을 띄울지만 고르고, 화면은 minigame/ 아래에서 각자 그린다.
 *   1 — 미션1, 배나무 아래 소품 고르기
 *   2 — 미션2, 며느리 친구들의 고민 다시 보기
 *   3 — 마무리, 이야기 순서 맞추고 줄거리 들려주기 (말하기 후 활동)
 *
 * 미션 1·2 는 미션 세션 배선 넷(sessionId·missionSessionId·config·missionApi)을
 * 그대로 흘려보낸다 (이슈 #20 · 미션 명세 10절 ②). 끝나면 onComplete 에 complete
 * 응답을 실어 알린다 — 재생 화면은 그걸로 종료 요약을 패널에서 재생하고 분기한다.
 */
export function MinigamePopup({
  open,
  mission,
  childName,
  sessionId,
  missionSessionId,
  config,
  missionApi,
  onClose,
  onComplete,
}: {
  open: boolean;
  mission: 1 | 2 | 3;
  /** 선택된 아이 이름 — 미션2 에서 아이를 부를 때 쓴다 */
  childName: string | null;
  /** 미션 세션 배선 — 미션 1·2 는 셋 다 있어야 뜬다. 마무리(3)는 안 쓴다 */
  sessionId: string | null;
  missionSessionId: string | null;
  config: MissionConfig | null;
  /** 실구현(REAL_MISSION_API) 또는 /dev/minigame 의 목 어댑터 */
  missionApi: MissionApi;
  /** 배경 클릭·뒤로가기 — 미션을 접고 이야기로 돌아간다 (시도는 abandoned, M4) */
  onClose: () => void;
  /** 미션 완료 — complete 응답. null 이면 서버 결과 없이 끝난 것(complete 실패 등) */
  onComplete: (result: MissionCompleteResult | null) => void;
}) {
  const wiring =
    sessionId !== null && missionSessionId !== null && config !== null
      ? { sessionId, missionSessionId, config, missionApi }
      : null;

  return (
    <Popup open={open} onClose={onClose}>
      {mission === 1 && wiring ? (
        <Mission1 {...wiring} onComplete={onComplete} />
      ) : mission === 2 && wiring ? (
        <Mission2
          childName={childName}
          {...wiring}
          onComplete={onComplete}
          onQuit={onClose}
        />
      ) : mission === 3 ? (
        <Finale
          childName={childName}
          onComplete={() => onComplete(null)}
          onQuit={onClose}
        />
      ) : null}
    </Popup>
  );
}
