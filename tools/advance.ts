// 이미 열린 회차를 **다음 대화 장면까지** 밀어 준다.
//
// 장면 시작과 전개 재생은 **라우트가 아니다** (`docs/설계/라우트계약.md` 7절) —
// 화면이 서버에서 `service` 를 직접 부른다. 화면이 아직 없어서 이 스크립트가 그 자리를 맡는다.
//
// 쓰는 법:  cd web && npx tsx tools/advance.ts <run_id>
//
// ⛔ LLM 을 부르지 않는다. 전개 지문과 고정 첫 대사는 DB 텍스트다.

import { getDb, closeDb } from '@/llm/repo/db'
import { advanceRun } from '@/llm/service/run'

async function main(): Promise<void> {
  const run_id = process.argv[2]
  if (!run_id) {
    console.error('쓰는 법: npx tsx tools/advance.ts <run_id>')
    process.exit(1)
  }

  const step = await advanceRun(getDb(), run_id)
  console.log(`\n  다음 할 일 = ${step.kind}${step.reason ? ` (${step.reason})` : ''}`)
  if (step.scene_id) console.log(`  scene_id   = ${step.scene_id}`)
}

main()
  .catch((오류: unknown) => {
    console.error(오류)
    process.exitCode = 1
  })
  .finally(() => closeDb())
