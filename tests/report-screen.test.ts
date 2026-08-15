// 리포트 화면 어댑터 (이슈 #39) — 서버가 주는 `ParentReport` → 화면이 그리는 `Report`.
//
// ⭐ 재료는 **계약 문서 4절의 샘플 응답 둘**이다 (`docs/보호자_리포트_프론트_계약.md`).
//    그 둘이 이 화면이 마주칠 양극단이다 — 4.1 은 두 탭이 다 차는 판,
//    4.2 는 `narrative: null` · 첫 활동 · 빈 칸이 생기는 판.
//    값은 `/dev/report` 와 **같은 파일**을 본다 (`src/app/dev/report/sample-reports.ts`) —
//    눈으로 본 화면과 검사가 재는 값이 갈리지 않게 하려는 것이다.
//
// ⛔ API 는 부르지 않는다. 어댑터는 순수 함수라 붙일 서버가 없어도 잰다.

import { describe, expect, it } from 'vitest'

import { 사본, 짧게_답한_아이, 잘한_아이 } from '@/app/dev/report/sample-reports'
import { toActivityChoices, toReportView } from '@/lib/report'
import type { ParentReport, PostActivity, ReportListItem } from '@/report/types'

const 지우 = (report: ParentReport) => toReportView('s-1', report, '지우')

describe('계약 4.1 — 두 탭이 다 찬다', () => {
  it('요약 스트립이 서버 숫자를 그대로 받는다', () => {
    const view = 지우(잘한_아이)

    expect(view.summary.title).toBe('지우의 말하기 리포트')
    expect(view.summary.caption).toBe('「방귀 뀌는 며느리」 활동 · 8월 3일 · 24분 대화')
    expect(view.summary.stats).toEqual([
      { label: '말한 문장', value: '32개' },
      // 지난 활동이 둘 있으므로 「새로 쓴 낱말」 그대로다
      { label: '새로 쓴 낱말', value: '7개' },
      { label: '질문한 낱말', value: '4개' },
    ])
  })

  it('역량 카드 셋이 어휘 · 표현 · 논리 순서로 서고 인용이 붙는다', () => {
    const view = 지우(잘한_아이)

    expect(view.skills.map((skill) => skill.name)).toEqual(['어휘', '표현', '논리'])
    expect(view.skillsNotice).toBeNull()
    expect(view.skills[0].quote).toBe('“며느리가 부끄러워했어요.”')
    expect(view.skills[0].good).toBe(
      "'부끄럽다·당당하다' 같은 마음 낱말 7개를 새로 썼어요",
    )
  })

  it('대표 발화가 id 로 찾아져 장면 이름표와 함께 온다', () => {
    const view = 지우(잘한_아이)

    expect(view.highlightNotice).toBeNull()
    expect(view.highlight?.scene).toBe('장면 3 · 들켜버린 큰 방귀')
    expect(view.highlight?.quote).toContain('왜냐하면 사람들이 이상하게 볼까 봐')
  })

  it('가정 연계 탭의 질문 여섯이 다 선다 — 배지는 요소 코드가 아니라 이름이다', () => {
    const view = 지우(잘한_아이)

    expect(view.guide.notice).toBeNull()
    expect(view.guide.story.caption).toBe('「방귀 뀌는 며느리」 속으로')
    expect(view.guide.story.questions).toHaveLength(3)
    expect(view.guide.daily.questions).toHaveLength(3)
    // REASON → 「까닭」 (`src/llm/elements.ts`)
    expect(view.guide.story.questions[0].type).toBe('까닭')
    expect(view.guide.story.questions[0].scene).toBe('장면 2 · 방귀를 참는 며느리')
    expect(view.guide.story.questions[0].quote).toBe('지우: “며느리가 부끄러워했어요.”')
    expect(view.guide.daily.questions[0].type).toBe('내 경험과 이유')
  })

  it('보호자가 소리 내어 읽는 줄에만 따옴표를 씌우고, 이미 있으면 겹치지 않는다', () => {
    const view = 지우(잘한_아이)

    expect(view.guide.story.questions[0].question).toBe(
      '“왜 부끄러웠을까? 이유까지 말해줄래?”',
    )
    // fallback 은 서버가 이미 따옴표를 넣어 준다 — 손대지 않는다
    expect(view.guide.story.questions[0].followUp).toBe(
      '"몰라"라고 한다면 — "지우라면 그때 어땠을 것 같아?"',
    )
  })

  it('어휘 피드백이 강조할 낱말 하나를 갈라 낸다', () => {
    const { feedback } = 지우(잘한_아이).words

    expect(feedback.accent).toBe('신기하다')
    expect(feedback.before).toBe("오늘 저녁에는 '")
    expect(feedback.after).toBe(
      "' 대신 쓸 수 있는 말을 함께 찾아보면 어휘가 더 넓어질 것 같아요",
    )
  })

  it('「대답이 짧을 땐 3단계」는 서버에서 오지 않는다 — 화면 상수로 늘 있다', () => {
    expect(지우(잘한_아이).guide.steps).toHaveLength(3)
    expect(지우(짧게_답한_아이).guide.steps).toHaveLength(3)
  })
})

