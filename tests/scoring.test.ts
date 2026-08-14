// 채점기 대조 검사 — `lib/scoring.ts` (이슈 #26 말-8).
//
// 🔴 **채점기는 점수가 숫자로 나오는 코드라 잘못 옮기면 조용히 틀린다.** 화면은 눈으로
//    이상한 것을 보지만 0.744 와 0.767 은 둘 다 그럴듯하다. 그래서 이 파일의 절반은
//    **파이썬이 낸 값과 글자 그대로 대조하는 것**이다.
//
// ## 황금표를 어떻게 떴나
//
// `tests/fixtures/goldenset_채점_황금표.json` 은 파이썬 `goodquestion.goldenset.채점()` 과
// `응답을_라벨로()` 를 **진짜로 돌려** 뜬 값이다 (2026-08-13). LLM 은 안 부른다 —
// 라벨은 정답지에서 결정적으로 지어냈다. 사례 9개 × 항목 30~73건 + 응답 8건이다.
//
// ⛔ 이 파일을 손으로 고쳐 초록을 만들지 마라. 값이 틀렸다고 생각되면 파이썬을 다시 돌려
//    황금표부터 다시 떠라 — 그러지 않으면 **대조가 아니라 우리 답을 우리가 베낀 것**이 된다.
//
// ## 정답지 파일도 함께 잰다
//
// `parseGoldenset()` 이 `goldenset/*.jsonl` 을 파이썬과 **같은 차례로 같은 값**으로 읽는지
// 본다. 읽기가 갈리면 점수가 아니라 입력이 달라지므로 숫자 대조가 무의미해진다.

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { PROJECT_ROOT } from '@/llm/config'
import {
  CHILD_INTENT_값,
  ELEMENT_값,
  GoldensetError,
  VALIDITY_값,
  isCorrect,
  isReviewed,
  parseGoldenset,
  responseToLabel,
  reviewedOnly,
  score,
  trustworthy,
  type GoldenItem,
  type ScorePair,
} from '@/llm/scoring'
import { 사고_요소, 유효성_값, 의도_값 } from '@/llm/engine/analyze'

// ── 황금표 ────────────────────────────────────────────────────────────────

interface 황금_항목별 {
  id: string
  검수: string
  child_intent_맞음: boolean
  utterance_validity_맞음: boolean
  맞힌_요소: string[]
  놓친_요소: string[]
  지어낸_요소: string[]
}

interface 황금_표 {
  건수: number
  초안_건수: number
  child_intent_정확도: number
  utterance_validity_정확도: number
  요소_정밀도: number
  요소_재현율: number
  요소_F1: number
  믿을_수_있나: boolean
  항목별: 황금_항목별[]
}

interface 황금_사례 {
  이름: string
  파일: string
  짝들: {
    item_id: string
    라벨: { child_intent: string; detected_elements: string[]; utterance_validity: string }
  }[]
  표: 황금_표
}

interface 황금표 {
  사례들: 황금_사례[]
  응답사례들: {
    원문: string
    라벨: {
      child_intent: string
      detected_elements: string[]
      utterance_validity: string
      main_point: string | null
    }
  }[]
}

const 황금표: 황금표 = JSON.parse(
  readFileSync(path.join(import.meta.dirname, 'fixtures', 'goldenset_채점_황금표.json'), 'utf-8'),
) as 황금표

const 정답지_폴더 = path.join(PROJECT_ROOT, 'goldenset')

function 읽는다(이름: string): GoldenItem[] {
  const 경로 = path.join(정답지_폴더, 이름)
  return parseGoldenset(readFileSync(경로, 'utf-8'), 경로)
}

