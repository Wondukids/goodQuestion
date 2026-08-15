// 미션 트리거·미션 턴 규칙 함수 (이슈 #18 · `src/llm/domain/mission.ts`).
//
// `decide.ts` 는 파이썬 황금표와 대조하지만 이 둘은 타입스크립트가 첫 정본이라 황금표가
// 없다. 대신 명세의 수용 기준(`docs/미션_명세.md` 11절)을 사례로 박는다 — 대화3·대화4
// 시나리오와 닫힘 게이트, M3(요소만 합산)·M9(되묻기 1회)다.

import { describe, expect, it } from 'vitest'

import {
  decideMissionTrigger,
  decideMissionTurn,
  ValueError,
  type MissionConstants,
  type MissionSceneState,
  type MissionTriggerConfig,
  type MissionTurnState,
} from '@/llm/domain/mission'

// ── 트리거 (명세 5절 · M1) ─────────────────────────────────────────────────

// 값은 `docs/미션_명세.md` 6절 jsonc 그대로다. 규칙은 데이터다 — 함수엔 요소 이름이 없다.
const 미션1_트리거: MissionTriggerConfig = { any_elements: ['SOLUTION'], min_turns: 2 }
const 미션2_트리거: MissionTriggerConfig = { any_elements: ['PERSPECTIVE'], min_turns: 2 }

function 세션(덮어쓰기: Partial<MissionSceneState> = {}): MissionSceneState {
  return { current_child_turn_count: 1, accumulated_elements: [], ...덮어쓰기 }
}

describe('트리거 — 대화3 (미션1 배 따기)', () => {
  it('SOLUTION 이 감지된 턴에 즉시 발동한다', () => {
    const 답 = decideMissionTrigger(
      미션1_트리거,
      세션(),
      { detected_elements: ['SOLUTION', 'REASON'] },
      { response_mode: 'NORMAL' },
    )
    expect(답).toEqual({ triggered: true, trigger_reason: 'ELEMENT', closing_overridden: false })
  })

  it('요소 없는 첫 턴은 발동하지 않는다', () => {
    const 답 = decideMissionTrigger(
      미션1_트리거,
      세션(),
      { detected_elements: ['EMOTION'] },
      { response_mode: 'NORMAL' },
    )
    expect(답).toEqual({ triggered: false, trigger_reason: null, closing_overridden: false })
  })

  it('SOLUTION 없이도 아이 턴 2회면 발동한다 (min_turns 폴백)', () => {
    const 답 = decideMissionTrigger(
      미션1_트리거,
      세션({ current_child_turn_count: 2 }),
      { detected_elements: [] },
      { response_mode: 'NORMAL' },
    )
    expect(답.triggered).toBe(true)
    expect(답.trigger_reason).toBe('MIN_TURNS')
  })

  it('씬 누적에 남은 요소로도 발동한다 — 이탈(abandoned) 복귀 턴 (M4)', () => {
    // 미션을 중도 이탈해도 합산된 요소는 남는다. 새 감지가 없는 복귀 턴에도 다시 발동해야
    // 트리거 조건이 「남아 있다」(명세 8절)가 된다.
    const 답 = decideMissionTrigger(
      미션1_트리거,
      세션({ accumulated_elements: ['SOLUTION', 'REASON'] }),
      { detected_elements: [] },
      { response_mode: 'NORMAL' },
    )
    expect(답.triggered).toBe(true)
    expect(답.trigger_reason).toBe('ELEMENT')
  })
})

describe('트리거 — 대화4 (미션2 친구 돕기)', () => {
  it('첫 대답이 PERSPECTIVE 면 1턴 만에 발동한다 (M7 즉발)', () => {
    const 답 = decideMissionTrigger(
      미션2_트리거,
      세션(),
      { detected_elements: ['PERSPECTIVE'] },
      { response_mode: 'NORMAL' },
    )
    expect(답.triggered).toBe(true)
    expect(답.trigger_reason).toBe('ELEMENT')
  })
})