describe('오각형 — 그 활동 안에서만 정규화한다 (계약 2절 ①)', () => {
  it('🔴 다섯 꼭짓점이 시안의 시계방향 순서를 지킨다 — 서버 선언 순서가 아니다', () => {
    const view = 지우(잘한_아이)

    expect(view.radar.axes.map((axis) => axis.name)).toEqual([
      '관점과 공감',
      '감정 표현',
      '상호작용',
      '생각과 이유',
      '결과와 해결',
    ])
  })

  it('점수(발화 수)를 max 기준 0~100 으로 옮긴다', () => {
    const view = 지우(잘한_아이)

    // 감정표현 7 이 최댓값 → 100. 나머지는 그에 대한 비율
    expect(view.radar.axes.map((axis) => axis.value)).toEqual([86, 100, 86, 71, 57])
    expect(view.radar.notice).toBeNull()
  })

  it('이름으로 찾으므로 서버가 축을 다른 순서로 줘도 자리가 안 바뀐다', () => {
    const 뒤집힌 = 사본(잘한_아이)
    뒤집힌.metrics.axes = Object.fromEntries(
      Object.entries(뒤집힌.metrics.axes).reverse(),
    ) as ParentReport['metrics']['axes']

    expect(지우(뒤집힌).radar.axes.map((axis) => axis.value)).toEqual([
      86, 100, 86, 71, 57,
    ])
  })

  it('색과 이름표 좌표는 화면 상수다 — 서버에서 받지 않는다', () => {
    const [처음] = 지우(잘한_아이).radar.axes

    expect(처음.color).toBe('#6fbcdd')
    expect(처음.label).toEqual({ x: 191, y: 12 })
  })

  it('🔴 축이 전부 0 이면 오각형 대신 안내 문구를 낸다', () => {
    const 말이_없는 = 사본(짧게_답한_아이)
    for (const axis of Object.values(말이_없는.metrics.axes)) axis.score = 0

    const view = 지우(말이_없는)

    expect(view.radar.notice).toContain('그래프를 그리지 못했어요')
    // 0 으로 나누지 않는다 — 값은 전부 0 이다
    expect(view.radar.axes.map((axis) => axis.value)).toEqual([0, 0, 0, 0, 0])
  })

  it('🔴 점수가 선 축이 하나뿐이면 그리지 않는다 — 오각형이 아니라 바늘이 된다 (D1)', () => {
    /* 거의 말 없이 중단한 활동의 꼴 — 발화 3건에 「되묻기 회복」 한 점만 선다.
       활동 안에서 정규화하므로 그 축 혼자 100% 가 되어 바늘 하나가 그려지던 판이다. */
    const 바늘 = 사본(짧게_답한_아이)
    const 축들 = Object.values(바늘.metrics.axes)
    for (const axis of 축들) axis.score = 0
    축들[1].score = 1

    const view = 지우(바늘)

    expect(view.radar.notice).toContain('한 갈래에서만')
    // 축 값 자체는 그대로 옮긴다 — 지표를 손대는 결정이 아니다 (R17)
    expect(view.radar.axes.filter((axis) => axis.value > 0)).toHaveLength(1)
  })

  it('두 축부터는 그린다 — 경계는 발화 수가 아니라 선 축의 개수다', () => {
    const 둘 = 사본(짧게_답한_아이)
    const 축들 = Object.values(둘.metrics.axes)
    for (const axis of 축들) axis.score = 0
    축들[1].score = 1
    축들[3].score = 1

    expect(지우(둘).radar.notice).toBeNull()
  })
})

