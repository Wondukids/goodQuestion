// E2E — **아이 앱이 두드리는 API 만으로** 「방귀 뀌는 며느리」를 처음부터 끝까지 돌고
// 보호자 리포트가 실제로 나오는지 본다.
//
// ## 왜 이 파일이 따로 있나 — 옆의 검사들은 각자 자기 토막만 잰다
//
// | 이미 있는 검사 | 무엇을 재나 | 이 사슬의 어디까지 |
// |---|---|---|
// | `tests/full-run.test.ts` | 장면 1→9 완주 | **관리자 화면 경로**(`startRunStep`/`advanceStep`/`submitTurn`)다. 아이 앱 API 를 한 번도 안 두드리고, 회차끝에서 멈춘다 |
// | `tests/mission-api.test.ts` | 미션 API 셋 | 미션 하나를 손으로 세운 세션에 붙여 잰다 |
// | `tests/post-activity-api.test.ts` | 후활동 API 넷 | **`completed` 로 만들어 둔** 세션에 붙여 잰다 (대화를 안 돈다) |
// | `tests/report-api.test.ts` | 리포트 생성·열람 | 재료를 손으로 심는다 |
//
// 넷 다 초록인데도 **「이야기를 처음부터 끝까지 하면 리포트가 나오나」는 아무도 안 잰다.**
// 각 토막의 입구를 손으로 세워 주기 때문이다. 이 파일은 손으로 세우는 것을 **하나도 안 한다** —
// 세션 열기부터 리포트 읽기까지 전부 라우트 핸들러로 간다. 그래서 토막과 토막 **사이**가
// 어긋나면 (그리고 이 레포에서 버그가 실제로 사는 곳이 거기다) 여기서만 빨개진다.
//
// ```
// POST /api/sessions                                   ← 이야기 시작
//   └ POST /api/sessions/{sid}/turns            ×N     ← 대화 장면 넷
//       └ POST …/missions/{msid}/{events,turns,complete}   ← 미션 둘 (장면 7·9)
//   → 회차끝  =  story_sessions.status = 'completed'
// GET  /api/sessions/{sid}/post-activity                ← 후활동 열기
// POST …/post-activity/order                            ← 카드 순서
// POST …/post-activity/retelling                        ← 줄거리 말하기
// POST …/post-activity/complete { reason: 'finished' }  ← ⭐ 리포트를 띄우는 자리
// GET  /api/reports/{sid}                               ← 보호자가 읽는다
// ```
//
// ## 진짜로 두는 것과 가짜로 두는 것
//
// | | | 왜 |
// |---|---|---|
// | DB | **진짜** (트랜잭션 → 되돌림) | 이 검사의 알맹이가 「무엇이 어느 순서로 저장되나」다. 가짜 DB 면 잴 것이 안 남는다 |
// | 라우트·서비스·엔진 | **진짜** | 재려는 대상이다 |
// | STT | 가짜 — 바이트를 UTF-8 로 읽는다 | `mission-api.test.ts`·`post-activity-api.test.ts` 와 같은 가짜. 「말한다」가 곧 「글자를 본문에 싣는다」가 된다 |
// | LLM | 가짜 — **SDK 생성자 자리** | `full-run.test.ts` 와 같은 자리다. 게이트웨이를 mock 하지 않는 이유도 같다 — 어느 용도가 몇 번 나갔나를 SDK 에서 세야 진짜로 센 것이다 |
// | 아이 확인 · 보호자 확인 | 가짜 | 저쪽(팀 Supabase)의 `children` 은 로컬 DB 에 아예 없다 |
//
// 🔴 **후활동 판정 LLM 은 안 부른다.** 낱말 12개가 전부 글자로 찾히는 줄거리를 넣으면
//    판정 엔진이 ①규칙에서 끝낸다 (`post-activity-api.test.ts` 의 같은 수).
//
// ⚠️ `npx tsx src/llm/db/seed.ts` 를 한 번도 안 돌린 DB 라면 빨개진다. 그게 맞다 —
//    콘텐츠(장면 아홉·미션 둘·후활동 카드 넉 장)의 정본이 시드이고, 없으면 잴 대상이 없다.

import { randomUUID } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest'

import { messages, parent_reports, post_activity_results } from '@/llm/db/schema'

// ⚠️ 팩토리 안에서 바깥 변수를 참조하면 hoisting 에 걸린다 (`post-activity-api.test.ts` 의 상자).
const 상자 = vi.hoisted(() => ({
  tx: null as unknown,
  child_id: '00000000-0000-4000-8000-00000000e2e1',
  parent_id: '00000000-0000-4000-8000-00000000e2e2',
}))

vi.mock('@/llm/repo/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/llm/repo/db')>()
  return { ...real, getDb: () => 상자.tx ?? real.getDb() }
})

// 받아쓰기를 바이트 → UTF-8 로 흉내 낸다 (`mission-api.test.ts` 와 같은 가짜).
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

// 세션 열기의 입구 — 쿠키(`selected_child`)를 읽는 자리. 저쪽 DB 가 없으므로 통째로 가짜다.
vi.mock('@/lib/selected-child', () => ({
  getSelectedChild: async () => ({
    id: 상자.child_id,
    name: '테스트아이',
    birth_year: 2019,
    character_id: 'ch-e2e',
    created_at: '2026-01-01T00:00:00.000Z',
  }),
}))

// 리포트 문지기 — 「이 활동이 내 아이 것인가」. 실제 호출 사슬 그대로 흉내 낸다
// (`report-api.test.ts` 의 같은 가짜).
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 상자.parent_id } } }) },
    from: () => ({
      select: () => ({
        eq: (_열: string, 값: string) => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: 값 === 상자.child_id ? { id: 상자.child_id } : null,
            }),
          }),
        }),
      }),
    }),
  }),
}))