describe('트리거 — 닫힘 게이트 (명세 5절)', () => {
  it('조건이 하나도 안 맞아도 CLOSING 이면 CLOSING 대신 발동한다', () => {
    const 답 = decideMissionTrigger(
      미션1_트리거,
      세션(),
      { detected_elements: [] },
      { response_mode: 'CLOSING' },
    )
    expect(답).toEqual({
      triggered: true,
      trigger_reason: 'CLOSING_GATE',
      closing_overridden: true,
    })
  })

  it('요소 발동과 CLOSING 이 겹치면 사유는 ELEMENT, 닫힘은 그래도 눌린다', () => {
    const 답 = decideMissionTrigger(
      미션1_트리거,
      세션({ current_child_turn_count: 5 }),
      { detected_elements: ['SOLUTION'] },
      { response_mode: 'CLOSING' },
    )
    expect(답.trigger_reason).toBe('ELEMENT')
    expect(답.closing_overridden).toBe(true)
  })

  it.each(['NORMAL', 'GUIDED'])('%s 는 게이트가 아니다 — 닫힘을 누르지 않는다', (모드) => {
    const 답 = decideMissionTrigger(
      미션1_트리거,
      세션({ current_child_turn_count: 3 }),
      { detected_elements: [] },
      { response_mode: 모드 },
    )
    expect(답.closing_overridden).toBe(false)
  })
})

// ── 미션 턴 (명세 4절 ③ · M3 · M9) ─────────────────────────────────────────

const 미션1: MissionConstants = { mission_type: 'prop_choice', step_keys: ['use', 'request'] }
const 미션2: MissionConstants = { mission_type: 'card_help', step_keys: [] }

// 대화3 씬의 필수 요소 (명세 3절 표)
const 장면 = { required_elements: ['SOLUTION', 'REASON', 'REQUEST', 'RESULT'] }

function 상태(덮어쓰기: Partial<MissionTurnState> = {}): MissionTurnState {
  return { step: 'use', reask_used: false, accumulated_elements: ['SOLUTION'], ...덮어쓰기 }
}

function 분석(덮어쓰기: Partial<{ detected_elements: string[]; utterance_validity: string }> = {}) {
  return { detected_elements: [] as string[], utterance_validity: 'VALID', ...덮어쓰기 }
}

describe('미션 턴 — 요소만 합산한다 (M3)', () => {
  it('합산분·누적·부족만 내놓는다 — 턴 수·유도 카운터 칸이 답에 아예 없다', () => {
    const 답 = decideMissionTurn(
      상태(),
      미션1,
      장면,
      분석({ detected_elements: ['SOLUTION', 'RESULT'] }),
    )

    // 이 키 목록이 곧 「씬 턴 수·유도 카운터를 건드리지 않는다」다 — 없는 칸은 저장할 수 없다.
    expect(Object.keys(답).sort()).toEqual(
      [
        'reask',
        'gained_elements',
        'accumulated_elements',
        'missing_elements',
        'next_step',
        'steps_done',
      ].sort(),
    )
    expect(답.gained_elements).toEqual(['RESULT']) // SOLUTION 은 이미 누적에 있다
    expect(답.accumulated_elements).toEqual(['SOLUTION', 'RESULT'])
    expect(답.missing_elements).toEqual(['REASON', 'REQUEST'])
  })

  it('입력 배열을 건드리지 않는다', () => {
    const 누적 = ['SOLUTION']
    const 감지 = ['RESULT', 'RESULT']
    decideMissionTurn(
      상태({ accumulated_elements: 누적 }),
      미션1,
      장면,
      분석({ detected_elements: 감지 }),
    )
    expect(누적).toEqual(['SOLUTION'])
    expect(감지).toEqual(['RESULT', 'RESULT'])
  })

  it('같은 요소가 두 번 감지돼도 합산분에는 한 번이다', () => {
    const 답 = decideMissionTurn(
      상태(),
      미션1,
      장면,
      분석({ detected_elements: ['RESULT', 'RESULT'] }),
    )
    expect(답.gained_elements).toEqual(['RESULT'])
  })
})

