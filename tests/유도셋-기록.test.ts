// 유도 골든셋 하네스 — **엔진과 같은 프롬프트인가**와 **파일을 안전하게 쓰는가**를 지킨다.
//
// 파이썬 `tests/test_유도셋.py` 에서 이 절에 해당하는 사례를 옮겼다
// (⛔ 과녁 누출 · 엔진과 같은 프롬프트 · 뽑기 · 붙여쓰기 왕복 · 다음 번호).
// 심판과 판 돌리기 사례는 그 코드가 아직 여기 없어서 안 옮겼다.
//
// ⚠️ **LLM 도 DB 도 타지 않는다.** 글자를 만들어 견주고, 파일은 `mkdtemp` 안에서만 쓴다.
// 🔴 `goldenset/유도/검수전.jsonl` 원본은 **읽기만** 한다. 정답지 7건은 되살릴 데가 없다.
//
// 여기서 지키는 것 넷.
//
// 1. **캐릭터에게 과녁이 안 간다.** 채점 재료가 프롬프트에 새면 엔진보다 쉬운 문제를 재는 것이다.
// 2. **엔진과 같은 함수를 지나간다.** 갈라지면 그전에 잰 점수가 엔진 조건의 값이 아니게 된다
//    (결정 54 를 두 번 겪은 자리다).
// 3. **직렬화가 파이썬과 한 글자도 안 다르다.** 정답지 파일이 파이썬이 쓴 것이라, 여기가
//    어긋나면 한 줄만 고쳐도 파일 전체가 다시 쓰인다.
// 4. **통째로 다시 쓰는 자리가 원자적이다.** 중간에 죽어도 옛 파일이 남아야 한다.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it, vi } from 'vitest'

import { PROJECT_ROOT } from '@/llm/config'
import { buildCharacterMaterial, buildCharacterMaterialBundle } from '@/llm/engine/material'
import {
  makeGuidanceItem,
  parseGuidanceGoldenset,
  type GuidanceItem,
} from '@/llm/goldenset-guidance'
import { chooseBody } from '@/llm/prompts'
import { promptDigest } from '@/llm/service/goldenset'
import {
  appendItem,
  characterMaterialBlock,
  characterPromptDigest,
  engineLineMaker,
  lineRequest,
  nextNumber,
  pickItem,
  recordHumanVerdict,
  recordLines,
  rewriteLines,
  파이썬_JSON,
} from '../tools/유도셋-기록'

// ⛔ 진짜 공급자를 부르지 않는다. `generateLine()` 은 진짜로 돌고 그 아래 `complete()` 만 가짜다 —
//    「엔진과 같은 (system, user) 로 나가는가」가 재는 대상이라 그 위는 진짜여야 한다.
//    ⚠️ `vi.mock` 은 파일 맨 위로 끌어올려지므로 기록통은 `vi.hoisted` 로 만든다.
const 가짜LLM = vi.hoisted(() => ({ 부른것: [] as { system: string; user: string }[] }))

vi.mock('@/llm/provider', async (importOriginal) => {
  const 진짜 = await importOriginal<typeof import('@/llm/provider')>()
  return {
    ...진짜,
    complete: async (system: string, user: string) => {
      가짜LLM.부른것.push({ system, user })
      return {
        text: '  흥, 내 갓이 구르지 않았느냐!  ',
        provider: 'fake',
        model: 'fake-model',
      }
    },
  }
})

// 대화2(`scene_order` 5) 첫 유도 자리. 값은 `sql/002_seed_banggui.sql` 에서 가져왔다.
const 기준_문장 =
  '며느리가 그때 어떤 처지였는지를 며느리 쪽에서 말한다. ' +
  '시아버지 자신의 놀람·체면은 이 장면에서 시아버지가 스스로 말하는 것이므로 인정하지 않는다.'
const 걱정 = '흥, 이 일로 낯을 못 들게 된 사람이 나 하나뿐이지 무어냐!'

