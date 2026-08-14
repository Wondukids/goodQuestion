// 캐릭터 LLM 층 (말-6) — ⛔ CLOSING 이면 **아예 안 부른다** (C-4).
//
// 「안 부른다」는 호출 **수를 세어** 잰다. 가짜를 꽂아 두고 0 이 나오는지 보는 것이라,
// F-1 그물(진짜 SDK 금지)과는 다른 것을 잰다.

import { describe, expect, it } from 'vitest'

import { loadSettings, type Settings } from '@/llm/config'
import { characterTurn, generateLine, type CharacterDirection } from '@/llm/engine/character'
import type { CharacterScene } from '@/llm/engine/material'

import { installFakeSdk } from './support/sdk-gate'

function 설정(덮어쓰기: Partial<Settings> = {}): Settings {
  return loadSettings({
    gemini_api_keys: ['키1'],
    anthropic_api_key: null,
    llm_rpm: 0,
    ...덮어쓰기,
  })
}

/** 제미나이 SDK 를 가짜로 꽂고 **몇 번 불렸는지** 센다. */
function 가짜_제미나이(대답: string): { 호출: Record<string, unknown>[] } {
  const 호출: Record<string, unknown>[] = []
  installFakeSdk('gemini', () => ({
    interactions: {
      create: async (본문: Record<string, unknown>) => {
        호출.push(본문)
        return { output_text: 대답, usage: {} }
      },
    },
  }))
  return { 호출 }
}

const 장면: CharacterScene & { character_closing: string | null } = {
  character_name: '며느리',
  persona: '갓 시집온 며느리',
  speech_style: '조심스러운 말투',
  guidance_style: '혼잣말로 걱정을 흘린다',
  forbidden: [],
  conflict: '참으면 아프고 뀌면 창피하다',
  scene_stance: '아이 편이다',
  remaining_worries: { SOLUTION: '그럼 난 어떻게 하면 좋을까…' },
  character_closing: '고마워, 네 말대로 해 볼게.',
}

const 기본 = {
  scene: 장면,
  child_utterance: '며느리가 창피했을 것 같아',
  main_point: '며느리가 부끄러웠을 것이다',
  precedingNarrations: [{ scene_description: '옛날 옛적에' }],
}

function 판정(덮어쓰기: Partial<CharacterDirection> = {}): CharacterDirection {
  return {
    response_mode: 'NORMAL',
    reaction_key: 'empathyFromChild',
    guidance_target: null,
    ...덮어쓰기,
  }
}

describe('⛔ CLOSING 이면 캐릭터 LLM 을 아예 부르지 않는다 (경계 4 · 결정 36)', () => {
  it('호출 수가 0 이고 `character_closing` 원문을 그대로 재생한다', async () => {
    const { 호출 } = 가짜_제미나이('불리면 안 되는 대사')

    const 결과 = await characterTurn({
      ...기본,
      decision: 판정({ response_mode: 'CLOSING', reaction_key: 'directResponse' }),
      settings: 설정(),
    })

    expect(호출).toHaveLength(0) // ← 이 줄이 C-4 다
    expect(결과.fixed_closing).toBe('고마워, 네 말대로 해 볼게.')
    expect(결과.line).toBeNull()
    expect(결과.llm).toBeNull()
  })

  it('고정 마무리를 **고치지 않는다** — 생성하는 값이 아니다', async () => {
    const 결과 = await characterTurn({
      ...기본,
      scene: { ...장면, character_closing: '  앞뒤에 공백이 있는 원문  ' },
      decision: 판정({ response_mode: 'CLOSING' }),
      settings: 설정(),
    })
    expect(결과.fixed_closing).toBe('  앞뒤에 공백이 있는 원문  ')
  })

  it.each(['NORMAL', 'GUIDED'])('%s 이면 부른다 (안 부르는 것이 CLOSING 뿐인지)', async (모드) => {
    const { 호출 } = 가짜_제미나이('참으면 아플 텐데…')

    const 결과 = await characterTurn({
      ...기본,
      decision: 판정({ response_mode: 모드, guidance_target: 모드 === 'GUIDED' ? 'SOLUTION' : null }),
      settings: 설정(),
    })

    expect(호출).toHaveLength(1)
    expect(결과.line).toBe('참으면 아플 텐데…')
    expect(결과.fixed_closing).toBeNull()
    expect(결과.llm?.provider).toBe('gemini')
  })
})

describe('캐릭터 부르기', () => {
  it('재료가 그대로 user 로 나가고 system 은 프롬프트의 영어 층이다', async () => {
    const { 호출 } = 가짜_제미나이('그러게…')
    await characterTurn({ ...기본, decision: 판정(), settings: 설정() })

    const 재료 = JSON.parse(호출[0].input as string)
    expect(재료.direction).toEqual({
      response_mode: 'NORMAL',
      reaction_key: 'empathyFromChild',
      remaining_worry: '',
    })
    expect(호출[0].system_instruction).not.toContain('한글 층')
  })

  it('⛔ JSON 스키마를 주지 않는다 — 문장을 그대로 받는다', async () => {
    const { 호출 } = 가짜_제미나이('그러게…')
    await characterTurn({ ...기본, decision: 판정(), settings: 설정() })
    expect(호출[0]).not.toHaveProperty('response_format')
  })

  it('앞뒤 공백만 턴다 — 자르지도 따옴표를 벗기지도 않는다', async () => {
    가짜_제미나이('  "며느리: 그러게…" (작게)  ')
    const { line } = await generateLine('재료', { settings: 설정() })
    expect(line).toBe('"며느리: 그러게…" (작게)')
  })

  it('준 본문이 있으면 그것을 system 으로 보낸다', async () => {
    const { 호출 } = 가짜_제미나이('그러게…')
    await generateLine('재료', { prompt: '실험용 캐릭터 본문', settings: 설정() })
    expect(호출[0].system_instruction).toBe('실험용 캐릭터 본문')
  })
})
