// `진행.py` 이식 대조 — 파이썬에서 뽑은 황금표 전건을 때린다 (이슈 #26 규칙-4).
//
// 세 함수 다 순수 함수라(DB 도 LLM 도 안 본다) **같은 입력이면 파이썬과 타입스크립트가
// 같은 답을 내야 한다.** 어긋나면 옮기다 흘린 것이고, 이식 검증에서 가장 확실한 자리다.
//
// 표를 뽑은 자리: `tools/진행_황금표_뽑기.py`
// ⚠️ 진행 규칙을 고치면 표도 같이 다시 뽑아야 한다.
//    그때는 파이썬이 아니라 타입스크립트가 정본이다.
//
// 한 사례가 세 함수를 다 잰다 — 셋이 **같은 장면 목록**을 입력으로 쓰기 때문이다.
// `isDialogueScene` 과 `precedingNarration` 은 `scenes` **배열 순서 그대로** 한 칸씩 대응한다.
//
// gzip 은 `decide_황금표` 와 같은 자리·같은 모양으로 두려는 것이다. node 기본 `zlib` 로 푼다.

import { gunzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  isDialogueScene,
  nextStep,
  precedingNarration,
  type SceneRow,
  type SessionRow,
  type Step,
} from '@/llm/domain/progress'

/** 답이거나(`Step`) 예외거나(`오류`·`말`). 파이썬이 두 갈래로 터지는 것까지 잰다. */
type 기대한_할일 = Step | { 오류: string; 말: string }

interface 사례 {
  id: number
  scenes: SceneRow[]
  session: SessionRow
  scope: string
  scene_order: number | null
  expected: {
    nextStep: 기대한_할일
    isDialogueScene: boolean[]
    precedingNarration: string[][]
  }
}

const 표_경로 = fileURLToPath(new URL('./fixtures/진행_황금표.jsonl.gz', import.meta.url))

const 사례들: 사례[] = gunzipSync(readFileSync(표_경로))
  .toString('utf-8')
  .split('\n')
  .filter((줄) => 줄.length > 0)
  .map((줄) => JSON.parse(줄) as 사례)

/** `nextStep` 을 돌려 답이든 예외든 **표와 같은 모양**으로 바꾼다. */
function 실제_할일(사례: 사례): 기대한_할일 {
  try {
    return nextStep(사례.scenes, 사례.session, {
      scope: 사례.scope,
      scene_order: 사례.scene_order,
    })
  } catch (터짐) {
    // 갈래 이름(`ValueError`·`LookupError`)과 말까지 표와 맞춘다.
    // 뭉뚱그려 잡으면 「인자가 틀렸다」와 「목록에 없다」가 바뀌어도 대조가 통과한다.
    if (터짐 instanceof Error) return { 오류: 터짐.name, 말: 터짐.message }
    throw 터짐
  }
}

/** 칸 순서를 고정해 문자열로 만든다. `JSON.stringify` 는 키가 꽂힌 순서를 따르기 때문이다. */
function 적기(할일: 기대한_할일): string {
  return '오류' in 할일
    ? JSON.stringify({ 오류: 할일.오류, 말: 할일.말 })
    : JSON.stringify({
        kind: 할일.kind,
        scene_id: 할일.scene_id,
        reason: 할일.reason,
      })
}

describe('진행 황금표 대조', () => {
  it('표가 618건 그대로 읽힌다', () => {
    // ⚠️ 이 줄이 없으면 표가 비었을 때 아래 검사가 0 건을 돌고 조용히 통과한다.
    expect(사례들.length).toBe(618)
  })

  it('618건 전부 파이썬과 같은 답을 낸다', () => {
    const 어긋난것: string[] = []

    for (const 사례 of 사례들) {
      const 어긋난_칸: string[] = []

      const 기대 = 적기(사례.expected.nextStep)
      const 실제 = 적기(실제_할일(사례))
      if (기대 !== 실제) 어긋난_칸.push(`    nextStep: 기대 ${기대} · 실제 ${실제}`)

      // 아래 둘은 `scenes` 배열 순서 그대로 한 칸씩 본다.
      const 대화 = JSON.stringify(사례.scenes.map(isDialogueScene))
      if (대화 !== JSON.stringify(사례.expected.isDialogueScene)) {
        어긋난_칸.push(
          `    isDialogueScene: 기대 ${JSON.stringify(사례.expected.isDialogueScene)} · 실제 ${대화}`,
        )
      }

      // `precedingNarration` 은 장면 객체를 돌려준다. 순서와 정체만 보면 되므로 id 로 줄인다.
      const 앞선 = JSON.stringify(
        사례.scenes.map((장면) =>
          precedingNarration(사례.scenes, 장면).map((앞) => 앞.scene_id),
        ),
      )
      if (앞선 !== JSON.stringify(사례.expected.precedingNarration)) {
        어긋난_칸.push(
          `    precedingNarration: 기대 ${JSON.stringify(사례.expected.precedingNarration)} · 실제 ${앞선}`,
        )
      }

      if (어긋난_칸.length === 0) continue

      // ⛔ 몇 개 틀렸다는 숫자만으로는 못 고친다. id 와 입력을 통째로 찍는다.
      어긋난것.push(
        [
          `  id=${사례.id}`,
          `    scenes  : ${JSON.stringify(사례.scenes)}`,
          `    session : ${JSON.stringify(사례.session)}`,
          `    scope   : ${사례.scope} · scene_order=${JSON.stringify(사례.scene_order)}`,
          ...어긋난_칸,
        ].join('\n'),
      )
    }

    if (어긋난것.length > 0) {
      // 전부 찍으면 최악의 경우 618건이라 앞 50건만 본문에 낸다.
      const 보일것 = 어긋난것.slice(0, 50)
      const 더 = 어긋난것.length - 보일것.length
      throw new Error(
        `진행 대조 실패 — ${어긋난것.length}/${사례들.length}건이 어긋났다\n` +
          보일것.join('\n') +
          (더 > 0 ? `\n  … 그리고 ${더}건 더` : ''),
      )
    }

    expect(어긋난것.length).toBe(0)
  })

  it('표가 갈래를 고루 때린다', () => {
    // ⚠️ 대조가 통과해도 표가 한쪽으로 쏠려 있으면 재지 못한 갈래가 남는다.
    //    표를 다시 뽑을 때 축이 줄어들면 여기가 먼저 빨개진다.
    const 종류들 = new Set(
      사례들.map((사례) =>
        '오류' in 사례.expected.nextStep
          ? 사례.expected.nextStep.오류
          : 사례.expected.nextStep.kind,
      ),
    )
    expect([...종류들].sort()).toEqual([
      'LookupError',
      'ValueError',
      '발화받기',
      '장면끝',
      '장면시작',
      '회차끝',
    ])
  })
})
