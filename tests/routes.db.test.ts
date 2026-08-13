// 라우트 넷 × 진짜 DB — **라우트가 부른 답과 `service` 를 직접 부른 답이 같은가** (화면-4).
//
// `tests/routes.test.ts` 는 서비스를 가짜로 바꿔 **봉투와 오류 표**만 잰다.
// 여기서는 반대로 아무것도 가짜로 두지 않고 (LLM 의 SDK 자리만) 진짜 DB 에 한 턴을 돌린다.
// 두 파일이 갈린 것은 `vi.mock` 이 파일 단위라 같은 모듈을 가짜와 진짜로 동시에 못 쓰기 때문이다.
//
// ## 🔴 이 파일이 재는 것
//
// 1. **라우트가 규칙을 새로 만들지 않는다** — 같은 입력이면 `analysisStep()`·`decisionStep()`·
//    `dialogueStep()` 을 직접 부른 것과 **한 칸도 다르지 않은 답**이 나온다.
// 2. **전개 장면은 404 가 아니라 409 다** (계약 7절 표). `requireDialogueScene()` 이 던지는
//    `SceneNotFound`(404)가 라우트로 새면 화면이 「씬이 없다」로 읽는다.
// 3. **④ 가 답을 미리 알려주지 않는다** — `required_elements`·`element_criteria`·`scene_goal`·
//    `character_closing` 이 응답에 없다 (`docs/기준/대화작동규칙.md:81`).
// 4. **CLOSING 이면 캐릭터 LLM 호출이 0** 이고 `source: 'fixed'` 이며 `meta` 가 안 실린다.
//
// ## 트랜잭션을 열고 끝나면 되돌린다
//
// 라우트는 `conn` 을 받지 않는다 — 서비스가 `getDb()` 를 부른다. 그래서 `getDb()` 자리에
// 검사 트랜잭션을 꽂는다. `tests/repo.test.ts`·`tests/service.test.ts` 와 같은 되돌림이다.

import { randomUUID } from 'node:crypto'

import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { characters, stories, story_scenes } from '@/db/schema'

// ⚠️ 팩토리 안에서 바깥 변수를 참조하면 hoisting 에 걸린다. `vi.hoisted` 로 상자를 먼저 만든다.
const 상자 = vi.hoisted(() => ({ tx: null as unknown }))

vi.mock('@/lib/repo/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/repo/db')>()
  return {
    ...real,
    // 검사가 트랜잭션을 꽂아 두면 그것을, 아니면 진짜 연결을 준다.
    getDb: () => 상자.tx ?? real.getDb(),
  }
})

import { POST as 분석_라우트 } from '@/app/api/v1/analysis/route'
import { POST as 판단_라우트 } from '@/app/api/v1/decision/route'
import { POST as 대사_라우트 } from '@/app/api/v1/dialogue/route'
import { GET as 장면_라우트 } from '@/app/api/v1/stories/[story_code]/scenes/[scene_code]/route'
import { closeDb, getDb, type Conn } from '@/lib/repo/db'
import { advanceRun, startRun } from '@/lib/service/run'
import { startScene } from '@/lib/service/story'
import { analysisStep, decisionStep, dialogueStep } from '@/lib/service/step'

import { installFakeSdk } from './support/sdk-gate'

// ── DB 가 있나 (repo.test.ts 와 같은 문지기) ───────────────────────────────

async function 붙어보기(): Promise<string | null> {
  try {
    await getDb().execute(sql`select 1`)
    return null
  } catch (오류) {
    return 오류 instanceof Error ? `${오류.name}: ${오류.message}` : String(오류)
  }
}

