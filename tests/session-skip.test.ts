// 대화 씬 건너뛰기 API — `POST /api/sessions/{id}/scenes/{code}/skip`.
//
// 재는 것은 넷이다: **서버도 같이 넘어가나** · **반복 안전한가** · **미완 턴을 막나** ·
// **건너뛴 사실이 messages 로 남나**.
//
// ## 어느 층을 두드리나
//
// 계약이 HTTP 코드·봉투로 적혀 있으므로 **라우트 핸들러**를 직접 부른다
// (`tests/session-turn.test.ts` 와 같은 방식 — `getDb()` 자리에 검사 트랜잭션을 꽂아 되돌린다).
//
// ⚠️ 이 검사는 `sql/004_scene_skipped.sql` 이 들어간 DB 를 전제한다. 안 넣었으면
//    「마지막 대화를 건너뛴다」에서 CHECK 위반으로 빨개진다 — 그게 이 마이그레이션의 존재 이유다.

import { randomUUID } from 'node:crypto'

import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { characters, stories, story_scenes } from '@/llm/db/schema'

// ⚠️ 팩토리 안에서 바깥 변수를 참조하면 hoisting 에 걸린다 (`session-turn.test.ts` 와 같은 상자).
const 상자 = vi.hoisted(() => ({ tx: null as unknown }))

vi.mock('@/llm/repo/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/llm/repo/db')>()
  return {
    ...real,
    getDb: () => 상자.tx ?? real.getDb(),
  }
})

// 받아쓰기를 바이트 → UTF-8 로 흉내 낸다 (미완 턴을 만들 때만 쓴다).
vi.mock('@/stt/server', () => ({
  SttError: class SttError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly detail?: string,
    ) {
      super(message)
    }
  },
  recognizeSpeech: async (audio: Buffer) => audio.toString('utf-8'),
}))

import { POST as 건너뛰기_라우트 } from '@/app/api/sessions/[session_id]/scenes/[scene_code]/skip/route'
import { POST as 턴_라우트 } from '@/app/api/sessions/[session_id]/turns/route'
import { closeDb, getDb, type Conn } from '@/llm/repo/db'
import { readRun } from '@/llm/repo/runs'
import { readSession, sceneMessages } from '@/llm/repo/sessions'
import { advanceRun, startRun } from '@/llm/service/run'

import { installFakeSdk } from './support/sdk-gate'

// ── DB 가 있나 (session-turn.test.ts 와 같은 문지기) ───────────────────────

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
    `\n[session-skip.test] Postgres 에 못 붙어 건너뛰기 검사를 건너뛴다 (도커가 꺼져 있나?)\n` +
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

