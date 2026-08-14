// 골든셋 화면·서비스 검사 — 파이썬 `tests/test_admin_goldenset.py` + `test_goldenset_storage.py`.
//
// ⛔ **진짜 LLM 을 부르지 않는다.** 분석기를 인자로 꽂거나(`분석기`) SDK 자리에 가짜를 꽂는다.
//    F-1 그물(`tests/setup.ts`)이 그 위에서 한 번 더 막는다 — 끄지 마라.
//
// DB 가 필요한 것과 아닌 것을 갈라 뒀다. 앞쪽(러너·자르기·키)은 값만 다루므로 DB 없이 돈다.

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

// ⚠️ 팩토리 안에서 바깥 변수를 참조하면 hoisting 에 걸린다 (`admin.test.ts` 와 같은 상자).
const 상자 = vi.hoisted(() => ({ tx: null as unknown }))

vi.mock('@/lib/repo/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/repo/db')>()
  return { ...real, getDb: () => 상자.tx ?? real.getDb() }
})

import { loadSettings } from '@/lib/config'
import { ValueError } from '@/lib/domain/progress'
import { closeDb, getDb, type Conn } from '@/lib/repo/db'
import { insertGoldensetResult } from '@/lib/repo/goldenset'
import { reviewedOnly, type GoldenItem, type GoldenLabel } from '@/lib/scoring'
import {
  analyzeGoldenItem,
  fileDigest,
  goldensetFiles,
  goldensetPath,
  goldensetRunView,
  readGoldensetFile,
  runFileGoldenset,
  runGoldenset,
  runGoldensetItem,
  sliceItems,
  startGoldensetRun,
  summarize,
  제미나이_키_확인,
  LabelParseError,
} from '@/lib/service/goldenset'

import { runGoldensetAction, runGoldensetItemAction } from '@/app/(admin)/goldenset/actions'

import { installFakeSdk } from './support/sdk-gate'

const 정답지 = goldensetPath('banggui_검수전.jsonl')
const 항목들 = readGoldensetFile(정답지)

/** 정답을 그대로 돌려주는 분석기. 「맞음」이 나온다. */
const 맞히는_분석기 = async (항목: GoldenItem) => ({
  라벨: { ...항목.정답 } as GoldenLabel,
  got_model: 'gemini-3.5-flash-lite',
})

