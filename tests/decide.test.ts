// `decide()` 이식 대조 — 파이썬에서 뽑은 황금표 전건을 때린다 (이슈 #26 규칙-2).
//
// `decide()` 는 순수 함수라(`CLAUDE.md` 경계 2) **같은 입력이면 파이썬과 타입스크립트가
// 같은 답을 내야 한다.** 어긋나면 옮기다 흘린 것이고, 이식 검증에서 가장 확실한 자리다.
//
// 표를 뽑은 자리: `tools/decide_황금표_뽑기.py`
// ⚠️ 규칙을 고치면(이슈 #27 고도화) 표도 같이 다시 뽑아야 한다.
//    그때는 파이썬이 아니라 타입스크립트가 정본이다.
//
// gzip 은 크기 때문이다 — 날것은 7.8MB 다. node 기본 `zlib` 로 푼다(새 의존성 없음).

import { gunzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  decide,
  type AnalysisResult,
  type Decision,
  type SceneConstants,
  type SessionState,
} from '@/llm/domain/decide'

interface 사례 {
  id: number
  session: SessionState
  scene: SceneConstants
  analysis: AnalysisResult
  expected: Decision
}

const 표_경로 = fileURLToPath(new URL('./fixtures/decide_황금표.jsonl.gz', import.meta.url))

const 사례들: 사례[] = gunzipSync(readFileSync(표_경로))
  .toString('utf-8')
  .split('\n')
  .filter((줄) => 줄.length > 0)
  .map((줄) => JSON.parse(줄) as 사례)

// 답의 열 칸을 하나씩 본다. 필드 이름은 DB 컬럼 그대로다(변환 층을 두지 않는다).
const 칸들 = [
  'response_mode',
  'guidance_target',
  'last_guidance_target',
  'soft_cue',
  'reaction_key',
  'scene_goal_met',
  'scene_end_reason',
  'accumulated_elements',
  'turns_without_new_element',
  'consecutive_low_information_turns',
] as const satisfies readonly (keyof Decision)[]