import { GET as 리포트_라우트 } from '@/app/api/reports/[session_id]/route'
import { POST as 세션열기_라우트 } from '@/app/api/sessions/route'
import { POST as 미션_이벤트_라우트 } from '@/app/api/sessions/[session_id]/missions/[mission_session_id]/events/route'
import { POST as 미션_완료_라우트 } from '@/app/api/sessions/[session_id]/missions/[mission_session_id]/complete/route'
import { POST as 미션_턴_라우트 } from '@/app/api/sessions/[session_id]/missions/[mission_session_id]/turns/route'
import { POST as 건너뛰기_라우트 } from '@/app/api/sessions/[session_id]/scenes/[scene_code]/skip/route'
import { GET as 후활동_열기_라우트 } from '@/app/api/sessions/[session_id]/post-activity/route'
import { POST as 후활동_순서_라우트 } from '@/app/api/sessions/[session_id]/post-activity/order/route'
import { POST as 후활동_줄거리_라우트 } from '@/app/api/sessions/[session_id]/post-activity/retelling/route'
import { POST as 후활동_종료_라우트 } from '@/app/api/sessions/[session_id]/post-activity/complete/route'
import { POST as 턴_라우트 } from '@/app/api/sessions/[session_id]/turns/route'
import { closeDb, getDb, type Conn } from '@/llm/repo/db'
import { __testing as 리포트_뒷작업 } from '@/report/service/generate'

import { installFakeSdk } from './support/sdk-gate'

/** `stories.slug` — 앱이 쓰는 이야기 키다. */
const 이야기 = 'fart-bride'

// ── DB 가 있나 (다른 DB 검사들과 같은 문지기) ──────────────────────────────

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
    `\n[e2e-report.test] Postgres 에 못 붙어 E2E 를 건너뛴다 (도커가 꺼져 있나?)\n` +
      `                  ${못붙는_이유}\n\n`,
  )
}
const 검사 = 못붙는_이유 === null ? describe : describe.skip

afterAll(async () => {
  상자.tx = null
  await closeDb()
})

// ── 트랜잭션을 열고 끝나면 되돌린다 ────────────────────────────────────────

class 되돌림 extends Error {}

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

// ── 가짜 제미나이 ─────────────────────────────────────────────────────────
//
// 이 사슬에는 **용도가 다섯**이나 지나간다 (분석 · 캐릭터 대사 · 미션 대사 · 리포트 두 편).
// `full-run.test.ts` 는 `response_format` 유무 하나로 둘을 갈랐지만 여기서는 그것으로
// 부족하다 — 리포트 두 편도 스키마를 실어 보내기 때문이다. 그래서 **스키마의 칸 이름**으로
// 가른다. 스키마는 각 엔진이 정본으로 쥐고 있는 값이라(`narrative.ts` 의 두 상수 등)
// 프롬프트 글자보다 흔들리지 않는다.

type 용도 = '분석' | '대사' | '리포트분석' | '리포트안내' | '단어판정'

interface 가짜_기록 {
  호출: 용도[]
  /** SDK 본문에 실제로 실린 모델 이름들 (회차에 박힌 값이 여기까지 오나). */
  모델: Set<string>
}

/** 재료 JSON 에서 `target_elements` 를 되읽는다 — 콘텐츠가 실려 나갔다는 증거이기도 하다. */
function 목표_뽑기(user: string): string[] {
  const 맞은것 = /"target_elements":\[([^\]]*)\]/.exec(user)
  if (맞은것 === null || 맞은것[1].trim() === '') return []
  return JSON.parse(`[${맞은것[1]}]`) as string[]
}

function 뽑기(user: string, 열쇠: string): string {
  const 맞은것 = new RegExp(`"${열쇠}":"((?:[^"\\\\]|\\\\.)*)"`).exec(user)
  return 맞은것 === null ? '' : (JSON.parse(`"${맞은것[1]}"`) as string)
}

function 무슨_용도인가(요청: Record<string, unknown>): 용도 {
  const 형식 = 요청.response_format as { schema?: { properties?: Record<string, unknown> } } | undefined
  const 칸 = 형식?.schema?.properties
  if (칸 === undefined) return '대사'
  if ('detected_elements' in 칸) return '분석'
  if ('story_questions' in 칸) return '리포트안내'
  if ('cards' in 칸) return '리포트분석'
  if ('words' in 칸) return '단어판정'
  throw new Error(`모르는 스키마다: ${Object.keys(칸).join(',')}`)
}

/**
 * 용도마다 규격에 맞는 답 하나. **거르기를 통과하도록** 짜 뒀다 —
 * 인용(`quote_message_id`)은 원문 대조에서 살아남아야 하는데, 가짜가 아무 id 나 지어내면
 * 전부 버려져 「버림」만 쌓인다. 그래서 인용이 필요 없는 쪽으로 답한다 (명세 5.2 는
 * 인용 없는 카드를 허용한다 — `quote_message_id: null` 이면 화면이 인용 없이 그린다).
 */
