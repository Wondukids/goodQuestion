// 끊긴 턴 이어하기 — 아이 앱 계약의 알맹이 (`docs/대화턴_이어하기_명세.md` 4.2절 · 이슈 #2).
//
// **세션 도메인의 첫 조각이다.** 대화 진행은 이 도메인(`src/session`)이 맡고 `src/llm` 은
// 엔진으로 남는다 (2026-08-14 설계 rev.2 결정 ①). 여기서 새 규칙은 0 이다 — 미완 턴 판정도
// 이어 돌리기도 전부 엔진(`@/llm/service/run`)이 알고, 이 파일은 **세션 id 하나로 그 길을
// 여는 것**과 계약이 정한 응답 모양뿐이다 (명세 6절).
//
// ⚠️ 이 도메인에는 아직 repo 층이 없다. 세션·메시지 읽기는 엔진 DB(drizzle)의 것이라
//    `@/llm/repo` 를 빌려 쓴다 — 세션 도메인 뼈대 이슈가 층을 세우면 그리로 옮긴다.
//
// ## 전제 — 회차 없는 세션은 이 길이 막힌다
//
// `resumeTurn()` 은 `run_id` 를 받고, 세션 id → 회차 매핑은 `runOfSession()` 이 한다.
// 아이 앱 세션에 회차(`runs`) 행이 없으면 409 다 — 세션 생성 시 `started_by='app'` 회차를
// 함께 만드는 결정은 세션 도메인 이슈 몫이다 (명세 6절 전제).

import type { Settings } from '@/llm/config'
import { getDb, type Conn } from '@/llm/repo/db'
import { readMessage, readSessionWithStory } from '@/llm/repo/sessions'
import {
  pendingTurn,
  resumeTurn,
  runOfSession,
  TurnNotAllowed,
  type PendingStage,
} from '@/llm/service/run'

export interface ResumeSessionTurnArgs {
  session_id: string
  /** 안 주면 `getDb()`. 검사는 트랜잭션을 넘겨 끝나면 되돌린다. */
  conn?: Conn
  base_settings?: Settings
}

/** 명세 4.2절의 성공 응답 모양 — 일반 턴 응답과 같은 모양 + `resumed_from`. */
export interface ResumedSessionTurn {
  resumed_from: PendingStage
  /** 발화는 저장된 그 문장이다 — 오디오를 다시 받지 않았다는 증거로 그대로 돌려준다. */
  child: { message_id: string; text: string }
  dialogue: { message_id: string; text: string; source: 'generated' | 'fixed' }
  next: { kind: '발화받기' | '장면끝'; scene_id: string }
}

/**
 * 끊긴 턴을 죽은 단계부터 이어 돌린다 — `POST /api/sessions/{session_id}/turns/resume`.
 *
 * 하는 일은 순서 넷뿐이다:
 * 1. 세션이 있나 (없으면 404 `SESSION_NOT_FOUND` — `readSessionWithStory` 가 던진다)
 * 2. 회차가 있나 (없으면 409 — 위 머리말의 전제)
 * 3. 미완 턴이 있나 (없으면 409 `TURN_NOT_ALLOWED` — 이어 돌릴 것이 없다)
 * 4. `resumeTurn()` — 죽은 단계부터. 불변 조건(행 수·턴 카운트·박제 판정)은 전부 그 안에 있다
 *
 * **반복 안전은 여기서 새로 만들지 않는다** (명세 4.2절): 성공하면 미완이 사라져 3번이
 * 막고, 실패하면 저장 상태가 안 변해 다시 불러도 같은 자리부터다.
 *
 * ## `next` 는 `dialogue.source` 에서 나온다
 *
 * `source === 'fixed'` 가 CLOSING 판정의 **결과**다 — 이 레포는 CLOSING 인지 두 번 보지
 * 않는다 (`service/turn.ts` 규칙 1). 고정 대사가 나갔으면 그 장면은 끝난 것이고(결정 21·36),
 * 아니면 아이가 같은 장면에서 계속 말할 차례다.
 * ⛔ `nextStep()` 을 다시 부르지 않는 이유: `resumeTurn()` 이 CLOSING 턴 뒤에 회차를 이미
 *    닫아 두므로, 그 뒤에 재계산하면 `장면끝` 이 아니라 `회차끝`(scene 범위)이나
 *    `장면시작`(story 범위)으로 뭉개진다 — 앱이 알아야 하는 것은 「이 장면이 끝났다」다.
 */
export async function resumeSessionTurn(args: ResumeSessionTurnArgs): Promise<ResumedSessionTurn> {
  const conn = args.conn ?? getDb()

  // 1 ─ 세션 존재 확인. `runOfSession()` 은 「세션이 없다」와 「회차가 없다」를 똑같이
  //     null 로 말하므로, 404 와 409 를 가르려면 세션을 먼저 읽어야 한다.
  await readSessionWithStory(conn, args.session_id)

  const run = await runOfSession(conn, args.session_id)
  if (run === null) {
    throw new TurnNotAllowed(`이 세션에는 회차가 없다: ${args.session_id}`)
  }

  const 미완 = await pendingTurn(conn, { session_id: args.session_id })
  if (미완 === null) {
    throw new TurnNotAllowed('이어 돌릴 턴이 없다 — 이 세션의 마지막 턴은 이미 끝났다')
  }

  const 아이 = await readMessage(conn, 미완.message_id)
  if (아이 === null) {
    // `pendingTurn()` 이 방금 본 행이다. 여기 오면 데이터가 그 사이에 지워진 것이다.
    throw new TurnNotAllowed(`메시지가 없다: ${미완.message_id}`)
  }

  const 결과 = await resumeTurn({
    run_id: run.id,
    child_message_id: 미완.message_id,
    conn,
    base_settings: args.base_settings,
  })

  return {
    resumed_from: 결과.resumed_from,
    child: { message_id: 아이.id, text: 아이.text },
    dialogue: {
      message_id: 결과.dialogue.message_id,
      text: 결과.dialogue.text,
      source: 결과.dialogue.source,
    },
    next:
      결과.dialogue.source === 'fixed'
        ? { kind: '장면끝', scene_id: 아이.scene_id }
        : { kind: '발화받기', scene_id: 아이.scene_id },
  }
}