const 못붙는_이유 = await 붙어보기()
if (못붙는_이유 !== null) {
  process.stderr.write(
    `\n[routes.db.test] Postgres 에 못 붙어 라우트×DB 검사를 건너뛴다 (도커가 꺼져 있나?)\n` +
      `                 ${못붙는_이유}\n\n`,
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

// ── 가짜 제미나이 (service.test.ts 와 같은 자리·같은 방식) ─────────────────

interface 가짜_기록 {
  분석: number
  대사: number
}

function 가짜_제미나이(): 가짜_기록 {
  const 기록: 가짜_기록 = { 분석: 0, 대사: 0 }

  installFakeSdk('gemini', () => ({
    interactions: {
      create: async (요청: Record<string, unknown>) => {
        const user = String(요청.input ?? '')
        // 분석만 JSON 스키마를 실어 보낸다 (`lib/llm/index.ts` 의 `geminiRequest()`).
        if (요청.response_format !== undefined) {
          기록.분석 += 1
          const 발화 = /"child_utterance":"((?:[^"\\]|\\.)*)"/.exec(user)
          const 원문 = 발화 === null ? '' : (JSON.parse(`"${발화[1]}"`) as string)
          return {
            output_text: JSON.stringify({
              child_intent: 'OPINION',
              main_point: 원문,
              // evidence 가 아이 발화 원문이라 후처리를 그대로 통과한다.
              detected_elements: [{ type: 'EMPATHY', evidence: 원문 }],
              utterance_validity: 'VALID',
            }),
            usage_metadata: { prompt_token_count: 100, candidates_token_count: 20 },
          }
        }
        기록.대사 += 1
        return {
          output_text: '그러게 말이다',
          usage_metadata: { prompt_token_count: 200, candidates_token_count: 30 },
        }
      },
    },
  }))

  return 기록
}

