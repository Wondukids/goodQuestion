// 보호자 리포트 목데이터 — 대본과 실행기의 **DB 없이 잴 수 있는 것 전부** (이슈 #40).
//
// ⛔ 이 파일은 DB 도 LLM 도 부르지 않는다. 여기서 재는 것은 넷이다 —
//    ① 대본이 명세 10절 표와 맞는가
//    ② 계산해서 만든 id 가 겹치지 않고 `turn_order` 와 일대일인가
//    ③ 샤드가 **겹치지도 빠뜨리지도** 않는가 (킥오프 ⑧)
//    ④ 아이8의 「새로 쓴 낱말」이 뒤 활동일수록 줄어드는가 (킥오프 ⑧)
//
// 🔴 ④ 는 집계기(`src/report/domain/metrics.ts`)를 **진짜로 돌려서** 잰다. 손으로 센 숫자를
//    적어 두면 집계기가 바뀐 날 이 검사가 거짓말을 하기 시작한다.

import { beforeEach, afterEach, describe, expect, it } from 'vitest'

import { loadSettings } from '@/llm/config'
import {
  발화를_편다,
  샤드_고르기,
  옵션_읽기,
  일감들,
  체인이_한_칸인가,
  키_하나만_보이게,
  type 콘텐츠,
  type 장면행,
} from '@/llm/db/seed-report-mock'
import {
  아이들,
  아이발화_수,
  이름_표식,
  활동_수,
} from '@/llm/db/seed-report-mock-script'
import { applyExtractedWords, aggregateMetrics, type 집계재료 } from '@/report/domain/metrics'

// ═══════════════════════════════════════════════════════════════════════════
// 가짜 콘텐츠 — DB 를 안 물고 `발화를_편다()` 를 돌리려고 만든다
// ═══════════════════════════════════════════════════════════════════════════

/** 대화 장면 넷의 값. 정본은 `src/llm/db/seed.ts` 의 `대화장면들` 이다. */
const 대화장면_값 = [
  { code: 'sc_banggui_03', scene_order: 3, preferred_turns: 2, max_turns: 4 },
  { code: 'sc_banggui_05', scene_order: 5, preferred_turns: 3, max_turns: 5 },
  { code: 'sc_banggui_07', scene_order: 7, preferred_turns: 3, max_turns: 5 },
  { code: 'sc_banggui_09', scene_order: 9, preferred_turns: 2, max_turns: 4 },
] as const

function 가짜_장면(값: (typeof 대화장면_값)[number]): 장면행 {
  return {
    scene_id: `scene-${값.code}`,
    code: 값.code,
    scene_order: 값.scene_order,
    character_id: 'ch-1',
    scene_description: null,
    conflict: '갈등 한 줄',
    scene_goal: '목표 한 줄',
    required_elements: ['PERSPECTIVE'],
    element_criteria: {},
    character_opening: `[${값.code} 첫 대사]`,
    character_closing: `[${값.code} 마지막 대사]`,
    preferred_turns: 값.preferred_turns,
    max_turns: 값.max_turns,
    vocabulary: [{ word: '며느리', meaning: '아들의 아내' }],
  }
}

