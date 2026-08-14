// 아이 앱 턴의 **장면 전진** 문 — CLOSING 뒤 같은 요청 안에서 다음 대화 장면까지
// (`docs/이야기_세션_명세.md` 4.3절 · 이슈 #7).
//
// 세션 도메인(`src/session`)은 repo 를 직접 물지 못한다 (이슈 #4 경계 — eslint 가 막는다).
// `sessionPendingTurn()` 이 그렇게 생긴 첫 문이고, 이 파일이 둘째 문이다.
//
// ## 「정확히 한 번」 — 닫기가 두 곳에 살아서 생기는 함정
//
// `submitTurn()` 꼬리의 `끝났으면_닫는다()` 는 CLOSING 턴 **직후의** `nextStep()` 이
// `회차끝` 일 때(= 끝난 대화 장면이 이야기의 마지막 행일 때) 이미 세션·회차를 닫는다.
// 반면 마지막 대화 뒤에 전개 장면이 남았거나 다음 대화가 더 있으면 `장면시작` 이라 안 닫는다.
// 그래서 여기는 **세션이 아직 `in_progress` 일 때만** 전진한다 — 이미 닫혔으면 그것이
// 곧 `회차끝` 이고, 다시 닫으면 `runs.ended_at` 이 두 번 찍힌다.

import { readScene } from '@/llm/repo/content'
import { getDb, type Conn } from '@/llm/repo/db'

import { advanceRun, runState } from './run'

/** 다음 대화 장면 한 쌍 — 앱은 `code` 로 자기 스텝을 찾는다 (명세 3절 매핑표). */
export interface NextSceneRef {
  scene_id: string
  code: string
}

/**
 * CLOSING 턴 뒤 다음 대화 장면까지 전진한다 (명세 4.3절 — 「장면 전진은 이 요청 안에서」).
 *
 * - 다음 대화 장면이 있다 → 전개를 지나 그 장면을 열고(여는 말 `messages` 행이 여기서
 *   저장된다) 그 장면을 돌려준다 — 응답의 `next_scene` 이다.
 * - 없다 → `null`. 회차는 이 안(`advanceRun`)이나 `submitTurn()` 꼬리가 이미 닫았다 —
 *   부르는 쪽에서 이 `null` 이 곧 `회차끝` 판정이 된다 (`session/domain/progress.ts`).
 *
 * ⚠️ `dialogue.source === 'fixed'` 인 턴 **직후에만** 부른다. 다른 자리에서 부르면
 *    아이가 말하는 중인 장면을 지나쳐 버린다 (전진 조건은 `scene_end_reason` 뿐이다).
 */
export async function advanceAfterClosing(args: {
  run_id: string
  conn?: Conn
}): Promise<NextSceneRef | null> {
  const conn = args.conn ?? getDb()

  const { session } = await runState(conn, args.run_id)
  if (session.status !== 'in_progress') {
    // 마지막 장면이 이야기 끝이었다 — `끝났으면_닫는다()` 가 이미 닫았다. 다시 닫지 않는다.
    return null
  }

  // 다음 대화 장면에 닿을 때까지 전개를 재생한다. 끝에 닿으면 `advanceRun` 이 회차를 닫는다.
  const step = await advanceRun(conn, args.run_id)
  if (step.kind !== '발화받기' || step.scene_id === null) return null

  const 장면 = await readScene(conn, step.scene_id)
  return { scene_id: 장면.scene_id, code: 장면.code }
}