describe('계약 4.2 — 문장이 없고 첫 활동이다', () => {
  it('첫 활동이면 「새로 쓴 낱말」이 「처음 만난 낱말」이 된다 (계약 2절 ③)', () => {
    const view = 지우(짧게_답한_아이)

    expect(view.summary.stats[1]).toEqual({ label: '처음 만난 낱말', value: '2개' })
  })

  it('문장 칸이 빈 칸이 아니라 안내 문구가 된다 (계약 2절 ②)', () => {
    const view = 지우(짧게_답한_아이)

    expect(view.skills).toEqual([])
    expect(view.highlight).toBeNull()
    // 크게 비는 칸 둘만 「다시 만들기」까지 안내한다 — 한 화면에서 같은 말을 네 번 읽지 않게
    expect(view.skillsNotice).toBe(
      '아직 문장이 만들어지지 않았어요. 위쪽 「다시 만들기」를 눌러 주세요.',
    )
    expect(view.guide.notice).toBe(
      '아직 문장이 만들어지지 않았어요. 위쪽 「다시 만들기」를 눌러 주세요.',
    )
    expect(view.highlightNotice).toBe('아직 문장이 만들어지지 않았어요.')
    expect(view.radar.comment).toBe('아직 문장이 만들어지지 않았어요.')
    expect(view.words.feedback.before).toBe('아직 문장이 만들어지지 않았어요.')
  })

  it('「다시 만들기」를 눈에 띄게 낼 조건이 켜진다', () => {
    expect(지우(짧게_답한_아이).needsNarrative).toBe(true)
    expect(지우(잘한_아이).needsNarrative).toBe(false)
  })

  it('숫자와 낱말은 그대로 있다 — 없는 것은 문장뿐이다', () => {
    const view = 지우(짧게_답한_아이)

    expect(view.summary.caption).toBe('「방귀 뀌는 며느리」 활동 · 8월 5일 · 9분 대화')
    expect(view.words.groups[0].words).toEqual(['무섭다'])
    expect(view.words.groups[2].words).toEqual(['“몰라요”'])
    // 질문한 어휘가 하나도 없다 — 빈 칸 대신 한 줄이 선다 (계약 2절 ④)
    // ⚠️ 낱말은 숫자 쪽이라 「다시 만들기」로 채워지지 않는다 — 문구가 다르다
    expect(view.words.groups[1].words).toEqual([])
    expect(view.words.groups[1].empty).toBe('이번엔 모인 말이 적어요.')
  })

  it('안 읽은 리포트다 — 점을 찍을 조건이 켜진다 (계약 2절 ⑤)', () => {
    expect(지우(짧게_답한_아이).unread).toBe(true)

    const 읽은 = 사본(짧게_답한_아이)
    읽은.read_at = '2026-08-05T20:00:00+09:00'
    expect(지우(읽은).unread).toBe(false)
  })
})

