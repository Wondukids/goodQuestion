// 경계 채점을 **눈으로 보는 자리** — 회차 목록의 위반율과 턴 상세의 검사 표 (이슈 #26 일감 10).
//
// 파이썬 `저장.자동_채점_집계()` + `routes/runs.py:회차_목록()` 의 `score` 칸을 옮기고,
// 파이썬에 없던 「이 턴에서 어느 검사가 걸렸나」를 더한 자리다. 채점기(`lib/judge.ts`)는
// 2026-08-14 부터 턴마다 도는데 **그 결과를 보여 주는 화면이 하나도 없었다** — 확인하려면
// `gq_admin.scores` 를 직접 봐야 했다.
//
// ## 이 파일이 지키는 것 넷
//
// 1. 🔴 **「판정 안 함」(`value IS NULL`)은 분모에서 빠진다** (결정 29). 「검사 조건이 안 섰다」를
//    「지켰다」로 세면 위반율이 조용히 낮아진다. 그리고 빠진 건수는 **화면에 함께 보인다** —
//    안 보이면 낮은 위반율이 「잘 지켰다」인지 「잰 것이 없다」인지 못 가른다.
// 2. **같은 칸에 판정이 두 번 쌓이면 최신 것만 센다.** `scores` 는 덧붙이기 전용이라
//    (FR-047) 턴을 다시 돌리면 행이 하나 더 생긴다. 창(`row_number() OVER`)이 빠지면
//    다시 돌릴수록 옛 판정이 위반율에 계속 남는다.
// 3. ⛔ **자동 채점과 사람 판정은 섞이지 않는다.** 검수 화면은 `graded_by <> 'auto'` 로 자동을
//    빼고, 이 칸들은 `graded_by = 'auto'` 만 본다. 방향만 반대인 같은 선이다.
// 4. **회차를 돌리면 그 값이 실제로 목록·턴 상세에 실린다** — 조립만 맞고 배선이 빠지는 것이
//    이 레포에서 실제로 났던 일이라 마지막 검사는 가짜 SDK 로 한 장면을 끝까지 돈다
//    (`tests/full-run.test.ts` 의 모양을 따랐다. 그 파일은 남이 쥐고 있어 손대지 않았다).
//
// ## 진짜 DB 를 쓰고 끝나면 되돌린다
//
// `tests/cost.test.ts`·`tests/review.test.ts` 와 같은 방식이다. DB 가 없으면 **건너뛴다.**
// 화면은 `page.tsx` 대신 그 쪽이 그리는 조각(`자동채점칸`·`경계채점표`)을 그려 마크업을 본다 —
// `page.tsx` 의 `connection()` 은 Next 요청 문맥 밖에서 터진다 (`tests/cost.test.ts` 머리말).

import { randomUUID } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, describe, expect, it, vi } from 'vitest'

import {
  characters,
  messages,
  runs,
  scores,
  stories,
  story_scenes,
  story_sessions,
} from '@/llm/db/schema'
import { closeDb, getDb, type Conn } from '@/llm/repo/db'
import { autoScoreSummary, currentAutoScores, reviewRecords } from '@/llm/repo/review'
import { readRun } from '@/llm/repo/runs'
import { advanceStep, runState, startRunStep, submitTurn } from '@/llm/service/run'
import { listRunsView, turnAttempts } from '@/llm/service/view'

import { 경계채점표 } from '@/app/(admin)/runs/[run_id]/turns/[message_id]/ui'
import { 자동채점칸 } from '@/app/(admin)/runs/ui'

import { installFakeSdk } from './support/sdk-gate'

// ── DB 가 있나 (repo.test.ts 와 같은 문지기) ───────────────────────────────

async function 붙어보기(): Promise<string | null> {
  try {
    await getDb().execute(sql`select 1`)
    return null
  } catch (오류) {
    if (오류 instanceof Error && 오류.cause instanceof Error) {
      return `${오류.cause.name}: ${오류.cause.message}`
    }
    return 오류 instanceof Error ? `${오류.name}: ${오류.message}` : String(오류)
  }
}

