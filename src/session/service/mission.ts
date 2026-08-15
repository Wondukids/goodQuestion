// 미션 API 셋 — 선택 이벤트 · 미션 턴 · 종료 요약 (`docs/미션_명세.md` 7절 B·C·D · 이슈 #19).
//
// 새 규칙은 0 이다 — 판정도 대사도 커밋 경계도 전부 엔진(`@/llm/service/mission-turn`)이 알고,
// 여기는 **세션 id 로 그 길을 여는 순서**뿐이다 (`turn.ts`·`turn-resume.ts` 와 같은 결).
//
// ⛔ 이 도메인은 `@/llm/repo` · `@/llm/engine` 을 직접 물지 않는다 (이슈 #4 경계 — eslint 가
//    막는다). 미션 표를 읽는 자리는 전부 `@/llm/service/mission*.ts` 다.
//
// ## 세 문이 공유하는 앞머리 셋
//
// 1. `sessionPendingTurn()` — 세션이 없으면 404, 회차가 없으면 409 (턴 API 와 같은 문)
// 2. **미완 턴이 있으면 409 `TURN_INCOMPLETE`** — 아래 긴 주석
// 3. 그 뒤는 엔진이 한다: 시도 확인(404/409 `MISSION_NOT_ACTIVE`) · 회차 잠금 공유 · 커밋
//
// ## 왜 미완 턴이 미션보다 먼저인가
//
// 미션이 열린 채 미완 턴이 남는 자리는 하나다 — **다리 대사에서 죽은 트리거 턴**이다
// (`mission_sessions` 행은 판정 커밋에서 이미 생겼다). 그 상태로 팝업을 진행시키면 본
// 대화에는 다리 대사 행이 영영 없고, `pendingTurn()` 은 계속 「끝나지 않은 턴」이라 답한다.
// 앱이 할 일은 resume 하나이므로 여기서 그 409 를 그대로 돌려준다 (봉투가 `pending` 을 싣는다).

import type { Settings } from '@/llm/config'
import {
  missionComplete,
  missionEvent,
  missionTurn,
  type MissionCompleteData,
  type MissionEventData,
  type MissionEventType,
  type MissionTurnData,
} from '@/llm/service/mission-turn'
import { sessionPendingTurn, TurnIncomplete, type Conn } from '@/llm/service/run'

export type {
  MissionCompleteData,
  MissionEventData,
  MissionEventType,
  MissionTurnData,
} from '@/llm/service/mission-turn'

export interface MissionRequestArgs {
  session_id: string
  mission_session_id: string
  /** 안 주면 llm/service 쪽이 `getDb()` 로 내려앉는다. 검사는 트랜잭션을 넘겨 끝나면 되돌린다. */
  conn?: Conn
  base_settings?: Settings
}

/** 세션 → 회차 → 미완 턴. 셋 다 통과해야 미션을 만진다. */
async function 회차를_연다(args: MissionRequestArgs): Promise<string> {
  const { run, pending } = await sessionPendingTurn({
    session_id: args.session_id,
    conn: args.conn,
  })
  if (pending !== null) {
    throw new TurnIncomplete(
      `끝나지 않은 대화 턴이 있다 (${pending.stage}). 그 턴을 이어 돌린 뒤에 미션을 진행하라: ` +
        pending.message_id,
      pending,
    )
  }
  return run.id
}

/** `POST /api/sessions/{sid}/missions/{msid}/events` — 소품·친구 탭, 계속/그만, 무음 건너뜀. */
export async function runMissionEvent(
  args: MissionRequestArgs & { type: MissionEventType; value?: string | null },
): Promise<MissionEventData> {
  return missionEvent({ ...args, run_id: await 회차를_연다(args) })
}

/**
 * `POST /api/sessions/{sid}/missions/{msid}/turns` — 미션 안 아이 발화 하나.
 *
 * STT 는 컨트롤러(HTTP 경계) 몫이다 — 이 층은 확정 텍스트만 받는다 (턴 API 와 같다).
 */
export async function runMissionTurn(
  args: MissionRequestArgs & { utterance: string },
): Promise<MissionTurnData> {
  return missionTurn({ ...args, run_id: await 회차를_연다(args) })
}

/** `POST /api/sessions/{sid}/missions/{msid}/complete` — 종료 요약. body 없음, 반복 안전. */
export async function runMissionComplete(
  args: MissionRequestArgs,
): Promise<MissionCompleteData> {
  return missionComplete({ ...args, run_id: await 회차를_연다(args) })
}