describe('decide 황금표 대조', () => {
  it('표가 34,560건 그대로 읽힌다', () => {
    // ⚠️ 이 줄이 없으면 표가 비었을 때 아래 검사가 0 건을 돌고 조용히 통과한다.
    // 11,520 → 34,560 은 `last_guidance_target` 축 셋이 늘어난 것이다 (이슈 #27).
    expect(사례들.length).toBe(34560)
  })

  it('그중 960건이 반복 회피로 답이 갈린다', () => {
    // ⚠️ 축을 넣어도 **회피가 실제로 걸리는 조합**이 없으면 위 대조가 전건 초록이면서
    //    아무것도 안 재게 된다. 표를 다시 뽑을 때 이 숫자가 0 이면 축이 헛돈 것이다.
    const 갈린것 = 사례들.filter((사례) => {
      const 대상 = 사례.expected.guidance_target
      if (대상 === null) return false
      const 남은 = 사례.scene.required_elements.filter(
        (요소) => !사례.expected.accumulated_elements.includes(요소),
      )
      return 남은.length > 0 && 대상 !== 남은[0]
    })

    expect(갈린것.length).toBe(960)
  })

  it('그중 20,544건이 유도 없는 턴에도 직전 기억을 실어 보낸다', () => {
    // 회피 규칙의 **두 번째 얼굴**이다. 위 960건은 「무엇을 고르나」만 재고,
    // 「유도가 없던 턴이 기억을 지우지 않는가」는 안 잰다 — 그 자리를 따로 박는다.
    // `last_guidance_target` 을 `guidance_target` 으로 되돌리면 이 건수가 0 이 된다.
    const 이월된것 = 사례들.filter(
      (사례) =>
        사례.expected.guidance_target === null &&
        사례.expected.last_guidance_target !== null,
    )

    expect(이월된것.length).toBe(20544)
  })

  it('34,560건 전부 파이썬과 같은 답을 낸다', () => {
    const 어긋난것: string[] = []

    for (const 사례 of 사례들) {
      const 답 = decide(사례.session, 사례.scene, 사례.analysis)

      const 어긋난_칸: string[] = []
      for (const 칸 of 칸들) {
        const 기대 = JSON.stringify(사례.expected[칸])
        const 실제 = JSON.stringify(답[칸])
        if (기대 !== 실제) 어긋난_칸.push(`    ${칸}: 기대 ${기대} · 실제 ${실제}`)
      }
      if (어긋난_칸.length === 0) continue

      // ⛔ 몇 개 틀렸다는 숫자만으로는 못 고친다. id 와 입력을 통째로 찍는다.
      어긋난것.push(
        [
          `  id=${사례.id}`,
          `    session : ${JSON.stringify(사례.session)}`,
          `    scene   : ${JSON.stringify(사례.scene)}`,
          `    analysis: ${JSON.stringify(사례.analysis)}`,
          ...어긋난_칸,
        ].join('\n'),
      )
    }

    if (어긋난것.length > 0) {
      // 전부 찍으면 최악의 경우 34,560건이라 앞 50건만 본문에 낸다.
      // 어느 것이 몇 건인지는 첫 줄에 있고, 나머지는 좁힌 뒤 다시 돌리면 나온다.
      const 보일것 = 어긋난것.slice(0, 50)
      const 더 = 어긋난것.length - 보일것.length
      throw new Error(
        `decide 대조 실패 — ${어긋난것.length}/${사례들.length}건이 어긋났다\n` +
          보일것.join('\n') +
          (더 > 0 ? `\n  … 그리고 ${더}건 더` : ''),
      )
    }

    expect(어긋난것.length).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 직전 유도 요소 반복 회피 — 기준 문서 12절 409행 · 14절 469행 (이슈 #27)
//
// 409행은 「반복되지 않도록 **합니다**」로 선택형이 아니다. 같은 목록의 410·411행이
// 「…할 수 **있습니다**」인 것과 갈린다. 요소 우선순위(410)는 넣지 않았다 — 배열 순서를
// 그대로 쓰고 직전 것만 한 칸 민다.
//
// 파이썬 `tests/test_decide.py` 의 같은 이름 검사 여섯을 그대로 옮긴 것이다.
// 황금표가 이 갈래를 이미 960건 때리지만, 표는 **무엇이 왜 그런지**를 말하지 않는다.
// ═══════════════════════════════════════════════════════════════════════════

// 대화2(시아버지) 의 실제 값을 기본으로 쓴다. required_elements 의 순서가 곧 대화 흐름이다(결정 14).
const 기본_요소 = ['PERSPECTIVE', 'EMPATHY', 'REASON', 'REQUEST']

function 상태(바꿀것: Partial<SessionState> = {}): SessionState {
  return {
    current_child_turn_count: 2,
    accumulated_elements: [],
    last_response_mode: 'NORMAL',
    // 기본은 「아직 아무것도 유도하지 않았다」다. 반복 회피 검사만 이 값을 넣는다.
    last_guidance_target: null,
    turns_without_new_element: 0,
    consecutive_low_information_turns: 0,
    ...바꿀것,
  }
}

function 장면(바꿀것: Partial<SceneConstants> = {}): SceneConstants {
  return {
    required_elements: 기본_요소,
    preferred_turns: 3,
    max_turns: 5,
    ...바꿀것,
  }
}

function 분석(바꿀것: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    child_intent: 'OPINION',
    detected_elements: [],
    utterance_validity: 'VALID',
    ...바꿀것,
  }
}

describe('직전 유도 요소 반복 회피', () => {
  it('직전에 유도한 요소는 한 칸 건너뛴다', () => {
    const 결과 = decide(
      상태({ current_child_turn_count: 3, last_guidance_target: 'PERSPECTIVE' }),
      장면({ max_turns: 5 }),
      분석(),
    )

    expect(결과.response_mode).toBe('GUIDED')
    // 회피가 없으면 missing[0] 인 PERSPECTIVE 가 또 나온다.
    expect(결과.guidance_target).toBe('EMPATHY')
  })

  it('부족한 요소가 하나뿐이면 직전과 같아도 되돌아온다', () => {
    // **제외가 아니라 건너뛰기다.** 유도할 것이 그것뿐인데 건너뛰면 장면을 채울 길이 없어진다.
    const 결과 = decide(
      상태({
        current_child_turn_count: 3,
        accumulated_elements: ['PERSPECTIVE', 'EMPATHY', 'REASON'],
        last_guidance_target: 'REQUEST',
      }),
      장면({ max_turns: 5 }),
      분석(),
    )

    expect(결과.response_mode).toBe('GUIDED')
    expect(결과.guidance_target).toBe('REQUEST')
  })

  it('soft-cue 대상도 직전 유도를 피한다', () => {
    // 회피는 GUIDED 전용이 아니다. 짧은 장면에서는 soft-cue 쪽이 더 자주 돈다.
    const 결과 = decide(
      상태({ current_child_turn_count: 2, last_guidance_target: 'PERSPECTIVE' }),
      장면({ max_turns: 6 }),
      분석({ detected_elements: ['REASON'] }),
    )

    expect(결과.response_mode).toBe('NORMAL')
    expect(결과.soft_cue).toBe(true)
    expect(결과.guidance_target).toBe('EMPATHY')
  })

  it('유도가 없던 턴은 직전 유도를 지우지 않는다', () => {
    // `last_guidance_target` 은 「직전 **턴**의 대상」이 아니라 「직전에 **유도한** 요소」다.
    // 대상이 없는 턴은 캐릭터가 걱정을 아예 안 얹으므로 아이가 들은 말에 걱정이 없다.
    // 그런 턴이 기억을 지우면 앞뒤가 안 맞는다.
    const 결과 = decide(
      상태({ current_child_turn_count: 2, last_guidance_target: 'PERSPECTIVE' }),
      장면({ max_turns: 6 }),
      분석(),
    )

    expect(결과.guidance_target).toBeNull() // 이번 턴에는 유도가 없다
    expect(결과.last_guidance_target).toBe('PERSPECTIVE') // 그래도 기억은 남는다
  })

  it('이번 턴에 유도했으면 그 요소가 다음 턴의 직전이 된다', () => {
    const 결과 = decide(
      상태({ current_child_turn_count: 3, last_guidance_target: 'PERSPECTIVE' }),
      장면({ max_turns: 5 }),
      분석(),
    )

    expect(결과.guidance_target).toBe('EMPATHY')
    expect(결과.last_guidance_target).toBe('EMPATHY')
  })

  it('장면이 바뀐 직후에는 회피할 직전이 없다', () => {
    // `enterScene()` 이 `last_guidance_target` 을 null 로 되돌린다 (`repo/sessions.ts`).
    const 결과 = decide(
      상태({ current_child_turn_count: 3, last_guidance_target: null }),
      장면({ max_turns: 5 }),
      분석(),
    )

    expect(결과.guidance_target).toBe('PERSPECTIVE')
  })
})
