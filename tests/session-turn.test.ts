// 아이 앱 턴 API — 명세 8절 수용 기준 3·4·6·7 (`docs/이야기_세션_명세.md` · 이슈 #7).
//
// **여기가 다 초록이면 이 이슈는 끝난 것이다.** 기준 문장을 그대로 검사 이름에 옮겼다.
//
// ## 어느 층을 두드리나
//
// 아이 앱 계약이 HTTP 코드·봉투로 적혀 있으므로 **라우트 핸들러**를 직접 부른다
// (`tests/session-resume.test.ts` 와 같은 방식 — `getDb()` 자리에 검사 트랜잭션을 꽂아 되돌린다).
//
// ## STT 는 모듈 자리에서 가짜로 바꾼다
//
// 실호출 금지 — 가짜 오디오 바이트를 **UTF-8 그대로 받아쓴 척** 한다. 그래서 검사가
// 보내는 바이트가 곧 발화다 (무음은 공백 바이트 → 빈 발화 길을 탄다).
// LLM 은 SDK 자리에서 가짜로 바꾼다 (`tests/service.test.ts` 와 같은 가짜).

import { randomUUID } from 'node:crypto'

import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { characters, stories, story_scenes } from '@/llm/db/schema'

// ⚠️ 팩토리 안에서 바깥 변수를 참조하면 hoisting 에 걸린다 (`session-resume.test.ts` 와 같은 상자).
const 상자 = vi.hoisted(() => ({ tx: null as unknown }))

vi.mock('@/llm/repo/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/llm/repo/db')>()
  return {
    ...real,
    getDb: () => 상자.tx ?? real.getDb(),
  }
})

// 받아쓰기를 바이트 → UTF-8 로 흉내 낸다. `SttError` 는 컨트롤러의 instanceof 가 쓰므로 같이 낸다.
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

import { POST as 턴_라우트 } from '@/app/api/sessions/[session_id]/turns/route'
import { POST as 이어하기_라우트 } from '@/app/api/sessions/[session_id]/turns/resume/route'
import { closeDb, getDb, type Conn } from '@/llm/repo/db'
import { readRun } from '@/llm/repo/runs'
import { readSession, sceneMessages } from '@/llm/repo/sessions'
import { advanceRun, startRun } from '@/llm/service/run'

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
    `\n[session-turn.test] Postgres 에 못 붙어 턴 API 검사를 건너뛴다 (도커가 꺼져 있나?)\n` +
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

interface 가짜_설정 {
  /** 이번 분석이 찾아냈다고 할 요소들. 기본은 **그 장면의 목표 전부**. */
  요소들?: (턴: number, 목표: string[]) => string[]
  분석_실패?: boolean
  대사_실패?: boolean
}