describe('미션 턴 — 스텝 진행 (prop_choice)', () => {
  it('정상 발화면 다음 스텝으로 간다 (use → request)', () => {
    const 답 = decideMissionTurn(상태(), 미션1, 장면, 분석())
    expect(답.reask).toBe(false)
    expect(답.next_step).toBe('request')
    expect(답.steps_done).toBe(false)
  })

  it('마지막 스텝을 정상 진행으로 마치면 미션끝이다', () => {
    const 답 = decideMissionTurn(상태({ step: 'request' }), 미션1, 장면, 분석())
    expect(답.next_step).toBeNull()
    expect(답.steps_done).toBe(true)
  })

  it('step_keys 에 없는 스텝이면 터진다 — 부르는 쪽이 잘못 줬다', () => {
    expect(() => decideMissionTurn(상태({ step: '없는스텝' }), 미션1, 장면, 분석())).toThrow(
      ValueError,
    )
  })
})

describe('미션 턴 — 되묻기 1회 (M9, 두 미션 공통)', () => {
  it.each(['SHORT', 'UNCLEAR'])('%s 첫 시도면 되묻고 같은 스텝을 유지한다', (판정) => {
    const 답 = decideMissionTurn(상태(), 미션1, 장면, 분석({ utterance_validity: 판정 }))
    expect(답.reask).toBe(true)
    expect(답.next_step).toBe('use')
    expect(답.steps_done).toBe(false)
  })

  it('두 번째도 짧으면 그대로 진행한다 — 스텝당 1회', () => {
    const 답 = decideMissionTurn(
      상태({ reask_used: true }),
      미션1,
      장면,
      분석({ utterance_validity: 'SHORT' }),
    )
    expect(답.reask).toBe(false)
    expect(답.next_step).toBe('request')
  })

  it('되묻기 턴에도 요소는 합산한다 (M3 에 되묻기 예외가 없다)', () => {
    const 답 = decideMissionTurn(
      상태(),
      미션1,
      장면,
      분석({ detected_elements: ['REASON'], utterance_validity: 'UNCLEAR' }),
    )
    expect(답.reask).toBe(true)
    expect(답.gained_elements).toEqual(['REASON'])
    expect(답.accumulated_elements).toEqual(['SOLUTION', 'REASON'])
  })

  it.each(['OFF_TOPIC', 'PLAYFUL', 'VALID'])('%s 는 되묻기 사유가 아니다', (판정) => {
    // `decide.ts` 의 저정보 3종(OFF_TOPIC 포함)과 다르다 — M9 는 SHORT/UNCLEAR 둘뿐이다.
    const 답 = decideMissionTurn(상태(), 미션1, 장면, 분석({ utterance_validity: 판정 }))
    expect(답.reask).toBe(false)
  })
})

describe('미션 턴 — card_help (미션2)', () => {
  it('정상 발화면 이 카드가 끝난다 — 다음 카드·종료는 선택 이벤트 몫이라 null·false 다', () => {
    const 답 = decideMissionTurn(상태({ step: 'scared' }), 미션2, 장면, 분석())
    expect(답.reask).toBe(false)
    expect(답.next_step).toBeNull()
    expect(답.steps_done).toBe(false)
  })

  it('되묻기면 같은 카드를 유지한다 — 친구별 reask 문구는 config 몫이다', () => {
    const 답 = decideMissionTurn(
      상태({ step: 'scared' }),
      미션2,
      장면,
      분석({ utterance_validity: 'SHORT' }),
    )
    expect(답.reask).toBe(true)
    expect(답.next_step).toBe('scared')
  })
})
