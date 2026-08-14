// 유도 골든셋의 뼈대 — 형식과 대조를 지킨다 (`lib/goldenset-guidance.ts`).
//
// 파이썬 `tests/test_유도셋.py` 에서 **파서와 `대조_내기` 에 해당하는 사례만** 옮겼다.
// 프롬프트를 짓는 검사(⛔ 과녁이 캐릭터에게 새는가)와 심판·판 돌리기 검사는
// 그 코드가 아직 여기 없어서 안 옮겼다.
//
// ⚠️ **LLM 도 DB 도 타지 않는다.** 글자를 넣고 값을 견주기만 한다.
//
// 여기서 지키는 것 셋.
//
// 1. **판정 값이 셋뿐이다.** 「애매」는 통과가 아니라 판정 안 함이고 분모에서 빠진다 (결정 29).
// 2. **오타가 읽는 자리에서 터진다.** 조용히 통과시키면 그 줄이 어느 쪽으로 세어졌는지 못 찾는다.
// 3. **대조는 심판을 재는 숫자다.** 사람 「애매」와 심판 「판정불가」가 분모에서 빠지는지 본다.

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { PROJECT_ROOT } from '@/llm/config'
import {
  GuidanceGoldensetError,
  accuracy,
  childUtterance,
  giveawayScore,
  isGuidanceReviewed,
  judgeAgreement,
  makeGuidanceItem,
  parseGuidanceGoldenset,
  remainingWorry,
  responseMode,
  targetScore,
  unjudgedLines,
} from '@/llm/goldenset-guidance'

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
    장면_이름: '대화2',
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
    채점: {
      guidance_target: 'PERSPECTIVE',
      element_criterion: 기준_문장,
    },
    사람판정: [],
    메모: '',
    ...덮어쓰기,
  }
}

function 항목() {
  return makeGuidanceItem(자료(), '시험')
}

/** 한 줄짜리 jsonl 글자. 파일을 읽지 않고 **글자를 넣는** 것이 이 파일의 규약이다. */
function 줄(덮어쓰기: Record<string, unknown> = {}): string {
  return JSON.stringify(자료(덮어쓰기))
}

// ── 1. 판정 값 ────────────────────────────────────────────────────────────

describe('판정 값', () => {
  it('「애매」는 판정 안 함이지 통과가 아니다', () => {
    // 평균에 넣으면 위반율이 조용히 낮아진다 (결정 29 와 같은 취급).
    expect(targetScore({ 과녁: '애매' })).toBeNull()
    expect(giveawayScore({ 답누출: '애매' })).toBeNull()
  })

  it('성공과 실패는 1 과 0 이다', () => {
    expect(targetScore({ 과녁: '성공' })).toBe(1)
    expect(targetScore({ 과녁: '실패' })).toBe(0)
    expect(giveawayScore({ 답누출: '지킴' })).toBe(1)
    expect(giveawayScore({ 답누출: '위반' })).toBe(0)
  })
})

// ── 2. 읽는 자리에서 터진다 ───────────────────────────────────────────────

describe('항목 만들기', () => {
  it('목록 밖 값은 읽는 자리에서 터진다', () => {
    // 오타를 조용히 통과시키면 그 줄이 어느 쪽으로 세어졌는지 나중에 못 찾는다.
    const 깨진것 = 자료({ 사람판정: [{ 대사: '…', 과녁: '맞음', 답누출: '지킴' }] })

    expect(() => makeGuidanceItem(깨진것, '시험')).toThrow(GuidanceGoldensetError)
    expect(() => makeGuidanceItem(깨진것, '시험')).toThrow(/과녁 값이/)
  })

  it('답누출도 목록 밖이면 터진다', () => {
    const 깨진것 = 자료({ 사람판정: [{ 대사: '…', 과녁: '성공', 답누출: '샜음' }] })

    expect(() => makeGuidanceItem(깨진것, '시험')).toThrow(/답누출 값이/)
  })

  it('재료 묶음이 빠지면 터진다', () => {
    const 깨진것 = 자료()
    delete (깨진것.재료 as Record<string, unknown>).direction

    expect(() => makeGuidanceItem(깨진것, '시험')).toThrow(/direction/)
  })

  it('채점 칸이 빠지면 터진다', () => {
    // 과녁이 없으면 잴 것이 없다. 줄이 있는데 과녁이 없는 상태를 만들지 않는다.
    const 깨진것 = 자료({ 채점: { guidance_target: 'PERSPECTIVE' } })

    expect(() => makeGuidanceItem(깨진것, '시험')).toThrow(/element_criterion/)
  })

  it('재료 안쪽은 손대지 않고 그대로 들고 간다', () => {
    // `runner.캐릭터_재료()` 의 묶음이고 키 이름도 그대로다 — 옮겨 담다 어긋나지 않게.
    const 한개 = 항목()

    expect(Object.keys(한개.재료).sort()).toEqual(
      ['character', 'direction', 'latest', 'said_so_far', 'scene', 'story_so_far'].sort(),
    )
    expect(remainingWorry(한개)).toBe(걱정)
    expect(childUtterance(한개)).toBe('몰라요')
    expect(responseMode(한개)).toBe('GUIDED')
  })

  it('채점 두 칸을 항목 위로 끌어올린다', () => {
    const 한개 = 항목()

    expect(한개.guidance_target).toBe('PERSPECTIVE')
    expect(한개.element_criterion).toBe(기준_문장)
  })

  it('검수 칸이 없으면 초안이다', () => {
    const 없는것 = 자료()
    delete 없는것.검수

    expect(makeGuidanceItem(없는것, '시험').검수).toBe('초안')
    expect(isGuidanceReviewed(makeGuidanceItem(없는것, '시험'))).toBe(false)
    expect(isGuidanceReviewed(makeGuidanceItem(자료({ 검수: '검수완료' }), '시험'))).toBe(true)
  })

  it('사람이 아직 안 본 대사만 골라 준다', () => {
    // 인터뷰가 물을 것들이다. 이미 매긴 대사를 두 번 묻지 않는다.
    const 한개 = makeGuidanceItem(
      자료({
        사람판정: [{ 대사: '가', 과녁: '성공', 답누출: '지킴' }],
        판정대기: [{ 대사: '가' }, { 대사: '나' }],
      }),
      '시험',
    )

    expect(unjudgedLines(한개)).toEqual(['나'])
  })
})

