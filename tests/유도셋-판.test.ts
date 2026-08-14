// 유도 골든셋 하네스 — **판이 안 죽는가**·**못 잰 것을 0 으로 안 세는가**·**재심이 옛 판정을
// 안 지우는가**를 지킨다.
//
// 파이썬 `tests/test_유도셋.py` 에서 이 절에 해당하는 사례를 옮겼다
// (5절 판 돌리기 · 7절 재심). 뽑기·직렬화·파일 쓰기는 `유도셋-기록.test.ts` 가 이미 덮는다.
//
// ⚠️ **LLM 도 DB 도 타지 않는다.** 대사 내는 함수와 심판 호출을 **둘 다 주입해** 가짜로 돌린다.
// 🔴 `goldenset/유도/검수전.jsonl` 원본은 여기서 **아예 안 연다.** 파일은 `mkdtemp` 안에서만 쓴다.
//
// 여기서 지키는 것 넷.
//
// 1. **한 항목이 죽어도 판은 계속 돈다** — 실패도 기록이다 (FR-002).
// 2. **「판정 못 함」은 분모에서 빠진다** — 「모르겠다」와 「틀렸다」를 안 섞는다 (결정 29).
// 3. **깔때기는 두 심판을 짝으로 돌려야 보인다** — 과녁 심판에게는 만점짜리 대사다.
// 4. **재심은 대사를 고정하고 옛 판정을 쌓는다** — 무엇이 왜 뒤집혔는지가 곧 기록이다.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import {
  accuracy,
  judgeAgreement,
  makeGuidanceItem,
  parseGuidanceGoldenset,
  type GuidanceItem,
} from '@/llm/goldenset-guidance'
import type { JudgeCall } from '@/llm/judge'
import { isFunnel } from '@/llm/service/goldenset-guidance'
import { appendItem, characterPromptDigest } from '../tools/유도셋-기록'
import {
  majority,
  recordRejudge,
  runRejudge,
  runRound,
  tableText,
  tally,
  targetHitRate,
  targetJudgeDigest,
} from '../tools/유도셋-판'

// 대화2(`scene_order` 5) 첫 유도 자리. 값은 `sql/002_seed_banggui.sql` 에서 가져왔다.
const 기준_문장 =
  '며느리가 그때 어떤 처지였는지를 며느리 쪽에서 말한다. ' +
  '시아버지 자신의 놀람·체면은 이 장면에서 시아버지가 스스로 말하는 것이므로 인정하지 않는다.'
const 걱정 = '흥, 이 일로 낯을 못 들게 된 사람이 나 하나뿐이지 무어냐!'

/** 파이썬 시험의 `_자료()`. */
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
      direction: { response_mode: 'GUIDED', reaction_key: 'SURPRISE', remaining_worry: 걱정 },
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

/** 파이썬 시험의 `_대기_붙인_자료()`. 사람 판정 하나가 같은 대사에 붙어 있다. */
function 대기_붙인_자료(대사: string, 과녁: string, 누출: string): Record<string, unknown> {
  return 자료({
    판정대기: [
      {
        대사,
        심판_과녁: 과녁,
        심판_답누출: 누출,
        돌린날: '2026-08-13',
        프롬프트_지문: 'abc123',
      },
    ],
    사람판정: [
      { 대사, 과녁: '성공', 답누출: '지킴', 근거: '', 매긴날: '2026-08-13' },
    ],
  })
}

// 임시 디렉터리 — 🔴 원본 정답지 근처에 아무것도 쓰지 않는다.
const 임시들: string[] = []
function 새_경로(이름 = '유도.jsonl'): string {
  const 방 = mkdtempSync(path.join(tmpdir(), 'gq-유도판-'))
  임시들.push(방)
  return path.join(방, 이름)
}
afterAll(() => {
  for (const 방 of 임시들) rmSync(방, { recursive: true, force: true })
})

function 읽기(경로: string): GuidanceItem[] {
  return parseGuidanceGoldenset(readFileSync(경로, 'utf-8'), 경로)
}

// ⛔ 진짜 심판을 부르지 않는다. `lib/judge.ts` 의 `call` 자리에 꽂는다 (파이썬 `호출=`).
//    ⭐ `runJudge()` 자체는 진짜로 돈다 — 근거 대조·판정 낱말 해석이 그대로 걸려야 하기 때문이다.
function 가짜_심판(판정: string): JudgeCall {
  return async () => {
    // 「위반」은 대사에서 옮긴 조각이 있어야 산다 (없으면 `runJudge` 가 판정을 버린다).
    const 근거 = 판정 === '위반' ? '갓' : ''
    return { text: `{"판정":"${판정}","근거":"${근거}","이유":"…"}` }
  }
}

