// 리포트 서술 엔진 (이슈 #37 · `src/report/engine/`) — 재료 두 벌과 **대조 두 가지**.
//
// 🔴 **이 파일이 지키는 것 하나** — 리포트에는 아이 발화가 따옴표 안에 그대로 실린다.
//    LLM 이 없는 발화를 지어내 그 자리를 채우면 보호자는 **자기 아이가 하지 않은 말을
//    아이가 한 말로 읽는다.** 그래서 여기서는 일부러 **틀린 응답**을 넣어, 목록 밖 인용과
//    발화에 없는 낱말이 실제로 버려지는지를 잰다 (명세 11절 · 5.2 · 5.3).
//
// LLM 을 안 부른다. `ReportCall` 을 바꿔치기해 네트워크 없이 **대조 규칙만** 본다 —
// `judge.test.ts` 가 `JudgeCall` 로 하는 것과 같은 방식이다.

import { describe, expect, it } from 'vitest'

import { read } from '@/llm/prompts'
import type { LLMResult } from '@/llm/provider'
import {
  buildReportAnalysisMaterial,
  buildReportGuideMaterial,
  generateNarrative,
  parseAnalysisResponse,
  ReportNarrativeError,
  가정연계_용도,
  걸러낸_가정연계,
  걸러낸_말하기분석,
  낱말_후보들,
  말하기분석_용도,
  모자란_요소,
  발화_뼈대,
  빈_장부,
  축이_세는_요소,
  type ReportCall,
} from '@/report/engine'
import type { ReportMetrics } from '@/report/types'

// ── 재료 ───────────────────────────────────────────────────────────────────

/**
 * 인용 후보 셋. **`scene_label` 의 꼴이 하나가 아니다** — 본 대화는 「장면 N · …」,
 * 미션은 「미션 · …」이다 (미정 M7 이 2026-08-15 에 확정됐다). 결정 R23 이 미션 발화도
 * 세게 했으므로 두 꼴이 **한 목록에 섞여서** 온다.
 */
const 인용후보 = [
  {
    message_id: 'm-101',
    scene_code: 'sc_banggui_03',
    scene_label: '장면 2 · 방귀를 참는 며느리',
    text: '며느리가 부끄러워했어요.',
    elements: ['EMOTION'],
  },
  {
    message_id: 'm-118',
    scene_code: 'sc_banggui_05',
    scene_label: '장면 3 · 들켜버린 큰 방귀',
    text: '며느리가 부끄러워했어요. 왜냐하면 사람들이 이상하게 볼까 봐 무서웠기 때문이에요.',
    elements: ['EMOTION', 'REASON'],
  },
  {
    message_id: 'm-133',
    scene_code: 'sc_banggui_07',
    scene_label: '미션 · 배 따기',
    text: '소쿠리로 배를 받으면 안 깨져요.',
    elements: ['SOLUTION', 'RESULT'],
  },
]

function 지표(고칠것: Partial<ReportMetrics> = {}): ReportMetrics {
  return {
    activity: {
      story_slug: 'fart-bride',
      story_title: '방귀 뀌는 며느리',
      played_at: '2026-08-03T19:12:00+09:00',
      duration_minutes: 24,
      completed: true,
      prior_activities: 2,
    },
    counts: { child_utterances: 12, new_words: 3, asked_words: 1 },
    axes: {
      관점과공감: { score: 0, parts: { PERSPECTIVE: 0, EMPATHY: 0 } },
      감정표현: { score: 2, parts: { EMOTION: 2 } },
      생각과이유: { score: 1, parts: { DECISION: 0, REASON: 1 } },
      결과와해결: { score: 2, parts: { SOLUTION: 1, RESULT: 1 } },
      상호작용: {
        score: 1,
        parts: { child_questions: 0, reprompt_recovered: 1 },
        context: { child_turns: 7 },
      },
    },
    words: {
      main: [{ word: '부끄럽다', count: 2 }],
      asked: [{ word: '며느리', meaning: '아들의 아내', scene_code: 'sc_banggui_03' }],
      repeated: [{ phrase: '왜냐하면', count: 2 }],
      new: [{ word: '소쿠리', first_scene_code: 'sc_banggui_07' }],
    },
    quotes: 인용후보,
    ...고칠것,
  }
}

