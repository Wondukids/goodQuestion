// 말하기 후 활동 · 단어 판정 엔진 (이슈 #44 · `src/post-activity/`) — 판정 3단을 그대로 잰다.
//
// 명세 9절의 **수용 기준 6·7·8·9·10** 이 이 파일의 뼈대다.
//
//   6. 「시집」을 「시집와서」로 말하면 `used` · `rule` (LLM 을 안 부른다)
//   7. 🔴 「참다」를 「참새를 봤어요」로만 말하면 `used` 가 되지 않는다 (F14 — 두 글자 바닥)
//   8. 「참다」를 「꾹 눌렀어요」로 말하면 `similar` · `llm` · `evidence` 가 원문 안에 있다
//   9. LLM 이 원문에 없는 `evidence` 를 내면 그 단어는 `missing`
//  10. LLM 을 죽여 놓고 돌려도 **던지지 않는다** — 「판정 못 했다」가 값으로 나온다
//
// 🔴 **7번이 이 파일에서 제일 중요한 줄이다.** 리포트의 낱말 대조기는 「~다」로 끝나는 낱말의
//    어간을 떼어 찾는데 두 글자 낱말은 어간이 **한 글자**가 된다 (「참다」→「참」).
//    한 글자는 「참새」·「참 재밌었어요」에도 걸려서, 아이가 방귀를 참은 이야기를 한 마디도
//    안 했는데 보호자 화면에 「이 단어를 썼어요」가 뜬다.
//
// ⛔ **진짜 API 를 치지 않는다.** `call` 을 바꿔치기해 네트워크 없이 판정 규칙만 본다 —
//    `tests/report-narrative.test.ts` 가 `ReportCall` 로 하는 것과 같은 방식이다.
//    검사에서 진짜로 부르면 돈이 나가고 답이 회차마다 흔들린다.
//
// ⛔ DB 도 안 쓴다. 이 도메인은 **넣을 값을 돌려줄 뿐**이고 저장은 이슈 #45 다.
//
// 단어 12개는 **시드의 진짜 값**(`후활동_config`)을 쓴다. 검사가 자기 단어를 지어내면
// 「참다」의 두 글자 바닥처럼 **실제 값에서만 나는 사고**를 못 잡는다.

import { describe, expect, it } from 'vitest'

import { 후활동_config } from '@/llm/db/seed'
import { read } from '@/llm/prompts'
import type { LLMResult } from '@/llm/provider'
import {
  judgeRetellingKeywords,
  단어_세기,
  단어판정_용도,
  단어판정_프롬프트,
  줄거리_뼈대,
  판정_버전,
  후활동_낱말_후보들,
  후활동_조각_바닥,
  type RetellingCall,
  type 단어판정,
  type 후활동이야기,
} from '@/post-activity'
import { 낱말_후보들 } from '@/report/engine'

// ── 재료 ───────────────────────────────────────────────────────────────────

const 카드들 = 후활동_config.cards

const 이야기: 후활동이야기 = {
  title: '방귀 뀌는 며느리',
  summary: '큰 방귀를 부끄러워하던 며느리가 자신의 다름을 장점으로 바꾸는 이야기',
}

/** `buildRetellingKeywordsMaterial()` 이 만드는 모양. 열쇠 넷이 프롬프트와의 계약이다. */
interface 재료모양 {
  story: { title: string; summary: string }
  cards: { id: string; title: string }[]
  words: { card_id: string; word: string }[]
  retelling: string
}

interface 부른기록 {
  system: string
  재료: 재료모양
  purpose: string
}

function 가짜_결과(글: string): LLMResult {
  return { text: 글, provider: 'gemini', model: '가짜', attempts: [] }
}

/**
 * 가짜 LLM 하나. 무엇이 나갔는지 그대로 들고 있는다.
 *
 * `대답` 이 던지면 그 예외가 그대로 호출 자리에서 난다 — 「LLM 이 죽었다」를 그렇게 만든다.
 */
function 가짜LLM(대답: (재료: 재료모양) => string): {
  call: RetellingCall
  부른것: 부른기록[]
} {
  const 부른것: 부른기록[] = []
  const call: RetellingCall = async (system, user, options) => {
    const 재료 = JSON.parse(user) as 재료모양
    부른것.push({ system, 재료, purpose: options.purpose })
    return 가짜_결과(대답(재료))
  }
  return { call, 부른것 }
}

