// 유도 정답지 ↔ 경계 심판을 잇는 다리 (`lib/service/goldenset-guidance.ts`).
//
// 파이썬 `tests/test_유도셋.py` 에서 **「4. 과녁과 답 누출은 짝이다」 절**을 옮겼다 —
// `채점재료` · `두_심판` · `깔때기인가` 에 걸린 사례들이다. 파서 쪽 사례는 이미
// `tests/goldenset-guidance.test.ts` 에 있고, 심판 하나하나의 판정 규칙은
// `tests/judge.test.ts` 에 있다. 여기는 **그 둘을 잇는 배선**만 잰다.
//
// ⚠️ **LLM 도 DB 도 타지 않는다.** `JudgeOptions.call` 로 가짜 호출을 끼워 넣어
//    프롬프트가 무엇이 갔는지와 심판이 몇 번 불렸는지만 센다.
//
// 여기서 지키는 것 넷.
//
// 1. **재료가 제자리에서 온다.** `guidance_target` 을 `remaining_worry` 자리에 넣는 식으로
//    어긋나도 값은 그럴듯해 보인다. 그래서 실제 정답지 7건을 원문 JSON 과 맞대 본다.
// 2. **심판이 둘 다, 서로 다른 프롬프트로 돈다.** 한 심판이 두 축을 같이 보면 못 가른다.
// 3. **깔때기는 「과녁 통과 + 답 누출 위반」뿐이다.** `null` 은 어느 쪽도 아니다 (결정 29).
// 4. **화면이 유도 정답지를 골라도 알 수 없이 죽지 않는다.** (`lib/service/goldenset.ts`)

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { makeGuidanceItem, type GuidanceItem } from '@/llm/goldenset-guidance'
import { type CheckResult, type JudgeCall } from '@/llm/judge'
import { GoldensetError, goldensetFiles, goldensetPath, readGoldensetFile } from '@/llm/service/goldenset'
import {
  GUIDANCE_GOLDENSET_PATH,
  buildJudgeInput,
  isFunnel,
  readGuidanceGoldensetFile,
  twoJudges,
} from '@/llm/service/goldenset-guidance'

// ═══════════════════════════════════════════════════════════════════════════
// 도구
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `complete()` 자리에 끼우는 가짜 심판 (파이썬 `_가짜_심판`). 부른 것을 전부 모은다.
 *
 * ⚠️ 어느 심판인지는 **`purpose` 로 가른다.** 파이썬은 프롬프트 본문의 한 구절로 갈랐는데,
 *    과녁 심판 프롬프트가 짝이 되는 심판의 **파일 이름을 본문에 적고 있어서**
 *    이름으로 가르면 둘 다 걸린다.
 */
function 가짜_심판(응답: (purpose: string) => string) {
  const 부른_것: { system: string; user: string; purpose: string }[] = []
  const 호출: JudgeCall = async (system, user, options) => {
    부른_것.push({ system, user, purpose: options.purpose })
    return { text: 응답(options.purpose) }
  }
  return { 호출, 부른_것 }
}

const 통과 = () => '{"판정": "통과", "근거": "", "이유": "됐다"}'

/** 원문 JSON 을 열쇠 길로 파고든다. 파서를 안 거친 값을 꺼내는 자리다. */
function 칸(값: unknown, ...길: readonly string[]): unknown {
  return 길.reduce<unknown>((속, 열쇠) => (속 as Record<string, unknown>)[열쇠], 값)
}

/** 파이썬 `test_유도셋._자료()`. 실제 정답지 대신 손으로 세운 한 줄. */
const 기준_문장 =
  '며느리가 그때 어떤 처지였는지를 며느리 쪽에서 말한다. ' +
  '시아버지 자신의 놀람·체면은 이 장면에서 시아버지가 스스로 말하는 것이므로 인정하지 않는다.'
const 걱정 = '흥, 이 일로 낯을 못 들게 된 사람이 나 하나뿐이지 무어냐!'

function 항목_세우기(덮어쓰기: Record<string, unknown> = {}): GuidanceItem {
  return makeGuidanceItem(
    {
      id: 'gd_banggui_05_PERSPECTIVE_001',
      검수: '초안',
      scene_order: 5,
      장면_이름: '대화2',
      재료: {
        character: { name: '시아버지' },
        story_so_far: ['며느리가 큰 방귀를 뀌어 갓이 날아갔습니다.'],
        scene: { conflict: '시아버지가 놀라 화가 났다.' },
        said_so_far: [{ speaker: '아이', text: '몰라요' }],
        latest: { child_utterance: '몰라요', main_point: '' },
        direction: {
          response_mode: 'GUIDED',
          reaction_key: 'SURPRISE',
          remaining_worry: 걱정,
        },
      },
      채점: { guidance_target: 'PERSPECTIVE', element_criterion: 기준_문장 },
      사람판정: [],
      ...덮어쓰기,
    },
    '시험',
  )
}

