/**
 * 저쪽(팀 레포) DB 로 한 회차를 끝까지 돌린다 — 이슈 #26 「다음 할 일」 7.
 *
 * ── 돌리는 법 ────────────────────────────────────────────────
 *   cd web && npx tsx tools/완주-저쪽DB.ts
 *
 * ⚠️ **진짜 LLM 을 부르고 진짜 행을 남긴다.** `DATABASE_URL` 이 어디를 가리키는지 먼저 봐라.
 *
 * ── 왜 이렇게 도나 ───────────────────────────────────────────
 *   화면이 누르는 경로 그대로다: startRun → advanceRun → submitTurn → advanceRun …
 *   `runStory()` 를 안 쓴다 — 화면은 그것을 못 부르고, 버그는 호출과 호출 **사이**에 산다.
 *
 * ── 되돌리기 ─────────────────────────────────────────────────
 *   delete from public.story_sessions where child_id = '<GQ_EXPERIMENT_CHILD_ID>';
 *   관련 FK 가 전부 CASCADE 라 메시지·분석·회차·LLM기록·판정이 따라 사라진다.
 */

import { sql } from 'drizzle-orm'

import { closeDb, getDb } from '@/llm/repo/db'
import { advanceRun, startRun, submitTurn } from '@/llm/service/run'

/** `docs/설계/회차_대본.md` 의 대본 그대로. 장면 번호 → 아이 발화. */
const 대본: Record<number, readonly string[]> = {
  3: [
    '며느리 입장에서는 가족들이 흉볼까 봐 무서웠을 거야. 나도 창피할 때는 숨기고 싶어서 마음이 아팠어.',
    '계속 참으면 배가 아프고 몸이 더 나빠지니까, 솔직하게 말하고 방귀가 나올 때는 밖에 나가서 뀌면 돼.',
  ],
  5: ['몰라요', '음... 그냥요', '히히 방귀 뿡!', '잘 모르겠어요', '그냥요'],
  7: [
    '며느리가 나무 앞에서 방귀를 뀌면 배가 떨어져요. 방귀 바람이 아주 세니까요.',
    '며느리한테 도와달라고 부탁해 보세요.',
    '그러면 배가 우수수 떨어져서 마을 사람들이 다 나눠 먹을 수 있어요.',
  ],
  9: [
    '부끄러워했던 마음 알 것 같아. 며느리 입장에서는 계속 숨기고 싶었을 테니까.',
    '덕분에 마을 사람들이 배를 다 먹었잖아. 앞으로는 도움이 필요할 때 조심해서 쓰면 돼.',
  ],
}

/** 대본이 떨어졌을 때 쓰는 말. 진짜 LLM 이라 턴 수는 매번 달라진다. */
const 여분 = '음, 그렇구나. 그러면 서로 이야기해 보면 좋겠어.'

async function main(): Promise<void> {
  const conn = getDb()

  const { run, session_id } = await startRun(conn, {
    story_code: 'fart-bride',
    scope: 'story',
    scene_order: null,
    started_by: '완주 — 저쪽 DB (이슈 26 · 7)',
  })
  console.log(`\n회차 ${run.id}\n세션 ${session_id}\n`)

  const 남은: Record<number, string[]> = Object.fromEntries(
    Object.entries(대본).map(([k, v]) => [k, [...v]]),
  )

  let step = await advanceRun(conn, run.id)
  let 턴 = 0

  while (step.kind !== '회차끝') {
    if (step.kind !== '발화받기' || step.scene_id === null) {
      step = await advanceRun(conn, run.id)
      continue
    }

    const 행들 = (await conn.execute(
      sql`select scene_order from public.story_scenes where id = ${step.scene_id}`,
    )) as unknown as { scene_order: number }[]
    const 장면 = Number(행들[0].scene_order)

    const 발화 = 남은[장면]?.shift() ?? 여분
    턴 += 1

    const t0 = Date.now()
    const r = await submitTurn({ run_id: run.id, child_utterance: 발화 })
    const 걸린 = Date.now() - t0

    // 로그는 DB 컬럼명을 그대로 찍는다 (CLAUDE.md 「로그」).
    console.log(
      [
        `턴 ${String(턴).padStart(2)} · 장면 ${장면} · ${걸린}ms · "${발화.slice(0, 24)}…"`,
        `   [분석] child_intent=${r.analysis.child_intent} detected_elements=${JSON.stringify(
          r.analysis.detected_elements,
        )} utterance_validity=${r.analysis.utterance_validity}`,
        `   [상태] current_child_turn_count=${r.saved_state.current_child_turn_count} accumulated_elements=${JSON.stringify(
          r.saved_state.accumulated_elements,
        )} missing=${JSON.stringify(r.missing)}`,
        `   [판정] response_mode=${r.decision.response_mode} scene_goal_met=${r.decision.scene_goal_met} scene_end_reason=${r.decision.scene_end_reason ?? 'null'}`,
        `   [LLM ] 분석 ${r.llm.provider}/${r.llm.model} · 캐릭터 ${
          r.dialogue.llm === null ? '안 부름 (고정 대사)' : `${r.dialogue.llm.provider}/${r.dialogue.llm.model}`
        } · source=${r.dialogue.source}`,
        `   [대사] ${r.dialogue.text.slice(0, 70)}`,
      ].join('\n'),
    )

    step = await advanceRun(conn, run.id)
  }

  console.log(`\n✅ 회차끝 — 아이 턴 ${턴}`)
  console.log(`   run_id     = ${run.id}`)
  console.log(`   session_id = ${session_id}`)
}

main()
  .catch((오류: unknown) => {
    process.exitCode = 1
    console.error(오류)
  })
  .finally(() => closeDb())
