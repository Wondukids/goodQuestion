// `prompts/` 읽기와 **두 파일이 어긋나지 않는지** 재는 검사.
//
// **가짜 md 를 만들어 놓고 통과시키지 않는다.** 정본 여섯을 그대로 읽는다 —
// 이 층이 지키는 성질은 「md 를 고치면 코드가 따라온다」이고, 그건 진짜 파일로만 확인된다.
// 손으로 만든 본문은 실패 경로(깨진 입력)에만 쓴다.
//
// ⚠️ `prompts/` 는 정본이라 검사가 고치지 않는다. 읽기만 한다.
//
// ## 두 파일 체제 (2026-08-14)
//
// 프롬프트 하나가 폴더 하나이고 그 안에 두 파일이 있다.
//
// ```
// prompts/analysis/
//   보낼것.md   ← LLM 에 나가는 것
//   해설.md     ← 사람이 읽는 것. 한 글자도 안 나간다
// ```
//
// 나누면 오려낼 일이 없어지는 대신 **두 파일이 서로 모르게 어긋나는** 새 위험이 생긴다.
// 아래 「어긋남 검사 셋」이 그것을 잡는다. 파이썬 레포에 `test_프롬프트_두층.py` 가
// 있었지만 이식되지 않았고, 그 구멍을 여기서 메운다.

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  PromptError,
  chooseBody,
  materialJson,
  promptsDir,
  read,
  보낼것,
  프롬프트가_아닌_md,
} from '@/llm/prompts'

/** 사람이 읽는 쪽. ⛔ **이름이 이 검사 파일에만 있다** — 엔진은 이 파일을 모른다. */
const 해설 = '해설.md'

/**
 * 재료 JSON 이 들어가는 일곱. 앞의 셋은 열쇠 이름이 `runner.py` 가 넘기던 것 그대로이고,
 * 미션 둘(이슈 #18)은 `docs/미션_명세.md` 9절이, 리포트 둘(이슈 #37)은
 * `docs/보호자_리포트_명세.md` 5절이 정본이다.
 */
const 재료를_받는_것 = [
  'analysis',
  'character',
  'child',
  'mission_reply',
  'mission_summary',
  'report_analysis',
  'report_guide',
]

/** 심판 셋. 나가는 쪽이 **한국어**다 — 한국어 대사를 읽고 판정하기 때문. */
const 심판 = [
  'judge_gave_away_element',
  'judge_guided_toward_target',
  'judge_invented_setting',
]

/** 규칙 한 덩이에 붙는 태그. 두 파일에 같은 것이 있어야 한다. */
const 태그 = (글: string): string[] =>
  [...new Set([...글.matchAll(/\[([A-Z])-([A-Z0-9]+)\]/g)].map((맞은것) => 맞은것[0]))].sort()

const 프롬프트들 = readdirSync(promptsDir(), { withFileTypes: true })
  .filter((항목) => 항목.isDirectory())
  .map((항목) => 항목.name)
  .filter((이름) => !프롬프트가_아닌_md.includes(이름))
  .sort()

