// `요소.py` 이식 대조 — 화면용 한국어 이름 표 (이슈 #26 조립-4).
//
// 세 가지를 잰다.
//
// 1. 여덟 코드가 다 있고 이름·뜻이 파이썬과 같은가
// 2. **모르는 코드**가 들어왔을 때 파이썬이 정한 대로 구는가 (이름은 코드 그대로, 뜻은 빈 문자열)
// 3. 🔴 스키마·시드가 아는 요소 코드와 표가 어긋나지 않는가
//    — 어긋나면 화면에 이름이 빈 자리로 뜬다(정확히는 코드 글자가 그대로 뜬다).
//      `sql/001_schema.sql` 의 허용 값 주석, `sql/002_seed_banggui.sql`,
//      그리고 그 시드를 옮긴 `web/db/seed.ts` 셋을 다 본다.
//
// 시드 파일은 **원문을 읽어 훑는다.** `db/seed.ts` 를 import 하면 Drizzle·postgres 가 딸려 와
// DB 없이 도는 검사가 아니게 된다.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { elementMeaning, elementName, elementNames, 요소 } from '@/lib/elements'

/** 파이썬 `요소.py` 의 표 그대로. 여기서 다시 적는 것이 이식 대조의 요점이다. */
const 기대한_이름 = {
  EMOTION: '감정',
  EMPATHY: '공감',
  PERSPECTIVE: '입장',
  REASON: '까닭',
  SOLUTION: '해결',
  RESULT: '결과',
  REQUEST: '요청',
  DECISION: '선택',
} as const

const 저장소_뿌리 = new URL('../../', import.meta.url)
const 읽기 = (상대: string) => readFileSync(fileURLToPath(new URL(상대, 저장소_뿌리)), 'utf-8')

describe('여덟 코드', () => {
  it('표에 여덟이 다 있고 그 밖은 없다', () => {
    expect(Object.keys(요소).sort()).toEqual(Object.keys(기대한_이름).sort())
  })

  it('이름이 파이썬과 같다', () => {
    for (const [코드, 이름] of Object.entries(기대한_이름)) {
      expect(elementName(코드)).toBe(이름)
    }
  })

  it('뜻이 비어 있지 않다 — 정본에서 옮긴 한 줄 정의가 여덟 다 있다', () => {
    for (const 코드 of Object.keys(기대한_이름)) {
      expect(elementMeaning(코드).length).toBeGreaterThan(0)
    }
  })

  it('EMOTION 과 EMPATHY 는 다른 말이다 — 합치면 안 되는 구분', () => {
    expect(elementName('EMOTION')).not.toBe(elementName('EMPATHY'))
    expect(elementMeaning('EMOTION')).not.toBe(elementMeaning('EMPATHY'))
  })
})

describe('모르는 코드', () => {
  it('이름은 코드를 그대로 돌려준다 — 새 코드가 생겨도 화면이 안 깨진다', () => {
    expect(elementName('NEW_ELEMENT')).toBe('NEW_ELEMENT')
    expect(elementName('')).toBe('')
  })

  it('뜻은 빈 문자열이다', () => {
    expect(elementMeaning('NEW_ELEMENT')).toBe('')
  })

  it('목록에 섞여도 그 자리만 코드로 남는다', () => {
    expect(elementNames(['EMPATHY', 'NEW_ELEMENT'])).toEqual(['공감', 'NEW_ELEMENT'])
  })

  it('물려받은 속성 이름이 와도 표를 뚫지 않는다', () => {
    // `요소[코드]` 를 그냥 쓰면 `constructor`·`toString` 같은 이름이 표에 있는 것처럼 보인다.
    expect(elementName('constructor')).toBe('constructor')
    expect(elementMeaning('toString')).toBe('')
  })
})

