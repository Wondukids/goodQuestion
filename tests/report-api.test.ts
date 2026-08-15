// 보호자 리포트 API·생성 배선 (이슈 #38 · 명세 `docs/보호자_리포트_명세.md` 7·8절).
//
// 재는 것은 여섯이다:
//   ① 활동 하나에 리포트 하나 — 다시 끝내도 행이 안 는다 (R1)
//   ② LLM 이 죽어도 숫자가 남는다 — `status='metrics_only'` (R18)
//   ③ 남의 아이 활동은 **404** — 403 이 아니고 존재 여부도 안 알린다 (명세 7절)
//   ④ 네 번째 「다시 만들기」는 **429** (R19)
//   ⑤ 낱말은 **저장 뒤에** 쌓이고, 다시 만들어도 새 낱말이 0 이 되지 않는다 (명세 4.3)
//   ⑥ 리포트 생성이 아이의 활동 종료 응답을 **안 기다린다** (R2)
//
// ## 어느 층을 두드리나
//
// 계약이 HTTP 코드로 적혀 있는 것(③④)은 **라우트 핸들러**를 직접 부르고, 생성 흐름의
// 순서(①②⑤)는 service 를 직접 부른다 (`tests/session-skip.test.ts` 와 같은 방식 —
// `getDb()` 자리에 검사 트랜잭션을 꽂아 끝나면 되돌린다).
//
// ⚠️ 이 검사는 `sql/006_parent_report.sql` 이 들어간 DB 를 전제한다. 안 넣었으면 표 둘이
//    없어서 빨개진다.

import { randomUUID } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  characters,
  child_words,
  messages,
  parent_reports,
  runs,
  stories,
  story_scenes,
  story_sessions,
  utterance_analyses,
} from '@/llm/db/schema'

// ⚠️ 팩토리 안에서 바깥 변수를 참조하면 hoisting 에 걸린다 (`session-skip.test.ts` 와 같은 상자).
const 상자 = vi.hoisted(() => ({
  tx: null as unknown,
  /** 로그인한 보호자 id. `null` 이면 로그인 안 한 것이다 */
  보호자: null as string | null,
  /** 그 보호자의 아이 id 들 */
  아이들: [] as string[],
}))

vi.mock('@/llm/repo/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/llm/repo/db')>()
  return { ...real, getDb: () => 상자.tx ?? real.getDb() }
})

// 저쪽(팀 Supabase)의 `children` 을 흉내 낸다 — 문지기가 보는 것은 「내 아이인가」 하나다.
// 실제 호출 사슬 그대로다: `.from('children').select('id').eq('id',…).eq('parent_id',…).maybeSingle()`
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: 상자.보호자 === null ? null : { id: 상자.보호자 } },
      }),
    },
    from: () => ({
      select: () => ({
        eq: (_칸1: string, child_id: string) => ({
          eq: (_칸2: string, parent_id: string) => ({
            maybeSingle: async () => ({
              data:
                parent_id === 상자.보호자 && 상자.아이들.includes(child_id)
                  ? { id: child_id }
                  : null,
            }),
          }),
        }),
      }),
    }),
  }),
}))

import { GET as 목록_라우트 } from '@/app/api/children/[child_id]/reports/route'
import { POST as 읽음_라우트 } from '@/app/api/reports/[session_id]/read/route'
import { POST as 재생성_라우트 } from '@/app/api/reports/[session_id]/regenerate/route'
import { GET as 리포트_라우트 } from '@/app/api/reports/[session_id]/route'
import { closeDb, getDb, type Conn } from '@/llm/repo/db'
import { completeRun } from '@/llm/service/run'
import type { ReportCall } from '@/report/engine'
import { generateReport, queueReport, __testing } from '@/report/service/generate'
import { regenerateReport, RegenerateLimit } from '@/report/service/reports'
import type { ParentReport, ReportListItem } from '@/report/types'

import { installFakeSdk } from './support/sdk-gate'

// ── DB 가 있나 (session-skip.test.ts 와 같은 문지기) ───────────────────────

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
    `\n[report-api.test] Postgres 에 못 붙어 리포트 API 검사를 건너뛴다 (도커가 꺼져 있나?)\n` +
      `                  ${못붙는_이유}\n\n`,
  )
}
const 검사 = 못붙는_이유 === null ? describe : describe.skip

afterAll(async () => {
  상자.tx = null
  await closeDb()
})

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  상자.보호자 = null
  상자.아이들 = []
})

class 되돌림 extends Error {}

/** 트랜잭션을 열어 `getDb()` 자리에 꽂고, 본문이 끝나면 **무조건 되돌린다.** */
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

// ── 가짜 LLM 두 편 ─────────────────────────────────────────────────────────
//
// 진짜 SDK 는 `tests/setup.ts` 가 이미 막는다. 여기서는 **부르는 자리**를 바꿔 끼워
// 대조 규칙과 저장 순서만 본다 (`ReportCall` — `src/report/engine/narrative.ts`).

