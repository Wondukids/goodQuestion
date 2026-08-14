// 단가표와 LLM 시도 화면 (이슈 #26 E-3 · C-2 · C-3 · C-4).
//
// 파이썬 `tests/test_config.py` 의 단가표 갈래와 `routes/runs.py:시도_보기()` 가
// 하던 일을 옮긴 것이다. **이 파일이 지키는 것은 셋이다.**
//
// 1. **구간제 단가가 날짜로 갈린다** — 적용 시작일 **당일부터** 그 단가이고,
//    첫 구간보다 이른 회차는 「모름」이다. 그래야 지난 회차를 그때 단가로 되짚는다.
// 2. 🔴 **모르는 모델은 0 이 아니라 「모름」이다.** 「안 썼다」와 「모른다」가 한 값이 되면
//    예산 판단(gpt-nano 가 정말 싼가)이 조용히 틀어진다.
// 3. ⭐ **고른 모델과 실제 응답 모델이 다르면 화면이 굵게 드러낸다.**
//    `CLAUDE.md` 「로그」 절의 「fallback 이 돌았는지 눈으로 봐야 한다」가 이 자리다.
//
// ## 화면을 어떻게 재나
//
// `page.tsx` 의 기본 export 는 `connection()` 을 부르는데 그건 Next 요청 문맥 밖에서
// 터진다(실제로 확인했다). 그래서 **그 쪽이 그리는 조각**(`turns/[message_id]/ui.tsx` 의
// `시도표`)을 `renderToStaticMarkup` 으로 그려 마크업을 본다. 페이지는 그 조각을 부르는
// 얇은 껍데기다.

import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { sql } from 'drizzle-orm'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { characters, llm_calls, messages, runs, stories, story_scenes, story_sessions } from '@/db/schema'
import {
  단가표_읽기,
  단가표_해석,
  단가표_형식_오류,
  비용_계산,
  적용_단가,
  빈_단가표,
  type 단가표,
} from '@/lib/config'
import { closeDb, getDb, type Conn } from '@/lib/repo/db'
import { turnAttempts, type AttemptView, type TurnAttemptsView } from '@/lib/service/view'

import { 금액, 시도표 } from '@/app/(admin)/runs/[run_id]/turns/[message_id]/ui'

// ── 임시 단가표 파일 ───────────────────────────────────────────────────────

const 임시폴더 = mkdtempSync(path.join(tmpdir(), 'gq-단가표-'))

/** 임시 단가표 파일 하나. 돌려주는 것은 그 경로다. */
function 단가표파일(내용: string, 이름 = `${randomUUID().slice(0, 8)}.toml`): string {
  const 자리 = path.join(임시폴더, 이름)
  writeFileSync(자리, 내용, 'utf8')
  return 자리
}

/**
 * 구간이 둘인 표. 뒤 구간을 **파일에서 먼저** 적었다 — 읽으면서 시작일 순으로
 * 정렬하는지도 같이 본다.
 */
const 두구간 = `
"통화" = "USD"
"단위" = "백만토큰당"

[["모델"."gemini-3.5-flash-lite"]]
"적용_시작일" = 2026-09-01
"입력_단가" = 0.60
"출력_단가" = 5.00

[["모델"."gemini-3.5-flash-lite"]]
"적용_시작일" = 2026-08-01
"입력_단가" = 0.30
"출력_단가" = 2.50
`

const 원래_경로 = process.env.GQ_PRICING_FILE

beforeEach(() => {
  if (원래_경로 === undefined) delete process.env.GQ_PRICING_FILE
  else process.env.GQ_PRICING_FILE = 원래_경로
})

afterAll(async () => {
  rmSync(임시폴더, { recursive: true, force: true })
  await closeDb()
})

// ═══════════════════════════════════════════════════════════════════════════
// C-4 · 단가표 — 파일 읽기
// ═══════════════════════════════════════════════════════════════════════════

