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
import { markSceneSkipped } from '@/llm/repo/sessions'

import { advanceRun, inProgress, runState, TurnInProgress, 진행중_문구 } from './run'

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
 * ⚠️ **장면이 끝났다고 정해진 뒤에만** 부른다 — 전진 조건은 `scene_end_reason` 하나뿐이라,
 *    아이가 말하는 중인 장면에서 부르면 그 장면을 지나쳐 버린다. 부르는 자리는 둘이다:
 *    ① `dialogue.source === 'fixed'` 인 턴 직후 (CLOSING) ② `skipScene()` 이 `SKIPPED` 를 적은 직후.
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

/** 스킵이 끝난 뒤의 두 사실 — 무엇을 건너뛰었나, 이제 어디서 기다리나. */
export interface SkippedScene {
  /** 실제로 건너뛴 장면. 서버가 그 장면을 기다리는 중이 **아니었으면** `null` 이다. */
  skipped: NextSceneRef | null
  /** 전진이 멈춘 자리 — 이제 서버가 기다리는 대화 장면. 회차가 끝났으면 `null`. */
  waiting: NextSceneRef | null
}

/**
 * 아이가 대화 씬을 건너뛰었다 — 그 장면을 `SKIPPED` 로 닫고 다음 대화까지 전진한다.
 *
 * ## 왜 앱이 알려야 하나
 *
 * 진행 지휘권은 대화 장면만 서버에 있다 (확정 결정 ⑧). 영상 구간을 넘기는 것은 앱 혼자
 * 하는 일이라 서버가 알 필요가 없지만, **대화 장면을 넘기는 것은 다르다** — 서버는 그
 * 장면에서 아이를 계속 기다리고, 그 어긋남은 스스로 풀리지 않는다 (남은 대화가 전부
 * 어긋남 가드에 걸려 고정 문구로 떨어진다).
 *
 * ## 「어디에 도착하나」는 앱이 계산하지 않는다
 *
 * 전개 장면 몇 개를 지나야 다음 대화인지는 **DB 만 안다.** 앱이 계산하면 장면 순서가
 * 두 벌이 되고, 그 둘은 반드시 갈라진다. 그래서 앱은 「이 장면을 넘겼다」만 말하고
 * 도착지는 `waiting` 으로 **받는다** — 턴 API 의 `next_scene` 과 같은 손잡이다.
 *
 * ## 반복 안전
 *
 * 보낸 `scene_code` 가 서버가 기다리는 장면이 아니면 **아무것도 하지 않고** 대기 자리만
 * 알려 준다 (세션 열기와 같은 규칙). 두 번 눌러도 두 장면이 날아가지 않는다.
 *
 * ⛔ 미완 턴 문지기는 여기 없다 — 그것은 세션 도메인 몫이다 (`sessionPendingTurn()`).
 *    여기서 막는 것은 **같은 회차에서 도는 중인 호출**뿐이다 (`submitTurn()` 과 같은 잠금).
 */
export async function skipScene(args: {
  run_id: string
  /** 앱이 건너뛴 대화 씬의 장면 코드. 서버 대기 장면과 다르면 아무 일도 일어나지 않는다. */
  scene_code: string
  conn?: Conn
}): Promise<SkippedScene> {
  const conn = args.conn ?? getDb()

  if (!inProgress.start(args.run_id, '건너뛰기')) {
    // 턴이 도는 중에 전진시키면 그 턴의 대사가 이미 지나간 장면에 쓰인다.
    throw new TurnInProgress(진행중_문구(args.run_id))
  }

  try {
    const { run, step } = await runState(conn, args.run_id)
    // 발화를 기다리는 중이 아니면 건너뛸 대화가 없다 (전개 재생 중이거나 이미 닫힌 회차).
    if (step.kind !== '발화받기' || step.scene_id === null) return { skipped: null, waiting: null }

    const 대기 = await readScene(conn, step.scene_id)
    if (대기.code !== args.scene_code) {
      // 이미 어긋나 있었거나 두 번 눌렀다. 서버 기록은 그대로 두고 대기 자리만 알려 준다.
      return { skipped: null, waiting: { scene_id: 대기.scene_id, code: 대기.code } }
    }

    await markSceneSkipped(conn, run.session_id)
    return {
      skipped: { scene_id: 대기.scene_id, code: 대기.code },
      waiting: await advanceAfterClosing({ run_id: args.run_id, conn }),
    }
  } finally {
    inProgress.end(args.run_id)
  }
}