interface 가짜응답 {
  /** 인용에 쓸 아이 발화 id. 재료의 `quotes[]` 안에 있어야 안 버려진다 */
  quote_message_id: string
  scene_code: string
  /** 아이 발화에 실제로 있는 낱말이어야 안 버려진다 (명세 5.3 ②) */
  extracted: string[]
}

function 가짜_리포트_호출(것: 가짜응답, 죽일것: '없음' | '둘다' | '말하기분석' = '없음'): ReportCall {
  return async (_system, _user, options) => {
    const 말하기분석인가 = options.purpose === 'report_analysis'
    if (죽일것 === '둘다' || (죽일것 === '말하기분석' && 말하기분석인가)) {
      throw new Error('가짜 실패: 공급자가 전부 죽었다')
    }

    const 본문 = 말하기분석인가
      ? {
          overall: '감정과 이유를 이어 말했어요',
          cards: [
            {
              axis: '어휘',
              summary: '마음 낱말을 골라 썼어요',
              quote_message_id: 것.quote_message_id,
              did_well: '「부끄럽다」를 상황에 맞게 썼어요',
              to_improve: '비슷한 말을 함께 찾아보면 좋아요',
            },
          ],
          highlight: { quote_message_id: 것.quote_message_id, why: '마음과 까닭을 이어 말했어요' },
          word_tip: '오늘 저녁에 같이 찾아보면 좋아요',
          words: { extracted: 것.extracted, repeated: ['왜냐하면'] },
        }
      : {
          reason: '이유를 묻는 질문으로 골랐어요',
          story_questions: [
            {
              element: 'REASON',
              scene_code: 것.scene_code,
              quote_message_id: 것.quote_message_id,
              question: '왜 부끄러웠을까?',
              fallback: '"몰라"라고 하면 — "너라면 어땠을 것 같아?"',
            },
          ],
          daily_questions: [
            { label: '내 경험과 이유', question: '너도 그런 적 있어?', goal: '까닭을 말해 보기' },
          ],
        }

    return {
      text: JSON.stringify(본문),
      provider: 'gemini',
      model: '가짜-모델',
      attempts: [],
    }
  }
}

// ── 검사용 콘텐츠 ──────────────────────────────────────────────────────────

interface 씨앗 {
  child_id: string
  session_id: string
  scene_code: string
  /** 사고 요소가 잡힌 `VALID` 아이 발화 — 인용 후보다 */
  quote_message_id: string
}

/**
 * 말하기 후 활동이 붙은 이야기의 `stories.post_activity_config` (후활동 명세 4.1).
 *
 * 🔴 이 갈래(#43)가 보는 것은 **이 칸이 비었나 찼나** 하나뿐이다 — 리포트를 언제 만들지가
 *    그것으로 갈린다 (F10·F13). 카드 넉 장과 단어 12개의 정본은 `sql/007_post_activity.sql`
 *    이고 그 모양을 쓰는 것은 #45·#47 이다. 그래서 여기서는 한 장만 넣어 둔다.
 */
const 후활동_설정 = {
  cards: [{ id: 'endure', title: '방귀를 참는 며느리', keywords: ['시집', '참다', '걱정'] }],
  answer_order: ['endure'],
  tray_order: ['endure'],
}

/**
 * 이야기 하나 · 대화 장면 하나 · 아이 발화 둘이 든 **완주한 활동** 한 건.
 *
 * 발화 둘 중 하나만 `VALID` + 요소가 있어 인용 후보가 된다 (명세 4.1 — 「몰라요」 같은
 * 발화를 후보에 넣으면 LLM 이 그걸 대표 발화로 내민다).
 *
 * `후활동: true` 면 그 이야기에 말하기 후 활동이 붙는다 — 리포트를 **세션이 끝나는 자리에서
 * 안 만드는** 이야기다 (F10). 안 주면 지금까지의 이야기 그대로다 (F13).
 */