// ── 3. 읽기 ───────────────────────────────────────────────────────────────

describe('parseGuidanceGoldenset', () => {
  it('여러 줄이 차례대로 항목이 된다', () => {
    const 글 = [줄(), 줄({ id: 'gd_banggui_05_PERSPECTIVE_002' })].join('\n') + '\n'

    const 항목들 = parseGuidanceGoldenset(글, '유도.jsonl')

    expect(항목들.map((항) => 항.id)).toEqual([
      'gd_banggui_05_PERSPECTIVE_001',
      'gd_banggui_05_PERSPECTIVE_002',
    ])
    expect(항목들[0].guidance_target).toBe('PERSPECTIVE')
    expect(remainingWorry(항목들[0])).toBe(걱정)
  })

  it('머리말(`//`)과 빈 줄을 건너뛰고 줄 번호는 원래 번호다', () => {
    const 글 = ['// 머리말', '', 줄({ 채점: { guidance_target: 'PERSPECTIVE' } })].join('\n')

    expect(parseGuidanceGoldenset('// 머리말\n\n' + 줄(), '유도.jsonl')).toHaveLength(1)
    // 3번째 줄이 깨졌다는 것이 메시지에 보여야 사람이 고칠 수 있다.
    expect(() => parseGuidanceGoldenset(글, '유도.jsonl')).toThrow(/유도\.jsonl:3/)
  })

  it('JSON 이 아니면 줄 번호와 함께 터진다', () => {
    expect(() => parseGuidanceGoldenset('{어쩌고', '유도.jsonl')).toThrow(
      /유도\.jsonl:1 — JSON 이 아니다/,
    )
  })

  it('검수완료만 을 켜면 초안이 빠진다', () => {
    const 글 = [줄(), 줄({ id: 'gd_2', 검수: '검수완료' })].join('\n')

    expect(parseGuidanceGoldenset(글, '유도.jsonl')).toHaveLength(2)
    expect(parseGuidanceGoldenset(글, '유도.jsonl', { 검수완료만: true }).map((항) => 항.id)).toEqual(
      ['gd_2'],
    )
  })
})

// ── 4. 대조 — **심판을 재는 숫자다** ──────────────────────────────────────

/** 파이썬 시험의 `_대기_붙인_자료()`. 같은 대사에 사람 판정과 심판 판정을 나란히 붙인다. */
function 대기_붙인_줄(
  대사: string,
  심판_과녁: string,
  심판_답누출: string,
  사람: { 과녁: string; 답누출: string } = { 과녁: '성공', 답누출: '지킴' },
): string {
  return 줄({
    판정대기: [
      {
        대사,
        심판_과녁,
        심판_답누출,
        돌린날: '2026-08-13',
        프롬프트_지문: 'abc123',
      },
    ],
    사람판정: [
      { 대사, 과녁: 사람.과녁, 답누출: 사람.답누출, 근거: '', 매긴날: '2026-08-13' },
    ],
  })
}

