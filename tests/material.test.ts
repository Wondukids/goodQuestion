// 재료 만들기 (말-4) — 여섯 조각 · `goal` 플래그 · 옛 낱개 자리표시자.
//
// ⛔ LLM 은 한 번도 안 부른다. 이 층은 글자만 만든다.
//
// ⭐ 정본 `prompts/*.md` 의 「받는 것」 블록이 `{analysis_material}` 한 줄이라
//    `buildAnalysisMaterial()` 이 돌려주는 글자가 **곧 재료 JSON** 이다.
//    그래서 아래 검사가 `JSON.parse()` 로 바로 뜯어본다 — 틀이 바뀌면 여기가 먼저 빨개진다.

import { describe, expect, it, vi } from 'vitest'

import {
  analysisGoalEnabled,
  buildAnalysisMaterial,
  buildCharacterMaterial,
  GOAL_ENV,
  type AnalysisScene,
  type CharacterScene,
} from '@/llm/engine/material'

const 분석_장면: AnalysisScene = {
  scene_description: '며느리가 밥상 앞에서 방귀를 참고 있다',
  conflict: '참으면 아프고 뀌면 창피하다',
  required_elements: ['PERSPECTIVE', 'EMPATHY', 'REASON', 'SOLUTION'],
  element_criteria: { EMPATHY: '며느리 마음을 헤아린 말이 있어야 한다' },
  scene_goal: '아이가 며느리 입장에서 생각해 본다',
}

const 캐릭터_장면: CharacterScene = {
  character_name: '며느리',
  persona: '갓 시집온 며느리',
  speech_style: '조심스러운 말투',
  guidance_style: '혼잣말로 걱정을 흘린다',
  forbidden: ['아이에게 답을 알려주기'],
  conflict: '참으면 아프고 뀌면 창피하다',
  scene_stance: '아이 편이다',
  remaining_worries: { SOLUTION: '그럼 난 어떻게 하면 좋을까…' },
}

describe('분석 재료 — 여섯 조각', () => {
  it('콘텐츠 넷 + 세션 둘. 그 밖의 값은 안 실린다', () => {
    const 재료 = JSON.parse(
      buildAnalysisMaterial({
        scene: 분석_장면,
        child_utterance: '며느리가 창피했을 것 같아',
        previous_character_message: '어쩌면 좋을까…',
        include_goal: false,
      }),
    )

    expect(Object.keys(재료)).toEqual([
      'scene',
      'previous_character_message',
      'child_utterance',
      'target_elements',
      'element_criteria',
    ])
    expect(재료.scene).toEqual({
      description: 분석_장면.scene_description,
      conflict: 분석_장면.conflict,
    })
    expect(재료.child_utterance).toBe('며느리가 창피했을 것 같아')
    expect(재료.target_elements).toEqual(['PERSPECTIVE', 'EMPATHY', 'REASON', 'SOLUTION'])

    // ⛔ 답을 미리 알려주는 값은 안 넣는다 (`docs/기준/대화작동규칙.md:81`)
    for (const 없어야 of [
      'story_title',
      'character_name',
      'accumulated_elements',
      'current_child_turn_count',
      'scene_goal',
    ]) {
      expect(재료).not.toHaveProperty(없어야)
    }
  })

  it('대화 장면은 설명이 비어 있어 **직전 전개 장면 하나**로 메운다 (결정 25)', () => {
    const 재료 = JSON.parse(
      buildAnalysisMaterial({
        scene: { ...분석_장면, scene_description: null },
        precedingNarrations: [
          { scene_description: '첫째 전개' },
          { scene_description: '바로 앞 전개' },
        ],
        child_utterance: '응',
        include_goal: false,
      }),
    )
    expect(재료.scene.description).toBe('바로 앞 전개')
  })

  it('앞선 전개가 없으면 빈칸이다 — 지어내지 않는다', () => {
    const 재료 = JSON.parse(
      buildAnalysisMaterial({
        scene: { ...분석_장면, scene_description: null },
        child_utterance: '응',
        include_goal: false,
      }),
    )
    expect(재료.scene.description).toBe('')
    expect(재료.previous_character_message).toBe('')
  })

  it('JSON 은 한 자리에서만 만든다 — 들여쓰기도 `\\uXXXX` 도 없다', () => {
    const 글자 = buildAnalysisMaterial({
      scene: 분석_장면,
      child_utterance: '며느리가 창피했을 것 같아',
      include_goal: false,
    })
    expect(글자).toContain('며느리가 창피했을 것 같아') // 한글이 그대로 나간다
    expect(글자).not.toContain('\\u')
    expect(글자).not.toContain('\n')
    expect(글자.startsWith('{"scene":{"description":')).toBe(true)
  })
})

