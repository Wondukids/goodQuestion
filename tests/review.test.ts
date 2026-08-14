// 사람 검수 화면 — 파이썬 `tests/test_admin_review.py` 330줄을 옮기고 넓힌 것 (화면-4).
//
// 파이썬이 보던 넷을 그대로 본다.
//
// 1. **보류는 분모에서 빠진다** (FR-045a·b) — 안 그러면 위반율이 조용히 낮아진다.
// 2. **다시 매겨도 앞 판정이 남는다** (FR-047) — `scores` 는 덧붙이기 전용이다.
// 3. **기준이 바뀌면 낮은 판으로 매긴 판정이 「다시 볼 대상」이 된다** (FR-044e · SC-020).
// 4. **내보내기는 사람이 확정한 것만 담는다** (FR-048 · 049).
//
// 여기서 넷을 더 본다 — 파이썬에 없었거나, 있는데 화면 렌더로만 걸리던 것들이다.
//
// 5. ⭐ **점수가 어디에 붙는가** — 대사 판정만 `llm_call_id` 가 붙고 둘 다 `message_id` 는
//    **아이 메시지**다. 이 화면의 존재 이유가 「어느 회차·어느 메시지의 판정인가」라서다.
// 6. ⭐ **다음 턴 대사를 빌려 오지 않는다** (FR-048) — 대사 없는 턴은 「응답 없음」이어야 한다.
// 7. 교정 요소를 **한국어 이름으로 적어도** 코드로 저장된다 (`_요소_코드들`).
// 8. 서버 액션이 어디로 돌아가나 — 조각(`#turn-…`)과 `?error=` 의 순서까지.
//
// ## 진짜 DB 를 쓰고, 끝나면 되돌린다
//
// `tests/repo.test.ts` 와 같은 방식이다. DB 가 없으면 **건너뛴다** — 조용히 통과시키지 않는다.

import { randomUUID } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { characters, corrections, scores, stories, story_scenes } from '@/llm/db/schema'

// ⚠️ 팩토리 안에서 바깥 변수를 참조하면 hoisting 에 걸린다 (`admin.test.ts` 와 같은 상자).
const 상자 = vi.hoisted(() => ({ tx: null as unknown }))

vi.mock('@/llm/repo/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/llm/repo/db')>()
  return { ...real, getDb: () => 상자.tx ?? real.getDb() }
})

// 서버 액션은 판정한 사람을 요청 헤더에서 읽는다 (파이썬 `_사람()`). 검사에는 요청이 없다.
vi.mock('next/headers', () => ({
  // ⚠️ 헤더 값은 ByteString 이라 한글이 못 들어간다. 실제로 오는 값도 로그인 이름이다.
  headers: async () => new Headers({ 'Tailscale-User-Login': 'tester@example.com' }),
}))

import { analysisScoreAction, criterionAction, utteranceScoreAction } from '@/app/(admin)/review/actions'
import { ValueError } from '@/llm/domain/progress'
import type { Attempt } from '@/llm/provider'
import { closeDb, getDb, type Conn } from '@/llm/repo/db'
import {
  currentScores,
  pendingScores,
  reviewTurns,
  staleScores,
  utteranceExportRows,
} from '@/llm/repo/review'
import { createRun, insertAttempts } from '@/llm/repo/runs'
import { createSession, enterScene, insertAnalysis, insertMessage } from '@/llm/repo/sessions'
import {
  exportGoldenset,
  goldensetItems,
  pendingView,
  reviewView,
  saveHumanScore,
  writeCriterion,
  분석_교정,
  요소_코드들,
  판정_항목_이름,
  골든셋_파일_오래됨,
  type ScoreForm,
} from '@/llm/service/review'
import { MessageNotFound } from '@/llm/service/step'

// ── DB 가 있나 ────────────────────────────────────────────────────────────

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
    `\n[review.test] Postgres 에 못 붙어 검수 검사를 건너뛴다 (도커가 꺼져 있나?)\n` +
      `              ${못붙는_이유}\n\n`,
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
      상자.tx = tx
      await 본문(tx)
      throw new 되돌림('검사가 끝났으니 되돌린다')
    })
  } catch (오류) {
    if (!(오류 instanceof 되돌림)) throw 오류
  } finally {
    상자.tx = null
  }
}

// ── 검수거리 ──────────────────────────────────────────────────────────────

const 발화_EMOTION = '며느리가 창피했을 것 같아'