describe('judgeAgreement', () => {
  const 대사 = '흥, 이 일로 낯을 못 들게 된 사람이 나 하나뿐이지 무어냐!'

  it('사람과 심판의 낱말이 달라도 같은 뜻이면 맞음이다', () => {
    // 과녁 축만 낱말이 갈렸다 — 사람은 성공/실패, 심판은 적중/빗나감이다.
    const 맞은것 = parseGuidanceGoldenset(대기_붙인_줄(대사, '적중', '지킴'), '유도.jsonl')

    const 결 = judgeAgreement(맞은것)
    expect(결).toMatchObject({ 맞음: 1, 틀림: 0, 못셈: 0 })
    expect(accuracy(결)).toBe(1)
  })

  it('갈리면 틀림으로 세고 어느 줄인지 남긴다', () => {
    const 어긋난것 = parseGuidanceGoldenset(대기_붙인_줄(대사, '빗나감', '지킴'), '유도.jsonl')

    const 결 = judgeAgreement(어긋난것)
    expect(결).toMatchObject({ 맞음: 0, 틀림: 1, 못셈: 0 })
    expect(accuracy(결)).toBe(0)
    expect(결.어긋난것[0]).toContain('사람=성공 심판=빗나감')
    expect(결.어긋난것[0]).toContain('gd_banggui_05_PERSPECTIVE_001')
  })

  it('답누출 축은 낱말이 그대로다', () => {
    const 글 = 대기_붙인_줄(대사, '적중', '위반', { 과녁: '성공', 답누출: '위반' })

    const 결 = judgeAgreement(parseGuidanceGoldenset(글, '유도.jsonl'), { 축: '답누출' })
    expect(결).toMatchObject({ 맞음: 1, 틀림: 0, 못셈: 0 })
  })

  it('사람이 「애매」로 둔 것은 분모에서 뺀다', () => {
    // 통과가 아니라 **판정하지 않았다**는 뜻이다 (결정 29).
    const 글 = 대기_붙인_줄(대사, '적중', '지킴', { 과녁: '애매', 답누출: '지킴' })

    const 결 = judgeAgreement(parseGuidanceGoldenset(글, '유도.jsonl'))
    expect(결).toMatchObject({ 맞음: 0, 틀림: 0, 못셈: 1 })
    expect(accuracy(결)).toBeNull()
  })

  it('심판이 「판정불가」를 낸 것도 분모에서 뺀다', () => {
    const 글 = 대기_붙인_줄(대사, '판정불가', '지킴')

    expect(judgeAgreement(parseGuidanceGoldenset(글, '유도.jsonl'))).toMatchObject({
      맞음: 0,
      틀림: 0,
      못셈: 1,
    })
  })

  it('심판을 안 돌린 대사는 아예 안 센다', () => {
    // 판정대기에 없는 대사다. 「모르겠다」로도 세지 않는다 — 물음 자체가 없다.
    const 글 = 줄({
      사람판정: [{ 대사: '아무도 안 잰 말', 과녁: '성공', 답누출: '지킴' }],
      판정대기: [{ 대사: 대사, 심판_과녁: '적중', 심판_답누출: '지킴' }],
    })

    expect(judgeAgreement(parseGuidanceGoldenset(글, '유도.jsonl'))).toMatchObject({
      맞음: 0,
      틀림: 0,
      못셈: 0,
    })
  })

  it('분모가 0 이면 정확도는 null 이다', () => {
    // 0% 가 아니다. 「아직 못 잰다」와 「빵점이다」를 섞지 않는다.
    expect(accuracy({ 맞음: 0, 틀림: 0 })).toBeNull()
  })
})

// ── 5. 정답지 파일 ────────────────────────────────────────────────────────

describe('goldenset/유도/검수전.jsonl', () => {
  const 경로 = path.join(PROJECT_ROOT, 'goldenset', '유도', '검수전.jsonl')
  const 항목들 = parseGuidanceGoldenset(readFileSync(경로, 'utf-8'), 경로)

  it('7건이 오류 없이 읽힌다', () => {
    // 형식이 어긋나면 여기서 터진다.
    expect(항목들).toHaveLength(7)
    for (const 항목 of 항목들) {
      expect(항목.guidance_target, `${항목.id} 에 과녁이 없다`).toBeTruthy()
      expect(항목.element_criterion, `${항목.id} 에 기준 문장이 없다`).toBeTruthy()
      expect(remainingWorry(항목), `${항목.id} 에 걱정 문장이 없다`).toBeTruthy()
    }
  })

  it('id 가 겹치지 않는다', () => {
    // 이어 붙이는 파일이라 번호가 겹치면 나중에 어느 판 것인지 못 가른다.
    const 아이디들 = 항목들.map((항목) => 항목.id)
    expect(new Set(아이디들).size).toBe(아이디들.length)
  })

  it('네 요소를 덮는다', () => {
    // PERSPECTIVE 에서만 막혀 있던 그전 상태로 돌아가지 않게 (`--과녁` 으로 갈라 재는 자리다).
    expect(new Set(항목들.map((항목) => 항목.guidance_target))).toEqual(
      new Set(['PERSPECTIVE', 'EMPATHY', 'REQUEST']),
    )
  })

  it('사람 판정이 붙은 대사는 심판도 돌린 대사다', () => {
    // 대조의 분모가 되는 자리다. 여기가 비면 심판을 잴 수 없다.
    const 결 = judgeAgreement(항목들)
    expect(결.맞음 + 결.틀림 + 결.못셈).toBe(
      항목들.reduce((합, 항목) => 합 + 항목.사람판정들.length, 0),
    )
  })
})