interface 가짜_기록 {
  호출: { 용도: '분석' | '대사' }[]
  설정: 가짜_설정
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

/** SDK 자리에 가짜를 꽂는다. 분석과 대사는 `response_format` 유무로 가른다. */
function 가짜_제미나이(설정: 가짜_설정 = {}): 가짜_기록 {
  const 기록: 가짜_기록 = { 호출: [], 설정 }

  installFakeSdk('gemini', () => ({
    interactions: {
      create: async (요청: Record<string, unknown>) => {
        const user = String(요청.input ?? '')
        const 분석인가 = 요청.response_format !== undefined
        기록.호출.push({ 용도: 분석인가 ? '분석' : '대사' })

        if (분석인가) {
          if (기록.설정.분석_실패) throw new Error('APIError: 분석 500')
          const 발화 = 뽑기(user, 'child_utterance')
          const 턴 = 기록.호출.filter((하나) => 하나.용도 === '분석').length
          const 고르기 = 기록.설정.요소들 ?? ((_턴: number, 목표: string[]) => 목표)
          return {
            output_text: JSON.stringify({
              child_intent: 'OPINION',
              main_point: `${발화}`,
              detected_elements: 고르기(턴, 목표_뽑기(user)).map((type) => ({
                type,
                evidence: 발화,
              })),
              utterance_validity: 'VALID',
            }),
            usage_metadata: { prompt_token_count: 100, candidates_token_count: 20 },
          }
        }

        if (기록.설정.대사_실패) throw new Error('APIError: 대사 500')
        return {
          output_text: `그러게 말이다 (${기록.호출.length})`,
          usage_metadata: { prompt_token_count: 200, candidates_token_count: 30 },
        }
      },
    },
  }))

  return 기록
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

// ── 검사용 콘텐츠 ──────────────────────────────────────────────────────────

const 닫는_말 = '네 말을 들으니 마음이 놓이는구나.'

interface 씨앗 {
  story_id: string
  story_code: string
  scene_ids: Record<string, string>
  scene_codes: Record<string, string>
}

/**
 * `여정` — 전개 1 · **대화 2** · 전개 3 · **대화 4** · 전개 5 (방귀쟁이 며느리와 같은 모양).
 * `외길` — 전개 1 · **대화 2** 로 끝. 마지막 대화가 이야기의 마지막 행인 갈래를 잰다.
 */
async function 콘텐츠_넣기(tx: Conn, 모양: '여정' | '외길'): Promise<씨앗> {
  const 꼬리 = randomUUID().slice(0, 8)
  const story_code = `s_stn_${꼬리}`

  const [이야기] = await tx
    .insert(stories)
    .values({
      slug: story_code,
      title: `턴 API 검사용 ${꼬리}`,
      summary: '검사용',
      difficulty: '보통',
      status: 'draft',
    })
    .returning({ id: stories.id })

  const [캐릭터] = await tx
    .insert(characters)
    .values({
      story_id: 이야기.id,
      code: 'ch_stn_daughter_in_law',
      name: '며느리',
      persona: '시집온 지 얼마 안 된 며느리',
      speech_style: '옛이야기 말투',
      guidance_style: '자기 걱정을 소리 내어 말한다',
      forbidden: ['설명하지 않는다'],
    })
    .returning({ id: characters.id })

  const 대화칸 = (preferred: number) => ({
    character_id: 캐릭터.id,
    character_name: '며느리',
    character_opening: '아이고… 나 때문에 다들 놀랐지 뭐야.',
    character_closing: 닫는_말,
    scene_stance: '아직 참고 있다',
    scene_goal: '아이가 며느리의 처지를 헤아리게 한다',
    required_elements: ['EMPATHY', 'SOLUTION'],
    element_criteria: { SOLUTION: '어떻게 하면 좋을까?' },
    remaining_worries: { SOLUTION: '그럼 난 어떻게 하면 좋을까…' },
    preferred_turns: preferred,
    max_turns: 4,
  })

  const 장면들 =
    모양 === '여정'
      ? [
          { story_id: 이야기.id, code: 'sc_stn_01', scene_order: 1, scene_description: '전개 1' },
          { story_id: 이야기.id, code: 'sc_stn_02', scene_order: 2, conflict: '갈등', ...대화칸(2) },
          { story_id: 이야기.id, code: 'sc_stn_03', scene_order: 3, scene_description: '전개 3' },
          { story_id: 이야기.id, code: 'sc_stn_04', scene_order: 4, conflict: '갈등 2', ...대화칸(2) },
          { story_id: 이야기.id, code: 'sc_stn_05', scene_order: 5, scene_description: '전개 5' },
        ]
      : [
          { story_id: 이야기.id, code: 'sc_stn_01', scene_order: 1, scene_description: '전개 1' },
          { story_id: 이야기.id, code: 'sc_stn_02', scene_order: 2, conflict: '갈등', ...대화칸(1) },
        ]

  const 넣은_장면들 = await tx
    .insert(story_scenes)
    .values(장면들)
    .returning({ id: story_scenes.id, code: story_scenes.code })

  const scene_ids: Record<string, string> = {}
  const scene_codes: Record<string, string> = {}
  for (const 행 of 넣은_장면들) {
    scene_ids[행.code] = 행.id
    scene_codes[행.id] = 행.code
  }
  return { story_id: 이야기.id, story_code, scene_ids, scene_codes }
}

/** 회차를 열고 첫 대화 장면 앞까지 전개를 재생해 둔다 (`session-resume.test.ts` 와 같다). */
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
    empty?: boolean
    child?: { message_id: string; text: string }
    dialogue?: { message_id: string; text: string; source: string }
    next?: { kind: string; scene_id: string; next_scene?: { scene_id: string; code: string } }
  }
  error?: {
    code: string
    message: string
    retryable: boolean
    pending?: { message_id: string; stage: string }
  }
}