interface 검수거리 {
  run_id: string
  session_id: string
  scene_id: string
  /** 대사가 붙은 아이 메시지. */
  message_id: string
  /** 대사가 **안 붙은** 아이 메시지 (FR-048 을 재는 자리). */
  응답없는_message_id: string
  llm_call_id: string
}

/** `lib/llm` 의 `Attempt` 를 그대로 쓴다 — 옮겨 담는 층이 없다. */
function 시도(고칠_것: Partial<Attempt> = {}): Attempt {
  return {
    purpose: 'character',
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    effort: 'low',
    system_text: '시스템',
    user_text: '사용자',
    response_text: '{"line": "그러게 말이다"}',
    input_tokens: 10,
    output_tokens: 20,
    duration_ms: 12,
    ok: true,
    error: null,
    ...고칠_것,
  }
}

/**
 * 회차 하나에 아이 발화 둘 — 하나는 대사가 붙었고 하나는 안 붙었다.
 *
 * ⛔ LLM 을 부르지 않는다. 검수 화면이 보는 것은 **저장된 사실**뿐이라 손으로 넣으면 된다.
 */
async function 검수거리_만들기(tx: Conn): Promise<검수거리> {
  const 꼬리 = randomUUID().slice(0, 8)
  const [이야기] = await tx
    .insert(stories)
    .values({
      slug: `s-review-${꼬리}`,
      title: `검수 검사 ${꼬리}`,
      summary: '검사용',
      difficulty: '보통',
      status: 'draft',
    })
    .returning({ id: stories.id })

  const [캐릭터] = await tx
    .insert(characters)
    .values({
      story_id: 이야기.id,
      code: 'ch_review_daughter_in_law',
      name: '며느리',
      persona: '시집온 지 얼마 안 된 며느리',
      speech_style: '옛이야기 말투',
      guidance_style: '자기 걱정을 소리 내어 말한다',
      forbidden: ['설명하지 않는다'],
    })
    .returning({ id: characters.id })

  const [장면] = await tx
    .insert(story_scenes)
    .values({
      story_id: 이야기.id,
      code: 'sc_review_01',
      scene_order: 1,
      scene_description: '며느리가 방귀를 참고 있다',
      conflict: '참자니 병이 나고 뀌자니 쫓겨난다',
      character_id: 캐릭터.id,
      character_name: '며느리',
      character_opening: '나는 어쩌면 좋으냐',
      character_closing: '고맙구나',
      scene_stance: '아직 참고 있다',
      scene_goal: '아이가 며느리 마음을 말한다',
      required_elements: ['EMOTION'],
      element_criteria: { EMOTION: '며느리 마음을 짚은 말' },
      remaining_worries: { EMOTION: '이 마음을 누가 알아줄까…' },
      preferred_turns: 2,
      max_turns: 4,
    })
    .returning({ id: story_scenes.id })

  const session_id = await createSession(tx, { story_id: 이야기.id, child_id: randomUUID() })
  await enterScene(tx, session_id, 장면.id)
  const run = await createRun(tx, {
    session_id,
    scope: 'scene',
    scene_order: 1,
    started_by: '검사',
    analysis_model: 'fake-model',
    analysis_effort: null,
    character_model: 'fake-model',
    character_effort: null,
    default_utterance_source: 'synthetic_adult',
    prompt_version: 'mvp_v1',
  })

  const 넣기 = (speaker_type: string, text: string) =>
    insertMessage(tx, {
      session_id,
      scene_id: 장면.id,
      speaker_type,
      text,
      utterance_source: speaker_type === 'child' ? 'synthetic_adult' : null,
    })

  await 넣기('character', '나는 어쩌면 좋으냐')
  const 아이 = await 넣기('child', 발화_EMOTION)
  await 넣기('character', '그러게 말이다')
  // ⭐ 이 발화 뒤에는 캐릭터 대사가 없다. 뒤에 또 아이 발화만 온다.
  const 응답없는_아이 = await 넣기('child', '그래도 참아야 해')
  await 넣기('child', '아니면 말해야 해')
  // ⭐ **다음 턴의** 대사다. 이게 없으면 「빌려 온다」를 재는 검사가 아무것도 못 잡는다 —
  //    빌려 올 대사 자체가 회차에 없기 때문이다.
  await 넣기('character', '남의 대사다')

  for (const id of [아이.id, 응답없는_아이.id]) {
    await insertAnalysis(tx, {
      message_id: id,
      analysis: {
        child_intent: 'EMOTION',
        main_point: '며느리가 창피했다',
        detected_elements: [{ type: 'EMOTION', evidence: '창피했을 것 같아' }],
        utterance_validity: 'VALID',
      },
    })
  }

  const 시도들 = await insertAttempts(tx, {
    run_id: run.id,
    message_id: 아이.id,
    attempts: [시도()],
  })

  return {
    run_id: run.id,
    session_id,
    scene_id: 장면.id,
    message_id: 아이.id,
    응답없는_message_id: 응답없는_아이.id,
    llm_call_id: 시도들[0].id,
  }
}