async function 활동_넣기(
  tx: Conn,
  options: { child_id?: string; 분전?: number; 후활동?: boolean } = {},
): Promise<씨앗> {
  const 꼬리 = randomUUID().slice(0, 8)
  const child_id = options.child_id ?? randomUUID()
  // ⚠️ 한 트랜잭션 안에서 `now()` 는 **언제나 같은 값**이다. 활동 둘을 넣을 때 시작 시각을
  //    안 벌려 두면 「이전 활동」이 0 으로 나온다 — DB 가 아니라 검사 쪽 함정이다.
  const 시작 = sql`now() - (${options.분전 ?? 20} || ' minutes')::interval`

  const [이야기] = await tx
    .insert(stories)
    .values({
      slug: `s_report_${꼬리}`,
      title: `리포트 검사용 ${꼬리}`,
      summary: '검사용',
      difficulty: '보통',
      status: 'draft',
      post_activity_config: options.후활동 === true ? 후활동_설정 : null,
    })
    .returning({ id: stories.id })

  const [캐릭터] = await tx
    .insert(characters)
    .values({
      story_id: 이야기.id,
      code: 'ch_report_daughter_in_law',
      name: '며느리',
      persona: '시집온 지 얼마 안 된 며느리',
      speech_style: '옛이야기 말투',
      guidance_style: '자기 걱정을 소리 내어 말한다',
      forbidden: ['설명하지 않는다'],
    })
    .returning({ id: characters.id })

  const scene_code = 'sc_report_02'
  const [장면] = await tx
    .insert(story_scenes)
    .values({
      story_id: 이야기.id,
      code: scene_code,
      scene_order: 2,
      conflict: '갈등',
      character_id: 캐릭터.id,
      character_name: '며느리',
      character_opening: '아이고… 나 때문에 다들 놀랐지 뭐야.',
      character_closing: '네 말을 들으니 마음이 놓이는구나.',
      scene_stance: '아직 참고 있다',
      scene_goal: '아이가 며느리의 처지를 헤아리게 한다',
      required_elements: ['EMPATHY', 'REASON'],
      preferred_turns: 2,
      max_turns: 4,
      // 「질문한 낱말」과 「새 낱말의 뜻」이 이 목록에서 온다 (명세 6.3).
      vocabulary: [{ word: '며느리', meaning: '아들의 아내' }],
    })
    .returning({ id: story_scenes.id })

  const [세션] = await tx
    .insert(story_sessions)
    .values({
      child_id,
      story_id: 이야기.id,
      current_scene_id: 장면.id,
      status: 'completed',
      started_at: 시작,
      completed_at: sql`now()`,
      last_activity_at: sql`now()`,
    })
    .returning({ id: story_sessions.id })

  const 넣은_발화들 = await tx
    .insert(messages)
    .values([
      {
        session_id: 세션.id,
        scene_id: 장면.id,
        speaker_type: 'child',
        turn_order: 1,
        text: '며느리가 부끄러워했어요. 왜냐하면 방귀를 뀌었으니까요.',
      },
      { session_id: 세션.id, scene_id: 장면.id, speaker_type: 'child', turn_order: 2, text: '몰라요' },
    ])
    .returning({ id: messages.id, turn_order: messages.turn_order })

  const 인용후보 = 넣은_발화들.find((행) => 행.turn_order === 1)!
  const 짧은답 = 넣은_발화들.find((행) => 행.turn_order === 2)!

  await tx.insert(utterance_analyses).values([
    {
      message_id: 인용후보.id,
      child_intent: 'OPINION',
      main_point: '며느리가 부끄러웠다',
      detected_elements: [
        { type: 'EMOTION', evidence: '부끄러워했어요' },
        { type: 'REASON', evidence: '방귀를 뀌었으니까' },
      ],
      utterance_validity: 'VALID',
    },
    {
      message_id: 짧은답.id,
      child_intent: 'SHORT_RESPONSE',
      main_point: null,
      detected_elements: [],
      utterance_validity: 'SHORT',
    },
  ])

  return { child_id, session_id: 세션.id, scene_code, quote_message_id: 인용후보.id }
}

/** 라우트가 받는 경로 인자 한 벌. Next 16 은 프라미스다. */
function 경로<T extends Record<string, string>>(값: T): { params: Promise<T> } {
  return { params: Promise.resolve(값) }
}

async function 리포트_수(tx: Conn, session_id: string): Promise<number> {
  const 행들 = await tx
    .select({ 수: sql<number>`count(*)::int` })
    .from(parent_reports)
    .where(eq(parent_reports.session_id, session_id))
  return 행들[0].수
}

// ═══════════════════════════════════════════════════════════════════════════