describe('prompts/ 찾기', () => {
  it('레포 루트의 prompts/ 를 가리킨다', () => {
    // `web/` 안에서 도는 코드가 한 층 위의 폴더를 잡았는지 본다.
    expect(path.basename(promptsDir())).toBe('prompts')
    expect(path.basename(path.dirname(promptsDir()))).not.toBe('web')
  })

  it('정본 열이 다 읽힌다', () => {
    expect(프롬프트들).toEqual([...심판, ...재료를_받는_것].sort())
    for (const 이름 of 프롬프트들) {
      expect(read(이름).length).toBeGreaterThan(0)
    }
  })

  it('폴더마다 두 파일이 다 있다', () => {
    for (const 이름 of 프롬프트들) {
      const 안 = readdirSync(path.join(promptsDir(), 이름)).sort()
      expect(안).toEqual([보낼것, 해설].sort())
    }
  })

  it('README.md 는 프롬프트가 아니다 — 목록에 안 낀다', () => {
    // 규칙 문서다. 끼면 작업대 화면에 프롬프트인 척 뜬다.
    expect(프롬프트들).not.toContain('README')
    expect(readdirSync(promptsDir())).toContain('README.md')
  })

  it('없는 이름은 경로를 적어 터진다', () => {
    expect(() => read('없는프롬프트')).toThrow(PromptError)
    expect(() => read('없는프롬프트')).toThrow(/없는프롬프트/)
  })

  it('디렉터리를 직접 주면 그쪽을 본다', () => {
    expect(read('analysis', promptsDir())).toBe(read('analysis'))
    expect(() => read('analysis', path.join(promptsDir(), '없는폴더'))).toThrow(PromptError)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 어긋남 검사 셋 — 나누면서 생긴 새 위험을 잡는 자리
// ═══════════════════════════════════════════════════════════════════════════

describe('① 태그 짝 — 규칙이 한쪽에만 있으면 잡는다', () => {
  it.each(재료를_받는_것)('%s 는 두 파일의 태그 집합이 같다', (이름) => {
    const 나가는쪽 = 태그(read(이름))
    const 사람쪽 = 태그(readFileSync(path.join(promptsDir(), 이름, 해설), 'utf-8'))

    // 한쪽에만 있는 것을 **이름까지 찍어** 알려 준다 — 개수만 맞추면 못 고친다.
    expect(사람쪽.filter((t) => !나가는쪽.includes(t))).toEqual([])
    expect(나가는쪽.filter((t) => !사람쪽.includes(t))).toEqual([])
    expect(나가는쪽.length).toBeGreaterThan(0)
  })

  it('일곱을 합치면 78쌍이다 (2026-08-15 기준선)', () => {
    // 규칙을 더하거나 지우면 이 숫자가 바뀐다. 바뀌었으면 **의도한 것인지 확인하고** 고쳐라.
    // 32(분석 13 · 캐릭터 14 · 아이 5) + 미션 15(`R-…` 8 · `S-…` 7) = 47 (이슈 #18)
    // + 리포트 31(`A-…` 17 · `G-…` 14) = 78 (이슈 #37).
    const 합 = 재료를_받는_것.reduce((센것, 이름) => 센것 + 태그(read(이름)).length, 0)
    expect(합).toBe(78)
  })

  it('⚠️ 뜻이 어긋난 것은 못 잡는다', () => {
    // 이 검사가 보는 것은 **태그가 양쪽에 있느냐**뿐이다. 같은 태그 아래 두 파일이
    // 서로 다른 말을 하고 있어도 통과한다. 그건 사람이 두 파일을 나란히 놓고 읽어야 한다.
    expect(태그('[E-A] 하늘은 파랗다')).toEqual(태그('[E-A] 하늘은 빨갛다'))
  })
})

describe('② 인용 누출 — 사람용 글이 LLM 쪽으로 새면 잡는다', () => {
  // 나가는 쪽에 있으면 안 되는 것. 앞의 넷은 **이 레포에 없는 문서**를 가리키고,
  // 뒤의 셋은 사람이 읽는 출처 표식·회의 이력이다. 모델에게 쓸모가 없고 토큰만 먹는다.
  //
  // 🔴 2026-08-14 분리 전에는 `judge_gave_away_element` 가 여기 걸렸다 —
  //    심판이 `CLAUDE.md` 와 `docs/조사/…` 를 근거로 받고 회의 이력까지 읽고 있었다.
  const 새면_안_되는_것: ReadonlyArray<[글자: string, 무엇: string]> = [
    ['docs/', '이 레포에 없는 문서 경로'],
    ['CLAUDE.md', '이 레포에 없는 문서'],
    ['notes/', '이 레포에 없는 폴더'],
    ['이슈 #', '이슈 번호'],
    ['📄', '출처 인용 표식'],
    ['✏️', '출처 인용 표식'],
  ]

  it.each(프롬프트들)('%s/보낼것.md 는 깨끗하다', (이름) => {
    const 나가는것 = read(이름)
    const 걸린것 = 새면_안_되는_것.filter(([글자]) => 나가는것.includes(글자))
    expect(걸린것.map(([글자, 무엇]) => `${글자} (${무엇})`)).toEqual([])
  })

  // 🔴 채울 자리가 없어진 자리표시자 (2026-08-14 두 파일 분리). `{child_utterance}` 처럼
  //    괄호 안이 이름 하나뿐인 것을 잡는다 — 안 채워지고 **글자 그대로 모델에게 나간다**
  //    (`prompts/README.md` 2절·9절). 출력 규격을 적은 JSON 예시(`{"overall": …}`)는
  //    괄호 안이 이름 하나가 아니므로 안 걸린다.
  const 자리표시자 = /\{[A-Za-z_][A-Za-z0-9_]*\}/g

  it.each(프롬프트들)('%s/보낼것.md 에 자리표시자가 없다', (이름) => {
    자리표시자.lastIndex = 0
    expect(read(이름).match(자리표시자) ?? []).toEqual([])
  })

  it('사람 쪽에는 있어도 된다 — 거기가 인용이 사는 자리다', () => {
    // 뒤집힌 단언이다. 해설에서 인용을 지우라는 뜻이 아니라는 것을 못박아 둔다.
    const 해설들 = 프롬프트들.map((이름) =>
      readFileSync(path.join(promptsDir(), 이름, 해설), 'utf-8'),
    )
    expect(해설들.some((글) => 글.includes('docs/'))).toBe(true)
  })
})

describe('③ 경로 봉인 — 해설을 LLM 경로에 실을 길이 없다', () => {
  // `tests/prompt-lab.test.ts` 의 「소스 훑기」와 같은 방식이다. 아직 안 불리는 길도 잡는다.
  const 훑을_파일 = [
    'src/llm/prompts/render.ts',
    'src/llm/prompts/parse.ts',
    'src/llm/prompts/index.ts',
    'src/llm/engine/analyze.ts',
    'src/llm/engine/character.ts',
    'src/llm/engine/material.ts',
    'src/llm/engine/mission.ts',
    'src/llm/judge.ts',
  ]

  it.each(훑을_파일)('%s 에 「해설」이라는 글자가 없다', (자리) => {
    const 소스 = readFileSync(path.join(path.dirname(promptsDir()), 자리), 'utf-8')
    expect(소스).not.toContain(해설)
  })

  it('읽는 파일 이름은 `보낼것.md` 한 곳이 갖는다', () => {
    // 이름을 여러 곳에 베껴 적으면 하나를 고칠 때 나머지가 조용히 갈라진다.
    expect(보낼것).toBe('보낼것.md')
    const 소스 = readFileSync(
      path.join(path.dirname(promptsDir()), 'src/llm/prompts/render.ts'),
      'utf-8',
    )
    // 상수를 정의하는 줄 하나뿐이다.
    expect(소스.split("'보낼것.md'").length - 1).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 나머지
// ═══════════════════════════════════════════════════════════════════════════

describe('본문 고르기 — 「안 주면 파일」', () => {
  it('안 주면 파일을 읽는다', () => {
    expect(chooseBody('analysis')).toBe(read('analysis'))
    expect(chooseBody('analysis', null)).toBe(read('analysis'))
  })

  it('주면 그것을 쓴다', () => {
    expect(chooseBody('analysis', '준 본문')).toBe('준 본문')
  })

  it('빈 문자열도 「준 것」이다', () => {
    // `''` 를 주고 파일이 읽히면 준 사람이 속는다.
    expect(chooseBody('analysis', '')).toBe('')
  })
})

describe('재료 JSON', () => {
  it('한글을 부풀리지 않고 공백도 안 넣는다', () => {
    // 한글을 `\uXXXX` 로 부풀리면 글자 하나가 토큰 여럿이 된다. 공백도 토큰이다.
    expect(materialJson({ child_utterance: '며느리가 창피했을 것 같아', turn: 1 })).toBe(
      '{"child_utterance":"며느리가 창피했을 것 같아","turn":1}',
    )
  })
})

describe('정본은 검사가 건드리지 않는다', () => {
  it('스무 파일 모두 읽어도 그대로다', () => {
    for (const 이름 of 프롬프트들) {
      for (const 파일 of [보낼것, 해설]) {
        const 경로 = path.join(promptsDir(), 이름, 파일)
        const 처음 = readFileSync(경로, 'utf-8')
        expect(readFileSync(경로, 'utf-8')).toBe(처음)
      }
    }
  })
})