const 아이 = { name: '지우', age: 7 }

describe('재료 — 프롬프트가 받는 것 (명세 5.2 · 5.4)', () => {
  it('말하기 분석은 metrics 전부 + 아이 이름·나이다', () => {
    const 재료 = JSON.parse(buildReportAnalysisMaterial({ metrics: 지표(), child: 아이 }))

    expect(Object.keys(재료)).toEqual(['child', 'activity', 'counts', 'axes', 'words', 'quotes'])
    expect(재료.child).toEqual({ name: '지우', age: 7 })
    // 이야기 이름은 activity 가, 장면 이름은 quotes 가 나른다 — 따로 실을 자리가 없다.
    expect(재료.activity.story_title).toBe('방귀 뀌는 며느리')
    expect(재료.quotes.map((인용: { scene_label: string }) => 인용.scene_label)).toContain(
      '미션 · 배 따기',
    )
  })

  it('가정 연계는 셋뿐이다 — 숫자·축·낱말을 안 보낸다', () => {
    const 재료 = JSON.parse(buildReportGuideMaterial({ metrics: 지표(), child: 아이 }))

    expect(Object.keys(재료)).toEqual(['child', 'missing_elements', 'quotes'])
    expect(재료.axes).toBeUndefined()
    expect(재료.counts).toBeUndefined()
  })

  it('자리표시자를 안 쓴다 — user 는 JSON 한 덩이다', () => {
    const 재료 = buildReportAnalysisMaterial({ metrics: 지표(), child: 아이 })
    expect(재료.startsWith('{')).toBe(true)
    // 한글을 \uXXXX 로 부풀리지 않는다 (materialJson 한 곳을 지난다는 뜻이다).
    expect(재료).toContain('지우')
  })
})

describe('모자란 요소 (명세 5.4 재료)', () => {
  it('한 번도 안 나온 요소를 준다', () => {
    expect(모자란_요소(지표().axes)).toEqual(['EMPATHY', 'PERSPECTIVE', 'DECISION'])
  })

  it('🔴 REQUEST 는 세지 않는다 — 축이 안 세는 것이라 언제나 0 이다 (결정 R4)', () => {
    expect(축이_세는_요소).not.toContain('REQUEST')
    expect(모자란_요소(지표().axes)).not.toContain('REQUEST')
  })

  it('상호작용 축의 parts 는 요소가 아니라 지나친다', () => {
    // `child_questions` 가 요소로 새면 8요소가 아닌 코드가 프롬프트로 나간다.
    expect(모자란_요소(지표().axes)).not.toContain('child_questions')
  })

  it('전부 한 번씩 나왔으면 가장 적게 나온 쪽을 준다', () => {
    const axes = 지표().axes
    axes.관점과공감 = { score: 5, parts: { PERSPECTIVE: 3, EMPATHY: 2 } }
    axes.생각과이유 = { score: 6, parts: { DECISION: 1, REASON: 5 } }

    // 0 인 요소가 하나도 없다 → 최솟값(1)로 묶인 셋. 최대 셋까지만 준다.
    expect(모자란_요소(axes)).toEqual(['SOLUTION', 'RESULT', 'DECISION'])
  })
})

// ── 대조 ① 인용 id ─────────────────────────────────────────────────────────

function 말하기_응답(고칠것: Record<string, unknown> = {}) {
  return {
    overall: '감정 표현이 잘 드러났어요',
    cards: [
      {
        axis: '어휘',
        summary: '마음 낱말을 골라 썼어요',
        quote_message_id: 'm-101',
        did_well: '마음을 나타내는 낱말이 나왔어요',
        to_improve: '더 구체적인 낱말을 함께 찾아보면 좋아요',
      },
      {
        axis: '표현',
        summary: '인물의 말을 흉내 냈어요',
        quote_message_id: 'm-118',
        did_well: '인물이 되어 말한 자리가 있었어요',
        to_improve: '장면을 설명하는 말도 덧붙이면 좋아요',
      },
      {
        axis: '논리',
        summary: '이유를 붙여 말했어요',
        quote_message_id: 'm-118',
        did_well: '이유를 붙인 문장이 나왔어요',
        to_improve: '결과까지 이어 말해보면 좋아요',
      },
    ],
    highlight: { quote_message_id: 'm-118', why: '마음과 까닭을 한 문장으로 이었어요' },
    word_tip: '오늘 저녁에 「부끄럽다」 대신 쓸 말을 찾아보면 좋아요',
    words: { extracted: ['부끄럽다', '며느리', '소쿠리'], repeated: ['왜냐하면'] },
    ...고칠것,
  }
}

