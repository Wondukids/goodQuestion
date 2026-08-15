// 보호자 리포트 지표 집계 검사 (이슈 #36 · 명세 `docs/보호자_리포트_명세.md` 4절).
//
// 집계기는 순수 함수라(`src/report/README.md` 층 표) **DB 없이 돈다.** 손으로 만든 행
// 객체를 넣는다 — `tests/progress.test.ts` · `tests/decide.test.ts` 와 같은 결이지만,
// 저 둘과 달리 파이썬 원본이 없어 황금표가 아니라 사례를 손으로 세운다.
//
// 이 검사가 지키는 것 다섯:
//   ① 같은 입력이면 항상 같은 출력 (LLM · 시각 · 난수 없음)
//   ② 8요소가 5축에 빠짐없이 들어간다 — `REQUEST` 는 「일부러 뺐다」까지
//   ③ 발화가 아주 적은 활동에서도 안 터진다 (결정 R16)
//   ④ 미션 발화가 세어진다 (결정 R23)
//   ⑤ `GUIDED` 다음 발화가 `VALID` 일 때만 `reprompt_recovered` 가 오른다
//   ⑥ 🔴 **한 번도 안 헤맨 아이도 상호작용 점수를 얻는다** — 2026-08-15 실측으로 붙은
//      `soft_cue_answered` 가 되돌아가지 않게 막는 자리다 (아래 「헤맨 적 없는 아이」 절)
//   ⑦ 🔴 **후활동은 옆에 놓인 덩이다** — 해도 ①~⑥ 의 숫자가 안 변한다 (F15 · 이슈 #47,
//      파일 맨 아래 두 절)

import { describe, expect, it } from 'vitest'

import { 요소 } from '@/llm/elements'
import {
  aggregateMetrics,
  applyExtractedWords,
  대조형들,
  축_요소,
  축밖_요소,
  상호작용_점수칸,
  type 집계재료,
  type 발화행,
  type 분석행,
  type 장면행,
  type 미션발화행,
  type 미션시도행,
  type 턴조건행,
  type 후활동결과행,
  type 후활동단어행,
  type 후활동재료,
} from '@/report/domain/metrics'

// ═══════════════════════════════════════════════════════════════════════════
// 손으로 만드는 행 — 「방귀 뀌는 며느리」의 대화 장면 둘만 쓴다
// ═══════════════════════════════════════════════════════════════════════════

const 장면들: 장면행[] = [
  {
    id: 'sid-03',
    code: 'sc_banggui_03',
    scene_order: 3,
    name: '방귀를 참는 며느리',
    vocabulary: [
      { word: '며느리', meaning: '아들의 아내' },
      { word: '시집', meaning: '남편의 집안' },
    ],
  },
  {
    id: 'sid-07',
    code: 'sc_banggui_07',
    scene_order: 7,
    name: '배나무 앞 방귀 대작전',
    vocabulary: [{ word: '배나무', meaning: '배가 열리는 나무' }],
  },
]

/** 아이 발화 한 행 + 그 분석 한 행을 한 번에 세운다. 검사 본문에서 표처럼 읽히게. */
function 아이행(
  id: string,
  turn_order: number,
  scene_id: string,
  text: string,
  분석: { intent?: string; elements?: string[]; validity?: string } = {},
): { message: 발화행; analysis: 분석행 } {
  return {
    message: { id, scene_id, speaker_type: 'child', turn_order, text },
    analysis: {
      message_id: id,
      child_intent: 분석.intent ?? 'OPINION',
      detected_elements: (분석.elements ?? []).map((type) => ({
        type,
        evidence: null,
      })),
      utterance_validity: 분석.validity ?? 'VALID',
    },
  }
}

/** 캐릭터 대사 — 아이 발화가 아니므로 어느 숫자에도 들어가면 안 된다. */
function 캐릭터행(id: string, turn_order: number, scene_id: string, text: string): 발화행 {
  return { id, scene_id, speaker_type: 'character', turn_order, text }
}

function 재료세우기(부분: Partial<집계재료> = {}): 집계재료 {
  return {
    session: {
      status: 'completed',
      started_at: '2026-08-03T19:12:00+09:00',
      completed_at: '2026-08-03T19:36:00+09:00',
      last_activity_at: '2026-08-03T19:36:00+09:00',
    },
    story: { slug: 'fart-bride', title: '방귀 뀌는 며느리' },
    scenes: 장면들,
    messages: [],
    analyses: [],
    turn_conditions: [],
    mission_sessions: [],
    mission_messages: [],
    prior_activities: 2,
    ...부분,
  }
}

/** 시안과 같은 그림의 활동 하나 — 아래 검사 여럿이 이 한 벌을 나눠 쓴다. */
function 보통활동(): 집계재료 {
  const 발화들 = [
    아이행('m-101', 2, 'sid-03', '며느리가 부끄러워했어요.', {
      elements: ['EMOTION'],
    }),
    아이행('m-103', 4, 'sid-03', '며느리가 뭐예요?', { intent: 'QUESTION' }),
    아이행('m-105', 6, 'sid-03', '몰라요', { validity: 'SHORT' }),
    아이행('m-107', 8, 'sid-03', '창피하니까 참았을 거예요. 왜냐하면 흉볼까 봐요.', {
      elements: ['EMOTION', 'REASON'],
    }),
    아이행('m-121', 12, 'sid-07', '배나무를 흔들면 돼요.', {
      elements: ['SOLUTION'],
    }),
    아이행('m-123', 14, 'sid-07', '그러면 배가 우수수 떨어져요.', {
      elements: ['RESULT', 'SOLUTION'],
    }),
    아이행('m-125', 16, 'sid-07', '시아버지 마음도 안 좋았을 것 같아요.', {
      elements: ['PERSPECTIVE', 'EMPATHY'],
    }),
  ]
  return 재료세우기({
    messages: [
      ...발화들.map((것) => 것.message),
      캐릭터행('c-102', 3, 'sid-03', '부끄러웠구나. 왜 그랬을까?'),
    ],
    analyses: 발화들.map((것) => 것.analysis),
    turn_conditions: [
      { message_id: 'm-105', response_mode: 'GUIDED' },
      { message_id: 'm-101', response_mode: 'NORMAL' },
    ],
  })
}