/** `POST /api/sessions/{session_id}/turns` — body 는 녹음 바이트 (가짜 STT 가 UTF-8 로 받아쓴다). */
async function 턴(session_id: string, 말: string): Promise<{ status: number; 본문: 봉투 }> {
  const 응답 = await 턴_라우트(
    new Request(`http://검사.local/api/sessions/${session_id}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-audio-channels': '1' },
      body: Buffer.from(말, 'utf-8'),
    }),
    { params: Promise.resolve({ session_id }) },
  )
  return { status: 응답.status, 본문: (await 응답.json()) as 봉투 }
}

async function 이어하기(session_id: string): Promise<{ status: number; 본문: 봉투 }> {
  const 응답 = await 이어하기_라우트(
    new Request(`http://검사.local/api/sessions/${session_id}/turns/resume`, { method: 'POST' }),
    { params: Promise.resolve({ session_id }) },
  )
  return { status: 응답.status, 본문: (await 응답.json()) as 봉투 }
}

// ═══════════════════════════════════════════════════════════════════════════
// 명세 8절 — 수용 기준 3 · 4 · 6 · 7
// ═══════════════════════════════════════════════════════════════════════════

검사('아이 앱 턴 API — 명세 8절 수용 기준', () => {
  it('3·4. 발화받기 → 장면끝(next_scene·다음 여는 말 저장) → 다음 장면 → 회차끝·세션 completed', async () => {
    가짜_제미나이({
      // 첫 턴만 목표를 다 못 채운다 — 발화받기 갈래를 함께 잰다.
      요소들: (턴, 목표) => (턴 === 1 ? [목표[0]] : 목표),
    })

    await 트랜잭션(async (tx) => {
      const { 씨, run_id, session_id } = await 회차_준비(tx, '여정')

      // 턴 1 — 목표 미달. 같은 장면에서 계속 말할 차례다.
      const 첫턴 = await 턴(session_id, '며느리가 창피했을 것 같아')
      expect(첫턴.status).toBe(200)
      expect(첫턴.본문.ok).toBe(true)
      expect(첫턴.본문.data?.child?.text).toBe('며느리가 창피했을 것 같아')
      expect(첫턴.본문.data?.dialogue?.source).toBe('generated')
      expect(첫턴.본문.data?.next).toEqual({ kind: '발화받기', scene_id: 씨.scene_ids.sc_stn_02 })

      // 턴 2 — preferred_turns(2) 채움 + 목표 완주 → CLOSING. **같은 요청에서 장면이 전진한다.**
      const 둘째턴 = await 턴(session_id, '방귀를 참으면 병이 나니까 같이 방법을 찾아보자')
      expect(둘째턴.status).toBe(200)
      expect(둘째턴.본문.data?.dialogue).toMatchObject({ source: 'fixed', text: 닫는_말 })
      expect(둘째턴.본문.data?.next).toEqual({
        kind: '장면끝',
        scene_id: 씨.scene_ids.sc_stn_02,
        next_scene: { scene_id: 씨.scene_ids.sc_stn_04, code: 'sc_stn_04' },
      })

      // 다음 대화 장면의 여는 말 행이 **이미** 저장돼 있다 (수용 기준 3).
      const 다음_대화 = await sceneMessages(tx, { session_id, scene_id: 씨.scene_ids.sc_stn_04 })
      expect(다음_대화.map((행) => 행.speaker_type)).toEqual(['character'])
      const 세션_중간 = await readSession(tx, session_id)
      expect(세션_중간.current_scene_id).toBe(씨.scene_ids.sc_stn_04)
      expect(세션_중간.status).toBe('in_progress')
      expect(세션_중간.scene_end_reason).toBeNull()

      // 턴 3 — 새 장면의 첫 턴. 카운터가 초기화됐으니 아직 CLOSING 이 아니다.
      const 셋째턴 = await 턴(session_id, '할머니한테 사실대로 말해 보자')
      expect(셋째턴.status).toBe(200)
      expect(셋째턴.본문.data?.next).toEqual({ kind: '발화받기', scene_id: 씨.scene_ids.sc_stn_04 })

      // 턴 4 — 마지막 대화 장면이 끝난다. 남은 것은 전개(sc_stn_05)뿐이라 회차끝이다 (수용 기준 4).
      const 넷째턴 = await 턴(session_id, '우리 같이 지켜 주자')
      expect(넷째턴.status).toBe(200)
      expect(넷째턴.본문.data?.dialogue?.source).toBe('fixed')
      expect(넷째턴.본문.data?.next).toEqual({ kind: '회차끝', scene_id: 씨.scene_ids.sc_stn_04 })

      const 세션_끝 = await readSession(tx, session_id)
      expect(세션_끝.status).toBe('completed')
      expect((await readRun(tx, run_id)).ended_at).not.toBeNull()
    })
  })

  it('4-보강. 마지막 대화가 이야기의 마지막 행이면 — 엔진이 닫고, 전진 문은 다시 닫지 않는다', async () => {
    가짜_제미나이()

    await 트랜잭션(async (tx) => {
      const { 씨, run_id, session_id } = await 회차_준비(tx, '외길')

      // preferred_turns=1 + 목표 완주 → 첫 턴이 곧 CLOSING 이고, 뒤에 장면이 없다.
      const { status, 본문 } = await 턴(session_id, '며느리를 우리가 지켜 주자')
      expect(status).toBe(200)
      expect(본문.data?.dialogue?.source).toBe('fixed')
      expect(본문.data?.next).toEqual({ kind: '회차끝', scene_id: 씨.scene_ids.sc_stn_02 })

      expect((await readSession(tx, session_id)).status).toBe('completed')
      expect((await readRun(tx, run_id)).ended_at).not.toBeNull()
    })
  })

  it('6. 빈 발화(무음) → 200 { empty: true } · messages 행 수·턴 카운트 불변', async () => {
    const 기록 = 가짜_제미나이()

    await 트랜잭션(async (tx) => {
      const { 씨, session_id } = await 회차_준비(tx, '여정')

      const { status, 본문 } = await 턴(session_id, '   ')
      expect(status).toBe(200)
      expect(본문.ok).toBe(true)
      expect(본문.data).toEqual({ empty: true })

      // 여는 말 하나뿐 — 아이 행이 안 생겼고 턴 카운트도 그대로다.
      const 대화 = await sceneMessages(tx, { session_id, scene_id: 씨.scene_ids.sc_stn_02 })
      expect(대화.map((행) => 행.speaker_type)).toEqual(['character'])
      expect((await readSession(tx, session_id)).current_child_turn_count).toBe(0)
      // LLM 도 안 불렀다.
      expect(기록.호출).toHaveLength(0)
    })
  })

  it('7. 미완 턴 상태에서 새 발화 → 409 TURN_INCOMPLETE + pending; resume 후 다시 정상', async () => {
    const 기록 = 가짜_제미나이({
      대사_실패: true,
      // 계속 목표 미달로 두어 CLOSING 없이 발화받기 갈래만 밟는다.
      요소들: (_턴, 목표) => [목표[0]],
    })

    await 트랜잭션(async (tx) => {
      const { 씨, session_id } = await 회차_준비(tx, '여정')

      // 대사 단계에서 죽는다 — 저장 상태는 미완 턴이다.
      const 실패 = await 턴(session_id, '며느리가 불쌍해')
      expect(실패.status).toBe(502)
      expect(실패.본문.error?.code).toBe('LLM_UNAVAILABLE')
      expect(실패.본문.error?.retryable).toBe(true)

      // 미완 턴이 있는 채로 새 발화 → 409 + pending (이슈 #2 문지기 재사용).
      const 막힘 = await 턴(session_id, '다른 말')
      expect(막힘.status).toBe(409)
      expect(막힘.본문.error?.code).toBe('TURN_INCOMPLETE')
      expect(막힘.본문.error?.pending?.stage).toBe('character')

      // resume 으로 죽은 단계부터 이어 돌리면 —
      기록.설정.대사_실패 = false
      expect((await 이어하기(session_id)).status).toBe(200)

      // — 새 발화가 다시 받아진다.
      const 다시 = await 턴(session_id, '이제 괜찮아')
      expect(다시.status).toBe(200)
      expect(다시.본문.data?.next?.kind).toBe('발화받기')
      expect(다시.본문.data?.next?.scene_id).toBe(씨.scene_ids.sc_stn_02)
    })
  })

  it('없는 세션·uuid 아님 → 404 · 빈 body → 400', async () => {
    가짜_제미나이()

    await 트랜잭션(async () => {
      expect((await 턴(randomUUID(), '말')).status).toBe(404)
      expect((await 턴(randomUUID(), '말')).본문.error?.code).toBe('SESSION_NOT_FOUND')
      expect((await 턴('말도-안되는-id', '말')).status).toBe(404)

      const 빈몸 = await 턴_라우트(
        new Request('http://검사.local/api/sessions/x/turns', { method: 'POST' }),
        { params: Promise.resolve({ session_id: randomUUID() }) },
      )
      expect(빈몸.status).toBe(400)
    })
  })
})