function 안내_응답(고칠것: Record<string, unknown> = {}) {
  return {
    reason: '이유·결과를 묻는 질문으로 골랐어요',
    story_questions: [
      {
        element: 'EMPATHY',
        scene_code: 'sc_banggui_03',
        quote_message_id: 'm-101',
        question: '며느리는 그때 어떤 마음이었을까?',
        fallback: '"몰라"라고 한다면 — "지우라면 그때 어땠을 것 같아?"',
      },
      {
        element: 'PERSPECTIVE',
        scene_code: 'sc_banggui_05',
        quote_message_id: 'm-118',
        question: '가족들은 그때 어떤 마음이었을까?',
        fallback: '짧게 답한다면 — "지우가 시아버지였다면 뭐라고 했을까?"',
      },
      {
        element: 'RESULT',
        scene_code: 'sc_banggui_07',
        quote_message_id: 'm-133',
        question: '배를 딴 다음에는 어떻게 됐을까?',
        fallback: '막힌다면 — "마을 사람들은 뭐라고 했을까?"',
      },
    ],
    daily_questions: [
      { label: '내 경험과 이유', question: '지우도 부끄러웠던 적 있어?', goal: '자기 경험의 원인을 설명해보기' },
      { label: '이해와 배려', question: '친구가 부끄러워하면 뭐라고 말해줄 거야?', goal: '다른 사람의 감정을 헤아려보기' },
      { label: '결과 예상', question: '그렇게 말해주면 친구 기분은 어떨까?', goal: '행동 이후의 결과를 예상해보기' },
    ],
    ...고칠것,
  }
}

