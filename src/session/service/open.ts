// 세션 열기·조회 — 아이 앱 계약의 알맹이 (`docs/이야기_세션_명세.md` 4.1·4.2절 · 이슈 #6).
//
// 새 규칙은 0 이다 — 찾기·만들기·전진 전부 엔진이 알고, 이 파일은 **그 문들을 부르는
// 순서**와 계약이 정한 응답 모양뿐이다. 열기(4.1)의 순서는 넷이다:
//
// 1. 진행 중 세션을 찾는다 — 없으면 세션+회차를 한 트랜잭션으로 만든다 (결정 ⑥)
// 2. 회차 없는 legacy 행이면 회차를 붙인다 (마이그레이션 없이 산다)
// 3. **미완 턴이 없을 때만** 따라잡는다 — 다음 대화 장면까지 전진 (여는 말이 여기서 생긴다)
// 4. 대기 상태를 읽어 계약 모양으로 돌려준다
//
// ⛔ 이 도메인은 `@/llm/repo` 를 직접 물지 않는다 (이슈 #4 경계 — eslint 가 막는다).
//    읽기·실행은 전부 `@/llm/service/*` 의 문으로 받는다 (`../README.md`).

import { advanceStep, startRunStep, type Conn, type PendingTurn } from '@/llm/service/run'
import {
  appSessionState,
  attachAppRun,
  findAppSession,
  type AppSessionState,
} from '@/llm/service/session-open'
import { LookupError } from '@/llm/service/step'

/** 앱이 장면을 찾는 열쇠 한 쌍 — `code` 가 플레이어 스텝 매핑의 조인 키다 (명세 3절). */
export interface AppSceneRef {
  scene_id: string
  code: string
}

/** 명세 4.1절의 성공 응답 모양. */
export interface OpenedSession {
  session_id: string
  /** 이미 있던 세션이면 `true` — 새로 만든 이번 요청이 처음이면 `false`. */
  resumed: boolean
  /** `in_progress` 가 아니면(따라잡다 회차가 끝난 경우 등) `scene: null` 과 함께 온다. */
  status: string
  scene: AppSceneRef | null
  last_character_line: { message_id: string; text: string } | null
  /** 있으면 앱은 **resume 부터 부른다** (명세 4.1절 · 대화턴 명세 4.3절). */
  pending_turn: PendingTurn | null
}

/** 4.2절 — 4.1 과 같은 모양에서 `resumed` 대신 `progress` 다 (읽기 전용 조회). */
export interface SessionView {
  session_id: string
  status: string
  scene: AppSceneRef | null
  last_character_line: { message_id: string; text: string } | null
  pending_turn: PendingTurn | null
  progress: { scene_order: number; total: number }
}

export interface OpenSessionArgs {
  child_id: string
  /** `stories.slug` — 앱의 이야기 키다 (예: `fart-bride`). */
  story: string
  /** 안 주면 llm/service 쪽이 `getDb()` 로 내려앉는다. 검사는 트랜잭션을 넘겨 끝나면 되돌린다. */
  conn?: Conn
}

/**
 * `POST /api/sessions` — 시작 + 이어하기 + 따라잡기, **반복 안전**.
 *
 * 반복 안전은 여기서 새로 만들지 않는다: 찾기가 같은 세션을 다시 내주고, 전진은
 * 대기 중 장면에서 아무것도 쓰지 않는다 (`advanceScenes()` 가 `발화받기` 면 그대로 돌아온다).
 *
 * ⚠️ **미완 턴이 있으면 전진하지 않는다.** CLOSING 판정까지 갔다가 ③(대사)에서 죽은 턴은
 *    `scene_end_reason` 이 이미 차 있어, 그대로 전진하면 그 턴을 두고 다음 장면으로 가 버린다.
 *    앱은 `pending_turn` 을 받으면 resume 부터 부르고, resume 응답이 `장면끝` 이면 4.1 을
 *    다시 불러 그때 따라잡는다 (명세 4.3절).
 */
export async function openSession(args: OpenSessionArgs): Promise<OpenedSession> {
  const 찾은 = await findAppSession({
    child_id: args.child_id,
    story_code: args.story,
    conn: args.conn,
  })

  if (찾은 === null) {
    // 세션+회차를 한 트랜잭션으로 (결정 ⑥ — `startRun()` 안에 그 트랜잭션이 있다).
    const { run, session_id } = await startRunStep({
      story_code: args.story,
      child_id: args.child_id,
      scope: 'story',
      started_by: 'app',
      conn: args.conn,
    })
    await advanceStep({ run_id: run.id, conn: args.conn })
    return 열기_모양(await appSessionState({ session_id, conn: args.conn }), false)
  }

  const run = 찾은.run ?? (await attachAppRun({ session_id: 찾은.session.id, conn: args.conn }))
  const 상태 = await appSessionState({ session_id: 찾은.session.id, conn: args.conn })
  if (상태.pending !== null) return 열기_모양(상태, true)

  await advanceStep({ run_id: run.id, conn: args.conn })
  return 열기_모양(await appSessionState({ session_id: 찾은.session.id, conn: args.conn }), true)
}

export interface ViewSessionArgs {
  session_id: string
  /** 컨트롤러 입구에서 확인한 아이 — 남의 세션은 「없다」로 답한다 (있다는 사실도 안 새게). */
  child_id: string
  conn?: Conn
}

/** `GET /api/sessions/{session_id}` — **상태를 바꾸지 않는다** (따라잡기 없음). */
export async function viewSession(args: ViewSessionArgs): Promise<SessionView> {
  const 상태 = await appSessionState({ session_id: args.session_id, conn: args.conn })
  if (상태.session.child_id !== args.child_id) {
    throw new LookupError(`세션이 없다: ${args.session_id}`)
  }
  return {
    session_id: 상태.session.id,
    status: 상태.session.status,
    scene: 장면_모양(상태),
    last_character_line: 상태.session.status === 'in_progress' ? 상태.last_character_line : null,
    pending_turn: 상태.pending,
    progress: 상태.progress,
  }
}

/** 4.1 응답으로 접는다 — 대기 중이 아니면 `scene: null` + `status` 분기 (명세 4.1절). */
function 열기_모양(상태: AppSessionState, resumed: boolean): OpenedSession {
  return {
    session_id: 상태.session.id,
    resumed,
    status: 상태.session.status,
    scene: 장면_모양(상태),
    last_character_line: 상태.session.status === 'in_progress' ? 상태.last_character_line : null,
    pending_turn: 상태.pending,
  }
}

function 장면_모양(상태: AppSessionState): AppSceneRef | null {
  if (상태.session.status !== 'in_progress' || 상태.scene === null) return null
  return { scene_id: 상태.scene.scene_id, code: 상태.scene.code }
}