const 파일별_항목 = new Map<string, Map<string, GoldenItem>>()
function 항목(파일: string, id: string): GoldenItem {
  let 표 = 파일별_항목.get(파일)
  if (표 === undefined) {
    표 = new Map(읽는다(파일).map((항목) => [항목.id, 항목]))
    파일별_항목.set(파일, 표)
  }
  const 것 = 표.get(id)
  if (것 === undefined) throw new Error(`황금표가 가리키는 항목이 정답지에 없다: ${파일} ${id}`)
  return 것
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. 정답지 읽기 — 파이썬과 같은 차례로 같은 값인가
// ═══════════════════════════════════════════════════════════════════════════

describe('정답지 읽기', () => {
  it('두 파일을 파이썬과 같은 건수로 읽는다', () => {
    expect(읽는다('banggui_검수전.jsonl')).toHaveLength(73)
    expect(읽는다('banggui_말투판.jsonl')).toHaveLength(43)
  })

  it('73건 중 30건이 검수완료다 — `--검수완료만` 이 그 30건을 고른다', () => {
    const 항목들 = 읽는다('banggui_검수전.jsonl')
    expect(reviewedOnly(항목들)).toHaveLength(30)
    expect(reviewedOnly(항목들).every(isReviewed)).toBe(true)
    // ⭐ 이걸 빠뜨리면 73건이 돈다 — 호출이 2.4배 나가고 초안 43건이 점수에 섞인다.
    expect(항목들.length - reviewedOnly(항목들).length).toBe(43)
  })

  it('항목의 차례와 정답이 황금표(파이썬)와 같다', () => {
    const 사례 = 황금표.사례들.find((것) => 것.이름 === '완전 일치 · 73건 전체 (초안이 섞였다)')
    expect(사례).toBeDefined()
    const 항목들 = 읽는다('banggui_검수전.jsonl')
    expect(항목들.map((항목) => 항목.id)).toEqual(사례!.짝들.map((짝) => 짝.item_id))
    for (const [자리, 짝] of 사례!.짝들.entries()) {
      expect(항목들[자리].정답.child_intent).toBe(짝.라벨.child_intent)
      expect(항목들[자리].정답.utterance_validity).toBe(짝.라벨.utterance_validity)
      expect([...항목들[자리].정답.detected_elements]).toEqual(짝.라벨.detected_elements)
    }
  })

  it('맥락 칸이 분석 프롬프트 입력과 같은 이름으로 실려 온다', () => {
    const 첫줄 = 읽는다('banggui_검수전.jsonl')[0]
    expect(첫줄.id).toBe('gs_banggui_03_001')
    expect(첫줄.scene_order).toBe(3)
    expect(첫줄.previous_character_message).not.toBe('')
    expect(첫줄.child_utterance).not.toBe('')
    expect(첫줄.target_elements.length).toBeGreaterThan(0)
    // `element_criteria` 는 실려 있되 **기본으로는 안 보낸다** (기준_포함).
    expect(Object.keys(첫줄.element_criteria).length).toBeGreaterThan(0)
  })
})

describe('정답지 형식 오류 — 줄번호가 붙는다', () => {
  const 한줄 = (덧붙일: Record<string, unknown> = {}) =>
    JSON.stringify({
      id: 'gs_t_001',
      검수: '검수완료',
      scene_order: 3,
      장면_이름: '대화1',
      previous_character_message: '앞말',
      child_utterance: '아이말',
      target_elements: ['REASON'],
      정답: { child_intent: 'OPINION', detected_elements: ['REASON'], utterance_validity: 'VALID' },
      ...덧붙일,
    })

  it('주석과 빈 줄을 건너뛰고, 줄번호는 원래 번호다', () => {
    const 글 = `// 머리말\n\n${한줄()}\n`
    expect(parseGoldenset(글, 'x.jsonl')).toHaveLength(1)
    const 깨진 = `// 머리말\n\n{ 깨졌다\n`
    expect(() => parseGoldenset(깨진, 'x.jsonl')).toThrow(/x\.jsonl:3 — JSON 이 깨졌다/)
  })

  it('검수 값이 둘 중 하나가 아니면 거절한다', () => {
    expect(() => parseGoldenset(한줄({ 검수: '반쯤' }), 'x.jsonl')).toThrow(GoldensetError)
  })

  it('목록 밖 라벨을 거절한다', () => {
    expect(() =>
      parseGoldenset(
        한줄({ 정답: { child_intent: 'NOPE', detected_elements: [], utterance_validity: 'VALID' } }),
        'x.jsonl',
      ),
    ).toThrow(/child_intent 가 13개 목록 밖이다/)
    expect(() =>
      parseGoldenset(
        한줄({
          정답: { child_intent: 'OPINION', detected_elements: [], utterance_validity: 'HUH' },
        }),
        'x.jsonl',
      ),
    ).toThrow(/utterance_validity 가 5개 목록 밖이다/)
    expect(() => parseGoldenset(한줄({ target_elements: ['NOPE'] }), 'x.jsonl')).toThrow(
      /목록 밖 값/,
    )
  })

  it('같은 값이 두 번 있는 요소 배열을 거절한다', () => {
    expect(() => parseGoldenset(한줄({ target_elements: ['REASON', 'REASON'] }), 'x.jsonl')).toThrow(
      /같은 값이 두 번 있다/,
    )
  })

  it('id 가 겹치면 앞 줄 번호와 함께 터뜨린다', () => {
    expect(() => parseGoldenset(`${한줄()}\n${한줄()}\n`, 'x.jsonl')).toThrow(
      /x\.jsonl:2 — id 가 1번 줄과 겹친다/,
    )
  })

  it('없는 칸을 조용히 채우지 않는다', () => {
    const 자료 = JSON.parse(한줄()) as Record<string, unknown>
    delete 자료.child_utterance
    expect(() => parseGoldenset(JSON.stringify(자료), 'x.jsonl')).toThrow(
      /'child_utterance' 가 없다/,
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. 채점 — ⭐ 파이썬이 낸 숫자와 대조한다
// ═══════════════════════════════════════════════════════════════════════════

describe('score() — 파이썬 채점표와 같은 값인가', () => {
  for (const 사례 of 황금표.사례들) {
    it(`${사례.이름} (${사례.짝들.length}짝)`, () => {
      const 쌍들: ScorePair[] = 사례.짝들.map((짝) => ({
        항목: 항목(사례.파일, 짝.item_id),
        라벨: 짝.라벨,
      }))
      const 표 = score(쌍들)

      expect(표.건수).toBe(사례.표.건수)
      expect(표.초안_건수).toBe(사례.표.초안_건수)
      // ⚠️ 근사가 아니라 **부동소수 그대로** 맞아야 한다. 파이썬도 IEEE754 배정도다.
      expect(표.child_intent_정확도).toBe(사례.표.child_intent_정확도)
      expect(표.utterance_validity_정확도).toBe(사례.표.utterance_validity_정확도)
      expect(표.요소_정밀도).toBe(사례.표.요소_정밀도)
      expect(표.요소_재현율).toBe(사례.표.요소_재현율)
      expect(표.요소_F1).toBe(사례.표.요소_F1)
      expect(trustworthy(표)).toBe(사례.표.믿을_수_있나)

      expect(표.항목별.length).toBe(사례.표.항목별.length)
      for (const [자리, 기대] of 사례.표.항목별.entries()) {
        expect(표.항목별[자리]).toEqual({
          id: 기대.id,
          검수: 기대.검수,
          child_intent_맞음: 기대.child_intent_맞음,
          utterance_validity_맞음: 기대.utterance_validity_맞음,
          맞힌_요소: 기대.맞힌_요소,
          놓친_요소: 기대.놓친_요소,
          지어낸_요소: 기대.지어낸_요소,
        })
      }
    })
  }
})

describe('score() — 규칙 하나씩', () => {
  const 짝 = (
    정답: [string, string[], string],
    받은: [string, string[], string],
    검수 = '검수완료',
  ): ScorePair => ({
    항목: {
      id: 'x',
      검수,
      정답: { child_intent: 정답[0], detected_elements: 정답[1], utterance_validity: 정답[2] },
    },
    라벨: { child_intent: 받은[0], detected_elements: 받은[1], utterance_validity: 받은[2] },
  })

  it('요소 점수는 micro 평균이다 — 항목별 비율의 평균이 아니다', () => {
    // 항목 A: 정답 4개 중 1개 맞힘, 항목 B: 정답 1개 중 1개 맞힘
    const 표 = score([
      짝(['OPINION', ['REASON', 'SOLUTION', 'EMOTION', 'EMPATHY'], 'VALID'], ['OPINION', ['REASON'], 'VALID']),
      짝(['OPINION', ['REASON'], 'VALID'], ['OPINION', ['REASON'], 'VALID']),
    ])
    // macro 였다면 재현율이 (0.25 + 1) / 2 = 0.625 다. micro 는 2/5 = 0.4 다.
    expect(표.요소_재현율).toBe(2 / 5)
    expect(표.요소_정밀도).toBe(1)
  })

  it('분모가 0 이면 0.0 이다 — 낼 것도 맞힐 것도 없는 것을 만점으로 쳐 주지 않는다', () => {
    const 표 = score([짝(['OPINION', [], 'VALID'], ['OPINION', [], 'VALID'])])
    expect(표.요소_정밀도).toBe(0)
    expect(표.요소_재현율).toBe(0)
    expect(표.요소_F1).toBe(0)
    expect(표.child_intent_정확도).toBe(1)
  })

  it('같은 요소를 두 번 내도 분모는 한 번만 센다', () => {
    const 표 = score([짝(['OPINION', ['REASON'], 'VALID'], ['OPINION', ['REASON', 'REASON'], 'VALID'])])
    expect(표.요소_정밀도).toBe(1)
  })

  it('초안이 하나라도 섞이면 믿을 수 없다', () => {
    const 확정 = score([짝(['OPINION', [], 'VALID'], ['OPINION', [], 'VALID'])])
    expect(trustworthy(확정)).toBe(true)
    const 섞임 = score([
      짝(['OPINION', [], 'VALID'], ['OPINION', [], 'VALID']),
      짝(['OPINION', [], 'VALID'], ['OPINION', [], 'VALID'], '초안'),
    ])
    expect(섞임.초안_건수).toBe(1)
    expect(trustworthy(섞임)).toBe(false)
    // 판정한 것이 하나도 없어도 「믿을 수 있다」가 되면 안 된다.
    expect(trustworthy(score([]))).toBe(false)
  })

  it('놓친 요소·지어낸 요소를 정답지에 적힌 차례대로 준다', () => {
    const 표 = score([
      짝(
        ['OPINION', ['REASON', 'SOLUTION', 'EMOTION'], 'VALID'],
        ['OPINION', ['EMPATHY', 'SOLUTION'], 'VALID'],
      ),
    ])
    expect(표.항목별[0].맞힌_요소).toEqual(['SOLUTION'])
    expect(표.항목별[0].놓친_요소).toEqual(['REASON', 'EMOTION'])
    expect(표.항목별[0].지어낸_요소).toEqual(['EMPATHY'])
  })
})

describe('isCorrect() — 네 칸이 전부 맞아야 맞음이다', () => {
  const 채점 = (덧붙일: Partial<Parameters<typeof isCorrect>[0]> = {}) => ({
    id: 'x',
    검수: '검수완료',
    child_intent_맞음: true,
    utterance_validity_맞음: true,
    맞힌_요소: ['REASON'],
    놓친_요소: [] as string[],
    지어낸_요소: [] as string[],
    ...덧붙일,
  })

  it('전부 맞으면 맞음', () => expect(isCorrect(채점())).toBe(true))
  it('의도가 틀리면 틀림', () => expect(isCorrect(채점({ child_intent_맞음: false }))).toBe(false))
  it('유효성이 틀리면 틀림', () =>
    expect(isCorrect(채점({ utterance_validity_맞음: false }))).toBe(false))
  it('요소를 놓쳤으면 틀림', () => expect(isCorrect(채점({ 놓친_요소: ['SOLUTION'] }))).toBe(false))
  it('없는 요소를 냈으면 틀림', () => expect(isCorrect(채점({ 지어낸_요소: ['SOLUTION'] }))).toBe(false))
  it('채점이 없으면(판정 불가) 맞음이 아니다', () => expect(isCorrect(null)).toBe(false))
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. 응답 읽기 — ⛔ 여기서 검증하지 않는다
// ═══════════════════════════════════════════════════════════════════════════

describe('responseToLabel() — 파이썬 `응답을_라벨로()` 와 같은 값인가', () => {
  for (const [자리, 사례] of 황금표.응답사례들.entries()) {
    it(`응답 ${자리 + 1}`, () => {
      const 라벨 = responseToLabel(사례.원문)
      expect(라벨.child_intent).toBe(사례.라벨.child_intent)
      expect(라벨.utterance_validity).toBe(사례.라벨.utterance_validity)
      expect([...라벨.detected_elements]).toEqual(사례.라벨.detected_elements)
      expect(라벨.main_point).toBe(사례.라벨.main_point)
    })
  }

  it('목록 밖 값을 거부하지 않는다 — 그것 자체가 측정 대상이다', () => {
    const 라벨 = responseToLabel(
      '{"child_intent":"NOPE","detected_elements":[{"type":"XX","evidence":"a"}],"utterance_validity":"???"}',
    )
    expect(라벨.child_intent).toBe('NOPE')
    expect([...라벨.detected_elements]).toEqual(['XX'])
    // 채점에서 「지어낸 요소」로 잡힌다 — 판정 불가가 아니다.
    const 표 = score([
      {
        항목: { id: 'x', 검수: '검수완료', 정답: { child_intent: 'OPINION', detected_elements: [], utterance_validity: 'VALID' } },
        라벨,
      },
    ])
    expect(표.건수).toBe(1)
    expect(표.항목별[0].지어낸_요소).toEqual(['XX'])
  })

  it('JSON 이 아니면 터진다 — 그때가 판정 불가다', () => {
    expect(() => responseToLabel('미안 못 하겠어')).toThrow()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. 목록이 엔진과 어긋나지 않는가
// ═══════════════════════════════════════════════════════════════════════════

describe('라벨 목록', () => {
  it('`lib/engine/analyze.ts` 가 LLM 에 보내는 목록과 같다', () => {
    // 여기서 갈리면 정답지에 쓸 수 있는 값과 LLM 이 낼 수 있는 값이 달라진다.
    expect([...CHILD_INTENT_값].sort()).toEqual([...의도_값].sort())
    expect([...ELEMENT_값].sort()).toEqual([...사고_요소].sort())
    expect([...VALIDITY_값].sort()).toEqual([...유효성_값].sort())
  })
})
