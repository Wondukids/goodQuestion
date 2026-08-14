// 분석 LLM 층 (말-5) — 네 칸뿐인 출력 · 스키마 거부 · 후처리.
//
// ⛔ 진짜 공급자는 하나도 안 부른다. `installFakeSdk` 로 가짜를 꽂아 **게이트웨이를 진짜로**
//    지나가게 한다 — 그래야 「스키마가 틀렸을 때 fallback 이 도나」(B-2)를 실제로 잴 수 있다.

import { describe, expect, it } from 'vitest'

import { loadSettings, type Settings } from '@/lib/config'
import {
  AnalysisPayloadSchema,
  AnalysisResponseError,
  analyze,
  parseResponse,
  postProcess,
  분석_스키마,
} from '@/lib/engine/analyze'

import { installFakeSdk } from './support/sdk-gate'

function 설정(덮어쓰기: Partial<Settings> = {}): Settings {
  return loadSettings({
    gemini_api_keys: ['키1', '키2', '키3'],
    anthropic_api_key: null,
    llm_rpm: 0,
    ...덮어쓰기,
  })
}

/** 제미나이 SDK 를 가짜로 꽂고 **몇 번 불렸는지** 센다. */
function 가짜_제미나이(대답들: (string | Error)[]): { 호출: Record<string, unknown>[] } {
  const 호출: Record<string, unknown>[] = []
  installFakeSdk('gemini', () => ({
    interactions: {
      create: async (본문: Record<string, unknown>) => {
        호출.push(본문)
        const 대답 = 대답들[Math.min(호출.length - 1, 대답들.length - 1)]
        if (대답 instanceof Error) throw 대답
        return { output_text: 대답, usage: { prompt_token_count: 1, candidates_token_count: 2 } }
      },
    },
  }))
  return { 호출 }
}

const 제대로 = JSON.stringify({
  child_intent: 'PERSPECTIVE',
  main_point: '며느리가 부끄러웠을 것이다',
  detected_elements: [{ type: 'EMPATHY', evidence: '창피했을 것 같아' }],
  utterance_validity: 'VALID',
})

describe('⛔ 출력은 네 칸뿐이다 (CLAUDE.md 경계 1)', () => {
  it('스키마에 있는 칸이 정확히 넷이다', () => {
    expect(Object.keys(AnalysisPayloadSchema.shape).sort()).toEqual([
      'child_intent',
      'detected_elements',
      'main_point',
      'utterance_validity',
    ])
  })

  it('LLM 에 나가는 JSON 스키마도 그 넷뿐이다', () => {
    const 속성 = 분석_스키마.properties as Record<string, unknown>
    expect(Object.keys(속성).sort()).toEqual([
      'child_intent',
      'detected_elements',
      'main_point',
      'utterance_validity',
    ])
    expect(분석_스키마.required).toEqual([
      'child_intent',
      'main_point',
      'detected_elements',
      'utterance_validity',
    ])
  })

  it.each(['response_mode', 'scene_goal_met', 'scene_end_reason'])(
    '`%s` 가 섞이면 **거부한다** — 조용히 무시하면 경계를 넘은 걸 아무도 모른다',
    (넘은_칸) => {
      const 넘은것 = JSON.stringify({ ...JSON.parse(제대로), [넘은_칸]: 'CLOSING' })
      expect(() => parseResponse(넘은것)).toThrow(AnalysisResponseError)
      expect(() => parseResponse(넘은것)).toThrow(new RegExp(넘은_칸))
    },
  )

  it('`detected_elements` 안쪽도 strict 다', () => {
    const 넘은것 = JSON.stringify({
      ...JSON.parse(제대로),
      detected_elements: [{ type: 'EMPATHY', evidence: '창피', confidence: 0.9 }],
    })
    expect(() => parseResponse(넘은것)).toThrow(AnalysisResponseError)
  })
})