function 가짜_제미나이(): 가짜_기록 {
  const 기록: 가짜_기록 = { 호출: [], 모델: new Set() }

  installFakeSdk('gemini', () => ({
    interactions: {
      create: async (요청: Record<string, unknown>) => {
        const user = String(요청.input ?? '')
        const 용도 = 무슨_용도인가(요청)
        기록.호출.push(용도)
        기록.모델.add(String(요청.model ?? ''))

        const 사용량 = { prompt_token_count: 100, candidates_token_count: 20 }

        if (용도 === '분석') {
          const 발화 = 뽑기(user, 'child_utterance')
          return {
            output_text: JSON.stringify({
              child_intent: 'OPINION',
              main_point: 발화,
              // evidence 를 아이 발화 원문으로 둔다 — 후처리(`postProcess`)를 그대로 통과한다.
              detected_elements: 목표_뽑기(user).map((type) => ({ type, evidence: 발화 })),
              utterance_validity: 'VALID',
            }),
            usage_metadata: 사용량,
          }
        }

        if (용도 === '리포트분석') {
          return {
            output_text: JSON.stringify({
              overall: '아이가 며느리의 마음을 자기 말로 옮겨 말했어요.',
              cards: [
                {
                  axis: '어휘',
                  summary: '이야기에 나온 낱말을 자기 문장에 넣어 썼어요.',
                  quote_message_id: null,
                  did_well: '새 낱말을 겁내지 않았어요.',
                  to_improve: '들은 낱말을 한 번 더 써 보면 좋겠어요.',
                },
                {
                  axis: '표현',
                  summary: '까닭을 붙여 말했어요.',
                  quote_message_id: null,
                  did_well: '「왜냐하면」을 스스로 붙였어요.',
                  to_improve: '문장을 조금 더 길게 이어 보면 좋겠어요.',
                },
                {
                  axis: '논리',
                  summary: '앞뒤를 이어 말했어요.',
                  quote_message_id: null,
                  did_well: '이야기의 순서를 지켰어요.',
                  to_improve: '까닭을 두 개 들어 보면 좋겠어요.',
                },
              ],
              highlight: null,
              word_tip: '「당당하다」를 오늘 저녁에 한 번 써 보세요.',
              words: { extracted: [], repeated: [] },
            }),
            usage_metadata: 사용량,
          }
        }

        if (용도 === '리포트안내') {
          return {
            output_text: JSON.stringify({
              reason: '아이가 다름을 장점으로 보는 말을 여러 번 했어요.',
              // 인용을 무는 질문은 대조에서 살아남기 어려우므로 비운다 (위 머리말).
              story_questions: [],
              daily_questions: [
                { label: '저녁 밥상에서', question: '오늘 제일 당당했던 때가 언제야?', goal: '자기 긍정' },
                { label: '잠들기 전에', question: '친구가 걱정할 때 뭐라고 말해 줄래?', goal: '공감' },
                { label: '길을 걸으며', question: '남과 다른 점이 도움이 된 적 있어?', goal: '관점 바꾸기' },
              ],
            }),
            usage_metadata: 사용량,
          }
        }

        if (용도 === '단어판정') {
          // 🔴 여기 오면 안 된다 — 줄거리가 12개를 다 글자로 담고 있어 ①규칙에서 끝나야 한다.
          throw new Error('후활동 판정 LLM 이 불렸다 — 줄거리가 규칙을 다 통과하지 못했다')
        }

        // 캐릭터 대사 · 미션 대사 — JSON 이 아니라 문장 그대로다.
        return { output_text: `그러게 말이다 (${기록.호출.length}번째)`, usage_metadata: 사용량 }
      },
    },
  }))

  return 기록
}

// ── 라우트를 아이 앱처럼 두드리는 손잡이 ───────────────────────────────────
//
// 🔴 **응답 모양을 서비스 타입에서 안 빌려 온다** (`post-activity-api.test.ts` 와 같은 규칙).
//    여기서 재는 것은 선 위의 계약이라, 서비스 타입이 바뀌면 검사가 조용히 따라가면 안 된다.

const 주소 = 'http://검사.local'

interface 봉투<T> {
  ok: boolean
  data?: T
  error?: { code: string; message: string; retryable: boolean }
}

type 응답<T> = { status: number; 본문: 봉투<T> }

async function 읽기<T>(res: Response): Promise<응답<T>> {
  return { status: res.status, 본문: (await res.json()) as 봉투<T> }
}

/** 성공만 기대하는 자리 — 실패면 코드까지 실어 그 자리에서 터뜨린다. */
function 꺼내기<T>(무엇: string, 답: 응답<T>): T {
  if (!답.본문.ok || 답.본문.data === undefined) {
    throw new Error(`${무엇} 실패 (${답.status} ${답.본문.error?.code}): ${답.본문.error?.message}`)
  }
  return 답.본문.data
}

function 녹음(말: string): BodyInit {
  return Buffer.from(말, 'utf-8') as unknown as BodyInit
}

const 오디오_헤더 = { 'content-type': 'application/octet-stream', 'x-audio-channels': '1' }

interface 장면참조 {
  scene_id: string
  code: string
}
interface 미션참조 {
  mission_session_id: string
  code: string
  mission_type: 'prop_choice' | 'card_help'
  config: {
    items?: { id: string }[]
    cards?: { id: string }[]
  }
}
interface 다음 {
  kind: '발화받기' | '장면끝' | '회차끝' | '미션시작'
  next_scene?: 장면참조
  mission?: 미션참조
}

async function 세션열기(): Promise<{
  session_id: string
  scene: 장면참조 | null
  status: string
}> {
  const res = await 세션열기_라우트(
    new Request(`${주소}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ story: 이야기 }),
    }),
  )
  return 꺼내기('세션 열기', await 읽기(res))
}

async function 턴(session_id: string, 말: string) {
  const res = await 턴_라우트(
    new Request(`${주소}/api/sessions/${session_id}/turns`, {
      method: 'POST',
      headers: 오디오_헤더,
      body: 녹음(말),
    }),
    { params: Promise.resolve({ session_id }) },
  )
  return 꺼내기<{ empty?: true; next?: 다음 }>('턴', await 읽기(res))
}

async function 미션이벤트(
  session_id: string,
  mission_session_id: string,
  본문: { type: string; value?: string },
) {
  const res = await 미션_이벤트_라우트(
    new Request(`${주소}/api/sessions/${session_id}/missions/${mission_session_id}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(본문),
    }),
    { params: Promise.resolve({ session_id, mission_session_id }) },
  )
  return 꺼내기<{ step: string | null; mic: boolean; done: boolean }>(
    '미션 이벤트',
    await 읽기(res),
  )
}