describe('인용은 글자가 아니라 id 로 온다 (계약 1절)', () => {
  it('🔴 `quote_message_id` 가 null 인 카드는 인용 없이 그려진다', () => {
    const 인용_없음 = 사본(잘한_아이)
    인용_없음.narrative!.cards[1].quote_message_id = null

    const view = 지우(인용_없음)

    expect(view.skills[1].quote).toBeNull()
    // 나머지 카드는 그대로다
    expect(view.skills[0].quote).not.toBeNull()
    expect(view.skills[1].summary).toBe('인물의 말을 그대로 흉내 내어 실감나게 말했어요')
  })

  it('목록에 없는 id 가 와도 터지지 않는다 — 인용만 빠진다', () => {
    const 없는_id = 사본(잘한_아이)
    없는_id.narrative!.highlight = { quote_message_id: 'm-999', why: '까닭' }

    const view = 지우(없는_id)

    expect(view.highlight?.quote).toBeNull()
    expect(view.highlight?.scene).toBeNull()
    expect(view.highlightNotice).toBe('이번엔 모인 말이 적어요.')
  })

  it('미션 발화의 장면 이름표를 그대로 찍는다 — 「장면 N ·」 꼴만 오지 않는다 (M7)', () => {
    const 미션 = 사본(잘한_아이)
    미션.metrics.quotes[1].scene_label = '미션 · 배 따기'

    expect(지우(미션).highlight?.scene).toBe('미션 · 배 따기')
  })
})

describe('중단한 활동도 화면을 낸다 (계약 2절 ④)', () => {
  it('문장은 있고 칸만 모자란다 — 안내 문구가 「말이 적어요」로 바뀐다', () => {
    const 중단 = 사본(잘한_아이)
    중단.metrics.activity.completed = false
    중단.narrative!.highlight = null
    중단.narrative!.word_tip = null

    const view = 지우(중단)

    expect(view.highlightNotice).toBe('이번엔 모인 말이 적어요.')
    expect(view.words.feedback.before).toBe('이번엔 모인 말이 적어요.')
    // 화면을 숨기지 않는다 — 나머지는 그대로 찬다
    expect(view.skills).toHaveLength(3)
    expect(view.guide.notice).toBeNull()
  })
})

describe('어휘 칩은 카드 밖으로 넘치지 않게 접는다', () => {
  it('네 개까지 놓고 나머지는 「외 N개」로 센다', () => {
    const 낱말_많음 = 사본(잘한_아이)
    낱말_많음.metrics.words.main = ['가', '나', '다', '라', '마', '바', '사'].map(
      (word) => ({ word, count: 1 }),
    )

    const [주요] = 지우(낱말_많음).words.groups

    expect(주요.words).toEqual(['가', '나', '다', '라'])
    expect(주요.more).toBe('외 3개')
  })

  it('넘치지 않으면 「외 N개」를 달지 않는다', () => {
    expect(지우(잘한_아이).words.groups[1].more).toBeUndefined()
  })
})

describe('상단 활동 드롭다운', () => {
  it('목록 응답을 이름표 · 날짜 · 미읽음 점으로 옮긴다', () => {
    const items: ReportListItem[] = [
      {
        session_id: 's-9',
        story_title: '방귀 뀌는 며느리',
        played_at: '2026-08-05T18:04:00+09:00',
        status: 'metrics_only',
        unread: true,
      },
      {
        session_id: 's-3',
        story_title: '방귀 뀌는 며느리',
        played_at: '2026-08-03T19:12:00+09:00',
        status: 'complete',
        unread: false,
      },
    ]

    expect(toActivityChoices(items)).toEqual([
      { sessionId: 's-9', story: '「방귀 뀌는 며느리」', date: '8월 5일', unread: true },
      { sessionId: 's-3', story: '「방귀 뀌는 며느리」', date: '8월 3일', unread: false },
    ])
  })
})

