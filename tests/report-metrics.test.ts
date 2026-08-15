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

  it('상호작용만 요소가 아니라 대화 지표 둘이다 (R4)', () => {
    expect(축_요소.상호작용).toEqual([])
    expect(상호작용_점수칸).toEqual(['child_questions', 'reprompt_recovered'])
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

describe('상호작용 축 — 대화 지표 둘 (R4)', () => {
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

  it('점수는 두 칸의 합이고 child_turns 는 context 로만 담긴다', () => {
    const { axes } = aggregateMetrics(보통활동())
    expect(axes.상호작용.score).toBe(2) // 질문 1 + 회복 1
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
      parts: { child_questions: 0, reprompt_recovered: 0 },
      context: { child_turns: 0 },
    })
  })

  it('prior_activities = 0 인 아이의 결과가 첫 활동으로 나온다', () => {
    expect(aggregateMetrics(적은활동()).activity.prior_activities).toBe(0)
  })
})
