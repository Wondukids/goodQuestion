// 로그 일곱 줄의 형태를 지킨다 (결정 23, 이슈 #26 말-7).
//
// **이 검사가 이 레포에서 제일 중요한 것 중 하나다.**
// `CLAUDE.md` 「로그」 — "이 로그가 이 레포의 존재 이유다. 지우거나 요약하지 말 것."
// 프롬프트를 고쳐 가며 결과를 **눈으로 비교**하는 게 목적이라 필드가 자리를 바꾸면 안 된다.
// 그래서 문자열 전체를 통째로 비교한다.
//
// ⭐ 아래 기대 문자열은 **파이썬 `src/goodquestion/log.py` 를 실제로 돌려 받은 것을 그대로
//    붙인 것**이다. 같은 재료를 파이썬에 넣고 뽑은 글자라 「비슷하다」가 아니라 「같다」다.
//    (`tests/test_log.py` 가 손으로 적어 둔 세 줄과도 글자가 같다.)
//
// 파이썬과 딱 한 자리가 다르고, 그건 의도다 —
//   `장면_줄()` 에서 `character_name` 이 없을 때 파이썬은 f-string 이라 `None` 을 찍는다.
//   여기서는 `값()` 을 거쳐 `null` 이 된다. 없는 값은 `null` 이라는 결정 23 의 규칙 쪽을 따랐고,
//   실제로는 닿지 않는 경우다 — 이 줄은 대화 장면에만 찍히고 거기서 `character_name` 은
//   `story_scenes` 의 CHECK 로 NOT NULL 이다(`db/schema.ts` dialogue_scene_needs_all_parts).

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Decision, SessionState } from '@/lib/domain/decide'
import {
  analysisLine,
  decisionLine,
  dialogueLine,
  narrationLine,
  printLine,
  sceneEndLine,
  sceneLine,
  stateLine,
  type AnalysisForLog,
  type SceneForLog,
} from '@/lib/log'

function 분석(바꿀것: Partial<AnalysisForLog> = {}): AnalysisForLog {
  return {
    child_intent: 'SOLUTION',
    main_point: '참지 말고 말하는 게 낫다',
    detected_elements: [
      { type: 'SOLUTION', evidence: '그냥 말해' },
      { type: 'REASON', evidence: '참으면 배 아프니까' },
    ],
    utterance_validity: 'VALID',
    ...바꿀것,
  }
}

function 상태(바꿀것: Partial<SessionState> = {}): SessionState {
  return {
    current_child_turn_count: 2,
    accumulated_elements: ['PERSPECTIVE', 'SOLUTION', 'REASON'],
    last_response_mode: 'NORMAL',
    last_guidance_target: null,
    turns_without_new_element: 0,
    consecutive_low_information_turns: 0,
    ...바꿀것,
  }
}

function 판정(바꿀것: Partial<Decision> = {}): Decision {
  return {
    response_mode: 'NORMAL',
    guidance_target: 'EMOTION',
    last_guidance_target: 'EMOTION',
    soft_cue: true,
    reaction_key: 'proposalFromChild',
    scene_goal_met: false,
    scene_end_reason: null,
    accumulated_elements: ['PERSPECTIVE', 'SOLUTION', 'REASON'],
    turns_without_new_element: 0,
    consecutive_low_information_turns: 0,
    ...바꿀것,
  }
}

const 장면: SceneForLog = {
  scene_order: 3,
  character_name: '며느리',
  required_elements: ['PERSPECTIVE', 'SOLUTION', 'REASON'],
  preferred_turns: 2,
  max_turns: 4,
  scene_description: '며느리가 방귀를 참다 병이 났다.',
}

// 칸이 다 빈 행. 전개 장면이 이 모양이다.
const 빈_장면: SceneForLog = {
  scene_order: 1,
  character_name: null,
  required_elements: null,
  preferred_turns: null,
  max_turns: null,
  scene_description: null,
}

// ---------------------------------------------------------------------------
// 세 줄 — 결정 23 의 예시와 글자까지 같아야 한다
// ---------------------------------------------------------------------------