/** 대사 단계에서 죽는 가짜 — 미완 턴을 만드는 데만 쓴다. */
function 가짜_제미나이_대사실패(): void {
  installFakeSdk('gemini', () => ({
    interactions: {
      create: async (요청: Record<string, unknown>) => {
        if (요청.response_format === undefined) throw new Error('APIError: 대사 500')
        return {
          output_text: JSON.stringify({
            child_intent: 'OPINION',
            main_point: '아이 말',
            detected_elements: [],
            utterance_validity: 'VALID',
          }),
          usage_metadata: { prompt_token_count: 10, candidates_token_count: 2 },
        }
      },
    },
  }))
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

// ── 검사용 콘텐츠 ──────────────────────────────────────────────────────────

interface 씨앗 {
  story_code: string
  scene_ids: Record<string, string>
}

/**
 * `여정` — 전개 1 · **대화 2** · 전개 3 · **대화 4** · 전개 5 (방귀쟁이 며느리와 같은 모양).
 * `외길` — 전개 1 · **대화 2** 로 끝. 마지막 대화를 건너뛰는 갈래를 잰다.
 */
async function 콘텐츠_넣기(tx: Conn, 모양: '여정' | '외길'): Promise<씨앗> {
  const 꼬리 = randomUUID().slice(0, 8)
  const story_code = `s_skip_${꼬리}`

  const [이야기] = await tx
    .insert(stories)
    .values({
      slug: story_code,
      title: `건너뛰기 검사용 ${꼬리}`,
      summary: '검사용',
      difficulty: '보통',
      status: 'draft',
    })
    .returning({ id: stories.id })

  const [캐릭터] = await tx
    .insert(characters)
    .values({
      story_id: 이야기.id,
      code: 'ch_skip_daughter_in_law',
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
    character_opening: '아이고… 나 때문에 다들 놀랐지 뭐야.',
    character_closing: '네 말을 들으니 마음이 놓이는구나.',
    scene_stance: '아직 참고 있다',
    scene_goal: '아이가 며느리의 처지를 헤아리게 한다',
    required_elements: ['EMPATHY', 'SOLUTION'],
    element_criteria: { SOLUTION: '어떻게 하면 좋을까?' },
    remaining_worries: { SOLUTION: '그럼 난 어떻게 하면 좋을까…' },
    preferred_turns: 2,
    max_turns: 4,
  }

  const 장면들 =
    모양 === '여정'
      ? [
          { story_id: 이야기.id, code: 'sc_skip_01', scene_order: 1, scene_description: '전개 1' },
          { story_id: 이야기.id, code: 'sc_skip_02', scene_order: 2, conflict: '갈등', ...대화칸 },
          { story_id: 이야기.id, code: 'sc_skip_03', scene_order: 3, scene_description: '전개 3' },
          { story_id: 이야기.id, code: 'sc_skip_04', scene_order: 4, conflict: '갈등 2', ...대화칸 },
          { story_id: 이야기.id, code: 'sc_skip_05', scene_order: 5, scene_description: '전개 5' },
        ]
      : [
          { story_id: 이야기.id, code: 'sc_skip_01', scene_order: 1, scene_description: '전개 1' },
          { story_id: 이야기.id, code: 'sc_skip_02', scene_order: 2, conflict: '갈등', ...대화칸 },
        ]

  const 넣은_장면들 = await tx
    .insert(story_scenes)
    .values(장면들)
    .returning({ id: story_scenes.id, code: story_scenes.code })

  const scene_ids: Record<string, string> = {}
  for (const 행 of 넣은_장면들) scene_ids[행.code] = 행.id
  return { story_code, scene_ids }
}

/** 회차를 열고 첫 대화 장면 앞까지 전개를 재생해 둔다. */
async function 회차_준비(tx: Conn, 모양: '여정' | '외길' = '여정') {
  const 씨 = await 콘텐츠_넣기(tx, 모양)
  const { run } = await startRun(tx, { story_code: 씨.story_code, started_by: '검사' })
  const 할_일 = await advanceRun(tx, run.id)
  expect(할_일.kind).toBe('발화받기')
  return { 씨, run_id: run.id, session_id: run.session_id }
}

// ── 라우트를 아이 앱처럼 부른다 ────────────────────────────────────────────

interface 봉투 {
  ok: boolean
  data?: {
    skipped?: { scene_id: string; code: string } | null
    scene?: { scene_id: string; code: string } | null
  }
  error?: { code: string; message: string; retryable: boolean; pending?: { stage: string } }
}

async function 건너뛰기(
  session_id: string,
  scene_code: string,
): Promise<{ status: number; 본문: 봉투 }> {
  const 응답 = await 건너뛰기_라우트(
    new Request(`http://검사.local/api/sessions/${session_id}/scenes/${scene_code}/skip`, {
      method: 'POST',
    }),
    { params: Promise.resolve({ session_id, scene_code }) },
  )
  return { status: 응답.status, 본문: (await 응답.json()) as 봉투 }
}

async function 턴(session_id: string, 말: string): Promise<number> {
  const 응답 = await 턴_라우트(
    new Request(`http://검사.local/api/sessions/${session_id}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-audio-channels': '1' },
      body: Buffer.from(말, 'utf-8'),
    }),
    { params: Promise.resolve({ session_id }) },
  )
  return 응답.status
}

// ═══════════════════════════════════════════════════════════════════════════

검사('대화 씬 건너뛰기 API', () => {
  it('대화 씬을 넘기면 서버도 다음 대화까지 전진한다 — 여는 말이 저장되고 아이 행은 0개로 남는다', async () => {
    await 트랜잭션(async (tx) => {
      const { 씨, session_id } = await 회차_준비(tx, '여정')

      const { status, 본문 } = await 건너뛰기(session_id, 'sc_skip_02')
      expect(status).toBe(200)
      expect(본문.ok).toBe(true)
      expect(본문.data?.skipped).toEqual({ scene_id: 씨.scene_ids.sc_skip_02, code: 'sc_skip_02' })
      // 도착 장면은 **서버가 정한다** — 전개 3 을 지나 대화 4 다.
      expect(본문.data?.scene).toEqual({ scene_id: 씨.scene_ids.sc_skip_04, code: 'sc_skip_04' })

      const 세션 = await readSession(tx, session_id)
      expect(세션.current_scene_id).toBe(씨.scene_ids.sc_skip_04)
      expect(세션.status).toBe('in_progress')
      // 새 장면에 들어가면서 지워진다 — 「전진을 일으키는 순간용 값」이다.
      expect(세션.scene_end_reason).toBeNull()

      // 다음 대화의 여는 말은 이미 저장돼 있고 —
      const 다음_대화 = await sceneMessages(tx, { session_id, scene_id: 씨.scene_ids.sc_skip_04 })
      expect(다음_대화.map((행) => 행.speaker_type)).toEqual(['character'])
      // — 건너뛴 장면에는 여는 말만 있고 아이 행이 없다. 이것이 「건너뛰었다」의 영구 근거다.
      const 건너뛴 = await sceneMessages(tx, { session_id, scene_id: 씨.scene_ids.sc_skip_02 })
      expect(건너뛴.map((행) => 행.speaker_type)).toEqual(['character'])
    })
  })

  it('반복 안전 — 같은 요청을 두 번 보내도 두 장면이 날아가지 않는다', async () => {
    await 트랜잭션(async (tx) => {
      const { 씨, session_id } = await 회차_준비(tx, '여정')

      await 건너뛰기(session_id, 'sc_skip_02')
      const 두번째 = await 건너뛰기(session_id, 'sc_skip_02')

      expect(두번째.status).toBe(200)
      // 아무것도 안 했다 — 대기 자리만 알려 준다.
      expect(두번째.본문.data?.skipped).toBeNull()
      expect(두번째.본문.data?.scene).toEqual({
        scene_id: 씨.scene_ids.sc_skip_04,
        code: 'sc_skip_04',
      })
      expect((await readSession(tx, session_id)).current_scene_id).toBe(씨.scene_ids.sc_skip_04)
    })
  })

  it('서버가 기다리는 장면이 아니면 아무것도 하지 않고 대기 자리만 알려 준다', async () => {
    await 트랜잭션(async (tx) => {
      const { 씨, session_id } = await 회차_준비(tx, '여정')

      const { status, 본문 } = await 건너뛰기(session_id, 'sc_skip_04')
      expect(status).toBe(200)
      expect(본문.data?.skipped).toBeNull()
      expect(본문.data?.scene).toEqual({ scene_id: 씨.scene_ids.sc_skip_02, code: 'sc_skip_02' })
      expect((await readSession(tx, session_id)).current_scene_id).toBe(씨.scene_ids.sc_skip_02)
    })
  })

  it('마지막 대화를 건너뛰면 회차가 닫히고 SKIPPED 가 그대로 남는다', async () => {
    await 트랜잭션(async (tx) => {
      const { run_id, session_id } = await 회차_준비(tx, '외길')

      const { status, 본문 } = await 건너뛰기(session_id, 'sc_skip_02')
      expect(status).toBe(200)
      expect(본문.data?.skipped?.code).toBe('sc_skip_02')
      expect(본문.data?.scene).toBeNull()

      const 세션 = await readSession(tx, session_id)
      expect(세션.status).toBe('completed')
      // 다음 장면이 없어 `enterScene()` 이 안 돌았다 — 이 갈래에서만 값이 남는다.
      // (`sql/004_scene_skipped.sql` 을 안 넣었으면 여기서 CHECK 위반으로 터진다.)
      expect(세션.scene_end_reason).toBe('SKIPPED')
      expect((await readRun(tx, run_id)).ended_at).not.toBeNull()
    })
  })

  it('미완 턴이 있으면 409 TURN_INCOMPLETE — 먼저 이어 돌려야 한다', async () => {
    가짜_제미나이_대사실패()

    await 트랜잭션(async (tx) => {
      const { 씨, session_id } = await 회차_준비(tx, '여정')

      // 대사 단계에서 죽는다 — 저장 상태는 미완 턴이다.
      expect(await 턴(session_id, '며느리가 불쌍해')).toBe(502)

      const { status, 본문 } = await 건너뛰기(session_id, 'sc_skip_02')
      expect(status).toBe(409)
      expect(본문.error?.code).toBe('TURN_INCOMPLETE')
      expect(본문.error?.pending?.stage).toBe('character')

      // 전진하지 않았다 — 미완 턴을 두고 넘어가면 그 턴은 영영 미아가 된다.
      expect((await readSession(tx, session_id)).current_scene_id).toBe(씨.scene_ids.sc_skip_02)
    })
  })

  it('없는 세션·uuid 아님 → 404', async () => {
    await 트랜잭션(async () => {
      const 없음 = await 건너뛰기(randomUUID(), 'sc_skip_02')
      expect(없음.status).toBe(404)
      expect(없음.본문.error?.code).toBe('SESSION_NOT_FOUND')
      expect((await 건너뛰기('말도-안되는-id', 'sc_skip_02')).status).toBe(404)
    })
  })
})