async function 미션턴(session_id: string, mission_session_id: string, 말: string) {
  const res = await 미션_턴_라우트(
    new Request(`${주소}/api/sessions/${session_id}/missions/${mission_session_id}/turns`, {
      method: 'POST',
      headers: 오디오_헤더,
      body: 녹음(말),
    }),
    { params: Promise.resolve({ session_id, mission_session_id }) },
  )
  return 꺼내기<{
    empty?: true
    next?: { kind: '미션계속' | '미션끝'; step?: string | null }
  }>('미션 턴', await 읽기(res))
}

async function 미션완료(session_id: string, mission_session_id: string) {
  const res = await 미션_완료_라우트(
    new Request(`${주소}/api/sessions/${session_id}/missions/${mission_session_id}/complete`, {
      method: 'POST',
    }),
    { params: Promise.resolve({ session_id, mission_session_id }) },
  )
  return 꺼내기<{ next: 다음 }>('미션 완료', await 읽기(res))
}

/** 대화 씬 하나를 말없이 건너뛴다 (명세 4.5절). 도착 장면은 **서버가 정해 응답으로 준다.** */
async function 건너뛰기(session_id: string, scene_code: string) {
  const res = await 건너뛰기_라우트(
    new Request(`${주소}/api/sessions/${session_id}/scenes/${scene_code}/skip`, {
      method: 'POST',
    }),
    { params: Promise.resolve({ session_id, scene_code }) },
  )
  return 꺼내기<{ skipped: 장면참조 | null; scene: 장면참조 | null }>('건너뛰기', await 읽기(res))
}

async function 후활동열기(session_id: string) {
  const res = await 후활동_열기_라우트(
    new Request(`${주소}/api/sessions/${session_id}/post-activity`),
    { params: Promise.resolve({ session_id }) },
  )
  return 꺼내기<{
    config: { cards: { id: string; keywords: string[] }[]; answer_order: string[] }
    result: { submitted_order: string[] | null; completed_at: string | null }
  }>('후활동 열기', await 읽기(res))
}

async function 후활동순서(session_id: string, submitted_order: readonly string[]) {
  const res = await 후활동_순서_라우트(
    new Request(`${주소}/api/sessions/${session_id}/post-activity/order`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ submitted_order }),
    }),
    { params: Promise.resolve({ session_id }) },
  )
  return 꺼내기<{ is_correct: boolean; attempt_count: number }>('후활동 순서', await 읽기(res))
}

async function 후활동줄거리(session_id: string, 말: string) {
  const res = await 후활동_줄거리_라우트(
    new Request(`${주소}/api/sessions/${session_id}/post-activity/retelling`, {
      method: 'POST',
      headers: 오디오_헤더,
      body: 녹음(말),
    }),
    { params: Promise.resolve({ session_id }) },
  )
  return 꺼내기<{
    text: string
    analyzed: boolean
    keywords: { word: string; status: string }[] | null
  }>('후활동 줄거리', await 읽기(res))
}

