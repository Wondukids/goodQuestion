// 그물이 정말 무는지 잰다. **이 검사가 빨간 것을 한 번은 봐야 한다** —
// 그물이 조용히 죽어 있으면 나머지 검사가 전부 거짓으로 통과한다.

import { describe, expect, it } from 'vitest'

import { __testing as rateLimit, waitForRateLimit } from '@/lib/llm/rate-limit'

import { activeFakes, installFakeSdk } from './support/sdk-gate'

describe('F-1 진짜 LLM 금지', () => {
  it('제미나이 클라이언트를 만들면 그 자리에서 터진다', async () => {
    const { GoogleGenAI } = await import('@google/genai')
    expect(() => new GoogleGenAI({ apiKey: 'x' })).toThrow(/진짜 LLM 공급자에 붙으려 했다/)
  })

  it('Anthropic 클라이언트를 만들면 터진다 — default 와 이름 붙은 export 둘 다', async () => {
    const mod = await import('@anthropic-ai/sdk')
    expect(() => new mod.default({ apiKey: 'x' })).toThrow(/Anthropic/)
    expect(() => new mod.Anthropic({ apiKey: 'x' })).toThrow(/Anthropic/)
  })

  it('OpenAI 클라이언트를 만들면 터진다 — gpt-5-nano 도 같은 그물에 걸린다', async () => {
    const mod = await import('openai')
    expect(() => new mod.default({ apiKey: 'x' })).toThrow(/OpenAI/)
    expect(() => new mod.OpenAI({ apiKey: 'x' })).toThrow(/OpenAI/)
  })

  it('SDK 가 받는 본문만 보는 검사는 오탐으로 잡히지 않는다', async () => {
    // 파이썬에서 한 겹 위에 그물을 쳤다가 이런 검사를 잡았다. 그 자리를 지킨다.
    const 받은것: unknown[] = []
    installFakeSdk('gemini', (...args) => {
      받은것.push(args[0])
      return { models: { generateContent: async () => ({ text: '가짜 대사' }) } }
    })

    const { GoogleGenAI } = await import('@google/genai')
    // 진짜 SDK 의 타입과 겹치지 않으므로 `unknown` 을 거친다. 가짜라서 당연하다.
    const client = new GoogleGenAI({ apiKey: '가짜' }) as unknown as {
      models: { generateContent: () => Promise<{ text: string }> }
    }

    expect(받은것).toEqual([{ apiKey: '가짜' }])
    expect((await client.models.generateContent()).text).toBe('가짜 대사')
  })

  it('꽂아 둔 가짜는 다음 검사로 새지 않는다', () => {
    // ⚠️ 바로 위 검사가 가짜를 꽂았다. 여기서 비어 있어야 격리가 성립한다.
    expect(activeFakes()).toEqual([])
  })
})

describe('F-2 분당 문지기', () => {
  it('기본으로 꺼져 있다 — 검사는 벽시계로 자지 않는다', async () => {
    const 시작 = performance.now()
    for (let i = 0; i < 50; i += 1) await waitForRateLimit(1, '검사 ')
    expect(performance.now() - 시작).toBeLessThan(1000)
  })

  it('창이 검사마다 비워진다', () => {
    // 위 검사가 문지기를 껐으므로 창에 아무것도 안 쌓였다. 켠 채로 새는 경우는
    // 아래 「켜면」 검사가 잡는다.
    expect(rateLimit.snapshot()).toEqual([])
  })

  it('켜면 미끄럼창으로 막는다 — 어느 60초를 떼어 봐도 rpm 이하', async () => {
    // 파이썬 `@pytest.mark.분당` 에 해당한다. 가짜 시계를 직접 끼운다.
    let 지금 = 0
    const 잔시간: number[] = []
    rateLimit.enable()
    rateLimit.setClock(() => 지금)
    rateLimit.setSleep(async (ms) => {
      잔시간.push(ms)
      지금 += ms
    })

    await waitForRateLimit(2, '재기 ') // 0ms
    await waitForRateLimit(2, '재기 ') // 0ms — 아직 창에 여유가 있다
    expect(잔시간).toEqual([])

    await waitForRateLimit(2, '재기 ') // 셋째는 첫 호출이 창에서 빠질 때까지 잔다
    expect(잔시간).toEqual([60_050])
    expect(지금).toBe(60_050)

    // 잔 뒤에는 첫 둘이 창 밖으로 나가 통과한다.
    expect(rateLimit.snapshot()).toEqual([60_050])
  })

  it('앞 검사가 켜 둔 문지기와 가짜 시계가 새지 않는다', async () => {
    const 시작 = performance.now()
    for (let i = 0; i < 50; i += 1) await waitForRateLimit(1)
    expect(performance.now() - 시작).toBeLessThan(1000)
    expect(rateLimit.snapshot()).toEqual([])
  })
})
