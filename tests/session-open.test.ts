// 세션 열기·조회 — 명세 8절 수용 기준 1·2·5 (`docs/이야기_세션_명세.md` · 이슈 #6).
//
// **여기 셋(생성·반복·legacy)이 초록이면 킥오프의 완료 정의를 채운 것이다.** 그 위에
// 4.1 의 따라잡기·미완 가드와 4.2 조회(읽기 전용·진행률)를 얹어 잰다.
//
// 어느 층을 두드리나 — 아이 앱 계약이 HTTP 코드·봉투로 적혀 있으므로 **라우트 핸들러**를
// 직접 부른다 (`tests/session-resume.test.ts` 와 같은 방식). 아이 확인은 쿠키·Supabase 라
// 이 검사 밖이다 — `@/lib/selected-child` 를 상자로 갈아 끼운다.

import { randomUUID } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { characters, stories, story_scenes, story_sessions } from '@/llm/db/schema'

// ⚠️ 팩토리 안에서 바깥 변수를 참조하면 hoisting 에 걸린다 (`session-resume.test.ts` 와 같은 상자).
const 상자 = vi.hoisted(() => ({ tx: null as unknown }))
const 아이상자 = vi.hoisted(() => ({ 아이: null as { id: string } | null }))

vi.mock('@/llm/repo/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/llm/repo/db')>()
  return {
    ...real,
    getDb: () => 상자.tx ?? real.getDb(),
  }
})

// 컨트롤러 입구의 아이 확인 — 저쪽(Supabase) 문제라 여기서는 상자 값으로 대신한다.
vi.mock('@/lib/selected-child', () => ({
  getSelectedChild: async () => 아이상자.아이,
}))

import { GET as 조회_라우트 } from '@/app/api/sessions/[session_id]/route'
import { POST as 열기_라우트 } from '@/app/api/sessions/route'
import { closeDb, getDb, type Conn } from '@/llm/repo/db'
import { createSession, readSession, sceneMessages } from '@/llm/repo/sessions'
import { runOfSession, submitTurn } from '@/llm/service/run'
import { analysisStep, decisionStep } from '@/llm/service/step'

import { installFakeSdk } from './support/sdk-gate'

// ── DB 가 있나 (session-resume.test.ts 와 같은 문지기) ─────────────────────

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
    `\n[session-open.test] Postgres 에 못 붙어 세션 열기 검사를 건너뛴다 (도커가 꺼져 있나?)\n` +
      `                    ${못붙는_이유}\n\n`,
  )
}
const 검사 = 못붙는_이유 === null ? describe : describe.skip

afterAll(async () => {
  상자.tx = null
  await closeDb()
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

// ── 가짜 제미나이 (`session-resume.test.ts` 와 같은 자리·같은 방식) ────────
// 세션 열기 자체는 LLM 을 안 부른다 — 미완 가드 검사에서 미완 턴을 **만들 때만** 쓴다.

interface 가짜_설정 {
  요소들?: (턴: number, 목표: string[]) => string[]
  대사_실패?: boolean
}

function 뽑기(user: string, 열쇠: string): string {
  const 맞은것 = new RegExp(`"${열쇠}":"((?:[^"\\\\]|\\\\.)*)"`).exec(user)
  return 맞은것 === null ? '' : (JSON.parse(`"${맞은것[1]}"`) as string)
}

function 목표_뽑기(user: string): string[] {
  const 맞은것 = /"target_elements":\[([^\]]*)\]/.exec(user)
  if (맞은것 === null || 맞은것[1].trim() === '') return []
  return JSON.parse(`[${맞은것[1]}]`) as string[]
}

function 가짜_제미나이(설정: 가짜_설정 = {}): void {
  let 분석_횟수 = 0
  installFakeSdk('gemini', () => ({
    interactions: {
      create: async (요청: Record<string, unknown>) => {
        const user = String(요청.input ?? '')
        if (요청.response_format !== undefined) {
          const 발화 = 뽑기(user, 'child_utterance')
          분석_횟수 += 1
          const 고르기 = 설정.요소들 ?? ((_턴: number, 목표: string[]) => 목표)
          return {
            output_text: JSON.stringify({
              child_intent: 'OPINION',
              main_point: `${발화}`,
              detected_elements: 고르기(분석_횟수, 목표_뽑기(user)).map((type) => ({
                type,
                evidence: 발화,
              })),
              utterance_validity: 'VALID',
            }),
            usage_metadata: { prompt_token_count: 100, candidates_token_count: 20 },
          }
        }
        if (설정.대사_실패) throw new Error('APIError: 대사 500')
        return {
          output_text: '그러게 말이다',
          usage_metadata: { prompt_token_count: 200, candidates_token_count: 30 },
        }
      },
    },
  }))
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
  아이상자.아이 = null
})