/**
 * 물어본 단어를 **하나도 빼지 않고** 답한다 (`[W-ALL]`). `참인것` 에 적은 단어만 `similar`.
 *
 * ⚠️ 안 쓴 단어의 `evidence` 는 **빈 문자열**로 온다 — 프롬프트가 그렇게 약속돼 있고,
 *    NULL 로 옮기는 것은 엔진의 일이다 (`해설.md` 「이 갈래가 정한 것」 · 명세 4.3).
 */
function 성실한_답(재료: 재료모양, 참인것: Record<string, string> = {}): string {
  return JSON.stringify({
    words: 재료.words.map(({ word }) => ({
      word,
      similar: word in 참인것,
      evidence: 참인것[word] ?? '',
    })),
  })
}

/** 판정 결과에서 단어 하나를 집는다. */
function 집기(판정들: readonly 단어판정[] | null, 단어: string): 단어판정 {
  const 것 = (판정들 ?? []).find((행) => 행.word === 단어)
  expect(것, `«${단어}» 행이 없다`).toBeDefined()
  return 것 as 단어판정
}

/** 아이가 열두 단어를 **글자 그대로** 다 말한 줄거리. ①만으로 끝나는 유일한 길이다. */
const 다_말한_줄거리 =
  '시집 온 며느리가 방귀를 참다가 걱정했어요. 사람들이 깜짝 놀라 기둥을 잡았고, ' +
  '배나무에서 힘껏 뀌니 배가 우수수 떨어졌어요. 며느리는 당당하게 칭찬을 듣고 고마워했어요.'

// ── ① 규칙이 글자로 찾는다 ────────────────────────────────────────────────

describe('① 규칙 — 글자로 찾히면 LLM 을 안 부른다', () => {
  it('수용 6. 「시집」을 「시집와서」로 말하면 used · rule 이고, 그 단어는 LLM 에 안 간다', async () => {
    const 줄거리 = '며느리가 시집와서 참새를 봤어요.'
    const { call, 부른것 } = 가짜LLM((재료) => 성실한_답(재료))

    const 결과 = await judgeRetellingKeywords({ story: 이야기, cards: 카드들, retelling: 줄거리, call })

    const 시집 = 집기(결과.words, '시집')
    expect(시집.status).toBe('used')
    expect(시집.decided_by).toBe('rule')
    expect(시집.card_id).toBe('endure')

    // 🔴 「LLM 호출 없이」가 수용 기준의 절반이다 — 재료의 판정 목록에 없어야 한다.
    expect(부른것[0].재료.words.map((것) => 것.word)).not.toContain('시집')
  })

  it('활동 한 건에 LLM 호출은 한 번뿐이다 (명세 6.3) — 단어마다 부르지 않는다', async () => {
    const { call, 부른것 } = 가짜LLM((재료) => 성실한_답(재료))

    await judgeRetellingKeywords({
      story: 이야기,
      cards: 카드들,
      retelling: '며느리가 시집와서 살았어요.',
      call,
    })

    expect(부른것).toHaveLength(1)
    expect(부른것[0].재료.words.length).toBeGreaterThan(1)
  })

  it('①이 열둘을 다 끝내면 LLM 을 아예 안 부른다', async () => {
    const { call, 부른것 } = 가짜LLM(() => {
      throw new Error('부르면 안 된다')
    })

    const 결과 = await judgeRetellingKeywords({
      story: 이야기,
      cards: 카드들,
      retelling: 다_말한_줄거리,
      call,
    })

    expect(부른것).toHaveLength(0)
    expect(결과.analyzed).toBe(true)
    expect(결과.llm).toBeNull()
    expect(단어_세기(결과.words ?? [])).toEqual({ used: 12, similar: 0, missing: 0 })
  })

  it('보내는 재료는 열쇠 넷이고, 카드에는 keywords 를 안 싣는다', async () => {
    const { call, 부른것 } = 가짜LLM((재료) => 성실한_답(재료))

    await judgeRetellingKeywords({
      story: 이야기,
      cards: 카드들,
      retelling: '몰라요.',
      call,
    })

    const 재료 = 부른것[0].재료
    expect(Object.keys(재료).sort()).toEqual(['cards', 'retelling', 'story', 'words'])
    expect(재료.story).toEqual(이야기)
    expect(재료.retelling).toBe('몰라요.')
    // 카드는 제목만 — 판정할 단어는 `words` 가 나른다 (①이 끝낸 단어가 새어 들어가면 안 된다)
    expect(재료.cards).toEqual(카드들.map((카드) => ({ id: 카드.id, title: 카드.title })))
    expect(재료.words).toHaveLength(12)
  })

  it('정본 프롬프트가 system 으로 나가고 purpose 가 붙는다', async () => {
    const { call, 부른것 } = 가짜LLM((재료) => 성실한_답(재료))

    await judgeRetellingKeywords({ story: 이야기, cards: 카드들, retelling: '몰라요.', call })

    expect(부른것[0].system).toBe(read(단어판정_프롬프트))
    expect(부른것[0].purpose).toBe(단어판정_용도)
  })
})