async function 후활동종료(session_id: string, reason: 'finished' | 'left') {
  const res = await 후활동_종료_라우트(
    new Request(`${주소}/api/sessions/${session_id}/post-activity/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
    }),
    { params: Promise.resolve({ session_id }) },
  )
  return 꺼내기<{ report: 'queued' | 'exists' }>('후활동 종료', await 읽기(res))
}

/**
 * 🔴 **리포트 API 만 봉투가 다르다.** 아이 앱 넷은 `{ ok, data }` 인데 이쪽은 **알맹이를
 * 그대로** 내고 실패만 `{ error }` + 4xx 로 가른다 (`src/report/controller/envelope.ts` 가
 * 왜 그렇게 갈렸는지 적어 뒀다 — 화면 갈래가 먼저 닫히면서 맨 배열을 가정했다).
 *
 * 그래서 여기만 `읽기()` 를 안 쓴다. 이 차이를 검사가 흉내 내지 않으면, 봉투를 씌우는
 * 변경이 들어와도 아무도 안 아프다.
 */
async function 리포트(session_id: string) {
  const res = await 리포트_라우트(new Request(`${주소}/api/reports/${session_id}`), {
    params: Promise.resolve({ session_id }),
  })
  const 본문 = (await res.json()) as {
    status?: string
    metrics?: Record<string, unknown>
    narrative?: Record<string, unknown> | null
    error?: { code: string; message: string }
  }
  return { status: res.status, 본문 }
}

// ── 가짜 아이 ─────────────────────────────────────────────────────────────
//
// 장면·턴마다 다른 말을 한다 — 어느 발화가 어느 호출에 실렸나를 글자로 가를 수 있게.

function 발화(어디: string, 번째: number): string {
  return `며느리가 창피했을 것 같아 (${어디} ${번째}번째)`
}

/**
 * 낱말 12개가 **전부 글자로 찾히는** 줄거리 (`post-activity-api.test.ts` 와 같은 글).
 * ①규칙이 다 끝내므로 판정 LLM 이 안 불린다.
 */
const 다_말한_줄거리 =
  '며느리가 시집을 와서 방귀를 참다가 걱정이 되었어요. ' +
  '깜짝 놀랄 만큼 큰 방귀가 나와서 기둥이 흔들렸어요. ' +
  '배나무 앞에서 힘껏 방귀를 뀌니 배가 우수수 떨어졌어요. ' +
  '마을 사람들이 칭찬을 하고 고마워했고 며느리는 당당하게 웃었어요.'

// ── 미션 한 판 ────────────────────────────────────────────────────────────

/**
 * 미션 하나를 끝까지 돌린다 — 팝업이 하는 일 그대로다 (미션 명세 7절 B·C·D).
 *
 * `prop_choice` 는 소품을 고르고 스텝마다 말하고, `card_help` 는 친구를 고르고 말한 뒤
 * 「더 도울래?」에 답한다. 둘 다 `미션끝` 이 나오면 종료 요약을 부른다.
 */
async function 미션한판(session_id: string, 미션: 미션참조): Promise<다음> {
  const 첫_선택 =
    미션.mission_type === 'prop_choice'
      ? { type: 'prop_select', value: 미션.config.items?.[0]?.id }
      : { type: 'friend_select', value: 미션.config.cards?.[0]?.id }
  if (첫_선택.value === undefined) {
    throw new Error(`미션 config 에 고를 것이 없다: ${미션.code}`)
  }
  await 미션이벤트(session_id, 미션.mission_session_id, 첫_선택)

  for (let 번째 = 1; ; 번째 += 1) {
    if (번째 > 12) throw new Error(`미션이 안 끝난다: ${미션.code}`)

    const 결과 = await 미션턴(
      session_id,
      미션.mission_session_id,
      발화(`미션 ${미션.code}`, 번째),
    )
    if (결과.next?.kind === '미션끝') break

    // `card_help` 는 카드 하나를 돕고 나면 말이 아니라 「더 도울래?」의 답을 기다린다.
    if (결과.next?.step === null || 결과.next?.step === undefined) {
      const 그만 = await 미션이벤트(session_id, 미션.mission_session_id, {
        type: 'more',
        value: 'no',
      })
      if (그만.done) break
    }
  }

  return (await 미션완료(session_id, 미션.mission_session_id)).next
}

// ── 한 판을 끝까지 돌고 잴 것을 다 담아 온다 ───────────────────────────────

interface 완주기록 {
  session_id: string
  /** 아이가 본 대화 턴 수 (미션 턴은 안 센다). */
  대화턴: number
  /** 지나간 미션들. 「방귀 뀌는 며느리」는 둘이다 (장면 7·9). */
  미션들: string[]
  /** 마지막 턴이 낸 할 일. `회차끝` 이어야 이야기가 닫힌 것이다. */
  마지막_할일: string
  세션상태: string
  후활동: {
    카드수: number
    순서: { is_correct: boolean; attempt_count: number }
    줄거리: { text: string; analyzed: boolean; 단어수: number; used: number }
    종료: 'queued' | 'exists'
    완료시각: string | null
  }
  리포트응답: {
    status: number
    /** 실패면 그 코드. 성공이면 `null` — 왜 404 인지가 이 검사의 실패 메시지가 된다 */
    오류코드: string | null
    리포트상태?: string
    서술있나: boolean
    /** 지표가 비면 「리포트는 났는데 잴 것이 없다」다 */
    지표칸: string[]
  }
  리포트행: { status: string; regenerated: number; model: string | null } | null
  메시지수: number
  llm_calls: Record<string, number>
  호출: 용도[]
}

async function 한판(tx: Conn): Promise<완주기록> {
  const 기록 = 가짜_제미나이()

  // ── ① 이야기 시작 ────────────────────────────────────────────────────────
  const 열린것 = await 세션열기()
  const session_id = 열린것.session_id
  expect(열린것.scene).not.toBeNull()

  // ── ② 대화 장면 넷 + 미션 둘 ─────────────────────────────────────────────
  const 미션들: string[] = []
  let 대화턴 = 0
  let 마지막_할일 = ''

  for (let 걸음 = 0; ; 걸음 += 1) {
    // 진행이 제자리를 돌면 여기서 끊는다. 안 끊으면 검사가 영원히 매달린다.
    if (걸음 > 40) throw new Error(`완주가 안 끝난다 — ${걸음} 걸음째. 진행이 제자리를 돈다`)

    대화턴 += 1
    const 결과 = await 턴(session_id, 발화('대화', 대화턴))
    let 다음할일 = 결과.next
    if (다음할일 === undefined) throw new Error('턴이 next 를 안 줬다 (무음으로 읽혔나)')

    // 미션이 발동했다 — 팝업이 하는 일을 여기서 다 하고 그 뒤의 할 일을 받는다.
    if (다음할일.kind === '미션시작') {
      if (다음할일.mission === undefined) throw new Error('미션시작인데 mission 이 없다')
      미션들.push(다음할일.mission.code)
      다음할일 = await 미션한판(session_id, 다음할일.mission)
    }

    마지막_할일 = 다음할일.kind
    if (다음할일.kind === '회차끝') break
  }

  // ── ③ 후활동 ─────────────────────────────────────────────────────────────
  const 활동 = await 후활동열기(session_id)
  const 순서 = await 후활동순서(session_id, 활동.config.answer_order)
  const 줄거리답 = await 후활동줄거리(session_id, 다_말한_줄거리)
  const 종료 = await 후활동종료(session_id, 'finished')

  // ⭐ 리포트는 **기다리지 않고** 띄워진다 (R2). 검사만 그 손잡이로 기다린다.
  await 리포트_뒷작업.마지막작업

  // ── ④ 보호자가 읽는다 ────────────────────────────────────────────────────
  const 읽은것 = await 리포트(session_id)

  // ── 롤백 전에 DB 를 한 번 훑는다 ─────────────────────────────────────────
  const [세션행] = await tx.execute<{ status: string }>(
    sql`select status from story_sessions where id = ${session_id}`,
  )
  const [리포트행] = await tx
    .select({
      status: parent_reports.status,
      regenerated: parent_reports.regenerated,
      model: parent_reports.model,
    })
    .from(parent_reports)
    .where(eq(parent_reports.session_id, session_id))

  const [활동행] = await tx
    .select({ completed_at: post_activity_results.completed_at })
    .from(post_activity_results)
    .where(eq(post_activity_results.session_id, session_id))

  const 메시지행 = await tx
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.session_id, session_id))

  // ⚠️ `llm_calls` 는 **세션이 아니라 회차(`run_id`)에 걸린다.** 세션 하나에 회차 하나라
  //    (`startRunStep()`) 회차를 타고 내려가야 이 판의 호출이 나온다.
  const 호출행 = await tx.execute<{ purpose: string }>(
    sql`select c.purpose from gq_admin.llm_calls c
          join gq_admin.runs r on r.id = c.run_id
         where r.session_id = ${session_id}`,
  )

  const 용도별: Record<string, number> = {}
  for (const 행 of 호출행) 용도별[행.purpose] = (용도별[행.purpose] ?? 0) + 1

  return {
    session_id,
    대화턴,
    미션들,
    마지막_할일,
    세션상태: 세션행?.status ?? '?',
    후활동: {
      카드수: 활동.config.cards.length,
      순서,
      줄거리: {
        text: 줄거리답.text,
        analyzed: 줄거리답.analyzed,
        단어수: 줄거리답.keywords?.length ?? 0,
        used: 줄거리답.keywords?.filter((것) => 것.status === 'used').length ?? 0,
      },
      종료: 종료.report,
      완료시각: 활동행?.completed_at?.toISOString() ?? null,
    },
    리포트응답: {
      status: 읽은것.status,
      오류코드: 읽은것.본문.error?.code ?? null,
      리포트상태: 읽은것.본문.status,
      서술있나: 읽은것.본문.narrative != null,
      지표칸: Object.keys(읽은것.본문.metrics ?? {}),
    },
    리포트행: 리포트행 ?? null,
    메시지수: 메시지행.length,
    llm_calls: 용도별,
    호출: 기록.호출,
  }
}

// ═══════════════════════════════════════════════════════════════════════════

검사('E2E — 「방귀 뀌는 며느리」를 API 로 끝까지 하면 보호자 리포트가 나온다', () => {
  let 완주!: 완주기록

  beforeAll(async () => {
    // ⚠️ `installFakeSdk()` 는 `tests/setup.ts` 의 `beforeEach` 가 매번 비운다.
    //    그래서 한 판을 여기서 **다 돌려 놓고** 아래 단언들은 그 기록만 읽는다
    //    (`full-run.test.ts` 와 같은 모양).
    상자.child_id = randomUUID()
    await 트랜잭션(async (tx) => {
      완주 = await 한판(tx)
    })
  }, 180_000)

  // ── ⭐ 이 파일의 존재 이유 ───────────────────────────────────────────────

  it('⭐ 보호자가 `GET /api/reports/{sid}` 로 리포트를 받는다 — 200 · 서술이 있다', () => {
    // 이 두 줄이 「리포트까지 나왔다」의 정의다. 사슬 어디가 끊겨도 여기가 404 가 된다
    // (문지기가 못 찾았거나 · 생성이 실패했거나 · 애초에 안 띄워졌거나 — 셋이 같은 404 다).
    expect(완주.리포트응답.오류코드).toBeNull()
    expect(완주.리포트응답.status).toBe(200)

    // `metrics_only` 면 지표는 나왔는데 문장 두 편이 다 죽은 것이다 (R18).
    expect(완주.리포트응답.리포트상태).toBe('complete')
    expect(완주.리포트응답.서술있나).toBe(true)

    // 지표가 빈 채로 나오면 「리포트는 났는데 잴 것이 없다」다 — 재료 읽기가 끊긴 판이다.
    expect(완주.리포트응답.지표칸).toContain('counts')
  })

  it('⭐ 활동 하나에 리포트 행 하나가 남는다 (R1) — 자동 생성이라 regenerated 는 0', () => {
    expect(완주.리포트행).not.toBeNull()
    expect(완주.리포트행?.status).toBe('complete')
    // 「다시 만들기」를 누른 적이 없다. 여기가 1 이면 어딘가 재생성을 부르고 있다 (R19).
    expect(완주.리포트행?.regenerated).toBe(0)
    // 어느 모델이 답했는지가 남는다 — 비면 두 편 다 실패했다는 뜻이다.
    expect(완주.리포트행?.model).not.toBeNull()
  })

  // ── 사슬의 앞쪽이 정말 돌았나 ────────────────────────────────────────────

  it('이야기가 API 로 닫힌다 — 마지막 턴이 회차끝을 내고 세션이 completed 다', () => {
    expect(완주.마지막_할일).toBe('회차끝')
    expect(완주.세션상태).toBe('completed')
    // 대화 장면 넷을 최소 한 턴씩은 돌았다. 0 이면 첫 턴에 회차가 닫힌 것이다.
    expect(완주.대화턴).toBeGreaterThanOrEqual(4)
    // 아이 한 줄 · 캐릭터 한 줄 + 장면마다 여는 말. 비면 대화가 하나도 안 저장된 것이다.
    expect(완주.메시지수).toBeGreaterThanOrEqual(완주.대화턴 * 2)
  })

  it('미션 둘이 이야기 도중에 발동하고 끝까지 돌아간다 (장면 7 배 따기 · 장면 9 친구 돕기)', () => {
    // 🔴 시드의 미션은 둘이다. 하나만 나오면 트리거(`any_elements`·`min_turns`)가 어긋났거나
    //    미션을 못 끝내고 이야기가 그냥 지나간 것이다.
    expect(완주.미션들).toEqual(['ms_banggui_pear', 'ms_banggui_friend'])
  })

  it('후활동 넷이 순서대로 돈다 — 열기·순서·줄거리·종료', () => {
    expect(완주.후활동.카드수).toBe(4)
    // 서버가 정답과 대조해 판정한다 (명세 5.B — 앱이 보낸 판정은 안 받는다).
    expect(완주.후활동.순서).toEqual({ is_correct: true, attempt_count: 1 })
    // 「마치기」를 눌렀으니 완료 시각이 찍힌다 (`left` 였으면 null 이다).
    expect(완주.후활동.완료시각).not.toBeNull()
    // 이 판이 처음 만드는 리포트다. `exists` 면 앞에서 이미 만들어졌다는 뜻이고,
    // 그건 후활동 결과가 안 담긴 리포트다 (F10 이 막으려는 바로 그것).
    expect(완주.후활동.종료).toBe('queued')
  })

  it('🔴 줄거리 낱말 12개가 규칙만으로 다 찾힌다 — 판정 LLM 은 안 불린다 (명세 6.3)', () => {
    expect(완주.후활동.줄거리.text).toBe(다_말한_줄거리)
    expect(완주.후활동.줄거리.analyzed).toBe(true)
    expect(완주.후활동.줄거리.단어수).toBe(12)
    expect(완주.후활동.줄거리.used).toBe(12)
    // 가짜 SDK 가 단어판정에서 터지게 해 뒀으므로 위가 초록인 것 자체가 증거지만,
    // 「그 용도가 한 번도 안 나갔다」를 눈에 보이게 한 줄 더 박는다.
    expect(완주.호출.filter((것) => 것 === '단어판정')).toEqual([])
  })

  // ── 돈이 새는 자리 ───────────────────────────────────────────────────────

  it('🔴 리포트는 LLM 을 정확히 두 번 부른다 — 말하기 분석 한 번 · 가정 연계 한 번 (명세 8절)', () => {
    // 한 편이 두 번 나가면 「기다리지 않는다」가 겹쳐 불린 것이고, 그건 돈이 두 배로 나간다.
    // (`queueReport()` 는 행이 이미 있으면 안 만든다 — 그 문지기가 여기서 재진다.)
    expect(완주.호출.filter((것) => 것 === '리포트분석')).toHaveLength(1)
    expect(완주.호출.filter((것) => 것 === '리포트안내')).toHaveLength(1)
  })

  it('🟡 그 두 번은 `llm_calls` 에 **안 남는다** — 비용 화면에서 리포트가 안 보인다', () => {
    // 이것은 버그 재현이 아니라 **지금 그렇다는 사실을 박아 두는 것**이다.
    //
    // `llm_calls_purpose_check` 가 아직 넷(`analysis`·`character`·`mission_reply`·
    // `mission_summary`)만 받는다. `report_analysis`·`report_guide` 를 넣으려면 CHECK 를
    // 넓혀야 하고 그건 스키마 갈래(이슈 #35)의 몫이다 — `src/report/engine/narrative.ts`
    // 머리말이 그렇게 적어 뒀고, 실제로 `generateReport()` 는 호출을 기록하지 않는다.
    //
    // ⭐ **CHECK 를 넓히고 저장을 붙이는 날 이 검사가 빨개진다. 그때가 이 줄을 지울 때다** —
    //    위 검사의 주석대로 「DB 쪽 기록도 같아야 한다」로 바꿔 달면 된다.
    expect(완주.llm_calls.report_analysis).toBeUndefined()
    expect(완주.llm_calls.report_guide).toBeUndefined()
  })

  it('대화 턴마다 분석이 한 번씩 나가고, 미션 대사도 llm_calls 에 남는다', () => {
    // 분석은 대화 턴 + 미션 턴 수만큼. 최소한 대화 턴 수보다 적을 수는 없다.
    expect(완주.호출.filter((것) => 것 === '분석').length).toBeGreaterThanOrEqual(완주.대화턴)
    expect(완주.llm_calls.analysis).toBeGreaterThanOrEqual(완주.대화턴)
    // 미션이 둘 돌았으니 미션 대사 행이 있어야 한다 (미션 명세 4절).
    expect(완주.llm_calls.mission_reply).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ⭐ 말 안 하고 지나간 판 — **실측으로 셋 중 하나가 이랬다**
// ═══════════════════════════════════════════════════════════════════════════
//
// 위 검사의 가짜 아이는 늘 또렷하게 말한다. 그런데 진짜 아이는 안 그렇고, 그 차이가
// 리포트가 나오느냐 마느냐를 가른다 —
//
// > 서버는 **마지막 대화 장면이 끝나야** 세션을 닫는다. 아이가 그 장면에서 말을 안 하고
// > 지나가면 서버는 거기 그대로 선다 — 실측(팀 DB)으로 끝까지 본 판의 **셋 중 하나가 그랬다.**
// > — `src/stories/fart-bride/session-api.ts:515`
//
// 🔴 **안 닫힌 세션은 리포트가 영영 안 만들어진다.** 만드는 길 넷이 전부 `completed` 만 본다:
//
// | 길 | 어디서 막히나 |
// |---|---|
// | 이야기 닫을 때 (`completeRun()`) | 애초에 안 불린다 |
// | 후활동 종료 (#45) | `PostActivityNotAllowed` — 안 닫혔으면 활동 자체가 안 열린다 |
// | 보호자 목록 받침 (F12) | `리포트없는_활동들()` 이 `status = 'completed'` 로 거른다 |
// | 리포트 직접 조회 | `queueReport()` 가드가 `completed` 아니면 그냥 돌아간다 |
//
// 앱은 끝 화면에 닿는 순간 남은 장면을 **건너뛰기로 밀어 닫아** 이 구멍을 막는다
// (`play.tsx:215` 의 `useEffect` — 활동 버튼을 누르든 말든 돈다). 그 길의 **서버 쪽**이
// 이 검사다: 마지막 대화를 말없이 건너뛰어도 세션이 닫히고 리포트까지 나오나.
//
// ⛔ 위 검사를 고쳐서 이걸 겸하게 하지 마라. 「말한 판」과 「안 한 판」은 **둘 다** 서야 한다 —
//    하나로 합치면 어느 쪽이 깨졌는지 못 가린다.

/** 시드의 마지막 대화 장면 (전개 다섯 1·2·4·6·8 · 대화 넷 3·5·7·9). */
const 마지막_대화장면 = 'sc_banggui_09'

interface 건너뛴기록 {
  대화턴: number
  /** 실제로 건너뛴 장면 code. `null` 이면 서버가 그 장면을 안 기다리고 있었다 */
  건너뛴장면: string | null
  /** 건너뛴 뒤 서버가 기다리는 장면. `null` 이어야 회차가 닫힌 것이다 */
  남은장면: string | null
  세션상태: string
  후활동열림: boolean
  리포트: { status: number; 오류코드: string | null; 리포트상태?: string; 서술있나: boolean }
}

/**
 * 장면 3·5·7 은 말로 지나가고 **마지막 대화(9)만 말없이 건너뛴다.**
 *
 * 🔴 9 를 고른 이유 — 마지막 대화라야 「건너뛰기가 세션을 닫나」를 잰다. 가운데 장면을
 *    건너뛰면 다음 대화로 전진할 뿐이라 닫는 자리를 못 밟는다.
 */
async function 건너뛴판(tx: Conn): Promise<건너뛴기록> {
  가짜_제미나이()

  const 열린것 = await 세션열기()
  const session_id = 열린것.session_id
  let 장면 = 열린것.scene?.code ?? null
  let 대화턴 = 0
  let 건너뛴장면: string | null = null
  let 남은장면: string | null = null

  for (let 걸음 = 0; ; 걸음 += 1) {
    if (걸음 > 40) throw new Error(`안 끝난다 — ${걸음} 걸음째`)
    if (장면 === null) throw new Error('서버가 기다리는 장면이 없다 (너무 일찍 닫혔다)')

    // ── 마지막 대화에 닿았다 — 여기서 아이가 아무 말도 안 하고 넘어간다 ────
    if (장면 === 마지막_대화장면) {
      const 결과 = await 건너뛰기(session_id, 장면)
      건너뛴장면 = 결과.skipped?.code ?? null
      남은장면 = 결과.scene?.code ?? null
      break
    }

    대화턴 += 1
    const 결과 = await 턴(session_id, 발화('대화', 대화턴))
    let 다음할일 = 결과.next
    if (다음할일 === undefined) throw new Error('턴이 next 를 안 줬다')

    if (다음할일.kind === '미션시작') {
      if (다음할일.mission === undefined) throw new Error('미션시작인데 mission 이 없다')
      다음할일 = await 미션한판(session_id, 다음할일.mission)
    }
    if (다음할일.kind === '회차끝') {
      throw new Error('마지막 대화에 닿기 전에 회차가 닫혔다 — 장면 추적이 어긋났다')
    }
    if (다음할일.kind === '장면끝') 장면 = 다음할일.next_scene?.code ?? null
  }

  // ── 앱이 끝 화면에서 하는 그대로: 닫혔으면 활동이 열린다 ─────────────────
  let 후활동열림 = false
  try {
    await 후활동열기(session_id)
    후활동열림 = true
  } catch {
    // 409 POST_ACTIVITY_NOT_ALLOWED — 아직 안 닫혔다는 뜻이다. 아래 단언이 잡는다.
  }
  if (후활동열림) await 후활동종료(session_id, 'finished')
  await 리포트_뒷작업.마지막작업

  const 읽은것 = await 리포트(session_id)
  const [세션행] = await tx.execute<{ status: string }>(
    sql`select status from story_sessions where id = ${session_id}`,
  )

  return {
    대화턴,
    건너뛴장면,
    남은장면,
    세션상태: 세션행?.status ?? '?',
    후활동열림,
    리포트: {
      status: 읽은것.status,
      오류코드: 읽은것.본문.error?.code ?? null,
      리포트상태: 읽은것.본문.status,
      서술있나: 읽은것.본문.narrative != null,
    },
  }
}

검사('E2E — 마지막 대화를 말없이 건너뛴 판도 리포트가 나온다 (실측 3판 중 1판)', () => {
  let 판!: 건너뛴기록

  beforeAll(async () => {
    상자.child_id = randomUUID()
    await 트랜잭션(async (tx) => {
      판 = await 건너뛴판(tx)
    })
  }, 180_000)

  it('⭐ 마지막 대화를 건너뛰면 서버가 세션을 닫는다 — 기다리는 장면이 없어진다', () => {
    // 서버가 정말 그 장면에 서 있었다. `null` 이면 앱이 엉뚱한 장면을 건너뛴 것이고,
    // 그러면 세션은 안 닫힌 채 남는다 (반복 안전의 대가 — 명세 4.5절).
    expect(판.건너뛴장면).toBe(마지막_대화장면)
    // 🔴 이 줄이 구멍이 막혔다는 증거다. 남아 있으면 그 판은 리포트가 영영 안 나온다.
    expect(판.남은장면).toBeNull()
    expect(판.세션상태).toBe('completed')
    // 앞 장면들은 말로 지나갔다 — 한 마디도 안 한 판이 아니라 「마지막만 건너뛴」 판이다.
    expect(판.대화턴).toBeGreaterThan(0)
  })

  it('⭐ 그 판도 후활동이 열리고 보호자 리포트가 나온다', () => {
    // 안 닫혔으면 여기가 409 라 활동이 안 열리고, 리포트를 띄울 자리도 없어진다.
    expect(판.후활동열림).toBe(true)

    expect(판.리포트.오류코드).toBeNull()
    expect(판.리포트.status).toBe(200)
    // 말이 적어도 리포트는 만든다 (결정 R16 — 「빈약해도 만든다」).
    expect(판.리포트.리포트상태).toBe('complete')
    expect(판.리포트.서술있나).toBe(true)
  })
})