// ── 검사용 콘텐츠 — 대화 장면 **둘** (따라잡기가 다음 대화 장면으로 가는지 보려고) ──

const 여는_말_2 = '아이고… 나 때문에 다들 놀랐지 뭐야.'
const 여는_말_4 = '이제 나는 어쩌면 좋니…'

interface 씨앗 {
  story_id: string
  story_code: string
  scene_ids: Record<string, string>
}

async function 콘텐츠_넣기(tx: Conn, status: 'published' | 'draft' = 'published'): Promise<씨앗> {
  const 꼬리 = randomUUID().slice(0, 8)
  const story_code = `s_opn_${꼬리}`

  const [이야기] = await tx
    .insert(stories)
    .values({
      slug: story_code,
      title: `세션 열기 검사용 ${꼬리}`,
      summary: '검사용',
      difficulty: '보통',
      status,
    })
    .returning({ id: stories.id })

  const [캐릭터] = await tx
    .insert(characters)
    .values({
      story_id: 이야기.id,
      code: 'ch_opn_daughter_in_law',
      name: '며느리',
      persona: '시집온 지 얼마 안 된 며느리',
      speech_style: '옛이야기 말투',
      guidance_style: '자기 걱정을 소리 내어 말한다',
      forbidden: ['설명하지 않는다'],
    })
    .returning({ id: characters.id })

  const 대화칸 = {
    character_id: 캐릭터.id,
    character_name: '며느리',
    character_closing: '네 말을 들으니 마음이 놓이는구나.',
    scene_stance: '아직 참고 있다',
    scene_goal: '아이가 며느리의 처지를 헤아리게 한다',
    required_elements: ['EMPATHY', 'SOLUTION'],
    element_criteria: { SOLUTION: '어떻게 하면 좋을까?' },
    remaining_worries: { SOLUTION: '그럼 난 어떻게 하면 좋을까…' },
    preferred_turns: 2,
    max_turns: 4,
  }

  const 넣은_장면들 = await tx
    .insert(story_scenes)
    .values([
      { story_id: 이야기.id, code: 'sc_opn_01', scene_order: 1, scene_description: '전개 1' },
      {
        story_id: 이야기.id,
        code: 'sc_opn_02',
        scene_order: 2,
        conflict: '갈등',
        character_opening: 여는_말_2,
        ...대화칸,
      },
      { story_id: 이야기.id, code: 'sc_opn_03', scene_order: 3, scene_description: '전개 3' },
      {
        story_id: 이야기.id,
        code: 'sc_opn_04',
        scene_order: 4,
        conflict: '갈등 2',
        character_opening: 여는_말_4,
        ...대화칸,
      },
    ])
    .returning({ id: story_scenes.id, code: story_scenes.code })

  const scene_ids: Record<string, string> = {}
  for (const 행 of 넣은_장면들) scene_ids[행.code] = 행.id
  return { story_id: 이야기.id, story_code, scene_ids }
}

// ── 라우트를 아이 앱처럼 부른다 ────────────────────────────────────────────

interface 열기_본문 {
  ok: boolean
  data?: {
    session_id: string
    resumed: boolean
    status: string
    scene: { scene_id: string; code: string } | null
    last_character_line: { message_id: string; text: string } | null
    pending_turn: { message_id: string; stage: string } | null
    progress?: { scene_order: number; total: number }
  }
  error?: { code: string; message: string; retryable: boolean }
}

/** `POST /api/sessions` — body `{ story }` (명세 4.1절). */
async function 열기(story: string): Promise<{ status: number; 본문: 열기_본문 }> {
  const 응답 = await 열기_라우트(
    new Request('http://검사.local/api/sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ story }),
    }),
  )
  return { status: 응답.status, 본문: (await 응답.json()) as 열기_본문 }
}

/** `GET /api/sessions/{session_id}` (명세 4.2절). */
async function 조회(session_id: string): Promise<{ status: number; 본문: 열기_본문 }> {
  const 응답 = await 조회_라우트(new Request(`http://검사.local/api/sessions/${session_id}`), {
    params: Promise.resolve({ session_id }),
  })
  return { status: 응답.status, 본문: (await 응답.json()) as 열기_본문 }
}

// ═══════════════════════════════════════════════════════════════════════════
// 명세 8절 — 수용 기준 1 · 2 · 5 (+ 4.1 따라잡기·미완 가드 · 4.2 조회)
// ═══════════════════════════════════════════════════════════════════════════

