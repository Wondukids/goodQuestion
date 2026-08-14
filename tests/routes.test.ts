// 라우트 넷 — **봉투 · 오류 표 · 「라우트에 규칙이 없다」** (이슈 #26 화면-2·4).
//
// 여기서는 **서비스를 가짜로 바꾼다.** DB 도 LLM 도 안 붙는다.
// 진짜 DB 로 한 턴이 도는지는 `tests/routes.db.test.ts` 가 잰다 — 두 파일이 갈린 이유는
// `vi.mock` 이 파일 단위이기 때문이다. 한 파일에서 같은 모듈을 가짜와 진짜로 동시에 쓸 수 없다.
//
// ## ⭐ 이 파일이 재는 셋
//
// 1. **봉투** — `{ api_version, data, meta? }` / `{ api_version, error }`.
//    ⛔ 실패에 `data` 가 함께 실리지 않는다. `meta` 는 LLM 을 부른 호출에만 실린다.
// 2. **오류 표** — 계약 8절의 코드·HTTP·`retryable` 로 옮겨졌나.
//    ⚠️ 상속 관계 셋(`AnalysisResponseError ⊂ ValueError` 등)이 **좁은 쪽으로** 갈리나.
// 3. **라우트에 규칙이 없다** — 요청을 그대로 넘기고 답을 그대로 싣는다.
//    칸 하나라도 라우트가 만들어 내면 화면이 부르는 길과 갈리기 시작한다.

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { WEB_ROOT } from '@/llm/config'

// 서비스 함수 넷만 가짜로 바꾼다. **예외 클래스는 진짜를 그대로 흘린다** —
// 봉투가 그것을 `instanceof` 로 알아보기 때문이다 (`app/api/_lib/envelope.ts` 머리말).
vi.mock('@/llm/service/step', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/llm/service/step')>()
  return {
    ...real,
    analysisStep: vi.fn(),
    decisionStep: vi.fn(),
    dialogueStep: vi.fn(),
    sceneView: vi.fn(),
  }
})

import { POST as 분석 } from '@/app/api/v1/analysis/route'
import { POST as 판단 } from '@/app/api/v1/decision/route'
import { POST as 대사 } from '@/app/api/v1/dialogue/route'
import { GET as 장면 } from '@/app/api/v1/stories/[story_code]/scenes/[scene_code]/route'
import {
  AnalysisResponseError,
  analysisStep,
  decisionStep,
  dialogueStep,
  LLMError,
  LookupError,
  MessageNotFound,
  sceneView,
  SceneNotFound,
  TurnFailed,
  TurnInProgress,
  TurnNotAllowed,
  ValueError,
} from '@/llm/service/step'

const 가짜 = {
  분석: analysisStep as unknown as Mock,
  판단: decisionStep as unknown as Mock,
  대사: dialogueStep as unknown as Mock,
  장면: sceneView as unknown as Mock,
}

beforeEach(() => {
  for (const 하나 of Object.values(가짜)) 하나.mockReset()
})

// ── 부르는 법 ─────────────────────────────────────────────────────────────

const 세션 = '11111111-1111-4111-8111-111111111111'
const 메시지 = '22222222-2222-4222-8222-222222222222'

