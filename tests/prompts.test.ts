// `prompts/*.md` 파서 검사 (이슈 #26 말-2).
//
// **가짜 md 를 만들어 놓고 통과시키지 않는다.** 정본 다섯 개를 그대로 파싱한다 —
// 이 파서가 지키는 성질은 「md 를 고치면 코드가 따라온다」이고, 그건 진짜 파일로만 확인된다.
// 손으로 만든 본문은 실패 경로(깨진 입력)에만 쓴다.
//
// ⚠️ `prompts/*.md` 는 정본이라 검사가 고치지 않는다. 읽기만 한다.

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  PlaceholderRemainingError,
  PromptError,
  chooseBody,
  fill,
  materialJson,
  materialTemplate,
  placeholders,
  promptsDir,
  read,
  render,
  sendableBody,
} from '@/llm/prompts'

// 재료 틀을 가진 셋. 열쇠 이름은 `runner.py` 가 넘기던 것 그대로다.
const 틀을_가진_것: ReadonlyArray<[이름: string, 자리표시자: string]> = [
  ['analysis', 'analysis_material'],
  ['character', 'character_material'],
  ['child', 'child_material'],
]

// 심판 프롬프트 둘은 「받는 것」 절이 없다. 채점기가 사용자 블록을 직접 만들어 붙인다.
const 틀이_없는_것 = ['judge_gave_away_element', 'judge_invented_setting']

const md들 = readdirSync(promptsDir())
  .filter((이름) => 이름.endsWith('.md'))
  .map((이름) => 이름.slice(0, -'.md'.length))
  .sort()

describe('prompts/ 찾기', () => {
  it('레포 루트의 prompts/ 를 가리킨다', () => {
    // `web/` 안에서 도는 코드가 한 층 위의 폴더를 잡았는지 본다.
    expect(path.basename(promptsDir())).toBe('prompts')
    expect(path.basename(path.dirname(promptsDir()))).not.toBe('web')
  })

  it('정본 다섯 개가 다 읽힌다', () => {
    expect(md들).toEqual([...틀이_없는_것, ...틀을_가진_것.map(([이름]) => 이름)].sort())
    for (const 이름 of md들) {
      expect(read(이름).length).toBeGreaterThan(0)
    }
  })

  it('없는 이름은 경로를 적어 터진다', () => {
    expect(() => read('없는프롬프트')).toThrow(PromptError)
    expect(() => read('없는프롬프트')).toThrow(/없는프롬프트\.md/)
  })

  it('디렉터리를 직접 주면 그쪽을 본다', () => {
    expect(read('analysis', promptsDir())).toBe(read('analysis'))
    expect(() => read('analysis', path.join(promptsDir(), '없는폴더'))).toThrow(PromptError)
  })
})

describe('재료 틀 — md 가 출처다', () => {
  it.each(틀을_가진_것)('%s.md 의 틀은 {%s} 하나다', (이름, 자리표시자) => {
    const 틀 = materialTemplate(read(이름))
    expect(틀).toBe(`{${자리표시자}}`)
    expect([...placeholders(틀)]).toEqual([자리표시자])
  })

  it.each(틀을_가진_것)('%s.md 의 틀은 파일에 있는 글자 그대로다', (이름) => {
    // ⛔ 코드에 베껴 넣지 않았는지 보는 자리다. 베끼면 md 를 고쳤을 때 조용히 어긋난다.
    const 본문 = read(이름)
    const 틀 = materialTemplate(본문)
    expect(본문).toContain(틀)
    // 「받는 것」 절 **뒤**에서 뽑았나 — 앞쪽 코드블록을 잘못 집으면 여기서 걸린다.
    expect(본문.indexOf(틀)).toBeGreaterThan(본문.indexOf('## 받는 것'))
  })

  it('본문이 바뀌면 틀도 따라 바뀐다', () => {
    const 본문 = '# 머리\n\n## 받는 것\n\n```json\n{새_재료}\n```\n'
    // ⚠️ 이름은 소문자 snake_case 만 잡는다. 한글은 자리표시자가 아니다.
    expect(materialTemplate(본문)).toBe('{새_재료}')
    expect(placeholders(materialTemplate(본문)).size).toBe(0)
  })
})

describe('깨진 입력은 어디가 깨졌는지 말하고 터진다', () => {
  it.each(틀이_없는_것)('%s.md 는 「받는 것」 절이 없다', (이름) => {
    const 부르기 = () => materialTemplate(read(이름), `prompts/${이름}.md`)
    expect(부르기).toThrow(PromptError)
    expect(부르기).toThrow(new RegExp(`prompts/${이름}\\.md.*받는 것`))
  })

  it('출처를 안 주면 「주어진 본문」이라고 말한다', () => {
    expect(() => materialTemplate('절이 없는 본문')).toThrow(/주어진 본문/)
  })

  it('절은 있는데 코드블록이 없으면 그렇다고 말한다', () => {
    const 부르기 = () => materialTemplate('## 받는 것\n\n표만 있다.\n', 'prompts/가짜.md')
    expect(부르기).toThrow(PromptError)
    expect(부르기).toThrow(/prompts\/가짜\.md.*코드블록이 없다/)
  })
})