beforeEach(() => {
  // 로그 세 줄이 검사 출력을 덮지 않게. `[분석]`·`[상태]`·`[판정]` 자체는 service.test.ts 가 잰다.
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

// ── 검사용 콘텐츠 ─────────────────────────────────────────────────────────

interface 씨앗 {
  story_code: string
  /** `sc_rt_01`(전개) `02`(대화) */
  scene_ids: Record<string, string>
}

async function 콘텐츠_넣기(tx: Conn): Promise<씨앗> {
  const 꼬리 = randomUUID().slice(0, 8)
  const story_code = `s_rt_${꼬리}`

  const [이야기] = await tx
    .insert(stories)
    .values({
      slug: story_code,
      title: `라우트 검사용 ${꼬리}`,
      summary: '검사용',
      difficulty: '보통',
      status: 'draft',
    })
    .returning({ id: stories.id })

  const [캐릭터] = await tx
    .insert(characters)
    .values({
      story_id: 이야기.id,
      code: 'ch_rt_daughter_in_law',
      name: '며느리',
      persona: '시집온 지 얼마 안 된 며느리',
      speech_style: '옛이야기 말투',
      guidance_style: '자기 걱정을 소리 내어 말한다',
      forbidden: ['설명하지 않는다'],
    })
    .returning({ id: characters.id })

  const 넣은_장면들 = await tx
    .insert(story_scenes)
    .values([
      { story_id: 이야기.id, code: 'sc_rt_01', scene_order: 1, scene_description: '전개 한 줄' },
      {
        story_id: 이야기.id,
        code: 'sc_rt_02',
        scene_order: 2,
        conflict: '갈등',
        character_id: 캐릭터.id,
        character_name: '며느리',
        character_opening: '아이고… 나 때문에 다들 놀랐지 뭐야.',
        character_closing: '네 말을 들으니 마음이 놓이는구나.',
        scene_stance: '아직 참고 있다',
        scene_goal: '아이가 며느리의 처지를 헤아리게 한다',
        required_elements: ['EMPATHY'],
        element_criteria: { EMPATHY: '며느리의 마음을 헤아렸나' },
        remaining_worries: { EMPATHY: '그럼 난 어떻게 하면 좋을까…' },
        preferred_turns: 2,
        max_turns: 4,
      },
    ])
    .returning({ id: story_scenes.id, code: story_scenes.code })

  const scene_ids: Record<string, string> = {}
  for (const 행 of 넣은_장면들) scene_ids[행.code] = 행.id
  return { story_code, scene_ids }
}

/** 회차를 열고 대화 장면 앞까지 전개를 재생해 둔다. */
async function 회차_준비(tx: Conn, 씨: 씨앗): Promise<string> {
  const { run } = await startRun(tx, { story_code: 씨.story_code, started_by: '검사' })
  const 할_일 = await advanceRun(tx, run.id)
  expect(할_일.kind).toBe('발화받기')
  return run.session_id
}

// ── 라우트 부르기 ─────────────────────────────────────────────────────────

function 요청(경로: string, 본문: unknown): Request {
  return new Request(`http://검사${경로}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(본문),
  })
}

interface 봉투 {
  status: number
  api_version?: string
  data?: Record<string, unknown>
  meta?: Record<string, unknown>
  error?: { code: string; message: string; retryable: boolean }
}

/** 알맹이의 한 칸. `data` 모양은 라우트마다 달라 검사 쪽에서 꺼낸다. */
function 칸(값: unknown, 이름: string): unknown {
  return (값 as Record<string, unknown>)[이름]
}

async function 열기(응답: Response): Promise<봉투> {
  const 몸 = (await 응답.json()) as Omit<봉투, 'status'>
  return { status: 응답.status, ...몸 }
}

const 장면_부르기 = (story_code: string, scene_code: string) =>
  장면_라우트(new Request('http://검사/api/v1/stories/x/scenes/y'), {
    params: Promise.resolve({ story_code, scene_code }),
  })

/** uuid 칸을 빼고 견준다 — 세션이 다르면 id 도 다르다. 나머지가 같아야 한다. */
function id를_뺀다(값: Record<string, unknown>): Record<string, unknown> {
  const 나머지 = { ...값 }
  delete 나머지.message_id
  return 나머지
}

// ═══════════════════════════════════════════════════════════════════════════

검사('라우트 넷 × 진짜 DB', () => {
  it('①②③ 한 턴이 라우트로 돈다 — 봉투와 meta 까지', async () => {
    await 트랜잭션(async (tx) => {
      const 기록 = 가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)
      const session_id = await 회차_준비(tx, 씨)

      const 하나 = await 열기(
        await 분석_라우트(요청('/api/v1/analysis', { session_id, child_utterance: '며느리가 창피했겠다' })),
      )
      expect(하나.status).toBe(200)
      expect(하나.api_version).toBe('v1')
      expect(하나.data).toMatchObject({
        turn_order: 2, // 1 은 고정 첫 대사다
        analysis: { child_intent: 'OPINION', utterance_validity: 'VALID' },
        detected_elements_kept: ['EMPATHY'],
        dropped: [],
      })
      // 응답한 공급자와 모델 ID 가 실린다 (`CLAUDE.md` 로그 절).
      expect(하나.meta).toMatchObject({ provider: 'gemini' })
      const message_id = 하나.data!.message_id as string

      const 둘 = await 열기(
        await 판단_라우트(
          요청('/api/v1/decision', {
            session_id,
            message_id,
            analysis: {
              child_intent: 'OPINION',
              detected_elements: 하나.data!.detected_elements_kept,
              utterance_validity: 'VALID',
            },
          }),
        ),
      )
      expect(둘.status).toBe(200)
      // ⛔ LLM 을 안 불렀으므로 meta 가 없다.
      expect(둘.meta).toBeUndefined()
      // ⭐ 첫 턴은 **NORMAL 강제**다 (`decide.ts`). 목표를 채워 `scene_goal_met` 이 서도
      //    모드는 CLOSING 이 되지 않는다 — 그 규칙이 라우트를 지나도 그대로다.
      expect(둘.data!.decision).toMatchObject({ response_mode: 'NORMAL', scene_goal_met: true })
      expect(둘.data!.session).toMatchObject({
        current_child_turn_count: 1,
        accumulated_elements: ['EMPATHY'],
      })
      // 저장하지 않고 매번 계산한다 (경계 5).
      expect(둘.data!.missing_elements).toEqual([])

      const 셋 = await 열기(
        await 대사_라우트(
          요청('/api/v1/dialogue', {
            session_id,
            message_id,
            response_mode: 칸(둘.data!.decision, 'response_mode'),
            reaction_key: 칸(둘.data!.decision, 'reaction_key'),
            guidance_target: 칸(둘.data!.decision, 'guidance_target'),
            main_point: 칸(하나.data!.analysis, 'main_point'),
          }),
        ),
      )
      expect(셋.status).toBe(200)
      expect(셋.data).toMatchObject({ text: '그러게 말이다', source: 'generated', turn_order: 3 })
      expect(셋.meta).toMatchObject({ provider: 'gemini' })

      expect(기록).toEqual({ 분석: 1, 대사: 1 })
    })
  })

  it('⭐ 라우트로 부른 답 = service 를 직접 부른 답 (라우트에 규칙이 없다)', async () => {
    await 트랜잭션(async (tx) => {
      가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)
      const 발화 = '며느리가 창피했겠다'

      // 같은 콘텐츠·같은 발화로 회차 둘을 나란히 돌린다.
      const 라우트_세션 = await 회차_준비(tx, 씨)
      const 직접_세션 = await 회차_준비(tx, 씨)

      const 라우트_하나 = await 열기(
        await 분석_라우트(요청('/api/v1/analysis', { session_id: 라우트_세션, child_utterance: 발화 })),
      )
      const 직접_하나 = await analysisStep({ session_id: 직접_세션, child_utterance: 발화 })
      expect(id를_뺀다(라우트_하나.data!)).toEqual(id를_뺀다(직접_하나.data as unknown as Record<string, unknown>))

      const 판단_재료 = {
        child_intent: 'OPINION',
        detected_elements: ['EMPATHY'],
        utterance_validity: 'VALID',
      }
      const 라우트_둘 = await 열기(
        await 판단_라우트(
          요청('/api/v1/decision', {
            session_id: 라우트_세션,
            message_id: 라우트_하나.data!.message_id,
            analysis: 판단_재료,
          }),
        ),
      )
      const 직접_둘 = await decisionStep({
        session_id: 직접_세션,
        message_id: 직접_하나.data.message_id,
        analysis: 판단_재료,
      })
      expect(라우트_둘.data).toEqual(직접_둘.data)

      const 라우트_셋 = await 열기(
        await 대사_라우트(
          요청('/api/v1/dialogue', {
            session_id: 라우트_세션,
            message_id: 라우트_하나.data!.message_id,
            response_mode: 'NORMAL',
            reaction_key: 'directResponse',
            guidance_target: null,
            main_point: 발화,
          }),
        ),
      )
      const 직접_셋 = await dialogueStep({
        session_id: 직접_세션,
        message_id: 직접_하나.data.message_id,
        response_mode: 'NORMAL',
        reaction_key: 'directResponse',
        guidance_target: null,
        main_point: 발화,
      })
      expect(id를_뺀다(라우트_셋.data!)).toEqual(
        id를_뺀다(직접_셋.data as unknown as Record<string, unknown>),
      )
    })
  })

  it('🔴 전개 장면에 발화가 오면 404 가 아니라 409 TURN_NOT_ALLOWED 다', async () => {
    await 트랜잭션(async (tx) => {
      가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)
      const { run } = await startRun(tx, { story_code: 씨.story_code, started_by: '검사' })

      // 아직 어느 장면에도 안 들어갔다 → `current_scene_id` 가 null (계약 7절 표).
      const 아직 = await 열기(
        await 분석_라우트(요청('/api/v1/analysis', { session_id: run.session_id, child_utterance: '음' })),
      )
      expect(아직.status).toBe(409)
      expect(아직.error).toMatchObject({ code: 'TURN_NOT_ALLOWED', retryable: false })

      // 세션을 **전개 장면**에 세워 둔다. 여기가 `SceneNotFound`(404) 로 새던 자리다.
      await startScene(tx, { session_id: run.session_id, scene: (await 장면_행(tx, 씨, 'sc_rt_01')) })
      const 전개 = await 열기(
        await 분석_라우트(요청('/api/v1/analysis', { session_id: run.session_id, child_utterance: '음' })),
      )
      expect(전개.status).toBe(409)
      expect(전개.error).toMatchObject({ code: 'TURN_NOT_ALLOWED' })
    })
  })

  it('없는 세션은 404 SESSION_NOT_FOUND · 남의 메시지는 404 MESSAGE_NOT_FOUND', async () => {
    await 트랜잭션(async (tx) => {
      가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)
      const 세션_가 = await 회차_준비(tx, 씨)
      const 세션_나 = await 회차_준비(tx, 씨)

      const 없는_세션 = await 열기(
        await 분석_라우트(요청('/api/v1/analysis', { session_id: randomUUID(), child_utterance: '음' })),
      )
      expect(없는_세션.status).toBe(404)
      expect(없는_세션.error).toMatchObject({ code: 'SESSION_NOT_FOUND' })

      const 가_하나 = await 열기(
        await 분석_라우트(요청('/api/v1/analysis', { session_id: 세션_가, child_utterance: '음' })),
      )
      // 가 의 메시지 id 를 나 의 세션에 들이민다.
      const 남의것 = await 열기(
        await 판단_라우트(
          요청('/api/v1/decision', {
            session_id: 세션_나,
            message_id: 가_하나.data!.message_id,
            analysis: { child_intent: 'OPINION', detected_elements: [], utterance_validity: 'VALID' },
          }),
        ),
      )
      expect(남의것.status).toBe(404)
      expect(남의것.error).toMatchObject({ code: 'MESSAGE_NOT_FOUND' })
    })
  })

  it('CLOSING 턴은 캐릭터 LLM 호출이 0 이고 source=fixed 이며 meta 가 없다', async () => {
    await 트랜잭션(async (tx) => {
      const 기록 = 가짜_제미나이()
      const 씨 = await 콘텐츠_넣기(tx)
      const session_id = await 회차_준비(tx, 씨)

      let 마지막: 봉투 | null = null
      for (let 턴 = 1; 턴 <= 2; 턴 += 1) {
        const 하나 = await 열기(
          await 분석_라우트(요청('/api/v1/analysis', { session_id, child_utterance: `며느리가 창피했겠다 ${턴}` })),
        )
        expect(하나.status).toBe(200)
        const 둘 = await 열기(
          await 판단_라우트(
            요청('/api/v1/decision', {
              session_id,
              message_id: 하나.data!.message_id,
              analysis: {
                child_intent: 'OPINION',
                detected_elements: 하나.data!.detected_elements_kept,
                utterance_validity: 'VALID',
              },
            }),
          ),
        )
        expect(둘.status).toBe(200)
        마지막 = await 열기(
          await 대사_라우트(
            요청('/api/v1/dialogue', {
              session_id,
              message_id: 하나.data!.message_id,
              response_mode: 칸(둘.data!.decision, 'response_mode'),
              reaction_key: 칸(둘.data!.decision, 'reaction_key'),
              guidance_target: 칸(둘.data!.decision, 'guidance_target'),
              main_point: 칸(하나.data!.analysis, 'main_point'),
            }),
          ),
        )
        expect(마지막.status).toBe(200)
      }

      // 둘째 턴에 목표를 채우고 CLOSING 이 났다 → 고정 텍스트가 나가고 LLM 은 안 돌았다.
      expect(마지막!.data).toMatchObject({
        source: 'fixed',
        text: '네 말을 들으니 마음이 놓이는구나.',
      })
      expect(마지막!.meta).toBeUndefined()
      // 대사 호출은 첫 턴 한 번뿐이다 (경계 4 · 결정 36).
      expect(기록.대사).toBe(1)
      expect(기록.분석).toBe(2)
    })
  })

  it('④ 는 답을 미리 알려주는 칸을 주지 않는다 (대화작동규칙:81)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)

      const 대화 = await 열기(await 장면_부르기(씨.story_code, 'sc_rt_02'))
      expect(대화.status).toBe(200)
      expect(Object.keys(대화.data!).sort()).toEqual([
        'character_name',
        'character_opening',
        'code',
        'scene_description',
        'scene_order',
        'scene_type',
      ])
      expect(대화.data).toMatchObject({ scene_type: 'dialogue', character_name: '며느리' })

      const 전개 = await 열기(await 장면_부르기(씨.story_code, 'sc_rt_01'))
      expect(전개.data).toMatchObject({ scene_type: 'narration', character_name: null })

      const 없는_씬 = await 열기(await 장면_부르기(씨.story_code, 'sc_rt_99'))
      expect(없는_씬.status).toBe(404)
      expect(없는_씬.error).toMatchObject({ code: 'SCENE_NOT_FOUND', retryable: false })

      const 없는_이야기 = await 열기(await 장면_부르기('s_없다', 'sc_rt_02'))
      expect(없는_이야기.status).toBe(404)
      expect(없는_이야기.error).toMatchObject({ code: 'SCENE_NOT_FOUND' })
    })
  })
})

/** `startScene()` 에 넘길 장면 한 행. 콘텐츠 조회는 서비스가 이미 갖고 있다. */
async function 장면_행(tx: Conn, 씨: 씨앗, code: string) {
  const { scenesOfStory } = await import('@/lib/repo/content')
  const 전부 = await scenesOfStory(tx, 씨.story_code)
  const 하나 = 전부.find((행) => 행.code === code)
  if (하나 === undefined) throw new Error(`검사 콘텐츠에 ${code} 가 없다`)
  return 하나
}