function 가짜_콘텐츠(): 콘텐츠 {
  const 장면들 = 대화장면_값.map(가짜_장면)
  return {
    story_id: 'story-1',
    slug: 'fart-bride',
    title: '방귀 뀌는 며느리',
    장면들,
    장면_code로: new Map(장면들.map((장) => [장.code, 장])),
    미션_code로: new Map([
      ['ms_banggui_pear', { id: 'mission-1', scene_id: 'scene-sc_banggui_07', title: '배 따기' }],
    ]),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ① 대본이 명세 10절 표와 맞는가
// ═══════════════════════════════════════════════════════════════════════════

describe('대본 — 명세 10절 표', () => {
  it('아이가 열 명이고 번호가 1~10 이다', () => {
    expect(아이들).toHaveLength(10)
    expect(아이들.map((아이) => 아이.번호)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('나이가 전부 만 6~9세다 (2026년 기준)', () => {
    for (const 아이 of 아이들) {
      const 나이 = 2026 - 아이.출생연도
      expect(나이, `아이${아이.번호} ${아이.이름}`).toBeGreaterThanOrEqual(6)
      expect(나이, `아이${아이.번호} ${아이.이름}`).toBeLessThanOrEqual(9)
    }
  })

  it('표가 정한 활동 수·상태 그대로다 — 아이8은 3건, 아이10은 중단 1건', () => {
    const 활동수 = Object.fromEntries(아이들.map((아이) => [아이.번호, 아이.활동들.length]))
    expect(활동수).toEqual({ 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1, 8: 3, 9: 1, 10: 1 })

    const 중단 = 아이들.flatMap((아이) =>
      아이.활동들.filter((활동) => 활동.status === 'stopped').map(() => 아이.번호),
    )
    expect(중단).toEqual([10])
  })

  it('아이10의 중단 활동은 아이 발화가 셋이고 마지막 고정 대사가 붙지 않는다 (R16)', () => {
    const 활동 = 아이들[9].활동들[0]
    const 발화수 = 활동.장면들.reduce((합, 장) => 합 + 장.턴들.length, 0)
    expect(발화수).toBe(3)
    expect(활동.장면들.every((장) => 장.닫지_않음 === true)).toBe(true)
  })

  it('완주 활동은 대화 장면 넷을 다 지난다', () => {
    for (const 아이 of 아이들) {
      for (const 활동 of 아이.활동들) {
        if (활동.status !== 'completed') continue
        expect(활동.장면들.map((장) => 장.scene_code), `아이${아이.번호} ${활동.차례}회차`).toEqual([
          'sc_banggui_03',
          'sc_banggui_05',
          'sc_banggui_07',
          'sc_banggui_09',
        ])
      }
    }
  })

  it('⛔ 어느 장면도 `max_turns` 를 넘지 않는다 — 넘으면 있을 수 없는 턴이다', () => {
    const 한계 = new Map<string, number>(대화장면_값.map((값) => [값.code, 값.max_turns]))
    for (const 아이 of 아이들) {
      for (const 활동 of 아이.활동들) {
        for (const 장 of 활동.장면들) {
          expect(장.턴들.length, `아이${아이.번호} ${활동.차례}회차 ${장.scene_code}`).toBeLessThanOrEqual(
            한계.get(장.scene_code)!,
          )
        }
      }
    }
  })

  it('나이가 어릴수록 문장이 짧다 — 6세 아이1 < 9세 아이4', () => {
    const 평균길이 = (번호: number) => {
      const 아이 = 아이들[번호 - 1]
      const 줄 = 아이.활동들.flatMap((활동) => 활동.장면들.flatMap((장) => 장.턴들.map((턴) => 턴.아이)))
      return 줄.reduce((합, 것) => 합 + 것.length, 0) / 줄.length
    }
    // 표준 넷(1·2·3·4 = 6·7·8·9세)만 견준다. 5~10 은 성격이 따로 있어 길이로 줄 세우지 않는다.
    expect(평균길이(1)).toBeLessThan(평균길이(3))
    expect(평균길이(3)).toBeLessThan(평균길이(4))
  })

  it('9세 아이넷은 「왜냐하면」으로 이유를 잇는다', () => {
    for (const 번호 of [4, 8]) {
      const 아이 = 아이들[번호 - 1]
      const 줄 = 아이.활동들.flatMap((활동) => 활동.장면들.flatMap((장) => 장.턴들.map((턴) => 턴.아이)))
      expect(줄.some((것) => 것.includes('왜냐하면')), `아이${번호}`).toBe(true)
    }
  })

  it('아이5는 자기 감정을 말한다 — 「감정 표현」(EMOTION) 축이 튀게 짠 대본이다', () => {
    const 줄 = 아이들[4].활동들.flatMap((활동) =>
      활동.장면들.flatMap((장) => 장.턴들.map((턴) => 턴.아이)),
    )
    const 자기감정 = 줄.filter((것) => /^나|나도|나는/.test(것) || 것.includes('나는 ') || 것.includes('나도 '))
    expect(자기감정.length).toBeGreaterThanOrEqual(6)
  })

  it('아이6·7은 짧은 답으로 시작한다 — 저정보 두 턴 연속이 유도를 부른다', () => {
    for (const 번호 of [6, 7]) {
      for (const 장 of 아이들[번호 - 1].활동들[0].장면들) {
        expect(장.턴들[0].아이.length, `아이${번호} ${장.scene_code}`).toBeLessThanOrEqual(12)
        expect(장.턴들[1].아이.length, `아이${번호} ${장.scene_code}`).toBeLessThanOrEqual(12)
      }
    }
  })

  it('아이7만 되묻기 뒤에 회복한다 — 셋째 턴이 길다. 아이6은 끝까지 짧다', () => {
    for (const 장 of 아이들[6].활동들[0].장면들) {
      expect(장.턴들[2].아이.length, `아이7 ${장.scene_code}`).toBeGreaterThan(20)
    }
    const 아이6_줄 = 아이들[5].활동들[0].장면들.flatMap((장) => 장.턴들.map((턴) => 턴.아이))
    expect(Math.max(...아이6_줄.map((것) => 것.length))).toBeLessThanOrEqual(12)
  })

  it('표식이 이름에 들어 있지 않다 — 붙이는 것은 넣는 쪽이다', () => {
    for (const 아이 of 아이들) {
      expect(아이.이름.includes(이름_표식)).toBe(false)
    }
  })

  it('세는 함수가 대본과 맞는다', () => {
    expect(활동_수()).toBe(12)
    // 아이 발화 한 건당 분석 LLM 1회다. 명세 10절이 잡은 「200~250회」 안쪽이어야 한다.
    expect(아이발화_수()).toBe(173)
    expect(아이발화_수()).toBeLessThanOrEqual(250)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ② 계산해서 만든 id — 겹치지 않고 `turn_order` 와 일대일이다
// ═══════════════════════════════════════════════════════════════════════════

describe('발화를_편다 — id 와 turn_order', () => {
  const 콘 = 가짜_콘텐츠()

  it('한 세션 안에서 turn_order 가 1부터 빈틈없이 이어진다', () => {
    for (const 일 of 일감들()) {
      const 펼친 = 발화를_편다(콘, 일)
      expect(펼친.map((줄) => 줄.turn_order)).toEqual(펼친.map((_, 자리) => 자리 + 1))
    }
  })

  it('🔴 id 와 turn_order 가 일대일이다 — `unique(session_id, turn_order)` 가 이걸 요구한다', () => {
    for (const 일 of 일감들()) {
      const 펼친 = 발화를_편다(콘, 일)
      expect(new Set(펼친.map((줄) => 줄.message_id)).size).toBe(펼친.length)
    }
  })

  it('세션이 달라도 발화 id 가 겹치지 않는다', () => {
    const 전부 = 일감들().flatMap((일) => 발화를_편다(콘, 일).map((줄) => 줄.message_id))
    expect(new Set(전부).size).toBe(전부.length)
  })

  it('장면은 고정 첫 대사로 열고 고정 마지막 대사로 닫는다 — 중단만 안 닫는다', () => {
    const 완주 = 일감들().find((일) => 일.활동.status === 'completed')!
    const 펼친_완주 = 발화를_편다(콘, 완주)
    expect(펼친_완주[0].text).toBe('[sc_banggui_03 첫 대사]')
    expect(펼친_완주[펼친_완주.length - 1].text).toBe('[sc_banggui_09 마지막 대사]')

    const 중단 = 일감들().find((일) => 일.활동.status === 'stopped')!
    const 펼친_중단 = 발화를_편다(콘, 중단)
    expect(펼친_중단[펼친_중단.length - 1].speaker_type).toBe('child')
  })

  it('아이 발화 수가 대본이 센 것과 같다 (미션 빼고)', () => {
    const 센것 = 일감들().reduce(
      (합, 일) => 합 + 발화를_편다(콘, 일).filter((줄) => 줄.speaker_type === 'child').length,
      0,
    )
    const 미션 = 일감들().reduce((합, 일) => 합 + (일.활동.미션?.단계들.length ?? 0), 0)
    expect(센것 + 미션).toBe(아이발화_수())
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ③ 샤드 — 겹치지도 빠뜨리지도 않는다 (킥오프 ⑧)
// ═══════════════════════════════════════════════════════════════════════════

describe('샤드', () => {
  it('세 몫이 전체를 빈틈없이 덮고 하나도 겹치지 않는다', () => {
    const 전부 = 일감들()
    const 몫들 = [0, 1, 2].map((i) => 샤드_고르기(전부, { i, n: 3 }))
    const 합 = 몫들.flat().map((일) => 일.session_id)

    expect(합).toHaveLength(전부.length)
    expect(new Set(합).size).toBe(전부.length)
    expect([...합].sort()).toEqual(전부.map((일) => 일.session_id).sort())
  })

  it('두 번 갈라도 같은 것이 걸린다 — 난수를 안 쓴다', () => {
    const 한번 = 샤드_고르기(일감들(), { i: 1, n: 3 }).map((일) => 일.session_id)
    const 두번 = 샤드_고르기(일감들(), { i: 1, n: 3 }).map((일) => 일.session_id)
    expect(한번).toEqual(두번)
  })

  it('한 아이의 활동 3건이 서로 다른 몫으로 갈린다 — 활동 단위로 가르기 때문이다', () => {
    const 몫 = (session_id: string) =>
      [0, 1, 2].findIndex((i) =>
        샤드_고르기(일감들(), { i, n: 3 }).some((일) => 일.session_id === session_id),
      )
    const 아이8 = 일감들().filter((일) => 일.아이.번호 === 8)
    expect(아이8).toHaveLength(3)
    expect(new Set(아이8.map((일) => 몫(일.session_id))).size).toBe(3)
  })

  it('안 주면 전부 돈다', () => {
    expect(샤드_고르기(일감들(), null)).toHaveLength(활동_수())
  })
})

describe('옵션 읽기', () => {
  it('단계를 안 주면 터진다 — 기본값으로 돈을 쓰지 않는다', () => {
    expect(() => 옵션_읽기([])).toThrow(/무엇까지 할지/)
  })

  it('--shard 를 읽는다', () => {
    expect(옵션_읽기(['--analyze', '--shard', '2/3']).샤드).toEqual({ i: 2, n: 3 })
  })

  it('범위 밖 샤드는 터진다', () => {
    expect(() => 옵션_읽기(['--analyze', '--shard', '3/3'])).toThrow(/i 는 0 이상/)
    expect(() => 옵션_읽기(['--analyze', '--shard', '없음'])).toThrow(/<i>\/<n>/)
  })

  it('모르는 옵션은 조용히 넘어가지 않는다', () => {
    expect(() => 옵션_읽기(['--analyz'])).toThrow(/모르는 옵션/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ④ 키 하나만 보이게 — 첫 호출 전에 체인이 한 칸이어야 한다 (킥오프 ④)
// ═══════════════════════════════════════════════════════════════════════════

describe('키 좁히기', () => {
  const 되돌릴 = [
    'GQ_GEMINI_API_KEY',
    'GQ_GEMINI_API_KEY_2',
    'GQ_GEMINI_API_KEY_3',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
  ] as const
  let 원래: Record<string, string | undefined> = {}

  beforeEach(() => {
    원래 = Object.fromEntries(되돌릴.map((이름) => [이름, process.env[이름]]))
  })

  afterEach(() => {
    for (const 이름 of 되돌릴) {
      if (원래[이름] === undefined) delete process.env[이름]
      else process.env[이름] = 원래[이름]
    }
  })

  it('고른 키 하나만 남고 나머지는 비워진다', () => {
    process.env.GQ_GEMINI_API_KEY = '키하나'
    process.env.GQ_GEMINI_API_KEY_2 = '키둘'
    process.env.GQ_GEMINI_API_KEY_3 = '키셋'
    process.env.ANTHROPIC_API_KEY = '앤트로픽'

    키_하나만_보이게(2)

    const settings = loadSettings()
    expect(settings.gemini_api_keys).toEqual(['키둘'])
    expect(settings.anthropic_api_key).toBeNull()
  })

  it('🔴 체인이 한 칸이 된다 — 다른 키로도 다른 모델로도 새지 않는다', () => {
    process.env.GQ_GEMINI_API_KEY = '키하나'
    process.env.GQ_GEMINI_API_KEY_2 = '키둘'
    process.env.GQ_GEMINI_API_KEY_3 = '키셋'
    process.env.ANTHROPIC_API_KEY = '앤트로픽'

    키_하나만_보이게(3)
    expect(체인이_한_칸인가(loadSettings())).toBe('gemini(key=1)')
  })

  it('좁히지 않으면 체인이 여러 칸이라 멈춘다', () => {
    process.env.GQ_GEMINI_API_KEY = '키하나'
    process.env.GQ_GEMINI_API_KEY_2 = '키둘'
    process.env.GQ_GEMINI_API_KEY_3 = '키셋'
    delete process.env.ANTHROPIC_API_KEY

    expect(() => 체인이_한_칸인가(loadSettings())).toThrow(/체인이 3 칸/)
  })

  it('없는 키를 고르면 **한 건도 부르기 전에** 터진다', () => {
    process.env.GQ_GEMINI_API_KEY = '키하나'
    process.env.GQ_GEMINI_API_KEY_2 = ''
    expect(() => 키_하나만_보이게(2)).toThrow(/GQ_GEMINI_API_KEY_2/)
    expect(() => 키_하나만_보이게(9)).toThrow(/1 · 2 · 3/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// ⑤ 아이8 — 뒤 활동일수록 「새로 쓴 낱말」이 적다 (킥오프 ⑧)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 대본 하나를 집계기가 먹을 수 있는 재료로 바꾼다.
 *
 * 분석은 안 넣는다 — 이 검사가 재는 것은 **낱말 대조**뿐이고, 그건 발화 원문만 본다
 * (`applyExtractedWords()` → `낱말_나온횟수()`).
 */
function 재료로(일: ReturnType<typeof 일감들>[number], 콘: 콘텐츠): 집계재료 {
  const 펼친 = 발화를_편다(콘, 일)
  return {
    session: {
      status: 일.활동.status,
      started_at: 일.활동.시작,
      completed_at: 일.활동.status === 'completed' ? 일.활동.시작 : null,
      last_activity_at: 일.활동.시작,
    },
    story: { slug: 콘.slug, title: 콘.title },
    scenes: 콘.장면들.map((장) => ({
      id: 장.scene_id,
      code: 장.code,
      scene_order: 장.scene_order,
      vocabulary: 장.vocabulary,
    })),
    messages: 펼친.map((줄) => ({
      id: 줄.message_id,
      scene_id: 줄.scene_id,
      speaker_type: 줄.speaker_type,
      turn_order: 줄.turn_order,
      text: 줄.text,
    })),
    analyses: [],
    turn_conditions: [],
    mission_sessions: [],
    mission_messages: [],
    prior_activities: 일.활동.차례 - 1,
  }
}

describe('아이8 — 새 낱말 누적', () => {
  /**
   * `report_analysis`(LLM)가 뽑을 법한 낱말 목록. 세 활동에 **같은 목록**을 준다 —
   * 실제로 갈리는 것은 「그 활동의 발화 안에 그 낱말이 있느냐」이고, 그것이 대본의 몫이다.
   */
  const 뽑힌_낱말 = [
    '부끄럽다',
    '참다',
    '당당하다',
    '미안하다',
    '신기하다',
    '대단하다',
    '고맙다',
    '놀랍다',
    '뿌듯하다',
  ]

  it('🔴 1회차 > 2회차 ≥ 3회차 이고 3회차도 0 이 아니다', () => {
    const 콘 = 가짜_콘텐츠()
    const 활동들 = 일감들().filter((일) => 일.아이.번호 === 8)
    expect(활동들).toHaveLength(3)

    const 누적: string[] = []
    const 새낱말수: number[] = []

    for (const 일 of 활동들) {
      const 재료 = 재료로(일, 콘)
      const 지표 = applyExtractedWords(aggregateMetrics(재료), 재료, {
        extracted: 뽑힌_낱말,
        repeated: [],
        // 지난 활동까지 쌓인 것. 리포트 저장이 성공한 뒤에 쌓인다 (명세 4.3 ⑤).
        child_words: [...누적],
      })
      새낱말수.push(지표.counts.new_words)
      for (const 것 of 지표.words.main) if (!누적.includes(것.word)) 누적.push(것.word)
    }

    expect(새낱말수[0]).toBeGreaterThan(새낱말수[1])
    expect(새낱말수[1]).toBeGreaterThanOrEqual(새낱말수[2])
    expect(새낱말수[2]).toBeGreaterThan(0)
  })

  it('아이9는 첫 활동이라 prior_activities 가 0 이다', () => {
    const 콘 = 가짜_콘텐츠()
    const 일 = 일감들().find((일) => 일.아이.번호 === 9)!
    expect(aggregateMetrics(재료로(일, 콘)).activity.prior_activities).toBe(0)
  })

  it('아이10의 빈약한 활동에서도 집계가 터지지 않고 축이 전부 0 이다 (R16)', () => {
    const 콘 = 가짜_콘텐츠()
    const 일 = 일감들().find((일) => 일.아이.번호 === 10)!
    const 지표 = aggregateMetrics(재료로(일, 콘))

    expect(지표.counts.child_utterances).toBe(3)
    expect(지표.activity.completed).toBe(false)
    for (const [이름, 축] of Object.entries(지표.axes)) {
      expect(축.score, 이름).toBe(0)
    }
  })
})
