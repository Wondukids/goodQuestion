// 끊긴 턴 이어하기 — 아이 앱 계약의 알맹이 (`docs/대화턴_이어하기_명세.md` 4.2절 · 이슈 #2).
//
// 새 규칙은 0 이다 — 미완 턴 판정도 이어 돌리기도 전부 엔진이 알고, 이 파일은 **세션 id
// 하나로 그 길을 여는 순서**와 계약이 정한 응답 모양뿐이다 (명세 6절).
//
// ⛔ 이 도메인은 `@/llm/repo` 를 직접 물지 않는다 (이슈 #4 경계 — eslint 가 막는다).
//    읽기·실행은 전부 `@/llm/service/run` 의 함수로 받는다. 조회가 더 필요하면
//    그쪽에 함수를 늘려라 (`../README.md`).
//
// ## 전제 — 회차 없는 세션은 이 길이 막힌다
//
// `resumeTurn()` 은 `run_id` 를 받고, 세션 → 회차 → 미완 턴 가름은 `sessionPendingTurn()`
// 이 한다. 아이 앱 세션에 회차(`runs`) 행이 없으면 409 다 — 세션 생성 시 `started_by='app'`
// 회차를 함께 만드는 것은 세션 열기 이슈 #6 몫이다 (명세 6절 전제).

import type { Settings } from '@/llm/config'
import { missionTrigger } from '@/llm/service/mission'
import {
  resumeTurn,
  sessionPendingTurn,
  TurnNotAllowed,
  type Conn,
  type PendingStage,
} from '@/llm/service/run'
import { nextAfterDialogue, nextMissionStart, type NextForApp } from '@/session/domain/progress'

export interface ResumeSessionTurnArgs {
  session_id: string
  /** 안 주면 llm/service 쪽이 `getDb()` 로 내려앉는다. 검사는 트랜잭션을 넘겨 끝나면 되돌린다. */
  conn?: Conn
  base_settings?: Settings
}

/** 명세 4.2절의 성공 응답 모양 — 일반 턴 응답과 같은 모양 + `resumed_from`. */
export interface ResumedSessionTurn {
  resumed_from: PendingStage
  /** 발화는 저장된 그 문장이다 — 오디오를 다시 받지 않았다는 증거로 그대로 돌려준다. */
  child: { message_id: string; text: string }
  dialogue: { message_id: string; text: string; source: 'generated' | 'fixed' }
  next: NextForApp
}

/**
 * 끊긴 턴을 죽은 단계부터 이어 돌린다 — `POST /api/sessions/{session_id}/turns/resume`.
 *
 * 하는 일은 순서 셋뿐이다:
 * 1. `sessionPendingTurn()` — 세션이 없으면 404, 회차가 없으면 409 는 그 안에서 갈린다
 * 2. 미완 턴이 없으면 409 `TURN_NOT_ALLOWED` — 이어 돌릴 것이 없다
 * 3. `resumeTurn()` — 죽은 단계부터. 불변 조건(행 수·턴 카운트·박제 판정)은 전부 그 안에 있다
 *
 * **반복 안전은 여기서 새로 만들지 않는다** (명세 4.2절): 성공하면 미완이 사라져 2번이
 * 막고, 실패하면 저장 상태가 안 변해 다시 불러도 같은 자리부터다.
 *
 * `next` 판정(고정 닫는 말 = 장면끝)은 `domain/progress.ts` 의 순수 함수다.
 *
 * ## 다리 대사에서 끊긴 턴 (이슈 #19 · 미션 명세 7절 A)
 *
 * 미션 손잡이를 여기서도 끼운다. 트리거 턴은 판정 커밋에서 `mission_sessions` 행을 이미
 * 만들었으므로 손잡이가 **그 행을 그대로 다시 쓰고**(반복 안전) 다리 대사만 새로 만든다.
 * 그래서 resume 응답에도 `next: 미션시작` 이 실린다 — 앱은 팝업을 그때 연다.
 *
 * ⛔ 미션 가드(`MISSION_IN_PROGRESS`)는 여기 **없다.** 그 가드는 새 발화를 막는 것이고,
 *    이어 돌리기는 이미 저장된 발화의 나머지를 마치는 일이다. 여기서 막으면 다리 대사가
 *    끊긴 턴이 영영 미완으로 남는다.
 */
export async function resumeSessionTurn(args: ResumeSessionTurnArgs): Promise<ResumedSessionTurn> {
  const { run, pending } = await sessionPendingTurn({
    session_id: args.session_id,
    conn: args.conn,
  })
  if (pending === null) {
    throw new TurnNotAllowed('이어 돌릴 턴이 없다 — 이 세션의 마지막 턴은 이미 끝났다')
  }

  const 손잡이 = missionTrigger()
  const 결과 = await resumeTurn({
    run_id: run.id,
    child_message_id: pending.message_id,
    conn: args.conn,
    base_settings: args.base_settings,
    mission: 손잡이,
  })

  // ⚠️ 이어 돌린 턴이 이야기의 마지막이면 엔진 꼬리(`끝났으면_닫는다()`)가 세션을 닫고,
  //    보호자 리포트는 그 안의 `completeRun()` 이 띄운다 (이슈 #38). 여기서 다시 안 부른다.
  return {
    resumed_from: 결과.resumed_from,
    child: { message_id: 결과.child_message_id, text: 결과.child_text },
    dialogue: {
      message_id: 결과.dialogue.message_id,
      text: 결과.dialogue.text,
      source: 결과.dialogue.source,
    },
    next:
      손잡이.started === null
        ? nextAfterDialogue(결과.dialogue.source, 결과.scene_id)
        : nextMissionStart(결과.scene_id, 손잡이.started),
  }
}