describe('[분석] 줄', () => {
  it('utterance_analyses 네 칸과 버림을 이 순서로 찍는다', () => {
    expect(analysisLine(분석(), { 버린: [] })).toBe(
      '[분석] child_intent=SOLUTION' +
        ' main_point="참지 말고 말하는 게 낫다"' +
        ' detected_elements=[SOLUTION("그냥 말해"), REASON("참으면 배 아프니까")]' +
        ' utterance_validity=VALID' +
        ' 버림=[]',
    )
  })

  it('버린 요소가 보인다', () => {
    // 이게 없으면 accumulated_elements 가 왜 안 늘었는지 알 수 없다 (결정 23).
    expect(analysisLine(분석(), { 버린: ['PERSPECTIVE', 'EMOTION'] })).toBe(
      '[분석] child_intent=SOLUTION' +
        ' main_point="참지 말고 말하는 게 낫다"' +
        ' detected_elements=[SOLUTION("그냥 말해"), REASON("참으면 배 아프니까")]' +
        ' utterance_validity=VALID' +
        ' 버림=[PERSPECTIVE, EMOTION]',
    )
  })

  it('main_point 가 null 이면 따옴표를 붙이지 않는다', () => {
    expect(analysisLine(분석({ main_point: null }), { 버린: [] })).toBe(
      '[분석] child_intent=SOLUTION' +
        ' main_point=null' +
        ' detected_elements=[SOLUTION("그냥 말해"), REASON("참으면 배 아프니까")]' +
        ' utterance_validity=VALID' +
        ' 버림=[]',
    )
  })

  it('요소가 없으면 빈 배열이다 — 칸을 지우지 않는다', () => {
    expect(analysisLine(분석({ detected_elements: [] }), { 버린: [] })).toBe(
      '[분석] child_intent=SOLUTION' +
        ' main_point="참지 말고 말하는 게 낫다"' +
        ' detected_elements=[]' +
        ' utterance_validity=VALID' +
        ' 버림=[]',
    )
  })

  it('evidence 가 없는 요소도 그대로 찍는다', () => {
    // 버려질 요소라도 LLM 이 낸 것은 보여야 한다 (결정 26).
    expect(
      analysisLine(분석({ detected_elements: [{ type: 'REASON', evidence: null }] }), {
        버린: ['REASON'],
      }),
    ).toBe(
      '[분석] child_intent=SOLUTION' +
        ' main_point="참지 말고 말하는 게 낫다"' +
        ' detected_elements=[REASON(null)]' +
        ' utterance_validity=VALID' +
        ' 버림=[REASON]',
    )
  })

  it('evidence 칸 자체가 없어도 null 로 찍는다', () => {
    // 파서가 「없음」을 undefined 로 주더라도 로그는 갈리지 않는다.
    expect(analysisLine(분석({ detected_elements: [{ type: 'REASON' }] }), { 버린: [] })).toContain(
      ' detected_elements=[REASON(null)] ',
    )
  })
})

describe('[상태] 줄', () => {
  it('story_sessions 값과 missing_elements 를 이 순서로 찍는다', () => {
    expect(stateLine(상태(), { missing: ['EMOTION'] })).toBe(
      '[상태] current_child_turn_count=2' +
        ' accumulated_elements=[PERSPECTIVE, SOLUTION, REASON]' +
        ' missing_elements=[EMOTION]' +
        ' last_response_mode=NORMAL' +
        ' turns_without_new_element=0' +
        ' consecutive_low_information_turns=0',
    )
  })

  it('빈 배열도 자리를 지킨다', () => {
    expect(stateLine(상태({ accumulated_elements: [] }), { missing: [] })).toBe(
      '[상태] current_child_turn_count=2' +
        ' accumulated_elements=[]' +
        ' missing_elements=[]' +
        ' last_response_mode=NORMAL' +
        ' turns_without_new_element=0' +
        ' consecutive_low_information_turns=0',
    )
  })

  it('last_response_mode 가 없으면 null 이다', () => {
    expect(stateLine(상태({ last_response_mode: null }), { missing: ['EMOTION'] })).toBe(
      '[상태] current_child_turn_count=2' +
        ' accumulated_elements=[PERSPECTIVE, SOLUTION, REASON]' +
        ' missing_elements=[EMOTION]' +
        ' last_response_mode=null' +
        ' turns_without_new_element=0' +
        ' consecutive_low_information_turns=0',
    )
  })

  it('missing 을 accumulated 바로 뒤에 둔다', () => {
    // 차집합을 눈으로 뺄 수 있어야 한다 (결정 23).
    const 줄 = stateLine(상태(), { missing: ['EMOTION'] })

    expect(줄.indexOf('accumulated_elements=')).toBeLessThan(줄.indexOf('missing_elements='))
    expect(줄.indexOf('missing_elements=')).toBeLessThan(줄.indexOf('last_response_mode='))
  })
})

describe('[판정] 줄', () => {
  it('Decision 여섯 칸을 decide.ts 필드 순서로 찍는다', () => {
    expect(decisionLine(판정())).toBe(
      '[판정] response_mode=NORMAL' +
        ' guidance_target=EMOTION' +
        ' soft_cue=true' +
        ' reaction_key=proposalFromChild' +
        ' scene_goal_met=false' +
        ' scene_end_reason=null',
    )
  })

  it('없는 값은 null 이다', () => {
    // `-` 로 찍으면 값이 `-` 인 것과 구별이 안 된다 (결정 11 과 같은 이유).
    expect(
      decisionLine(
        판정({
          guidance_target: null,
          soft_cue: false,
          scene_goal_met: true,
          scene_end_reason: null,
        }),
      ),
    ).toBe(
      '[판정] response_mode=NORMAL' +
        ' guidance_target=null' +
        ' soft_cue=false' +
        ' reaction_key=proposalFromChild' +
        ' scene_goal_met=true' +
        ' scene_end_reason=null',
    )
  })

  it('참·거짓은 SQL 표기다', () => {
    const 줄 = decisionLine(
      판정({
        response_mode: 'CLOSING',
        guidance_target: null,
        soft_cue: false,
        reaction_key: 'directResponse',
        scene_goal_met: true,
        scene_end_reason: 'GOAL_MET',
      }),
    )

    expect(줄).toBe(
      '[판정] response_mode=CLOSING' +
        ' guidance_target=null' +
        ' soft_cue=false' +
        ' reaction_key=directResponse' +
        ' scene_goal_met=true' +
        ' scene_end_reason=GOAL_MET',
    )
  })

  it('필드 순서는 Decision 과 같다', () => {
    const 줄 = decisionLine(판정())
    const 자리 = [
      'response_mode=',
      'guidance_target=',
      'soft_cue=',
      'reaction_key=',
      'scene_goal_met=',
      'scene_end_reason=',
    ].map((이름) => 줄.indexOf(이름))

    expect(자리).toStrictEqual([...자리].sort((가, 나) => 가 - 나))
    expect(자리).not.toContain(-1)
  })
})