검사('세션 열기·조회 — 명세 8절 수용 기준', () => {
  it('1. 새 아이·새 이야기 → 세션·회차(started_by=app) 동반 생성 · 첫 대화 장면 · 여는 말', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      아이상자.아이 = { id: randomUUID() }

      const { status, 본문 } = await 열기(씨.story_code)

      expect(status).toBe(200)
      expect(본문.ok).toBe(true)
      expect(본문.data?.resumed).toBe(false)
      expect(본문.data?.status).toBe('in_progress')
      expect(본문.data?.scene).toEqual({ scene_id: 씨.scene_ids.sc_opn_02, code: 'sc_opn_02' })
      expect(본문.data?.pending_turn).toBeNull()

      const session_id = 본문.data!.session_id
      // 회차가 함께 생겼다 — started_by='app' · scope='story' (확정 결정 ⑥).
      const 회차 = await runOfSession(tx, session_id)
      expect(회차).not.toBeNull()
      expect(회차?.started_by).toBe('app')
      expect(회차?.scope).toBe('story')
      // 여는 말이 저장됐고 last_character_line 이 그 행이다.
      const 대화 = await sceneMessages(tx, { session_id, scene_id: 씨.scene_ids.sc_opn_02 })
      expect(대화.map((행) => 행.speaker_type)).toEqual(['character'])
      expect(대화[0].text).toBe(여는_말_2)
      expect(본문.data?.last_character_line?.text).toBe(여는_말_2)
    })
  })

  it('2. 같은 요청 반복 → 같은 session_id · resumed=true · 행 수 불변 (반복 안전)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      아이상자.아이 = { id: randomUUID() }

      const 처음 = await 열기(씨.story_code)
      const 다시 = await 열기(씨.story_code)

      expect(다시.status).toBe(200)
      expect(다시.본문.data?.session_id).toBe(처음.본문.data?.session_id)
      expect(다시.본문.data?.resumed).toBe(true)
      expect(다시.본문.data?.scene?.code).toBe('sc_opn_02')

      // 행 수 불변 — 세션 하나 · 여는 말 하나 그대로다.
      const 세션들 = await tx
        .select({ id: story_sessions.id })
        .from(story_sessions)
        .where(eq(story_sessions.story_id, 씨.story_id))
      expect(세션들).toHaveLength(1)
      const 대화 = await sceneMessages(tx, {
        session_id: 처음.본문.data!.session_id,
        scene_id: 씨.scene_ids.sc_opn_02,
      })
      expect(대화).toHaveLength(1)
    })
  })

  it('5. 회차 없는 legacy in_progress 세션 → 회차가 생기고 정상 진행', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const child_id = randomUUID()
      아이상자.아이 = { id: child_id }
      // 옛 `startStory()` 가 남기던 모양 — 세션만 있고 회차도 장면도 없다.
      const legacy_id = await createSession(tx, { story_id: 씨.story_id, child_id })
      expect(await runOfSession(tx, legacy_id)).toBeNull()

      const { status, 본문 } = await 열기(씨.story_code)

      expect(status).toBe(200)
      expect(본문.data?.session_id).toBe(legacy_id)
      expect(본문.data?.resumed).toBe(true)
      expect(본문.data?.scene?.code).toBe('sc_opn_02')
      expect(본문.data?.last_character_line?.text).toBe(여는_말_2)
      const 회차 = await runOfSession(tx, legacy_id)
      expect(회차?.started_by).toBe('app')
    })
  })

  it('따라잡기 — 장면이 끝난 세션을 다시 열면 다음 대화 장면까지 전진하고 여는 말이 생긴다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      아이상자.아이 = { id: randomUUID() }
      const 처음 = await 열기(씨.story_code)
      const session_id = 처음.본문.data!.session_id

      // 첫 대화 장면이 끝난 상태를 만든다 (판정이 CLOSING 을 내면 차는 칸이다).
      await tx
        .update(story_sessions)
        .set({ scene_goal_met: true, scene_end_reason: 'GOAL_MET' })
        .where(eq(story_sessions.id, session_id))

      const { status, 본문 } = await 열기(씨.story_code)

      expect(status).toBe(200)
      expect(본문.data?.resumed).toBe(true)
      expect(본문.data?.scene).toEqual({ scene_id: 씨.scene_ids.sc_opn_04, code: 'sc_opn_04' })
      expect(본문.data?.last_character_line?.text).toBe(여는_말_4)
      // 다음 대화 장면의 여는 말 행이 실제로 저장됐다.
      const 대화 = await sceneMessages(tx, { session_id, scene_id: 씨.scene_ids.sc_opn_04 })
      expect(대화.map((행) => 행.text)).toEqual([여는_말_4])
    })
  })

  it('미완 턴이 있으면 열기는 전진하지 않는다 — pending_turn 을 실어 resume 으로 보낸다', async () => {
    // CLOSING 판정까지 갔다가 ③(대사)에서 죽으면 scene_end_reason 이 이미 차 있다.
    // 이때 전진해 버리면 그 턴을 두고 다음 장면으로 가 버린다 (open.ts 의 가드가 막는 자리).
    가짜_제미나이({ 요소들: (턴, 목표) => (턴 === 1 ? [목표[0]] : 목표) })

    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      아이상자.아이 = { id: randomUUID() }
      const 처음 = await 열기(씨.story_code)
      const session_id = 처음.본문.data!.session_id
      const run_id = (await runOfSession(tx, session_id))!.id

      // 1턴 완주(목표 절반) 뒤, 2턴을 ①②까지만 돌려 CLOSING 이 박제된 미완 턴을 만든다.
      await submitTurn({ run_id, child_utterance: '며느리가 창피했을 것 같아', conn: tx })
      const 분석단계 = await analysisStep({ session_id, child_utterance: '참지 말고 말해', conn: tx })
      const 판단 = await decisionStep({
        session_id,
        message_id: 분석단계.data.message_id,
        analysis: {
          child_intent: 분석단계.data.analysis.child_intent,
          detected_elements: 분석단계.data.detected_elements_kept,
          utterance_validity: 분석단계.data.analysis.utterance_validity,
        },
        conn: tx,
      })
      expect(판단.data.decision.response_mode).toBe('CLOSING')

      const { status, 본문 } = await 열기(씨.story_code)

      expect(status).toBe(200)
      expect(본문.data?.pending_turn).toEqual({
        message_id: 분석단계.data.message_id,
        stage: 'character',
      })
      // 전진하지 않았다 — 세션은 여전히 그 대화 장면에 있다.
      expect(본문.data?.scene?.code).toBe('sc_opn_02')
      expect((await readSession(tx, session_id)).current_scene_id).toBe(씨.scene_ids.sc_opn_02)
    })
  })

  it('조회(GET)는 상태를 바꾸지 않고 progress 를 준다 (4.2절)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      아이상자.아이 = { id: randomUUID() }
      const 처음 = await 열기(씨.story_code)
      const session_id = 처음.본문.data!.session_id

      // 장면이 끝난 상태에서도 — 열기와 달리 — 따라잡지 않아야 한다.
      await tx
        .update(story_sessions)
        .set({ scene_goal_met: true, scene_end_reason: 'GOAL_MET' })
        .where(eq(story_sessions.id, session_id))

      const { status, 본문 } = await 조회(session_id)

      expect(status).toBe(200)
      expect(본문.data?.status).toBe('in_progress')
      expect(본문.data?.progress).toEqual({ scene_order: 2, total: 4 })
      expect(본문.data?.scene?.code).toBe('sc_opn_02')
      // 읽기 전용 — current_scene_id 가 그대로다.
      expect((await readSession(tx, session_id)).current_scene_id).toBe(씨.scene_ids.sc_opn_02)
    })
  })

  it('아이 쿠키가 없으면 401 CHILD_NOT_SELECTED · 공개 전 이야기는 400 · 남의 세션은 404', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)

      // 아이가 없다 — 401.
      const 무명 = await 열기(씨.story_code)
      expect(무명.status).toBe(401)
      expect(무명.본문.error?.code).toBe('CHILD_NOT_SELECTED')

      // 공개 전 이야기 — 400.
      아이상자.아이 = { id: randomUUID() }
      const 초안 = await 콘텐츠_넣기(tx, 'draft')
      const 막힘 = await 열기(초안.story_code)
      expect(막힘.status).toBe(400)
      expect(막힘.본문.error?.code).toBe('BAD_REQUEST')

      // 남의 아이 세션 조회 — 있다는 사실도 안 새게 404.
      const 처음 = await 열기(씨.story_code)
      아이상자.아이 = { id: randomUUID() }
      const 남의것 = await 조회(처음.본문.data!.session_id)
      expect(남의것.status).toBe(404)
      expect(남의것.본문.error?.code).toBe('SESSION_NOT_FOUND')

      // 아예 없는 세션 — 404.
      const 없음 = await 조회(randomUUID())
      expect(없음.status).toBe(404)
      expect(없음.본문.error?.code).toBe('SESSION_NOT_FOUND')
    })
  })
})