/** 답누출 심판만 갈라 답하게 한다. 파이썬 시험이 쓰는 그 표식이다. */
function 누출_심판인가(system: string): boolean {
  return system.includes('아이가 할 말이 남아 있나')
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. 판 돌리기
// ═══════════════════════════════════════════════════════════════════════════

describe('판 돌리기', () => {
  it('합계를 낸다', async () => {
    const { 결과들, 합계 } = await runRound([항목(), 항목()], {
      대사_내기: async () => '흥, 내 갓이 구르지 않았느냐!',
      call: 가짜_심판('위반'),
    })

    expect(합계.돌린수).toBe(2)
    expect(합계.과녁_실패).toBe(2)
    expect(targetHitRate(합계)).toBe(0)
    expect(결과들.map((한) => 한.대사)).toEqual([
      '흥, 내 갓이 구르지 않았느냐!',
      '흥, 내 갓이 구르지 않았느냐!',
    ])
  })

  it('적중률 분모에서 판정불가를 뺀다', async () => {
    // 평균에 넣으면 숫자가 조용히 거짓말을 한다 (결정 29).
    const { 합계 } = await runRound([항목()], {
      대사_내기: async () => '흥.',
      call: 가짜_심판('판정불가'),
    })

    expect(합계.과녁_못셈).toBe(1)
    expect(targetHitRate(합계)).toBeNull() // 판정 못 한 것을 0 으로 세고 있다
  })

  it('분모가 0 이면 null 이다 — 0% 가 아니다', () => {
    // 「다 빗나갔다」와 「아무것도 못 쟀다」는 정반대의 말이다.
    expect(targetHitRate({ 과녁_성공: 0, 과녁_실패: 0 })).toBeNull()
    expect(targetHitRate({ 과녁_성공: 0, 과녁_실패: 2 })).toBe(0)
    expect(targetHitRate({ 과녁_성공: 1, 과녁_실패: 3 })).toBe(0.25)
  })

  it('대사가 죽어도 판은 계속 돈다', async () => {
    // 실패도 기록이다 (FR-002). 한 줄 때문에 판 전체를 잃지 않는다.
    let 호출수 = 0
    const 대사_내기 = async (): Promise<string> => {
      호출수 += 1
      if (호출수 === 1) throw new Error('공급자가 죽었다')
      return '그 아이는 무슨 생각이었느냐?'
    }

    const { 결과들, 합계 } = await runRound([항목(), 항목()], {
      대사_내기,
      call: 가짜_심판('통과'),
    })

    expect(합계.대사실패).toBe(1)
    expect(합계.과녁_성공).toBe(1)
    expect(합계.돌린수).toBe(2)
    expect(결과들[0].대사).toBeNull()
    expect(결과들[0].실패).toContain('공급자가 죽었다')
    expect(결과들[0].채점들).toEqual([]) // 안 낸 대사를 심판에게 안 보낸다
    expect(결과들[1].대사).toBe('그 아이는 무슨 생각이었느냐?')
  })

  it('깔때기가 합계에 잡힌다', async () => {
    // 과녁은 맞혔는데 아이 몫을 없앤 판. 두 심판을 짝으로 돌려야만 보인다.
    const 갈라_답하기: JudgeCall = async (system) => ({
      text: 누출_심판인가(system)
        ? '{"판정":"위반","근거":"갓","이유":"「네」로 끝난다"}'
        : '{"판정":"통과","근거":"","이유":"과녁으로 끌었다"}',
    })

    const { 결과들, 합계 } = await runRound([항목()], {
      대사_내기: async () => '흥, 내 갓이 구르지 않았느냐!',
      call: 갈라_답하기,
    })

    expect(합계.과녁_성공).toBe(1)
    expect(합계.누출_위반).toBe(1)
    expect(합계.깔때기).toBe(1) // 과녁만 보면 만점인 대사를 못 잡았다
    expect(결과들[0].깔때기).toBe(true)
    // 판이 스스로 세지 않고 `isFunnel()` 이 정한 것과 같아야 한다 — 정의가 둘이면 갈라진다.
    expect(isFunnel(결과들[0].채점들)).toBe(true)
  })

  it('두 심판이 다 도는 채점을 그대로 들고 있다', async () => {
    const { 결과들 } = await runRound([항목()], {
      대사_내기: async () => '그 아이는 무슨 생각이었느냐?',
      call: 가짜_심판('통과'),
    })

    expect(결과들[0].채점들.map((하나) => 하나.name)).toEqual([
      'guided_toward_target',
      'gave_away_element',
    ])
    expect(결과들[0].guidance_target).toBe('PERSPECTIVE')
    expect(결과들[0].실패).toBe('')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. 다수결과 표
// ═══════════════════════════════════════════════════════════════════════════

describe('다수결', () => {
  it('동점이면 판정불가다', () => {
    // 반올림해서 한쪽에 붙이지 않는다. 「모르겠다」와 「틀렸다」를 안 섞는다 (결정 29).
    expect(majority(['적중', '빗나감'])).toBe('판정불가')
    expect(majority(['적중', '적중', '빗나감'])).toBe('적중')
    expect(majority(['빗나감'])).toBe('빗나감')
  })

  it('셋이 갈리면 판정불가다', () => {
    expect(majority(['적중', '빗나감', '판정불가'])).toBe('판정불가')
  })

  it('빈 목록도 판정불가다 — 파이썬은 터졌다', () => {
    // ⚠️ 일부러 갈라 둔 자리다. 여기서 터뜨려 봐야 판 전체가 죽을 뿐이다.
    expect(majority([])).toBe('판정불가')
  })

  it('표는 처음 나온 차례로 세고 많은 순으로 찍는다', () => {
    expect(tally(['적중', '빗나감', '적중'])).toEqual({ 적중: 2, 빗나감: 1 })
    expect(tableText({ 과녁_표: { 빗나감: 1, 적중: 2 }, 답누출_표: { 지킴: 3 } })).toBe(
      '과녁 적중×2 빗나감×1 · 답누출 지킴×3',
    )
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. 재심 — 심판을 고치고 같은 대사를 다시 판정한다
// ═══════════════════════════════════════════════════════════════════════════

describe('재심', () => {
  it('대사를 그대로 두고 심판만 바꾼다', async () => {
    // 판을 다시 돌리면 캐릭터가 **다른 대사**를 내어 사람 판정이 붙은 대사가 사라진다.
    const 경로 = 새_경로()
    const 대사 = '흥, 이 일로 낯을 못 들게 된 사람이 나 하나뿐이지 무어냐!'
    appendItem(경로, 대기_붙인_자료(대사, '빗나감', '지킴'))

    const 결과들 = await runRejudge(읽기(경로), { call: 가짜_심판('통과') })
    recordRejudge(경로, 결과들, { 돌린날: '2026-08-14', 심판_지문: '새지문' })

    const [고친것] = 읽기(경로)
    expect(고친것.대기들).toHaveLength(1)
    const [대기] = 고친것.대기들
    expect(대기.대사).toBe(대사) // 대사가 바뀌면 사람 판정이 붙을 자리를 잃는다
    expect(대기.심판_과녁).toBe('적중')
    expect(대기.심판_지문).toBe('새지문')
    expect(대기.돌린날).toBe('2026-08-14')
    expect(결과들[0].뒤집힘).toBe(true)
  })

  it('옛 판정을 안 지우고 쌓는다', async () => {
    // 무엇이 왜 뒤집혔는지가 곧 심판을 고친 효과다. 실데이터에는 여섯 줄씩 쌓여 있다.
    const 경로 = 새_경로()
    const 대사 = '흥, 내 갓이 구르지 않았느냐!'
    appendItem(경로, 대기_붙인_자료(대사, '빗나감', '지킴'))

    recordRejudge(경로, await runRejudge(읽기(경로), { call: 가짜_심판('통과') }), {
      돌린날: '2026-08-14',
      심판_지문: '지문1',
    })

    const [대기1] = 읽기(경로)[0].대기들
    expect(대기1.옛심판).toHaveLength(1)
    expect(대기1.옛심판[0]).toContain('과녁=빗나감')
    expect(대기1.옛심판[0]).toContain('2026-08-13') // 옛 판정을 낸 날이 남아야 한다
    expect(대기1.옛심판[0]).toContain('심판지문=(안 적힘)') // 그때는 안 적었다

    // 한 번 더 — 덮이지 않고 **쌓인다.**
    recordRejudge(경로, await runRejudge(읽기(경로), { call: 가짜_심판('위반') }), {
      돌린날: '2026-08-15',
      심판_지문: '지문2',
    })

    const [대기2] = 읽기(경로)[0].대기들
    expect(대기2.옛심판).toHaveLength(2)
    expect(대기2.옛심판[1]).toContain('과녁=적중') // 방금 뒤집힌 그 값
    expect(대기2.옛심판[1]).toContain('심판지문=지문1')
    expect(대기2.심판_과녁).toBe('빗나감')
  })

  it('반복은 다수결을 취하고 흔들림을 적는다', async () => {
    // ⭐ 한 번만 돌린 대조는 **심판의 흔들림과 프롬프트의 효과를 못 가른다** (2026-08-13).
    const 경로 = 새_경로()
    const 대사 = '흥, 내 갓이 구르지 않았느냐!'
    appendItem(경로, 대기_붙인_자료(대사, '빗나감', '지킴'))

    const 답 = ['통과', '위반', '통과'] // 과녁 심판만 흔들리게 — 2 대 1 이다
    let 자리 = 0
    const 흔들리는_심판: JudgeCall = async (system) => {
      const 판정 = 누출_심판인가(system) ? '통과' : 답[자리++]
      const 근거 = 판정 === '위반' ? '갓' : ''
      return { text: `{"판정":"${판정}","근거":"${근거}","이유":"…"}` }
    }

    const [한] = await runRejudge(읽기(경로), { 반복: 3, call: 흔들리는_심판 })

    expect(한.새_과녁).toBe('적중') // 2 대 1 이면 많은 쪽이다
    expect(한.과녁_표).toEqual({ 적중: 2, 빗나감: 1 })
    expect(한.흔들렸나).toBe(true)
    expect(한.답누출_표).toEqual({ 지킴: 3 }) // 안 흔들린 축까지 흔들렸다고 하면 안 된다

    recordRejudge(경로, [한], { 돌린날: '2026-08-14' })
    const [대기] = 읽기(경로)[0].대기들
    expect(대기.심판_표).toContain('적중×2')
    expect(대기.심판_표).toContain('빗나감×1')
  })

  it('고친 줄 수를 돌려준다 — 조용히 덮어쓰지 않는다', async () => {
    const 경로 = 새_경로()
    appendItem(경로, 대기_붙인_자료('흥, 내 갓이 구르지 않았느냐!', '빗나감', '지킴'))
    appendItem(경로, 자료({ id: 'gd_banggui_05_PERSPECTIVE_002' })) // 판정대기가 없는 줄

    const 바뀐 = recordRejudge(
      경로,
      await runRejudge(읽기(경로), { call: 가짜_심판('통과') }),
      { 돌린날: '2026-08-14' },
    )

    expect(바뀐).toBe(1) // 대기가 없는 줄은 안 건드린다
    expect(recordRejudge(경로, [], { 돌린날: '2026-08-14' })).toBe(0)
  })

  it('대조가 재심으로 실제로 움직인다', async () => {
    // 대조는 **심판을 재는 숫자**다. 재심이 그 숫자를 움직이는지 본다.
    const 경로 = 새_경로()
    const 대사 = '흥, 이 일로 낯을 못 들게 된 사람이 나 하나뿐이지 무어냐!'
    appendItem(경로, 대기_붙인_자료(대사, '빗나감', '지킴'))

    const 전 = judgeAgreement(읽기(경로), { 축: '과녁' })
    expect(전.틀림).toBe(1)
    expect(전.맞음).toBe(0)
    expect(accuracy(전)).toBe(0)

    recordRejudge(경로, await runRejudge(읽기(경로), { call: 가짜_심판('통과') }), {
      돌린날: '2026-08-14',
    })

    const 후 = judgeAgreement(읽기(경로), { 축: '과녁' })
    expect(후.맞음).toBe(1)
    expect(후.틀림).toBe(0)
    expect(accuracy(후)).toBe(1)
  })

  it('대사가 빈 대기는 심판을 안 부른다', async () => {
    let 부른적 = 0
    const 세는_심판: JudgeCall = async () => {
      부른적 += 1
      return { text: '{"판정":"통과","근거":"","이유":"…"}' }
    }
    const 항목_ = 항목({
      판정대기: [{ 대사: '', 심판_과녁: '판정불가', 심판_답누출: '판정불가' }],
    })

    expect(await runRejudge([항목_], { call: 세는_심판 })).toEqual([])
    expect(부른적).toBe(0)
  })

  it('과녁 심판 지문은 캐릭터 지문과 다른 파일의 것이다', () => {
    // 둘을 섞으면 무엇을 고쳐서 숫자가 움직였는지 못 가른다.
    expect(targetJudgeDigest()).toMatch(/^[0-9a-f]{64}$/)
    expect(targetJudgeDigest()).not.toBe(characterPromptDigest())
  })
})
