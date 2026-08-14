// 환경변수 **이름**을 세우는 검사 (결정 72 · 2026-08-13).
//
// 재는 것은 값이 아니라 **이름 하나**다 — 제미나이 키가 `GQ_` 접두사로 읽히는가.
//
// ## 왜 이 검사가 따로 있나
//
// 이 코드는 팀 repo `api_team` 위에 얹힌다. 저쪽 `.env.example` 에 이미 `GEMINI_API_KEY` 가
// 있고 **그건 저쪽 TTS(Gemini 2.5 Flash) 용**이다. 이름이 겹치면 한 배포에서 키 하나가
// 저쪽 TTS 와 우리 분석·캐릭터 LLM 을 동시에 먹여 할당량과 청구가 섞인다.
//
// 🔴 **되돌리기가 조용해서 위험한 자리다.** 이름을 옛것으로 돌려 놓아도 컴파일은 통과하고,
//    저쪽 키가 환경에 있으면 **호출까지 성공한다.** 틀렸다는 신호가 청구서에서만 나온다.
//    그래서 이름을 문자열로 못 박아 둔다.
//
// ⚠️ `ANTHROPIC_API_KEY`·`OPENAI_API_KEY` 는 **일부러 접두사가 없다.** 결정 72 는 제미나이
//    키만 말한다 — 저쪽과 겹치는 것이 그것뿐이기 때문이다. 아래 마지막 갈래가 그걸 지킨다.
//
// ## 어떻게 재나
//
// `loadSettings()` 는 `web/.env.local` 을 읽어 `process.env` 를 채우는데, 채울 때
// `override: false` 라 **이미 `process.env` 에 있는 이름은 건드리지 않는다**
// (dotenv 는 값이 아니라 `hasOwnProperty` 로 판단한다). 그래서 빈 문자열을 미리 꽂아 두면
// 파일에 진짜 키가 있어도 그 칸을 **비운 채로** 잴 수 있다. 진짜 키 값은 이 파일에 안 나온다.

import { afterEach, describe, expect, it } from 'vitest'

import { loadSettings } from '@/llm/config'

/** 이 검사가 손대는 이름 전부. 갈래마다 원래 값으로 되돌린다. */
const 손대는_이름들 = [
  'GQ_GEMINI_API_KEY',
  'GQ_GEMINI_API_KEY_2',
  'GQ_GEMINI_API_KEY_3',
  'GEMINI_API_KEY',
  'GEMINI_API_KEY_2',
  'GEMINI_API_KEY_3',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
] as const

const 원래값 = new Map<string, string | undefined>(
  손대는_이름들.map((이름) => [이름, process.env[이름]]),
)

function 세운다(값들: Record<string, string>): void {
  // 안 준 이름은 빈칸으로 꽂는다 — 파일에서 새어 들어오는 것을 막는다.
  for (const 이름 of 손대는_이름들) process.env[이름] = 값들[이름] ?? ''
}

afterEach(() => {
  for (const [이름, 값] of 원래값) {
    if (값 === undefined) delete process.env[이름]
    else process.env[이름] = 값
  }
})

describe('제미나이 키 환경변수 이름 (결정 72)', () => {
  it('`GQ_` 접두사가 붙은 세 이름을 적힌 순서대로 읽는다', () => {
    세운다({
      GQ_GEMINI_API_KEY: '첫째',
      GQ_GEMINI_API_KEY_2: '둘째',
      GQ_GEMINI_API_KEY_3: '셋째',
    })

    expect(loadSettings().gemini_api_keys).toEqual(['첫째', '둘째', '셋째'])
  })

  it('🔴 접두사 없는 옛 이름은 **안 읽는다** — 저쪽 TTS 키를 물지 않기 위해서다', () => {
    세운다({
      GEMINI_API_KEY: '저쪽TTS키',
      GEMINI_API_KEY_2: '저쪽TTS키2',
      GEMINI_API_KEY_3: '저쪽TTS키3',
    })

    expect(loadSettings().gemini_api_keys).toEqual([])
  })

  it('빈칸은 없는 것으로 치고 남은 것만 순서대로 남는다', () => {
    세운다({ GQ_GEMINI_API_KEY_2: '둘째만' })

    expect(loadSettings().gemini_api_keys).toEqual(['둘째만'])
  })

  it('⚠️ 앤트로픽·오픈에이아이 키는 접두사가 없다 — 결정 72 는 제미나이만 말한다', () => {
    세운다({ ANTHROPIC_API_KEY: '앤트로픽', OPENAI_API_KEY: '오픈에이아이' })
    const 설정 = loadSettings()

    expect(설정.anthropic_api_key).toBe('앤트로픽')
    expect(설정.openai_api_key).toBe('오픈에이아이')
  })
})
