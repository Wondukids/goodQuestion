// 대화 씬 건너뛰기 — `POST /api/sessions/{session_id}/scenes/{scene_code}/skip`.
//
// 새 규칙은 0 이다 — 장면을 닫고 전진하는 일은 엔진이 알고, 이 파일은 **그 문을 부르는
// 순서**와 계약이 정한 응답 모양뿐이다. 순서는 둘이다:
//
// 1. 미완 턴이 있으면 409 — 먼저 이어 돌린다 (턴 API 와 **같은 문지기**)
// 2. 그 장면을 `SKIPPED` 로 닫고 다음 대화 장면까지 전진한다
//
// ## 왜 미완 턴을 먼저 막나
//
// 미완 턴을 둔 채 전진하면 그 턴은 **영영 미아가 된다** — `pendingTurn()` 은 세션의 마지막
// 아이 발화를 보는데, 세션이 이미 다음 장면에 가 있으면 이어 돌릴 자리가 없다.
// 앱은 409 를 받으면 resume 부터 부르고 그 다음에 다시 건너뛰면 된다 (턴 API 와 같은 흐름).
//
// ⛔ 이 도메인은 `@/llm/repo` 를 직접 물지 않는다 (이슈 #4 경계 — eslint 가 막는다).

import { sessionPendingTurn, TurnIncomplete, type Conn } from '@/llm/service/run'
import { skipScene as skipSceneStep } from '@/llm/service/session-turn'

import type { AppSceneRef } from './open'

export interface SkipSceneArgs {
  session_id: string
  /**
   * 앱이 건너뛴 대화 씬의 장면 코드 (`story_scenes.code` — 명세 3절 매핑의 조인 키).
   *
   * 🔴 **이 값이 반복 안전의 열쇠다.** 서버가 기다리는 장면과 다르면 아무 일도 일어나지
   * 않는다 — 두 번 눌러도, 이미 어긋나 있어도 두 장면이 날아가지 않는다.
   */
  scene_code: string
  conn?: Conn
}

/** 스킵 응답 — 앱이 쓰는 것은 `scene` 하나다 (장면 추적을 이 값으로 갈아 끼운다). */
export interface SkippedScene {
  /**
   * 실제로 건너뛴 장면. `null` 이면 **아무것도 안 했다** — 서버는 원래 그 장면을
   * 기다리고 있지 않았다 (두 번 눌렀거나, 이미 어긋나 있었다).
   */
  skipped: AppSceneRef | null
  /**
   * 이제 서버가 기다리는 대화 장면 — 명세 4.1 의 `scene` 과 같은 뜻·같은 모양이다.
   * `null` 이면 서버가 기다리는 대화가 없다 (건너뛴 것이 마지막 대화라 회차가 닫혔거나,
   * 애초에 진행 중이 아니었다).
   */
  scene: AppSceneRef | null
}

/**
 * 대화 씬 하나를 건너뛴다.
 *
 * 「어디에 도착하는가」는 **서버가 정해 응답으로 준다** — 전개 장면 몇 개를 지나야 다음
 * 대화인지는 DB 만 알고, 앱이 계산하면 장면 순서가 두 벌이 되어 반드시 갈라진다.
 */
export async function skipScene(args: SkipSceneArgs): Promise<SkippedScene> {
  const { run, pending } = await sessionPendingTurn({
    session_id: args.session_id,
    conn: args.conn,
  })

  if (pending !== null) {
    throw new TurnIncomplete(
      `끝나지 않은 턴이 있다 (${pending.stage}). 그 턴을 이어 돌린 뒤에 건너뛰어라: ${pending.message_id}`,
      pending,
    )
  }

  const 결과 = await skipSceneStep({
    run_id: run.id,
    scene_code: args.scene_code,
    conn: args.conn,
  })

  return { skipped: 결과.skipped, scene: 결과.waiting }
}