function 요청(경로: string, 본문: unknown): Request {
  return new Request(`http://검사${경로}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof 본문 === 'string' ? 본문 : JSON.stringify(본문),
  })
}

async function 봉투(응답: Response): Promise<Record<string, unknown>> {
  return (await 응답.json()) as Record<string, unknown>
}

/** ④ 는 동적 구간이라 `params` 가 **프라미스**다 (Next 16 · `route.md` v15.0.0-RC). */
function 장면_부르기(story_code: string, scene_code: string): Promise<Response> {
  return 장면(new Request('http://검사/api/v1/stories/x/scenes/y'), {
    params: Promise.resolve({ story_code, scene_code }),
  })
}

// 계약 3~6절의 응답 모양을 그대로 옮겨 둔 것. **라우트가 이것을 손대지 않아야 한다.**
const 분석_답 = {
  data: {
    message_id: 메시지,
    turn_order: 2,
    analysis: {
      child_intent: 'OPINION',
      main_point: '며느리가 창피했을 것 같아',
      detected_elements: [{ type: 'EMPATHY', evidence: '창피했을' }],
      utterance_validity: 'VALID',
    },
    detected_elements_kept: ['EMPATHY'],
    dropped: [],
  },
  meta: { provider: 'gemini', model: 'gemini-3.5-flash-lite', elapsed_ms: 412 },
}

const 판단_답 = {
  data: {
    decision: {
      response_mode: 'NORMAL',
      guidance_target: 'PERSPECTIVE',
      soft_cue: true,
      reaction_key: 'directResponse',
      scene_goal_met: false,
      scene_end_reason: null,
    },
    missing_elements: ['PERSPECTIVE', 'REASON', 'SOLUTION'],
    session: {
      current_child_turn_count: 1,
      accumulated_elements: ['EMPATHY'],
      last_detected_elements: ['EMPATHY'],
      last_response_mode: 'NORMAL',
      last_guidance_target: 'PERSPECTIVE',
      turns_without_new_element: 0,
      consecutive_low_information_turns: 0,
      scene_goal_met: false,
      scene_end_reason: null,
    },
  },
  meta: null,
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. 봉투
// ═══════════════════════════════════════════════════════════════════════════

describe('봉투', () => {
  it('성공은 { api_version, data, meta } 다 — LLM 을 부른 호출에만 meta 가 실린다', async () => {
    가짜.분석.mockResolvedValue(분석_답)
    const 응답 = await 분석(요청('/api/v1/analysis', { session_id: 세션, child_utterance: '음' }))

    expect(응답.status).toBe(200)
    const 몸 = await 봉투(응답)
    expect(Object.keys(몸).sort()).toEqual(['api_version', 'data', 'meta'])
    expect(몸.api_version).toBe('v1')
    expect(몸.data).toEqual(분석_답.data)
    expect(몸.meta).toEqual(분석_답.meta)
  })

  it('② 는 LLM 을 안 부르므로 meta 칸 자체가 없다 (계약 4절)', async () => {
    가짜.판단.mockResolvedValue(판단_답)
    const 응답 = await 판단(
      요청('/api/v1/decision', {
        session_id: 세션,
        message_id: 메시지,
        analysis: { child_intent: 'OPINION', detected_elements: ['EMPATHY'], utterance_validity: 'VALID' },
      }),
    )

    const 몸 = await 봉투(응답)
    expect(Object.keys(몸).sort()).toEqual(['api_version', 'data'])
    expect('meta' in 몸).toBe(false)
  })

  it('④ 도 meta 가 없다 — 콘텐츠 조회다', async () => {
    가짜.장면.mockResolvedValue({
      data: {
        code: 'sc_banggui_03',
        scene_order: 3,
        scene_type: 'dialogue',
        scene_description: null,
        character_name: '방귀쟁이 며느리',
        character_opening: 'ㅇㅇ아…',
      },
      meta: null,
    })
    const 몸 = await 봉투(await 장면_부르기('fart-bride', 'sc_banggui_03'))
    expect(Object.keys(몸).sort()).toEqual(['api_version', 'data'])
  })

  it('⛔ 실패에는 data 를 같이 싣지 않는다 — 반쯤 성공한 모양을 만들지 않는다', async () => {
    가짜.분석.mockRejectedValue(new LookupError('세션이 없다: x'))
    const 응답 = await 분석(요청('/api/v1/analysis', { session_id: 세션, child_utterance: '음' }))

    const 몸 = await 봉투(응답)
    expect(Object.keys(몸).sort()).toEqual(['api_version', 'error'])
    expect('data' in 몸).toBe(false)
    expect(몸.error).toEqual({
      code: 'SESSION_NOT_FOUND',
      message: '세션이 없다: x',
      retryable: false,
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. 오류 표 (계약 8절)
// ═══════════════════════════════════════════════════════════════════════════

describe('오류 표 — 서비스가 던진 것을 계약의 코드로 옮긴다', () => {
  const 표: [string, Error, number, string, boolean][] = [
    // ⚠️ 좁은 쪽이 먼저다. `AnalysisResponseError` 는 `ValueError` 를 물려받는데
    //    422 로 가야 한다 — 400 으로 새면 화면이 「내가 잘못 보냈다」로 읽는다.
    ['분석 LLM 이 규격 밖', new AnalysisResponseError('필드가 더 왔다'), 422, 'SCHEMA_INVALID', false],
    ['공급자가 전부 실패', new LLMError('다 죽었다', []), 502, 'LLM_UNAVAILABLE', true],
    [
      '턴이 LLM 실패로 끊겼다 (TurnFailed ⊂ LLMError)',
      new TurnFailed(new Error('타임아웃'), { child_message_id: 메시지, stage: 'analysis' }),
      502,
      'LLM_UNAVAILABLE',
      true,
    ],
    ['아직 끝나지 않은 호출', new TurnInProgress('도는 중'), 409, 'TURN_IN_PROGRESS', true],
    ['부를 차례가 아니다', new TurnNotAllowed('전개 장면이다'), 409, 'TURN_NOT_ALLOWED', false],
    ['그 세션 메시지가 아니다', new MessageNotFound('없다'), 404, 'MESSAGE_NOT_FOUND', false],
    // ⚠️ `SceneNotFound ⊂ LookupError` — 씬과 세션이 갈려야 화면이 다르게 그린다.
    ['씬이 없다', new SceneNotFound('없는 장면'), 404, 'SCENE_NOT_FOUND', false],
    ['세션이 없다', new LookupError('세션이 없다'), 404, 'SESSION_NOT_FOUND', false],
    ['인자가 틀렸다', new ValueError('아이 발화가 비어 있다'), 400, 'BAD_REQUEST', false],
    ['그 밖', new Error('연결이 끊겼다'), 500, 'INTERNAL', false],
  ]

  for (const [이름, 오류, status, code, retryable] of 표) {
    it(`${이름} → ${status} ${code}`, async () => {
      가짜.분석.mockRejectedValue(오류)
      const 응답 = await 분석(요청('/api/v1/analysis', { session_id: 세션, child_utterance: '음' }))

      expect(응답.status).toBe(status)
      const 몸 = await 봉투(응답)
      expect(몸.error).toEqual({ code, message: 오류.message, retryable })
    })
  }

  it('네 라우트가 같은 표를 쓴다 — 한 자리에서만 옮긴다', async () => {
    const 오류 = new TurnNotAllowed('전개 장면이다')
    가짜.판단.mockRejectedValue(오류)
    가짜.대사.mockRejectedValue(오류)
    가짜.장면.mockRejectedValue(new SceneNotFound('없다'))

    const 판단_응답 = await 판단(
      요청('/api/v1/decision', {
        session_id: 세션,
        message_id: 메시지,
        analysis: { child_intent: 'OPINION', detected_elements: [], utterance_validity: 'VALID' },
      }),
    )
    const 대사_응답 = await 대사(
      요청('/api/v1/dialogue', {
        session_id: 세션,
        message_id: 메시지,
        response_mode: 'NORMAL',
        reaction_key: 'directResponse',
        guidance_target: null,
        main_point: null,
      }),
    )
    const 장면_응답 = await 장면_부르기('s_x', 'sc_x')

    expect(판단_응답.status).toBe(409)
    expect(대사_응답.status).toBe(409)
    expect(장면_응답.status).toBe(404)
    expect((await 봉투(장면_응답)).error).toMatchObject({ code: 'SCENE_NOT_FOUND' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. zod — 요청이 틀리면 400 이고 **서비스를 부르지 않는다**
// ═══════════════════════════════════════════════════════════════════════════

describe('zod — 400 BAD_REQUEST', () => {
  it('깨진 JSON 은 500 이 아니라 400 이다', async () => {
    const 응답 = await 분석(요청('/api/v1/analysis', '{ 이건 JSON 이'))
    expect(응답.status).toBe(400)
    expect((await 봉투(응답)).error).toMatchObject({ code: 'BAD_REQUEST', retryable: false })
    expect(가짜.분석).not.toHaveBeenCalled()
  })

  const 나쁜_요청: [string, unknown][] = [
    ['session_id 가 없다', { child_utterance: '음' }],
    ['session_id 가 uuid 가 아니다', { session_id: 'abc', child_utterance: '음' }],
    ['발화 칸이 없다', { session_id: 세션 }],
    ['발화가 공백뿐이다', { session_id: 세션, child_utterance: '   ' }],
    ['발화가 빈 문자열이다', { session_id: 세션, child_utterance: '' }],
    ['모르는 칸이 더 왔다', { session_id: 세션, child_utterance: '음', state: {} }],
  ]

  for (const [이름, 본문] of 나쁜_요청) {
    it(`① ${이름} → 400`, async () => {
      const 응답 = await 분석(요청('/api/v1/analysis', 본문))
      expect(응답.status).toBe(400)
      expect((await 봉투(응답)).error).toMatchObject({ code: 'BAD_REQUEST' })
      expect(가짜.분석).not.toHaveBeenCalled()
    })
  }

  it('③ 은 response_mode 셋만 받는다', async () => {
    const 응답 = await 대사(
      요청('/api/v1/dialogue', {
        session_id: 세션,
        message_id: 메시지,
        response_mode: 'ENDING',
        guidance_target: null,
        main_point: null,
      }),
    )
    expect(응답.status).toBe(400)
    expect(가짜.대사).not.toHaveBeenCalled()
  })

  it('② 는 child_intent·utterance_validity 를 닫지 않는다 (원문이 "등"으로 열어 뒀다)', async () => {
    가짜.판단.mockResolvedValue(판단_답)
    const 응답 = await 판단(
      요청('/api/v1/decision', {
        session_id: 세션,
        message_id: 메시지,
        analysis: {
          child_intent: '아직_아무도_모르는_의도',
          detected_elements: ['EMPATHY'],
          utterance_validity: '아직_아무도_모르는_유효성',
        },
      }),
    )
    expect(응답.status).toBe(200)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. ⭐ 라우트에 규칙이 없다
// ═══════════════════════════════════════════════════════════════════════════

describe('라우트는 셋만 한다 — 읽고 · 부르고 · 씌우고', () => {
  it('① 요청을 **그대로** 넘긴다 — 발화를 다듬지 않는다 (STT 원문)', async () => {
    가짜.분석.mockResolvedValue(분석_답)
    await 분석(요청('/api/v1/analysis', { session_id: 세션, child_utterance: '  며느리가 불쌍해  ' }))

    expect(가짜.분석).toHaveBeenCalledExactlyOnceWith({
      session_id: 세션,
      // 앞뒤 공백이 살아 있다. `trim()` 하면 저장되는 문장이 요청과 달라진다.
      child_utterance: '  며느리가 불쌍해  ',
    })
  })

  it('② 메아리를 손대지 않는다 — 받은 analysis 가 그대로 간다', async () => {
    가짜.판단.mockResolvedValue(판단_답)
    const 보낸것 = {
      session_id: 세션,
      message_id: 메시지,
      analysis: {
        child_intent: 'OPINION',
        detected_elements: ['EMPATHY', 'REASON'],
        utterance_validity: 'VALID',
      },
    }
    await 판단(요청('/api/v1/decision', 보낸것))
    expect(가짜.판단).toHaveBeenCalledExactlyOnceWith(보낸것)
  })

  it('③ reaction_key 의 기본값은 "" 이고 그 밖은 그대로 간다', async () => {
    가짜.대사.mockResolvedValue({
      data: { message_id: '3', turn_order: 3, text: '그러게 말이다', source: 'generated' },
      meta: { provider: 'gemini', model: 'm', elapsed_ms: 1 },
    })
    await 대사(
      요청('/api/v1/dialogue', {
        session_id: 세션,
        message_id: 메시지,
        response_mode: 'GUIDED',
        guidance_target: 'SOLUTION',
        main_point: '창피했을 것 같아',
      }),
    )
    expect(가짜.대사).toHaveBeenCalledExactlyOnceWith({
      session_id: 세션,
      message_id: 메시지,
      response_mode: 'GUIDED',
      reaction_key: '',
      guidance_target: 'SOLUTION',
      main_point: '창피했을 것 같아',
    })
  })

  it('④ params 프라미스를 풀어 그대로 넘긴다', async () => {
    가짜.장면.mockResolvedValue({ data: { code: 'sc_banggui_03' }, meta: null })
    await 장면_부르기('fart-bride', 'sc_banggui_03')
    expect(가짜.장면).toHaveBeenCalledExactlyOnceWith({
      story_code: 'fart-bride',
      scene_code: 'sc_banggui_03',
    })
  })

  it('응답 data 에 라우트가 칸을 더하지 않는다 — 서비스가 준 것과 **똑같다**', async () => {
    가짜.분석.mockResolvedValue(분석_답)
    가짜.판단.mockResolvedValue(판단_답)

    const 분석_몸 = await 봉투(
      await 분석(요청('/api/v1/analysis', { session_id: 세션, child_utterance: '음' })),
    )
    const 판단_몸 = await 봉투(
      await 판단(
        요청('/api/v1/decision', {
          session_id: 세션,
          message_id: 메시지,
          analysis: { child_intent: 'OPINION', detected_elements: [], utterance_validity: 'VALID' },
        }),
      ),
    )

    // `toEqual` 이라 칸이 하나라도 늘거나 줄면 빨개진다.
    expect(분석_몸.data).toEqual(분석_답.data)
    expect(판단_몸.data).toEqual(판단_답.data)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. 층 경계 — 라우트 파일이 무엇을 import 하나 (`코드구조.md` 4절)
// ═══════════════════════════════════════════════════════════════════════════

describe('라우트 파일은 service 만 부른다', () => {
  const 라우트들 = [
    'app/api/v1/analysis/route.ts',
    'app/api/v1/decision/route.ts',
    'app/api/v1/dialogue/route.ts',
    'app/api/v1/stories/[story_code]/scenes/[scene_code]/route.ts',
  ]

  for (const 상대경로 of 라우트들) {
    it(`${상대경로} — repo · llm · domain · engine 을 직접 부르지 않는다`, () => {
      const 본문 = readFileSync(path.join(WEB_ROOT, 상대경로), 'utf8')
      const 가져온것 = [...본문.matchAll(/from\s+'([^']+)'/g)].map((하나) => 하나[1])

      expect(가져온것).not.toContain('@/llm/repo/db')
      for (const 하나 of 가져온것) {
        expect(하나.startsWith('@/llm/repo')).toBe(false)
        expect(하나.startsWith('@/llm/provider')).toBe(false)
        expect(하나.startsWith('@/llm/domain')).toBe(false)
        expect(하나.startsWith('@/llm/engine')).toBe(false)
        expect(하나.startsWith('@/db')).toBe(false)
      }
      // 판정을 부르는 흔적이 없다. `decide()` 는 서비스 아래 하나뿐이다.
      // ⚠️ 주석은 뺀다 — 머리말이 「여기서 `decide()` 를 부르지 않는다」라고 적고 있다.
      const 코드만 = 본문
        .split('\n')
        .filter((줄) => !/^\s*(\/\/|\*|\/\*)/.test(줄))
        .join('\n')
      expect(코드만).not.toMatch(/\bdecide\s*\(/)
      expect(코드만).not.toMatch(/\bnextStep\s*\(/)
    })
  }
})