describe('🔴 `goal` 플래그', () => {
  it('기본은 켬 — 일곱째로 `goal` 이 붙는다', () => {
    const 재료 = JSON.parse(
      buildAnalysisMaterial({ scene: 분석_장면, child_utterance: '응' }),
    )
    expect(재료.goal).toBe('아이가 며느리 입장에서 생각해 본다')
    expect(Object.keys(재료).at(-1)).toBe('goal')
  })

  it('끈 것과 켠 것이 **맨 뒤 한 조각만** 다르다 — 파이썬과의 대조(B-3)가 여기 걸려 있다', () => {
    const 인자 = { scene: 분석_장면, child_utterance: '응' } as const
    const 끔 = buildAnalysisMaterial({ ...인자, include_goal: false })
    const 켬 = buildAnalysisMaterial({ ...인자, include_goal: true })

    expect(끔).not.toContain('goal')
    // 켠 글자에서 마지막 조각만 떼면 끈 글자와 한 바이트도 다르지 않다.
    expect(켬).toBe(`${끔.slice(0, -1)},"goal":"아이가 며느리 입장에서 생각해 본다"}`)
  })

  it('환경변수 하나로 껐다 켠다 — 기본 켬', () => {
    expect(analysisGoalEnabled()).toBe(true)

    for (const 끄는_값 of ['0', 'false', 'off', 'no', 'FALSE']) {
      vi.stubEnv(GOAL_ENV, 끄는_값)
      expect(analysisGoalEnabled()).toBe(false)
      expect(JSON.parse(buildAnalysisMaterial({ scene: 분석_장면, child_utterance: '응' }))).not.toHaveProperty(
        'goal',
      )
    }

    vi.stubEnv(GOAL_ENV, '1')
    expect(analysisGoalEnabled()).toBe(true)
    vi.unstubAllEnvs()
  })

  it('장면에 목표가 없으면 빈칸으로 실린다 (`fill()` 이 터지지 않게)', () => {
    const 재료 = JSON.parse(
      buildAnalysisMaterial({
        scene: { ...분석_장면, scene_goal: null },
        child_utterance: '응',
        include_goal: true,
      }),
    )
    expect(재료.goal).toBe('')
  })
})

describe('캐릭터 재료', () => {
  const 기본 = {
    scene: 캐릭터_장면,
    precedingNarrations: [{ scene_description: '옛날 옛적에' }],
    child_utterance: '며느리가 창피했을 것 같아',
    main_point: '며느리가 부끄러웠을 것이다',
    response_mode: 'NORMAL',
    reaction_key: 'empathyFromChild',
  }

  it('네 묶음이 다 있고 이름표는 여기서 붙인다', () => {
    const 재료 = JSON.parse(
      buildCharacterMaterial({
        ...기본,
        pastMessages: [
          { speaker_type: 'character', text: '어쩌면 좋을까…' },
          { speaker_type: 'child', text: '참으면 아파요' },
        ],
      }),
    )

    expect(Object.keys(재료)).toEqual([
      'character',
      'story_so_far',
      'scene',
      'said_so_far',
      'latest',
      'direction',
    ])
    expect(재료.said_so_far).toEqual([
      { speaker: '며느리', text: '어쩌면 좋을까…' },
      { speaker: '아이', text: '참으면 아파요' },
    ])
    expect(재료.story_so_far).toEqual(['옛날 옛적에'])
    expect(재료.scene).toEqual({ conflict: 캐릭터_장면.conflict, stance: 캐릭터_장면.scene_stance })
  })

  it('⛔ `scene_goal` 을 주지 않는다 — 주면 아이 대신 그 문장을 말해 버린다', () => {
    const 글자 = buildCharacterMaterial({
      ...기본,
      // `goal` 을 켠 상태여도 캐릭터 쪽은 그대로다 (`스펙확정_연동기준.md` C).
      scene: { ...캐릭터_장면 },
    })
    expect(글자).not.toContain('아이가 며느리 입장에서 생각해 본다')
    expect(글자).not.toContain('scene_goal')
    expect(JSON.parse(글자)).not.toHaveProperty('goal')
  })

  it('⛔ `missing_elements` 통째가 아니라 `remaining_worries[guidance_target]` 한 줄만 간다', () => {
    const 재료 = JSON.parse(
      buildCharacterMaterial({ ...기본, response_mode: 'GUIDED', guidance_target: 'SOLUTION' }),
    )
    expect(재료.direction.remaining_worry).toBe('그럼 난 어떻게 하면 좋을까…')
    expect(JSON.stringify(재료)).not.toContain('remaining_worries')
  })

  it('유도 대상이 없거나 그 요소의 걱정이 없으면 빈칸 — 지어내지 않는다', () => {
    const 없음 = JSON.parse(buildCharacterMaterial(기본))
    expect(없음.direction.remaining_worry).toBe('')

    const 모르는것 = JSON.parse(
      buildCharacterMaterial({ ...기본, guidance_target: 'REASON' }),
    )
    expect(모르는것.direction.remaining_worry).toBe('')
  })

  it('`main_point` 가 없으면 빈칸이다', () => {
    const 재료 = JSON.parse(buildCharacterMaterial({ ...기본, main_point: null }))
    expect(재료.latest).toEqual({ child_utterance: 기본.child_utterance, main_point: '' })
  })
})

describe('낱개 자리표시자는 이제 없다 (2026-08-14)', () => {
  // 프롬프트를 두 파일로 나누면서 「## 받는 것」 절이 `보낼것.md` 에서 사라졌고,
  // 틀을 뽑아 `{이름}` 을 채우던 기계 전체를 걷어냈다.
  //
  // 그전에는 실험 프롬프트가 `{child_utterance}` 같은 **낱개 이름**을 쓸 수 있었다
  // (`낱개()` — 스스로 「옛 프롬프트를 살려 두는 다리지 규격이 아니다」라고 적어 뒀다).
  // ⚠️ **그 다리는 이제 없다.** 실험 프롬프트가 낱개 이름을 쓰면 채워지지 않는다.
  it('재료는 언제나 JSON 한 덩이다 — 프롬프트 본문과 무관하다', () => {
    const 채운것 = buildAnalysisMaterial({
      scene: 분석_장면,
      child_utterance: '며느리가 창피했을 것 같아',
      previous_character_message: '어쩌면 좋을까…',
      include_goal: false,
    })

    // JSON 한 덩이. 낱개 이름표(`상황:` 같은 것)가 붙지 않는다.
    expect(채운것.startsWith('{')).toBe(true)
    expect(JSON.parse(채운것).child_utterance).toBe('며느리가 창피했을 것 같아')
    expect(채운것).not.toContain('상황:')
  })
})