describe('🔴 대조 ① 인용 id — 목록 밖이면 버린다 (명세 5.2)', () => {
  it('카드의 목록 밖 인용은 null 이 되고 카드는 남는다', () => {
    const 장부 = 빈_장부()
    const 응답 = 말하기_응답({
      cards: 말하기_응답().cards.map((카드, 자리) =>
        자리 === 1 ? { ...카드, quote_message_id: 'm-지어냄' } : 카드,
      ),
    })

    const { part } = 걸러낸_말하기분석(parseAnalysisResponse(JSON.stringify(응답)), 지표(), 장부)

    expect(part.cards).toHaveLength(3)
    expect(part.cards[1].axis).toBe('표현')
    expect(part.cards[1].quote_message_id).toBeNull()
    // 문장은 그대로 남는다 — 인용만 버린다.
    expect(part.cards[1].summary).toBe('인물의 말을 흉내 냈어요')
    expect(장부.card_quotes).toEqual(['표현'])
  })

  it('목록 안의 인용은 그대로 남는다', () => {
    const 장부 = 빈_장부()
    const { part } = 걸러낸_말하기분석(
      parseAnalysisResponse(JSON.stringify(말하기_응답())),
      지표(),
      장부,
    )

    expect(part.cards.map((카드) => 카드.quote_message_id)).toEqual(['m-101', 'm-118', 'm-118'])
    expect(장부.card_quotes).toEqual([])
  })

  it('대표 발화의 인용이 목록 밖이면 대표 발화가 통째로 사라진다', () => {
    const 장부 = 빈_장부()
    const 응답 = 말하기_응답({
      highlight: { quote_message_id: 'm-없음', why: '지어낸 발화' },
    })

    const { part } = 걸러낸_말하기분석(parseAnalysisResponse(JSON.stringify(응답)), 지표(), 장부)

    expect(part.highlight).toBeNull()
    expect(장부.highlight).toBe('m-없음')
  })

  it('카드가 순서를 어겨 와도 어휘·표현·논리 순으로 다시 세운다', () => {
    const 장부 = 빈_장부()
    const 뒤집힌 = [...말하기_응답().cards].reverse()
    const { part } = 걸러낸_말하기분석(
      parseAnalysisResponse(JSON.stringify(말하기_응답({ cards: 뒤집힌 }))),
      지표(),
      장부,
    )

    expect(part.cards.map((카드) => 카드.axis)).toEqual(['어휘', '표현', '논리'])
  })

  it('🔴 이야기 질문은 인용이 목록 밖이면 **질문째** 버린다', () => {
    // 카드와 처리가 다르다 — `StoryQuestion.quote_message_id` 는 null 을 못 받는 칸이라
    // 비울 자리가 없다 (프론트 계약 1절).
    const 장부 = 빈_장부()
    const 응답 = 안내_응답({
      story_questions: 안내_응답().story_questions.map((질문, 자리) =>
        자리 === 0 ? { ...질문, quote_message_id: 'm-지어냄' } : 질문,
      ),
    })

    const 몫 = 걸러낸_가정연계(응답, 지표(), 장부)

    expect(몫.story_questions).toHaveLength(2)
    expect(몫.story_questions.map((질문) => 질문.quote_message_id)).toEqual(['m-118', 'm-133'])
    expect(장부.story_questions[0]).toContain('m-지어냄')
  })

  it('8요소 코드가 아닌 element 를 낸 질문도 버린다', () => {
    const 장부 = 빈_장부()
    const 응답 = 안내_응답({
      story_questions: 안내_응답().story_questions.map((질문, 자리) =>
        자리 === 0 ? { ...질문, element: '공감' } : 질문,
      ),
    })

    const 몫 = 걸러낸_가정연계(응답, 지표(), 장부)

    expect(몫.story_questions).toHaveLength(2)
    expect(장부.story_questions[0]).toContain('공감')
  })

  it('scene_code 가 어긋나면 인용의 것으로 덮어쓴다', () => {
    // 배지의 장면과 인용된 발화가 어긋나면 부모가 다른 장면을 아이에게 묻게 된다.
    const 장부 = 빈_장부()
    const 응답 = 안내_응답({
      story_questions: [{ ...안내_응답().story_questions[0], scene_code: 'sc_엉뚱한장면' }],
    })

    const 몫 = 걸러낸_가정연계(응답, 지표(), 장부)

    expect(몫.story_questions[0].scene_code).toBe('sc_banggui_03')
  })

  it('셋을 넘겨 오면 셋만 남는다 (명세 5.4 — 각 3개 고정)', () => {
    const 장부 = 빈_장부()
    const 넷 = [...안내_응답().story_questions, { ...안내_응답().story_questions[0] }]
    const 몫 = 걸러낸_가정연계(안내_응답({ story_questions: 넷 }), 지표(), 장부)

    expect(몫.story_questions).toHaveLength(3)
    expect(몫.daily_questions).toHaveLength(3)
  })
})

// ── 대조 ② 낱말 ────────────────────────────────────────────────────────────

