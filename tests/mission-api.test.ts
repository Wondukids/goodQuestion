// 미션 API — 이슈 #19 의 「끝났다」 조건 (`docs/미션_명세.md` 11절 1·3·4·5·7·8·9).
//
// **여기가 다 초록이면 이 이슈는 끝난 것이다.** 기준 문장을 그대로 검사 이름에 옮겼다.
//
// ## 어느 층을 두드리나
//
// 아이 앱 계약이 HTTP 코드·봉투로 적혀 있으므로 **라우트 핸들러**를 직접 부른다
// (`tests/session-turn.test.ts` 와 같은 방식 — `getDb()` 자리에 검사 트랜잭션을 꽂아 되돌린다).
// 세션 열기만 서비스로 부른다 — 그 라우트는 쿠키(아이 고르기)를 먼저 보는데, 재는 것은
// 「미션 칸이 실리나」라 쿠키 흉내가 군더더기가 된다.
//
// ## 미션 정의는 **검사가 직접 심는다**
//
// 진짜 시드(`ms_banggui_pear`)를 쓰지 않는다. 그쪽 문구는 사전 녹음과 맞물려 자주 바뀌고
// (api_team `4b0d1dc`), 그때마다 이 검사가 함께 빨개지면 「미션 API 가 깨졌다」로 읽힌다.
// 여기서 재는 것은 **계약의 동작**이지 대사 문구가 아니다.

import { randomUUID } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  characters,
  mission_messages,
  mission_sessions,
  messages,
  stories,
  story_missions,
  story_scenes,
  turn_conditions,
} from '@/llm/db/schema'

// ⚠️ 팩토리 안에서 바깥 변수를 참조하면 hoisting 에 걸린다 (`session-turn.test.ts` 와 같은 상자).
const 상자 = vi.hoisted(() => ({ tx: null as unknown }))

vi.mock('@/llm/repo/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/llm/repo/db')>()
  return { ...real, getDb: () => 상자.tx ?? real.getDb() }
})

// 받아쓰기를 바이트 → UTF-8 로 흉내 낸다 (`session-turn.test.ts` 와 같은 가짜).
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

import { POST as 미션_완료_라우트 } from '@/app/api/sessions/[session_id]/missions/[mission_session_id]/complete/route'
import { POST as 미션_이벤트_라우트 } from '@/app/api/sessions/[session_id]/missions/[mission_session_id]/events/route'
import { POST as 미션_턴_라우트 } from '@/app/api/sessions/[session_id]/missions/[mission_session_id]/turns/route'
import { POST as 턴_라우트 } from '@/app/api/sessions/[session_id]/turns/route'
import { POST as 이어하기_라우트 } from '@/app/api/sessions/[session_id]/turns/resume/route'
import { closeDb, getDb, type Conn } from '@/llm/repo/db'
import { readSession, sceneMessages } from '@/llm/repo/sessions'
import { advanceRun, startRun } from '@/llm/service/run'
import { openSession } from '@/session/service/open'

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
    `\n[mission-api.test] Postgres 에 못 붙어 미션 API 검사를 건너뛴다 (도커가 꺼져 있나?)\n` +
      `                   ${못붙는_이유}\n\n`,
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

// ── 가짜 제미나이 — 프롬프트 넷을 system 본문으로 가른다 ───────────────────

/** 이번 분석이 낼 답 한 벌. 대본이 떨어지면 기본값(목표 요소 전부 · VALID)으로 돈다. */
interface 분석_대본 {
  elements?: string[]
  validity?: string
}