const 못붙는_이유 = await 붙어보기()
if (못붙는_이유 !== null) {
  process.stderr.write(
    `\n[자동채점-화면.test] Postgres 에 못 붙어 자동 채점 화면 검사를 건너뛴다 (도커가 꺼져 있나?)\n` +
      `                     ${못붙는_이유}\n\n`,
  )
}
const 검사 = 못붙는_이유 === null ? describe : describe.skip

afterAll(async () => {
  await closeDb()
})

class 되돌림 extends Error {}

/** 이 안에서 넣은 행은 검사가 끝나면 전부 사라진다. */
async function 트랜잭션(본문: (tx: Conn) => Promise<void>): Promise<void> {
  try {
    await getDb().transaction(async (tx) => {
      await 본문(tx)
      throw new 되돌림('검사가 끝났으니 되돌린다')
    })
  } catch (오류) {
    if (!(오류 instanceof 되돌림)) throw 오류
  }
}

// ── 채점을 매달 자리 하나 (`tests/cost.test.ts` 의 `회차_하나` 를 본떴다) ──

async function 회차_하나(tx: Conn): Promise<{ run_id: string; message_id: string }> {
  const 꼬리 = randomUUID().slice(0, 8)
  const [이야기] = await tx
    .insert(stories)
    .values({
      slug: `s-auto-${꼬리}`,
      title: `자동 채점 검사 ${꼬리}`,
      summary: '검사용',
      difficulty: '보통',
      status: 'draft',
    })
    .returning({ id: stories.id })
  const [캐릭터] = await tx
    .insert(characters)
    .values({
      story_id: 이야기.id,
      code: `ch_auto_${꼬리}`,
      name: '며느리',
      persona: '며느리',
      speech_style: '옛이야기',
      guidance_style: '걱정을 말한다',
      forbidden: [],
    })
    .returning({ id: characters.id })
  const [장면] = await tx
    .insert(story_scenes)
    .values({
      story_id: 이야기.id,
      code: `sc_auto_${꼬리}`,
      scene_order: 1,
      conflict: '갈등',
      character_id: 캐릭터.id,
      character_name: '며느리',
      character_opening: '첫 대사',
      character_closing: '끝 대사',
      scene_stance: '아직 참고 있다',
      scene_goal: '장면 목표',
      required_elements: ['EMPATHY'],
      preferred_turns: 2,
      max_turns: 4,
    })
    .returning({ id: story_scenes.id })
  const [세션] = await tx
    .insert(story_sessions)
    .values({
      child_id: randomUUID(),
      story_id: 이야기.id,
      current_scene_id: 장면.id,
      status: 'in_progress',
    })
    .returning({ id: story_sessions.id })
  const [회차] = await tx
    .insert(runs)
    .values({
      session_id: 세션.id,
      scope: 'scene',
      scene_order: 1,
      analysis_model: 'gemini-3.5-flash-lite',
      analysis_effort: 'medium',
      default_utterance_source: 'synthetic_adult',
      prompt_version: 'v1',
    })
    .returning({ id: runs.id })
  const [메시지] = await tx
    .insert(messages)
    .values({
      session_id: 세션.id,
      scene_id: 장면.id,
      speaker_type: 'child',
      turn_order: 1,
      text: '며느리가 불쌍해',
      utterance_source: 'synthetic_adult',
    })
    .returning({ id: messages.id })
  return { run_id: 회차.id, message_id: 메시지.id }
}

/** 판정 한 칸. `created_at` 을 직접 주는 것은 「어느 것이 최신인가」를 검사가 정하기 위해서다. */
async function 채점_넣기(
  tx: Conn,
  값: {
    run_id: string
    message_id: string
    check_name: string
    value: number | null
    comment?: string
    graded_by?: string
    created_at?: Date
  },
): Promise<void> {
  await tx.insert(scores).values({
    run_id: 값.run_id,
    message_id: 값.message_id,
    llm_call_id: null,
    target: 'utterance',
    check_name: 값.check_name,
    value: 값.value,
    comment: 값.comment ?? '',
    violated_item: null,
    graded_by: 값.graded_by ?? 'auto',
    created_at: 값.created_at ?? new Date('2026-08-14T00:00:00Z'),
  })
}

