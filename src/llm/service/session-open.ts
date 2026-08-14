// 세션 열기의 llm 쪽 문 — 세션 도메인이 부르는 읽기·붙이기 셋 (이슈 #6).
//
// 세션 도메인(`src/session`)은 repo 를 직접 물지 못한다 (이슈 #4 경계 — eslint 가 막는다).
// PR #11 이 `run.ts` 에 `sessionPendingTurn()` 을 늘린 방식 그대로, 세션 열기(4.1)·조회(4.2)에
// 모자란 읽기를 여기서 늘린다. **순서(찾기 → 만들기 → 따라잡기)는 이 파일이 모른다** —
// 그것은 `src/session/service/open.ts` 몫이다 (층 규칙: 시퀀스는 세션 service 층만 안다).

import { readStory, scenesOfStory, type SceneRow } from '@/llm/repo/content'
import { getDb, type Conn } from '@/llm/repo/db'
import { ValueError } from '@/llm/domain/progress'
import { createRun, readRunBySession, type RunRow } from '@/llm/repo/runs'
import {
  lastCharacterLine,
  latestInProgressSession,
  readSessionWithStory,
  type SessionRow,
  type SessionWithStory,
} from '@/llm/repo/sessions'

import { pendingTurn, 기본_발화_출처, 기본_프롬프트_버전, type PendingTurn } from './run'

/**
 * 아이 앱이 여는 이야기 — `published` 만 (옛 `startStory()` 액션이 하던 문지기 그대로).
 *
 * 없는 slug 는 `readStory()` 의 `SceneNotFound`(⊂ LookupError → 404)가 말하고,
 * 공개 전이면 400 이다 — 앱이 고칠 수 있는 요청 문제라서다.
 */
async function 공개된_이야기(conn: Conn, story_code: string) {
  const 이야기 = await readStory(conn, story_code)
  if (이야기.status !== 'published') {
    throw new ValueError(`아직 공개되지 않은 이야기다: ${story_code} (status=${이야기.status})`)
  }
  return 이야기
}

/**
 * `(child_id, story)` 의 진행 중 세션과 그 회차를 찾는다. 없으면 `null` — 새로 시작할 자리다.
 *
 * `run` 이 `null` 인 채로 나올 수 있다 — 옛 `startStory()` 가 회차 없이 남긴 legacy 행이다.
 * 회차를 붙이는 것은 `attachAppRun()` 으로, 부를지 말지는 세션 service 가 정한다.
 */
export async function findAppSession(args: {
  child_id: string
  story_code: string
  conn?: Conn
}): Promise<{ session: SessionRow; run: RunRow | null } | null> {
  const conn = args.conn ?? getDb()
  const 이야기 = await 공개된_이야기(conn, args.story_code)
  const session = await latestInProgressSession(conn, {
    child_id: args.child_id,
    story_id: 이야기.id,
  })
  if (session === null) return null
  return { session, run: await readRunBySession(conn, session.id) }
}

/**
 * 회차 없는 legacy 세션에 `started_by='app'` 회차를 붙인다 (명세 4.1 동작 2 · 확정 결정 ⑥).
 *
 * 새 세션은 이 함수를 안 거친다 — `startRunStep()` 이 세션·회차를 **한 트랜잭션**으로 만든다.
 * 여기는 세션이 이미 있는 자리라 붙일 것이 회차 한 행뿐이다 (`runs.session_id` UNIQUE 가
 * 두 번 붙는 것을 막는다).
 */
export async function attachAppRun(args: { session_id: string; conn?: Conn }): Promise<RunRow> {
  const conn = args.conn ?? getDb()
  return createRun(conn, {
    session_id: args.session_id,
    scope: 'story',
    scene_order: null,
    started_by: 'app',
    analysis_model: null,
    analysis_effort: null,
    character_model: null,
    character_effort: null,
    default_utterance_source: 기본_발화_출처,
    prompt_version: 기본_프롬프트_버전,
  })
}

/** 아이 앱 응답의 재료 한 벌 — 4.1(대기 상태)·4.2(조회)가 같은 것을 읽는다. */
export interface AppSessionState {
  session: SessionWithStory
  run: RunRow | null
  /** 세션의 `current_scene_id` 행 (code 포함). 장면에 든 적이 없으면 `null`. */
  scene: SceneRow | null
  /** 그 장면의 마지막 캐릭터 행 — 여는 말도 캐릭터 행이라 대기 중이면 항상 있다 (결정 ③). */
  last_character_line: { message_id: string; text: string } | null
  pending: PendingTurn | null
  /** 4.2 의 진행률. `scene_order` 는 현재 장면 것, `total` 은 장면 수 전체다. */
  progress: { scene_order: number; total: number }
}

/**
 * 세션 하나의 대기 상태를 **읽기만** 한다 — 따라잡기 없음 (4.2 가 그대로 쓰고,
 * 4.1 은 전진을 끝낸 뒤 이걸로 응답을 채운다). 세션이 없으면 `LookupError`(404).
 */
export async function appSessionState(args: {
  session_id: string
  conn?: Conn
}): Promise<AppSessionState> {
  const conn = args.conn ?? getDb()
  const session = await readSessionWithStory(conn, args.session_id)
  const run = await readRunBySession(conn, args.session_id)
  const 장면들 = await scenesOfStory(conn, session.story_code)
  const scene =
    session.current_scene_id === null
      ? null
      : (장면들.find((행) => 행.scene_id === session.current_scene_id) ?? null)
  const last_character_line =
    scene === null
      ? null
      : await lastCharacterLine(conn, { session_id: session.id, scene_id: scene.scene_id })
  return {
    session,
    run,
    scene,
    last_character_line,
    pending: await pendingTurn(conn, { session_id: session.id }),
    progress: { scene_order: scene?.scene_order ?? 0, total: 장면들.length },
  }
}
