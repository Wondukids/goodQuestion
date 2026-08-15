// 말하기 후 활동 — **세션 도메인이 표 둘을 만지는 문** (이슈 #45).
//
// 세션 도메인에는 repo 가 없고 `@/llm/repo/*` 직접 import 는 eslint 가 막는다
// (`src/session/README.md` — 「조회가 더 필요해지면 llm/service 에 함수를 늘려라」).
// `sessionPendingTurn()`(`service/run.ts`)이 그렇게 생긴 첫 문이고, 이 파일이 그 다음이다.
//
// ⛔ **여기에 규칙을 쓰지 않는다.** 하는 일은 둘뿐이다 — `conn` 이 없으면 `getDb()` 로
//    내려앉고, repo 함수를 그대로 부른다. 순서·문지기·판정은 전부
//    `src/session/service/post-activity.ts` 가 안다.

import {
  clearPostActivityKeywords,
  markPostActivityCompleted,
  readPostActivityResult,
  readPostActivitySession,
  saveKeywordJudgement,
  saveRetellingText,
  submitPostActivityOrder,
  type PostActivityResultRow,
  type 후활동세션,
} from '@/llm/repo/post-activity'
import { getDb, type Conn } from '@/llm/repo/db'
import type { 단어판정 } from '@/post-activity/types'
import { readReport } from '@/report/repo/reports'

export type { PostActivityResultRow, 후활동세션 }

/** 안 주면 `getDb()` 로 내려앉는다. 검사는 트랜잭션을 넘겨 끝나면 되돌린다. */
export interface PostActivityConnArgs {
  conn?: Conn
}

/** 세션 하나와 그 이야기의 후활동 설정. 세션이 없으면 `null` (부르는 쪽이 404 로 옮긴다). */
export async function postActivitySession(
  args: PostActivityConnArgs & { session_id: string },
): Promise<후활동세션 | null> {
  return readPostActivitySession(args.conn ?? getDb(), args.session_id)
}

/** 이 세션의 후활동 결과 한 행. 아직 아무것도 안 했으면 `null`. */
export async function postActivityResult(
  args: PostActivityConnArgs & { session_id: string },
): Promise<PostActivityResultRow | null> {
  return readPostActivityResult(args.conn ?? getDb(), args.session_id)
}

/** 순서 제출 한 번. 행이 없으면 만들고, 첫 제출은 안 덮고, 회차를 하나 올린다 (F7·F8·F18). */
export async function recordOrderAttempt(
  args: PostActivityConnArgs & {
    session_id: string
    submitted_order: readonly string[]
    is_correct: boolean
  },
): Promise<PostActivityResultRow> {
  return submitPostActivityOrder(args.conn ?? getDb(), args)
}

/**
 * 받아쓴 줄거리를 저장한다 — **판정보다 먼저** (F4·F8). 지난 판정은 여기서 함께 지워진다.
 *
 * 결과 행의 `analyzed_at`·`analysis_version` 이 NULL 로 돌아가고, 그 결과에 달렸던
 * 단어 행도 전부 사라진다 (명세 4.3).
 */
export async function recordRetellingText(
  args: PostActivityConnArgs & { session_id: string; text: string },
): Promise<PostActivityResultRow> {
  const conn = args.conn ?? getDb()
  const 행 = await saveRetellingText(conn, args)
  await clearPostActivityKeywords(conn, 행.id)
  return 행
}

/** 판정이 성공했을 때만 부른다 — 단어 12행과 `analyzed_at`·`analysis_version` 을 얹는다. */
export async function recordKeywordJudgement(
  args: PostActivityConnArgs & {
    result_id: string
    words: readonly 단어판정[]
    version: string
  },
): Promise<void> {
  await saveKeywordJudgement(args.conn ?? getDb(), args)
}

/** 「마치기」를 눌렀다 — `completed_at` 을 채운다. 두 번 불러도 처음 시각이 그대로다. */
export async function recordPostActivityCompleted(
  args: PostActivityConnArgs & { session_id: string },
): Promise<void> {
  await markPostActivityCompleted(args.conn ?? getDb(), args.session_id)
}

/**
 * 이 활동에 리포트가 **이미 있나.** 종료 API 의 `report: 'queued' | 'exists'` 가 이것으로 갈린다.
 *
 * ⚠️ 리포트 도메인에서 **부작용 없는 읽기 하나**만 물어 온다. 그쪽 service 층의 문
 * (`readParentReport()`)은 없으면 스스로 리포트를 띄우는데, 부르는 쪽이 곧바로
 * `queueReport()` 를 부르므로 그게 겹친다. `src/report/**` 는 #45 가 못 고치는 자리라
 * (#43 이 끝냈다) repo 의 순수 읽기를 그대로 쓴다.
 * 🟡 되돌리기 쉽다 — `src/report/service` 에 부작용 없는 문이 생기면 그것으로 바꾼다.
 */
export async function postActivityReportExists(
  args: PostActivityConnArgs & { session_id: string },
): Promise<boolean> {
  return (await readReport(args.conn ?? getDb(), args.session_id)) !== null
}