/** 이 회차에 `scored_at` 을 찍는다 (회차를 닫은 것과 같은 자리 · `markRunScored`). */
async function 채점완료(tx: Conn, run_id: string): Promise<void> {
  await tx.update(runs).set({ scored_at: new Date() }).where(eq(runs.id, run_id))
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. 집계 — 무엇을 세고 무엇을 빼나
// ═══════════════════════════════════════════════════════════════════════════

검사('autoScoreSummary — 파이썬 `자동_채점_집계`', () => {
  it('🔴 「판정 안 함」은 분모에서 빠지고, 몇 건이 빠졌는지가 따로 남는다 (결정 29)', async () => {
    await 트랜잭션(async (tx) => {
      const { run_id, message_id } = await 회차_하나(tx)
      await 채점_넣기(tx, { run_id, message_id, check_name: 'fabricated_fixed_line', value: 1.0 })
      await 채점_넣기(tx, {
        run_id,
        message_id,
        check_name: 'scene_goal_leak',
        value: 0.0,
        comment: '장면 목표의 «며느리의 마음» 가 대사에 그대로 나왔다',
      })
      await 채점_넣기(tx, {
        run_id,
        message_id,
        check_name: 'closing_generated',
        value: null,
        comment: 'NORMAL 턴이라 이 검사를 하지 않았다',
      })

      const 집계 = await autoScoreSummary(tx, { run_id })
      expect(집계).toEqual({
        graded_count: 2,
        violation_count: 1,
        unscored_count: 1,
        // 🔴 1/2 이지 1/3 이 아니다. 판정 안 한 칸을 분모에 넣으면 33.3% 로 낮아진다.
        violation_rate: 0.5,
      })
    })
  })

  it('판정한 것이 하나도 없으면 위반율은 `null` 이다 — **0 이 아니다**', async () => {
    await 트랜잭션(async (tx) => {
      const { run_id, message_id } = await 회차_하나(tx)
      await 채점_넣기(tx, { run_id, message_id, check_name: 'closing_generated', value: null })
      await 채점_넣기(tx, { run_id, message_id, check_name: 'scene_goal_leak', value: null })

      const 집계 = await autoScoreSummary(tx, { run_id })
      expect(집계.violation_rate).toBeNull()
      expect(집계.graded_count).toBe(0)
      expect(집계.unscored_count).toBe(2)
    })
  })

  it('⭐ 같은 칸에 두 번 쌓이면 **최신 것만** 센다 (`scores` 는 덧붙이기 전용이라 · FR-047)', async () => {
    await 트랜잭션(async (tx) => {
      const { run_id, message_id } = await 회차_하나(tx)
      // 처음 돌렸을 때 위반. 그 뒤 대사를 다시 뽑아 지킴으로 바뀌었다.
      await 채점_넣기(tx, {
        run_id,
        message_id,
        check_name: 'scene_goal_leak',
        value: 0.0,
        comment: '옛 판정',
        created_at: new Date('2026-08-14T00:00:00Z'),
      })
      await 채점_넣기(tx, {
        run_id,
        message_id,
        check_name: 'scene_goal_leak',
        value: 1.0,
        comment: '다시 돌린 판정',
        created_at: new Date('2026-08-14T01:00:00Z'),
      })

      const 집계 = await autoScoreSummary(tx, { run_id })
      // 창이 빠지면 여기가 graded 2 · violation 1 (50%) 이 된다 — 다시 돌릴수록 옛 판정이 남는다.
      expect(집계).toEqual({
        graded_count: 1,
        violation_count: 0,
        unscored_count: 0,
        violation_rate: 0,
      })

      const 현재 = await currentAutoScores(tx, { run_id })
      expect(현재.map((행) => 행.comment)).toEqual(['다시 돌린 판정'])
    })
  })

  it('⛔ 사람이 매긴 판정은 이 집계에 안 섞이고, 검수 이력에는 자동이 안 섞인다', async () => {
    await 트랜잭션(async (tx) => {
      const { run_id, message_id } = await 회차_하나(tx)
      await 채점_넣기(tx, { run_id, message_id, check_name: 'scene_goal_leak', value: 1.0 })
      // 같은 턴을 사람이 「넘음」으로 봤다. 잣대가 다른 두 이력이라 한 칸에 담지 않는다.
      await 채점_넣기(tx, {
        run_id,
        message_id,
        check_name: 'utterance',
        value: 0.0,
        graded_by: 'tester@example.com',
      })

      const 집계 = await autoScoreSummary(tx, { run_id })
      expect(집계).toEqual({
        graded_count: 1,
        violation_count: 0,
        unscored_count: 0,
        violation_rate: 0,
      })

      // 반대 방향도 그대로다 — 검수 화면의 필터를 푼 적이 없다.
      const 사람_이력 = await reviewRecords(tx, { run_id })
      expect(사람_이력.map((행) => 행.graded_by)).toEqual(['tester@example.com'])
    })
  })

  it('`message_id` 를 주면 그 턴 하나로 좁힌다 (턴 상세가 쓰는 자리)', async () => {
    await 트랜잭션(async (tx) => {
      const { run_id, message_id } = await 회차_하나(tx)
      const [다른_턴] = await tx
        .insert(messages)
        .values({
          session_id: (await readRun(tx, run_id)).session_id,
          scene_id: (await tx.select({ id: messages.scene_id }).from(messages).where(eq(messages.id, message_id)))[0].id,
          speaker_type: 'child',
          turn_order: 2,
          text: '두 번째 발화',
          utterance_source: 'synthetic_adult',
        })
        .returning({ id: messages.id })

      await 채점_넣기(tx, { run_id, message_id, check_name: 'scene_goal_leak', value: 1.0 })
      await 채점_넣기(tx, {
        run_id,
        message_id: 다른_턴.id,
        check_name: 'scene_goal_leak',
        value: 0.0,
      })

      const 이_턴 = await currentAutoScores(tx, { run_id, message_id })
      expect(이_턴).toHaveLength(1)
      expect(이_턴[0].value).toBe(1)
      // 회차 집계는 둘 다 본다 — 좁히는 것은 턴 상세뿐이다.
      expect((await autoScoreSummary(tx, { run_id })).graded_count).toBe(2)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. 조립과 화면 — 값이 실리고, 세 상태가 눈으로 갈리나
// ═══════════════════════════════════════════════════════════════════════════

검사('회차 목록의 「자동 채점」 칸', () => {
  it('`scored_at` 이 `null` 이면 집계를 아예 안 싣는다 (파이썬 `routes/runs.py:229`)', async () => {
    await 트랜잭션(async (tx) => {
      const { run_id, message_id } = await 회차_하나(tx)
      // 채점 행이 있어도 회차가 안 닫혔으면 「채점 안 함」이다 — 도는 중인 회차의 위반율은
      // 「지금까지의 위반율」이라 회차끼리 견주는 값이 못 된다.
      await 채점_넣기(tx, { run_id, message_id, check_name: 'scene_goal_leak', value: 0.0 })

      const 목록 = await listRunsView(tx)
      expect(목록.find((회차) => 회차.id === run_id)?.score).toBeNull()

      await 채점완료(tx, run_id)
      const 닫힌_뒤 = await listRunsView(tx)
      expect(닫힌_뒤.find((회차) => 회차.id === run_id)?.score).toEqual({
        graded_count: 1,
        violation_count: 1,
        unscored_count: 0,
        violation_rate: 1,
      })
    })
  })

  it('화면이 세 갈래를 갈라 그린다 — 채점 안 함 · 판정 가능한 검사 없음 · 위반율', () => {
    const 그린다 = (요약: Parameters<typeof 자동채점칸>[0]['요약']) =>
      renderToStaticMarkup(createElement(자동채점칸, { 요약 }))

    expect(그린다(null)).toContain('채점 안 함')

    // 🔴 판정된 칸이 없으면 「위반 0%」라고 쓰지 않는다.
    const 못잼 = 그린다({
      graded_count: 0,
      violation_count: 0,
      unscored_count: 3,
      violation_rate: null,
    })
    expect(못잼).toContain('판정 가능한 검사 없음')
    expect(못잼).toContain('판정 불가 3건')
    expect(못잼).not.toContain('위반 0.0%')

    const 잼 = 그린다({
      graded_count: 2,
      violation_count: 1,
      unscored_count: 1,
      violation_rate: 0.5,
    })
    expect(잼).toContain('위반 50.0%')
    // 🔴 분모에서 빠진 건수가 **늘 옆에 붙는다**. 안 보이면 낮은 위반율의 뜻이 갈린다.
    expect(잼).toContain('판정 불가 1건')
    expect(잼).toContain('(1/2)')
  })
})

검사('턴 상세의 경계 채점표', () => {
  it('⭐ 지킴 · 위반 · 판정 안 함이 **눈으로 갈리고**, 위반의 comment 가 그대로 보인다', async () => {
    await 트랜잭션(async (tx) => {
      const { run_id, message_id } = await 회차_하나(tx)
      await 채점_넣기(tx, { run_id, message_id, check_name: 'fabricated_fixed_line', value: 1.0 })
      await 채점_넣기(tx, {
        run_id,
        message_id,
        check_name: 'scene_goal_leak',
        value: 0.0,
        comment: '장면 목표의 «며느리의 마음» 가 대사에 그대로 나왔다',
      })
      await 채점_넣기(tx, {
        run_id,
        message_id,
        check_name: 'closing_generated',
        value: null,
        comment: 'NORMAL 턴이라 이 검사를 하지 않았다',
      })

      // 🔴 `scores.message_id` 는 **아이 발화 id** 다 — 이 화면이 쥔 값과 같은 자리다.
      const 본_것 = await turnAttempts(run_id, message_id, tx)
      // ⚠️ 셋을 같은 `created_at` 으로 넣었으니 순서는 `id` 가 정한다 — 여기서 순서는 안 잰다.
      expect(본_것.auto_scores.map((행) => 행.check_name).sort()).toEqual([
        'closing_generated',
        'fabricated_fixed_line',
        'scene_goal_leak',
      ])

      const 마크업 = renderToStaticMarkup(
        createElement(경계채점표, { 채점들: 본_것.auto_scores }),
      )
      // 검사 이름을 그대로 찍는다 — 화면에서 본 이름으로 `scores` 를 바로 찾을 수 있어야 한다.
      expect(마크업).toContain('fabricated_fixed_line')
      expect(마크업).toContain('scene_goal_leak')
      expect(마크업).toContain('closing_generated')
      // 세 상태가 다른 글자다. 「판정 안 함」이 「지킴」으로 보이면 이 채점기의 규칙이 깨진다.
      expect(마크업).toContain('지킴')
      expect(마크업).toContain('위반')
      expect(마크업).toContain('판정 안 함')
      expect(마크업).toContain('value=null')
      // 위반은 굵고 빨갛다 — 훑을 때 걸려야 한다.
      expect(마크업).toMatch(/font-bold text-red-600[^>]*>위반</)
      // 무엇이 걸렸는지는 comment 에만 있다. 요약하지 않는다.
      expect(마크업).toContain('«며느리의 마음» 가 대사에 그대로 나왔다')
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. 배선 — 진짜로 한 장면을 돌리면 목록과 턴 상세에 값이 실리나
// ═══════════════════════════════════════════════════════════════════════════
//
// 조립이 맞아도 배선이 빠지면 화면은 빈 칸이다. 그래서 `tests/full-run.test.ts` 와 같은 길
// (`startRunStep` → `advanceStep` → `submitTurn`)로 **대화 장면 하나**를 끝까지 돈다.
// 9장면 완주는 저쪽이 이미 지키고 있으므로 여기서는 배선만 본다.

/** SDK 자리에 꽂는 가짜 제미나이 (`tests/full-run.test.ts` 의 것을 줄였다). */
function 가짜_제미나이(): { 호출: number } {
  const 기록 = { 호출: 0 }
  installFakeSdk('gemini', () => ({
    interactions: {
      create: async (요청: Record<string, unknown>) => {
        기록.호출 += 1
        const user = String(요청.input ?? '')
        // 분석만 JSON 스키마를 실어 보낸다 (`lib/llm/index.ts` 의 `geminiRequest()`).
        if (요청.response_format === undefined) {
          return {
            output_text: '그러게 말이다',
            usage_metadata: { prompt_token_count: 200, candidates_token_count: 30 },
          }
        }
        const 목표 = /"target_elements":\[([^\]]*)\]/.exec(user)
        const 요소들 =
          목표 === null || 목표[1].trim() === ''
            ? []
            : (JSON.parse(`[${목표[1]}]`) as string[])
        const 발화 = /"child_utterance":"((?:[^"\\]|\\.)*)"/.exec(user)
        const 원문 = 발화 === null ? '' : (JSON.parse(`"${발화[1]}"`) as string)
        return {
          output_text: JSON.stringify({
            child_intent: 'OPINION',
            main_point: 원문,
            // evidence 를 아이 발화 원문으로 둔다 — 후처리(`postProcess`)를 그대로 통과한다.
            detected_elements: 요소들.map((type) => ({ type, evidence: 원문 })),
            utterance_validity: 'VALID',
          }),
          usage_metadata: { prompt_token_count: 100, candidates_token_count: 20 },
        }
      },
    },
  }))
  return 기록
}

검사('⭐ 한 장면을 돌리면 목록과 턴 상세에 값이 실린다', () => {
  it('`scored_at` 이 찍히고, 위반율과 턴별 검사 셋이 화면 조립에 그대로 온다', async () => {
    가짜_제미나이()
    // 콘솔 세 줄이 검사 출력에 섞이지 않게 삼킨다 (`full-run.test.ts` 와 같은 처리).
    const 원래_log = vi.spyOn(console, 'log').mockImplementation(() => {})

    try {
      await 트랜잭션(async (tx) => {
        const { run } = await startRunStep({
          story_code: 'fart-bride',
          // 대화 장면 하나(3장면)만 돈다 — 배선을 재는 데 아홉 장면이 필요하지 않다.
          scope: 'scene',
          scene_order: 3,
          started_by: '자동 채점 화면 검사',
          analysis_model: null,
          analysis_effort: null,
          character_model: null,
          character_effort: null,
          conn: tx,
        })

        const 아이_턴들: string[] = []
        for (let 걸음 = 0; ; 걸음 += 1) {
          if (걸음 > 20) throw new Error(`장면이 안 끝난다 — ${걸음} 걸음째`)
          const { step } = await runState(tx, run.id)
          if (step.kind === '회차끝') break
          if (step.kind === '장면시작') {
            await advanceStep({ run_id: run.id, conn: tx })
            continue
          }
          const 결과 = await submitTurn({
            run_id: run.id,
            child_utterance: `며느리가 창피했을 것 같아 (${걸음})`,
            conn: tx,
          })
          아이_턴들.push(결과.child_message_id)
        }

        // 회차가 닫히며 `scored_at` 이 찍힌다 (`completeRun()` · 파이썬 `회차_채점완료`).
        expect((await readRun(tx, run.id)).scored_at).not.toBeNull()

        // ── 목록에 실렸나 ──────────────────────────────────────────────
        const 줄 = (await listRunsView(tx)).find((회차) => 회차.id === run.id)
        expect(줄?.score).not.toBeNull()
        // 순수 검사 셋이 턴마다 돈다 (심판은 기본 꺼짐이라 LLM 을 안 탄다).
        const 집계 = 줄!.score!
        expect(집계.graded_count + 집계.unscored_count).toBe(아이_턴들.length * 3)
        // 대본대로 돌면 걸릴 것이 없다. 위반이 있으면 채점기나 재료 조립이 바뀐 것이다.
        expect(집계.violation_count).toBe(0)
        // CLOSING 이 아닌 턴의 `closing_generated` 가 「판정 안 함」으로 빠진다.
        expect(집계.unscored_count).toBeGreaterThan(0)

        // ── 턴 상세에 실렸나 ──────────────────────────────────────────
        for (const message_id of 아이_턴들) {
          const 본_것 = await turnAttempts(run.id, message_id, tx)
          expect(본_것.auto_scores.map((행) => 행.check_name).sort()).toEqual([
            'closing_generated',
            'fabricated_fixed_line',
            'scene_goal_leak',
          ])
          expect(본_것.auto_scores.every((행) => 행.graded_by === 'auto')).toBe(true)

          const 마크업 = renderToStaticMarkup(
            createElement(경계채점표, { 채점들: 본_것.auto_scores }),
          )
          expect(마크업).toContain('scene_goal_leak')
        }
      })
    } finally {
      원래_log.mockRestore()
    }
  })
})
