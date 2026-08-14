/**
 * 회차 하나를 열고 `run_id`·`session_id` 를 찍는다.
 *
 * ── 돌리는 법 ────────────────────────────────────────────────
 *   cd web
 *   npx tsx tools/start-run.ts
 *   npx tsx tools/start-run.ts --story fart-bride --scope scene --scene 3
 *
 * ── ⛔ 왜 라우트가 아니라 스크립트인가 ───────────────────────
 *   **세션을 만드는 라우트는 넷 안에 없다** (`docs/설계/라우트계약.md` 7절).
 *   회차 시작 화면이 서버에서 `startRun()` 을 직접 부르는 것이 계약이고,
 *   HTTP 로 세션을 여는 다섯째 라우트를 두면 계약을 어긴다.
 *   그런데 화면(화면-3)이 아직 없어 **서버를 띄워 한 회차를 끝까지 돌려 볼 방법**이
 *   없으므로, 그 자리를 이 스크립트가 임시로 메운다. 화면이 서면 지워도 된다.
 *
 * ── 무엇을 하나 ──────────────────────────────────────────────
 *   1. `startRun()` — `story_sessions` 한 행 + `runs` 한 행을 **함께** 만든다
 *   2. `advanceRun()` — 다음 **대화** 장면에 닿을 때까지 전개를 재생하고 고정 첫 대사를 넣는다
 *   3. `run_id`·`session_id` 와 멈춘 자리(`발화받기` 여야 한다)를 찍는다
 *
 *   ⛔ LLM 을 한 번도 부르지 않는다. 전개 재생도 고정 첫 대사도 DB 의 고정 텍스트다.
 *
 * ── 그다음 ───────────────────────────────────────────────────
 *   찍힌 `session_id` 를 들고 라우트 셋을 차례로 두드리면 한 턴이 돈다.
 *     POST /api/v1/analysis  { session_id, child_utterance }
 *     POST /api/v1/decision  { session_id, message_id, analysis }
 *     POST /api/v1/dialogue  { session_id, message_id, response_mode, ... }
 *   ⚠️ ①③ 은 **진짜 LLM 을 부른다.** 키가 꽂혀 있으면 돈이 나간다.
 */

import { closeDb, getDb } from '@/llm/repo/db'
import { advanceRun, startRun } from '@/llm/service/run'

interface 옵션 {
  story_code: string
  scope: 'scene' | 'story'
  scene_order: number | null
  started_by: string | null
}

function 인자_읽기(argv: readonly string[]): 옵션 {
  const 값 = (이름: string): string | null => {
    const 자리 = argv.indexOf(`--${이름}`)
    return 자리 === -1 || 자리 + 1 >= argv.length ? null : argv[자리 + 1]
  }

  const scope = 값('scope') ?? 'story'
  if (scope !== 'scene' && scope !== 'story') {
    throw new Error(`--scope 는 scene 또는 story 다: ${scope}`)
  }
  const 장면 = 값('scene')
  if (scope === 'scene' && 장면 === null) {
    // `runs_scene_order_check` 가 어차피 막는다. 먼저 사람 말로 알려 준다.
    throw new Error('--scope scene 에는 --scene <scene_order> 가 필요하다')
  }

  return {
    story_code: 값('story') ?? 'fart-bride',
    scope,
    scene_order: 장면 === null ? null : Number(장면),
    started_by: 값('by'),
  }
}

async function main(): Promise<void> {
  const 옵션 = 인자_읽기(process.argv.slice(2))
  const conn = getDb()

  const { run, session_id } = await startRun(conn, {
    story_code: 옵션.story_code,
    scope: 옵션.scope,
    scene_order: 옵션.scene_order,
    started_by: 옵션.started_by,
  })

  // 대화 장면에 닿을 때까지 전개를 재생한다. 안 하면 세션의 현재 장면이 null 이라
  // ① 이 409 `TURN_NOT_ALLOWED` 로 튕긴다 (계약 7절 표).
  const step = await advanceRun(conn, run.id)

  process.stdout.write(
    [
      '',
      '── 회차를 열었다 ────────────────────────────────',
      `  run_id     = ${run.id}`,
      `  session_id = ${session_id}`,
      `  story      = ${옵션.story_code}`,
      `  scope      = ${옵션.scope}${옵션.scene_order === null ? '' : ` (scene_order=${옵션.scene_order})`}`,
      `  다음 할 일  = ${step.kind}${step.scene_id === null ? '' : ` (scene_id=${step.scene_id})`}`,
      '',
      step.kind === '발화받기'
        ? '  ✅ 아이 발화를 받을 자리다. POST /api/v1/analysis 부터 부르면 된다.'
        : `  ⚠️ 발화받기 가 아니다 (${step.kind}). 이 상태로 ① 을 부르면 409 TURN_NOT_ALLOWED 다.`,
      '',
    ].join('\n'),
  )
}

// ⚠️ 최상위 `await` 를 쓰지 않는다 — `tsx` 가 이 파일을 cjs 로 옮겨 담아 터진다
//    (`package.json` 에 `"type": "module"` 이 없다). `db/seed.ts` 와 같은 모양이다.
main()
  .catch((오류: unknown) => {
    process.exitCode = 1
    process.stderr.write(`\n${오류 instanceof Error ? 오류.message : String(오류)}\n\n`)
  })
  // 스크립트라 안 닫으면 프로세스가 안 끝난다 (`lib/repo/db.ts` 의 `closeDb()` 머리말).
  .finally(() => closeDb())