describe('🔴 대조 ② 낱말 — 발화에 없으면 버린다 (결정 R21 · 명세 5.3)', () => {
  it('발화에 없는 낱말을 버리고 있는 것만 남긴다', () => {
    const 장부 = 빈_장부()
    const 응답 = 말하기_응답({
      words: {
        extracted: ['부끄럽다', '당당하다', '며느리', '용감하다'],
        repeated: ['왜냐하면', '그래서'],
      },
    })

    const { words } = 걸러낸_말하기분석(parseAnalysisResponse(JSON.stringify(응답)), 지표(), 장부)

    expect(words.extracted).toEqual(['부끄럽다', '며느리'])
    expect(words.repeated).toEqual(['왜냐하면'])
    expect(장부.words).toEqual(['당당하다', '용감하다'])
    expect(장부.phrases).toEqual(['그래서'])
  })

  it('기본형은 글자 그대로 찾을 수 없다 — 어간을 줄여 가며 찾는다', () => {
    // 「부끄러웠어요」 안에 「부끄럽다」는 없다. 여기서 정확 일치로 대조하면
    // 동사·형용사가 **전부** 버려진다.
    const 뼈대 = 발화_뼈대(인용후보)
    expect(뼈대.includes('부끄럽다')).toBe(false)
    expect(낱말_후보들('부끄럽다')).toEqual(['부끄럽다', '부끄럽', '부끄'])
    expect(낱말_후보들('참다')).toEqual(['참다', '참'])
  })

  it('띄어쓰기와 문장부호가 달라도 찾는다', () => {
    // 아이 발화는 STT 결과라 띄어쓰기가 흔들린다.
    const 장부 = 빈_장부()
    const 응답 = 말하기_응답({ words: { extracted: ['소쿠리'], repeated: [] } })
    const { words } = 걸러낸_말하기분석(parseAnalysisResponse(JSON.stringify(응답)), 지표(), 장부)

    expect(words.extracted).toEqual(['소쿠리'])
  })

  it('같은 낱말이 두 번 와도 한 번만 남는다', () => {
    const 장부 = 빈_장부()
    const 응답 = 말하기_응답({
      words: { extracted: ['며느리', '며느리'], repeated: [] },
    })
    const { words } = 걸러낸_말하기분석(parseAnalysisResponse(JSON.stringify(응답)), 지표(), 장부)

    expect(words.extracted).toEqual(['며느리'])
  })
})

// ── 응답 읽기 ──────────────────────────────────────────────────────────────

describe('응답 읽기', () => {
  it('코드 울타리를 둘러 와도 읽는다', () => {
    const 글 = '```json\n' + JSON.stringify(말하기_응답()) + '\n```'
    expect(parseAnalysisResponse(글).overall).toBe('감정 표현이 잘 드러났어요')
  })

  it('JSON 이 아니면 받은 것을 적어 터진다', () => {
    expect(() => parseAnalysisResponse('미안하지만 못 하겠어요')).toThrow(ReportNarrativeError)
  })

  it('규격에 안 맞으면 터진다 — 조용히 넘기지 않는다', () => {
    const 깨진것 = JSON.stringify({ overall: '한 줄' })
    expect(() => parseAnalysisResponse(깨진것)).toThrow(ReportNarrativeError)
  })

  it('모르는 칸은 버리고 아는 칸만 받는다 (analyze 와 다른 자리)', () => {
    const 곁가지 = JSON.stringify({ ...말하기_응답(), 점수: 88 })
    const 읽은것 = parseAnalysisResponse(곁가지) as Record<string, unknown>
    expect(읽은것.점수).toBeUndefined()
    expect(읽은것.overall).toBe('감정 표현이 잘 드러났어요')
  })
})

// ── 두 편 한꺼번에 ─────────────────────────────────────────────────────────

function 가짜_결과(글: string): LLMResult {
  return { text: 글, provider: 'gemini', model: '가짜', attempts: [] }
}