/** 파이썬 시험의 `_자료()`. 한 줄의 모양을 그대로 옮겼다. */
function 자료(덮어쓰기: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'gd_banggui_05_PERSPECTIVE_001',
    검수: '초안',
    scene_order: 5,
    장면_이름: '시아버지',
    재료: {
      character: {
        name: '시아버지',
        persona: '체면과 남의 시선을 무엇보다 중히 여기는',
        speech_style: '흥, ~느냐 하는 옛말투',
        guidance_style: '자기 입장을 먼저 세게 말하고',
        forbidden: ['아이를 나무라지 않는다'],
      },
      story_so_far: ['며느리가 큰 방귀를 뀌어 갓이 날아갔습니다.'],
      scene: { conflict: '시아버지가 놀라 화가 났다.', stance: '노여움' },
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
    메모: '',
    ...덮어쓰기,
  }
}

function 항목(덮어쓰기: Record<string, unknown> = {}): GuidanceItem {
  return makeGuidanceItem(자료(덮어쓰기), '시험')
}

// 임시 디렉터리 — 🔴 원본 정답지 근처에 아무것도 쓰지 않는다.
const 임시들: string[] = []
function 새_경로(이름 = '유도.jsonl'): string {
  const 방 = mkdtempSync(path.join(tmpdir(), 'gq-유도셋-'))
  임시들.push(방)
  return path.join(방, 이름)
}
afterAll(() => {
  for (const 방 of 임시들) rmSync(방, { recursive: true, force: true })
})

// ═══════════════════════════════════════════════════════════════════════════
// 1. ⛔ 캐릭터에게 과녁이 안 간다
// ═══════════════════════════════════════════════════════════════════════════