interface 가짜_기록 {
  /** 부른 순서대로 — 용도만 남긴다. 「미션 턴이 LLM 을 두 번 탔나」를 이걸로 잰다. */
  호출: ('분석' | '대사' | '미션대사' | '미션요약')[]
  /** 미션 대사 프롬프트가 받은 `direction.kind` — 다리 대사와 요약 대사를 가른다. */
  방향: string[]
  대본: 분석_대본[]
  실패: { 분석?: boolean; 대사?: boolean; 미션대사?: boolean; 미션요약?: boolean }
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

/**
 * SDK 자리에 가짜를 꽂는다.
 *
 * 용도 넷을 가르는 기준은 **system 본문**이다 — 분석만 `response_format` 이 있고, 미션 두
 * 프롬프트에는 `mission` 이라는 낱말이 있는데 캐릭터 프롬프트에는 **한 번도 안 나온다**
 * (`prompts/character/보낼것.md`). 그 사실이 이 가름을 떠받친다.
 */
function 가짜_제미나이(대본: 분석_대본[] = []): 가짜_기록 {
  const 기록: 가짜_기록 = { 호출: [], 방향: [], 대본, 실패: {} }

  installFakeSdk('gemini', () => ({
    interactions: {
      create: async (요청: Record<string, unknown>) => {
        const user = String(요청.input ?? '')
        const system = String(요청.system_instruction ?? '')

        if (요청.response_format !== undefined) {
          기록.호출.push('분석')
          if (기록.실패.분석) throw new Error('APIError: 분석 500')
          const 발화 = 뽑기(user, 'child_utterance')
          const 몇번째 = 기록.호출.filter((하나) => 하나 === '분석').length
          const 한벌 = 기록.대본[몇번째 - 1] ?? {}
          return {
            output_text: JSON.stringify({
              child_intent: 'OPINION',
              main_point: 발화,
              detected_elements: (한벌.elements ?? 목표_뽑기(user)).map((type) => ({
                type,
                evidence: 발화,
              })),
              utterance_validity: 한벌.validity ?? 'VALID',
            }),
            usage_metadata: { prompt_token_count: 100, candidates_token_count: 20 },
          }
        }

        // ⚠️ 「closing summary line」으로 찾지 마라 — 프롬프트 원문에서 그 사이에 줄바꿈이 있다.
        if (/has just ended/.test(system)) {
          기록.호출.push('미션요약')
          if (기록.실패.미션요약) throw new Error('APIError: 미션 요약 500')
          return {
            output_text: '네 덕분에 정했어!',
            usage_metadata: { prompt_token_count: 200, candidates_token_count: 30 },
          }
        }
        if (/inside a mission/.test(system)) {
          기록.호출.push('미션대사')
          기록.방향.push(뽑기(user, 'kind'))
          if (기록.실패.미션대사) throw new Error('APIError: 미션 대사 500')
          return {
            output_text: `미션 대사 (${기록.호출.length})`,
            usage_metadata: { prompt_token_count: 200, candidates_token_count: 30 },
          }
        }

        기록.호출.push('대사')
        if (기록.실패.대사) throw new Error('APIError: 대사 500')
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

// ── 검사용 콘텐츠 — 대화 둘, 앞엣것에만 미션이 달렸다 ──────────────────────

const 닫는_말 = '온 마을이 배 잔치를 하겠구려!'
const 되묻기 = '조금만 더 자세히 말해 줄 수 있겠는가?'
const 미션_마무리 = '그래! 그렇게 말하면 되겠구려!'

const 미션_config = {
  trigger: { any_elements: ['SOLUTION'], min_turns: 2 },
  items: [
    { id: 'sokuri', name: '소쿠리', desc: '물건을 담는 대나무 바구니예요.' },
    { id: 'bojagi', name: '보자기', desc: '물건을 감쌀 수 있어요.' },
  ],
  steps: [
    { key: 'use', expect: 'speech', ask: '{item} 말인가? {item}(으)로 어떻게 하겠는가?' },
    { key: 'request', expect: 'speech', ask: '뭐라고 부탁을 해야 할까?' },
  ],
  reask: 되묻기,
  closing: 미션_마무리,
}

/** 미션2 결 — 카드를 고르고 말하고 「더 도울래?」로 순환한다 (명세 8절 미션2). */
const 카드_config = {
  trigger: { any_elements: ['SOLUTION'], min_turns: 2 },
  intro: '내 친구들 고민도 들어 줄래?',
  cards: [
    { id: 'scared', name: '겁이 많은 친구', trouble: '겁쟁이라는 말을 들어요.', reask: '정말 괜찮을까?' },
    { id: 'loud', name: '목소리가 큰 친구', trouble: '시끄럽다는 말을 들어요.', reask: '정말 시끄러워도 될까?' },
  ],
  ask: '이 친구한테는 뭐라고 말해 주면 좋을까?',
  more: '다른 친구도 도와줄래?',
  more_pick: '또 도와주고 싶은 친구는 누구야?',
  closing: '도와줘서 고마워!',
}

interface 씨앗 {
  story_code: string
  scene_ids: Record<string, string>
  mission_id: string
}

/**
 * 전개 1 · **대화 2(미션 있음)** · **대화 3(미션 없음)**.
 *
 * 대화2 의 필수 요소는 둘(SOLUTION·REQUEST)이고 `preferred_turns` 는 3 이다 — 트리거 턴
 * 하나로는 `decide()` 가 CLOSING 을 못 내게 해서, **씬을 닫는 것이 미션 완료뿐**임을 잰다.
 */
async function 콘텐츠_넣기(
  tx: Conn,
  미션종류: 'prop_choice' | 'card_help' | null = 'prop_choice',
): Promise<씨앗> {
  const 꼬리 = randomUUID().slice(0, 8)
  const story_code = `s_msn_${꼬리}`

  const [이야기] = await tx
    .insert(stories)
    .values({
      slug: story_code,
      title: `미션 API 검사용 ${꼬리}`,
      summary: '검사용',
      difficulty: '보통',
      // 세션 열기(4.1)가 `published` 만 연다 — 기준 7 이 그 문을 탄다.
      status: 'published',
    })
    .returning({ id: stories.id })

  const [캐릭터] = await tx
    .insert(characters)
    .values({
      story_id: 이야기.id,
      code: 'ch_msn_chief',
      name: '마을 이장',
      persona: '마을을 걱정하는 이장',
      speech_style: '옛이야기 말투',
      guidance_style: '자기 걱정을 소리 내어 말한다',
      forbidden: ['설명하지 않는다'],
    })
    .returning({ id: characters.id })

  const 대화칸 = (closing: string) => ({
    character_id: 캐릭터.id,
    character_name: '마을 이장',
    character_opening: '배가 너무 높이 달려 있구먼.',
    character_closing: closing,
    scene_stance: '아직 방법을 모른다',
    scene_goal: '아이가 배를 딸 방법을 말하게 한다',
    required_elements: ['SOLUTION', 'REQUEST'],
    element_criteria: { SOLUTION: '어떻게 하면 좋을까?' },
    remaining_worries: { REQUEST: '뭐라고 부탁하면 좋을까…' },
    preferred_turns: 3,
    max_turns: 5,
  })

  const 넣은_장면들 = await tx
    .insert(story_scenes)
    .values([
      { story_id: 이야기.id, code: 'sc_msn_01', scene_order: 1, scene_description: '전개 1' },
      { story_id: 이야기.id, code: 'sc_msn_02', scene_order: 2, conflict: '배 따기', ...대화칸(닫는_말) },
      { story_id: 이야기.id, code: 'sc_msn_03', scene_order: 3, conflict: '그다음', ...대화칸('다들 고맙소.') },
    ])
    .returning({ id: story_scenes.id, code: story_scenes.code })

  const scene_ids: Record<string, string> = {}
  for (const 행 of 넣은_장면들) scene_ids[행.code] = 행.id

  let mission_id = ''
  if (미션종류 !== null) {
    const [미션] = await tx
      .insert(story_missions)
      .values({
        story_id: 이야기.id,
        scene_id: scene_ids.sc_msn_02,
        code: `ms_msn_${꼬리}`,
        title: '검사용 미션',
        mission_type: 미션종류,
        mission_goal: '배를 안전하게 딸 방법을 정한다.',
        config: 미션종류 === 'prop_choice' ? 미션_config : 카드_config,
      })
      .returning({ id: story_missions.id })
    mission_id = 미션.id
  }

  return { story_code, scene_ids, mission_id }
}

/** 회차를 열고 첫 대화 장면 앞까지 전개를 재생해 둔다. */
async function 회차_준비(tx: Conn, 미션종류: 'prop_choice' | 'card_help' | null = 'prop_choice') {
  const 씨 = await 콘텐츠_넣기(tx, 미션종류)
  const { run } = await startRun(tx, { story_code: 씨.story_code, started_by: '검사' })
  expect((await advanceRun(tx, run.id)).kind).toBe('발화받기')
  return { 씨, run_id: run.id, session_id: run.session_id }
}

// ── 라우트를 아이 앱처럼 부른다 ────────────────────────────────────────────

interface 봉투 {
  ok: boolean
  data?: Record<string, unknown>
  error?: { code: string; message: string; retryable: boolean; pending?: { stage: string } }
}

type 응답 = { status: number; 본문: 봉투 }

async function 턴(session_id: string, 말: string): Promise<응답> {
  const res = await 턴_라우트(
    new Request(`http://검사.local/api/sessions/${session_id}/turns`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-audio-channels': '1' },
      body: Buffer.from(말, 'utf-8'),
    }),
    { params: Promise.resolve({ session_id }) },
  )
  return { status: res.status, 본문: (await res.json()) as 봉투 }
}

async function 이어하기(session_id: string): Promise<응답> {
  const res = await 이어하기_라우트(
    new Request(`http://검사.local/api/sessions/${session_id}/turns/resume`, { method: 'POST' }),
    { params: Promise.resolve({ session_id }) },
  )
  return { status: res.status, 본문: (await res.json()) as 봉투 }
}

async function 이벤트(
  session_id: string,
  mission_session_id: string,
  본문: { type: string; value?: string },
): Promise<응답> {
  const res = await 미션_이벤트_라우트(
    new Request(
      `http://검사.local/api/sessions/${session_id}/missions/${mission_session_id}/events`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(본문),
      },
    ),
    { params: Promise.resolve({ session_id, mission_session_id }) },
  )
  return { status: res.status, 본문: (await res.json()) as 봉투 }
}

async function 미션턴(session_id: string, mission_session_id: string, 말: string): Promise<응답> {
  const res = await 미션_턴_라우트(
    new Request(
      `http://검사.local/api/sessions/${session_id}/missions/${mission_session_id}/turns`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'x-audio-channels': '1' },
        body: Buffer.from(말, 'utf-8'),
      },
    ),
    { params: Promise.resolve({ session_id, mission_session_id }) },
  )
  return { status: res.status, 본문: (await res.json()) as 봉투 }
}

async function 미션완료(session_id: string, mission_session_id: string): Promise<응답> {
  const res = await 미션_완료_라우트(
    new Request(
      `http://검사.local/api/sessions/${session_id}/missions/${mission_session_id}/complete`,
      { method: 'POST' },
    ),
    { params: Promise.resolve({ session_id, mission_session_id }) },
  )
  return { status: res.status, 본문: (await res.json()) as 봉투 }
}

// ── 응답에서 꺼내 쓰는 것들 ────────────────────────────────────────────────

interface 다음칸 {
  kind: string
  scene_id?: string
  next_scene?: { scene_id: string; code: string }
  mission?: { mission_session_id: string; code: string; mission_type: string; config: Record<string, unknown> }
  step?: string | null
  fixed_line?: { text: string } | null
}

const 다음 = (본문: 봉투): 다음칸 => 본문.data?.next as 다음칸
const 미션시작 = (본문: 봉투) => 다음(본문).mission!

/** 트리거를 발동시켜 팝업을 여는 데까지 — 여러 검사가 여기서 시작한다. */
async function 미션까지(
  tx: Conn,
  대본: 분석_대본[] = [{ elements: ['SOLUTION'] }],
  미션종류: 'prop_choice' | 'card_help' = 'prop_choice',
) {
  const 기록 = 가짜_제미나이(대본)
  const { 씨, run_id, session_id } = await 회차_준비(tx, 미션종류)
  const 트리거 = await 턴(session_id, '방귀로 배를 떨어뜨리면 돼요')
  expect(트리거.status).toBe(200)
  expect(다음(트리거.본문).kind).toBe('미션시작')
  return { 기록, 씨, run_id, session_id, msid: 미션시작(트리거.본문).mission_session_id, 트리거 }
}

// ═══════════════════════════════════════════════════════════════════════════
// 기준 1 — 트리거 턴 (명세 11절 1)
// ═══════════════════════════════════════════════════════════════════════════

검사('기준 1 — 트리거 턴에 미션시작·다리 대사가 실리고 mission_sessions 행이 생긴다', () => {
  it('SOLUTION 이 잡힌 턴 → next: 미션시작 + 다리 대사(generated) + in_progress 행 1개', async () => {
    await 트랜잭션(async (tx) => {
      const { 기록, 씨, session_id, 트리거 } = await 미션까지(tx)

      const next = 다음(트리거.본문)
      expect(next.scene_id).toBe(씨.scene_ids.sc_msn_02)
      expect(next.mission).toMatchObject({ mission_type: 'prop_choice' })
      expect(next.mission?.config).toMatchObject({ closing: 미션_마무리 })

      // 대사는 **다리 대사**다 — 캐릭터 프롬프트가 아니라 미션 프롬프트가 만들었다.
      expect(기록.호출).toEqual(['분석', '미션대사'])
      expect(기록.방향).toEqual(['bridge_into_mission'])
      const dialogue = 트리거.본문.data?.dialogue as { text: string; source: string }
      expect(dialogue.source).toBe('generated')

      // 다리 대사도 본 대화의 캐릭터 행이다 — 여는 말 + 아이 + 다리 대사.
      const 대화 = await sceneMessages(tx, { session_id, scene_id: 씨.scene_ids.sc_msn_02 })
      expect(대화.map((행) => 행.speaker_type)).toEqual(['character', 'child', 'character'])
      expect(대화[2].text).toBe(dialogue.text)

      const 시도들 = await tx
        .select({ status: mission_sessions.status, mission_id: mission_sessions.mission_id })
        .from(mission_sessions)
        .where(eq(mission_sessions.session_id, session_id))
      expect(시도들).toEqual([{ status: 'in_progress', mission_id: 씨.mission_id }])

      // 씬은 안 닫혔다 — 닫는 자리는 미션 완료뿐이다.
      expect((await readSession(tx, session_id)).scene_end_reason).toBeNull()
    })
  })

  it('SOLUTION 이 없어도 아이 턴 2회면 발동한다 (MIN_TURNS 폴백)', async () => {
    const 기록 = 가짜_제미나이([{ elements: [] }, { elements: [] }])

    await 트랜잭션(async (tx) => {
      const { session_id } = await 회차_준비(tx)

      const 첫턴 = await 턴(session_id, '음 잘 모르겠어요')
      expect(다음(첫턴.본문).kind).toBe('발화받기')
      expect(기록.호출).toEqual(['분석', '대사'])

      const 둘째턴 = await 턴(session_id, '그래도 뭔가 있을 것 같아요')
      expect(다음(둘째턴.본문).kind).toBe('미션시작')
      expect(기록.방향).toEqual(['bridge_into_mission'])
    })
  })

  it('다리 대사에서 죽으면 502 → resume 이 미션시작을 다시 싣고, 시도 행은 하나 그대로다', async () => {
    const 기록 = 가짜_제미나이([{ elements: ['SOLUTION'] }])
    기록.실패.미션대사 = true

    await 트랜잭션(async (tx) => {
      const { session_id } = await 회차_준비(tx)

      const 실패 = await 턴(session_id, '방귀로 떨어뜨려요')
      expect(실패.status).toBe(502)
      expect(실패.본문.error?.code).toBe('LLM_UNAVAILABLE')

      // 미션 세션 행은 **판정 커밋에서 이미** 생겼다 (명세 7절 A).
      const 시도_전 = await tx
        .select({ id: mission_sessions.id })
        .from(mission_sessions)
        .where(eq(mission_sessions.session_id, session_id))
      expect(시도_전).toHaveLength(1)

      기록.실패.미션대사 = false
      const 다시 = await 이어하기(session_id)
      expect(다시.status).toBe(200)
      expect(다음(다시.본문).kind).toBe('미션시작')
      expect(미션시작(다시.본문).mission_session_id).toBe(시도_전[0].id)
      // 두 번째 행을 만들지 않았다 — `ux_mission_sessions_active` 가 아니라 규칙이 막았다.
      expect(
        await tx
          .select({ id: mission_sessions.id })
          .from(mission_sessions)
          .where(eq(mission_sessions.session_id, session_id)),
      ).toHaveLength(1)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 기준 3·4 — 미션 턴 · 되묻기 (명세 11절 3·4)
// ═══════════════════════════════════════════════════════════════════════════

검사('기준 3 — 미션 턴은 요소만 합산하고 씬 턴 수는 안 건드린다', () => {
  it('선택 이벤트 → 고정 물음 · 미션 턴 → 아이·캐릭터 행 + 분석 jsonb + 누적 합산', async () => {
    await 트랜잭션(async (tx) => {
      const { 기록, session_id, msid } = await 미션까지(tx, [
        { elements: ['SOLUTION'] },
        { elements: ['REQUEST'] },
      ])

      // B — 소품을 골랐다. `{item}` 이 고른 이름으로 바뀐다.
      const 고르기 = await 이벤트(session_id, msid, { type: 'prop_select', value: 'bojagi' })
      expect(고르기.status).toBe(200)
      expect(고르기.본문.data).toEqual({
        line: { text: '보자기 말인가? 보자기(으)로 어떻게 하겠는가?', source: 'fixed' },
        step: 'use',
        mic: true,
        done: false,
      })

      const 턴_전 = await readSession(tx, session_id)

      // C — 미션 턴 하나.
      const 미션 = await 미션턴(session_id, msid, '보자기로 배를 받을래요')
      expect(미션.status).toBe(200)
      expect(미션.본문.data?.child).toEqual({ text: '보자기로 배를 받을래요' })
      expect(미션.본문.data?.dialogue).toMatchObject({ source: 'generated' })
      expect(미션.본문.data?.elements).toEqual({ gained: ['REQUEST'], missing: [] })
      expect(다음(미션.본문)).toEqual({
        kind: '미션계속',
        step: 'request',
        fixed_line: { text: '뭐라고 부탁을 해야 할까?' },
      })
      // 분석 → 미션 대사, LLM 직렬 2회다 (명세 4절).
      expect(기록.호출.slice(-2)).toEqual(['분석', '미션대사'])
      expect(기록.방향.at(-1)).toBe('summary_reply')

      // 미션 대화만 쌓인다 — 고정 물음 · 아이 · 요약 대사 · 다음 물음.
      const 줄들 = await tx
        .select({
          speaker: mission_messages.speaker_type,
          step: mission_messages.step,
          source: mission_messages.line_source,
          analysis: mission_messages.analysis,
        })
        .from(mission_messages)
        .where(eq(mission_messages.mission_session_id, msid))
        .orderBy(mission_messages.turn_order)
      expect(줄들.map((행) => [행.speaker,행.step, 행.source])).toEqual([
        ['character', 'use', 'fixed'],
        ['child', 'use', null],
        ['character', 'use', 'generated'],
        ['character', 'request', 'fixed'],
      ])
      expect(줄들[1].analysis?.detected_elements).toEqual([
        { type: 'REQUEST', evidence: '보자기로 배를 받을래요' },
      ])

      // 🔴 씬 상태는 누적 요소 한 칸만 움직였다 (M3).
      const 턴_후 = await readSession(tx, session_id)
      expect(턴_후.accumulated_elements.sort()).toEqual(['REQUEST', 'SOLUTION'])
      expect(턴_후.current_child_turn_count).toBe(턴_전.current_child_turn_count)
      expect(턴_후.turns_without_new_element).toBe(턴_전.turns_without_new_element)

      // 본 대화(`messages`)에는 미션 발화가 한 줄도 안 섞였다 (M5).
      const 대화 = await sceneMessages(tx, { session_id, scene_id: 턴_후.current_scene_id! })
      expect(대화).toHaveLength(3)
    })
  })

  it('마지막 스텝을 마치면 미션끝 — 마무리 문구는 config.closing 이라 실어 보내지 않는다', async () => {
    await 트랜잭션(async (tx) => {
      const { session_id, msid } = await 미션까지(tx, [
        { elements: ['SOLUTION'] },
        { elements: [] },
        { elements: ['REQUEST'] },
      ])
      await 이벤트(session_id, msid, { type: 'prop_select', value: 'sokuri' })
      await 미션턴(session_id, msid, '소쿠리로 배를 받을래요')

      const 끝 = await 미션턴(session_id, msid, '조심히 따 달라고 부탁할래요')
      expect(다음(끝.본문)).toEqual({ kind: '미션끝', step: null, fixed_line: null })
    })
  })

  it('무음(빈 발화)은 상태 불변 — { empty: true } 뿐이고 LLM 도 안 부른다', async () => {
    await 트랜잭션(async (tx) => {
      const { 기록, session_id, msid } = await 미션까지(tx)
      await 이벤트(session_id, msid, { type: 'prop_select', value: 'sokuri' })
      const 부른_횟수 = 기록.호출.length

      const 무음 = await 미션턴(session_id, msid, '   ')
      expect(무음.status).toBe(200)
      expect(무음.본문.data).toEqual({ empty: true })
      expect(기록.호출).toHaveLength(부른_횟수)
    })
  })
})

검사('card_help — 카드 선택이 스텝을 정하고 「더 도울래?」로 순환한다 (명세 8절 미션2)', () => {
  it('친구 선택 → 공용 질문 · 미션 턴 → 감탄 대사 + config.more · more=yes → more_pick', async () => {
    await 트랜잭션(async (tx) => {
      const { session_id, msid } = await 미션까지(
        tx,
        [{ elements: ['SOLUTION'] }, { elements: ['REQUEST'] }],
        'card_help',
      )

      const 고르기 = await 이벤트(session_id, msid, { type: 'friend_select', value: 'scared' })
      expect(고르기.본문.data).toEqual({
        line: { text: 카드_config.ask, source: 'fixed' },
        step: 'scared',
        mic: true,
        done: false,
      })

      const 미션 = await 미션턴(session_id, msid, '겁이 많은 건 조심성이 많은 거야')
      expect(미션.본문.data?.dialogue).toMatchObject({ source: 'generated' })
      // 스텝은 없다 — 다음에 올 것은 말이 아니라 「더 도울래?」의 답이다.
      expect(다음(미션.본문)).toEqual({
        kind: '미션계속',
        step: null,
        fixed_line: { text: 카드_config.more },
      })

      const 더 = await 이벤트(session_id, msid, { type: 'more', value: 'yes' })
      expect(더.본문.data).toEqual({
        line: { text: 카드_config.more_pick, source: 'fixed' },
        step: null,
        mic: false,
        done: false,
      })
    })
  })

  it('되묻기 문구는 **친구별**이다 (M9) · 카드를 다 도우면 미션끝', async () => {
    await 트랜잭션(async (tx) => {
      const { session_id, msid } = await 미션까지(
        tx,
        [
          { elements: ['SOLUTION'] },
          { elements: [], validity: 'UNCLEAR' },
          { elements: ['REQUEST'] },
          { elements: [] },
        ],
        'card_help',
      )

      await 이벤트(session_id, msid, { type: 'friend_select', value: 'loud' })
      const 되물음 = await 미션턴(session_id, msid, '음')
      expect(되물음.본문.data?.dialogue).toBeNull()
      expect(다음(되물음.본문)).toEqual({
        kind: '미션계속',
        step: 'loud',
        fixed_line: { text: '정말 시끄러워도 될까?' },
      })

      await 미션턴(session_id, msid, '목소리가 큰 건 씩씩한 거야')
      await 이벤트(session_id, msid, { type: 'more', value: 'yes' })
      await 이벤트(session_id, msid, { type: 'friend_select', value: 'scared' })

      // 둘째 카드까지 도왔다 — 카드가 둘뿐이라 여기서 끝난다.
      const 끝 = await 미션턴(session_id, msid, '겁이 많은 건 조심성이 많은 거야')
      expect(다음(끝.본문)).toEqual({ kind: '미션끝', step: null, fixed_line: null })
    })
  })

  it('more=no 면 done — 무음 건너뜀은 system 행으로 남고 「더 도울래?」로 이어진다', async () => {
    await 트랜잭션(async (tx) => {
      const { session_id, msid } = await 미션까지(
        tx,
        [{ elements: ['SOLUTION'] }],
        'card_help',
      )
      await 이벤트(session_id, msid, { type: 'friend_select', value: 'scared' })

      const 건너뜀 = await 이벤트(session_id, msid, { type: 'skip' })
      expect(건너뜀.본문.data).toEqual({
        line: { text: 카드_config.more, source: 'fixed' },
        step: null,
        mic: false,
        done: false,
      })
      const 줄들 = await tx
        .select({ speaker: mission_messages.speaker_type, step: mission_messages.step })
        .from(mission_messages)
        .where(eq(mission_messages.mission_session_id, msid))
        .orderBy(mission_messages.turn_order)
      expect(줄들.map((행) => [행.speaker, 행.step])).toEqual([
        ['character', 'scared'],
        ['system', 'scared'],
        ['character', null],
      ])

      const 그만 = await 이벤트(session_id, msid, { type: 'more', value: 'no' })
      expect(그만.본문.data).toEqual({ line: null, step: null, mic: false, done: true })
    })
  })

  it('미션 유형에 없는 이벤트는 400 — prop_select 는 card_help 의 것이 아니다', async () => {
    await 트랜잭션(async (tx) => {
      const { session_id, msid } = await 미션까지(tx, [{ elements: ['SOLUTION'] }], 'card_help')
      const 틀림 = await 이벤트(session_id, msid, { type: 'prop_select', value: 'sokuri' })
      expect(틀림.status).toBe(400)
      expect(틀림.본문.error?.code).toBe('BAD_REQUEST')
    })
  })
})

검사('기준 4 — SHORT/UNCLEAR 첫 시도는 되묻고, 두 번째는 그대로 진행한다', () => {
  it('되묻기 턴은 dialogue 가 null 이고 같은 스텝 · 두 번째 짧은 말은 대사가 나온다', async () => {
    await 트랜잭션(async (tx) => {
      const { 기록, session_id, msid } = await 미션까지(tx, [
        { elements: ['SOLUTION'] },
        { elements: [], validity: 'SHORT' },
        { elements: [], validity: 'SHORT' },
      ])
      await 이벤트(session_id, msid, { type: 'prop_select', value: 'sokuri' })

      const 첫_짧은말 = await 미션턴(session_id, msid, '몰라요')
      expect(첫_짧은말.본문.data?.dialogue).toBeNull()
      expect(다음(첫_짧은말.본문)).toEqual({
        kind: '미션계속',
        step: 'use',
        fixed_line: { text: 되묻기 },
      })
      // 되묻기면 대사 LLM 을 **아예 안 부른다** (M9) — 분석만 늘었다.
      expect(기록.호출.slice(-1)).toEqual(['분석'])

      const 둘째_짧은말 = await 미션턴(session_id, msid, '그냥요')
      expect(둘째_짧은말.본문.data?.dialogue).toMatchObject({ source: 'generated' })
      expect(다음(둘째_짧은말.본문).step).toBe('request')
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 기준 5 — complete (명세 11절 5)
// ═══════════════════════════════════════════════════════════════════════════

검사('기준 5 — complete 는 요약 행 하나를 남기고, 요소가 차 있으면 같은 요청에서 씬을 닫는다', () => {
  it('요약 캐릭터 행 1개 · GOAL_MET · 닫는 말 · 다음 씬 여는 말까지 저장된다', async () => {
    await 트랜잭션(async (tx) => {
      const { session_id, 씨, msid } = await 미션까지(tx, [
        { elements: ['SOLUTION'] },
        { elements: ['REQUEST'] },
      ])
      await 이벤트(session_id, msid, { type: 'prop_select', value: 'sokuri' })
      await 미션턴(session_id, msid, '소쿠리로 배를 받을래요')

      const 조건_전 = await tx.select({ id: turn_conditions.message_id }).from(turn_conditions)

      const 완료 = await 미션완료(session_id, msid)
      expect(완료.status).toBe(200)
      expect(완료.본문.data?.summary).toMatchObject({ text: '네 덕분에 정했어!' })
      expect(완료.본문.data?.closing_line).toEqual({ text: 닫는_말 })
      expect(완료.본문.data?.elements).toEqual({
        accumulated: ['SOLUTION', 'REQUEST'],
        missing: [],
      })
      expect(다음(완료.본문)).toEqual({
        kind: '장면끝',
        next_scene: { scene_id: 씨.scene_ids.sc_msn_03, code: 'sc_msn_03' },
      })

      // 본 대화로 넘어간 것은 요약 **한 행**뿐이고, 닫는 말이 그 뒤에 붙는다 (M5·M6).
      const 요약행 = await tx
        .select({ id: messages.id, text: messages.text })
        .from(messages)
        .where(eq(messages.utterance_source, 'mission_summary'))
      expect(요약행).toHaveLength(1)
      expect(요약행[0].id).toBe((완료.본문.data?.summary as { message_id: string }).message_id)

      const 미션씬 = await sceneMessages(tx, { session_id, scene_id: 씨.scene_ids.sc_msn_02 })
      expect(미션씬.map((행) => 행.text).slice(-2)).toEqual(['네 덕분에 정했어!', 닫는_말])

      // 다음 대화 씬의 여는 말이 **이미** 저장돼 있다.
      const 다음씬 = await sceneMessages(tx, { session_id, scene_id: 씨.scene_ids.sc_msn_03 })
      expect(다음씬.map((행) => 행.speaker_type)).toEqual(['character'])

      // ⛔ `decide()`·`turn_conditions` 경로는 타지 않았다 (명세 7절 D).
      expect(await tx.select({ id: turn_conditions.message_id }).from(turn_conditions)).toHaveLength(
        조건_전.length,
      )

      const 시도 = await tx
        .select({ status: mission_sessions.status, summary: mission_sessions.summary_text })
        .from(mission_sessions)
        .where(eq(mission_sessions.id, msid))
      expect(시도).toEqual([{ status: 'completed', summary: '네 덕분에 정했어!' }])
    })
  })

  it('요소가 남으면 씬을 닫지 않는다 — next: 발화받기 · 닫는 말 없음', async () => {
    await 트랜잭션(async (tx) => {
      const { session_id, 씨, msid } = await 미션까지(tx, [
        { elements: ['SOLUTION'] },
        { elements: [] },
      ])
      await 이벤트(session_id, msid, { type: 'prop_select', value: 'sokuri' })
      await 미션턴(session_id, msid, '소쿠리로 받을래요')

      const 완료 = await 미션완료(session_id, msid)
      expect(완료.본문.data?.closing_line).toBeNull()
      expect(완료.본문.data?.elements).toEqual({ accumulated: ['SOLUTION'], missing: ['REQUEST'] })
      expect(다음(완료.본문)).toEqual({ kind: '발화받기' })

      const 세션 = await readSession(tx, session_id)
      expect(세션.scene_end_reason).toBeNull()
      expect(세션.current_scene_id).toBe(씨.scene_ids.sc_msn_02)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 기준 7·8·9 — 재개 · 가드 · 미션 없는 씬
// ═══════════════════════════════════════════════════════════════════════════

검사('기준 7 — 껐다 켜면 새 시도가 실리고 이전 시도는 abandoned, 합산 요소는 남는다', () => {
  it('세션 열기 응답의 mission 은 새 시도이고, 완료된 미션은 다시 안 실린다', async () => {
    await 트랜잭션(async (tx) => {
      const { session_id, msid } = await 미션까지(tx, [
        { elements: ['SOLUTION'] },
        { elements: ['REQUEST'] },
      ])
      await 이벤트(session_id, msid, { type: 'prop_select', value: 'sokuri' })
      await 미션턴(session_id, msid, '소쿠리로 배를 받을래요')

      const 이야기 = (await tx
        .select({ slug: stories.slug })
        .from(stories)
        .innerJoin(story_scenes, eq(story_scenes.story_id, stories.id))
        .where(eq(story_scenes.id, (await readSession(tx, session_id)).current_scene_id!))
        .limit(1))[0]
      const child_id = (await readSession(tx, session_id)).child_id

      // 껐다 켰다 — 남은 시도를 접고 **새 시도**를 실어 준다 (M4).
      const 열림 = await openSession({ child_id, story: 이야기.slug, conn: tx })
      expect(열림.mission).not.toBeNull()
      expect(열림.mission?.mission_session_id).not.toBe(msid)

      const 시도들 = await tx
        .select({ id: mission_sessions.id, status: mission_sessions.status })
        .from(mission_sessions)
        .where(eq(mission_sessions.session_id, session_id))
      expect(시도들.find((행) => 행.id === msid)?.status).toBe('abandoned')
      expect(시도들.filter((행) => 행.status === 'in_progress')).toHaveLength(1)

      // 합산된 요소는 그대로다 — 처음부터 해도 손해가 없다.
      expect((await readSession(tx, session_id)).accumulated_elements.sort()).toEqual([
        'REQUEST',
        'SOLUTION',
      ])

      // 새 시도를 마치면 그 미션은 다시 안 실린다.
      const 새것 = 열림.mission!.mission_session_id
      await 이벤트(session_id, 새것, { type: 'prop_select', value: 'sokuri' })
      await 미션완료(session_id, 새것)
      expect((await openSession({ child_id, story: 이야기.slug, conn: tx })).mission).toBeNull()
    })
  })
})

검사('기준 8 — 미션 중 일반 턴은 409, complete 두 번은 같은 요약', () => {
  it('MISSION_IN_PROGRESS 로 막히고, 미션을 마치면 다시 받는다', async () => {
    await 트랜잭션(async (tx) => {
      const { session_id, msid } = await 미션까지(tx, [
        { elements: ['SOLUTION'] },
        { elements: ['REQUEST'] },
      ])

      const 막힘 = await 턴(session_id, '다른 얘기 할래요')
      expect(막힘.status).toBe(409)
      expect(막힘.본문.error?.code).toBe('MISSION_IN_PROGRESS')
      expect(막힘.본문.error?.retryable).toBe(false)

      await 이벤트(session_id, msid, { type: 'prop_select', value: 'sokuri' })
      await 미션턴(session_id, msid, '소쿠리로 배를 받을래요')
      await 미션완료(session_id, msid)

      // 미션이 씬을 닫고 다음 씬으로 갔다 — 거기서는 일반 턴이 다시 돈다 (기준 9 와 같은 길).
      const 다시 = await 턴(session_id, '이제 다음 얘기해요')
      expect(다시.status).toBe(200)
      expect(다음(다시.본문).kind).toBe('발화받기')
    })
  })

  it('complete 를 두 번 불러도 같은 요약이고 요약 행은 하나뿐이다 (반복 안전)', async () => {
    await 트랜잭션(async (tx) => {
      const { 기록, session_id, msid } = await 미션까지(tx, [
        { elements: ['SOLUTION'] },
        { elements: ['REQUEST'] },
      ])
      await 이벤트(session_id, msid, { type: 'prop_select', value: 'sokuri' })
      await 미션턴(session_id, msid, '소쿠리로 배를 받을래요')

      const 첫 = await 미션완료(session_id, msid)
      const 요약_호출 = 기록.호출.filter((하나) => 하나 === '미션요약').length
      const 둘째 = await 미션완료(session_id, msid)

      expect(둘째.status).toBe(200)
      expect(둘째.본문.data?.summary).toEqual(첫.본문.data?.summary)
      expect(둘째.본문.data?.closing_line).toEqual(첫.본문.data?.closing_line)
      expect(다음(둘째.본문)).toEqual(다음(첫.본문))
      // 두 번째는 LLM 을 다시 안 부른다 — 저장된 요약을 그대로 낸다.
      expect(기록.호출.filter((하나) => 하나 === '미션요약')).toHaveLength(요약_호출)
      expect(
        await tx
          .select({ id: messages.id })
          .from(messages)
          .where(eq(messages.utterance_source, 'mission_summary')),
      ).toHaveLength(1)
    })
  })

  it('끝난 시도에 미션 턴을 보내면 409 MISSION_NOT_ACTIVE, 남의 시도 id 는 404', async () => {
    await 트랜잭션(async (tx) => {
      const { session_id, msid } = await 미션까지(tx, [
        { elements: ['SOLUTION'] },
        { elements: ['REQUEST'] },
      ])
      await 이벤트(session_id, msid, { type: 'prop_select', value: 'sokuri' })
      await 미션턴(session_id, msid, '소쿠리로 배를 받을래요')
      await 미션완료(session_id, msid)

      const 끝난것 = await 미션턴(session_id, msid, '한 마디 더')
      expect(끝난것.status).toBe(409)
      expect(끝난것.본문.error?.code).toBe('MISSION_NOT_ACTIVE')

      const 없는것 = await 미션완료(session_id, randomUUID())
      expect(없는것.status).toBe(404)
    })
  })
})

검사('기준 9 — 미션 없는 씬의 동작은 바이트 하나 안 바뀐다', () => {
  it('story_missions 행이 없으면 트리거도 가드도 없다 — 기존 턴 응답 그대로', async () => {
    const 기록 = 가짜_제미나이([{ elements: ['SOLUTION'] }, { elements: ['SOLUTION', 'REQUEST'] }])

    await 트랜잭션(async (tx) => {
      const { 씨, session_id } = await 회차_준비(tx, null)

      const 첫턴 = await 턴(session_id, '방귀로 배를 떨어뜨리면 돼요')
      expect(다음(첫턴.본문)).toEqual({ kind: '발화받기', scene_id: 씨.scene_ids.sc_msn_02 })
      expect(기록.호출).toEqual(['분석', '대사'])
      expect(기록.방향).toEqual([])
      expect(
        await tx.select({ id: mission_sessions.id }).from(mission_sessions),
      ).toHaveLength(0)

      // 미션 없는 씬에서는 요소가 다 차면 예전처럼 대화 턴이 씬을 닫는다.
      await 턴(session_id, '두 번째 말')
      const 셋째 = await 턴(session_id, '조심히 따 달라고 부탁할래요')
      expect((셋째.본문.data?.dialogue as { source: string }).source).toBe('fixed')
      expect(다음(셋째.본문).kind).toBe('장면끝')
    })
  })
})