검사('리포트 생성 (명세 8절) × 진짜 DB', () => {
  it('① 활동을 끝내면 행이 하나 생기고, 다시 끝내도 늘지 않는다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 활동_넣기(tx)
      const 호출 = 가짜_리포트_호출({
        quote_message_id: 씨앗.quote_message_id,
        scene_code: 씨앗.scene_code,
        extracted: ['부끄럽다'],
      })

      const 첫판 = await generateReport({ session_id: 씨앗.session_id, conn: tx, call: 호출 })
      expect(첫판?.status).toBe('complete')
      expect(await 리포트_수(tx, 씨앗.session_id)).toBe(1)

      // 같은 활동을 다시 끝냈다 — 덮어쓸 뿐 새 행이 아니다 (R1).
      const 두번째 = await generateReport({ session_id: 씨앗.session_id, conn: tx, call: 호출 })
      expect(await 리포트_수(tx, 씨앗.session_id)).toBe(1)
      expect(두번째?.id).toBe(첫판?.id)
      // 자동 생성은 남용 한도를 안 깎는다 (R19 — 그건 보호자가 누르는 것만 센다).
      expect(두번째?.regenerated).toBe(0)
    })
  })

  it('② LLM 이 둘 다 죽으면 metrics_only 로 저장되고 숫자가 남는다 (R18)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 활동_넣기(tx)
      const 죽는_호출 = 가짜_리포트_호출(
        { quote_message_id: 씨앗.quote_message_id, scene_code: 씨앗.scene_code, extracted: [] },
        '둘다',
      )

      const 행 = await generateReport({ session_id: 씨앗.session_id, conn: tx, call: 죽는_호출 })

      expect(행?.status).toBe('metrics_only')
      expect(행?.narrative).toBeNull()
      // 숫자는 그대로다 — 아이 발화 둘, 「감정표현」 축 1점.
      expect(행?.metrics.counts.child_utterances).toBe(2)
      expect(행?.metrics.axes.감정표현.score).toBe(1)
      expect(행?.metrics.quotes).toHaveLength(1)
    })
  })

  it('② 한 편만 죽으면 그 칸만 비고 리포트는 complete 다 (R9)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 활동_넣기(tx)
      const 반만_죽는_호출 = 가짜_리포트_호출(
        {
          quote_message_id: 씨앗.quote_message_id,
          scene_code: 씨앗.scene_code,
          extracted: ['부끄럽다'],
        },
        '말하기분석',
      )

      const 행 = await generateReport({
        session_id: 씨앗.session_id,
        conn: tx,
        call: 반만_죽는_호출,
      })

      expect(행?.status).toBe('complete')
      expect(행?.narrative?.overall).toBe('')
      expect(행?.narrative?.story_questions).toHaveLength(1)
      // 말하기 분석이 죽었으니 낱말도 안 왔다 — 지표의 낱말 칸이 빈 채로 남는다.
      expect(행?.metrics.words.main).toEqual([])
    })
  })

  it('⑤ 낱말은 저장 뒤에 쌓이고, 다시 만들어도 새 낱말이 0 이 되지 않는다 (명세 4.3)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 활동_넣기(tx)
      const 호출 = 가짜_리포트_호출({
        quote_message_id: 씨앗.quote_message_id,
        scene_code: 씨앗.scene_code,
        extracted: ['부끄럽다', '며느리'],
      })

      const 첫판 = await generateReport({ session_id: 씨앗.session_id, conn: tx, call: 호출 })
      expect(첫판?.metrics.words.new.map((것) => 것.word)).toEqual(['부끄럽다', '며느리'])
      expect(첫판?.metrics.counts.new_words).toBe(2)

      // ⑤ — 저장이 끝난 **뒤에** 누적 목록이 채워졌다.
      const 쌓인것 = await tx
        .select({ word: child_words.word, meaning: child_words.meaning })
        .from(child_words)
        .where(eq(child_words.child_id, 씨앗.child_id))
      expect(쌓인것.map((행) => 행.word).sort()).toEqual(['며느리', '부끄럽다'])
      // 장면 낱말 목록에 있는 낱말은 뜻이 붙는다 (명세 6.3).
      expect(쌓인것.find((행) => 행.word === '며느리')?.meaning).toBe('아들의 아내')

      // 🔴 다시 만들어도 **이 활동이 넣은 낱말은 잣대에서 빠진다** — 새 낱말이 0 이 되지 않는다.
      const 다시 = await regenerateReport({ session_id: 씨앗.session_id, conn: tx, call: 호출 })
      expect(다시?.metrics.counts.new_words).toBe(2)
      expect(다시?.regenerated).toBe(1)
    })
  })

  it('⑤ 지난 활동에서 쓴 낱말은 새 낱말이 아니다 (R6)', async () => {
    await 트랜잭션(async (tx) => {
      const 지난활동 = await 활동_넣기(tx, { 분전: 60 * 24 * 3 })
      const 호출 = (씨앗: 씨앗) =>
        가짜_리포트_호출({
          quote_message_id: 씨앗.quote_message_id,
          scene_code: 씨앗.scene_code,
          extracted: ['부끄럽다'],
        })

      await generateReport({ session_id: 지난활동.session_id, conn: tx, call: 호출(지난활동) })

      // 같은 아이의 두 번째 활동 — 같은 낱말을 또 썼다.
      const 이번활동 = await 활동_넣기(tx, { child_id: 지난활동.child_id })
      const 행 = await generateReport({
        session_id: 이번활동.session_id,
        conn: tx,
        call: 호출(이번활동),
      })

      expect(행?.metrics.words.main.map((것) => 것.word)).toEqual(['부끄럽다'])
      expect(행?.metrics.counts.new_words).toBe(0)
      expect(행?.metrics.activity.prior_activities).toBe(1)
    })
  })

  it('⑥ 뒤에서 만드는 문은 곧바로 돌아오고, 안 끝난 활동에는 아무것도 안 만든다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 활동_넣기(tx)
      await tx
        .update(story_sessions)
        .set({ status: 'in_progress', completed_at: null })
        .where(eq(story_sessions.id, 씨앗.session_id))

      // 🔴 프라미스를 안 돌려준다 — 부르는 쪽(아이 앱 턴)이 기다릴 수가 없다는 뜻이다.
      expect(queueReport(씨앗.session_id)).toBeUndefined()
      await __testing.마지막작업

      // 그리고 던지지 않는다. 없는 활동으로 불러도 아이 화면이 멈추면 안 된다.
      expect(() => queueReport(randomUUID())).not.toThrow()
      await __testing.마지막작업

      expect(await 리포트_수(tx, 씨앗.session_id)).toBe(0)
    })
  })

  it('⑥ 회차를 닫으면 리포트가 만들어진다 — LLM 이 막혀 있어도 숫자가 남는다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 활동_넣기(tx)
      // 세션 닫기 직전 상태로 되돌린다 — `completeRun()` 이 `in_progress` 일 때만 닫는다.
      await tx
        .update(story_sessions)
        .set({ status: 'in_progress', completed_at: null })
        .where(eq(story_sessions.id, 씨앗.session_id))

      const [회차] = await tx
        .insert(runs)
        .values({
          session_id: 씨앗.session_id,
          scope: 'story',
          default_utterance_source: 'app',
          prompt_version: 'mvp_v1',
        })
        .returning()

      // 이 갈래는 `call` 을 꽂을 자리가 없다(세션 닫기 → 뒤에서 생성). 그래서 **SDK 자리**에
      // 죽는 가짜를 꽂는다 — 진짜 공급자에 안 붙고, 망을 기다리지도 않는다.
      // ⛔ 가짜를 안 꽂고 F-1 그물에 기대면 안 된다. 그물은 「붙으려 했다」를 잡는 장치지
      //    검사가 기대는 계약이 아니고, 실제로 한 번 샌 적이 있다 (`tests/setup.ts` 머리말).
      installFakeSdk('gemini', () => ({
        interactions: {
          create: async () => {
            throw new Error('가짜: 공급자가 죽었다')
          },
        },
      }))

      // 🔴 여기가 배선이다 — 앱·관리자 어느 길로 끝나든 세션은 이 함수로 닫힌다.
      await completeRun(tx, { run: 회차, session: { status: 'in_progress' } })
      // 뒤에서 도는 작업이라 검사만 기다린다 (`__testing` 머리말 — 제품 코드는 안 기다린다).
      await __testing.마지막작업

      expect(await 리포트_수(tx, 씨앗.session_id)).toBe(1)
      const [행] = await tx
        .select({ status: parent_reports.status, metrics: parent_reports.metrics })
        .from(parent_reports)
        .where(eq(parent_reports.session_id, 씨앗.session_id))
      // 공급자가 죽었으니 문장이 안 나온다 — 그래도 숫자는 남는다 (R18).
      expect(행.status).toBe('metrics_only')
      expect(행.metrics.counts.child_utterances).toBe(2)
    })
  })
})