describe('generateNarrative — 두 편을 동시에 (명세 8절)', () => {
  it('프롬프트 정본 둘을 각각 system 으로 보내고 purpose 는 계약 글자다', async () => {
    const 부른것: { system: string; purpose: string }[] = []
    const call: ReportCall = async (system, _user, options) => {
      부른것.push({ system, purpose: options.purpose })
      return 가짜_결과(
        JSON.stringify(options.purpose === 말하기분석_용도 ? 말하기_응답() : 안내_응답()),
      )
    }

    const 결과 = await generateNarrative({ metrics: 지표(), child: 아이, call })

    expect(부른것.map((것) => 것.purpose).sort()).toEqual([가정연계_용도, 말하기분석_용도].sort())
    expect(부른것.find((것) => 것.purpose === 말하기분석_용도)?.system).toBe(read('report_analysis'))
    expect(부른것.find((것) => 것.purpose === 가정연계_용도)?.system).toBe(read('report_guide'))
    expect(결과.narrative).not.toBeNull()
  })

  it('🔴 차례로가 아니라 **동시에** 부른다', async () => {
    // 두 호출이 다 시작되기 전에는 어느 쪽도 답하지 않게 해 둔다.
    // 차례로 부르면 첫 호출이 영영 안 끝나 이 검사가 멈춘다.
    let 시작한_수 = 0
    let 풀기: () => void = () => {}
    const 둘_다_시작 = new Promise<void>((resolve) => {
      풀기 = resolve
    })

    const call: ReportCall = async (_system, _user, options) => {
      시작한_수 += 1
      if (시작한_수 === 2) 풀기()
      await 둘_다_시작
      return 가짜_결과(
        JSON.stringify(options.purpose === 말하기분석_용도 ? 말하기_응답() : 안내_응답()),
      )
    }

    const 결과 = await generateNarrative({ metrics: 지표(), child: 아이, call })

    expect(시작한_수).toBe(2)
    expect(결과.failed).toEqual({ report_analysis: null, report_guide: null })
  })

  it('한쪽이 실패해도 다른 쪽은 산다 (결정 R9)', async () => {
    const call: ReportCall = async (_system, _user, options) =>
      options.purpose === 말하기분석_용도
        ? 가짜_결과('여기서는 못 하겠어요')
        : 가짜_결과(JSON.stringify(안내_응답()))

    const 결과 = await generateNarrative({ metrics: 지표(), child: 아이, call })

    expect(결과.narrative).not.toBeNull()
    expect(결과.narrative?.story_questions).toHaveLength(3)
    // 실패한 쪽 칸은 빈 채로 온다 — 화면이 안내 문구로 메운다 (결정 R16).
    expect(결과.narrative?.cards).toEqual([])
    expect(결과.narrative?.overall).toBe('')
    expect(결과.words).toBeNull()
    expect(결과.failed.report_analysis).toContain('ReportNarrativeError')
    expect(결과.failed.report_guide).toBeNull()
  })

  it('둘 다 실패하면 narrative 가 null 이다 (결정 R18)', async () => {
    const call: ReportCall = async () => {
      throw new Error('공급자가 다 죽었다')
    }

    const 결과 = await generateNarrative({ metrics: 지표(), child: 아이, call })

    expect(결과.narrative).toBeNull()
    expect(결과.words).toBeNull()
    expect(결과.failed.report_analysis).toContain('공급자가 다 죽었다')
    expect(결과.failed.report_guide).toContain('공급자가 다 죽었다')
    // ⛔ 저장은 이 갈래가 하지 않는다 — status='metrics_only' 는 부르는 쪽이 정한다.
  })

  it('본문을 주면 파일 대신 그것을 보낸다 (「안 주면 파일」)', async () => {
    const 부른것: string[] = []
    const call: ReportCall = async (system, _user, options) => {
      부른것.push(system)
      return 가짜_결과(
        JSON.stringify(options.purpose === 말하기분석_용도 ? 말하기_응답() : 안내_응답()),
      )
    }

    await generateNarrative({
      metrics: 지표(),
      child: 아이,
      call,
      prompts: { report_analysis: '실험 본문' },
    })

    expect(부른것).toContain('실험 본문')
    expect(부른것).toContain(read('report_guide'))
  })

  it('지어낸 인용과 낱말은 한 번에 돌려도 걸러진다', async () => {
    const call: ReportCall = async (_system, _user, options) =>
      가짜_결과(
        JSON.stringify(
          options.purpose === 말하기분석_용도
            ? 말하기_응답({
                highlight: { quote_message_id: 'm-지어냄', why: '없는 말' },
                words: { extracted: ['당당하다'], repeated: [] },
              })
            : 안내_응답({
                story_questions: [
                  { ...안내_응답().story_questions[0], quote_message_id: 'm-지어냄' },
                ],
              }),
        ),
      )

    const 결과 = await generateNarrative({ metrics: 지표(), child: 아이, call })

    expect(결과.narrative?.highlight).toBeNull()
    expect(결과.narrative?.story_questions).toEqual([])
    expect(결과.words).toEqual({ extracted: [], repeated: [] })
    expect(결과.dropped.highlight).toBe('m-지어냄')
    expect(결과.dropped.words).toEqual(['당당하다'])
  })
})