/** 무엇을 물어도 터지는 분석기. 「판정 불가」가 나온다. */
const 터지는_분석기 = async () => {
  throw new Error('타임아웃')
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. 러너 — 판정 불가를 분모에서 뺀다
// ═══════════════════════════════════════════════════════════════════════════

describe('runGoldenset()', () => {
  it('호출이 터진 항목은 분모에서 빠진다', async () => {
    const 셋 = 항목들.slice(0, 3)
    let 차례 = 0
    const 결과 = await runGoldenset(셋, async (항목) => {
      차례 += 1
      if (차례 === 2) throw new Error('타임아웃')
      return 맞히는_분석기(항목)
    })
    const 요약 = summarize(결과.결과들, 결과.표)
    expect(요약.돌린_수).toBe(3)
    expect(요약.판정불가_수).toBe(1)
    expect(요약.판정한_수).toBe(2)
    expect(결과.표.건수).toBe(2)
  })

  it('응답을 라벨로 못 바꿔도 판정 불가이고, 답한 모델은 남는다', async () => {
    const 결과 = await runGoldenset(항목들.slice(0, 1), async () => {
      throw new LabelParseError('JSON 이 아니다', 'gemini-3.5-flash-lite')
    })
    expect(결과.결과들[0].채점).toBeNull()
    expect(결과.결과들[0].got_model).toBe('gemini-3.5-flash-lite')
    expect(결과.결과들[0].판정불가_사유).toContain('LabelParseError')
  })

  it('라벨이 왔는데 틀린 것은 판정 불가가 아니다', async () => {
    const 결과 = await runGoldenset(항목들.slice(0, 1), async () => ({
      라벨: { child_intent: 'UNCLEAR', detected_elements: [], utterance_validity: 'SHORT', main_point: null },
      got_model: null,
    }))
    const 요약 = summarize(결과.결과들, 결과.표)
    expect(요약.판정불가_수).toBe(0)
    expect(요약.틀린_수).toBe(1)
    expect(요약.판정한_수).toBe(1)
  })

  it('전부 판정 불가면 0퍼센트가 아니라 잰 것이 없다', async () => {
    const 결과 = await runGoldenset(항목들.slice(0, 2), 터지는_분석기)
    const 요약 = summarize(결과.결과들, 결과.표)
    expect(요약.판정한_수).toBe(0)
    expect(요약.점수를_낼_수_있나).toBe(false)
  })

  it('연속 세 건 실패하면 남은 항목을 부르지 않고 말한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let 부른_수 = 0
    const 결과 = await runGoldenset(항목들.slice(0, 10), async () => {
      부른_수 += 1
      throw new Error('막혔다')
    })
    expect(부른_수).toBe(3)
    expect(결과.결과들).toHaveLength(3)
    expect(결과.중단_메모).toBe('연속 3건 실패로 멈췄다. 남은 7건은 안 돌렸다')
  })

  it('성공하면 연속 실패 수는 다시 센다', async () => {
    let 차례 = 0
    // 터짐 · 터짐 · 그다음부터 맞힘 (파이썬 `대본분석기("터짐", "터짐", "맞힘")` 과 같다)
    const 결과 = await runGoldenset(항목들.slice(0, 6), async (항목) => {
      차례 += 1
      if (차례 <= 2) throw new Error('막혔다')
      return 맞히는_분석기(항목)
    })
    expect(결과.결과들).toHaveLength(6)
    expect(결과.중단_메모).toBe(null)
  })

  it('분당을 안 주면 잠들지 않는다', async () => {
    const 잠 = vi.spyOn(globalThis, 'setTimeout')
    await runGoldenset(항목들.slice(0, 3), 맞히는_분석기, { 분당: null })
    expect(잠).not.toHaveBeenCalled()
    잠.mockRestore()
  })

  it('분당이 1보다 작으면 한 건도 안 부른다', async () => {
    let 부른_수 = 0
    await expect(
      runGoldenset(항목들.slice(0, 3), async (항목) => {
        부른_수 += 1
        return 맞히는_분석기(항목)
      }, { 분당: 0 }),
    ).rejects.toBeInstanceOf(ValueError)
    expect(부른_수).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 2. 자르기 · 키 · 파일
// ═══════════════════════════════════════════════════════════════════════════

describe('sliceItems()', () => {
  it('시작을 안 주면 1번째부터다', () => {
    expect(sliceItems(항목들, { limit: 2 }).map((항목) => 항목.id)).toEqual([
      항목들[0].id,
      항목들[1].id,
    ])
  })

  it('나눠 돌려도 같은 건을 두 번 안 부른다', () => {
    const 앞 = sliceItems(항목들, { limit: 3 }).map((항목) => 항목.id)
    const 뒤 = sliceItems(항목들, { offset: 4, limit: 3 }).map((항목) => 항목.id)
    expect(앞.some((id) => 뒤.includes(id))).toBe(false)
    expect(뒤[0]).toBe(항목들[3].id)
  })

  it('시작만 주면 거기서 끝까지 돈다', () => {
    expect(sliceItems(항목들, { offset: 71 })).toHaveLength(3)
  })

  it('범위 밖을 가리키면 0건을 조용히 돌지 않는다', () => {
    expect(() => sliceItems(항목들, { offset: 999 })).toThrow(ValueError)
    expect(() => sliceItems(항목들, { offset: 0 })).toThrow(/1 이상/)
    expect(() => sliceItems(항목들, { limit: 0 })).toThrow(/1 이상/)
  })
})

describe('정답지 파일', () => {
  it('골든셋 폴더 밖의 파일은 안 읽는다', () => {
    expect(() => goldensetPath('../prompts/analysis.md')).toThrow(/골든셋 폴더에 없는 파일/)
    expect(() => goldensetPath('/etc/passwd')).toThrow(/골든셋 폴더에 없는 파일/)
    expect(goldensetFiles()).toContain('banggui_검수전.jsonl')
  })
})

describe('제미나이_키_확인()', () => {
  it('목록 밖 키를 거절한다', () => {
    expect(() => 제미나이_키_확인(9)).toThrow(ValueError)
  })

  it('설정에 없는 키로 시작하라면 한 건도 부르기 전에 막는다', () => {
    const 설정 = loadSettings({ gemini_api_keys: ['키1뿐'] })
    expect(() => 제미나이_키_확인(2, 설정)).toThrow(/GQ_GEMINI_API_KEY_2 가 설정돼 있지 않다/)
    expect(제미나이_키_확인(1, 설정)).toBe(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 3. 엔진과 같은 재료로 부른다 (결정 54 · B-3)
// ═══════════════════════════════════════════════════════════════════════════

describe('analyzeGoldenItem()', () => {
  /** SDK 자리에 가짜를 꽂고 user 본문을 가로챈다. */
  function 가짜_제미나이(응답: string): { user: string | null } {
    const 본 = { user: null as string | null }
    installFakeSdk('gemini', () => ({
      interactions: {
        create: async (요청: Record<string, unknown>) => {
          본.user = String(요청.input ?? '')
          return { output_text: 응답, usage_metadata: {} }
        },
      },
    }))
    return 본
  }

  it('엔진과 같은 재료 여섯 조각을 보내고 goal 은 안 싣는다', async () => {
    const 본 = 가짜_제미나이(
      '{"child_intent":"OPINION","main_point":null,"detected_elements":[],"utterance_validity":"VALID"}',
    )
    const 답 = await analyzeGoldenItem(항목들[0], {
      settings: loadSettings({ gemini_api_keys: ['가짜키'], llm_rpm: 0 }),
    })
    expect(답.라벨.child_intent).toBe('OPINION')

    // 재료 JSON 은 들여쓰기 없는 한 줄이다 (`materialJson()`). `{"scene"` 부터 끝까지가 그것이다.
    const 본문 = 본.user ?? ''
    const 재료 = JSON.parse(본문.slice(본문.indexOf('{"scene"')).trim()) as Record<string, unknown>
    expect(Object.keys(재료)).toEqual([
      'scene',
      'previous_character_message',
      'child_utterance',
      'target_elements',
      'element_criteria',
    ])
    // 🔴 `goal` 은 안 실린다 — 파이썬이 goal 없이 재 왔다 (B-3 → B-5 순서).
    expect(재료).not.toHaveProperty('goal')
    // ⚠️ 기본은 기준 없이 잰다.
    expect(재료.element_criteria).toEqual({})
  })

  it('기준_포함 을 켜면 element_criteria 가 실린다', async () => {
    const 본 = 가짜_제미나이(
      '{"child_intent":"OPINION","main_point":null,"detected_elements":[],"utterance_validity":"VALID"}',
    )
    await analyzeGoldenItem(항목들[0], {
      기준_포함: true,
      settings: loadSettings({ gemini_api_keys: ['가짜키'], llm_rpm: 0 }),
    })
    expect(본.user).toContain('"element_criteria":{"')
  })

  it('응답을 라벨로 못 바꾸면 답한 모델을 들고 터진다', async () => {
    가짜_제미나이('미안 못 하겠어')
    await expect(
      analyzeGoldenItem(항목들[0], {
        settings: loadSettings({ gemini_api_keys: ['가짜키'], llm_rpm: 0 }),
      }),
    ).rejects.toBeInstanceOf(LabelParseError)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 4. 저장 — DB 가 있어야 돈다
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
    `\n[goldenset.test] Postgres 에 못 붙어 저장 검사를 건너뛴다 (도커가 꺼져 있나?)\n` +
      `                 ${못붙는_이유}\n\n`,
  )
}
const DB검사 = 못붙는_이유 === null ? describe : describe.skip

afterAll(async () => {
  상자.tx = null
  await closeDb()
})

class 되돌림 extends Error {}

async function 트랜잭션(본문: (tx: Conn) => Promise<void>): Promise<void> {
  try {
    await getDb().transaction(async (tx) => {
      상자.tx = tx
      await 본문(tx)
      throw new 되돌림('검사가 끝났으니 되돌린다')
    })
  } catch (오류) {
    if (!(오류 instanceof 되돌림)) throw 오류
  } finally {
    상자.tx = null
  }
}

DB검사('한 조각을 한 판으로 저장한다', () => {
  it('원자료와 지문을 남기고, 파일 전체 건수를 보존한다', async () => {
    await 트랜잭션(async (tx) => {
      const 지문_전 = fileDigest(정답지)
      const 결과 = await runFileGoldenset({
        경로: 정답지,
        전체_항목들: 항목들,
        항목들: 항목들.slice(0, 2),
        분석기: 맞히는_분석기,
        started_by: '검사',
        conn: tx,
      })

      const 판 = await goldensetRunView(결과.goldenset_run_id, tx)
      expect(판.run.file_name).toBe('banggui_검수전.jsonl')
      expect(판.run.file_digest).toBe(지문_전)
      // ⭐ 조각 크기가 아니다 — 파일 전체 건수다.
      expect(판.run.file_item_count).toBe(73)
      expect(판.run.prompt_digest).toHaveLength(64)
      expect(판.run.ended_at).not.toBeNull()
      expect(판.결과들).toHaveLength(2)
      expect(판.요약.맞은_수).toBe(2)
      expect(판.표.child_intent_정확도).toBe(1)
      // ⚠️ **정답지 파일은 안 바뀐다.** 고치는 길이 아예 없다.
      expect(fileDigest(정답지)).toBe(지문_전)
    })
  })

  it('저장된 판을 다시 읽어도 같은 점수를 낸다', async () => {
    await 트랜잭션(async (tx) => {
      const 결과 = await runFileGoldenset({
        경로: 정답지,
        전체_항목들: 항목들,
        항목들: 항목들.slice(0, 5),
        분석기: async (항목) =>
          항목.id.endsWith('1')
            ? { 라벨: { child_intent: 'UNCLEAR', detected_elements: [], utterance_validity: 'SHORT', main_point: null }, got_model: null }
            : 맞히는_분석기(항목),
        conn: tx,
      })
      const 판 = await goldensetRunView(결과.goldenset_run_id, tx)
      expect(판.표.건수).toBe(결과.표.건수)
      expect(판.표.child_intent_정확도).toBe(결과.표.child_intent_정확도)
      expect(판.표.요소_F1).toBe(결과.표.요소_F1)
      expect(판.요약.맞은_수).toBe(summarize(결과.결과들, 결과.표).맞은_수)
    })
  })

  it('연속 실패 중단은 시도한 세 건만 저장하고 판 note 에 남긴다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await 트랜잭션(async (tx) => {
      const 결과 = await runFileGoldenset({
        경로: 정답지,
        전체_항목들: 항목들,
        항목들: 항목들.slice(0, 8),
        분석기: 터지는_분석기,
        conn: tx,
      })
      const 판 = await goldensetRunView(결과.goldenset_run_id, tx)
      expect(판.결과들).toHaveLength(3)
      expect(판.결과들.every((행) => 행.판정불가)).toBe(true)
      expect(판.run.note).toContain('연속 3건 실패로 멈췄다')
      expect(판.요약.점수를_낼_수_있나).toBe(false)
    })
  })

  it('판정 불가인데 got 값을 채우면 CHECK 가 막는다', async () => {
    await 트랜잭션(async (tx) => {
      const 결과 = await runFileGoldenset({
        경로: 정답지,
        전체_항목들: 항목들,
        항목들: 항목들.slice(0, 1),
        분석기: 맞히는_분석기,
        conn: tx,
      })
      await expect(
        insertGoldensetResult(tx, {
          goldenset_run_id: 결과.goldenset_run_id,
          item_id: `${randomUUID()}`,
          item_review: '초안',
          unjudged_reason: '타임아웃',
          got_model: null,
          expected_child_intent: 'OPINION',
          expected_validity: 'VALID',
          expected_elements: [],
          got_child_intent: 'OPINION',
          got_validity: 'VALID',
          got_elements: [],
          got_main_point: null,
        }),
      ).rejects.toThrow()
    })
  })

  it('⭐ 검수완료만 을 켜면 30건만 돈다', async () => {
    await 트랜잭션(async (tx) => {
      const 부른것: string[] = []
      const 결과 = await startGoldensetRun({
        file: 'banggui_검수전.jsonl',
        reviewed_only: true,
        분석기: async (항목) => {
          부른것.push(항목.id)
          return 맞히는_분석기(항목)
        },
        conn: tx,
      })
      expect(부른것).toHaveLength(30)
      expect(부른것).toEqual(reviewedOnly(항목들).map((항목) => 항목.id))
      // 초안이 하나도 안 섞였으므로 이 점수는 믿을 수 있다.
      expect(결과.표.초안_건수).toBe(0)
      // ⚠️ 걸러도 `file_item_count` 는 파일 전체 건수 그대로다.
      const 판 = await goldensetRunView(결과.goldenset_run_id, tx)
      expect(판.run.file_item_count).toBe(73)
    })
  })

  it('검수완료만 을 켜면 자르기는 거른 뒤에 먹는다', async () => {
    await 트랜잭션(async (tx) => {
      const 부른것: string[] = []
      await startGoldensetRun({
        file: 'banggui_검수전.jsonl',
        reviewed_only: true,
        limit: 2,
        분석기: async (항목) => {
          부른것.push(항목.id)
          return 맞히는_분석기(항목)
        },
        conn: tx,
      })
      expect(부른것).toEqual(reviewedOnly(항목들).slice(0, 2).map((항목) => 항목.id))
    })
  })

  it('한 건만 돌리면 그 한 건만 부른다 · 없는 항목이면 아무것도 안 부른다', async () => {
    await 트랜잭션(async (tx) => {
      const 부른것: string[] = []
      await runGoldensetItem({
        file: 'banggui_검수전.jsonl',
        item_id: 항목들[5].id,
        분석기: async (항목) => {
          부른것.push(항목.id)
          return 맞히는_분석기(항목)
        },
        conn: tx,
      })
      expect(부른것).toEqual([항목들[5].id])

      await expect(
        runGoldensetItem({ file: 'banggui_검수전.jsonl', item_id: '없는놈', 분석기: 맞히는_분석기, conn: tx }),
      ).rejects.toThrow(/그런 항목이 없다/)
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 5. 화면이 누르는 단추 — 서버 액션
// ═══════════════════════════════════════════════════════════════════════════

/** `redirect()` 가 던지는 예외의 `digest` 에 목적지가 들어 있다 (Next `redirect.md`). */
async function 눌러본다(액션: (폼: FormData) => Promise<void>, 폼: FormData): Promise<string> {
  try {
    await 액션(폼)
  } catch (오류) {
    const digest = (오류 as { digest?: string }).digest
    if (typeof digest === 'string' && digest.startsWith('NEXT_REDIRECT')) return digest
    throw 오류
  }
  throw new Error('액션이 리다이렉트하지 않았다')
}

/** `URLSearchParams` 는 빈칸을 `+` 로 적는다 — `decodeURIComponent` 만으로는 안 풀린다. */
function 풀어읽는다(digest: string): string {
  return decodeURIComponent(digest.replace(/\+/g, ' '))
}

function 폼(값들: Record<string, string>): FormData {
  const 것 = new FormData()
  for (const [이름, 값] of Object.entries(값들)) 것.set(이름, 값)
  return 것
}

DB검사('서버 액션', () => {
  it('돌리면 그 판 주소(?run=)로 돌아간다', async () => {
    installFakeSdk('gemini', () => ({
      interactions: {
        create: async () => ({
          output_text:
            '{"child_intent":"OPINION","main_point":null,"detected_elements":[],"utterance_validity":"VALID"}',
          usage_metadata: {},
        }),
      },
    }))
    await 트랜잭션(async () => {
      const 어디 = await 눌러본다(
        runGoldensetAction,
        폼({ file: 'banggui_검수전.jsonl', limit: '1' }),
      )
      expect(어디).toMatch(/\/goldenset\?file=[^;]*&run=[0-9a-f-]{36}/)
      expect(어디).not.toContain('error=')
    })
  })

  it('범위 밖을 가리키면 BAD_REQUEST 를 주소에 실어 돌아온다', async () => {
    await 트랜잭션(async () => {
      const 어디 = await 눌러본다(
        runGoldensetAction,
        폼({ file: 'banggui_검수전.jsonl', offset: '999' }),
      )
      expect(어디).toContain('error=')
      expect(풀어읽는다(어디)).toContain('BAD_REQUEST')
      expect(풀어읽는다(어디)).toContain('그 범위에는 항목이 없다')
    })
  })

  it('없는 항목을 돌리라고 하면 BAD_REQUEST 다', async () => {
    await 트랜잭션(async () => {
      const 어디 = await 눌러본다(
        runGoldensetItemAction,
        폼({ file: 'banggui_검수전.jsonl', item_id: '없는놈' }),
      )
      expect(풀어읽는다(어디)).toContain('BAD_REQUEST')
    })
  })
})

// 정답지를 **쓰는** 길이 없다는 것을 파일 지문으로 한 번 더 못박는다.
describe('정답지는 읽기 전용이다', () => {
  it('서비스가 파일을 건드리지 않는다', () => {
    const 전 = readFileSync(정답지)
    readGoldensetFile(정답지)
    goldensetFiles()
    expect(readFileSync(정답지).equals(전)).toBe(true)
    expect(path.dirname(정답지).endsWith('goldenset')).toBe(true)
  })
})