describe('🔴 한 편만 실패한 리포트 — 빈 글자가 빈 줄로 그려지면 안 된다', () => {
  // 문장을 만드는 LLM 호출이 **두 편**이다 (말하기 분석 · 가정 연계). 한 편만 실패하면
  // `narrative` 가 `null` 이 되는 게 아니라 **실패한 편의 글자 칸만 빈 글자로 채워져** 온다
  // (`src/report/engine/narrative.ts` 의 실패 처리 · 명세 8절 표).
  //
  // `??` 로 받으면 빈 글자가 그대로 지나가 **안내 문구 대신 빈 줄**이 그려진다.
  // `status` 는 `complete` 라 화면이 「문장이 없다」고 알아챌 길도 없다.

  it('가정 연계가 실패한 판 — `reason` 이 빈 글자여도 안내 문구가 나온다', () => {
    const 가이드_실패 = 사본(잘한_아이)
    가이드_실패.narrative!.reason = ''
    가이드_실패.narrative!.story_questions = []
    가이드_실패.narrative!.daily_questions = []

    const view = 지우(가이드_실패)

    expect(view.guide.reason).not.toBe('')
    expect(view.guide.reason.length).toBeGreaterThan(0)
    // 말하기 분석 쪽은 살아 있으므로 「문장이 통째로 없다」가 아니라 「말이 적다」 쪽이다
    expect(view.radar.comment).toBe(잘한_아이.narrative!.overall)
  })

  it('말하기 분석이 실패한 판 — `overall` · `word_tip` 이 빈 글자여도 안내 문구가 나온다', () => {
    const 분석_실패 = 사본(잘한_아이)
    분석_실패.narrative!.overall = ''
    분석_실패.narrative!.word_tip = ''
    분석_실패.narrative!.cards = []

    const view = 지우(분석_실패)

    expect(view.radar.comment).not.toBe('')
    expect(view.radar.comment.length).toBeGreaterThan(0)
    expect(view.words.feedback.before).not.toBe('')
    // 가정 연계 쪽은 살아 있다
    expect(view.guide.reason).toBe(잘한_아이.narrative!.reason)
  })

  it('공백뿐인 글자도 빈 것으로 친다', () => {
    const 공백 = 사본(잘한_아이)
    공백.narrative!.overall = '   '

    expect(지우(공백).radar.comment.trim().length).toBeGreaterThan(0)
    expect(지우(공백).radar.comment).not.toBe('   ')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 말하기 후 활동 카드 (이슈 #47 · 후활동 명세 7.3 · F16)
//
// 🔴 **`null` 이 세 겹이고 셋 다 다르게 그려진다.** 그 갈래가 이 절의 뼈대다:
//   ① `post_activity` 가 없다/`null` → 카드를 **안 그린다**
//   ② `retelling: null`            → 순서 줄만 + 「아직 들려주지 않았어요」
//   ③ `analyzed: false`            → 아이 말은 보여 주고 「담지 못했어요」
//
// 계약 4절 샘플 둘에는 후활동이 없다 — 그게 ①의 재료이고(옛 리포트도 같은 꼴이다),
// 나머지는 사본에 덩이를 얹어 세운다.
// ═══════════════════════════════════════════════════════════════════════════

const 후활동_낱말 = [
  { card_id: 'endure', word: '시집', status: 'used' as const, evidence: null },
  { card_id: 'endure', word: '참다', status: 'similar' as const, evidence: '꾹 눌렀어요' },
  { card_id: 'endure', word: '걱정', status: 'missing' as const, evidence: null },
  { card_id: 'burst', word: '방귀', status: 'used' as const, evidence: null },
  { card_id: 'burst', word: '깜짝', status: 'missing' as const, evidence: null },
  { card_id: 'burst', word: '기둥', status: 'missing' as const, evidence: null },
  { card_id: 'pear', word: '배나무', status: 'used' as const, evidence: null },
  { card_id: 'pear', word: '힘껏', status: 'missing' as const, evidence: null },
  { card_id: 'pear', word: '우수수', status: 'missing' as const, evidence: null },
  { card_id: 'pride', word: '당당하다', status: 'similar' as const, evidence: '어깨를 폈어요' },
  { card_id: 'pride', word: '칭찬', status: 'missing' as const, evidence: null },
  { card_id: 'pride', word: '고마워', status: 'missing' as const, evidence: null },
]

/** 계약 샘플에 후활동 덩이 하나를 얹은 사본. 샘플 자체는 건드리지 않는다. */
function 후활동_붙인(덩이: PostActivity | null, 바탕: ParentReport = 잘한_아이): ParentReport {
  const report = 사본(바탕)
  report.metrics.post_activity = 덩이
  return report
}

function 덩이(고칠것: Partial<PostActivity> = {}): PostActivity {
  return {
    order: { correct: true, attempts: 2, first_submission: ['endure', 'burst', 'pear', 'pride'] },
    retelling: {
      analyzed: true,
      text: '며느리가 시집에서 방귀를 꾹 참았어요.',
      used: 3,
      similar: 2,
      missing: 7,
      words: 후활동_낱말,
    },
    ...고칠것,
  }
}

describe('후활동 카드 — 활동을 했을 때만 그린다 (F16)', () => {
  it('🔴 후활동을 모르는 리포트에는 카드가 없다 — 칸이 아예 없어도 안 터진다', () => {
    // #47 이전에 만들어진 리포트가 이 꼴이다 (`queueReport()` 는 한 번 만들면 다시 안 만든다).
    expect(잘한_아이.metrics.post_activity).toBeUndefined()
    expect(지우(잘한_아이).postActivity).toBeNull()
    expect(지우(짧게_답한_아이).postActivity).toBeNull()
  })

  it('활동을 안 하고 떠난 아이도 카드가 없다 (수용 12)', () => {
    expect(지우(후활동_붙인(null)).postActivity).toBeNull()
  })

  it('낱말 12개가 카드 차례 그대로 칩이 된다 (수용 11)', () => {
    const card = 지우(후활동_붙인(덩이())).postActivity!

    expect(card.chips).toHaveLength(12)
    expect(card.chips.map((chip) => chip.word)).toEqual(후활동_낱말.map((것) => 것.word))
    expect(card.notice).toBeNull()
    expect(card.wordsCaption).toBe('낱말 12개 중 5개를 이야기에 담았어요')
  })

  it('쓴 것 · 비슷하게 말한 것 · 안 나온 것이 색으로 갈린다 (7.3)', () => {
    const { chips, legend } = 지우(후활동_붙인(덩이())).postActivity!

    const 색 = new Map(chips.map((chip) => [chip.status, chip.color]))
    expect(색.size).toBe(3)
    expect(new Set(색.values()).size).toBe(3)
    // 이름표 셋이 칩 색과 짝을 이룬다 — 보호자가 색을 읽을 수 있어야 한다
    expect(legend).toHaveLength(3)
    expect(legend.map((one) => one.color)).toEqual([...색.values()])
  })

  it('근거는 「비슷한 말로 말했다」에만 붙는다', () => {
    const { chips } = 지우(후활동_붙인(덩이())).postActivity!

    for (const chip of chips) {
      if (chip.status === 'similar') expect(chip.evidence).not.toBeNull()
      else expect(chip.evidence).toBeNull()
    }
    expect(chips.find((chip) => chip.word === '참다')?.evidence).toBe('꾹 눌렀어요')
  })

  it('② 순서만 맞추고 나갔으면 순서 줄만 두고 안내를 낸다', () => {
    const card = 지우(후활동_붙인(덩이({ retelling: null }))).postActivity!

    expect(card.orderLine).toBe('순서를 두 번 만에 맞췄어요.')
    expect(card.retelling).toBeNull()
    expect(card.chips).toEqual([])
    expect(card.legend).toEqual([])
    expect(card.wordsCaption).toBeNull()
    expect(card.notice).toBe('줄거리는 아직 들려주지 않았어요.')
  })

  it('③ 판정을 못 했으면 아이 말은 보여 주고 「담지 못했어요」를 낸다 (수용 10)', () => {
    const 못한판 = 덩이({
      retelling: {
        analyzed: false,
        text: '며느리가 방귀를 뀌었어요.',
        used: 0,
        similar: 0,
        missing: 0,
        words: [],
      },
    })
    const card = 지우(후활동_붙인(못한판)).postActivity!

    expect(card.retelling).toBe('며느리가 방귀를 뀌었어요.')
    expect(card.chips).toEqual([])
    expect(card.notice).toBe('들려준 줄거리에서 낱말을 담지 못했어요.')
    // 「아직 안 들려줬다」와 **다른 문구**여야 한다 — 아이는 말을 했다
    expect(card.notice).not.toBe('줄거리는 아직 들려주지 않았어요.')
  })

  it('🔴 한 낱말도 못 담은 판은 「판정을 못 했다」가 아니다 — 회색 칩 12개가 선다', () => {
    const 하나도_못담은 = 덩이({
      retelling: {
        analyzed: true,
        text: '음… 그냥 재밌었어요.',
        used: 0,
        similar: 0,
        missing: 12,
        words: 후활동_낱말.map((것) => ({ ...것, status: 'missing' as const, evidence: null })),
      },
    })
    const card = 지우(후활동_붙인(하나도_못담은)).postActivity!

    expect(card.chips).toHaveLength(12)
    expect(card.notice).toBeNull()
    expect(card.wordsCaption).toBe('낱말 12개 중 0개를 이야기에 담았어요')
    expect(new Set(card.chips.map((chip) => chip.color)).size).toBe(1)
  })
})

describe('후활동 순서 한 줄 — 「끝내 맞췄나」와 「한 번에 맞췄나」가 다르다 (F18)', () => {
  const 줄 = (order: Partial<PostActivity['order']>) =>
    지우(후활동_붙인(덩이({ order: { ...덩이().order, ...order } }))).postActivity!.orderLine

  it('한 번에 맞추면 「한 번에」다', () => {
    expect(줄({ correct: true, attempts: 1 })).toBe('순서를 한 번에 맞췄어요.')
  })

  it('두 번 만에 맞추면 명세 7.3 의 그 문장이다', () => {
    expect(줄({ correct: true, attempts: 2 })).toBe('순서를 두 번 만에 맞췄어요.')
  })

  it('세 번 만에 맞춘 아이를 「못 맞췄다」로 적지 않는다', () => {
    expect(줄({ correct: true, attempts: 3 })).toBe('순서를 세 번 만에 맞췄어요.')
  })

  it('끝내 못 맞췄으면 그렇게 적는다', () => {
    expect(줄({ correct: false, attempts: 4 })).toBe(
      '순서를 네 번 놓아 봤지만 아직 완성하지 못했어요.',
    )
  })

  it('한 번도 안 냈으면 「아직 하지 않았어요」다 — 「못 맞췄다」가 아니다', () => {
    expect(줄({ correct: false, attempts: 0 })).toBe('순서 맞추기는 아직 하지 않았어요.')
  })

  it('열한 번을 넘으면 숫자로 적는다', () => {
    expect(줄({ correct: true, attempts: 12 })).toBe('순서를 12번 만에 맞췄어요.')
  })
})

describe('🔴 F15 — 후활동 카드가 붙어도 나머지 화면이 안 흔들린다 (수용 15)', () => {
  it('요약 스트립 · 오각형 · 어휘 칸이 후활동 유무와 무관하게 같다', () => {
    const 없는판 = 지우(잘한_아이)
    const 있는판 = 지우(후활동_붙인(덩이()))

    expect(있는판.summary).toEqual(없는판.summary)
    expect(있는판.radar).toEqual(없는판.radar)
    expect(있는판.words).toEqual(없는판.words)
    expect(있는판.skills).toEqual(없는판.skills)
    expect(있는판.guide).toEqual(없는판.guide)
  })

  it('문장이 없는 리포트에도 후활동 카드는 그대로 선다 — 서술을 안 탄다', () => {
    // 후활동은 숫자 쪽이라 「다시 만들기」로 채워지는 칸이 아니다 (후활동 7.3 끝줄).
    const card = 지우(후활동_붙인(덩이(), 짧게_답한_아이)).postActivity!

    expect(card.chips).toHaveLength(12)
    expect(card.orderLine).toBe('순서를 두 번 만에 맞췄어요.')
  })
})