// ── 🔴 두 글자 바닥 (F14) ──────────────────────────────────────────────────

describe('🔴 두 글자 바닥 (결정 F14) — 한 글자 조각을 쓰지 않는다', () => {
  it('「참다」의 조각에서 한 글자 「참」이 빠진다 — ⛔ 리포트 쪽 함수는 그대로다', () => {
    expect(후활동_조각_바닥).toBe(2)
    // 리포트의 낱말 세기는 지금 동작이 맞다 — 고치지 않았다는 것을 여기서 못박는다
    expect(낱말_후보들('참다')).toContain('참')
    expect(후활동_낱말_후보들('참다')).not.toContain('참')
    expect(후활동_낱말_후보들('참다')).toEqual(['참다'])
  })

  it('수용 7. 「참다」를 「참새를 봤어요」로만 말하면 used 가 되지 않는다', async () => {
    const 줄거리 = '며느리가 참새를 봤어요. 참 재밌었어요.'
    const { call, 부른것 } = 가짜LLM((재료) => 성실한_답(재료))

    const 결과 = await judgeRetellingKeywords({ story: 이야기, cards: 카드들, retelling: 줄거리, call })

    const 참다 = 집기(결과.words, '참다')
    expect(참다.status).not.toBe('used')
    expect(참다.status).toBe('missing')
    expect(참다.decided_by).toBe('llm')
    // 규칙이 끝내지 못했으므로 LLM 이 보긴 봤다 — 「안 물어봐서 missing」이 아니다
    expect(부른것[0].재료.words.map((것) => 것.word)).toContain('참다')
  })

  it('두 글자 낱말도 글자 그대로 말하면 ①이 잡는다 — 바닥이 판정을 막지는 않는다', async () => {
    const { call } = 가짜LLM((재료) => 성실한_답(재료))

    const 결과 = await judgeRetellingKeywords({
      story: 이야기,
      cards: 카드들,
      retelling: '며느리가 방귀를 참다가 뀌었어요.',
      call,
    })

    expect(집기(결과.words, '참다').status).toBe('used')
    expect(집기(결과.words, '참다').decided_by).toBe('rule')
  })
})

// ── ②③ LLM 과 근거 대조 ──────────────────────────────────────────────────