describe('세 줄에 공급자를 넣지 않는다', () => {
  it('공급자·모델은 [LLM] 줄이 찍는다 (결정 23)', () => {
    // 중복이고 줄이 길어진다. `lib/llm/index.ts` 가 이미 찍고 있다.
    const 줄들 = [
      analysisLine(분석(), { 버린: [] }),
      stateLine(상태(), { missing: [] }),
      decisionLine(판정()),
    ]

    for (const 줄 of 줄들) {
      expect(줄).not.toContain('provider')
      expect(줄).not.toContain('gemini')
      expect(줄).not.toContain('model')
    }
  })
})

// ---------------------------------------------------------------------------
// 보조 줄 (결정 23) — 장면 경계와 대사
// ---------------------------------------------------------------------------

describe('보조 줄', () => {
  it('고정 대사에는 표시가 붙는다', () => {
    // `[고정]` 이 붙은 줄이 story_scenes 원문이고 안 붙은 줄이 LLM 이 만든 것이다.
    expect(dialogueLine('며느리', '그래도 아직은 못 말하겠어.', { 고정: true })).toBe(
      '[고정] 며느리: 그래도 아직은 못 말하겠어.',
    )
    expect(dialogueLine('며느리', '정말 그럴까…?', { 고정: false })).toBe('며느리: 정말 그럴까…?')
  })

  it('장면 줄은 장면 상수를 찍는다', () => {
    expect(sceneLine(장면)).toBe(
      '[장면 3] 며느리' +
        ' · required_elements=[PERSPECTIVE, SOLUTION, REASON]' +
        ' preferred_turns=2' +
        ' max_turns=4',
    )
  })

  it('장면 줄의 빈 칸도 자리를 지킨다', () => {
    // required_elements 가 NULL 이면 빈 배열, 턴 수가 NULL 이면 null 이다.
    // ⚠️ character_name 자리만 파이썬과 다르다 — 파이썬은 f-string 이라 `None` 이 찍힌다.
    //    실제로는 대화 장면에만 찍히는 줄이라 NULL 이 오지 않는다(머리말 참고).
    expect(sceneLine(빈_장면)).toBe(
      '[장면 1] null · required_elements=[] preferred_turns=null max_turns=null',
    )
  })

  it('장면끝 줄은 종료 사유와 모은 요소를 찍는다', () => {
    expect(sceneEndLine(장면, 판정({ scene_end_reason: 'MAX_TURNS', scene_goal_met: false }))).toBe(
      '[장면끝 3]' +
        ' scene_end_reason=MAX_TURNS' +
        ' scene_goal_met=false' +
        ' accumulated_elements=[PERSPECTIVE, SOLUTION, REASON]',
    )
  })

  it('장면끝 줄의 없는 값도 null·빈 배열이다', () => {
    expect(sceneEndLine(장면, 판정({ accumulated_elements: [] }))).toBe(
      '[장면끝 3] scene_end_reason=null scene_goal_met=false accumulated_elements=[]',
    )
  })

  it('전개 줄은 지문을 그대로 찍는다', () => {
    expect(narrationLine(장면)).toBe('[전개 3] 며느리가 방귀를 참다 병이 났다.')
  })

  it('지문이 없으면 빈 칸으로 두되 라벨은 남는다', () => {
    expect(narrationLine(빈_장면)).toBe('[전개 1] ')
  })
})

// ---------------------------------------------------------------------------
// 출력
// ---------------------------------------------------------------------------

describe('printLine', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('줄을 손대지 않고 그대로 넘긴다', () => {
    // 접거나 대괄호를 해석하면 눈으로 비교할 수 없다 (파이썬 rich 의 soft_wrap·markup=False).
    const 콘솔 = vi.spyOn(console, 'log').mockImplementation(() => {})
    const 줄 = analysisLine(분석(), { 버린: [] })

    printLine(줄)

    expect(콘솔).toHaveBeenCalledTimes(1)
    expect(콘솔).toHaveBeenCalledWith(줄)
  })
})
