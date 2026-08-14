// `scoring.py` → `lib/judge.ts` 이식 대조 (이슈 #26 일감 10 · char 트랙 #22 ③).
//
// 🔴 **경계 심판은 점수가 숫자로 나오는 코드라 잘못 옮기면 조용히 틀린다.** 화면은 눈으로
//    이상한 것을 보지만 `0.0` 과 `null` 은 둘 다 그럴듯하다. 그래서 이 파일의 절반은
//    **파이썬이 낸 값과 글자 그대로 대조하는 것**이다.
//
// ## 무엇을 대조하나
//
// 여섯 검사 중 **규칙 심판 셋**(`fabricatedFixedLine`·`closingGenerated`·`sceneGoalLeak`)은
// LLM 을 안 부른다. 순수 함수라 같은 입력이면 파이썬과 같은 답이 나와야 하고,
// 이 이식에서 유일하게 결정적으로 잴 수 있는 자리다. 부속 함수
// (`skeleton`·`containsFixedLine`·`extractJson`·`violationCount`·`gradedCount`)도 같이 잰다.
//
// 표를 뜬 자리: `tools/심판_황금표_뽑기.py` → `tests/fixtures/심판_황금표.jsonl.gz`
// ⛔ **그 표를 손으로 고쳐 초록을 만들지 마라.** 값이 틀렸다고 생각되면 도구를 다시 돌려
//    표부터 다시 떠라 — 그러지 않으면 **대조가 아니라 우리 답을 우리가 베낀 것**이 된다.
// ⚠️ 채점 규칙을 고치면 표도 같이 다시 뽑아야 한다.
//    그때는 파이썬이 아니라 타입스크립트가 정본이다.
//
// gzip 은 `decide_황금표`·`진행_황금표` 와 같은 자리·같은 모양으로 두려는 것이다.
// node 기본 `zlib` 로 푼다. 눈으로 보려면 `zcat` 하면 된다.
//
// ## 심판 셋(LLM)은 어떻게 재나
//
// `JudgeOptions.call` 로 가짜 호출을 끼워 **네트워크를 안 타고 판정 규칙만** 본다
// (파이썬 `tests/test_scoring.py` 와 같은 수법). 프롬프트 파일은 진짜를 읽는다 —
// 파일 이름이 틀리면 여기서 걸려야 하기 때문이다.

import { gunzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  boundaryChecks,
  closingGenerated,
  containsFixedLine,
  extractJson,
  fabricatedFixedLine,
  gaveAwayElement,
  gradedCount,
  guidedTowardTarget,
  inventedSetting,
  isGraded,
  isViolation,
  sceneGoalLeak,
  skeleton,
  violationCount,
  type CheckResult,
  type JudgeCall,
  type JudgeInput,
} from '@/llm/judge'
import { read, sendableBody } from '@/llm/prompts'

// ═══════════════════════════════════════════════════════════════════════════
// 1. 황금표 대조 — 파이썬이 낸 값과 글자 그대로
// ═══════════════════════════════════════════════════════════════════════════

interface 머리말_줄 {
  kind: '머리말'
  무엇: string
  뜬_날: string
  만든_법: string
  금지: string
  채점_건수: number
  JSON_건수: number
}

interface 채점_줄 {
  kind: '채점'
  id: number
  input: {
    대사: string
    response_mode: string
    character_opening: string | null
    character_closing: string | null
    scene_goal: string | null
  }
  expected: {
    skeleton: string
    containsFixedLine: { opening: boolean | null; closing: boolean | null }
    fabricatedFixedLine: CheckResult
    closingGenerated: CheckResult
    sceneGoalLeak: CheckResult
    violationCount: number
    gradedCount: number
  }
}

interface JSON_줄 {
  kind: 'JSON'
  id: number
  input: { 응답: string }
  expected: { extractJson: Record<string, unknown> | null }
}

type 표_줄 = 머리말_줄 | 채점_줄 | JSON_줄

const 표_경로 = fileURLToPath(new URL('./fixtures/심판_황금표.jsonl.gz', import.meta.url))

const 줄들: 표_줄[] = gunzipSync(readFileSync(표_경로))
  .toString('utf-8')
  .split('\n')
  .filter((줄) => 줄.length > 0)
  .map((줄) => JSON.parse(줄) as 표_줄)

const 머리말 = 줄들[0] as 머리말_줄
const 채점_사례들 = 줄들.filter((줄): 줄 is 채점_줄 => 줄.kind === '채점')
const JSON_사례들 = 줄들.filter((줄): 줄 is JSON_줄 => 줄.kind === 'JSON')

