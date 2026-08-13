// 트랙 사이의 계약 하나 — **`purpose` 는 DB 값이다.**
//
// 파이썬은 `complete(용도="분석")` 으로 부르고 `저장.py:242` 의 `{"분석": "analysis"}` 가
// 옮겨 담았다. 타입스크립트 판은 **그 옮겨 담는 표를 없앴다**(`docs/설계/코드구조.md` —
// 변환 층을 만들지 않는다). 그래서 `engine` 이 처음부터 DB 값을 써야 한다.
//
// ⚠️ 이 검사가 있는 이유는 가정이 아니다 — `engine` 과 `repo` 를 **동시에** 옮기면서
//    한쪽은 파이썬 이름(`분석`)을 들고 왔고 한쪽은 표를 없앴다. 이으면 `llm_calls` INSERT 가
//    CHECK 에 막히는데, 그건 **조립 트랙에 가서야** 드러난다. 여기서 먼저 막는다.
//
// 짝이 되는 검사가 `repo.test.ts` 에 있다 — 거기서는 `분석` 을 일부러 넣어
// `llm_calls_purpose_check` 가 실제로 거절하는 것을 잰다.

import { describe, expect, it } from 'vitest'

import { loadSettings, type Settings } from '@/lib/config'
import { analyze } from '@/lib/engine/analyze'
import { generateLine } from '@/lib/engine/character'

import { installFakeSdk } from './support/sdk-gate'

/** `web/db/schema.ts:438` 의 `llm_calls_purpose_check` 와 같아야 한다. */
const DB가_받는_용도 = ['analysis', 'character']

function 설정(): Settings {
  return loadSettings({ gemini_api_keys: ['키1'], anthropic_api_key: null, llm_rpm: 0 })
}

function 가짜_제미나이(대답: string): void {
  installFakeSdk('gemini', () => ({
    interactions: {
      create: async () => ({ output_text: 대답 }),
    },
  }))
}

const 성한_분석 = JSON.stringify({
  child_intent: 'EMPATHY',
  main_point: '며느리가 창피했을 것 같다',
  detected_elements: [{ type: 'EMPATHY', evidence: '창피했을 것 같아' }],
  utterance_validity: 'VALID',
})

describe('purpose 는 llm_calls 컬럼 값 그대로다', () => {
  it('분석은 `analysis` 로 부른다 — 「분석」이 아니다', async () => {
    가짜_제미나이(성한_분석)
    const 결과 = await analyze('{}', { settings: 설정() })

    expect(결과.llm.attempts[0].purpose).toBe('analysis')
    expect(DB가_받는_용도).toContain(결과.llm.attempts[0].purpose)
  })

  it('캐릭터는 `character` 로 부른다 — 「캐릭터」가 아니다', async () => {
    가짜_제미나이('며느리: 아이고 어쩌나…')
    const 결과 = await generateLine('{}', { settings: 설정() })

    expect(결과.llm.attempts[0].purpose).toBe('character')
    expect(DB가_받는_용도).toContain(결과.llm.attempts[0].purpose)
  })
})