describe('채점 재료가 캐릭터에게 새지 않는다', () => {
  it('재료 블록에 과녁이 없다', () => {
    // 기준 문서 13절 — 규칙 층은 요소 **이름**과 걱정 문장만 넘긴다. 캐릭터에게는 이름조차 안 간다.
    const 블록 = characterMaterialBlock(항목())

    expect(블록).not.toContain('PERSPECTIVE')
    expect(블록).not.toContain('며느리 쪽에서 말한다')
    expect(블록).not.toContain('element_criterion')
    expect(블록.split('낯을 못 들게 된 사람').length - 1).toBe(1) // 걱정 한 줄은 가야 한다
  })

  it('대사 요청 어디에도 과녁이 없다', () => {
    // `system` 과 `user` 를 통틀어 본다 — 자리표시자로 새는 길이 따로 있다.
    const { system, user } = lineRequest(항목())

    expect(system + user).not.toContain('PERSPECTIVE')
    expect(system + user).not.toContain(기준_문장)
  })

  it('뽑은 항목에서도 과녁은 채점 쪽에만 있다', () => {
    const 뽑은것 = pickItem(뽑기_인자())
    expect(뽑은것).not.toBeNull()

    expect(파이썬_JSON(뽑은것!.재료)).not.toContain('PERSPECTIVE')
    expect(뽑은것!.채점).toEqual({
      guidance_target: 'PERSPECTIVE',
      element_criterion: 기준_문장,
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. 엔진과 같은 프롬프트
// ═══════════════════════════════════════════════════════════════════════════

describe('엔진과 같은 프롬프트로 낸다', () => {
  it('system 은 `보낼것.md` 통째다 — 엔진과 같은 글자', () => {
    // 🔴 2026-08-14 에 프롬프트가 두 파일로 갈렸다. 그전에는 한 파일 안에서 표식 사이를
    //    오려 냈고(`sendableBody()`), 그 오려내기가 CRLF 체크아웃에서 깨졌었다.
    //    이제 **오릴 것이 없다** — 파일이 곧 나가는 글자다.
    const { system } = lineRequest(항목())
    expect(system).toBe(chooseBody('character', null))
  })

  it('system 에 사람용 표시가 없다', () => {
    // 사람이 읽는 글은 옆 파일에 산다. 이쪽에 새어 오면 안 된다.
    const { system } = lineRequest(항목())
    for (const 새면_안_되는_것 of ['한글 층', '📄', '✏️', '결정 48', 'docs/', 'CLAUDE.md']) {
      expect(system).not.toContain(새면_안_되는_것)
    }
  })

  it('user 는 엔진이 만드는 글자와 **한 글자도** 다르지 않다', () => {
    // 🔴 이 검사가 이 파일의 이유다. 골든셋이 엔진과 다른 프롬프트로 돌면 잰 값이 뜻을 잃는다
    //    (2026-08-10 · 결정 54). 뽑은 재료가 곧 엔진이 만드는 묶음이므로 글자까지 같아야 한다.
    const 인자 = 뽑기_인자()
    const 재료 = pickItem(인자)!.재료 as Record<string, unknown>

    expect(lineRequest({ 재료 }).user).toBe(buildCharacterMaterial(인자))
  })

  it('재료 열쇠가 엔진과 같다', () => {
    // 파이썬은 소스를 뜯어 견줬다(DB 없이 그 함수를 못 불러서다). 여기서는 **실제로 불러** 견준다.
    const 엔진_열쇠 = Object.keys(buildCharacterMaterialBundle(뽑기_인자()))
    const 골든_열쇠 = Object.keys(JSON.parse(characterMaterialBlock(항목())) as object)

    expect(new Set(골든_열쇠)).toEqual(new Set(엔진_열쇠))
  })

  it('direction 의 열쇠도 엔진과 같다', () => {
    // 캐릭터가 받는 「지시」 묶음이다. 여기가 어긋나면 유도 자체가 달라진다.
    const 자료_ = JSON.parse(characterMaterialBlock(항목())) as Record<string, object>
    expect(new Set(Object.keys(자료_.direction))).toEqual(
      new Set(['response_mode', 'reaction_key', 'remaining_worry']),
    )
  })

  it('실험 프롬프트를 주면 본문과 틀이 같은 출처다', () => {
    const 실험 = '실험 본문\n\n## 받는 것\n\n```json\n{character_material}\n```\n'
    const { system, user } = lineRequest(항목(), 실험)

    // 표식(`<!-- 보내는 것 시작 -->`)이 없으면 통째로 보낸다 (결정 48) — 사람이 쓴 본문이
    // 잘려 사라지지 않게. 그래서 `system` 이 준 글자 그대로다.
    expect(system).toBe(실험)
    expect(JSON.parse(user)).toHaveProperty('direction.response_mode', 'GUIDED')
  })

  it('엔진 대사 내기는 엔진과 같은 (system, user) 를 LLM 에 넘긴다', async () => {
    // ⛔ 진짜 LLM 을 타면 안 된다. `@/llm/llm` 의 `complete()` 를 가짜로 바꾼다.
    //    ⭐ `generateLine()` 자체는 진짜로 돈다 — 엔진이 부르는 것과 같은 길인지가 재는 대상이다.
    const { system, user } = lineRequest(항목())
    const 대사 = await engineLineMaker()(system, user)

    expect(가짜LLM.부른것).toEqual([{ system, user }])
    expect(대사).toBe('흥, 내 갓이 구르지 않았느냐!') // 앞뒤 공백만 떨어진다
  })

  it('프롬프트 지문은 **캐릭터** 파일 원문의 것이다', () => {
    const 지문 = characterPromptDigest()
    expect(지문).toMatch(/^[0-9a-f]{64}$/)
    // 분석 쪽 지문(`prompts/analysis.md`)과 달라야 한다 — 다른 파일이다.
    expect(지문).not.toBe(promptDigest())
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. 뽑기
// ═══════════════════════════════════════════════════════════════════════════

/** `pickItem()` 에 넘길 한 벌. 위 `자료()` 와 같은 값이 나오게 맞춰 뒀다. */
function 뽑기_인자(덮어쓰기: Record<string, unknown> = {}) {
  return {
    scene: {
      scene_order: 5,
      character_name: '시아버지',
      persona: '체면과 남의 시선을 무엇보다 중히 여기는',
      speech_style: '흥, ~느냐 하는 옛말투',
      guidance_style: '자기 입장을 먼저 세게 말하고',
      forbidden: ['아이를 나무라지 않는다'],
      conflict: '시아버지가 놀라 화가 났다.',
      scene_stance: '노여움',
      remaining_worries: { PERSPECTIVE: 걱정 },
      element_criteria: { PERSPECTIVE: 기준_문장 },
    },
    precedingNarrations: [{ scene_description: '며느리가 큰 방귀를 뀌어 갓이 날아갔습니다.' }],
    child_utterance: '몰라요',
    main_point: '',
    response_mode: 'GUIDED',
    reaction_key: 'SURPRISE',
    guidance_target: 'PERSPECTIVE',
    pastMessages: [{ speaker_type: 'child', text: '몰라요' }],
    번호: 1,
    ...덮어쓰기,
  }
}

describe('항목 뽑기', () => {
  it('과녁이 없는 턴은 안 뽑는다', () => {
    // NORMAL 이고 soft-cue 도 아닌 턴은 잴 것이 없다. 줄을 만들지 않는다.
    expect(pickItem(뽑기_인자({ guidance_target: null }))).toBeNull()
  })

  it('뽑은 줄이 그대로 다시 항목이 된다', () => {
    // 여기가 어긋나면 뽑아도 못 읽는다.
    const 뽑은것 = pickItem(뽑기_인자())!
    const 읽은것 = makeGuidanceItem(뽑은것, '시험')

    expect(읽은것.id).toBe('gd_banggui_05_PERSPECTIVE_001')
    expect(읽은것.guidance_target).toBe('PERSPECTIVE')
    expect(읽은것.검수).toBe('초안')
    expect(읽은것.장면_이름).toBe('시아버지')
  })

  it('id 는 장면 두 자리 · 과녁 · 번호 세 자리다', () => {
    const 뽑은것 = pickItem(뽑기_인자({ 번호: 12 }))!
    expect(뽑은것.id).toBe('gd_banggui_05_PERSPECTIVE_012')
  })

  it('기준 문장이 없으면 빈 글자다 — 지어내지 않는다', () => {
    const 뽑은것 = pickItem(
      뽑기_인자({
        scene: { ...뽑기_인자().scene, element_criteria: null },
      }),
    )!
    expect(뽑은것.채점).toEqual({ guidance_target: 'PERSPECTIVE', element_criterion: '' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. 직렬화 — 파이썬이 쓴 파일과 한 글자도 안 달라야 한다
// ═══════════════════════════════════════════════════════════════════════════

describe('파이썬_JSON', () => {
  it('구분자가 파이썬 기본값이다', () => {
    // 🔴 `JSON.stringify` 는 공백이 없다. 파이썬 `json.dumps` 기본은 `", "` 와 `": "` 다.
    expect(파이썬_JSON({ a: 1, b: [1, 2] })).toBe('{"a": 1, "b": [1, 2]}')
    expect(JSON.stringify({ a: 1, b: [1, 2] })).toBe('{"a":1,"b":[1,2]}')
  })

  it('한글을 \\uXXXX 로 부풀리지 않는다', () => {
    // 파이썬 `ensure_ascii=False` 자리다.
    expect(파이썬_JSON({ 말: '흥, 갓이!' })).toBe('{"말": "흥, 갓이!"}')
  })

  it('빈 것과 null 을 파이썬처럼 쓴다', () => {
    expect(파이썬_JSON({ a: {}, b: [], c: null, d: undefined })).toBe(
      '{"a": {}, "b": [], "c": null}',
    )
  })

  it('goldenset/유도/검수전.jsonl 일곱 줄이 글자까지 왕복한다', () => {
    // 🔴 **읽기만 한다.** 이 파일이 곧 사람이 매긴 정답지다.
    const 경로 = path.join(PROJECT_ROOT, 'goldenset', '유도', '검수전.jsonl')
    const 원문 = readFileSync(경로, 'utf-8')

    const 데이터줄 = 원문
      .split('\n')
      .map((줄) => 줄.trim())
      .filter((줄) => 줄 !== '' && !줄.startsWith('//'))

    expect(데이터줄.length).toBeGreaterThan(0)
    for (const 줄 of 데이터줄) {
      expect(파이썬_JSON(JSON.parse(줄))).toBe(줄)
    }
    // 파서도 같은 줄을 읽는다 — 형식이 갈리지 않았다는 뜻이다.
    expect(parseGuidanceGoldenset(원문, 경로)).toHaveLength(데이터줄.length)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. 파일 쓰기
// ═══════════════════════════════════════════════════════════════════════════

describe('붙여쓰기와 번호', () => {
  it('붙여쓴 줄이 그대로 다시 읽힌다', () => {
    const 경로 = 새_경로()
    appendItem(경로, 자료())
    appendItem(경로, 자료({ id: 'gd_banggui_05_PERSPECTIVE_002' }))

    const 항목들 = parseGuidanceGoldenset(readFileSync(경로, 'utf-8'), 경로)
    expect(항목들.map((하나) => 하나.id)).toEqual([
      'gd_banggui_05_PERSPECTIVE_001',
      'gd_banggui_05_PERSPECTIVE_002',
    ])
    expect(항목들[0].guidance_target).toBe('PERSPECTIVE')
  })

  it('파일이 없으면 디렉터리째 만든다', () => {
    const 경로 = path.join(path.dirname(새_경로()), '없던', '유도.jsonl')
    appendItem(경로, 자료())
    expect(readFileSync(경로, 'utf-8').endsWith('\n')).toBe(true)
  })

  it('다음 번호는 같은 과녁만 센다', () => {
    // 과녁마다 따로 번호를 매긴다 — `id` 만 보고 어느 요소 판인지 알게.
    const 경로 = 새_경로()
    appendItem(경로, 자료())

    expect(nextNumber(경로, 'PERSPECTIVE')).toBe(2)
    expect(nextNumber(경로, 'EMPATHY')).toBe(1)
  })

  it('파일이 없으면 1 이다', () => {
    expect(nextNumber(path.join(path.dirname(새_경로()), '없다.jsonl'), 'REASON')).toBe(1)
  })
})

describe('고쳐쓰기', () => {
  const 머리말 = '// 유도 골든셋\n// 두 줄짜리 머리말\n\n'

  function 준비(): string {
    const 경로 = 새_경로()
    writeFileSync(경로, 머리말 + `${파이썬_JSON(자료())}\n`, 'utf-8')
    return 경로
  }

  it('머리말과 빈 줄을 글자 그대로 둔다', () => {
    const 경로 = 준비()
    const 바뀐 = rewriteLines(경로, () => null)

    expect(바뀐).toBe(0)
    expect(readFileSync(경로, 'utf-8')).toBe(머리말 + `${파이썬_JSON(자료())}\n`)
  })

  it('고친 줄만 다시 쓴다', () => {
    const 경로 = 준비()
    appendItem(경로, 자료({ id: 'gd_banggui_05_EMPATHY_001' }))

    const 바뀐 = rewriteLines(경로, (하나) =>
      하나.id === 'gd_banggui_05_EMPATHY_001' ? { ...하나, 메모: '고침' } : null,
    )

    expect(바뀐).toBe(1)
    const 항목들 = parseGuidanceGoldenset(readFileSync(경로, 'utf-8'), 경로)
    expect(항목들.map((하나) => 하나.메모)).toEqual(['', '고침'])
  })

  it('고치기가 터지면 옛 파일이 그대로 남는다', () => {
    // 🔴 원자적으로 쓴다는 것의 뜻이다. 정답지는 되살릴 데가 없다.
    const 경로 = 준비()
    const 옛것 = readFileSync(경로, 'utf-8')

    expect(() =>
      rewriteLines(경로, () => {
        throw new Error('중간에 죽었다')
      }),
    ).toThrow('중간에 죽었다')

    expect(readFileSync(경로, 'utf-8')).toBe(옛것)
  })
})

describe('대사 적기', () => {
  const 대사 = '흥, 내 갓이 구르지 않았느냐!'

  function 준비(): string {
    const 경로 = 새_경로()
    appendItem(경로, 자료())
    return 경로
  }

  const 채점 = (과녁: number | null, 누출: number | null) => [
    { name: 'guided_toward_target', value: 과녁, comment: '' },
    { name: 'gave_away_element', value: 누출, comment: '' },
  ]

  it('심판 판정과 함께 판정대기로 들어간다', () => {
    const 경로 = 준비()
    const 바뀐 = recordLines(
      경로,
      [{ 항목_id: 'gd_banggui_05_PERSPECTIVE_001', 대사, 채점들: 채점(1, 0) }],
      { 돌린날: '2026-08-14', 프롬프트_지문: 'abc123' },
    )

    expect(바뀐).toBe(1)
    const [항목_] = parseGuidanceGoldenset(readFileSync(경로, 'utf-8'), 경로)
    expect(항목_.대기들).toEqual([
      {
        대사,
        심판_과녁: '적중',
        심판_답누출: '위반',
        돌린날: '2026-08-14',
        프롬프트_지문: 'abc123',
        옛심판: [],
        심판_지문: '',
        심판_표: '',
      },
    ])
  })

  it('판정 못 한 축은 판정불가다', () => {
    // 「모르겠다」와 「틀렸다」를 섞지 않는다 (결정 29).
    const 경로 = 준비()
    recordLines(경로, [{ 항목_id: 'gd_banggui_05_PERSPECTIVE_001', 대사, 채점들: 채점(null, 1) }], {
      돌린날: '2026-08-14',
    })

    const [항목_] = parseGuidanceGoldenset(readFileSync(경로, 'utf-8'), 경로)
    expect(항목_.대기들[0].심판_과녁).toBe('판정불가')
    expect(항목_.대기들[0].심판_답누출).toBe('지킴')
  })

  it('같은 대사는 두 번 안 넣는다', () => {
    const 경로 = 준비()
    const 한판 = { 항목_id: 'gd_banggui_05_PERSPECTIVE_001', 대사, 채점들: 채점(1, 1) }
    recordLines(경로, [한판], { 돌린날: '2026-08-14' })

    expect(recordLines(경로, [한판], { 돌린날: '2026-08-15' })).toBe(0)
    const [항목_] = parseGuidanceGoldenset(readFileSync(경로, 'utf-8'), 경로)
    expect(항목_.대기들).toHaveLength(1)
  })

  it('대사를 못 낸 판은 줄을 안 건드린다', () => {
    const 경로 = 준비()
    expect(
      recordLines(경로, [{ 항목_id: 'gd_banggui_05_PERSPECTIVE_001', 대사: null }], {
        돌린날: '2026-08-14',
      }),
    ).toBe(0)
  })
})

describe('사람 판정 적기', () => {
  const 대사 = '흥, 내 갓이 구르지 않았느냐!'
  const 판정 = {
    대사,
    과녁: '성공',
    답누출: '지킴',
    근거: '며느리 처지를 묻게 열어 뒀다',
    매긴날: '2026-08-14',
  }

  function 준비(): string {
    const 경로 = 새_경로()
    appendItem(경로, 자료())
    return 경로
  }

  it('판정 하나가 들어간다', () => {
    const 경로 = 준비()
    expect(recordHumanVerdict(경로, 'gd_banggui_05_PERSPECTIVE_001', 판정)).toBe(true)

    const [항목_] = parseGuidanceGoldenset(readFileSync(경로, 'utf-8'), 경로)
    expect(항목_.사람판정들).toEqual([판정])
  })

  it('없는 id 면 아무것도 안 한다', () => {
    const 경로 = 준비()
    expect(recordHumanVerdict(경로, '없는_id', 판정)).toBe(false)
  })

  it('이미 매긴 대사는 기본으로 안 건드린다', () => {
    // 인터뷰를 두 번 돌다 먼저 매긴 것을 조용히 지우면 안 된다.
    const 경로 = 준비()
    recordHumanVerdict(경로, 'gd_banggui_05_PERSPECTIVE_001', 판정)

    expect(
      recordHumanVerdict(경로, 'gd_banggui_05_PERSPECTIVE_001', { ...판정, 과녁: '실패' }),
    ).toBe(false)
    const [항목_] = parseGuidanceGoldenset(readFileSync(경로, 'utf-8'), 경로)
    expect(항목_.사람판정들).toEqual([판정])
  })

  it('덮어쓰면 옛 판정이 근거 앞에 남는다', () => {
    // 무엇이 왜 뒤집혔는지가 곧 기록이다.
    const 경로 = 준비()
    recordHumanVerdict(경로, 'gd_banggui_05_PERSPECTIVE_001', 판정)

    const 새것 = { ...판정, 과녁: '실패', 근거: '기준을 고쳤다', 매긴날: '2026-08-15' }
    expect(
      recordHumanVerdict(경로, 'gd_banggui_05_PERSPECTIVE_001', 새것, { 덮어쓰기: true }),
    ).toBe(true)

    const [항목_] = parseGuidanceGoldenset(readFileSync(경로, 'utf-8'), 경로)
    expect(항목_.사람판정들).toHaveLength(1)
    expect(항목_.사람판정들[0].과녁).toBe('실패')
    expect(항목_.사람판정들[0].근거).toBe(
      '[2026-08-14 옛 판정: 과녁=성공 답누출=지킴 — 며느리 처지를 묻게 열어 뒀다] 기준을 고쳤다',
    )
  })
})
