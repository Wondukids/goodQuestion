// 미션 LLM 층 (이슈 #18 · `src/llm/engine/mission.ts`) — 재료 두 벌과 부르기.
//
// ⛔ 되묻기(M9)면 **아예 안 부른다** — `character.test.ts` 의 CLOSING 검사와 같은 방식으로
// 가짜 SDK 의 호출 수를 센다. purpose 가 DB CHECK 값 그대로인지도 여기서 잰다 —
// `purpose.test.ts` 와 같은 계약인데, CHECK 를 넓히는 것은 #17 트랙이라 그 파일 대신
// 이 파일에 둔다.

import { describe, expect, it } from 'vitest'

import { loadSettings, type Settings } from '@/llm/config'
import {
  buildMissionReplyMaterial,
  buildMissionSummaryMaterial,
  missionReply,
  missionReplyTurn,
  missionSummary,
} from '@/llm/engine/mission'
import type { CharacterScene } from '@/llm/engine/material'
import { read } from '@/llm/prompts'

import { installFakeSdk } from './support/sdk-gate'

function 설정(): Settings {
  return loadSettings({ gemini_api_keys: ['키1'], anthropic_api_key: null, llm_rpm: 0 })
}

/** 제미나이 SDK 를 가짜로 꽂고 **몇 번 불렸는지** 센다 (`character.test.ts` 와 같은 방식). */
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

const 장면: CharacterScene = {
  character_name: '마을 이장',
  persona: '배 밭을 가진 마을 이장',
  speech_style: '점잖은 하게체',
  guidance_style: '걱정을 소리 내어 말한다',
  forbidden: [],
  conflict: '높은 배나무의 배를 안전하게 따야 한다',
  scene_stance: '아이의 꾀를 반긴다',
  remaining_worries: { REQUEST: '며느리가 부끄럽다고 안 해 주면 어쩌나…' },
}

const 미션 = {
  mission_goal: '방귀로 배를 딸 방법을 아이가 구체적으로 정한다',
  step: 'use',
  question: '소쿠리 말인가? 소쿠리로 어떻게 해야 배를 안전하게 딸 수 있겠는가?',
  selection: '소쿠리',
}

describe('미션 턴 재료 (명세 9절 mission_reply)', () => {
  const 기본 = {
    scene: 장면,
    mission: 미션,
    missionMessages: [
      { speaker_type: 'character', text: '소쿠리 말인가?' },
      { speaker_type: 'child', text: '소쿠리요!' },
    ],
    child_utterance: '소쿠리로 받으면 돼요',
    main_point: '소쿠리로 배를 받자는 제안',
    direction_kind: 'summary_reply',
  }

  it('여섯 묶음이 명세 9절 순서 그대로다', () => {
    const 재료 = JSON.parse(buildMissionReplyMaterial(기본))

    expect(Object.keys(재료)).toEqual([
      'character',
      'scene',
      'mission',
      'mission_said_so_far',
      'latest',
      'direction',
    ])
    expect(재료.character).toEqual({
      name: '마을 이장',
      persona: 장면.persona,
      speech_style: 장면.speech_style,
      guidance_style: 장면.guidance_style,
      forbidden: [],
    })
    expect(재료.scene).toEqual({ conflict: 장면.conflict, stance: 장면.scene_stance })
    expect(재료.mission).toEqual({
      goal: 미션.mission_goal,
      step: 'use',
      question: 미션.question,
      selection: '소쿠리',
    })
    expect(재료.mission_said_so_far).toEqual([
      { speaker: '마을 이장', text: '소쿠리 말인가?' },
      { speaker: '아이', text: '소쿠리요!' },
    ])
    expect(재료.latest).toEqual({
      child_utterance: '소쿠리로 받으면 돼요',
      main_point: '소쿠리로 배를 받자는 제안',
    })
    expect(재료.direction).toEqual({ kind: 'summary_reply' })
  })

  it('다리 대사(bridge)는 스텝이 없다 — 빈칸으로 나가고 지어내지 않는다', () => {
    const 재료 = JSON.parse(
      buildMissionReplyMaterial({
        scene: 장면,
        mission: { mission_goal: 미션.mission_goal },
        child_utterance: '방귀로 떨어뜨리면 돼요!',
        main_point: '방귀로 배를 떨어뜨리자는 제안',
        direction_kind: 'bridge_into_mission',
      }),
    )
    expect(재료.mission).toEqual({ goal: 미션.mission_goal, step: '', question: '', selection: '' })
    expect(재료.mission_said_so_far).toEqual([])
    expect(재료.direction).toEqual({ kind: 'bridge_into_mission' })
  })

  it('⛔ 유도 걱정·scene_goal·모드는 안 싣는다 — 미션 턴은 유도하지 않는다 (M3)', () => {
    const 글자 = buildMissionReplyMaterial(기본)
    expect(글자).not.toContain('remaining_worr') // remaining_worry · remaining_worries 둘 다
    expect(글자).not.toContain('며느리가 부끄럽다고 안 해 주면')
    expect(글자).not.toContain('scene_goal')
    expect(글자).not.toContain('response_mode')
    expect(글자).not.toContain('reaction_key')
  })

  it('JSON 한 덩이 — 들여쓰기도 `\\uXXXX` 도 없다', () => {
    const 글자 = buildMissionReplyMaterial(기본)
    expect(글자).toContain('소쿠리로 받으면 돼요')
    expect(글자).not.toContain('\\u')
    expect(글자).not.toContain('\n')
  })
})