describe('elementNames — 두 가지 모양을 받는다', () => {
  it('비어 있으면 빈 목록', () => {
    expect(elementNames(null)).toEqual([])
    expect(elementNames(undefined)).toEqual([])
    expect(elementNames([])).toEqual([])
  })

  it('코드 글자 목록 — `story_scenes.required_elements`', () => {
    expect(elementNames(['PERSPECTIVE', 'EMPATHY', 'REASON', 'SOLUTION'])).toEqual([
      '입장',
      '공감',
      '까닭',
      '해결',
    ])
  })

  it('묶음 목록 — `analyses.detected_elements` 의 `type` 을 꺼낸다', () => {
    const 묶음 = [
      { type: 'EMPATHY', evidence: '창피했을 것 같아' },
      { type: 'REASON', evidence: '그러니까' },
    ]
    expect(elementNames(묶음)).toEqual(['공감', '까닭'])
  })

  it('같은 코드가 근거만 달리해 여러 번 와도 한 번만 남는다', () => {
    const 묶음 = [
      { type: 'EMPATHY', evidence: '창피했을 것 같아' },
      { type: 'EMPATHY', evidence: '무서웠겠다' },
      { type: 'REASON', evidence: '그러니까' },
    ]
    expect(elementNames(묶음)).toEqual(['공감', '까닭'])
  })

  it('`type` 이 없는 묶음은 건너뛴다 — 파이썬의 `값 is not None` 자리', () => {
    expect(elementNames([{ evidence: '근거만 있다' }, { type: 'EMPATHY' }])).toEqual(['공감'])
  })

  it('순서는 들어온 대로다', () => {
    expect(elementNames(['SOLUTION', 'EMPATHY'])).toEqual(['해결', '공감'])
  })
})

describe('스키마·시드와 대조 — 어긋나면 화면에 코드가 그대로 뜬다', () => {
  it('`sql/001_schema.sql` 의 허용 값 주석과 여덟이 정확히 같다', () => {
    const 원문 = 읽기('sql/001_schema.sql')
    const 줄 = /--\s*허용 값:\s*([A-Z,\s]+)/.exec(원문)
    expect(줄, 'required_elements 의 허용 값 주석을 못 찾았다').not.toBeNull()

    const 허용 = 줄![1]
      .split(',')
      .map((조각) => 조각.trim())
      .filter((조각) => 조각.length > 0)
    expect(허용.length).toBe(8)
    expect([...허용].sort()).toEqual(Object.keys(요소).sort())
  })

  it('`sql/002_seed_banggui.sql` 이 쓰는 코드가 모두 표에 있다', () => {
    const 쓴_코드 = 시드가_쓰는_코드(읽기('sql/002_seed_banggui.sql'))
    expect(쓴_코드.length, '시드에서 요소 코드를 하나도 못 뽑았다 — 훑는 규칙이 낡았다').toBeGreaterThan(0)
    expect(표에_없는(쓴_코드)).toEqual([])
  })

  it('`web/db/seed.ts` 가 쓰는 코드가 모두 표에 있다', () => {
    const 원문 = 읽기('web/db/seed.ts')
    const 쓴_코드 = [
      // required_elements: ['PERSPECTIVE', ...]
      ...[...원문.matchAll(/required_elements:\s*\[([^\]]*)\]/g)].flatMap((짝) =>
        [...짝[1].matchAll(/'([A-Z_]+)'/g)].map((따옴표) => 따옴표[1]),
      ),
      // element_criteria · remaining_worries 의 키 (`EMPATHY: '…'`)
      ...[...원문.matchAll(/^\s*([A-Z][A-Z_]+):/gm)].map((짝) => 짝[1]),
    ]
    expect(쓴_코드.length, '시드에서 요소 코드를 하나도 못 뽑았다 — 훑는 규칙이 낡았다').toBeGreaterThan(0)
    expect(표에_없는(쓴_코드)).toEqual([])
  })
})

/** SQL 시드가 요소 코드를 적는 두 자리 — `ARRAY[...]` 와 jsonb 키. */
function 시드가_쓰는_코드(원문: string): string[] {
  const ARRAY_안 = [...원문.matchAll(/ARRAY\[([^\]]*)\]/g)].flatMap((짝) =>
    [...짝[1].matchAll(/'([A-Z_]+)'/g)].map((따옴표) => 따옴표[1]),
  )
  const jsonb_키 = [...원문.matchAll(/"([A-Z][A-Z_]+)"\s*:/g)].map((짝) => 짝[1])
  return [...ARRAY_안, ...jsonb_키]
}

function 표에_없는(코드들: readonly string[]): string[] {
  // `in` 이 아니라 `Object.hasOwn` 이다 — `constructor` 같은 이름이 표에 있는 것처럼 보이면 안 된다.
  return [...new Set(코드들)].filter((코드) => !Object.hasOwn(요소, 코드)).sort()
}