describe('②③ 비슷한 말과 근거 대조', () => {
  const 줄거리 = '며느리가 방귀를 꾹 눌렀어요.'

  it('수용 8. 「꾹 눌렀어요」로 말하면 similar · llm · evidence 가 원문 안에 있다', async () => {
    const { call } = 가짜LLM((재료) => 성실한_답(재료, { 참다: '꾹 눌렀어요' }))

    const 결과 = await judgeRetellingKeywords({ story: 이야기, cards: 카드들, retelling: 줄거리, call })

    const 참다 = 집기(결과.words, '참다')
    expect(참다.status).toBe('similar')
    expect(참다.decided_by).toBe('llm')
    expect(참다.evidence).toBe('꾹 눌렀어요')
    // 🔴 「원문 안에 실제로 있는 조각」까지가 수용 기준이다
    expect(줄거리_뼈대(줄거리)).toContain(줄거리_뼈대(참다.evidence ?? ''))
    expect(결과.dropped.evidence).toHaveLength(0)
  })

  it('수용 9. 원문에 없는 evidence 를 내면 그 단어는 missing 이 되고 근거는 NULL 이다', async () => {
    const { call } = 가짜LLM((재료) => 성실한_답(재료, { 참다: '방귀를 참았어요' }))

    const 결과 = await judgeRetellingKeywords({ story: 이야기, cards: 카드들, retelling: 줄거리, call })

    const 참다 = 집기(결과.words, '참다')
    expect(참다.status).toBe('missing')
    expect(참다.evidence).toBeNull()
    // ⚠️ 버린 것이 조용하면 프롬프트가 새고 있어도 아무도 모른다
    expect(결과.dropped.evidence).toEqual(['참다'])
  })

  it('문장부호와 띄어쓰기가 달라도 근거는 살아남는다 — 맞는 판정이 쉼표 하나로 버려지면 안 된다', async () => {
    const { call } = 가짜LLM((재료) => 성실한_답(재료, { 참다: '방귀를,꾹  눌렀어요!' }))

    const 결과 = await judgeRetellingKeywords({ story: 이야기, cards: 카드들, retelling: 줄거리, call })

    expect(집기(결과.words, '참다').status).toBe('similar')
  })

  it('빈 문자열 evidence 는 NULL 로 간다 (명세 4.3 — missing 이면 인용할 말이 없다)', async () => {
    const { call } = 가짜LLM((재료) => 성실한_답(재료))

    const 결과 = await judgeRetellingKeywords({ story: 이야기, cards: 카드들, retelling: 줄거리, call })

    for (const 행 of 결과.words ?? []) {
      if (행.status === 'missing') expect(행.evidence).toBeNull()
    }
    expect(집기(결과.words, '걱정').evidence).toBeNull()
  })

  it('similar 가 참인데 evidence 가 비어 오면 버린다 — 근거 없는 판정은 안 받는다', async () => {
    const { call } = 가짜LLM((재료) =>
      JSON.stringify({
        words: 재료.words.map(({ word }) => ({
          word,
          similar: word === '참다',
          evidence: '',
        })),
      }),
    )

    const 결과 = await judgeRetellingKeywords({ story: 이야기, cards: 카드들, retelling: 줄거리, call })

    expect(집기(결과.words, '참다').status).toBe('missing')
    expect(결과.dropped.evidence).toEqual(['참다'])
  })

  it('답이 안 온 단어는 missing 으로 남고 장부에 적힌다', async () => {
    const { call } = 가짜LLM((재료) =>
      JSON.stringify({
        words: 재료.words
          .filter(({ word }) => word !== '걱정')
          .map(({ word }) => ({ word, similar: false, evidence: '' })),
      }),
    )

    const 결과 = await judgeRetellingKeywords({ story: 이야기, cards: 카드들, retelling: 줄거리, call })

    expect(집기(결과.words, '걱정').status).toBe('missing')
    expect(결과.dropped.unanswered).toEqual(['걱정'])
  })

  it('물어보지 않은 단어를 보태 오면 버린다 — ①이 낸 판정을 덮지 못한다', async () => {
    const { call } = 가짜LLM((재료) =>
      JSON.stringify({
        words: [
          ...재료.words.map(({ word }) => ({ word, similar: false, evidence: '' })),
          { word: '방귀', similar: true, evidence: '방귀를 꾹 눌렀어요' },
          { word: '없는말', similar: true, evidence: '며느리가' },
        ],
      }),
    )

    const 결과 = await judgeRetellingKeywords({ story: 이야기, cards: 카드들, retelling: 줄거리, call })

    // 「방귀」는 ①이 이미 글자로 찾았다. LLM 이 뭐라 하든 rule 판정이 남는다
    expect(집기(결과.words, '방귀').decided_by).toBe('rule')
    expect(집기(결과.words, '방귀').status).toBe('used')
    expect((결과.words ?? []).some((행) => 행.word === '없는말')).toBe(false)
    expect(결과.dropped.unasked).toEqual(['방귀', '없는말'])
  })
})

// ── 12행 ──────────────────────────────────────────────────────────────────