describe('응답 읽기', () => {
  it('제대로 온 것을 읽는다', () => {
    const 읽은것 = parseResponse(제대로)
    expect(읽은것.child_intent).toBe('PERSPECTIVE')
    expect(읽은것.detected_elements).toEqual([{ type: 'EMPATHY', evidence: '창피했을 것 같아' }])
  })

  it('코드펜스를 벗긴다', () => {
    expect(parseResponse('```json\n' + 제대로 + '\n```').child_intent).toBe('PERSPECTIVE')
  })

  it('`main_point` 와 `evidence` 는 없어도 되고 null 이 된다', () => {
    const 읽은것 = parseResponse(
      JSON.stringify({
        child_intent: 'SHORT_RESPONSE',
        detected_elements: [{ type: 'EMPATHY' }],
        utterance_validity: 'SHORT',
      }),
    )
    expect(읽은것.main_point).toBeNull()
    expect(읽은것.detected_elements[0].evidence).toBeNull()
  })

  it('JSON 이 아니면 받은 것을 잘라서 보여 준다', () => {
    expect(() => parseResponse('미안, 못 하겠어')).toThrow(/JSON 이 아니다/)
  })

  it('`utterance_validity` 는 다섯 값으로 닫혀 있다', () => {
    expect(() =>
      parseResponse(JSON.stringify({ ...JSON.parse(제대로), utterance_validity: '몰라' })),
    ).toThrow(AnalysisResponseError)
  })

  it('⚠️ `child_intent` 는 닫지 않는다 — 데모 중에 저장이 멈추면 안 된다 (스펙확정 E)', () => {
    const 모르는것 = JSON.stringify({ ...JSON.parse(제대로), child_intent: 'NEW_THING' })
    expect(parseResponse(모르는것).child_intent).toBe('NEW_THING')
  })
})

describe('후처리 (결정 26)', () => {
  it('`evidence` 가 아이 말에 없으면 버린다', () => {
    const 결과 = postProcess(
      [
        { type: 'EMPATHY', evidence: '창피했을' },
        { type: 'REASON', evidence: '아이가 하지 않은 말' },
      ],
      '며느리가 창피했을 것 같아',
    )
    expect(결과).toEqual({ kept: ['EMPATHY'], dropped: ['REASON'] })
  })

  it('공백만 지우고 본다 — 아이 발화는 STT 라 띄어쓰기가 흔들린다', () => {
    const 결과 = postProcess(
      [{ type: 'REASON', evidence: '참으면 아프니까' }],
      '며느리가참으면아프니까그런거야',
    )
    expect(결과.kept).toEqual(['REASON'])
  })

  it('`type` 중복은 **먼저 나온 판정**을 남긴다', () => {
    const 결과 = postProcess(
      [
        { type: 'REASON', evidence: '없는 말' },
        { type: 'REASON', evidence: '아프니까' },
      ],
      '아프니까',
    )
    expect(결과).toEqual({ kept: [], dropped: ['REASON'] })
  })

  it('근거가 비었으면 버린다 — 살릴 근거가 없다', () => {
    expect(postProcess([{ type: 'SOLUTION', evidence: null }], '아무 말')).toEqual({
      kept: [],
      dropped: ['SOLUTION'],
    })
  })

  it('입력을 건드리지 않는다', () => {
    const 요소들 = [{ type: 'EMPATHY', evidence: '창피' }]
    postProcess(요소들, '창피')
    expect(요소들).toEqual([{ type: 'EMPATHY', evidence: '창피' }])
  })
})

describe('분석 부르기', () => {
  it('스키마를 실어 보내고 system 은 프롬프트의 **영어 층**만 간다', async () => {
    const { 호출 } = 가짜_제미나이([제대로])
    const 결과 = await analyze('재료 JSON', { settings: 설정() })

    expect(결과.analysis.child_intent).toBe('PERSPECTIVE')
    expect(결과.llm.provider).toBe('gemini')
    expect(호출).toHaveLength(1)
    expect(호출[0].input).toBe('재료 JSON')
    expect(호출[0].response_format).toMatchObject({ schema: 분석_스키마 })

    const system = 호출[0].system_instruction as string
    expect(system).not.toContain('한글 층') // 사람이 읽는 층은 한 글자도 안 간다
    expect(system).toContain('child_intent')
  })

  it('준 본문이 있으면 그것을 system 으로 보낸다 — 출처를 묻지 않는다', async () => {
    const { 호출 } = 가짜_제미나이([제대로])
    await analyze('재료', { prompt: '실험용 본문', settings: 설정() })
    expect(호출[0].system_instruction).toBe('실험용 본문')
  })

  it('⛔ B-2 — 스키마가 안 맞으면 **거부하고 fallback 으로 넘기지 않는다**', async () => {
    const { 호출 } = 가짜_제미나이([JSON.stringify({ child_intent: 'OPINION', response_mode: 'GUIDED' })])

    await expect(analyze('재료', { settings: 설정() })).rejects.toBeInstanceOf(AnalysisResponseError)
    // 키가 셋이고 앤트로픽 칸까지 있어도 **한 번만** 불렸다.
    expect(호출).toHaveLength(1)
  })

  it('⭕ 반대로 API 가 죽으면 다음 칸으로 넘어간다 (fallback 이 살아 있다는 확인)', async () => {
    const { 호출 } = 가짜_제미나이([new Error('503'), 제대로])
    const 결과 = await analyze('재료', { settings: 설정() })
    expect(호출).toHaveLength(2)
    expect(결과.analysis.utterance_validity).toBe('VALID')
  })
})
