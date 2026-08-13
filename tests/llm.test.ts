// 공급자 이중화·fallback 조건·본문 모양을 잰다.
// 파이썬 `tests/test_llm.py` 618줄이 잡던 자리를 옮겼다.
//
// ⛔ 진짜 공급자는 하나도 안 부른다. F-1 그물이 막고 있고, 여기서는 `installFakeSdk` 로
//    가짜를 꽂아 **SDK 가 실제로 받는 본문**을 들여다본다.

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { loadSettings, 고를_수_있는_강도, type Settings } from '@/lib/config'
import { buildChain, complete, geminiRequest, LLMError, _생각수준 } from '@/lib/llm'

import { installFakeSdk } from './support/sdk-gate'

/** 검사용 설정. **`loadSettings` 를 거친다** — 직접 만드는 길을 남기지 않는다. */
function 설정(덮어쓰기: Partial<Settings> = {}): Settings {
  return loadSettings({
    gemini_api_keys: ['키1', '키2', '키3'],
    anthropic_api_key: null,
    openai_api_key: '오픈키',
    gemini_model: 'gemini-3.5-flash-lite',
    anthropic_model: 'claude-sonnet-5',
    openai_model: 'gpt-5-nano',
    gemini_effort: 'medium',
    anthropic_effort: 'medium',
    openai_effort: 'none',
    llm_timeout_seconds: 30,
    llm_rpm: 0,
    ...덮어쓰기,
  })
}

/** 제미나이 SDK 를 가짜로 꽂는다. 부를 때마다 `대답` 을 차례로 낸다. */
function 가짜_제미나이(대답들: (string | Error)[]): { 받은_본문: Record<string, unknown>[] } {
  const 받은_본문: Record<string, unknown>[] = []
  let 차례 = 0
  installFakeSdk('gemini', () => ({
    interactions: {
      create: async (본문: Record<string, unknown>) => {
        받은_본문.push(본문)
        const 대답 = 대답들[Math.min(차례, 대답들.length - 1)]
        차례 += 1
        if (대답 instanceof Error) throw 대답
        return { output_text: 대답, usage: { prompt_token_count: 11, candidates_token_count: 22 } }
      },
    },
  }))
  return { 받은_본문 }
}

describe('체인 만들기', () => {
  it('키 셋이면 제미나이 3단. 앤트로픽 키가 없으면 그 칸을 안 만든다', () => {
    const 단계들 = buildChain(설정())
    expect(단계들.map((칸) => 칸.label)).toEqual(['gemini(key=1)', 'gemini(key=2)', 'gemini(key=3)'])
  })

  it('앤트로픽 키가 있으면 맨 뒤에 붙는다', () => {
    const 단계들 = buildChain(설정({ anthropic_api_key: '앤트로픽키' }))
    expect(단계들.map((칸) => 칸.label)).toEqual([
      'gemini(key=1)',
      'gemini(key=2)',
      'gemini(key=3)',
      'anthropic',
    ])
  })

  it('없는 키는 칸을 아예 안 만든다 — 빈 키로 부른 실패 시도가 기록에 남으면 안 된다', () => {
    const 단계들 = buildChain(설정({ gemini_api_keys: ['키1'] }))
    expect(단계들.map((칸) => 칸.label)).toEqual(['gemini(key=1)'])
  })

  it('키1 칸은 값이 비어 있어도 만든다 — 「키가 없다」를 조용한 성공으로 만들지 않는다', () => {
    const 단계들 = buildChain(설정({ gemini_api_keys: [] }))
    expect(단계들.map((칸) => 칸.label)).toEqual(['gemini(key=1)'])
  })

  it('preferred 키만 앞으로 오고 나머지는 번호 순서 그대로 뒤에 붙는다', () => {
    const 단계들 = buildChain(설정(), { preferred_gemini_key: 3 })
    expect(단계들.map((칸) => 칸.label)).toEqual(['gemini(key=3)', 'gemini(key=1)', 'gemini(key=2)'])
  })

  it('없는 키를 preferred 로 고르면 거절한다', () => {
    expect(() => buildChain(설정({ gemini_api_keys: ['키1'] }), { preferred_gemini_key: 2 })).toThrow(
      /GQ_GEMINI_API_KEY_2 가 없어서/,
    )
    expect(() => buildChain(설정(), { preferred_gemini_key: 9 })).toThrow(/1 · 2 · 3 중 하나/)
  })

  it('⛔ openai 줄은 혼자 선다 — fallback 이 없다', () => {
    const 단계들 = buildChain(설정({ anthropic_api_key: '앤트로픽키' }), { line: 'openai' })
    expect(단계들.map((칸) => 칸.label)).toEqual(['openai'])
    expect(단계들[0].model).toBe('gpt-5-nano')
    expect(단계들[0].effort).toBe('none')
  })
})