// ═══════════════════════════════════════════════════════════════════════════

describe('축 표 — 8요소가 5축에 빠짐없이 들어간다', () => {
  it('축에 묶인 요소 + 일부러 뺀 요소 = 사고 요소 8종 전부', () => {
    // 이 검사가 잡는 것: 요소를 하나 흘려서 그 요소가 어느 축에도 안 들어가는 일.
    // `src/llm/elements.ts` 에 요소가 늘면 여기가 먼저 빨개진다.
    const 축에_담긴 = Object.values(축_요소).flat()
    expect([...축에_담긴, ...축밖_요소].sort()).toEqual(Object.keys(요소).sort())
  })

  it('REQUEST 는 어느 축에도 없다 — 빠뜨린 게 아니라 일부러 뺀 것이다 (R4)', () => {
    expect(Object.values(축_요소).flat()).not.toContain('REQUEST')
    expect(축밖_요소).toEqual(['REQUEST'])
  })

  it('같은 요소가 두 축에 겹쳐 들어가지 않는다', () => {
    const 축에_담긴 = Object.values(축_요소).flat()
    expect(축에_담긴.length).toBe(new Set(축에_담긴).size)
  })

  it('상호작용만 요소가 아니라 대화 지표 셋이다 (R4 · 실측 뒤 셋째 항)', () => {
    expect(축_요소.상호작용).toEqual([])
    expect(상호작용_점수칸).toEqual([
      'child_questions',
      'reprompt_recovered',
      'soft_cue_answered',
    ])
  })
})

describe('같은 입력이면 같은 출력', () => {
  it('두 번 돌린 결과가 완전히 같다 (LLM · 시각 · 난수 없음)', () => {
    const 재료 = 보통활동()
    expect(aggregateMetrics(재료)).toEqual(aggregateMetrics(재료))
  })

  it('행 배열 순서를 섞어도 결과가 같다', () => {
    const 재료 = 보통활동()
    const 섞은재료: 집계재료 = {
      ...재료,
      messages: [...재료.messages].reverse(),
      analyses: [...재료.analyses].reverse(),
      turn_conditions: [...재료.turn_conditions].reverse(),
    }
    expect(aggregateMetrics(섞은재료)).toEqual(aggregateMetrics(재료))
  })

  it('재료를 고치지 않는다', () => {
    const 재료 = 보통활동()
    const 사본 = structuredClone(재료)
    aggregateMetrics(재료)
    expect(재료).toEqual(사본)
  })
})

describe('activity — 활동 한 줄', () => {
  it('이야기·시각·길이·완료 여부를 그대로 담는다', () => {
    const { activity } = aggregateMetrics(보통활동())
    expect(activity).toEqual({
      story_slug: 'fart-bride',
      story_title: '방귀 뀌는 며느리',
      // 글자로 받은 시각은 그대로 흘린다 — `+09:00` 을 `Z` 로 바꾸지 않는다.
      played_at: '2026-08-03T19:12:00+09:00',
      duration_minutes: 24,
      completed: true,
      prior_activities: 2,
    })
  })

  it('중간에 그만둔 활동은 completed=false 이고 길이를 last_activity_at 까지로 잰다', () => {
    const 재료 = 재료세우기({
      session: {
        status: 'stopped',
        started_at: '2026-08-05T18:04:00+09:00',
        completed_at: null,
        last_activity_at: '2026-08-05T18:13:00+09:00',
      },
    })
    const { activity } = aggregateMetrics(재료)
    expect(activity.completed).toBe(false)
    expect(activity.duration_minutes).toBe(9)
  })

  it('Date 로 받아도 같은 자리를 채운다', () => {
    const 재료 = 재료세우기({
      session: {
        status: 'completed',
        started_at: new Date('2026-08-03T10:12:00Z'),
        completed_at: new Date('2026-08-03T10:36:00Z'),
        last_activity_at: new Date('2026-08-03T10:36:00Z'),
      },
    })
    const { activity } = aggregateMetrics(재료)
    expect(activity.played_at).toBe('2026-08-03T10:12:00.000Z')
    expect(activity.duration_minutes).toBe(24)
  })
})

describe('axes — 감지된 발화 수 그대로 (R17)', () => {
  it('축 점수는 그 축에 묶인 요소가 감지된 발화 수의 합이다', () => {
    const { axes } = aggregateMetrics(보통활동())
    expect(axes.감정표현).toEqual({ score: 2, parts: { EMOTION: 2 } })
    expect(axes.생각과이유).toEqual({
      score: 1,
      parts: { DECISION: 0, REASON: 1 },
    })
    expect(axes.결과와해결).toEqual({
      score: 3,
      parts: { SOLUTION: 2, RESULT: 1 },
    })
    expect(axes.관점과공감).toEqual({
      score: 2,
      parts: { PERSPECTIVE: 1, EMPATHY: 1 },
    })
  })

  it('한 번도 안 나온 요소도 parts 에 0 으로 남는다 (시안 표가 그대로 보여 준다)', () => {
    const { axes } = aggregateMetrics(보통활동())
    expect(axes.생각과이유.parts).toHaveProperty('DECISION', 0)
  })

  it('같은 요소가 근거만 달리해 두 번 와도 그 발화에서 한 번만 센다', () => {
    const 발화 = 아이행('m-1', 1, 'sid-03', '무서웠고 창피했어요.')
    발화.analysis.detected_elements = [
      { type: 'EMOTION', evidence: '무서웠고' },
      { type: 'EMOTION', evidence: '창피했어요' },
    ]
    const { axes } = aggregateMetrics(
      재료세우기({ messages: [발화.message], analyses: [발화.analysis] }),
    )
    expect(axes.감정표현.score).toBe(1)
  })

  it('REQUEST 만 잡힌 발화는 어느 축도 올리지 않는다 (R4)', () => {
    const 발화 = 아이행('m-1', 1, 'sid-03', '시아버지한테 사과하라고 하세요.', {
      elements: ['REQUEST'],
    })
    const { axes } = aggregateMetrics(
      재료세우기({ messages: [발화.message], analyses: [발화.analysis] }),
    )
    for (const 축 of Object.values(axes)) expect(축.score).toBe(0)
  })

  it('캐릭터 대사는 세지 않는다', () => {
    const { axes, counts } = aggregateMetrics(
      재료세우기({ messages: [캐릭터행('c-1', 1, 'sid-03', '부끄러웠구나.')] }),
    )
    expect(counts.child_utterances).toBe(0)
    expect(axes.감정표현.score).toBe(0)
  })
})