describe('단가표_읽기 — web/단가표.toml 을 그대로 읽는다', () => {
  it('따옴표 붙은 점 표기 배열 테이블과 TOML 날짜를 읽는다', () => {
    const 표 = 단가표_읽기()
    expect(표.통화).toBe('USD')
    expect(표.단위).toBe('백만토큰당')
    // 사람이 공급자 가격표에서 옮겨 적은 값 (2026-08-12). 지어낸 숫자가 아니다.
    expect(표.모델별.get('gemini-3.5-flash-lite')).toEqual([
      { 적용_시작일: '2026-08-01', 입력_단가: 0.3, 출력_단가: 2.5 },
    ])
    expect(표.모델별.get('claude-sonnet-5')).toEqual([
      { 적용_시작일: '2026-08-01', 입력_단가: 2, 출력_단가: 10 },
    ])
  })

  it('GQ_PRICING_FILE 로 다른 파일을 읽는다 (파이썬과 같은 이름)', () => {
    process.env.GQ_PRICING_FILE = 단가표파일(두구간)
    const 표 = 단가표_읽기()
    expect(표.모델별.get('gemini-3.5-flash-lite')).toHaveLength(2)
  })

  it('파일이 없으면 빈 표다 — 죽지 않고 모든 비용이 「모름」이 된다', () => {
    process.env.GQ_PRICING_FILE = path.join(임시폴더, '없는파일.toml')
    const 표 = 단가표_읽기()
    expect(표.모델별.size).toBe(0)
    expect(비용_계산('gemini-3.5-flash-lite', 1000, 100, new Date('2026-08-13T00:00:00Z'), 표)).toBeNull()
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// C-4 ① 구간제 — 날짜로 갈린다
// ═══════════════════════════════════════════════════════════════════════════

describe('구간제 단가 — 적용 시작일 당일부터', () => {
  const 표 = (): 단가표 => 단가표_읽기(단가표파일(두구간, '두구간.toml'))

  it('읽으면서 시작일 순으로 정렬한다 (파일에는 뒤 구간이 먼저 적혀 있다)', () => {
    expect(표().모델별.get('gemini-3.5-flash-lite')?.map((구간) => 구간.적용_시작일)).toEqual([
      '2026-08-01',
      '2026-09-01',
    ])
  })

  it('시작일 하루 전은 앞 구간이다', () => {
    const 고른 = 적용_단가(표(), 'gemini-3.5-flash-lite', new Date('2026-08-31T23:59:59Z'))
    expect(고른?.적용_시작일).toBe('2026-08-01')
    // 백만 토큰 입력 = 그 구간의 입력 단가 그대로.
    expect(비용_계산('gemini-3.5-flash-lite', 1_000_000, 0, new Date('2026-08-31T23:59:59Z'), 표()))
      .toBeCloseTo(0.3, 10)
  })

  it('⭐ 시작일 **당일**부터 새 구간이다', () => {
    const 고른 = 적용_단가(표(), 'gemini-3.5-flash-lite', new Date('2026-09-01T00:00:00Z'))
    expect(고른?.적용_시작일).toBe('2026-09-01')
    expect(비용_계산('gemini-3.5-flash-lite', 1_000_000, 0, new Date('2026-09-01T00:00:00Z'), 표()))
      .toBeCloseTo(0.6, 10)
    // 출력 토큰도 그 구간 값으로 갈린다.
    expect(비용_계산('gemini-3.5-flash-lite', 0, 1_000_000, new Date('2026-09-02T12:00:00Z'), 표()))
      .toBeCloseTo(5, 10)
  })

  it('맨 처음 구간보다 이르면 0 이 아니라 「모름」이다', () => {
    expect(적용_단가(표(), 'gemini-3.5-flash-lite', new Date('2026-07-31T23:59:59Z'))).toBeNull()
    expect(비용_계산('gemini-3.5-flash-lite', 1_000_000, 1_000_000, new Date('2026-07-31T00:00:00Z'), 표()))
      .toBeNull()
  })

  it('시각은 UTC 로 옮겨 날짜를 뗀다 — 보는 사람 시간대로 금액이 흔들리지 않는다', () => {
    // KST 9월 1일 00:30 = UTC 8월 31일 15:30 → **앞 구간**이다.
    expect(비용_계산('gemini-3.5-flash-lite', 1_000_000, 0, new Date('2026-09-01T00:30:00+09:00'), 표()))
      .toBeCloseTo(0.3, 10)
  })

  it('단위가 바뀌면 나눗수가 바뀐다', () => {
    const 천토큰 = 단가표_해석({
      통화: 'USD',
      단위: '천토큰당',
      모델: { 'gemini-3.5-flash-lite': [{ 적용_시작일: new Date('2026-08-01T00:00:00Z'), 입력_단가: 0.3, 출력_단가: 2.5 }] },
    })
    expect(비용_계산('gemini-3.5-flash-lite', 1_000, 0, new Date('2026-08-13T00:00:00Z'), 천토큰))
      .toBeCloseTo(0.3, 10)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// C-4 ② 모르면 「모름」 — 0 으로 때우지 않는다
// ═══════════════════════════════════════════════════════════════════════════

describe('🔴 모르는 것은 0 이 아니라 null 이다', () => {
  const 표 = (): 단가표 => 단가표_읽기(단가표파일(두구간, '두구간.toml'))

  it('표에 없는 모델이면 null 이다 — 지어내지 않는다', () => {
    const 값 = 비용_계산('gpt-5-nano', 1_000_000, 1_000_000, new Date('2026-09-02T00:00:00Z'), 표())
    expect(값).toBeNull()
    expect(값).not.toBe(0)
  })

  it('토큰을 안 준 시도면 null 이다 (실패해서 안 남은 시도)', () => {
    const 시각 = new Date('2026-09-02T00:00:00Z')
    expect(비용_계산('gemini-3.5-flash-lite', null, 100, 시각, 표())).toBeNull()
    expect(비용_계산('gemini-3.5-flash-lite', 100, null, 시각, 표())).toBeNull()
    expect(비용_계산(null, 100, 100, 시각, 표())).toBeNull()
  })

  it('빈 표에서는 무엇을 물어도 null 이다', () => {
    expect(비용_계산('gemini-3.5-flash-lite', 100, 100, new Date('2026-09-02T00:00:00Z'), 빈_단가표()))
      .toBeNull()
  })

  it('화면 표기도 0 이 아니라 「모름」이다', () => {
    expect(금액(null, 'USD')).toBe('모름')
    expect(금액(0.004, 'USD')).toBe('0.004000 USD')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// C-4 · 모양이 틀린 표는 **죽인다** (조용히 0 이 되지 않게)
// ═══════════════════════════════════════════════════════════════════════════

describe('단가표_형식_오류 — 오타를 조용히 넘기지 않는다', () => {
  it('적용_시작일을 따옴표로 감싸면(글자면) 죽는다', () => {
    const 자리 = 단가표파일(`
"통화" = "USD"
"단위" = "백만토큰당"
[["모델"."gemini-3.5-flash-lite"]]
"적용_시작일" = "2026-08-01"
"입력_단가" = 0.30
"출력_단가" = 2.50
`)
    expect(() => 단가표_읽기(자리)).toThrow(단가표_형식_오류)
  })

  it('같은 모델에 같은 시작일이 두 번이면 죽는다', () => {
    const 자리 = 단가표파일(`
"통화" = "USD"
"단위" = "백만토큰당"
[["모델"."A"]]
"적용_시작일" = 2026-08-01
"입력_단가" = 1
"출력_단가" = 2
[["모델"."A"]]
"적용_시작일" = 2026-08-01
"입력_단가" = 3
"출력_단가" = 4
`)
    expect(() => 단가표_읽기(자리)).toThrow(/같은 적용 시작일이 두 번/)
  })

  it('모르는 칸이 있으면 죽는다 (오타난 칸이 조용히 무시되지 않는다)', () => {
    const 자리 = 단가표파일(`
"통화" = "USD"
"단위" = "백만토큰당"
[["모델"."A"]]
"적용_시작일" = 2026-08-01
"입력_단가" = 1
"출력_단가" = 2
"입력단가" = 9
`)
    expect(() => 단가표_읽기(자리)).toThrow(/모르는 칸/)
  })

  it('단가를 적었는데 통화·단위가 없으면 죽는다', () => {
    const 자리 = 단가표파일(`
[["모델"."A"]]
"적용_시작일" = 2026-08-01
"입력_단가" = 1
"출력_단가" = 2
`)
    expect(() => 단가표_읽기(자리)).toThrow(/통화/)
  })

  it('모르는 단위면 죽는다', () => {
    expect(() => 단가표_해석({ 통화: 'USD', 단위: '만토큰당', 모델: {} })).toThrow(/단위는/)
  })

  it('음수 단가는 죽는다', () => {
    expect(() =>
      단가표_해석({
        통화: 'USD',
        단위: '백만토큰당',
        모델: { A: [{ 적용_시작일: new Date('2026-08-01T00:00:00Z'), 입력_단가: -1, 출력_단가: 2 }] },
      }),
    ).toThrow(/음수/)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// C-2 ③ 화면 — 고른 모델과 실제 모델이 다르면 굵게
// ═══════════════════════════════════════════════════════════════════════════

/** `llm_calls` 한 행 + 화면 세 칸. 검사에서 손으로 짓는다. */
function 시도(고칠_것: Partial<AttemptView> = {}): AttemptView {
  return {
    id: randomUUID(),
    run_id: randomUUID(),
    message_id: randomUUID(),
    purpose: 'analysis',
    attempt_no: 1,
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    effort: 'medium',
    system_text: '시스템 프롬프트 원문',
    user_text: '사용자 입력 원문',
    response_text: '{"child_intent":"OPINION"}',
    input_tokens: 1000,
    output_tokens: 200,
    duration_ms: 1234,
    ok: true,
    error: null,
    created_at: new Date('2026-08-13T00:00:00Z'),
    selected_model: 'gemini-3.5-flash-lite',
    model_differs: false,
    cost: 0.0008,
    ...고칠_것,
  }
}

function 그린다(시도들: readonly AttemptView[], 고칠_것: Partial<TurnAttemptsView['totals']> = {}): string {
  const 값: TurnAttemptsView = {
    // `run` 은 표가 안 쓴다 — 화면 머리가 쓴다. 모양만 맞춘다.
    run: { id: randomUUID() } as TurnAttemptsView['run'],
    message_id: randomUUID(),
    attempts: [...시도들],
    totals: {
      attempt_count: 시도들.length,
      duration_ms: 시도들.reduce((합, 하나) => 합 + 하나.duration_ms, 0),
      input_tokens: 1000,
      output_tokens: 200,
      cost: 0.0008,
      통화: 'USD',
      ...고칠_것,
    },
  }
  return renderToStaticMarkup(createElement(시도표, { 시도들: 값 }))
}

describe('⭐ 시도표 — fallback 이 돌았는지 눈으로 보인다', () => {
  it('고른 모델과 실제 모델이 다르면 굵게 드러낸다', () => {
    const 마크업 = 그린다([
      시도({
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        selected_model: 'gemini-3.5-flash-lite',
        model_differs: true,
      }),
    ])
    expect(마크업).toContain('<strong>고른 모델 gemini-3.5-flash-lite과 다름</strong>')
    // 실제로 응답한 공급자·모델도 함께 보여야 한다 (`CLAUDE.md` 로그 절).
    expect(마크업).toContain('anthropic')
    expect(마크업).toContain('claude-sonnet-5')
  })

  it('같은 모델이 답했으면 굵은 줄이 없다', () => {
    const 마크업 = 그린다([시도()])
    expect(마크업).not.toContain('과 다름')
    expect(마크업).not.toContain('<strong>')
  })

  it('회차에 고른 모델이 안 박혀 있으면 「다름」이라 하지 않는다', () => {
    const 마크업 = 그린다([시도({ selected_model: null, model_differs: false })])
    expect(마크업).not.toContain('과 다름')
    expect(마크업).toContain('고른 모델이 회차에 안 박혀 있다')
  })

  it('비용이 「모름」이면 0 을 찍지 않는다', () => {
    const 마크업 = 그린다([시도({ cost: null })], { cost: null, input_tokens: null })
    expect(마크업).toContain('모름')
    expect(마크업).not.toContain('0.000000')
  })

  it('C-3 · 프롬프트 원문 셋이 그대로 실린다', () => {
    const 마크업 = 그린다([
      시도({ system_text: '시스템 원문 ABC', user_text: '사용자 원문 DEF', response_text: null }),
    ])
    expect(마크업).toContain('시스템 원문 ABC')
    expect(마크업).toContain('사용자 원문 DEF')
    // 응답이 없으면 없다고 말한다 (파이썬 `run_prompt.html:7`).
    expect(마크업).toContain('응답 없음')
  })

  it('실패한 시도도 사유와 함께 남는다', () => {
    const 마크업 = 그린다([시도({ ok: false, error: '504 timeout', response_text: null })])
    expect(마크업).toContain('504 timeout')
  })

  it('호출이 없는 턴이면 「정상」이라고 말한다 (전개·고정 대사)', () => {
    expect(그린다([])).toContain('호출 없음')
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// C-2 · 조립층 — 진짜 DB 로 한 턴을 읽는다
// ═══════════════════════════════════════════════════════════════════════════

async function 붙어보기(): Promise<string | null> {
  try {
    await getDb().execute(sql`select 1`)
    return null
  } catch (오류) {
    if (오류 instanceof Error && 오류.cause instanceof Error) {
      return `${오류.cause.name}: ${오류.cause.message}`
    }
    return 오류 instanceof Error ? `${오류.name}: ${오류.message}` : String(오류)
  }
}

const 못붙는_이유 = await 붙어보기()
if (못붙는_이유 !== null) {
  process.stderr.write(
    `\n[cost.test] Postgres 에 못 붙어 조립층 검사를 건너뛴다 (도커가 꺼져 있나?)\n` +
      `            ${못붙는_이유}\n\n`,
  )
}
const 검사 = 못붙는_이유 === null ? describe : describe.skip

class 되돌림 extends Error {}

/** 이 안에서 넣은 행은 검사가 끝나면 전부 사라진다 (`repo.test.ts` 와 같은 방식). */
async function 트랜잭션(본문: (tx: Conn) => Promise<void>): Promise<void> {
  try {
    await getDb().transaction(async (tx) => {
      await 본문(tx)
      throw new 되돌림('검사가 끝났으니 되돌린다')
    })
  } catch (오류) {
    if (!(오류 instanceof 되돌림)) throw 오류
  }
}

/** 회차 하나 + 아이 메시지 하나. 시도를 매달 자리를 만든다. */
async function 회차_하나(tx: Conn, 고칠_것: { analysis_model?: string | null } = {}) {
  const 꼬리 = randomUUID().slice(0, 8)
  const [이야기] = await tx
    .insert(stories)
    .values({
      slug: `s-cost-${꼬리}`,
      title: `비용 검사 ${꼬리}`,
      summary: '검사용',
      difficulty: '보통',
      status: 'draft',
    })
    .returning({ id: stories.id })
  const [캐릭터] = await tx
    .insert(characters)
    .values({
      story_id: 이야기.id,
      code: `ch_cost_${꼬리}`,
      name: '며느리',
      persona: '며느리',
      speech_style: '옛이야기',
      guidance_style: '걱정을 말한다',
      forbidden: [],
    })
    .returning({ id: characters.id })
  const [장면] = await tx
    .insert(story_scenes)
    .values({
      story_id: 이야기.id,
      code: `sc_cost_${꼬리}`,
      scene_order: 1,
      conflict: '갈등',
      character_id: 캐릭터.id,
      character_name: '며느리',
      character_opening: '첫 대사',
      character_closing: '끝 대사',
      // `dialogue_scene_needs_all_parts` — 대화 장면이면 이 칸들이 다 있어야 한다.
      scene_stance: '아직 참고 있다',
      scene_goal: '장면 목표',
      required_elements: ['EMPATHY'],
      preferred_turns: 2,
      max_turns: 4,
    })
    .returning({ id: story_scenes.id })
  const [세션] = await tx
    .insert(story_sessions)
    .values({
      child_id: randomUUID(),
      story_id: 이야기.id,
      current_scene_id: 장면.id,
      status: 'in_progress',
    })
    .returning({ id: story_sessions.id })
  const [회차] = await tx
    .insert(runs)
    .values({
      session_id: 세션.id,
      scope: 'scene',
      scene_order: 1,
      analysis_model: 고칠_것.analysis_model === undefined ? 'gemini-3.5-flash-lite' : 고칠_것.analysis_model,
      analysis_effort: 'medium',
      default_utterance_source: 'synthetic_adult',
      prompt_version: 'v1',
    })
    .returning({ id: runs.id })
  const [메시지] = await tx
    .insert(messages)
    .values({
      session_id: 세션.id,
      scene_id: 장면.id,
      speaker_type: 'child',
      turn_order: 1,
      text: '며느리가 불쌍해',
      utterance_source: 'synthetic_adult',
    })
    .returning({ id: messages.id })
  return { run_id: 회차.id, message_id: 메시지.id }
}

검사('turnAttempts — 한 턴의 시도와 비용', () => {
  it('예비 공급자가 답한 시도를 「다름」으로 잡고, 모르는 값은 합계까지 「모름」으로 번진다', async () => {
    process.env.GQ_PRICING_FILE = 단가표파일(두구간, '두구간.toml')
    await 트랜잭션(async (tx) => {
      const { run_id, message_id } = await 회차_하나(tx)
      await tx.insert(llm_calls).values([
        {
          run_id,
          message_id,
          purpose: 'analysis',
          attempt_no: 1,
          provider: 'gemini',
          model: 'gemini-3.5-flash-lite',
          effort: 'medium',
          system_text: '시스템',
          user_text: '사용자',
          response_text: null,
          input_tokens: null,
          output_tokens: null,
          duration_ms: 5000,
          ok: false,
          error: '504 timeout',
          created_at: new Date('2026-09-02T00:00:00Z'),
        },
        {
          run_id,
          message_id,
          purpose: 'analysis',
          attempt_no: 2,
          provider: 'anthropic',
          model: 'claude-sonnet-5',
          effort: 'medium',
          system_text: '시스템',
          user_text: '사용자',
          response_text: '{}',
          input_tokens: 1_000_000,
          output_tokens: 0,
          duration_ms: 3000,
          ok: true,
          error: null,
          created_at: new Date('2026-09-02T00:00:00Z'),
        },
      ])

      const 본_것 = await turnAttempts(run_id, message_id, tx)
      expect(본_것.attempts.map((시도) => 시도.attempt_no)).toEqual([1, 2])

      // 고른 것이 제미나이인데 답한 것은 앤트로픽이다 — 이것이 fallback 이다.
      expect(본_것.attempts[0].model_differs).toBe(false)
      expect(본_것.attempts[1].model_differs).toBe(true)
      expect(본_것.attempts[1].selected_model).toBe('gemini-3.5-flash-lite')

      // 실패한 시도는 토큰이 없다 → 모름. 표에 없는 모델이라서가 아니다.
      expect(본_것.attempts[0].cost).toBeNull()
      // claude-sonnet-5 는 두구간 표에 없다 → **0 이 아니라 모름**이다.
      expect(본_것.attempts[1].cost).toBeNull()

      expect(본_것.totals.attempt_count).toBe(2)
      expect(본_것.totals.duration_ms).toBe(8000)
      // 한 줄이라도 모름이면 합계도 모름이다.
      expect(본_것.totals.input_tokens).toBeNull()
      expect(본_것.totals.cost).toBeNull()
      expect(본_것.totals.통화).toBe('USD')

      // 화면이 실제로 그 사실을 드러내는가 (조립 → 화면 한 줄로 이어 본다).
      const 마크업 = renderToStaticMarkup(createElement(시도표, { 시도들: 본_것 }))
      expect(마크업).toContain('<strong>고른 모델 gemini-3.5-flash-lite과 다름</strong>')
      expect(마크업).toContain('504 timeout')
    })
  })

  it('아는 모델이면 토큰 × 단가로 값이 나온다', async () => {
    process.env.GQ_PRICING_FILE = 단가표파일(두구간, '두구간.toml')
    await 트랜잭션(async (tx) => {
      const { run_id, message_id } = await 회차_하나(tx)
      await tx.insert(llm_calls).values({
        run_id,
        message_id,
        purpose: 'analysis',
        attempt_no: 1,
        provider: 'gemini',
        model: 'gemini-3.5-flash-lite',
        effort: 'medium',
        system_text: '시스템',
        user_text: '사용자',
        response_text: '{}',
        input_tokens: 1_000_000,
        output_tokens: 1_000_000,
        duration_ms: 1000,
        ok: true,
        error: null,
        // 뒤 구간(2026-09-01 부터)이다 — 0.60 + 5.00.
        created_at: new Date('2026-09-02T00:00:00Z'),
      })

      const 본_것 = await turnAttempts(run_id, message_id, tx)
      expect(본_것.attempts[0].cost).toBeCloseTo(5.6, 10)
      expect(본_것.totals.cost).toBeCloseTo(5.6, 10)
      expect(본_것.attempts[0].model_differs).toBe(false)
    })
  })

  it('회차에 모델이 안 박혀 있으면 「다름」이라 하지 않는다 (파이썬과 갈린 자리)', async () => {
    process.env.GQ_PRICING_FILE = 단가표파일(두구간, '두구간.toml')
    await 트랜잭션(async (tx) => {
      const { run_id, message_id } = await 회차_하나(tx, { analysis_model: null })
      await tx.insert(llm_calls).values({
        run_id,
        message_id,
        purpose: 'analysis',
        attempt_no: 1,
        provider: 'anthropic',
        model: 'claude-sonnet-5',
        effort: 'medium',
        system_text: '시스템',
        user_text: '사용자',
        response_text: '{}',
        input_tokens: 10,
        output_tokens: 10,
        duration_ms: 1000,
        ok: true,
        error: null,
        created_at: new Date('2026-09-02T00:00:00Z'),
      })

      const 본_것 = await turnAttempts(run_id, message_id, tx)
      expect(본_것.attempts[0].selected_model).toBeNull()
      expect(본_것.attempts[0].model_differs).toBe(false)
    })
  })
})