/** 판정 폼 한 벌. 안 준 칸은 「안 적었다」다. */
function 폼(고칠_것: Partial<ScoreForm> = {}): ScoreForm {
  return { value: 'pass', comment: null, ...고칠_것 }
}

async function 점수_수(tx: Conn, run_id: string): Promise<number> {
  const 행들 = await tx
    .select({ 수: sql<number>`count(*)::int` })
    .from(scores)
    .where(eq(scores.run_id, run_id))
  return 행들[0].수
}

/** 서버 액션을 눌러 본다. `redirect()` 가 던지는 `digest` 에 목적지가 들어 있다. */
async function 눌러본다(
  액션: (폼: FormData) => Promise<void>,
  값들: Record<string, string>,
): Promise<{ 경로: string; 조각: string; error: string | null }> {
  const 폼자료 = new FormData()
  for (const [이름, 값] of Object.entries(값들)) 폼자료.append(이름, 값)

  let 잡힘: unknown = null
  try {
    await 액션(폼자료)
  } catch (오류) {
    잡힘 = 오류
  }
  const digest = (잡힘 as { digest?: string } | null)?.digest
  if (typeof digest !== 'string' || !digest.startsWith('NEXT_REDIRECT')) {
    throw 잡힘 ?? new Error('액션이 아무 데도 안 돌아갔다')
  }
  const 주소 = new URL(digest.split(';')[2], 'http://검사')
  return { 경로: 주소.pathname, 조각: 주소.hash, error: 주소.searchParams.get('error') }
}

// ═══════════════════════════════════════════════════════════════════════════
// 순수 함수 — DB 없이 돈다
// ═══════════════════════════════════════════════════════════════════════════

describe('교정 칸 읽기 — 한국어로 적어도 코드로 저장된다', () => {
  it('요소 이름을 코드로 바꾸고, 모르는 값은 그대로 남긴다', () => {
    // 그대로 남기는 것이 중요하다 — 조용히 버리면 허용 목록 검사가 그것을 못 본다.
    expect(요소_코드들('까닭, 입장')).toEqual(['REASON', 'PERSPECTIVE'])
    expect(요소_코드들('EMOTION,  , 없는것')).toEqual(['EMOTION', '없는것'])
    expect(요소_코드들('')).toEqual([])
  })

  it('하나도 안 적었으면 교정이 아니다', () => {
    expect(분석_교정(폼())).toBeNull()
  })

  it('한 칸이라도 적었으면 의도·유효성·요소가 허용 목록 안이어야 한다', () => {
    const 기본 = {
      correction_child_intent: 'EMOTION',
      correction_utterance_validity: 'VALID',
      correction_detected_elements: '감정',
    }
    expect(분석_교정(폼(기본))).toEqual({
      child_intent: 'EMOTION',
      main_point: null,
      detected_elements: ['EMOTION'],
      utterance_validity: 'VALID',
    })
    expect(() => 분석_교정(폼({ ...기본, correction_child_intent: '없는의도' }))).toThrow(
      ValueError,
    )
    expect(() => 분석_교정(폼({ ...기본, correction_utterance_validity: 'NOPE' }))).toThrow(
      ValueError,
    )
    expect(() => 분석_교정(폼({ ...기본, correction_detected_elements: '없는요소' }))).toThrow(
      ValueError,
    )
    // main_point 만 적어도 나머지가 비면 거절이다 — 반쯤 적힌 정답은 정답지에 못 실린다.
    expect(() => 분석_교정(폼({ correction_main_point: '이랬어야' }))).toThrow(ValueError)
  })

  it('같은 요소를 두 번 적으면 먼저 나온 것만 남는다', () => {
    const 교정 = 분석_교정(
      폼({
        correction_child_intent: 'EMOTION',
        correction_utterance_validity: 'VALID',
        correction_detected_elements: '감정, EMOTION, 까닭',
      }),
    )
    expect(교정?.detected_elements).toEqual(['EMOTION', 'REASON'])
  })
})