describe('제미나이 본문 모양', () => {
  it('생각 수준은 generation_config 안에 들어간다 — 최상위로 보내면 죽는다', () => {
    const 본문 = geminiRequest(설정({ gemini_effort: 'low' }), 'sys', 'usr', null)
    expect(본문.generation_config).toEqual({ thinking_level: 'low' })
    expect(본문.model).toBe('gemini-3.5-flash-lite')
    expect(본문.input).toBe('usr')
    expect(본문.system_instruction).toBe('sys')
  })

  it('⛔ 모르는 강도면 아무것도 안 보낸다 — 멋대로 골라 비용을 바꾸지 않는다', () => {
    const 본문 = geminiRequest(설정({ gemini_effort: '엄청세게' }), 'sys', 'usr', null)
    expect(본문).not.toHaveProperty('generation_config')
  })

  it('스키마를 주면 response_format 이 붙는다', () => {
    const 스키마 = { type: 'object' }
    const 본문 = geminiRequest(설정(), 'sys', 'usr', 스키마)
    expect(본문.response_format).toEqual({
      type: 'text',
      mime_type: 'application/json',
      schema: 스키마,
    })
  })

  it('고를 수 있는 강도 목록이 제미나이가 아는 이름과 같다', () => {
    // 어긋나면 화면에서 고른 강도가 조용히 안 실린다. 파이썬 test_llm.py 가 잡던 자리다.
    expect([...고를_수_있는_강도]).toEqual([..._생각수준])
  })
})

describe('complete — 성공 경로', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  it('첫 칸이 성공하면 그대로 돌려주고 시도 하나가 기록된다', async () => {
    const { 받은_본문 } = 가짜_제미나이(['대답이다'])
    const 결과 = await complete('sys', 'usr', { settings: 설정(), purpose: '분석' })

    expect(결과.text).toBe('대답이다')
    expect(결과.provider).toBe('gemini')
    expect(결과.model).toBe('gemini-3.5-flash-lite')
    expect(받은_본문).toHaveLength(1)

    expect(결과.attempts).toHaveLength(1)
    const 시도 = 결과.attempts[0]
    expect(시도.ok).toBe(true)
    expect(시도.purpose).toBe('분석')
    expect(시도.input_tokens).toBe(11)
    expect(시도.output_tokens).toBe(22)
    expect(시도.error).toBeNull()
    // 칸 이름이 `llm_calls` 컬럼과 같다 — 옮겨 담는 자리를 만들지 않았다.
    expect(시도.system_text).toBe('sys')
    expect(시도.user_text).toBe('usr')
    expect(시도.response_text).toBe('대답이다')
  })
})

describe('complete — fallback', () => {
  let 찍힌줄: string[]

  beforeEach(() => {
    찍힌줄 = []
    vi.spyOn(console, 'log').mockImplementation((...조각) => {
      찍힌줄.push(조각.join(' '))
    })
  })

  it('첫 키가 죽으면 다음 키로 넘어가고 시도가 둘 다 남는다', async () => {
    가짜_제미나이([new Error('한도 초과'), '두번째가 대답'])
    const 결과 = await complete('sys', 'usr', { settings: 설정(), purpose: '분석' })

    expect(결과.text).toBe('두번째가 대답')
    expect(결과.attempts).toHaveLength(2)
    expect(결과.attempts[0].ok).toBe(false)
    expect(결과.attempts[0].error).toMatch(/한도 초과/)
    expect(결과.attempts[1].ok).toBe(true)
  })

  it('같은 공급자는 「재시도」, 다른 회사는 「fallback」으로 찍는다', async () => {
    가짜_제미나이([new Error('죽음'), '살았다'])
    await complete('sys', 'usr', { settings: 설정() })

    const 넘어간줄 = 찍힌줄.find((줄) => 줄.includes('실패 →'))
    expect(넘어간줄).toMatch(/gemini\(key=1\) 실패 → gemini\(key=2\) 재시도/)
    // ⛔ 조용한 fallback 은 버그를 숨긴다 — 사유가 반드시 줄에 있어야 한다.
    expect(넘어간줄).toMatch(/죽음/)
  })

  it('fallback 으로 성공하면 성공 줄에 (fallback) 이 붙는다', async () => {
    가짜_제미나이([new Error('죽음'), '살았다'])
    await complete('sys', 'usr', { settings: 설정() })
    expect(찍힌줄.find((줄) => 줄.includes('provider='))).toMatch(/\(fallback\)/)
  })

  it('공급자 전환을 알림으로도 흘린다', async () => {
    가짜_제미나이([new Error('죽음'), '살았다'])
    const 알림 = vi.fn()
    await complete('sys', 'usr', { settings: 설정(), notify: 알림 })
    expect(알림).toHaveBeenCalledWith('공급자 전환', expect.stringMatching(/죽음/))
  })

  it('전부 죽으면 LLMError 이고 시도 전부가 딸려 온다', async () => {
    가짜_제미나이([new Error('다죽음')])
    const 설정값 = 설정()

    await expect(complete('sys', 'usr', { settings: 설정값 })).rejects.toThrow(LLMError)

    try {
      await complete('sys', 'usr', { settings: 설정값 })
      expect.unreachable('던졌어야 한다')
    } catch (오류) {
      expect(오류).toBeInstanceOf(LLMError)
      const 시도들 = (오류 as LLMError).attempts
      expect(시도들).toHaveLength(3) // 키 셋을 다 밟았다
      expect(시도들.every((시도) => !시도.ok)).toBe(true)
      expect((오류 as LLMError).message).toMatch(
        /gemini\(key=1\) → gemini\(key=2\) → gemini\(key=3\)/,
      )
    }
  })
})
