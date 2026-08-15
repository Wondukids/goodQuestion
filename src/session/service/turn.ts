// 아이 앱 턴 하나 — 요청 1번 = 턴 1개 (`docs/이야기_세션_명세.md` 4.3절 · 이슈 #7).
//
// 받아쓴 발화 하나로 ①분석 → ②판단 → ③대사를 끝까지 돌리고, 캐릭터 대사와 앱이
// 다음에 할 일(`next`)을 돌려준다. 새 규칙은 0 이다 — 턴의 순서·커밋 경계·미완 턴
// 문지기·CLOSING 갈림은 전부 엔진(`submitTurn()`)이 알고, 여기는 **세션 id 로 그 길을
// 여는 순서**와 계약이 정한 응답 모양뿐이다.
//
// ⛔ 이 도메인은 `@/llm/repo` 를 직접 물지 않는다 (이슈 #4 경계 — eslint 가 막는다).
//    읽기·실행은 전부 `@/llm/service/*` 의 문으로 받는다.
//
// ## STT 는 여기 없다
//
// 오디오 → 텍스트는 컨트롤러(HTTP 경계) 몫이다 — 이 층은 확정 텍스트만 받는다.
// 그래서 관리자 화면이든 검사든 텍스트만 있으면 같은 길을 탄다.

import type { Settings } from '@/llm/config'
import { activeMission, missionTrigger, MissionInProgress } from '@/llm/service/mission'
import { sessionPendingTurn, submitTurn, type Conn } from '@/llm/service/run'
import { advanceAfterClosing } from '@/llm/service/session-turn'
import { ValueError } from '@/llm/service/step'
import { isUsableUtterance } from '@/llm/service/turn'
import { nextAfterTurn, nextMissionStart, type NextForApp } from '@/session/domain/progress'

export interface RunSessionTurnArgs {
  session_id: string
  /** STT 가 받아쓴 아이 발화. 빈/공백이면 아무것도 저장하지 않고 `empty` 로 돌아간다. */
  utterance: string
  /** 안 주면 llm/service 쪽이 `getDb()` 로 내려앉는다. 검사는 트랜잭션을 넘겨 끝나면 되돌린다. */
  conn?: Conn
  base_settings?: Settings
}

/** 명세 4.3절의 성공 응답 — resume 응답에서 `resumed_from` 을 뺀 모양 + 장면 전진. */
export interface SessionTurn {
  child: { message_id: string; text: string }
  dialogue: { message_id: string; text: string; source: 'generated' | 'fixed' }
  next: NextForApp
}

/** 빈 발화·무음 — 서버 상태 불변 (기존 규칙: `messages` 행이 안 생긴다). */
export interface EmptyUtterance {
  empty: true
}

/**
 * 턴 하나를 돌린다 — `POST /api/sessions/{session_id}/turns`.
 *
 * 하는 일은 순서 넷뿐이다:
 * 1. `sessionPendingTurn()` — 세션이 없으면 404, 회차가 없으면 409 는 그 안에서 갈린다
 * 2. 발화가 비었으면 `{ empty: true }` — 저장도 턴 카운트도 없다 (명세 4.3절)
 * 3. `submitTurn()` — 미완 턴 문지기(409 `TURN_INCOMPLETE` + pending)와 두 번 보내기
 *    잠금(409 재시도 가능)이 그 안에 있다
 * 4. 고정 닫는 말이 나갔으면(`source === 'fixed'`) **같은 요청 안에서** 다음 대화 장면까지
 *    전진한다 — 여는 말 행이 저장되고 `next_scene` 에 실린다. 다음 대화가 없으면 회차가
 *    닫히고 `회차끝` 이다 (`advanceAfterClosing()` 머리말)
 *
 * `next` 판정은 `domain/progress.ts` 의 순수 함수다 — 전진이 **실제로 멈춘 자리**를
 * 계약 모양으로 옮길 뿐, 여기서 재계산하지 않는다.
 *
 * ## 미션 둘 (이슈 #19 · 미션 명세 7절 A·E)
 *
 * - **가드**: 미션이 도는 중이면 409 `MISSION_IN_PROGRESS` 다. 팝업이 열린 채 본 대화가
 *   흘러가면 두 흐름이 같은 씬 상태(누적 요소·턴 수)를 두고 다툰다.
 * - **트리거**: `missionTrigger()` 손잡이를 끼워 보낸다. 판단 직후 발동하면 ③ 이 다리
 *   대사로 갈리고, 그 사실이 `손잡이.started` 로 돌아온다 (`llm/service/mission.ts`).
 */
export async function runSessionTurn(args: RunSessionTurnArgs): Promise<SessionTurn | EmptyUtterance> {
  const { run, pending } = await sessionPendingTurn({ session_id: args.session_id, conn: args.conn })

  if (!isUsableUtterance(args.utterance)) return { empty: true }

  // ⚠️ 미완 턴이 있으면 **그쪽이 먼저다** — 앱이 할 일은 resume 이고, 그 409(`TURN_INCOMPLETE`
  //    + pending)는 `submitTurn()` 이 던진다. 미션 가드를 앞에 두면 다리 대사가 끊긴 턴에서
  //    「미션 중」만 알려 주게 되어, 앱이 팝업부터 열고 그 턴은 영영 미완으로 남는다.
  if (pending === null) {
    const 도는_미션 = await activeMission({ session_id: args.session_id, conn: args.conn })
    if (도는_미션 !== null) {
      throw new MissionInProgress(
        `미션이 도는 중이라 대화 턴을 받을 수 없다 (mission_session_id=${도는_미션.id}). ` +
          '미션을 마치면(complete) 다시 받는다.',
      )
    }
  }

  const 손잡이 = missionTrigger()
  const 결과 = await submitTurn({
    run_id: run.id,
    child_utterance: args.utterance,
    conn: args.conn,
    base_settings: args.base_settings,
    mission: 손잡이,
  })

  // ② 직후의 세션 행이다 — `current_scene_id` 는 이 턴이 돈 대화 장면이고, 전진(4번)은
  // 아직이라 여기서 바뀌지 않았다. 턴이 돌았다는 것이 곧 이 값이 있다는 뜻이다.
  const scene_id = 결과.session.current_scene_id
  if (scene_id === null) {
    throw new ValueError(`턴이 돌았는데 현재 장면이 없다: ${args.session_id}`)
  }

  // 미션이 발동한 턴은 전진하지 않는다 — 다리 대사는 `generated` 라 아래 조건에도 안 걸리지만,
  // 씬이 닫히는 자리가 미션 완료 하나뿐이라는 것을 여기서도 읽히게 둔다 (명세 5절 게이트).
  const next_scene =
    결과.dialogue.source === 'fixed'
      ? await advanceAfterClosing({ run_id: run.id, conn: args.conn })
      : null

  return {
    child: { message_id: 결과.child_message_id, text: args.utterance },
    dialogue: {
      message_id: 결과.dialogue.message_id,
      text: 결과.dialogue.text,
      source: 결과.dialogue.source,
    },
    next:
      손잡이.started === null
        ? nextAfterTurn(결과.dialogue.source, scene_id, next_scene)
        : nextMissionStart(scene_id, 손잡이.started),
  }
}