describe('항목 이름과 정답지 낡음', () => {
  it('걸린 항목이 없으면 `-`, 모르는 코드는 그대로', () => {
    expect(판정_항목_이름('analysis', null)).toBe('-')
    expect(판정_항목_이름('analysis', 'direct_only')).toBe('발화에서 직접 확인되는 것만 기록했는가')
    expect(판정_항목_이름('utterance', 'no_scene_end')).toBe('장면을 스스로 끝내지 않았는가')
    expect(판정_항목_이름('analysis', '없는코드')).toBe('없는코드')
  })

  it('검수 기록이 하나도 없으면 정답지는 낡을 것도 없다', () => {
    expect(골든셋_파일_오래됨(null)).toBe(false)
    // 파일보다 뒤에 매긴 검수가 있으면 낡은 것이다.
    expect(골든셋_파일_오래됨(new Date(Date.now() + 60_000))).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// DB — 판정 저장
// ═══════════════════════════════════════════════════════════════════════════

검사('판정 저장 — 무엇이 기록으로 남나', () => {
  it('⭐ 대사 판정만 llm_call_id 가 붙고, 둘 다 message_id 는 아이 메시지다', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)

      await saveHumanScore(
        { ...공통(거리), target: 'analysis', form: 폼({ comment: '맞게 잡았다' }) },
        tx,
      )
      await saveHumanScore(
        { ...공통(거리), target: 'utterance', form: 폼({ comment: '대사도 규칙을 지켰다' }) },
        tx,
      )

      const 행들 = await currentScores(tx, { run_id: 거리.run_id })
      const 분석 = 행들.find((행) => 행.target === 'analysis')!
      const 대사 = 행들.find((행) => 행.target === 'utterance')!

      expect(행들).toHaveLength(2)
      expect([분석.message_id, 대사.message_id]).toEqual([거리.message_id, 거리.message_id])
      expect(분석.llm_call_id).toBeNull()
      expect(대사.llm_call_id).toBe(거리.llm_call_id)
      expect([분석.run_id, 대사.run_id]).toEqual([거리.run_id, 거리.run_id])
      expect([분석.check_name, 대사.check_name]).toEqual(['human_review', 'human_review'])
      expect([분석.graded_by, 대사.graded_by]).toEqual(['검사원', '검사원'])
    })
  })

  it('보류는 값이 없고 보류 목록에 모인다 (FR-045a·b)', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      await saveHumanScore({ ...공통(거리), target: 'analysis', form: 폼() }, tx)
      await saveHumanScore(
        {
          ...공통(거리),
          target: 'utterance',
          form: 폼({ value: 'pending', comment: '이게 유도인지 기준이 없다' }),
        },
        tx,
      )

      const 보류들 = await pendingScores(tx)
      const 보기 = await pendingView(tx)

      expect(보류들.map((행) => 행.target)).toEqual(['utterance'])
      expect(보류들[0].value).toBeNull()
      expect(보류들[0].message_id).toBe(거리.message_id)
      expect(보류들[0].comment).toBe('이게 유도인지 기준이 없다')
      expect(보기.pending[0].target_label).toBe('캐릭터 대사 검수')
      expect(보기.pending[0].child_utterance).toBe(발화_EMOTION)
    })
  })

  it('보류에 이유가 없으면 한 행도 안 남는다 (FR-045d)', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      await expect(
        saveHumanScore({ ...공통(거리), target: 'utterance', form: 폼({ value: 'pending' }) }, tx),
      ).rejects.toThrow(ValueError)
      expect(await 점수_수(tx, 거리.run_id)).toBe(0)
    })
  })

  it('넘음에는 걸린 항목이 있어야 하고, 목록 밖이면 거절한다', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      await expect(
        saveHumanScore({ ...공통(거리), target: 'analysis', form: 폼({ value: 'fail' }) }, tx),
      ).rejects.toThrow('넘음 판정에는 걸린 항목이 필요하다')
      await expect(
        saveHumanScore(
          {
            ...공통(거리),
            target: 'analysis',
            // 대사 쪽 항목이다. 대상이 다르면 목록도 다르다.
            form: 폼({ value: 'fail', violated_item: 'no_scene_end' }),
          },
          tx,
        ),
      ).rejects.toThrow('걸린 항목이 판정 기준 목록 밖이다')
      expect(await 점수_수(tx, 거리.run_id)).toBe(0)
    })
  })

  it('지킴·보류에는 걸린 항목이 남지 않는다', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      await saveHumanScore(
        {
          ...공통(거리),
          target: 'analysis',
          form: 폼({ value: 'pass', violated_item: 'direct_only' }),
        },
        tx,
      )
      const [행] = await currentScores(tx, { run_id: 거리.run_id })
      expect(행.value).toBe(1)
      expect(행.violated_item).toBeNull()
    })
  })

  it('판정 값이 셋 중 하나가 아니면 거절한다', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      await expect(
        saveHumanScore({ ...공통(거리), target: 'analysis', form: 폼({ value: '반쯤' }) }, tx),
      ).rejects.toThrow('판정은 지킴·넘음·보류 중 하나여야 한다')
    })
  })

  it('이 회차에 없는 턴이면 404 다', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      await expect(
        saveHumanScore(
          { ...공통(거리), message_id: randomUUID(), target: 'analysis', form: 폼() },
          tx,
        ),
      ).rejects.toThrow(MessageNotFound)
    })
  })

  it('다시 매겨도 앞 판정이 남는다 (FR-047)', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      await saveHumanScore(
        { ...공통(거리), target: 'analysis', form: 폼({ comment: '처음엔 맞다고 봤다' }) },
        tx,
      )
      await saveHumanScore(
        {
          ...공통(거리),
          target: 'analysis',
          form: 폼({
            value: 'fail',
            comment: '다시 보니 근거가 발화에 없다',
            violated_item: 'evidence_in_utterance',
          }),
        },
        tx,
      )

      const 전부 = await tx
        .select()
        .from(scores)
        .where(eq(scores.run_id, 거리.run_id))
        .orderBy(scores.created_at, scores.id)
      const 현재 = await currentScores(tx, { run_id: 거리.run_id })

      expect(전부).toHaveLength(2)
      expect(전부.map((행) => 행.value)).toEqual([1, 0])
      expect(전부[0].comment).toBe('처음엔 맞다고 봤다')
      expect(현재).toHaveLength(1)
      expect(현재[0].value).toBe(0)
      expect(현재[0].violated_item).toBe('evidence_in_utterance')
    })
  })

  it('교정은 점수와 한 묶음으로 남는다', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      const { score_id } = await saveHumanScore(
        {
          ...공통(거리),
          target: 'utterance',
          form: 폼({
            value: 'fail',
            comment: '아이 대신 답을 말했다',
            violated_item: 'no_answer_first',
            correction_text: '그래서 네 생각은 어떠니',
          }),
        },
        tx,
      )
      const 교정들 = await tx.select().from(corrections).where(eq(corrections.score_id, score_id))
      expect(교정들).toHaveLength(1)
      expect(교정들[0].target).toBe('utterance')
      expect(교정들[0].corrected).toEqual({ text: '그래서 네 생각은 어떠니' })
    })
  })

  it('교정이 목록 밖이면 점수도 안 남는다', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      await expect(
        saveHumanScore(
          {
            ...공통(거리),
            target: 'analysis',
            form: 폼({
              value: 'fail',
              violated_item: 'direct_only',
              correction_child_intent: '없는의도',
              correction_utterance_validity: 'VALID',
            }),
          },
          tx,
        ),
      ).rejects.toThrow(ValueError)
      expect(await 점수_수(tx, 거리.run_id)).toBe(0)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// DB — 기준 문장과 「다시 볼 대상」
// ═══════════════════════════════════════════════════════════════════════════

검사('기준 문장 — 잣대가 바뀌면 앞 판정을 다시 본다', () => {
  it('판이 오르면 낮은 판으로 매긴 판정이 잡힌다 (FR-044e · SC-020)', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      await saveHumanScore(
        { ...공통(거리), target: 'analysis', form: 폼({ comment: '지금 기준으로는 맞다' }) },
        tx,
      )
      const 기준_전 = await staleScores(tx, { run_id: 거리.run_id })

      const { version } = await writeCriterion(
        {
          scene_id: 거리.scene_id,
          element: 'EMOTION',
          criterion: '이 장면에서 EMOTION 은 며느리 마음을 짚은 말만 센다',
          written_by: '검사원',
        },
        tx,
      )
      const 기준_후 = await staleScores(tx, { run_id: 거리.run_id })
      const [턴] = await reviewTurns(tx, { run_id: 거리.run_id })

      expect(기준_전).toEqual([])
      expect(version).toBe(1)
      expect(기준_후).toHaveLength(1)
      expect(기준_후[0].criteria_version).toBe(0)
      expect(기준_후[0].latest_criteria_version).toBe(1)
      // 🔴 모든 기준 문장은 「초안」이다 (FR-044d · 헌법 원칙 IV).
      expect(턴.criteria.map((기준) => 기준.origin)).toEqual(['draft'])
      expect(턴.criteria[0].written_by).toBe('검사원')
      expect(턴.latest_criteria_version).toBe(1)
    })
  })

  it('새 기준으로 다시 매기면 다시 볼 대상에서 빠진다', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      await saveHumanScore({ ...공통(거리), target: 'analysis', form: 폼({ comment: '옛 기준' }) }, tx)
      await writeCriterion(
        { scene_id: 거리.scene_id, element: 'EMOTION', criterion: '초안 기준 한 줄', written_by: null },
        tx,
      )
      expect(await staleScores(tx, { run_id: 거리.run_id })).toHaveLength(1)

      await saveHumanScore(
        { ...공통(거리), target: 'analysis', form: 폼({ comment: '새 기준으로 다시 봤다' }) },
        tx,
      )

      const 남은 = await staleScores(tx, { run_id: 거리.run_id })
      expect(남은.map((행) => 행.comment)).toEqual(['옛 기준'])
    })
  })

  it('판 번호는 장면 단위로 오른다 (요소가 달라도 이어 오른다)', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      const 첫판 = await writeCriterion(
        { scene_id: 거리.scene_id, element: 'EMOTION', criterion: '가', written_by: null },
        tx,
      )
      const 둘째판 = await writeCriterion(
        { scene_id: 거리.scene_id, element: 'REASON', criterion: '나', written_by: null },
        tx,
      )
      expect([첫판.version, 둘째판.version]).toEqual([1, 2])
    })
  })

  it('요소가 목록 밖이거나 문장이 비면 거절한다', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      await expect(
        writeCriterion(
          { scene_id: 거리.scene_id, element: '없는요소', criterion: '가', written_by: null },
          tx,
        ),
      ).rejects.toThrow('요소가 허용 목록 밖이다')
      await expect(
        writeCriterion(
          { scene_id: 거리.scene_id, element: 'EMOTION', criterion: '   ', written_by: null },
          tx,
        ),
      ).rejects.toThrow('기준 문장을 써야 한다')
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// DB — 화면 조립
// ═══════════════════════════════════════════════════════════════════════════

검사('검수 화면 조립', () => {
  it('⭐ 다음 턴 대사를 빌려 오지 않는다 (FR-048)', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      const 턴들 = await reviewTurns(tx, { run_id: 거리.run_id })

      const 대사있는 = 턴들.find((턴) => 턴.message_id === 거리.message_id)!
      const 대사없는 = 턴들.find((턴) => 턴.message_id === 거리.응답없는_message_id)!

      expect(턴들).toHaveLength(3)
      expect(대사있는.character_utterance).toBe('그러게 말이다')
      expect(대사있는.previous_character_message).toBe('나는 어쩌면 좋으냐')
      // 뒤에 오는 것이 아이 발화라 이 턴에는 대사가 없다. 남의 대사를 집어 오면 안 된다.
      expect(대사없는.character_utterance).toBeNull()
      expect(대사없는.llm_call_id).toBeNull()
    })
  })

  it('요소 이름이 한국어로 뜨고 판정 이력에 이름표가 붙는다', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      await saveHumanScore(
        {
          ...공통(거리),
          target: 'utterance',
          form: 폼({ value: 'fail', violated_item: 'no_answer_first', comment: '답을 먼저 말했다' }),
        },
        tx,
      )

      const 보기 = await reviewView(거리.run_id, 0, tx)

      // ⚠️ `detected_elements` 는 `{type, evidence}` 묶음이다. 파이썬에서 이걸 코드 글자로
      //    알아들어 검수 화면이 통째로 500 이던 자리다.
      expect(보기.turn?.detected_element_names).toEqual(['감정'])
      expect(보기.turn?.child_utterance).toBe(발화_EMOTION)
      expect(보기.records).toHaveLength(1)
      expect(보기.records[0].target_label).toBe('캐릭터 대사 검수')
      expect(보기.records[0].violated_item_label).toBe('아이 대신 정답을 먼저 말하지 않았는가')
      expect(보기.records[0].is_latest).toBe(true)
      expect(보기.records[0].needs_review).toBe(false)
    })
  })

  it('index 는 범위 안으로 접히고, 그 턴의 판정만 보인다', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      await saveHumanScore({ ...공통(거리), target: 'analysis', form: 폼({ comment: '첫 턴' }) }, tx)

      const 넘침 = await reviewView(거리.run_id, 99, tx)
      const 음수 = await reviewView(거리.run_id, -3, tx)
      const 둘째 = await reviewView(거리.run_id, 1, tx)

      expect(넘침.index).toBe(2)
      expect(음수.index).toBe(0)
      expect(음수.turn?.message_id).toBe(거리.message_id)
      // 판정은 첫 턴에만 붙였다 — 둘째 턴 화면에 남의 판정이 섞이면 안 된다.
      expect(둘째.records).toEqual([])
      expect(넘침.stale_count).toBe(0)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// DB — 내보내기
// ═══════════════════════════════════════════════════════════════════════════

검사('내보내기 — 사람이 확정한 것만', () => {
  it('지킴 판정이 골든셋 한 줄이 된다 (FR-048 · 049)', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      await saveHumanScore(
        { ...공통(거리), target: 'analysis', form: 폼({ comment: '발화 안 근거만 썼다' }) },
        tx,
      )

      const 항목들 = await goldensetItems(tx)
      const { body } = await exportGoldenset(tx)
      const 줄들 = body.trimEnd().split('\n')

      expect(항목들).toHaveLength(1)
      expect(항목들[0]).toEqual({
        id: 거리.message_id,
        검수: '검수완료',
        scene_order: 1,
        장면_이름: '며느리',
        previous_character_message: '나는 어쩌면 좋으냐',
        child_utterance: 발화_EMOTION,
        target_elements: ['EMOTION'],
        정답: {
          child_intent: 'EMOTION',
          detected_elements: ['EMOTION'],
          utterance_validity: 'VALID',
          main_point: '며느리가 창피했다',
        },
        scene_description: '며느리가 방귀를 참고 있다',
        conflict: '참자니 병이 나고 뀌자니 쫓겨난다',
        메모: '발화 안 근거만 썼다',
        utterance_source: 'synthetic_adult',
        element_criteria: {},
      })
      // 첫 줄은 `//` 주석이라 `goldenset.읽기()` 가 건너뛴다 (SC-021).
      expect(줄들[0].startsWith('// exported_at: ')).toBe(true)
      expect(JSON.parse(줄들[1]).id).toBe(거리.message_id)
      expect(줄들).toHaveLength(2)
    })
  })

  it('넘음이면 사람이 고쳐 적은 값이 정답으로 나간다', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      await saveHumanScore(
        {
          ...공통(거리),
          target: 'analysis',
          form: 폼({
            value: 'fail',
            comment: '요소를 잘못 잡았다',
            violated_item: 'direct_only',
            correction_child_intent: 'REASONING',
            correction_main_point: '며느리가 참는 까닭',
            // 한국어 이름으로 적어도 코드로 저장된다.
            correction_detected_elements: '까닭, 입장',
            correction_utterance_validity: 'VALID',
          }),
        },
        tx,
      )

      const 항목들 = await goldensetItems(tx)
      expect(항목들[0].정답).toEqual({
        child_intent: 'REASONING',
        detected_elements: ['REASON', 'PERSPECTIVE'],
        utterance_validity: 'VALID',
        main_point: '며느리가 참는 까닭',
      })
    })
  })

  it('넘음인데 교정이 없으면 정답지에 안 담긴다', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      await saveHumanScore(
        {
          ...공통(거리),
          target: 'analysis',
          form: 폼({ value: 'fail', violated_item: 'direct_only', comment: '틀렸다' }),
        },
        tx,
      )
      expect(await goldensetItems(tx)).toEqual([])
    })
  })

  it('보류와 자동 채점은 어느 내보내기에도 안 담긴다 (FR-049)', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      // 자동 채점 한 행 — 사람이 매긴 것이 아니다.
      await tx.insert(scores).values({
        run_id: 거리.run_id,
        message_id: 거리.message_id,
        llm_call_id: null,
        target: 'analysis',
        check_name: 'boundary_no_answer',
        value: 1,
        comment: '자동',
        violated_item: null,
        graded_by: 'auto',
      })
      await saveHumanScore(
        {
          ...공통(거리),
          target: 'utterance',
          form: 폼({ value: 'pending', comment: '기준을 아직 못 정했다' }),
        },
        tx,
      )

      const 골든 = (await exportGoldenset(tx)).body.trimEnd().split('\n')
      const 대사 = (await exportUtterances_본문(tx)).trimEnd().split('\n')

      expect(골든.filter((줄) => !줄.startsWith('//'))).toEqual([])
      expect(대사.filter((줄) => !줄.startsWith('//'))).toEqual([])
    })
  })

  it('대사 판정은 대사 내보내기에 담긴다', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      await saveHumanScore(
        {
          ...공통(거리),
          target: 'utterance',
          form: 폼({ value: 'fail', violated_item: 'no_scene_end', comment: '장면을 끝냈다' }),
        },
        tx,
      )
      const 행들 = await utteranceExportRows(tx)
      expect(행들).toHaveLength(1)
      expect(행들[0].message_id).toBe(거리.message_id)
      expect(행들[0].character_utterance).toBe('그러게 말이다')
      expect(행들[0].violated_item).toBe('no_scene_end')
      expect(행들[0].value).toBe(0)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// DB — 서버 액션 (화면이 실제로 누르는 단추)
// ═══════════════════════════════════════════════════════════════════════════

검사('서버 액션 — 어디로 돌아가나', () => {
  it('판정을 남기면 그 턴 자리로 돌아간다', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      const { 경로, 조각, error } = await 눌러본다(analysisScoreAction, {
        run_id: 거리.run_id,
        message_id: 거리.message_id,
        value: 'pass',
        comment: '맞다',
      })

      expect(error).toBeNull()
      expect(경로).toBe(`/review/runs/${거리.run_id}`)
      expect(조각).toBe(`#turn-${거리.message_id}`)
      expect(await 점수_수(tx, 거리.run_id)).toBe(1)
    })
  })

  it('거절당하면 `?error=` 를 달고 조각은 그 뒤에 남는다', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      const { 경로, 조각, error } = await 눌러본다(utteranceScoreAction, {
        run_id: 거리.run_id,
        message_id: 거리.message_id,
        value: 'pending',
      })

      expect(error).toBe('BAD_REQUEST: 보류에는 아직 못 정한 이유가 필요하다')
      expect(경로).toBe(`/review/runs/${거리.run_id}`)
      expect(조각).toBe(`#turn-${거리.message_id}`)
      expect(await 점수_수(tx, 거리.run_id)).toBe(0)
    })
  })

  it('기준을 쓰면 온 곳으로 돌아간다 — 회차면 검수 화면, 아니면 보류 화면', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      const 회차에서 = await 눌러본다(criterionAction, {
        scene_id: 거리.scene_id,
        run_id: 거리.run_id,
        element: 'EMOTION',
        criterion: '며느리 마음을 짚은 말만 센다',
      })
      const 보류에서 = await 눌러본다(criterionAction, {
        scene_id: 거리.scene_id,
        element: 'REASON',
        criterion: '까닭을 말한 것만 센다',
      })

      expect(회차에서).toEqual({ 경로: `/review/runs/${거리.run_id}`, 조각: '', error: null })
      expect(보류에서).toEqual({ 경로: '/review/pending', 조각: '', error: null })
      const [턴] = await reviewTurns(tx, { run_id: 거리.run_id })
      expect(턴.latest_criteria_version).toBe(2)
    })
  })

  it('폼이 틀리면 서비스를 부르지도 않는다', async () => {
    await 트랜잭션(async (tx) => {
      const 거리 = await 검수거리_만들기(tx)
      const { 경로, error } = await 눌러본다(analysisScoreAction, {
        run_id: '회차아님',
        message_id: 거리.message_id,
        value: 'pass',
      })
      expect(경로).toBe('/review/pending')
      expect(error).toContain('BAD_REQUEST: run_id:')
      expect(await 점수_수(tx, 거리.run_id)).toBe(0)
    })
  })
})

// ── 잔손 ──────────────────────────────────────────────────────────────────

/** 판정 저장 인자 중 늘 같은 셋. */
function 공통(거리: 검수거리) {
  return { run_id: 거리.run_id, message_id: 거리.message_id, graded_by: '검사원' }
}

/** 대사 내보내기 본문. `exportUtterances()` 는 시각도 같이 주므로 본문만 꺼낸다. */
async function exportUtterances_본문(tx: Conn): Promise<string> {
  const { exportUtterances } = await import('@/llm/service/review')
  return (await exportUtterances(tx)).body
}