검사('리포트 API (명세 7절) × 진짜 DB', () => {
  it('③ 내 아이 리포트는 200, 남의 아이는 404 다 (403 이 아니다)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 활동_넣기(tx)
      await generateReport({
        session_id: 씨앗.session_id,
        conn: tx,
        call: 가짜_리포트_호출({
          quote_message_id: 씨앗.quote_message_id,
          scene_code: 씨앗.scene_code,
          extracted: ['부끄럽다'],
        }),
      })

      // 내 아이 — 200 이고 봉투 없이 알맹이 그대로다 (#39 가 그렇게 짜였다).
      상자.보호자 = randomUUID()
      상자.아이들 = [씨앗.child_id]
      const 내것 = await 리포트_라우트(
        new Request('http://x'),
        경로({ session_id: 씨앗.session_id }),
      )
      expect(내것.status).toBe(200)
      const 알맹이 = (await 내것.json()) as ParentReport
      expect(알맹이.status).toBe('complete')
      expect(알맹이.metrics.activity.story_title).toContain('리포트 검사용')
      expect(알맹이.read_at).toBeNull()

      // 남의 아이 — **404**. 「있는데 네 것이 아니다」를 알려 주지 않는다.
      상자.아이들 = []
      const 남의것 = await 리포트_라우트(
        new Request('http://x'),
        경로({ session_id: 씨앗.session_id }),
      )
      expect(남의것.status).toBe(404)
      expect(((await 남의것.json()) as { error: { code: string } }).error.code).toBe(
        'REPORT_NOT_FOUND',
      )

      // 아예 없는 활동도 **같은 404** 다 — 두 경우를 응답으로 못 가른다.
      상자.아이들 = [씨앗.child_id]
      const 없는것 = await 리포트_라우트(new Request('http://x'), 경로({ session_id: randomUUID() }))
      expect(없는것.status).toBe(404)

      // 로그인 안 했으면 401.
      상자.보호자 = null
      const 손님 = await 리포트_라우트(
        new Request('http://x'),
        경로({ session_id: 씨앗.session_id }),
      )
      expect(손님.status).toBe(401)
    })
  })

  it('읽음 표시는 204 이고, 두 번 눌러도 처음 연 시각이 안 밀린다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 활동_넣기(tx)
      await generateReport({
        session_id: 씨앗.session_id,
        conn: tx,
        call: 가짜_리포트_호출({
          quote_message_id: 씨앗.quote_message_id,
          scene_code: 씨앗.scene_code,
          extracted: ['부끄럽다'],
        }),
      })
      상자.보호자 = randomUUID()
      상자.아이들 = [씨앗.child_id]

      const 첫번 = await 읽음_라우트(new Request('http://x', { method: 'POST' }), 경로({ session_id: 씨앗.session_id }))
      expect(첫번.status).toBe(204)

      const [찍힌것] = await tx
        .select({ read_at: parent_reports.read_at })
        .from(parent_reports)
        .where(eq(parent_reports.session_id, 씨앗.session_id))
      expect(찍힌것.read_at).not.toBeNull()

      const 두번 = await 읽음_라우트(new Request('http://x', { method: 'POST' }), 경로({ session_id: 씨앗.session_id }))
      expect(두번.status).toBe(204)
      const [다시읽은것] = await tx
        .select({ read_at: parent_reports.read_at })
        .from(parent_reports)
        .where(eq(parent_reports.session_id, 씨앗.session_id))
      expect(다시읽은것.read_at?.getTime()).toBe(찍힌것.read_at?.getTime())
    })
  })

  it('목록은 맨 배열이고 미읽음 표시를 담는다 (#39 가정 ⑴)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 활동_넣기(tx)
      await generateReport({
        session_id: 씨앗.session_id,
        conn: tx,
        call: 가짜_리포트_호출({
          quote_message_id: 씨앗.quote_message_id,
          scene_code: 씨앗.scene_code,
          extracted: ['부끄럽다'],
        }),
      })
      상자.보호자 = randomUUID()
      상자.아이들 = [씨앗.child_id]

      const 응답 = await 목록_라우트(new Request('http://x'), 경로({ child_id: 씨앗.child_id }))
      expect(응답.status).toBe(200)
      const 목록 = (await 응답.json()) as ReportListItem[]
      expect(Array.isArray(목록)).toBe(true)
      expect(목록).toHaveLength(1)
      expect(목록[0].session_id).toBe(씨앗.session_id)
      expect(목록[0].unread).toBe(true)
      expect(목록[0].status).toBe('complete')

      // 남의 아이 목록은 404 — 그 아이가 있는지도 안 알린다.
      상자.아이들 = []
      const 남의것 = await 목록_라우트(new Request('http://x'), 경로({ child_id: 씨앗.child_id }))
      expect(남의것.status).toBe(404)
    })
  })

  it('④ 네 번째 다시 만들기는 429 다 (R19)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 활동_넣기(tx)
      const 호출 = 가짜_리포트_호출({
        quote_message_id: 씨앗.quote_message_id,
        scene_code: 씨앗.scene_code,
        extracted: ['부끄럽다'],
      })
      await generateReport({ session_id: 씨앗.session_id, conn: tx, call: 호출 })

      for (const 번째 of [1, 2, 3]) {
        const 것 = await regenerateReport({ session_id: 씨앗.session_id, conn: tx, call: 호출 })
        expect(것?.regenerated).toBe(번째)
      }

      await expect(
        regenerateReport({ session_id: 씨앗.session_id, conn: tx, call: 호출 }),
      ).rejects.toBeInstanceOf(RegenerateLimit)

      // 라우트로도 같은 자리가 429 로 나간다.
      상자.보호자 = randomUUID()
      상자.아이들 = [씨앗.child_id]
      const 응답 = await 재생성_라우트(
        new Request('http://x', { method: 'POST' }),
        경로({ session_id: 씨앗.session_id }),
      )
      expect(응답.status).toBe(429)
      expect(((await 응답.json()) as { error: { code: string } }).error.code).toBe(
        'REGENERATE_LIMIT',
      )
    })
  })

  it('④ 한도는 설정값이다 — 0 이면 첫 번째부터 막힌다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 활동_넣기(tx)
      const 호출 = 가짜_리포트_호출({
        quote_message_id: 씨앗.quote_message_id,
        scene_code: 씨앗.scene_code,
        extracted: ['부끄럽다'],
      })
      await generateReport({ session_id: 씨앗.session_id, conn: tx, call: 호출 })

      await expect(
        regenerateReport({
          session_id: 씨앗.session_id,
          conn: tx,
          call: 호출,
          regenerate_limit: 0,
        }),
      ).rejects.toBeInstanceOf(RegenerateLimit)
    })
  })

  it('아직 안 만들어진 리포트는 다시 만들 것도 없다 — 404', async () => {
    await 트랜잭션(async (tx) => {
      const 씨앗 = await 활동_넣기(tx)
      상자.보호자 = randomUUID()
      상자.아이들 = [씨앗.child_id]

      const 응답 = await 재생성_라우트(
        new Request('http://x', { method: 'POST' }),
        경로({ session_id: 씨앗.session_id }),
      )
      expect(응답.status).toBe(404)
      expect(await 리포트_수(tx, 씨앗.session_id)).toBe(0)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 리포트를 **언제** 만드나 — 이슈 #43 (후활동 명세 7.1 · 결정 F10~F13)
//
// ```
// 마지막 장면 끝  →  세션 completed          (리포트는 아직 안 만든다)
//       │
//       ├─ 아이가 후활동을 한다 ─→ 「마치기」  →  complete(reason=finished) ─┐
//       ├─ 활동을 건너뛰고 나간다 ───────────→  complete(reason=left)     ─┤
//       │                                                                  ├─→ queueReport()
//       └─ 앱을 그냥 꺼버린다 ────→ (신호 없음) → 보호자가 리포트를 열 때 ─┘
// ```
//
// 재는 것은 수용 기준 12·13·14 와 그 짝인 F13 이다. 🔴 **14 와 F13 은 둘 다 서야 한다** —
// 14 만 보고 세션 닫기의 호출을 지우면 후활동이 **없는** 이야기의 리포트가 영영 안 만들어진다
// (그런 이야기는 끝 화면에 활동 버튼이 없어 만들라는 신호가 달리 오지 않는다).
//
// ⛔ `complete` API 자체(5절 D)는 여기서 안 잰다 — #45 갈래가 만든다. 이 검사가 재는 것은
//    그 API 가 부를 **문**(`queueReport(session_id)`)이 후활동 이야기에서도 도는가다.
// ═══════════════════════════════════════════════════════════════════════════

검사('리포트 생성 시점 (후활동 명세 7.1) × 진짜 DB', () => {
  /** 공급자를 죽여 둔다 — 뒤에서 도는 생성에는 `call` 을 꽂을 자리가 없다 (위 ⑥ 과 같은 수). */
  function 공급자를_죽인다(): void {
    installFakeSdk('gemini', () => ({
      interactions: {
        create: async () => {
          throw new Error('가짜: 공급자가 죽었다')
        },
      },
    }))
  }

  /** 앱·관리자 어느 길로 끝나든 세션은 이 함수로 닫힌다 (`completeRun()`). */
  async function 세션_닫기(tx: Conn, session_id: string): Promise<void> {
    await tx
      .update(story_sessions)
      .set({ status: 'in_progress', completed_at: null })
      .where(eq(story_sessions.id, session_id))

    const [회차] = await tx
      .insert(runs)
      .values({
        session_id,
        scope: 'story',
        default_utterance_source: 'app',
        prompt_version: 'mvp_v1',
      })
      .returning()

    await completeRun(tx, { run: 회차, session: { status: 'in_progress' } })
    // 뒤에서 도는 작업이라 검사만 기다린다 (`__testing` 머리말).
    await __testing.마지막작업
  }

  it('수용 14 · F13 — 이야기가 끝난 것만으로는 후활동 이야기의 리포트가 안 만들어진다 (없는 이야기는 지금처럼)', async () => {
    await 트랜잭션(async (tx) => {
      공급자를_죽인다()
      const 후활동있음 = await 활동_넣기(tx, { 후활동: true })
      const 후활동없음 = await 활동_넣기(tx)

      await 세션_닫기(tx, 후활동있음.session_id)
      await 세션_닫기(tx, 후활동없음.session_id)

      // 14 — 아이가 활동을 하나 더 한다. 여기서 만들면 그 결과가 못 실린다 (F10).
      expect(await 리포트_수(tx, 후활동있음.session_id)).toBe(0)
      // F13 — 끝 화면에 활동 버튼이 없는 이야기다. 여기서 안 만들면 아무도 안 만든다.
      expect(await 리포트_수(tx, 후활동없음.session_id)).toBe(1)

      // 세션 상태는 어느 쪽도 안 건드린다 — 둘 다 `completed` 다 (F10 · F5 를 접은 이유).
      const 상태들 = await tx
        .select({ id: story_sessions.id, status: story_sessions.status })
        .from(story_sessions)
        .where(eq(story_sessions.child_id, 후활동있음.child_id))
      expect(상태들.map((행) => 행.status)).toEqual(['completed'])
    })
  })

  it('수용 12 — 활동을 안 하고 끝 화면을 떠나도 만들어지고, 두 번 불려도 다시 안 만든다', async () => {
    await 트랜잭션(async (tx) => {
      공급자를_죽인다()
      const 씨앗 = await 활동_넣기(tx, { 후활동: true })

      // #45 의 `complete(reason=left)` 가 부를 문이다 — 세션 닫기가 아니므로 안 기다린다.
      queueReport(씨앗.session_id)
      await __testing.마지막작업

      expect(await 리포트_수(tx, 씨앗.session_id)).toBe(1)
      const [첫판] = await tx
        .select({ id: parent_reports.id, status: parent_reports.status })
        .from(parent_reports)
        .where(eq(parent_reports.session_id, 씨앗.session_id))
      // 공급자가 죽어 있어도 숫자는 남는다 (R18) — 늦게 만들 이유가 되지 않는다.
      expect(첫판.status).toBe('metrics_only')

      // 🔴 다시 만들었는지를 **표시로** 잰다. 한 트랜잭션 안에서는 `now()` 가 언제나 같은
      //    값이라 `generated_at` 으로는 못 가른다 (이 파일 머리말의 함정과 같은 것).
      //    공급자가 죽어 있으므로 다시 만들면 이 값이 `metrics_only` 로 되돌아간다.
      await tx
        .update(parent_reports)
        .set({ status: 'complete' })
        .where(eq(parent_reports.session_id, 씨앗.session_id))

      // 아이가 마치고 나서 끝 화면을 떠나면 `complete` 가 **두 번** 불린다 (F11).
      queueReport(씨앗.session_id)
      await __testing.마지막작업

      const [두번째] = await tx
        .select({ id: parent_reports.id, status: parent_reports.status })
        .from(parent_reports)
        .where(eq(parent_reports.session_id, 씨앗.session_id))
      expect(두번째.id).toBe(첫판.id)
      // 두 번째는 **아무 일도 안 일어난다** — 다시 만들었으면 LLM 2회가 또 나간 것이다.
      expect(두번째.status).toBe('complete')
    })
  })

  it('수용 13 — 아무 신호 없이 앱을 꺼도, 보호자가 목록을 열면 그 자리에서 만들어진다 (F12)', async () => {
    await 트랜잭션(async (tx) => {
      공급자를_죽인다()
      const 씨앗 = await 활동_넣기(tx, { 후활동: true })
      await 세션_닫기(tx, 씨앗.session_id)
      expect(await 리포트_수(tx, 씨앗.session_id)).toBe(0)

      상자.보호자 = randomUUID()
      상자.아이들 = [씨앗.child_id]

      // 화면은 목록을 먼저 부르고 그 첫 줄을 연다. 리포트가 없으면 목록에 뜨지도 않으므로
      // **받침이 걸리는 자리는 목록**이다 (`service/reports.ts` 의 `받침()`).
      const 첫열람 = await 목록_라우트(new Request('http://x'), 경로({ child_id: 씨앗.child_id }))
      expect(첫열람.status).toBe(200)
      // 이번 응답에는 아직 안 실린다 — 띄우기만 하고 기다리지 않는다.
      expect((await 첫열람.json()) as ReportListItem[]).toHaveLength(0)

      await __testing.마지막작업
      expect(await 리포트_수(tx, 씨앗.session_id)).toBe(1)

      // 새로고침하면 보인다.
      const 두번째열람 = await 목록_라우트(
        new Request('http://x'),
        경로({ child_id: 씨앗.child_id }),
      )
      const 목록 = (await 두번째열람.json()) as ReportListItem[]
      expect(목록.map((것) => 것.session_id)).toEqual([씨앗.session_id])

      // 한 장 조회도 같은 받침을 건다 — 주소로 바로 연 보호자를 위해서다.
      const 한장 = await 리포트_라우트(new Request('http://x'), 경로({ session_id: 씨앗.session_id }))
      expect(한장.status).toBe(200)
    })
  })

  it('받침은 남의 아이 활동도, 아직 안 끝난 활동도 안 만든다', async () => {
    await 트랜잭션(async (tx) => {
      공급자를_죽인다()
      const 씨앗 = await 활동_넣기(tx, { 후활동: true })
      await tx
        .update(story_sessions)
        .set({ status: 'in_progress', completed_at: null })
        .where(eq(story_sessions.id, 씨앗.session_id))

      // 남의 아이 — 문지기가 먼저 막는다 (404). 받침이 돌 자리까지 못 간다.
      상자.보호자 = randomUUID()
      상자.아이들 = []
      const 남의것 = await 목록_라우트(new Request('http://x'), 경로({ child_id: 씨앗.child_id }))
      expect(남의것.status).toBe(404)
      await __testing.마지막작업
      expect(await 리포트_수(tx, 씨앗.session_id)).toBe(0)

      // 내 아이지만 이야기를 아직 안 끝냈다 — 놀던 이야기가 「끝난 것」처럼 뜨면 안 된다.
      상자.아이들 = [씨앗.child_id]
      const 내것 = await 목록_라우트(new Request('http://x'), 경로({ child_id: 씨앗.child_id }))
      expect(내것.status).toBe(200)
      await __testing.마지막작업
      expect(await 리포트_수(tx, 씨앗.session_id)).toBe(0)
    })
  })
})