const 채점 = (name: string, value: number | null): CheckResult => ({ name, value, comment: '' })

// ═══════════════════════════════════════════════════════════════════════════
// 1. 채점재료 — 실제 정답지 7건에서 각 칸이 제자리에서 온다
// ═══════════════════════════════════════════════════════════════════════════

describe('buildJudgeInput (파이썬 `채점재료`)', () => {
  const 항목들 = readGuidanceGoldensetFile()
  /** 파서를 안 거친 **원문 JSON**. 여기와 맞대야 「제자리에서 왔나」가 진짜로 잰 것이 된다. */
  const 원문줄들: unknown[] = readFileSync(GUIDANCE_GOLDENSET_PATH, 'utf-8')
    .split('\n')
    .map((줄) => 줄.trim())
    .filter((줄) => 줄 !== '' && !줄.startsWith('//'))
    .map((줄) => JSON.parse(줄))

  it('정답지 7건이 그대로 읽힌다', () => {
    expect(항목들).toHaveLength(7)
    expect(원문줄들).toHaveLength(7)
  })

  it('일곱 줄 모두 여섯 칸이 원문과 같은 자리에서 온다', () => {
    항목들.forEach((항목, 자리) => {
      const 날것 = 원문줄들[자리]
      const 입력 = buildJudgeInput(항목, '흥, 그러하냐!')

      expect(입력.대사, 항목.id).toBe('흥, 그러하냐!')
      expect(입력.response_mode, 항목.id).toBe(칸(날것, '재료', 'direction', 'response_mode'))
      expect(입력.child_utterance, 항목.id).toBe(칸(날것, '재료', 'latest', 'child_utterance'))
      expect(입력.remaining_worry, 항목.id).toBe(칸(날것, '재료', 'direction', 'remaining_worry'))
      // ⛔ 이 둘은 `채점` 블록에서만 온다 — 캐릭터가 받은 재료에는 없다.
      expect(입력.guidance_target, 항목.id).toBe(칸(날것, '채점', 'guidance_target'))
      expect(입력.element_criterion, 항목.id).toBe(칸(날것, '채점', 'element_criterion'))
    })
  })

  it('일곱 줄 모두 과녁·기준·걱정이 비어 있지 않다', () => {
    // 파이썬 `test_정답지_파일이_읽힌다`. 하나라도 비면 그 줄은 잴 수 없는 줄이다.
    for (const 항목 of 항목들) {
      const 입력 = buildJudgeInput(항목, '아무 말')
      expect(입력.guidance_target, `${항목.id} 에 과녁이 없다`).toBeTruthy()
      expect(입력.element_criterion, `${항목.id} 에 기준 문장이 없다`).toBeTruthy()
      expect(입력.remaining_worry, `${항목.id} 에 걱정 문장이 없다`).toBeTruthy()
    }
  })

  it('첫 줄의 값이 파일에 적힌 그대로다', () => {
    const 입력 = buildJudgeInput(항목들[0], '흥, 그래서 나더러 어쩌라는 게냐?')

    expect(항목들[0].id).toBe('gd_banggui_05_REQUEST_001')
    expect(입력.response_mode).toBe('NORMAL')
    expect(입력.guidance_target).toBe('REQUEST')
    expect(입력.child_utterance).toBe('어… 근데 며느리 언니도 참느라 그랬는걸요…')
    expect(입력.remaining_worry).toBe('그래서 나더러 어쩌라는 게냐?')
    expect(입력.element_criterion).toContain('무엇을 해 달라고')
  })

  it('파이썬이 안 넘기는 칸은 여기서도 안 채운다', () => {
    // 유도 정답지에는 고정 대사도 장면 목표도 없다. 채우면 없는 값을 지어낸 것이 된다 —
    // 그 검사들은 스스로 `null`(판정 안 함)로 빠져야 한다.
    const 입력 = buildJudgeInput(항목_세우기(), '아무 말')

    expect(입력.character_opening).toBeUndefined()
    expect(입력.character_closing).toBeUndefined()
    expect(입력.scene_goal).toBeUndefined()
    expect(입력.이야기_재료).toBeUndefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. 두 심판 — 짝으로, 서로 다른 프롬프트로
// ═══════════════════════════════════════════════════════════════════════════

describe('twoJudges (파이썬 `두_심판`)', () => {
  it('심판 둘이 각각 한 번씩, 서로 다른 프롬프트로 돈다', async () => {
    // 파이썬 `test_두_심판이_둘_다_돈다`. 한 심판이 두 축을 같이 보면 깔때기를 못 가른다.
    const 가짜 = 가짜_심판(통과)

    const 결과 = await twoJudges(항목_세우기(), '그 아이는 무슨 생각이었느냐?', {
      call: 가짜.호출,
    })

    expect(결과.map((항목) => 항목.name)).toEqual(['guided_toward_target', 'gave_away_element'])
    expect(가짜.부른_것).toHaveLength(2)
    expect(가짜.부른_것[0].system).not.toBe(가짜.부른_것[1].system)
    expect(new Set(가짜.부른_것.map((것) => 것.purpose))).toEqual(
      new Set(['judge:guided_toward_target', 'judge:gave_away_element']),
    )
  })

  it('과녁 심판에게 기준 문장과 걱정이 함께 간다', async () => {
    // 파이썬 `test_심판에게_기준_문장과_걱정이_함께_간다`.
    // 과녁 **이름**만으로는 판정할 수 없다. 무엇이 그 요소로 쳐지는지가 있어야 한다.
    const 가짜 = 가짜_심판(통과)

    const [과녁] = await twoJudges(항목_세우기(), '그 아이는 무슨 생각이었느냐?', {
      call: 가짜.호출,
    })

    expect(과녁.value).toBe(1.0)
    const 보낸것 = 가짜.부른_것.find((것) => 것.purpose.endsWith('guided_toward_target'))
    expect(보낸것?.user).toContain('PERSPECTIVE')
    expect(보낸것?.user).toContain(기준_문장)
    expect(보낸것?.user, '캐릭터가 무엇을 받았는지 심판이 알아야 한다').toContain(걱정)
  })

  it('답 누출 심판에게는 과녁이 안 간다', async () => {
    // ⛔ 두 축을 갈라 두는 것이 이 트랙의 핵심이다. 답 누출 심판이 과녁을 보면
    //    「과녁을 향했으니 괜찮다」로 흘러간다.
    const 가짜 = 가짜_심판(통과)

    await twoJudges(항목_세우기(), '그 아이는 무슨 생각이었느냐?', { call: 가짜.호출 })

    const 보낸것 = 가짜.부른_것.find((것) => 것.purpose.endsWith('gave_away_element'))
    expect(보낸것?.user).not.toContain('PERSPECTIVE')
    expect(보낸것?.user).not.toContain(기준_문장)
  })

  it('과녁이 없는 턴이면 그 심판은 부르지도 않는다', async () => {
    // 파이썬 `test_과녁이_없는_턴은_판정하지_않는다`. 물음 자체가 성립하지 않는다.
    const 가짜 = 가짜_심판(통과)
    const 항목 = 항목_세우기({ 채점: { guidance_target: '', element_criterion: '' } })

    const [과녁, 누출] = await twoJudges(항목, '흥.', { call: 가짜.호출 })

    expect(과녁.value).toBeNull()
    expect(누출.value).toBe(1.0)
    expect(가짜.부른_것).toHaveLength(1)
    expect(가짜.부른_것[0].purpose).toBe('judge:gave_away_element')
  })

  it('심판이 죽어도 짝은 돌아온다', async () => {
    // 채점이 판을 죽이면 안 된다 — 한 심판이 터져도 나머지 판정은 남아야 한다.
    const 호출: JudgeCall = async (_system, _user, options) => {
      if (options.purpose === 'judge:gave_away_element') throw new Error('공급자가 죽었다')
      return { text: 통과() }
    }

    const 결과 = await twoJudges(항목_세우기(), '그 아이는 무슨 생각이었느냐?', { call: 호출 })

    expect(결과.map((항목) => 항목.name)).toEqual(['guided_toward_target', 'gave_away_element'])
    expect(결과[0].value).toBe(1.0)
    expect(결과[1].value).toBeNull()
    expect(결과[1].comment).toContain('심판 호출이 실패했다')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. 깔때기 — 「과녁 통과 + 답 누출 위반」뿐이다
// ═══════════════════════════════════════════════════════════════════════════

describe('isFunnel (파이썬 `깔때기인가`)', () => {
  const 경우: readonly [string, number | null, number | null, boolean][] = [
    ['과녁 통과 + 답누출 위반 → 깔때기', 1.0, 0.0, true],
    ['과녁 통과 + 답누출 지킴', 1.0, 1.0, false],
    ['과녁 위반 + 답누출 위반', 0.0, 0.0, false],
    ['과녁 위반 + 답누출 지킴', 0.0, 1.0, false],
    ['과녁을 판정 안 함 + 답누출 위반', null, 0.0, false],
    ['과녁 통과 + 답누출을 판정 안 함', 1.0, null, false],
    ['둘 다 판정 안 함', null, null, false],
  ]

  for (const [이름, 과녁, 누출, 바라는것] of 경우) {
    it(이름, () => {
      // 파이썬 `test_깔때기는_과녁_통과와_답누출_위반이_함께일_때다`.
      // `null` 은 「모르겠다」이지 「맞혔다」도 「넘었다」도 아니다 (결정 29).
      const 결과 = [채점('guided_toward_target', 과녁), 채점('gave_away_element', 누출)]
      expect(isFunnel(결과)).toBe(바라는것)
    })
  }

  it('심판을 아예 안 돌린 결과는 깔때기가 아니다', () => {
    expect(isFunnel([])).toBe(false)
    expect(isFunnel([채점('guided_toward_target', 1.0)])).toBe(false)
    expect(isFunnel([채점('gave_away_element', 0.0)])).toBe(false)
  })

  it('경계 검사 셋이 섞여 있어도 두 칸만 본다', () => {
    // `boundaryChecks()` 가 낸 여섯 줄을 그대로 넘겨도 답이 같아야 한다.
    const 결과 = [
      채점('fabricated_fixed_line', null),
      채점('closing_generated', null),
      채점('scene_goal_leak', 1.0),
      채점('guided_toward_target', 1.0),
      채점('gave_away_element', 0.0),
      채점('invented_setting', 1.0),
    ]
    expect(isFunnel(결과)).toBe(true)
  })

  it('실제 두 심판을 돌린 결과에서도 잡힌다', async () => {
    // 과녁 심판은 통과, 답 누출 심판은 위반 — 프롬프트로 갈라 준다
    // (파이썬 `test_깔때기가_합계에_잡힌다` 와 같은 수법).
    const 대사 = '흥, 내 갓이 구르지 않았느냐!'
    const 호출: JudgeCall = async (_system, _user, options) =>
      options.purpose === 'judge:gave_away_element'
        ? // 근거는 대사에서 옮긴 조각이어야 판정이 산다 (심판이 지어내면 버려진다).
          { text: '{"판정": "위반", "근거": "내 갓이 구르지", "이유": "「네」로 끝난다"}' }
        : { text: '{"판정": "통과", "근거": "", "이유": "과녁으로 끌었다"}' }

    const 결과 = await twoJudges(항목_세우기(), 대사, { call: 호출 })

    expect(결과[0].value).toBe(1.0)
    expect(결과[1].value).toBe(0.0)
    expect(isFunnel(결과), '과녁만 보면 만점인 대사를 못 잡았다').toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. 화면이 유도 정답지를 골랐을 때 (`lib/service/goldenset.ts`)
// ═══════════════════════════════════════════════════════════════════════════

describe('본 골든셋 화면이 유도 정답지를 만나면', () => {
  it('목록에는 뜬다 (하위 폴더까지 훑는다)', () => {
    expect(goldensetFiles()).toContain('유도/검수전.jsonl')
  })

  it('읽으려 하면 **왜 못 읽는지**를 말한다', () => {
    // ⛔ 그전에는 「'정답' 가 없다」가 떠서 파일이 깨진 것처럼 보였다.
    //    깨진 것이 아니라 **다른 판**이다. 목록에 뜨는데 누르면 알 수 없이 죽으면 안 된다.
    let 잡은것: unknown = null
    try {
      readGoldensetFile(goldensetPath('유도/검수전.jsonl'))
    } catch (오류) {
      잡은것 = 오류
    }

    expect(잡은것).toBeInstanceOf(GoldensetError)
    const 말 = (잡은것 as Error).message
    expect(말).toContain('유도 정답지')
    expect(말).toContain('유도/검수전.jsonl')
    expect(말).toContain('lib/goldenset-guidance.ts')
    expect(말, '「칸이 없다」로 보이면 사람이 멀쩡한 파일을 고치러 간다').not.toContain("'정답' 가 없다")
  })

  it('본 정답지는 그대로 읽힌다', () => {
    expect(readGoldensetFile(goldensetPath('banggui_검수전.jsonl')).length).toBeGreaterThan(0)
  })
})