describe('종료 요약 재료 (명세 9절 mission_summary)', () => {
  // 여분 칸(`at`)이 있는 실제 selections 행 모양 — 변수로 두어 그대로 넘긴다.
  const 선택기록 = [
    { step: 'use', kind: 'prop_select', value: 'sokuri', at: '2026-08-14T00:00:00Z' },
  ]

  const 기본 = {
    scene: 장면,
    mission: { mission_goal: 미션.mission_goal },
    selections: 선택기록,
    missionMessages: [
      { speaker_type: 'child', text: '소쿠리로 받으면 돼요' },
      { speaker_type: 'character', text: '떨어져도 안 다치겠구먼!' },
    ],
  }

  it('네 묶음이고, 걱정이 없으면 guidance 는 null 이다', () => {
    const 재료 = JSON.parse(buildMissionSummaryMaterial(기본))

    expect(Object.keys(재료)).toEqual(['character', 'mission', 'mission_dialogue', 'guidance'])
    expect(재료.mission.goal).toBe(미션.mission_goal)
    expect(재료.mission_dialogue).toEqual([
      { speaker: '아이', text: '소쿠리로 받으면 돼요' },
      { speaker: '마을 이장', text: '떨어져도 안 다치겠구먼!' },
    ])
    expect(재료.guidance).toBeNull()
  })

  it('남은 걱정이 있으면 guidance.remaining_worry 로 실린다', () => {
    const 재료 = JSON.parse(
      buildMissionSummaryMaterial({ ...기본, remaining_worry: '배가 다 깨지면 어쩌나…' }),
    )
    expect(재료.guidance).toEqual({ remaining_worry: '배가 다 깨지면 어쩌나…' })
  })

  it('선택 기록은 step·kind·value 만 나간다 — 시각(at)은 재료에 없다', () => {
    const 글자 = buildMissionSummaryMaterial(기본)
    expect(JSON.parse(글자).mission.selections).toEqual([
      { step: 'use', kind: 'prop_select', value: 'sokuri' },
    ])
    expect(글자).not.toContain('2026-08-14T00:00:00Z')
  })
})

describe('부르기 — purpose 는 DB 값 그대로다 (#17 과의 계약)', () => {
  // `docs/미션_명세.md` 6절이 넓히는 `llm_calls_purpose_check` 의 네 값.
  const DB가_받는_용도 = ['analysis', 'character', 'mission_reply', 'mission_summary']

  it('미션 턴 대사는 `mission_reply` 로 부른다', async () => {
    const { 호출 } = 가짜_제미나이('소쿠리로 받자는 거구먼!')
    const 결과 = await missionReply('{}', { settings: 설정() })

    expect(결과.llm.attempts[0].purpose).toBe('mission_reply')
    expect(DB가_받는_용도).toContain(결과.llm.attempts[0].purpose)
    expect(호출[0].system_instruction).toBe(read('mission_reply'))
  })

  it('종료 요약은 `mission_summary` 로 부른다', async () => {
    const { 호출 } = 가짜_제미나이('네 덕분에 정했구먼!')
    const 결과 = await missionSummary('{}', { settings: 설정() })

    expect(결과.llm.attempts[0].purpose).toBe('mission_summary')
    expect(호출[0].system_instruction).toBe(read('mission_summary'))
  })

  it('⛔ JSON 스키마를 주지 않는다 — 문장을 그대로 받는다', async () => {
    const { 호출 } = 가짜_제미나이('그러게…')
    await missionReply('{}', { settings: 설정() })
    expect(호출[0]).not.toHaveProperty('response_format')
  })

  it('앞뒤 공백만 턴다 — 자르지도 따옴표를 벗기지도 않는다', async () => {
    가짜_제미나이('  "이장: 좋은 생각이군" (웃음)  ')
    const { line } = await missionReply('재료', { settings: 설정() })
    expect(line).toBe('"이장: 좋은 생각이군" (웃음)')
  })

  it('준 본문이 있으면 그것을 system 으로 보낸다', async () => {
    const { 호출 } = 가짜_제미나이('그러게…')
    await missionSummary('재료', { prompt: '실험용 미션 본문', settings: 설정() })
    expect(호출[0].system_instruction).toBe('실험용 미션 본문')
  })
})

describe('⛔ 되묻기(M9)면 대사 LLM 을 아예 부르지 않는다', () => {
  const 기본 = {
    scene: 장면,
    mission: 미션,
    child_utterance: '몰라',
    main_point: null,
    direction_kind: 'summary_reply',
  }

  it('호출 수가 0 이고 line·llm 이 null 이다 — 되묻기 문구는 config 고정 대사 몫', async () => {
    const { 호출 } = 가짜_제미나이('불리면 안 되는 대사')

    const 결과 = await missionReplyTurn({ ...기본, reask: true, settings: 설정() })

    expect(호출).toHaveLength(0)
    expect(결과.line).toBeNull()
    expect(결과.llm).toBeNull()
  })

  it('되묻기가 아니면 부르고, 재료가 그대로 user 로 나간다', async () => {
    const { 호출 } = 가짜_제미나이('소쿠리로 받자는 거구먼!')

    const 결과 = await missionReplyTurn({ ...기본, child_utterance: '소쿠리로 받아요', settings: 설정() })

    expect(호출).toHaveLength(1)
    expect(결과.line).toBe('소쿠리로 받자는 거구먼!')
    const 재료 = JSON.parse(호출[0].input as string)
    expect(재료.latest.child_utterance).toBe('소쿠리로 받아요')
    expect(재료.direction).toEqual({ kind: 'summary_reply' })
  })
})