describe('상호작용 축 — 대화 지표 셋 (R4)', () => {
  it('child_questions 는 QUESTION 인 아이 발화 수다', () => {
    const { axes } = aggregateMetrics(보통활동())
    expect(axes.상호작용.parts.child_questions).toBe(1)
  })

  it('GUIDED 다음 발화가 VALID 일 때만 reprompt_recovered 가 오른다', () => {
    // 보통활동: m-105(SHORT)가 GUIDED → 다음 아이 발화 m-107 이 VALID → 1
    expect(aggregateMetrics(보통활동()).axes.상호작용.parts.reprompt_recovered).toBe(1)
  })

  it('GUIDED 다음 발화가 VALID 가 아니면 안 오른다', () => {
    const 발화들 = [
      아이행('m-1', 1, 'sid-03', '몰라요', { validity: 'SHORT' }),
      아이행('m-2', 3, 'sid-03', '음…', { validity: 'UNCLEAR' }),
    ]
    const { axes } = aggregateMetrics(
      재료세우기({
        messages: 발화들.map((것) => 것.message),
        analyses: 발화들.map((것) => 것.analysis),
        turn_conditions: [{ message_id: 'm-1', response_mode: 'GUIDED' }],
      }),
    )
    expect(axes.상호작용.parts.reprompt_recovered).toBe(0)
  })

  it('앞턴이 GUIDED 가 아니면 다음이 VALID 여도 안 오른다', () => {
    const 발화들 = [
      아이행('m-1', 1, 'sid-03', '몰라요', { validity: 'SHORT' }),
      아이행('m-2', 3, 'sid-03', '창피해서요.', { elements: ['REASON'] }),
    ]
    const 재료 = (모드: 턴조건행[]) =>
      재료세우기({
        messages: 발화들.map((것) => 것.message),
        analyses: 발화들.map((것) => 것.analysis),
        turn_conditions: 모드,
      })
    expect(
      aggregateMetrics(재료([{ message_id: 'm-1', response_mode: 'NORMAL' }])).axes.상호작용.parts
        .reprompt_recovered,
    ).toBe(0)
    expect(
      aggregateMetrics(재료([{ message_id: 'm-1', response_mode: 'GUIDED' }])).axes.상호작용.parts
        .reprompt_recovered,
    ).toBe(1)
  })

  it('점수는 세 칸의 합이고 child_turns 는 context 로만 담긴다', () => {
    const { axes } = aggregateMetrics(보통활동())
    // 보통활동의 `turn_conditions` 에는 soft-cue 가 없다 → 셋째 항 0.
    expect(axes.상호작용.parts.soft_cue_answered).toBe(0)
    expect(axes.상호작용.score).toBe(2) // 질문 1 + 회복 1 + cue 0
    expect(axes.상호작용.context).toEqual({ child_turns: 7 })
  })

  it('말수가 늘어도 상호작용 점수는 안 오른다 — 「많이 말했나」를 재지 않는다', () => {
    const 많이 = Array.from({ length: 20 }, (_, i) =>
      아이행(`m-${i}`, i, 'sid-03', '네.', { validity: 'SHORT' }),
    )
    const { axes } = aggregateMetrics(
      재료세우기({
        messages: 많이.map((것) => 것.message),
        analyses: 많이.map((것) => 것.analysis),
      }),
    )
    expect(axes.상호작용.score).toBe(0)
    expect(axes.상호작용.context).toEqual({ child_turns: 20 })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 🔴 헤맨 적 없는 아이 — 이 절이 되돌아오면 오각형이 다시 거꾸로 선다
//
// 2026-08-15 목데이터 실측에서 드러난 것: `reprompt_recovered` 는 **먼저 헤매야** 얻는
// 점수라, 처음부터 잘 답한 아이의 상호작용이 **영영 0** 이었다. 말을 가장 풍부하게 한
// 아이(다른 축 7~9)가 상호작용 0%, 3마디 하고 그만둔 아이가 100% 로 그려졌다.
// `soft_cue_answered` 가 그것을 푼 항이고, 아래가 그 항이 사라지지 않게 박은 못이다.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 한 번도 안 헤맨 아이의 활동. **`GUIDED` 가 한 턴도 없다.**
 *
 * 캐릭터가 잘 답한 아이에게도 걱정 한 줄을 얹고(soft-cue), 아이가 그 요소로 곧바로 답한다.
 */
function 안헤맨활동(): 집계재료 {
  const 발화들 = [
    아이행('s-1', 2, 'sid-03', '며느리가 방귀를 참았어요.', { elements: ['PERSPECTIVE'] }),
    아이행('s-2', 4, 'sid-03', '말 못 해서 답답했을 거예요.', { elements: ['EMPATHY'] }),
    아이행('s-3', 6, 'sid-03', '가족한테 말하면 돼요.', { elements: ['SOLUTION'] }),
    아이행('s-4', 8, 'sid-03', '그럼 배가 안 아파요.', { elements: ['RESULT'] }),
  ]
  return 재료세우기({
    messages: 발화들.map((것) => 것.message),
    analyses: 발화들.map((것) => 것.analysis),
    turn_conditions: [
      { message_id: 's-1', response_mode: 'NORMAL', soft_cue: true, guidance_target: 'EMPATHY' },
      { message_id: 's-2', response_mode: 'NORMAL', soft_cue: true, guidance_target: 'SOLUTION' },
      { message_id: 's-3', response_mode: 'NORMAL', soft_cue: true, guidance_target: 'RESULT' },
      { message_id: 's-4', response_mode: 'CLOSING', soft_cue: false, guidance_target: null },
    ],
  })
}

describe('🔴 한 번도 안 헤맨 아이도 상호작용 점수를 얻는다', () => {
  it('GUIDED 가 한 턴도 없어도 점수가 0 이 아니다', () => {
    const { axes } = aggregateMetrics(안헤맨활동())
    expect(axes.상호작용.parts.reprompt_recovered).toBe(0) // 헤맨 적이 없다
    expect(axes.상호작용.parts.child_questions).toBe(0) // 묻지도 않았다
    expect(axes.상호작용.parts.soft_cue_answered).toBe(3)
    expect(axes.상호작용.score).toBe(3)
  })

  it('잘 답한 아이가 헤맨 아이보다 낮게 나오지 않는다 — 순서가 뒤집히지 않는다', () => {
    // 헤맨 쪽: 두 턴 다 저정보였다가 유도를 받고 한 번 살아났다. 사고 요소는 하나뿐이다.
    const 헤맨발화들 = [
      아이행('w-1', 2, 'sid-03', '몰라요', { validity: 'SHORT' }),
      아이행('w-2', 4, 'sid-03', '음….', { validity: 'UNCLEAR' }),
      아이행('w-3', 6, 'sid-03', '참았어요.', { elements: ['PERSPECTIVE'] }),
    ]
    const 헤맨활동 = 재료세우기({
      messages: 헤맨발화들.map((것) => 것.message),
      analyses: 헤맨발화들.map((것) => 것.analysis),
      turn_conditions: [
        { message_id: 'w-1', response_mode: 'NORMAL', soft_cue: false, guidance_target: null },
        {
          message_id: 'w-2',
          response_mode: 'GUIDED',
          soft_cue: false,
          guidance_target: 'PERSPECTIVE',
        },
        { message_id: 'w-3', response_mode: 'CLOSING', soft_cue: false, guidance_target: null },
      ],
    })

    const 잘함 = aggregateMetrics(안헤맨활동()).axes
    const 헤맴 = aggregateMetrics(헤맨활동).axes

    // 다른 네 축은 잘 답한 쪽이 높다 — 그러면 상호작용도 낮아서는 안 된다.
    expect(잘함.관점과공감.score).toBeGreaterThan(헤맴.관점과공감.score)
    expect(잘함.상호작용.score).toBeGreaterThanOrEqual(헤맴.상호작용.score)
  })
})

describe('soft_cue_answered — 걱정 한 줄에 곧바로 답한 발화', () => {
  /** 두 턴짜리 최소 활동. 앞 턴의 판정만 갈아 끼워 가며 잰다. */
  const 두턴 = (앞턴: 턴조건행, 뒷요소: string[]) => {
    const 발화들 = [
      아이행('c-1', 2, 'sid-03', '며느리가 방귀를 참았어요.', { elements: ['PERSPECTIVE'] }),
      아이행('c-2', 4, 'sid-03', '답답했을 거예요.', { elements: 뒷요소 }),
    ]
    return aggregateMetrics(
      재료세우기({
        messages: 발화들.map((것) => 것.message),
        analyses: 발화들.map((것) => 것.analysis),
        turn_conditions: [앞턴],
      }),
    ).axes.상호작용.parts.soft_cue_answered
  }

  const cue턴: 턴조건행 = {
    message_id: 'c-1',
    response_mode: 'NORMAL',
    soft_cue: true,
    guidance_target: 'EMPATHY',
  }

  it('걱정이 가리킨 요소를 다음 발화가 말하면 오른다', () => {
    expect(두턴(cue턴, ['EMPATHY'])).toBe(1)
  })

  it('다음 발화가 다른 요소만 말하면 안 오른다 — 「살아났나」가 아니라 「그 말에 답했나」다', () => {
    expect(두턴(cue턴, ['REASON'])).toBe(0)
  })

  it('soft_cue 가 아니면 guidance_target 이 있어도 안 오른다 — 회복과 겹치지 않는다', () => {
    // GUIDED 턴에도 `guidance_target` 은 남는다. 그것까지 세면 `reprompt_recovered` 와
    // 같은 사건을 두 번 세게 된다.
    expect(두턴({ ...cue턴, response_mode: 'GUIDED', soft_cue: false }, ['EMPATHY'])).toBe(0)
  })

  it('soft_cue 인데 대상이 없으면 안 오른다', () => {
    expect(두턴({ ...cue턴, guidance_target: null }, ['EMPATHY'])).toBe(0)
  })

  it('부르는 쪽이 두 칸을 안 주면 0 이다 — 옛 읽기도 터지지 않는다', () => {
    expect(두턴({ message_id: 'c-1', response_mode: 'NORMAL' }, ['EMPATHY'])).toBe(0)
  })
})

describe('미션 발화도 센다 (R23)', () => {
  const 시도: 미션시도행 = { id: 'ms-1', scene_id: 'sid-07', title: '배 따기' }

  function 미션아이행(
    id: string,
    turn_order: number,
    text: string,
    분석: { intent?: string; elements?: string[]; validity?: string } = {},
  ): 미션발화행 {
    return {
      id,
      mission_session_id: 'ms-1',
      turn_order,
      speaker_type: 'child',
      text,
      analysis: {
        child_intent: 분석.intent ?? 'OPINION',
        detected_elements: (분석.elements ?? []).map((type) => ({
          type,
          evidence: null,
        })),
        utterance_validity: 분석.validity ?? 'VALID',
      },
    }
  }

  const 미션있는활동 = (): 집계재료 => {
    const 재료 = 보통활동()
    return {
      ...재료,
      mission_sessions: [시도],
      mission_messages: [
        미션아이행('mm-1', 1, '막대기로 배를 딸래요.', {
          elements: ['SOLUTION'],
        }),
        미션아이행('mm-2', 3, '배가 어디 있어요?', { intent: 'QUESTION' }),
        {
          id: 'mm-3',
          mission_session_id: 'ms-1',
          turn_order: 2,
          speaker_type: 'character',
          text: '좋은 생각이야!',
          analysis: null,
        },
      ],
    }
  }

  it('child_utterances 에 미션 발화가 더해진다', () => {
    expect(aggregateMetrics(보통활동()).counts.child_utterances).toBe(7)
    expect(aggregateMetrics(미션있는활동()).counts.child_utterances).toBe(9)
  })

  it('축 점수에도 미션 발화가 반영된다', () => {
    expect(aggregateMetrics(보통활동()).axes.결과와해결.parts.SOLUTION).toBe(2)
    expect(aggregateMetrics(미션있는활동()).axes.결과와해결.parts.SOLUTION).toBe(3)
  })

  it('미션 안 질문도 child_questions 에 든다', () => {
    expect(aggregateMetrics(미션있는활동()).axes.상호작용.parts.child_questions).toBe(2)
  })

  it('미션은 turn_conditions 가 없으므로 child_turns 와 reprompt_recovered 를 안 건드린다', () => {
    const { axes } = aggregateMetrics(미션있는활동())
    expect(axes.상호작용.context).toEqual({ child_turns: 7 })
    expect(axes.상호작용.parts.reprompt_recovered).toBe(1)
  })

  it('미션 발화의 scene_label 은 「미션 · 배 따기」다 (M7 확정)', () => {
    const 인용 = aggregateMetrics(미션있는활동()).quotes.find((것) => 것.message_id === 'mm-1')
    expect(인용?.scene_label).toBe('미션 · 배 따기')
    // 장면 코드는 그 미션이 끼어든 대화 장면 그대로다.
    expect(인용?.scene_code).toBe('sc_banggui_07')
  })
})

describe('quotes — 인용 후보 (이 목록 밖은 인용될 수 없다)', () => {
  it('VALID 이고 요소가 잡힌 발화만 후보다', () => {
    const { quotes } = aggregateMetrics(보통활동())
    expect(quotes.map((것) => 것.message_id)).toEqual(['m-101', 'm-107', 'm-121', 'm-123', 'm-125'])
  })

  it('「몰라요」 같은 발화는 후보에 없다', () => {
    const { quotes } = aggregateMetrics(보통활동())
    expect(quotes.map((것) => 것.text)).not.toContain('몰라요')
  })

  it('본 대화 발화의 scene_label 은 「장면 N · 이름」이다', () => {
    const 인용 = aggregateMetrics(보통활동()).quotes[0]
    expect(인용.scene_code).toBe('sc_banggui_03')
    expect(인용.scene_label).toBe('장면 3 · 방귀를 참는 며느리')
    expect(인용.elements).toEqual(['EMOTION'])
  })

  it('장면 이름이 없으면 번호까지만 낸다 — 빈 이름을 지어내지 않는다', () => {
    const 발화 = 아이행('m-1', 1, 'sid-03', '부끄러웠어요.', {
      elements: ['EMOTION'],
    })
    const { quotes } = aggregateMetrics(
      재료세우기({
        scenes: [{ id: 'sid-03', code: 'sc_banggui_03', scene_order: 3 }],
        messages: [발화.message],
        analyses: [발화.analysis],
      }),
    )
    expect(quotes[0].scene_label).toBe('장면 3')
  })
})

describe('words.asked — 질문한 낱말은 규칙이 센다 (R15)', () => {
  it('QUESTION 발화 원문에 장면 낱말이 있으면 뜻과 함께 담는다', () => {
    const { words, counts } = aggregateMetrics(보통활동())
    expect(words.asked).toEqual([
      { word: '며느리', meaning: '아들의 아내', scene_code: 'sc_banggui_03' },
    ])
    expect(counts.asked_words).toBe(1)
  })

  it('QUESTION 이 아닌 발화에 그 낱말이 있어도 세지 않는다', () => {
    const 발화 = 아이행('m-1', 1, 'sid-03', '며느리가 착해요.', {
      intent: 'OPINION',
    })
    const { words } = aggregateMetrics(
      재료세우기({ messages: [발화.message], analyses: [발화.analysis] }),
    )
    expect(words.asked).toEqual([])
  })

  it('다른 장면에서 물어도 센다 — scene_code 는 물어본 자리다', () => {
    const 발화 = 아이행('m-1', 1, 'sid-07', '며느리가 뭐예요?', {
      intent: 'QUESTION',
    })
    const { words } = aggregateMetrics(
      재료세우기({ messages: [발화.message], analyses: [발화.analysis] }),
    )
    expect(words.asked).toEqual([
      { word: '며느리', meaning: '아들의 아내', scene_code: 'sc_banggui_07' },
    ])
  })

  it('같은 낱말을 두 번 물어도 한 번만 담는다', () => {
    const 발화들 = [
      아이행('m-1', 1, 'sid-03', '며느리가 뭐예요?', { intent: 'QUESTION' }),
      아이행('m-2', 3, 'sid-03', '며느리는 왜 참아요?', { intent: 'QUESTION' }),
    ]
    const { words, counts } = aggregateMetrics(
      재료세우기({
        messages: 발화들.map((것) => 것.message),
        analyses: 발화들.map((것) => 것.analysis),
      }),
    )
    expect(words.asked).toHaveLength(1)
    expect(counts.asked_words).toBe(1)
  })

  it('vocabulary 칸이 아직 없는 장면(#35 이전)에서도 안 터진다', () => {
    const 발화 = 아이행('m-1', 1, 'sid-03', '며느리가 뭐예요?', {
      intent: 'QUESTION',
    })
    const { words } = aggregateMetrics(
      재료세우기({
        scenes: [{ id: 'sid-03', code: 'sc_banggui_03', scene_order: 3 }],
        messages: [발화.message],
        analyses: [발화.analysis],
      }),
    )
    expect(words.asked).toEqual([])
  })
})

describe('낱말 — LLM 이 뽑기 전에는 비어 있다 (명세 4.3 순서)', () => {
  it('aggregateMetrics 만으로는 main·repeated·new 가 빈 목록이다', () => {
    const { words, counts } = aggregateMetrics(보통활동())
    expect(words.main).toEqual([])
    expect(words.repeated).toEqual([])
    expect(words.new).toEqual([])
    expect(counts.new_words).toBe(0)
  })

  it('applyExtractedWords 가 낱말을 얹고 새 낱말을 가린다', () => {
    const 재료 = 보통활동()
    const 지표 = applyExtractedWords(aggregateMetrics(재료), 재료, {
      extracted: ['부끄럽다', '창피하다', '흔들다'],
      repeated: ['왜냐하면'],
      child_words: ['부끄럽다'],
    })
    expect(지표.words.main).toEqual([
      { word: '부끄럽다', count: 1 },
      { word: '창피하다', count: 1 },
      { word: '흔들다', count: 1 },
    ])
    expect(지표.words.repeated).toEqual([{ phrase: '왜냐하면', count: 1 }])
    // 「부끄럽다」는 누적에 이미 있으므로 새 낱말이 아니다.
    expect(지표.words.new).toEqual([
      { word: '창피하다', first_scene_code: 'sc_banggui_03' },
      { word: '흔들다', first_scene_code: 'sc_banggui_07' },
    ])
    expect(지표.counts.new_words).toBe(2)
  })

  it('발화에 없는 낱말은 버린다 (명세 5.3 ②)', () => {
    const 재료 = 보통활동()
    const 지표 = applyExtractedWords(aggregateMetrics(재료), 재료, {
      extracted: ['용감하다'],
      repeated: ['그러니까'],
      child_words: [],
    })
    expect(지표.words.main).toEqual([])
    expect(지표.words.repeated).toEqual([])
    expect(지표.counts.new_words).toBe(0)
  })

  it('첫 활동이면 쓴 낱말이 전부 새 낱말이 된다 (누적이 비어 있다)', () => {
    const 재료 = { ...보통활동(), prior_activities: 0 }
    const 지표 = applyExtractedWords(aggregateMetrics(재료), 재료, {
      extracted: ['부끄럽다', '창피하다'],
      repeated: [],
      child_words: [],
    })
    expect(지표.activity.prior_activities).toBe(0)
    expect(지표.counts.new_words).toBe(2)
  })

  it('받은 지표를 고치지 않고 새 값을 돌려준다', () => {
    const 재료 = 보통활동()
    const 원본 = aggregateMetrics(재료)
    const 얹은 = applyExtractedWords(원본, 재료, {
      extracted: ['부끄럽다'],
      repeated: [],
      child_words: [],
    })
    expect(원본.words.main).toEqual([])
    expect(얹은.words.main).toHaveLength(1)
    // 규칙이 세는 칸은 그대로 흘러간다.
    expect(얹은.axes).toEqual(원본.axes)
    expect(얹은.words.asked).toEqual(원본.words.asked)
  })

  it('두 번 얹어도 같은 값이다', () => {
    const 재료 = 보통활동()
    const 낱말 = {
      extracted: ['부끄럽다'],
      repeated: ['왜냐하면'],
      child_words: [],
    }
    const 지표 = aggregateMetrics(재료)
    expect(applyExtractedWords(지표, 재료, 낱말)).toEqual(applyExtractedWords(지표, 재료, 낱말))
  })
})

describe('대조형들 — 기본형과 발화형을 잇는 자리', () => {
  it('「다」를 떼고 받침·끝글자를 차례로 깎는다', () => {
    expect(대조형들('부끄럽다')).toEqual(['부끄럽다', '부끄럽', '부끄러', '부끄'])
    expect(대조형들('신기하다')).toEqual(['신기하다', '신기하', '신기'])
    expect(대조형들('참다')).toEqual(['참다', '참'])
  })

  it('두 글자 밑으로는 안 내려간다 — 「참」이 「차」가 되면 「차를 마셨어요」에 걸린다', () => {
    for (const 형 of 대조형들('참다')) expect(형).not.toBe('차')
  })

  it('불규칙 활용을 건진다', () => {
    const 발화 = 아이행('m-1', 1, 'sid-03', '무서웠어요. 정말 신기했어요.')
    const 재료 = 재료세우기({
      messages: [발화.message],
      analyses: [발화.analysis],
    })
    const 지표 = applyExtractedWords(aggregateMetrics(재료), 재료, {
      extracted: ['무섭다', '신기하다'],
      repeated: [],
      child_words: [],
    })
    expect(지표.words.main).toEqual([
      { word: '무섭다', count: 1 },
      { word: '신기하다', count: 1 },
    ])
  })

  it('한 낱말을 대조형마다 겹쳐 세지 않는다', () => {
    // 「부끄럽다」는 ①부끄럽다 ②부끄럽 ③부끄러 ④부끄 가 모두 이 글에 걸리지만 3이 아니라 1이다.
    const 발화 = 아이행('m-1', 1, 'sid-03', '부끄럽다고 했어요.')
    const 재료 = 재료세우기({
      messages: [발화.message],
      analyses: [발화.analysis],
    })
    const 지표 = applyExtractedWords(aggregateMetrics(재료), 재료, {
      extracted: ['부끄럽다'],
      repeated: [],
      child_words: [],
    })
    expect(지표.words.main).toEqual([{ word: '부끄럽다', count: 1 }])
  })
})

describe('말이 아주 적은 활동에서도 안 터진다 (R16)', () => {
  const 발화들 = [
    아이행('m-1', 1, 'sid-03', '네', { validity: 'SHORT' }),
    아이행('m-2', 3, 'sid-03', '몰라요', { validity: 'SHORT' }),
    아이행('m-3', 5, 'sid-03', '음…', { validity: 'UNCLEAR' }),
  ]
  const 적은활동 = (): 집계재료 =>
    재료세우기({
      prior_activities: 0,
      messages: 발화들.map((것) => 것.message),
      analyses: 발화들.map((것) => 것.analysis),
    })

  it('발화 3건이면 축이 전부 0 이고 인용 후보가 없다', () => {
    const 지표 = aggregateMetrics(적은활동())
    expect(지표.counts.child_utterances).toBe(3)
    for (const 축 of Object.values(지표.axes)) expect(축.score).toBe(0)
    expect(지표.quotes).toEqual([])
  })

  it('축 다섯이 그래도 다 있고 parts 도 비어 있지 않다', () => {
    const { axes } = aggregateMetrics(적은활동())
    expect(Object.keys(axes)).toEqual([
      '관점과공감',
      '감정표현',
      '생각과이유',
      '결과와해결',
      '상호작용',
    ])
    expect(axes.관점과공감.parts).toEqual({ PERSPECTIVE: 0, EMPATHY: 0 })
  })

  it('발화가 아예 없어도 안 터진다', () => {
    const 지표 = aggregateMetrics(재료세우기())
    expect(지표.counts).toEqual({
      child_utterances: 0,
      new_words: 0,
      asked_words: 0,
    })
    expect(지표.quotes).toEqual([])
    expect(지표.axes.상호작용).toEqual({
      score: 0,
      parts: { child_questions: 0, reprompt_recovered: 0, soft_cue_answered: 0 },
      context: { child_turns: 0 },
    })
  })

  it('prior_activities = 0 인 아이의 결과가 첫 활동으로 나온다', () => {
    expect(aggregateMetrics(적은활동()).activity.prior_activities).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 말하기 후 활동 (이슈 #47 · 후활동 명세 7.2 · 수용 기준 11·12·15)
//
// 재는 것 넷:
//   ① **`null` 세 겹이 서로 다르다** — 안 했다 / 순서만 했다 / 판정을 못 했다
//   ② 칩 차례가 설정의 카드 차례다 (읽어 온 차례가 아니다)
//   ③ 세 갈래(used·similar·missing)를 센다
//   ④ 🔴 **기존 지표가 안 흔들린다** (F15 · 수용 15) — 이 갈래에서 가장 조용히 깨질 자리다
// ═══════════════════════════════════════════════════════════════════════════

/** 「방귀 뀌는 며느리」의 후활동 설정 그대로 — 카드 넉 장 × 단어 셋 (명세 4.1). */
const 후활동_차례: 후활동재료['word_order'] = [
  { card_id: 'endure', word: '시집' },
  { card_id: 'endure', word: '참다' },
  { card_id: 'endure', word: '걱정' },
  { card_id: 'burst', word: '방귀' },
  { card_id: 'burst', word: '깜짝' },
  { card_id: 'burst', word: '기둥' },
  { card_id: 'pear', word: '배나무' },
  { card_id: 'pear', word: '힘껏' },
  { card_id: 'pear', word: '우수수' },
  { card_id: 'pride', word: '당당하다' },
  { card_id: 'pride', word: '칭찬' },
  { card_id: 'pride', word: '고마워' },
]

/** 판정 셋 — 그대로 쓴 낱말 셋 · 비슷하게 말한 둘 · 나머지는 안 나왔다. */
const 판정갈래: Record<string, string> = {
  시집: 'used',
  참다: 'similar',
  걱정: 'missing',
  방귀: 'used',
  깜짝: 'missing',
  기둥: 'missing',
  배나무: 'used',
  힘껏: 'missing',
  우수수: 'missing',
  당당하다: 'similar',
  칭찬: 'missing',
  고마워: 'missing',
}

/**
 * 단어 12행 — DB 가 돌려줄 법한 **뒤섞인** 차례로 세운다.
 *
 * `post_activity_keywords` 에는 순번 칸이 없어서 읽어 온 차례에 뜻이 없다. 일부러
 * 거꾸로 세워 두고, 집계기가 설정의 카드 차례로 다시 세우는지를 본다.
 */
function 단어행들(): 후활동단어행[] {
  return [...후활동_차례].reverse().map(({ card_id, word }) => ({
    card_id,
    word,
    status: 판정갈래[word],
    // 근거는 「비슷한 말로 말했다」에만 있다 — 나머지는 NULL 이다 (명세 4.3)
    evidence: 판정갈래[word] === 'similar' ? `${word} 비슷하게 말한 조각` : null,
  }))
}

function 후활동(
  고칠것: Partial<후활동결과행> = {},
  단어: 후활동단어행[] = 단어행들(),
): 후활동재료 {
  return {
    result: {
      submitted_order: ['endure', 'burst', 'pear', 'pride'],
      is_order_correct: true,
      attempt_count: 2,
      retelling_text: '며느리가 시집에서 방귀를 참았어요.',
      analyzed_at: '2026-08-03T19:40:00+09:00',
      ...고칠것,
    },
    words: 단어,
    word_order: 후활동_차례,
  }
}

describe('말하기 후 활동 — 지표에 덩이 하나가 붙는다 (F16)', () => {
  it('활동을 아예 안 했으면 null 이다 (수용 12)', () => {
    // 재료에 칸이 아예 없는 판(후활동을 모르던 시절의 재료)과 `null` 을 준 판이 같다.
    expect(aggregateMetrics(보통활동()).post_activity).toBeNull()
    expect(aggregateMetrics(재료세우기({ post_activity: null })).post_activity).toBeNull()
  })

  it('순서만 맞추고 나갔으면 retelling 이 null 이다 — 순서는 그대로 실린다', () => {
    const 지표 = aggregateMetrics(
      재료세우기({ post_activity: 후활동({ retelling_text: null, analyzed_at: null }, []) }),
    )

    expect(지표.post_activity?.retelling).toBeNull()
    expect(지표.post_activity?.order).toEqual({
      correct: true,
      attempts: 2,
      first_submission: ['endure', 'burst', 'pear', 'pride'],
    })
  })

  it('🔴 판정을 못 한 것과 낱말을 하나도 안 쓴 것이 다르다', () => {
    // ① 판정 실패 — `analyzed_at` 이 NULL 이다. 아이 말은 남아 있다.
    const 못한판 = aggregateMetrics(
      재료세우기({ post_activity: 후활동({ analyzed_at: null }, []) }),
    ).post_activity

    expect(못한판?.retelling?.analyzed).toBe(false)
    expect(못한판?.retelling?.text).toBe('며느리가 시집에서 방귀를 참았어요.')
    expect(못한판?.retelling?.words).toEqual([])
    expect(못한판?.retelling?.missing).toBe(0)

    // ② 한 낱말도 안 썼다 — 판정은 됐고 12행이 전부 `missing` 이다.
    const 하나도_안쓴판 = aggregateMetrics(
      재료세우기({
        post_activity: 후활동(
          {},
          후활동_차례.map((것) => ({ ...것, status: 'missing', evidence: null })),
        ),
      }),
    ).post_activity

    expect(하나도_안쓴판?.retelling?.analyzed).toBe(true)
    expect(하나도_안쓴판?.retelling?.missing).toBe(12)
    expect(하나도_안쓴판?.retelling?.words).toHaveLength(12)
  })

  it('🔴 판정 시각이 없으면 남아 있는 단어 행을 안 싣는다', () => {
    // 다시 말한 줄거리는 `analyzed_at` 을 NULL 로 되돌린다. 지우다 만 옛 행이 남아 있어도
    // 「이 글을 판정한 결과」가 아니다.
    const 지표 = aggregateMetrics(재료세우기({ post_activity: 후활동({ analyzed_at: null }) }))

    expect(지표.post_activity?.retelling?.analyzed).toBe(false)
    expect(지표.post_activity?.retelling?.words).toEqual([])
  })

  it('단어 12개가 실리고 세 갈래를 센다 (수용 11)', () => {
    const 덩이 = aggregateMetrics(재료세우기({ post_activity: 후활동() })).post_activity

    expect(덩이?.retelling?.words).toHaveLength(12)
    expect(덩이?.retelling?.used).toBe(3)
    expect(덩이?.retelling?.similar).toBe(2)
    expect(덩이?.retelling?.missing).toBe(7)
    // 근거는 「비슷하게」에만 있고 나머지는 NULL 이다 — 빈 글자가 아니다
    const 비슷 = 덩이!.retelling!.words.filter((것) => 것.status === 'similar')
    expect(비슷.map((것) => 것.word)).toEqual(['참다', '당당하다'])
    for (const 것 of 덩이!.retelling!.words) {
      if (것.status === 'similar') expect(것.evidence).not.toBeNull()
      else expect(것.evidence).toBeNull()
    }
  })

  it('⭐ 칩 차례는 읽어 온 차례가 아니라 설정의 카드 차례다', () => {
    const 지표 = aggregateMetrics(재료세우기({ post_activity: 후활동() }))

    expect(지표.post_activity?.retelling?.words.map((것) => 것.word)).toEqual(
      후활동_차례.map((것) => 것.word),
    )
  })

  it('설정을 못 읽었으면(차례가 비었으면) 읽어 온 차례를 그대로 둔다', () => {
    const 뒤섞인 = 단어행들()
    const 지표 = aggregateMetrics(
      재료세우기({ post_activity: { ...후활동(), word_order: [] } }),
    )

    expect(지표.post_activity?.retelling?.words.map((것) => 것.word)).toEqual(
      뒤섞인.map((것) => 것.word),
    )
  })

  it('차례에 없는 단어는 버리지 않고 뒤에 붙인다', () => {
    const 단어 = [
      ...단어행들(),
      { card_id: 'ghost', word: '없던말', status: 'used', evidence: null },
    ]
    const 지표 = aggregateMetrics(재료세우기({ post_activity: 후활동({}, 단어) }))
    const 낱말들 = 지표.post_activity!.retelling!.words.map((것) => 것.word)

    expect(낱말들).toHaveLength(13)
    expect(낱말들[낱말들.length - 1]).toBe('없던말')
  })

  it('순서를 한 번도 안 냈으면 attempts 가 0 이고 첫 제출이 빈 목록이다', () => {
    // 줄거리만 말하고 나간 판 — 결과 행은 있는데 순서 칸이 전부 NULL 이다.
    const 지표 = aggregateMetrics(
      재료세우기({
        post_activity: 후활동({
          submitted_order: null,
          is_order_correct: null,
          attempt_count: 0,
        }),
      }),
    )

    expect(지표.post_activity?.order).toEqual({
      correct: false,
      attempts: 0,
      first_submission: [],
    })
  })

  it('내 봤는데 못 맞춘 것(false)과 아직 안 낸 것(NULL)이 attempts 로 갈린다', () => {
    const 못맞춘 = aggregateMetrics(
      재료세우기({ post_activity: 후활동({ is_order_correct: false, attempt_count: 3 }) }),
    ).post_activity

    expect(못맞춘?.order.correct).toBe(false)
    expect(못맞춘?.order.attempts).toBe(3)
  })

  it('DB CHECK 밖의 status 는 「안 썼다」로 떨어진다 — 색 없는 칩을 만들지 않는다', () => {
    const 지표 = aggregateMetrics(
      재료세우기({
        post_activity: 후활동({}, [
          { card_id: 'endure', word: '시집', status: '이상한값', evidence: '조각' },
        ]),
      }),
    )

    expect(지표.post_activity?.retelling?.words[0].status).toBe('missing')
    expect(지표.post_activity?.retelling?.missing).toBe(1)
  })

  it('같은 입력이면 같은 출력이다', () => {
    const 재료 = 재료세우기({ post_activity: 후활동() })
    expect(aggregateMetrics(재료)).toEqual(aggregateMetrics(재료))
  })
})

describe('🔴 F15 — 후활동을 해도 기존 지표가 한 칸도 안 변한다 (수용 15)', () => {
  // 이 갈래에서 가장 조용히 깨질 수 있는 자리다. 후활동 발화를 `child_utterances` 에
  // 더하거나 낱말 세기에 섞으면 여기서 걸린다.

  it('counts · words · axes · quotes 가 후활동 유무와 무관하게 같다', () => {
    const 없는판 = aggregateMetrics(보통활동())
    const 있는판 = aggregateMetrics({ ...보통활동(), post_activity: 후활동() })

    expect(있는판.counts).toEqual(없는판.counts)
    expect(있는판.words).toEqual(없는판.words)
    expect(있는판.axes).toEqual(없는판.axes)
    expect(있는판.quotes).toEqual(없는판.quotes)
    expect(있는판.activity).toEqual(없는판.activity)
    // 덩이 하나만 늘었다.
    expect(없는판.post_activity).toBeNull()
    expect(있는판.post_activity).not.toBeNull()
  })

  it('후활동 줄거리에만 있는 낱말은 「주요 어휘」로 새지 않는다', () => {
    // 「기둥」은 아이 발화 어디에도 없고 후활동 줄거리에만 있다. 낱말 세기는 본 대화와
    // 미션 발화만 본다 — LLM 이 그 낱말을 뽑아 와도 발화에 없으면 버려진다 (명세 5.3 ②).
    const 재료: 집계재료 = {
      ...보통활동(),
      post_activity: 후활동({ retelling_text: '기둥을 잡고 깜짝 놀랐어요.' }),
    }
    const 지표 = applyExtractedWords(aggregateMetrics(재료), 재료, {
      extracted: ['기둥'],
      repeated: ['깜짝'],
      child_words: [],
    })

    expect(지표.words.main).toEqual([])
    expect(지표.words.repeated).toEqual([])
    expect(지표.counts.new_words).toBe(0)
  })

  it('낱말을 얹어도 후활동 덩이가 그대로 흘러간다', () => {
    const 재료: 집계재료 = { ...보통활동(), post_activity: 후활동() }
    const 원본 = aggregateMetrics(재료)
    const 얹은 = applyExtractedWords(원본, 재료, {
      extracted: ['부끄럽다'],
      repeated: [],
      child_words: [],
    })

    expect(얹은.post_activity).toEqual(원본.post_activity)
  })
})