describe('판정한 단어는 12개 전부 행이 된다 (명세 4.3)', () => {
  it('missing 도 행으로 남고, 차례는 카드 순서 그대로다', async () => {
    const { call } = 가짜LLM((재료) => 성실한_답(재료, { 참다: '꾹 눌렀어요' }))

    const 결과 = await judgeRetellingKeywords({
      story: 이야기,
      cards: 카드들,
      retelling: '며느리가 방귀를 꾹 눌렀어요.',
      call,
    })

    const 기대차례 = 카드들.flatMap((카드) =>
      카드.keywords.map((단어) => ({ card_id: 카드.id, word: 단어 })),
    )
    expect((결과.words ?? []).map((행) => ({ card_id: 행.card_id, word: 행.word }))).toEqual(기대차례)

    const 셈 = 단어_세기(결과.words ?? [])
    expect(셈.used + 셈.similar + 셈.missing).toBe(12)
    expect(결과.analyzed).toBe(true)
    expect(결과.version).toBe(판정_버전)
  })

  it('한 단어도 못 찾으면 12행이 전부 missing 이다 — 「판정을 못 했다」와 다르다', async () => {
    const { call } = 가짜LLM((재료) => 성실한_답(재료))

    const 결과 = await judgeRetellingKeywords({
      story: 이야기,
      cards: 카드들,
      retelling: '음... 잘 모르겠어요.',
      call,
    })

    expect(결과.analyzed).toBe(true)
    expect(단어_세기(결과.words ?? [])).toEqual({ used: 0, similar: 0, missing: 12 })
  })
})

// ── 🔴 판정 실패는 오류가 아니다 (수용 10) ────────────────────────────────

describe('🔴 수용 10. LLM 이 죽어도 던지지 않는다 (결정 F4·F8)', () => {
  it('호출이 터지면 analyzed=false · words=null 로 나온다', async () => {
    const call: RetellingCall = async () => {
      throw new Error('공급자가 다 죽었다')
    }

    const 결과 = await judgeRetellingKeywords({
      story: 이야기,
      cards: 카드들,
      retelling: '며느리가 방귀를 꾹 눌렀어요.',
      call,
    })

    expect(결과.analyzed).toBe(false)
    expect(결과.words).toBeNull()
    expect(결과.failed).toContain('공급자가 다 죽었다')
  })

  it('JSON 이 아닌 답도 「판정 못 했다」다 — 반만 판정한 행을 남기지 않는다', async () => {
    const { call } = 가짜LLM(() => '음 잘 모르겠어요')

    const 결과 = await judgeRetellingKeywords({
      story: 이야기,
      cards: 카드들,
      retelling: '며느리가 시집와서 방귀를 꾹 눌렀어요.',
      call,
    })

    expect(결과.analyzed).toBe(false)
    expect(결과.words).toBeNull()
    expect(결과.failed).toContain('JSON')
    // ①이 「시집」·「방귀」를 찾아 뒀지만 그것만 저장하면 화면이 나머지를 「안 나왔어요」로 읽는다
  })

  it('규격에 안 맞는 답도 마찬가지다 — 어느 공급자가 답했는지는 남긴다', async () => {
    const { call } = 가짜LLM(() => JSON.stringify({ words: [{ word: '참다', similar: '네' }] }))

    const 결과 = await judgeRetellingKeywords({
      story: 이야기,
      cards: 카드들,
      retelling: '며느리가 방귀를 꾹 눌렀어요.',
      call,
    })

    expect(결과.analyzed).toBe(false)
    expect(결과.words).toBeNull()
    expect(결과.failed).toContain('규격')
    expect(결과.llm?.model).toBe('가짜')
  })

  it('본문을 직접 주면 파일 대신 그것이 나간다 (`chooseBody`) — 카드 구성도 DB 값을 따른다', async () => {
    const { call, 부른것 } = 가짜LLM((재료) => 성실한_답(재료, { 참다: '꾹 눌렀어요' }))

    const 결과 = await judgeRetellingKeywords({
      story: 이야기,
      cards: [{ id: 'endure', title: '참는 며느리', keywords: ['참다'] }],
      retelling: '며느리가 꾹 눌렀어요.',
      prompt: '시험용 본문',
      call,
    })

    expect(부른것[0].system).toBe('시험용 본문')
    // 카드·단어는 `post_activity_config` 가 정본이라 12개가 아닌 판도 그대로 돈다 (F1)
    expect(결과.words).toHaveLength(1)
    expect(집기(결과.words, '참다').status).toBe('similar')
  })
})