describe('채우기', () => {
  it('이름을 값으로 바꾼다', () => {
    expect(fill('{a}와 {b}', { a: '하나', b: '둘' })).toBe('하나와 둘')
  })

  it('JSON 예시의 중괄호는 건드리지 않는다', () => {
    // 이게 `str.format` 을 버린 이유였다 (`parse.ts` 머리말).
    const 틀 = '{ "type": "REASON" } · { "a": 1 } · {material}'
    expect(fill(틀, { material: '{"x":1}' })).toBe('{ "type": "REASON" } · { "a": 1 } · {"x":1}')
  })

  it('못 채운 자리가 남으면 이름을 적어 터진다', () => {
    const 부르기 = () => fill('{zebra} {apple} {ok}', { ok: '됨' }, 'prompts/가짜.md')
    expect(부르기).toThrow(PlaceholderRemainingError)
    // 이름은 정렬해서 낸다 — 메시지가 호출 순서에 따라 흔들리지 않게.
    expect(부르기).toThrow(/prompts\/가짜\.md.*apple, zebra/)
  })

  it('프로토타입 이름이 값 행세를 하지 못한다', () => {
    // `constructor` 는 소문자 규칙을 통과한다. `이름 in 값` 으로 짰다면
    // `function Object()` 가 프롬프트에 실렸을 것이다.
    expect(() => fill('{constructor}', {})).toThrow(PlaceholderRemainingError)
  })

  it('값 안에 들어온 `{이름}` 도 못 채운 자리로 잡힌다', () => {
    // ⚠️ 파이썬과 같은 자리에서 터진다. 아이가 `{scene}` 이라고 말하면 여기다.
    //    고치는 것은 이식이 아니라 고도화다 — 지금은 모양을 맞춰 둔다.
    expect(() => fill('{material}', { material: '아이가 {scene} 라고 말했다' })).toThrow(
      PlaceholderRemainingError,
    )
  })

  it('빈 문자열로 채우는 것은 채운 것이다', () => {
    expect(fill('[{material}]', { material: '' })).toBe('[]')
  })
})

describe('보낼 층 자르기', () => {
  it.each(틀을_가진_것)('%s.md 는 영어 층만 나간다', (이름) => {
    const 전체 = read(이름)
    const 보낼것 = sendableBody(전체)

    expect(보낼것.length).toBeGreaterThan(0)
    expect(전체).toContain(보낼것) // 글자를 고치지 않고 잘라내기만 한다
    expect(보낼것.length).toBeLessThan(전체.length)

    // 표식도, 한글 층의 출처 인용도 따라가지 않는다 (결정 48 — 모델에게 쓸모가 없다).
    expect(보낼것).not.toContain('보내는 것 시작')
    expect(보낼것).not.toContain('보내는 것 끝')
    expect(보낼것).not.toContain('한글 층 — 사람이 읽는 것')
    expect(보낼것).not.toContain('📄')
    expect(보낼것).not.toContain('✏️')
  })

  it.each(틀이_없는_것)('%s.md 는 표식이 없어 통째로 간다', (이름) => {
    // 실험 프롬프트도 같은 길을 지난다 — 못 찾겠으면 다 보내는 쪽이 안전하다.
    expect(sendableBody(read(이름))).toBe(read(이름))
  })

  it('표식이 없는 본문은 그대로 돌려준다', () => {
    expect(sendableBody('사람이 써 넣은 실험 프롬프트')).toBe('사람이 써 넣은 실험 프롬프트')
  })
})

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
  it('한글을 그대로, 공백 없이 낸다', () => {
    // 한글을 `\uXXXX` 로 부풀리면 글자 하나가 토큰 여럿이 된다. 공백도 토큰이다.
    expect(materialJson({ child_utterance: '며느리가 창피했을 것 같아', turn: 1 })).toBe(
      '{"child_utterance":"며느리가 창피했을 것 같아","turn":1}',
    )
  })
})

describe('render — (system, user) 한 쌍', () => {
  it('system 은 보낼 층, user 는 채운 재료다', () => {
    const 재료 = materialJson({ child_utterance: '며느리가 불쌍해요' })
    const { system, user } = render('analysis', { analysis_material: 재료 })

    expect(system).toBe(sendableBody(read('analysis')))
    expect(user).toBe(재료)
  })

  it('재료를 안 주면 파일 이름을 적어 터진다', () => {
    const 부르기 = () => render('character', {})
    expect(부르기).toThrow(PlaceholderRemainingError)
    expect(부르기).toThrow(/prompts\/character\.md.*character_material/)
  })
})

describe('정본 md 는 검사가 건드리지 않는다', () => {
  it('다섯 파일 모두 읽기만 해도 같은 내용이다', () => {
    // 파서에 부작용이 없는지 보는 자리 — 읽고 파싱한 뒤에도 파일이 그대로여야 한다.
    for (const 이름 of md들) {
      const 경로 = path.join(promptsDir(), `${이름}.md`)
      const 처음 = readFileSync(경로, 'utf-8')
      sendableBody(처음)
      expect(readFileSync(경로, 'utf-8')).toBe(처음)
    }
  })
})