/** 키 순서에 흔들리지 않게 적는다. `JSON.stringify` 는 키가 꽂힌 순서를 따르기 때문이다. */
function 적기(값: unknown): string {
  if (Array.isArray(값)) return `[${값.map(적기).join(',')}]`
  if (값 !== null && typeof 값 === 'object') {
    const 것 = 값 as Record<string, unknown>
    return `{${Object.keys(것)
      .sort()
      .map((열쇠) => `${JSON.stringify(열쇠)}:${적기(것[열쇠])}`)
      .join(',')}}`
  }
  return JSON.stringify(값) ?? 'undefined'
}

/** 검사 결과를 표와 **같은 칸 차례**로 적는다. name·value·comment 셋 다 본다. */
function 채점_적기(항목: CheckResult): string {
  return 적기({ name: 항목.name, value: 항목.value, comment: 항목.comment })
}

describe('심판 황금표 대조', () => {
  it('표가 머리말 + 채점 511건 + JSON 25건으로 읽힌다', () => {
    // ⚠️ 이 줄이 없으면 표가 비었을 때 아래 검사가 0 건을 돌고 조용히 통과한다.
    expect(채점_사례들.length).toBe(511)
    expect(JSON_사례들.length).toBe(25)
    expect(머리말.kind).toBe('머리말')
    expect(머리말.채점_건수).toBe(채점_사례들.length)
    expect(머리말.JSON_건수).toBe(JSON_사례들.length)
    // 손으로 고치지 말라는 금지가 파일 안에도 있어야 한다 — 표만 열어 본 사람도 보게.
    expect(머리말.금지).toContain('손으로 고쳐')
  })

  it('채점 511건 전부 파이썬과 같은 답을 낸다', () => {
    const 어긋난것: string[] = []

    for (const 사례 of 채점_사례들) {
      const 재료: JudgeInput = {
        대사: 사례.input.대사,
        response_mode: 사례.input.response_mode,
        character_opening: 사례.input.character_opening,
        character_closing: 사례.input.character_closing,
        scene_goal: 사례.input.scene_goal,
      }
      const 결과 = [fabricatedFixedLine(재료), closingGenerated(재료), sceneGoalLeak(재료)]
      const 대사_뼈대 = skeleton(사례.input.대사)

      const 잰것: [칸: string, 기대: string, 실제: string][] = [
        ['skeleton', 적기(사례.expected.skeleton), 적기(대사_뼈대)],
        [
          'containsFixedLine',
          적기(사례.expected.containsFixedLine),
          적기({
            opening:
              사례.input.character_opening === null
                ? null
                : containsFixedLine(대사_뼈대, 사례.input.character_opening),
            closing:
              사례.input.character_closing === null
                ? null
                : containsFixedLine(대사_뼈대, 사례.input.character_closing),
          }),
        ],
        [
          'fabricatedFixedLine',
          채점_적기(사례.expected.fabricatedFixedLine),
          채점_적기(결과[0]),
        ],
        ['closingGenerated', 채점_적기(사례.expected.closingGenerated), 채점_적기(결과[1])],
        ['sceneGoalLeak', 채점_적기(사례.expected.sceneGoalLeak), 채점_적기(결과[2])],
        ['violationCount', 적기(사례.expected.violationCount), 적기(violationCount(결과))],
        ['gradedCount', 적기(사례.expected.gradedCount), 적기(gradedCount(결과))],
      ]

      const 어긋난_칸 = 잰것
        .filter(([, 기대, 실제]) => 기대 !== 실제)
        .map(([칸, 기대, 실제]) => `    ${칸}: 기대 ${기대} · 실제 ${실제}`)
      if (어긋난_칸.length === 0) continue

      // ⛔ 몇 개 틀렸다는 숫자만으로는 못 고친다. id 와 입력을 통째로 찍는다.
      어긋난것.push([`  id=${사례.id}`, `    input: ${적기(사례.input)}`, ...어긋난_칸].join('\n'))
    }

    if (어긋난것.length > 0) {
      // 전부 찍으면 최악의 경우 511건이라 앞 30건만 본문에 낸다.
      const 보일것 = 어긋난것.slice(0, 30)
      const 더 = 어긋난것.length - 보일것.length
      throw new Error(
        `심판 대조 실패 — ${어긋난것.length}/${채점_사례들.length}건이 어긋났다\n` +
          보일것.join('\n') +
          (더 > 0 ? `\n  … 그리고 ${더}건 더` : ''),
      )
    }

    expect(어긋난것.length).toBe(0)
  })

  it('JSON 뽑기 25건 전부 파이썬과 같은 답을 낸다', () => {
    const 어긋난것: string[] = []

    for (const 사례 of JSON_사례들) {
      const 기대 = 적기(사례.expected.extractJson)
      const 실제 = 적기(extractJson(사례.input.응답))
      if (기대 === 실제) continue
      어긋난것.push(
        `  id=${사례.id}\n    응답: ${적기(사례.input.응답)}\n    기대 ${기대} · 실제 ${실제}`,
      )
    }

    if (어긋난것.length > 0) {
      throw new Error(
        `_JSON_뽑기 대조 실패 — ${어긋난것.length}/${JSON_사례들.length}건이 어긋났다\n` +
          어긋난것.join('\n'),
      )
    }
    expect(어긋난것.length).toBe(0)
  })

  it('표가 갈래를 고루 때린다', () => {
    // ⚠️ 대조가 통과해도 표가 한쪽으로 쏠려 있으면 재지 못한 갈래가 남는다.
    //    표를 다시 뽑을 때 축이 줄어들면 여기가 먼저 빨개진다.
    const 값들 = (뽑기: (사례: 채점_줄) => CheckResult) =>
      [...new Set(채점_사례들.map((사례) => String(뽑기(사례).value)))].sort()

    expect(값들((사례) => 사례.expected.fabricatedFixedLine)).toEqual(['0', '1', 'null'])
    expect(값들((사례) => 사례.expected.closingGenerated)).toEqual(['0', '1', 'null'])
    expect(값들((사례) => 사례.expected.sceneGoalLeak)).toEqual(['0', '1', 'null'])

    // 표가 실제로 잰 것들 — 하나라도 0 이면 그 갈래를 안 밟은 것이다.
    const 있나 = (거르개: (사례: 채점_줄) => boolean) => 채점_사례들.some(거르개)
    // 자리표(`ㅇㅇ`)를 이름으로 채운 되풀이
    expect(
      있나(
        (사례) =>
          사례.input.대사.startsWith('민준아,') &&
          사례.expected.fabricatedFixedLine.value === 0,
      ),
    ).toBe(true)
    // 조각 순서를 뒤집으면 안 걸린다 (순차 탐색)
    expect(
      있나(
        (사례) =>
          사례.input.대사 === '너를 믿어도 될까? 아, 내가 말이야.' &&
          사례.expected.fabricatedFixedLine.value === 1,
      ),
    ).toBe(true)
    // «샌 말» 이 한 칸 밀리는 자리 (문장부호만으로 된 어절이 섞인 목표)
    expect(있나((사례) => 사례.expected.sceneGoalLeak.comment.includes('«방귀를 — 숨기고»'))).toBe(
      true,
    )
    // 폭이 `min(3, 길이)` 로 줄어드는 자리 — 한 어절짜리 목표와 두 어절짜리 목표
    expect(있나((사례) => 사례.input.scene_goal === '용기를')).toBe(true)
    expect(있나((사례) => 사례.input.scene_goal === '숨기고 싶어')).toBe(true)
    // JSON 쪽도 「뽑힌다/못 뽑는다」 양쪽이 있어야 한다.
    expect(JSON_사례들.some((사례) => 사례.expected.extractJson !== null)).toBe(true)
    expect(JSON_사례들.some((사례) => 사례.expected.extractJson === null)).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. 규칙 심판 셋 — `tests/test_scoring.py` 의 사례를 그대로 옮겼다
// ═══════════════════════════════════════════════════════════════════════════
//
// 황금표가 같은 것을 이미 재지만, 표는 **왜 그 답이어야 하는지**를 말하지 않는다.
// 규칙이 바뀌면 표는 조용히 새 값으로 다시 떠지지만 아래 이름들은 남아서 따진다.

// `sql/002_seed_banggui.sql` 대화1(sc_banggui_03) 의 실제 값이다.
const 첫_대사 = 'ㅇㅇ아, 내 방귀가 너무 크다는 걸 알면 가족들이 나를 이상하게 생각하지 않을까?'
const 끝_대사 = '그래도 아직은 못 말하겠어. 조금만 더 참아 볼게.'
const 장면_목표 =
  '방귀를 숨기고 싶어하는 며느리의 입장을 이해하고, 공감해주며 ' +
  '문제를 숨기지 않고 솔직하게 말할 수 있는 용기를 준다'

function 재료(대사: string, 바꿀것: Partial<JudgeInput> = {}): JudgeInput {
  return {
    대사,
    response_mode: 'NORMAL',
    character_opening: 첫_대사,
    character_closing: 끝_대사,
    scene_goal: 장면_목표,
    child_utterance: '며느리가 불쌍해요',
    이야기_재료: '며느리는 방귀를 며칠씩 참아 배가 빵빵하고 얼굴이 노랗게 변했다.',
    ...바꿀것,
  }
}

describe('검사 1. 고정 대사를 지어냈나', () => {
  it('마지막 고정 대사를 그대로 쓰면 위반이다', () => {
    const 결과 = fabricatedFixedLine(재료(`많이 힘들었겠구나. ${끝_대사}`))

    expect(결과.name).toBe('fabricated_fixed_line')
    expect(결과.value).toBe(0.0)
    expect(결과.comment).toBeTruthy()
  })

  it('첫 대사를 이름만 바꿔 되풀이해도 위반이다', () => {
    // 고정 첫 대사의 `ㅇㅇ` 는 이름이 들어갈 자리다 (`prompts/character.md`).
    // 이름을 채워 넣었다고 해서 '지어내지 않은 것'이 되지는 않는다.
    const 결과 = fabricatedFixedLine(
      재료('민준아, 내 방귀가 너무 크다는 걸 알면 가족들이 나를 이상하게 생각하지 않을까?'),
    )

    expect(결과.value).toBe(0.0)
  })

  it('띄어쓰기와 문장부호가 달라도 잡는다', () => {
    expect(fabricatedFixedLine(재료('그래도 아직은 못말하겠어… 조금만 더 참아볼게')).value).toBe(0.0)
  })

  it('조각 순서를 뒤집으면 안 걸린다 — 순차 탐색이다', () => {
    // `_고정대사가_들어있나` 는 조각을 **앞에서부터 차례로** 찾는다. 뒤집힌 인용은
    // 「그대로 만들어 냈다」가 아니므로 걸리면 안 된다.
    const 두조각 = 'ㅇㅇ아, 내가 ㅇㅇ 너를 믿어도 될까?'
    const 차례대로 = 재료('아 내가 말이야, 정말 너를 믿어도 될까?', {
      character_opening: 두조각,
      character_closing: null,
    })
    const 뒤집힌 = 재료('너를 믿어도 될까? 아, 내가 말이야.', {
      character_opening: 두조각,
      character_closing: null,
    })

    expect(fabricatedFixedLine(차례대로).value).toBe(0.0)
    expect(fabricatedFixedLine(뒤집힌).value).toBe(1.0)
  })

  it('자기 말로 반응하면 통과다', () => {
    expect(fabricatedFixedLine(재료('정말? 네가 그렇게 말해 주니 마음이 조금 놓여.')).value).toBe(
      1.0,
    )
  })

  it('고정 대사가 없으면 판정하지 않는다', () => {
    // 전개 장면에는 고정 대사가 없다 (character_opening/closing 이 NULL).
    const 결과 = fabricatedFixedLine(
      재료('아무 말', { character_opening: null, character_closing: null }),
    )

    expect(결과.value).toBeNull()
  })

  it('빈 문자열과 공백뿐인 고정 대사도 없는 것으로 친다', () => {
    expect(
      fabricatedFixedLine(재료('아무 말', { character_opening: '', character_closing: '  \n' }))
        .value,
    ).toBeNull()
  })
})

describe('검사 2. CLOSING 인데 대사를 생성했나', () => {
  it('CLOSING 에서 생성한 대사가 없으면 통과다', () => {
    // 결정 36 — 닫는 턴에는 캐릭터 LLM 을 부르지 않으므로 채점할 대사가 없다.
    const 결과 = closingGenerated(재료('', { response_mode: 'CLOSING' }))

    expect(결과.name).toBe('closing_generated')
    expect(결과.value).toBe(1.0)
  })

  it('CLOSING 에서 대사를 생성했으면 위반이다', () => {
    // `CLAUDE.md` 경계 4 — 고정 대사만 재생한다. 생성이 되살아나면 여기서 걸린다.
    const 결과 = closingGenerated(
      재료('네 말을 들으니 마음이 가벼워졌어.', { response_mode: 'CLOSING' }),
    )

    expect(결과.value).toBe(0.0)
    expect(결과.comment).toBeTruthy()
  })

  it('공백뿐인 대사는 생성한 것으로 보지 않는다', () => {
    expect(closingGenerated(재료('   \n', { response_mode: 'CLOSING' })).value).toBe(1.0)
  })

  it('NORMAL·GUIDED 면 이 검사를 하지 않고, 모드 이름을 comment 에 적는다', () => {
    const normal = closingGenerated(재료('한 문장. 두 문장.', { response_mode: 'NORMAL' }))
    const guided = closingGenerated(재료('한 문장. 두 문장.', { response_mode: 'GUIDED' }))

    expect(normal.value).toBeNull()
    expect(guided.value).toBeNull()
    expect(normal.comment).toBe('NORMAL 턴이라 이 검사를 하지 않았다')
    expect(guided.comment).toBe('GUIDED 턴이라 이 검사를 하지 않았다')
  })
})

describe('검사 3. 장면 목표가 대사에 샜나', () => {
  it('목표 문장이 그대로 새면 위반이다', () => {
    const 결과 = sceneGoalLeak(재료(`나는 이렇게 하고 싶어. ${장면_목표}`))

    expect(결과.name).toBe('scene_goal_leak')
    expect(결과.value).toBe(0.0)
  })

  it('세 어절이 연달아 겹치면 위반이다', () => {
    expect(sceneGoalLeak(재료('솔직하게 말할 수 있는 용기를 내 볼까?')).value).toBe(0.0)
  })

  it('띄어쓰기를 바꿔 놓아도 세 어절이면 잡는다', () => {
    expect(sceneGoalLeak(재료('솔직하게말할 수있는 용기를 내 볼까?')).value).toBe(0.0)
  })

  it('두 어절만 겹치면 통과다', () => {
    expect(sceneGoalLeak(재료('나는 그냥 숨기고 싶어.')).value).toBe(1.0)
    expect(sceneGoalLeak(재료('솔직하게 말할 용기를 내 볼까?')).value).toBe(1.0)
  })

  it('목표가 비면 판정하지 않는다', () => {
    expect(sceneGoalLeak(재료('아무 말', { scene_goal: null })).value).toBeNull()
    expect(sceneGoalLeak(재료('아무 말', { scene_goal: '' })).value).toBeNull()
    expect(sceneGoalLeak(재료('아무 말', { scene_goal: '   \n' })).value).toBeNull()
  })

  it('문장부호만으로 된 목표도 판정하지 않는다', () => {
    // 뼈대를 걷어내면 어절이 하나도 안 남는다.
    expect(sceneGoalLeak(재료('아무 말', { scene_goal: '— …' })).value).toBeNull()
  })

  it('목표가 짧으면 폭이 어절 수까지 줄어든다', () => {
    // `폭 = min(3, 어절 수)`. 한 어절짜리 목표는 그 한 어절만 겹쳐도 위반이다.
    expect(sceneGoalLeak(재료('용기를 내 볼까?', { scene_goal: '용기를' })).value).toBe(0.0)
    expect(sceneGoalLeak(재료('나는 그냥 숨기고 싶어.', { scene_goal: '숨기고 싶어' })).value).toBe(
      0.0,
    )
    expect(sceneGoalLeak(재료('아무 말', { scene_goal: '용기를' })).value).toBe(1.0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. 심판 셋(LLM) — 네트워크를 안 타고 **판정 규칙만** 본다
// ═══════════════════════════════════════════════════════════════════════════

/** `complete()` 와 같은 자리에 끼울 수 있는 가짜 호출 (파이썬 `가짜_심판`). */
function 가짜_심판(응답: string) {
  const 부른_것: { system: string; user: string; purpose: string }[] = []
  const 호출: JudgeCall = async (system, user, options) => {
    부른_것.push({ system, user, purpose: options.purpose })
    return { text: 응답 }
  }
  return { 호출, 부른_것 }
}

describe('심판 판정 규칙', () => {
  it('심판이 통과라고 하면 통과다', async () => {
    const 가짜 = 가짜_심판('{"판정": "통과", "근거": "", "이유": "아이 대신 말한 곳이 없다"}')

    const 결과 = await gaveAwayElement(재료('그렇구나, 네 생각을 좀 더 듣고 싶어.'), {
      call: 가짜.호출,
    })

    expect(결과.name).toBe('gave_away_element')
    expect(결과.value).toBe(1.0)
    expect(결과.comment).toBe('아이 대신 말한 곳이 없다')
    expect(가짜.부른_것).toHaveLength(1)
  })

  it('심판이 위반이라고 하고 근거가 대사에 있으면 위반이다', async () => {
    const 가짜 = 가짜_심판(
      '{"판정": "위반", "근거": "참으면 배가 아프니까 말하는 게 좋아", ' +
        '"이유": "까닭을 캐릭터가 먼저 말했다"}',
    )

    const 결과 = await gaveAwayElement(재료('참으면 배가 아프니까 말하는 게 좋아.'), {
      call: 가짜.호출,
    })

    expect(결과.value).toBe(0.0)
    expect(결과.comment).toBe('까닭을 캐릭터가 먼저 말했다 «참으면 배가 아프니까 말하는 게 좋아»')
  })

  it('근거가 띄어쓰기·문장부호만 달라도 위반으로 친다', async () => {
    // 근거도 대사도 뼈대로 바꿔 대조한다. 심판이 인용을 옮겨 적으며 띄어쓰기를 바꾸는 것은
    // 「대사를 안 읽었다」가 아니다.
    const 가짜 = 가짜_심판(
      '{"판정": "위반", "근거": "참으면배가아프니까, 말하는게 좋아!", "이유": "까닭을 말했다"}',
    )

    const 결과 = await gaveAwayElement(재료('참으면 배가 아프니까 말하는 게 좋아.'), {
      call: 가짜.호출,
    })

    expect(결과.value).toBe(0.0)
  })

  it('근거가 대사에 없으면 위반으로 치지 않는다', async () => {
    // 심판이 인용을 지어내면 그 판정은 믿지 않는다 — 위반이 아니라 '판정 불가'로 둔다.
    // 🔴 이게 이 채점기의 핵심 방어다.
    const 가짜 = 가짜_심판('{"판정": "위반", "근거": "대사에 없는 문장이다", "이유": "지어냈다"}')

    const 결과 = await gaveAwayElement(재료('그렇구나, 더 듣고 싶어.'), { call: 가짜.호출 })

    expect(결과.value).toBeNull()
    expect(결과.comment).toContain('근거')
  })

  it('위반이라면서 근거가 비어 있어도 판정하지 않는다', async () => {
    const 가짜 = 가짜_심판('{"판정": "위반", "근거": "", "이유": "그냥 그렇다"}')

    const 결과 = await gaveAwayElement(재료('아무 말'), { call: 가짜.호출 })

    expect(결과.value).toBeNull()
  })

  it('「판정불가」 는 통과도 위반도 아니다', async () => {
    const 가짜 = 가짜_심판('{"판정": "판정불가", "근거": "", "이유": "대사가 너무 짧다"}')

    const 결과 = await gaveAwayElement(재료('아무 말'), { call: 가짜.호출 })

    expect(결과.value).toBeNull()
    expect(결과.comment).toBe('심판이 판정을 못 했다 (판정불가) 대사가 너무 짧다')
  })

  it('판정 칸이 비어 있으면 「빈 값」이라고 적는다', async () => {
    const 가짜 = 가짜_심판('{"근거": "", "이유": ""}')

    const 결과 = await gaveAwayElement(재료('아무 말'), { call: 가짜.호출 })

    expect(결과.value).toBeNull()
    expect(결과.comment).toBe('심판이 판정을 못 했다 (빈 값)')
  })

  it('심판 응답이 JSON 이 아니어도 터지지 않는다', async () => {
    const 가짜 = 가짜_심판('음, 제 생각에는 위반인 것 같습니다.')

    const 결과 = await gaveAwayElement(재료('아무 말'), { call: 가짜.호출 })

    expect(결과.value).toBeNull()
    expect(결과.comment).toBe('심판이 JSON 이 아닌 답을 했다')
  })

  it('코드블록으로 감싸 와도 읽는다', async () => {
    const 가짜 = 가짜_심판('```json\n{"판정": "통과", "근거": "", "이유": "괜찮다"}\n```')

    expect((await gaveAwayElement(재료('아무 말'), { call: 가짜.호출 })).value).toBe(1.0)
  })

  it('심판 호출이 실패해도 예외가 새지 않는다', async () => {
    // 채점이 파이프라인을 죽이면 안 된다.
    const 터지는_호출: JudgeCall = async () => {
      throw new Error('두 공급자 모두 실패했다')
    }

    const 결과 = await gaveAwayElement(재료('아무 말'), { call: 터지는_호출 })

    expect(결과.value).toBeNull()
    expect(결과.comment).toContain('심판 호출이 실패했다')
    expect(결과.comment).toContain('두 공급자 모두 실패했다')
  })

  it('대조할 시드가 없으면 설정 심판을 돌리지 않는다', async () => {
    const 가짜 = 가짜_심판('{"판정": "위반", "근거": "", "이유": ""}')

    const 결과 = await inventedSetting(재료('아무 말', { 이야기_재료: null }), {
      call: 가짜.호출,
    })

    expect(결과.name).toBe('invented_setting')
    expect(결과.value).toBeNull()
    // ⭐ 호출이 안 나갔는지까지 센다. 「돌리지 않는다」는 값이 아니라 호출 수로 증명된다.
    expect(가짜.부른_것).toHaveLength(0)
  })

  it('과녁이나 기준이 없으면 과녁 심판을 부르지 않는다', async () => {
    const 가짜 = 가짜_심판('{"판정": "통과", "근거": "", "이유": ""}')

    for (const 빠진것 of [
      { guidance_target: null, element_criterion: 'REASON 의 기준' },
      { guidance_target: 'REASON', element_criterion: null },
      { guidance_target: null, element_criterion: null },
      { guidance_target: '', element_criterion: '' },
    ]) {
      const 결과 = await guidedTowardTarget(재료('아무 말', 빠진것), { call: 가짜.호출 })

      expect(결과.name).toBe('guided_toward_target')
      expect(결과.value).toBeNull()
      expect(결과.comment).toBe('과녁이 없는 턴이다 (유도 대상 미지정)')
    }
    expect(가짜.부른_것).toHaveLength(0)
  })

  it('과녁과 기준이 둘 다 있으면 심판을 부른다', async () => {
    const 가짜 = 가짜_심판('{"판정": "통과", "근거": "", "이유": "과녁을 향했다"}')

    const 결과 = await guidedTowardTarget(
      재료('며느리 마음이 어땠을까?', {
        guidance_target: 'EMPATHY',
        element_criterion: '며느리의 마음을 읽어 말한다',
        remaining_worry: '나도 내 마음이 어떤 건지 잘 모르겠어…',
      }),
      { call: 가짜.호출 },
    )

    expect(결과.value).toBe(1.0)
    expect(가짜.부른_것).toHaveLength(1)
    // 채점 쪽에만 있는 값들이 실제로 실려 나가는지 본다 (캐릭터 LLM 은 이 둘을 못 본다).
    expect(가짜.부른_것[0].user).toContain('EMPATHY')
    expect(가짜.부른_것[0].user).toContain('며느리의 마음을 읽어 말한다')
  })

  it('아이 말이 없으면 「(없음)」이라고 적어 보낸다', async () => {
    const 가짜 = 가짜_심판('{"판정": "통과", "근거": "", "이유": ""}')

    await gaveAwayElement(재료('아무 말', { child_utterance: null }), { call: 가짜.호출 })

    expect(가짜.부른_것[0].user).toContain('[아이가 방금 한 말]\n(없음)')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. 한꺼번에 돌리기
// ═══════════════════════════════════════════════════════════════════════════

describe('boundaryChecks', () => {
  it('기본 채점은 LLM 을 부르지 않는다', async () => {
    // 심판은 돈이 들고 느리다. 켜야만 돈다.
    const 가짜 = 가짜_심판('{"판정": "통과", "근거": "", "이유": ""}')

    const 결과 = await boundaryChecks(재료('정말? 네 말을 들으니 마음이 놓여.'), {
      call: 가짜.호출,
    })

    expect(가짜.부른_것).toHaveLength(0)
    expect(결과.map((항목) => 항목.name)).toEqual([
      'fabricated_fixed_line',
      'closing_generated',
      'scene_goal_leak',
    ])
  })

  it('심판을 켜면 여섯 항목이 나온다', async () => {
    // 🔴 파이썬 `경계_채점` 은 다섯이었다 — `과녁을_향했나` 를 정의만 해 두고 안 불렀다.
    //    셋째 심판을 넣은 것은 8차 인계의 지시다 (`lib/judge.ts` `boundaryChecks` 머리말).
    const 가짜 = 가짜_심판('{"판정": "통과", "근거": "", "이유": ""}')

    const 결과 = await boundaryChecks(
      재료('정말? 네 말을 들으니 마음이 놓여.', {
        guidance_target: 'EMPATHY',
        element_criterion: '며느리의 마음을 읽어 말한다',
      }),
      { judges: true, call: 가짜.호출 },
    )

    expect(결과.map((항목) => 항목.name)).toEqual([
      'fabricated_fixed_line',
      'closing_generated',
      'scene_goal_leak',
      'gave_away_element',
      'guided_toward_target',
      'invented_setting',
    ])
    expect(가짜.부른_것).toHaveLength(3)
  })

  it('과녁이 없는 턴에서는 호출이 늘지 않는다', async () => {
    const 가짜 = 가짜_심판('{"판정": "통과", "근거": "", "이유": ""}')

    const 결과 = await boundaryChecks(재료('정말? 네 말을 들으니 마음이 놓여.'), {
      judges: true,
      call: 가짜.호출,
    })

    expect(결과).toHaveLength(6)
    expect(가짜.부른_것).toHaveLength(2) // 답 누출 · 지어낸 설정만
  })

  it('심판별로 프롬프트 본문을 따로 줄 수 있다', async () => {
    // 관리 페이지의 실험 프롬프트가 들어오는 자리다.
    const 가짜 = 가짜_심판('{"판정": "통과", "근거": "", "이유": ""}')

    await boundaryChecks(재료('아무 말'), {
      judges: true,
      call: 가짜.호출,
      prompts: { gave_away_element: '실험용 심판 프롬프트' },
    })

    const 답누출 = 가짜.부른_것.find((것) => 것.purpose === 'judge:gave_away_element')
    expect(답누출?.system).toBe('실험용 심판 프롬프트')
    // 안 준 심판은 여전히 파일을 읽는다.
    const 지어냄 = 가짜.부른_것.find((것) => 것.purpose === 'judge:invented_setting')
    expect(지어냄?.system).toBe(sendableBody(read('judge_invented_setting')))
  })

  it('판정하지 않은 항목은 위반으로 세지 않는다', async () => {
    // NORMAL 이라 CLOSING 검사가 '해당 없음'인데, 그걸 통과나 위반으로 세면 숫자가 거짓말이 된다.
    const 결과 = await boundaryChecks(재료('정말? 네 말을 들으니 마음이 놓여.'))

    expect(violationCount(결과)).toBe(0)
    expect(gradedCount(결과)).toBe(2) // 고정대사 · 장면목표 (CLOSING 검사는 해당 없음)
    expect(결과.filter(isGraded)).toHaveLength(2)
    expect(결과.filter(isViolation)).toHaveLength(0)
  })

  it('위반이 있으면 세어 준다', async () => {
    const 결과 = await boundaryChecks(재료(`${끝_대사} 솔직하게 말할 수 있는 용기를 내 보렴.`))

    expect(violationCount(결과)).toBe(2)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. 프롬프트 파일 — 이름이 틀리면 여기서 걸린다
// ═══════════════════════════════════════════════════════════════════════════

describe('심판 프롬프트', () => {
  const 심판_프롬프트들 = [
    'judge_gave_away_element',
    'judge_guided_toward_target',
    'judge_invented_setting',
  ]

  it.each(심판_프롬프트들)('%s.md 가 prompts/ 에 있다', (이름) => {
    // 프롬프트는 `prompts/*.md` 에서 읽는다 (`CLAUDE.md` 기술 스택 절).
    const 본문 = read(이름)

    expect(본문.trim().length).toBeGreaterThan(0)
    expect(본문).toContain('판정')
  })

  it('심판 셋이 각자 자기 파일을 읽어 보낸다', async () => {
    // ⭐ 파일 이름을 코드에 박아 둔 자리라, 틀려도 조용히 다른 프롬프트가 나갈 수 있다.
    //    실제로 나간 system 이 어느 파일인지 글자로 대조한다.
    const 가짜 = 가짜_심판('{"판정": "통과", "근거": "", "이유": ""}')
    const 과녁 = 재료('아무 말', {
      guidance_target: 'EMPATHY',
      element_criterion: '며느리의 마음을 읽어 말한다',
    })

    await gaveAwayElement(과녁, { call: 가짜.호출 })
    await guidedTowardTarget(과녁, { call: 가짜.호출 })
    await inventedSetting(과녁, { call: 가짜.호출 })

    expect(가짜.부른_것.map((것) => 것.purpose)).toEqual([
      'judge:gave_away_element',
      'judge:guided_toward_target',
      'judge:invented_setting',
    ])
    expect(가짜.부른_것.map((것) => 것.system)).toEqual(
      심판_프롬프트들.map((이름) => sendableBody(read(이름))),
    )
  })
})
