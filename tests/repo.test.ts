// 저장 계층 대조 검사 — `lib/repo/` 셋 (`content.ts` · `sessions.ts` · `runs.ts`).
//
// ## 진짜 DB 를 쓰고, 끝나면 되돌린다
//
// 파이썬 `tests/conftest.py` 의 `db` 픽스처와 같은 방식이다 — 트랜잭션을 열고
// 검사가 끝나면 **무조건 롤백**한다. 그래서 몇 번을 돌려도 결과가 같고 DB 에 행이 남지 않는다.
// 가짜 DB 를 쓰지 않는 이유는, 이 층에서 확인할 것이 대부분 **DB 가 하는 일**이기 때문이다
// (`turn_order` 를 DB 안에서 세는 것 · `gen_random_uuid()` · CHECK 제약 · jsonb 왕복).
//
// ## DB 가 없으면 **건너뛴다** — 조용히 통과시키지 않는다
//
// `describe.skip` 이라 vitest 보고에 「skipped」로 뜬다. 통과로 보이면
// 「검사가 다 초록인데 저장 계층은 한 번도 안 돌아 본」 상태가 된다.

import { randomUUID } from 'node:crypto'

import { eq, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'

import {
  characters,
  llm_calls,
  messages,
  stories,
  story_scenes,
  story_sessions,
  utterance_analyses,
} from '@/db/schema'
import type { Decision } from '@/lib/domain/decide'
import { LookupError } from '@/lib/domain/progress'
import type { Attempt } from '@/lib/llm'
import {
  SceneNotFound,
  findScene,
  listStories,
  readScene,
  readStory,
  requireDialogueScene,
  scenesOfStory,
  scenesOfStoryId,
} from '@/lib/repo/content'
import { closeDb, getDb, type Conn } from '@/lib/repo/db'
import {
  attemptTotals,
  createRun,
  endRun,
  failureReasons,
  insertAttempts,
  listRuns,
  readAttempts,
  readRun,
  readRunBySession,
} from '@/lib/repo/runs'
import {
  readRunTurnConditions,
  readTurnCondition,
  upsertTurnCondition,
  type TurnConditionInput,
} from '@/lib/repo/turn-conditions'
import {
  completeSession,
  createSession,
  enterScene,
  insertAnalysis,
  insertMessage,
  lastCharacterMessage,
  lastChildMessageId,
  readMessage,
  readSession,
  readSessionWithStory,
  sceneMessages,
  updateSession,
  분석_규격,
} from '@/lib/repo/sessions'

// ── DB 가 있나 ────────────────────────────────────────────────────────────

async function 붙어보기(): Promise<string | null> {
  try {
    await getDb().execute(sql`select 1`)
    return null
  } catch (오류) {
    // 드리즐은 진짜 사유를 `cause` 에 담는다. 겉만 보면 「Failed query: select 1」뿐이다.
    if (오류 instanceof Error && 오류.cause instanceof Error) {
      return `${오류.cause.name}: ${오류.cause.message}`
    }
    return 오류 instanceof Error ? `${오류.name}: ${오류.message}` : String(오류)
  }
}

const 못붙는_이유 = await 붙어보기()
if (못붙는_이유 !== null) {
  // ⚠️ `console.warn` 은 수집 단계에서 vitest 보고에 안 실린다. 직접 쓴다 —
  //    「27 skipped」만 보이고 **왜** 건너뛰었는지 안 보이면 도커가 꺼진 것을 못 알아챈다.
  process.stderr.write(
    `\n[repo.test] Postgres 에 못 붙어 저장 계층 검사를 건너뛴다 (도커가 꺼져 있나?)\n` +
      `            ${못붙는_이유}\n` +
      `            되살리려면: 도커 goodquestion-postgres 를 켜고 web/.env.local 의 DATABASE_URL 을 확인한다\n\n`,
  )
}
const 검사 = 못붙는_이유 === null ? describe : describe.skip

afterAll(async () => {
  await closeDb()
})

// ── 트랜잭션을 열고 끝나면 되돌린다 ────────────────────────────────────────

class 되돌림 extends Error {}

/** 이 안에서 넣은 행은 검사가 끝나면 전부 사라진다. */
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

// ── 검사용 콘텐츠 ─────────────────────────────────────────────────────────

interface 씨앗 {
  story_id: string
  story_code: string
  character_id: string
  /** `sc_test_01`(전개) `02`(전개) `03`(대화) `04`(전개) `05`(대화) */
  scene_ids: Record<string, string>
}

/**
 * 이야기 하나 + 장면 다섯(전개 셋 · 대화 둘) + 캐릭터 하나.
 *
 * 「방귀 뀌는 며느리」와 같은 모양이다 — 전개와 대화가 섞여 있어야
 * `앞선 전개`(결정 25)와 `대화 장면 확인`이 실제로 걸러지는지 볼 수 있다.
 */
async function 콘텐츠_넣기(tx: Conn): Promise<씨앗> {
  const 꼬리 = randomUUID().slice(0, 8)
  const story_code = `s_test_${꼬리}`

  const [이야기] = await tx
    .insert(stories)
    .values({
      slug: story_code,
      title: `검사용 이야기 ${꼬리}`,
      summary: '검사용',
      difficulty: '보통',
      status: 'draft',
    })
    .returning({ id: stories.id })

  const [캐릭터] = await tx
    .insert(characters)
    .values({
      story_id: 이야기.id,
      code: 'ch_test_daughter_in_law',
      name: '방귀쟁이 며느리',
      persona: '시집온 지 얼마 안 된 며느리',
      speech_style: '옛이야기 말투',
      guidance_style: '자기 걱정을 소리 내어 말한다',
      forbidden: ['설명하지 않는다'],
    })
    .returning({ id: characters.id })

  const 대화칸 = {
    character_id: 캐릭터.id,
    character_name: '며느리',
    character_opening: '첫 대사',
    character_closing: '마지막 대사',
    scene_stance: '아직 참고 있다',
    scene_goal: '장면 목표',
    required_elements: ['EMPATHY', 'SOLUTION'],
    element_criteria: { SOLUTION: '그림을 어떻게 하면 좋을까?' },
    remaining_worries: { SOLUTION: '그럼 난 어떻게 하면 좋을까…' },
    preferred_turns: 2,
    max_turns: 4,
  }

  const 넣은_장면들 = await tx
    .insert(story_scenes)
    .values([
      { story_id: 이야기.id, code: 'sc_test_01', scene_order: 1, scene_description: '전개 1' },
      { story_id: 이야기.id, code: 'sc_test_02', scene_order: 2, scene_description: '전개 2' },
      { story_id: 이야기.id, code: 'sc_test_03', scene_order: 3, conflict: '갈등', ...대화칸 },
      { story_id: 이야기.id, code: 'sc_test_04', scene_order: 4, scene_description: '전개 4' },
      { story_id: 이야기.id, code: 'sc_test_05', scene_order: 5, conflict: '갈등', ...대화칸 },
    ])
    .returning({ id: story_scenes.id, code: story_scenes.code })

  const scene_ids: Record<string, string> = {}
  for (const 행 of 넣은_장면들) scene_ids[행.code] = 행.id

  return { story_id: 이야기.id, story_code, character_id: 캐릭터.id, scene_ids }
}

/** `decide()` 가 낼 법한 값 하나. 저장 계층은 이 값을 계산하지 않고 받아 적는다. */
const 판정: Decision = {
  response_mode: 'GUIDED',
  guidance_target: 'SOLUTION',
  // 이번 턴에 유도가 있으니 이월값도 같다 — 저장 계층이 적는 것은 **이쪽**이다 (이슈 #27).
  last_guidance_target: 'SOLUTION',
  soft_cue: false,
  reaction_key: 'directResponse',
  scene_goal_met: false,
  scene_end_reason: null,
  accumulated_elements: ['EMPATHY'],
  turns_without_new_element: 1,
  consecutive_low_information_turns: 0,
}

/** `lib/llm` 의 `Attempt` 를 **그대로** 쓴다 — 옮겨 담는 층이 없다는 증거다. */
function 시도(고칠_것: Partial<Attempt> = {}): Attempt {
  return {
    purpose: 'analysis',
    provider: 'gemini',
    model: 'gemini-3.5-flash-lite',
    effort: 'low',
    system_text: '시스템',
    user_text: '사용자',
    response_text: '{"child_intent":"OPINION"}',
    input_tokens: 100,
    output_tokens: 20,
    duration_ms: 1234,
    ok: true,
    error: null,
    ...고칠_것,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 저장-3 콘텐츠
// ═══════════════════════════════════════════════════════════════════════════

검사('repo/content — 코드로 콘텐츠를 읽는다', () => {
  it('장면을 scene_order 순으로 주고, 전개 장면도 함께다 (결정 11)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const 장면들 = await scenesOfStory(tx, 씨.story_code)

      expect(장면들.map((행) => 행.code)).toEqual([
        'sc_test_01',
        'sc_test_02',
        'sc_test_03',
        'sc_test_04',
        'sc_test_05',
      ])
      // story_scenes.id 는 `scene_id` 로 온다 — characters.id 와 부딪히기 때문이다.
      expect(장면들[0].scene_id).toBe(씨.scene_ids.sc_test_01)
      expect(장면들[0].character_id).toBeNull()
      expect(장면들[0].character_code).toBeNull()
      // 대화 장면에는 캐릭터 칸이 붙어 온다.
      expect(장면들[2].character_id).toBe(씨.character_id)
      expect(장면들[2].character_code).toBe('ch_test_daughter_in_law')
      expect(장면들[2].forbidden).toEqual(['설명하지 않는다'])
      expect(장면들[2].remaining_worries).toEqual({ SOLUTION: '그럼 난 어떻게 하면 좋을까…' })
      expect(장면들[2].required_elements).toEqual(['EMPATHY', 'SOLUTION'])
    })
  })

  it('story_id 로도 같은 목록을 준다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const 가 = await scenesOfStory(tx, 씨.story_code)
      const 나 = await scenesOfStoryId(tx, 씨.story_id)
      expect(나.map((행) => 행.scene_id)).toEqual(가.map((행) => 행.scene_id))
    })
  })

  it('findScene 은 앞선 **전개** 장면만 준다 (결정 25 — 뒷이야기 금지)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const { scene, preceding } = await findScene(tx, {
        story_code: 씨.story_code,
        scene_code: 'sc_test_05',
      })

      expect(scene.code).toBe('sc_test_05')
      // 03 은 앞서지만 대화 장면이라 빠지고, 05 자신과 뒤쪽도 없다.
      expect(preceding.map((행) => 행.code)).toEqual(['sc_test_01', 'sc_test_02', 'sc_test_04'])
      expect(preceding[0].scene_description).toBe('전개 1')
    })
  })

  it('모르는 이야기 코드·씬 코드는 SceneNotFound 다 (404 자리)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)

      await expect(readStory(tx, 's_없는이야기')).rejects.toThrow(SceneNotFound)
      await expect(
        findScene(tx, { story_code: 씨.story_code, scene_code: 'sc_test_99' }),
      ).rejects.toThrow(SceneNotFound)
      await expect(
        findScene(tx, { story_code: 's_없는이야기', scene_code: 'sc_test_01' }),
      ).rejects.toThrow(SceneNotFound)
      await expect(readScene(tx, randomUUID())).rejects.toThrow(SceneNotFound)

      // 「목록에 없다」 갈래를 그대로 물려받는다 — 「인자가 틀렸다」와 갈라 두려는 것이다.
      await expect(readStory(tx, 's_없는이야기')).rejects.toBeInstanceOf(LookupError)
    })
  })

  it('전개 장면에 requireDialogueScene 을 걸면 거절한다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const 전개 = await readScene(tx, 씨.scene_ids.sc_test_01)
      const 대화 = await readScene(tx, 씨.scene_ids.sc_test_03)

      expect(() => requireDialogueScene(전개)).toThrow(SceneNotFound)
      expect(requireDialogueScene(대화)).toBe(대화)
    })
  })

  it('이야기 목록에 방금 넣은 이야기가 보인다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const 목록 = await listStories(tx)
      expect(목록.map((행) => 행.slug)).toContain(씨.story_code)
    })
  })

  it('⭐ 시드가 채운 진짜 슬러그로 「방귀 뀌는 며느리」 3장면을 읽는다', async () => {
    // 파이썬은 `_슬러그 = {"fart-bride": "방귀 뀌는 며느리"}` 표를 거쳐 **제목**으로 찾았다.
    // 그 표가 사라졌다는 것을 실제 시드 데이터로 확인하는 자리다 — 같은 글자가 이제 DB 칸
    // (`stories.slug`)에 있다 (2026-08-13 결정 3 · 4차).
    // ⚠️ `npx tsx db/seed.ts` 를 한 번도 안 돌린 DB 라면 여기서 빨개진다. 그게 맞다.
    await 트랜잭션(async (tx) => {
      const { scene, preceding } = await findScene(tx, {
        story_code: 'fart-bride',
        scene_code: 'sc_banggui_03',
      })
      expect(scene.scene_order).toBe(3)
      expect(scene.character_id).not.toBeNull()
      expect(preceding.map((행) => 행.code)).toEqual(['sc_banggui_01', 'sc_banggui_02'])
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 저장-4 세션
// ═══════════════════════════════════════════════════════════════════════════

검사('repo/sessions — 세션 읽기·갱신', () => {
  it('세션을 만들면 장면 상태가 비어 있다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const session_id = await createSession(tx, { story_id: 씨.story_id, child_id: randomUUID() })
      const 세션 = await readSession(tx, session_id)

      expect(세션.child_id).toMatch(/^[0-9a-f-]{36}$/)
      expect(세션.status).toBe('in_progress')
      expect(세션.current_scene_id).toBeNull()
      expect(세션.current_child_turn_count).toBe(0)
      expect(세션.accumulated_elements).toEqual([])
      expect(세션.scene_goal_met).toBe(false)

      // ⛔ 경계 5 — 이 칸은 DB 에 없다. `required_elements − accumulated_elements` 로 계산한다.
      expect('missing_elements' in 세션).toBe(false)
    })
  })

  it('child_id 를 주면 그 값을 그대로 든다 (누구인지는 모른다)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const 아이 = randomUUID()
      const session_id = await createSession(tx, { story_id: 씨.story_id, child_id: 아이 })
      expect((await readSession(tx, session_id)).child_id).toBe(아이)
    })
  })

  it('없는 세션은 LookupError 다', async () => {
    await 트랜잭션(async (tx) => {
      await expect(readSession(tx, randomUUID())).rejects.toThrow(LookupError)
      await expect(readSessionWithStory(tx, randomUUID())).rejects.toThrow(LookupError)
    })
  })

  it('세션에 이야기 코드·제목을 붙여 읽는다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const session_id = await createSession(tx, { story_id: 씨.story_id, child_id: randomUUID() })
      const 세션 = await readSessionWithStory(tx, session_id)
      expect(세션.story_code).toBe(씨.story_code)
      expect(세션.story_title).toContain('검사용 이야기')
      expect(세션.id).toBe(session_id)
    })
  })

  it('장면에 들어가면 장면 상태 9칸이 초기화된다 (결정 22)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const session_id = await createSession(tx, { story_id: 씨.story_id, child_id: randomUUID() })

      // 앞 장면에서 값이 쌓인 상태를 만든다.
      await enterScene(tx, session_id, 씨.scene_ids.sc_test_03)
      await updateSession(tx, {
        session_id,
        decision: { ...판정, scene_goal_met: true, scene_end_reason: 'GOAL_MET' },
        turn_count: 3,
        last_detected: ['EMPATHY'],
      })
      const 쌓인 = await readSession(tx, session_id)
      expect(쌓인.accumulated_elements).toEqual(['EMPATHY'])
      expect(쌓인.scene_end_reason).toBe('GOAL_MET')

      // 다음 장면으로 들어가면 전부 지워져야 한다. 안 지우면 첫 턴에 GOAL_MET 이 뜬다.
      await enterScene(tx, session_id, 씨.scene_ids.sc_test_05)
      const 새_장면 = await readSession(tx, session_id)
      expect(새_장면.current_scene_id).toBe(씨.scene_ids.sc_test_05)
      expect(새_장면.current_child_turn_count).toBe(0)
      expect(새_장면.accumulated_elements).toEqual([])
      expect(새_장면.last_detected_elements).toEqual([])
      expect(새_장면.last_response_mode).toBeNull()
      expect(새_장면.last_guidance_target).toBeNull()
      expect(새_장면.turns_without_new_element).toBe(0)
      expect(새_장면.consecutive_low_information_turns).toBe(0)
      expect(새_장면.scene_goal_met).toBe(false)
      expect(새_장면.scene_end_reason).toBeNull()
    })
  })

  it('판정 아홉 칸을 한 번에 쓴다 (결정 18)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const session_id = await createSession(tx, { story_id: 씨.story_id, child_id: randomUUID() })
      await enterScene(tx, session_id, 씨.scene_ids.sc_test_03)
      const 전 = await readSession(tx, session_id)

      await updateSession(tx, {
        session_id,
        decision: 판정,
        turn_count: 2,
        last_detected: ['EMPATHY', 'REASON'],
      })
      const 후 = await readSession(tx, session_id)

      expect(후.current_child_turn_count).toBe(2)
      expect(후.accumulated_elements).toEqual(['EMPATHY'])
      expect(후.last_detected_elements).toEqual(['EMPATHY', 'REASON'])
      expect(후.last_response_mode).toBe('GUIDED')
      // soft-cue 대상도 이 칸에 담긴다.
      expect(후.last_guidance_target).toBe('SOLUTION')
      expect(후.turns_without_new_element).toBe(1)
      expect(후.consecutive_low_information_turns).toBe(0)
      expect(후.scene_goal_met).toBe(false)
      expect(후.scene_end_reason).toBeNull()
      expect(후.last_activity_at.getTime()).toBeGreaterThanOrEqual(전.last_activity_at.getTime())
    })
  })

  it('유도가 없던 턴은 직전 유도 기억을 지우지 않는다 (이슈 #27)', async () => {
    // 저장하는 것은 `guidance_target`(이번 턴)이 **아니라** `last_guidance_target`(이월값)이다.
    // 위 검사는 둘이 같은 값이라 이 자리를 못 가른다 — 갈라지는 판정으로 한 번 더 때린다.
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const session_id = await createSession(tx, { story_id: 씨.story_id, child_id: randomUUID() })
      await enterScene(tx, session_id, 씨.scene_ids.sc_test_03)

      await updateSession(tx, {
        session_id,
        decision: { ...판정, response_mode: 'NORMAL', guidance_target: null },
        turn_count: 2,
        last_detected: [],
      })

      // 이번 턴에는 유도가 없었지만(`guidance_target: null`) 기억은 남는다.
      expect((await readSession(tx, session_id)).last_guidance_target).toBe('SOLUTION')
    })
  })

  it('세션을 끝내면 completed 가 되고 completed_at 이 찍힌다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const session_id = await createSession(tx, { story_id: 씨.story_id, child_id: randomUUID() })
      await completeSession(tx, session_id)
      const 세션 = await readSession(tx, session_id)
      expect(세션.status).toBe('completed')
      expect(세션.completed_at).not.toBeNull()
    })
  })

  it('turn_order 는 장면이 바뀌어도 이어지는 **세션 전체** 순번이다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const session_id = await createSession(tx, { story_id: 씨.story_id, child_id: randomUUID() })

      const 하나 = await insertMessage(tx, {
        session_id,
        scene_id: 씨.scene_ids.sc_test_03,
        speaker_type: 'character',
        text: '첫 대사',
      })
      const 둘 = await insertMessage(tx, {
        session_id,
        scene_id: 씨.scene_ids.sc_test_03,
        speaker_type: 'child',
        text: '며느리가 불쌍해요',
        stt_raw_text: '며느리가 불쌍해요',
        utterance_source: 'synthetic_adult',
      })
      const 셋 = await insertMessage(tx, {
        session_id,
        scene_id: 씨.scene_ids.sc_test_05,
        speaker_type: 'character',
        text: '다음 장면 첫 대사',
      })

      expect([하나.turn_order, 둘.turn_order, 셋.turn_order]).toEqual([1, 2, 3])

      const 행 = await readMessage(tx, 둘.id)
      expect(행?.text).toBe('며느리가 불쌍해요')
      expect(행?.utterance_source).toBe('synthetic_adult')
      expect(행?.stt_raw_text).toBe('며느리가 불쌍해요')
      expect(await readMessage(tx, randomUUID())).toBeNull()
      expect(await lastChildMessageId(tx, session_id)).toBe(둘.id)
    })
  })

  it('직전 캐릭터 말은 **현재 장면**의 마지막 한 줄뿐이다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const session_id = await createSession(tx, { story_id: 씨.story_id, child_id: randomUUID() })
      const 대화1 = 씨.scene_ids.sc_test_03
      const 대화2 = 씨.scene_ids.sc_test_05

      await insertMessage(tx, {
        session_id,
        scene_id: 대화1,
        speaker_type: 'character',
        text: '장면3 첫 대사',
      })
      await insertMessage(tx, {
        session_id,
        scene_id: 대화1,
        speaker_type: 'child',
        text: '아이 말',
      })
      await insertMessage(tx, {
        session_id,
        scene_id: 대화1,
        speaker_type: 'character',
        text: '장면3 둘째 대사',
      })

      expect(await lastCharacterMessage(tx, { session_id, scene_id: 대화1 })).toBe(
        '장면3 둘째 대사',
      )
      // 장면이 바뀌면 캐릭터가 바뀌므로 장면 밖은 보지 않는다.
      expect(await lastCharacterMessage(tx, { session_id, scene_id: 대화2 })).toBeNull()
    })
  })

  it('장면 대화는 turn_order 순이고, 이번 발화는 빼고 읽을 수 있다', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const session_id = await createSession(tx, { story_id: 씨.story_id, child_id: randomUUID() })
      const scene_id = 씨.scene_ids.sc_test_03

      await insertMessage(tx, { session_id, scene_id, speaker_type: 'character', text: '첫 대사' })
      const 아이 = await insertMessage(tx, {
        session_id,
        scene_id,
        speaker_type: 'child',
        text: '아이 말',
      })
      await insertMessage(tx, {
        session_id,
        scene_id: 씨.scene_ids.sc_test_05,
        speaker_type: 'character',
        text: '딴 장면',
      })

      const 전부 = await sceneMessages(tx, { session_id, scene_id })
      expect(전부.map((행) => 행.text)).toEqual(['첫 대사', '아이 말'])

      const 이번_발화_전 = await sceneMessages(tx, {
        session_id,
        scene_id,
        before_turn_order: 아이.turn_order,
      })
      expect(이번_발화_전.map((행) => 행.text)).toEqual(['첫 대사'])
    })
  })

  it('분석은 **후처리 전 원본**을 그대로 넣는다 (결정 26)', async () => {
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      const session_id = await createSession(tx, { story_id: 씨.story_id, child_id: randomUUID() })
      const 아이 = await insertMessage(tx, {
        session_id,
        scene_id: 씨.scene_ids.sc_test_03,
        speaker_type: 'child',
        text: '며느리가 창피했을 것 같아',
      })

      const id = await insertAnalysis(tx, {
        message_id: 아이.id,
        analysis: {
          child_intent: 'EMOTION',
          main_point: '며느리가 창피했을 것 같다',
          detected_elements: [{ type: 'EMPATHY', evidence: '창피했을 것 같아' }],
          utterance_validity: 'VALID',
        },
      })

      const [행] = await tx
        .select()
        .from(utterance_analyses)
        .where(eq(utterance_analyses.id, id))
      expect(행.message_id).toBe(아이.id)
      expect(행.child_intent).toBe('EMOTION')
      expect(행.detected_elements).toEqual([{ type: 'EMPATHY', evidence: '창피했을 것 같아' }])
      expect(행.utterance_validity).toBe('VALID')
      // 어느 규격이 낸 결과인지 남는다. **우리가 적어 보낸 값**이다 (아래 검사가 그걸 잰다).
      expect(행.analysis_version).toBe('mvp_v1')
    })
  })

  it('⭐ 기본값을 떼어 낸 표에 넣어도 `analysis_version` 이 채워진다 (저쪽 스키마 흉내)', async () => {
    // 🔴 저쪽(팀 repo) `utterance_analyses.analysis_version` 은 **nullable · 기본값 없음**이다.
    //    우리 표는 `NOT NULL DEFAULT 'mvp_v1'` 이라, 값을 안 실어 보내도 우리 DB 에서는
    //    똑같이 돈다 — 그래서 옮겨 얹고 나서야 **전 행이 NULL** 인 것을 알게 된다.
    //    저쪽 모양을 이 트랜잭션 안에서만 만들어(끝나면 되돌아간다) 그 자리를 지금 잰다.
    //    ⚠️ 파이썬은 이 칸을 한 번도 안 실어 보냈다. 이식하며 **더한** 것이 맞다.
    await 트랜잭션(async (tx) => {
      await tx.execute(
        sql`alter table utterance_analyses
              alter column analysis_version drop default,
              alter column analysis_version drop not null`,
      )

      const 씨 = await 콘텐츠_넣기(tx)
      const session_id = await createSession(tx, { story_id: 씨.story_id, child_id: randomUUID() })
      const 아이 = await insertMessage(tx, {
        session_id,
        scene_id: 씨.scene_ids.sc_test_03,
        speaker_type: 'child',
        text: '며느리가 창피했을 것 같아',
      })
      const id = await insertAnalysis(tx, {
        message_id: 아이.id,
        analysis: {
          child_intent: 'EMOTION',
          main_point: '며느리가 창피했을 것 같다',
          detected_elements: [],
          utterance_validity: 'VALID',
        },
      })

      const [행] = await tx.select().from(utterance_analyses).where(eq(utterance_analyses.id, id))
      expect(행.analysis_version).toBe(분석_규격)
      expect(행.analysis_version).not.toBeNull()
    })
  })

  it('검사가 넣은 행은 되돌려진다 — 이 파일이 몇 번을 돌아도 DB 가 그대로다', async () => {
    let 남긴_세션 = ''
    await 트랜잭션(async (tx) => {
      const 씨 = await 콘텐츠_넣기(tx)
      남긴_세션 = await createSession(tx, { story_id: 씨.story_id, child_id: randomUUID() })
    })
    const 남았나 = await getDb()
      .select({ id: story_sessions.id })
      .from(story_sessions)
      .where(eq(story_sessions.id, 남긴_세션))
    expect(남았나).toEqual([])
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// 저장-5 회차와 llm_calls
// ═══════════════════════════════════════════════════════════════════════════

async function 회차_씨앗(tx: Conn): Promise<{ 씨: 씨앗; session_id: string; run_id: string }> {
  const 씨 = await 콘텐츠_넣기(tx)
  const session_id = await createSession(tx, { story_id: 씨.story_id, child_id: randomUUID() })
  const 회차 = await createRun(tx, {
    session_id,
    scope: 'story',
    scene_order: null,
    started_by: '검사',
    analysis_model: 'gemini-3.5-flash-lite',
    analysis_effort: 'low',
    character_model: 'gemini-3.5-flash-lite',
    character_effort: 'low',
    default_utterance_source: 'synthetic_adult',
    prompt_version: 'mvp_v1',
  })
  return { 씨, session_id, run_id: 회차.id }
}

검사('repo/runs — 회차와 llm_calls', () => {
  it('회차를 만들고 읽는다. 세션당 하나다', async () => {
    await 트랜잭션(async (tx) => {
      const { session_id, run_id } = await 회차_씨앗(tx)
      const 회차 = await readRun(tx, run_id)

      expect(회차.session_id).toBe(session_id)
      expect(회차.scope).toBe('story')
      expect(회차.scene_order).toBeNull()
      expect(회차.prompt_version).toBe('mvp_v1')
      expect(회차.ended_at).toBeNull()

      expect((await readRunBySession(tx, session_id))?.id).toBe(run_id)
      expect(await readRunBySession(tx, randomUUID())).toBeNull()
      expect((await listRuns(tx)).map((행) => 행.id)).toContain(run_id)
      await expect(readRun(tx, randomUUID())).rejects.toThrow(LookupError)
    })
  })

  it('끝난 시각은 처음 한 번만 찍힌다', async () => {
    await 트랜잭션(async (tx) => {
      const { run_id } = await 회차_씨앗(tx)
      const 처음 = await endRun(tx, run_id)
      expect(처음.ended_at).not.toBeNull()
      const 두번째 = await endRun(tx, run_id)
      expect(두번째.ended_at?.getTime()).toBe(처음.ended_at?.getTime())
      await expect(endRun(tx, randomUUID())).rejects.toThrow(LookupError)
    })
  })

  it('시도 하나가 한 행이고 **실패한 시도도 남는다** (결정 33)', async () => {
    await 트랜잭션(async (tx) => {
      const { 씨, session_id, run_id } = await 회차_씨앗(tx)
      const 아이 = await insertMessage(tx, {
        session_id,
        scene_id: 씨.scene_ids.sc_test_03,
        speaker_type: 'child',
        text: '아이 말',
      })

      const 넣음 = await insertAttempts(tx, {
        run_id,
        message_id: 아이.id,
        attempts: [
          시도({ ok: false, response_text: null, error: 'APIError: 429', input_tokens: null, output_tokens: null }),
          시도(),
          시도({ purpose: 'character', response_text: '아이고 부끄러워라' }),
        ],
      })

      // 용도마다 따로 1 부터 센다.
      expect(넘겨진_번호(넣음)).toEqual([
        ['analysis', 1],
        ['analysis', 2],
        ['character', 1],
      ])
      expect(넣음[0].ok).toBe(false)
      expect(넣음[0].error).toBe('APIError: 429')
      expect(넣음[0].response_text).toBeNull()
      // ⭐ 예산 판단(B-4)의 근거. 이 두 칸이 없으면 gpt-5-nano 가 싼지 알 수 없다.
      expect(넣음[1].input_tokens).toBe(100)
      expect(넣음[1].output_tokens).toBe(20)
      expect(넣음[1].duration_ms).toBe(1234)
      expect(넣음[1].provider).toBe('gemini')
      expect(넣음[1].effort).toBe('low')
      expect(넣음[2].message_id).toBe(아이.id)
    })
  })

  it('같은 턴을 다시 보내면 attempt_no 가 **이어서** 매겨진다 (결정 44)', async () => {
    await 트랜잭션(async (tx) => {
      const { 씨, session_id, run_id } = await 회차_씨앗(tx)
      const 아이 = await insertMessage(tx, {
        session_id,
        scene_id: 씨.scene_ids.sc_test_03,
        speaker_type: 'child',
        text: '아이 말',
      })

      await insertAttempts(tx, {
        run_id,
        message_id: 아이.id,
        attempts: [시도({ ok: false, error: '첫판 실패' }), 시도()],
      })
      const 다시 = await insertAttempts(tx, {
        run_id,
        message_id: 아이.id,
        attempts: [시도(), 시도({ purpose: 'character' })],
      })

      // 다시 1 부터 세면 (message_id, purpose, attempt_no) 가 같은 행이 두 벌 생긴다.
      expect(넘겨진_번호(다시)).toEqual([
        ['analysis', 3],
        ['character', 1],
      ])
    })
  })

  it('message_id 가 없는 시도(장면 밖 호출)는 1 부터 센다', async () => {
    await 트랜잭션(async (tx) => {
      const { run_id } = await 회차_씨앗(tx)
      const 넣음 = await insertAttempts(tx, {
        run_id,
        message_id: null,
        attempts: [시도(), 시도()],
      })
      expect(넘겨진_번호(넣음)).toEqual([
        ['analysis', 1],
        ['analysis', 2],
      ])
      expect(넣음[0].message_id).toBeNull()
    })
  })

  it('회차·턴으로 시도를 읽고, 실패 사유는 기록에서 되살린다', async () => {
    await 트랜잭션(async (tx) => {
      const { 씨, session_id, run_id } = await 회차_씨앗(tx)
      const 턴1 = await insertMessage(tx, {
        session_id,
        scene_id: 씨.scene_ids.sc_test_03,
        speaker_type: 'child',
        text: '첫 턴',
      })
      const 턴2 = await insertMessage(tx, {
        session_id,
        scene_id: 씨.scene_ids.sc_test_03,
        speaker_type: 'child',
        text: '둘째 턴',
      })
      await insertAttempts(tx, {
        run_id,
        message_id: 턴1.id,
        attempts: [시도({ ok: false, error: 'TimeoutError: 30s' }), 시도()],
      })
      await insertAttempts(tx, { run_id, message_id: 턴2.id, attempts: [시도()] })

      expect(await readAttempts(tx, { run_id })).toHaveLength(3)
      expect(await readAttempts(tx, { run_id, message_id: 턴2.id })).toHaveLength(1)

      const 사유들 = await failureReasons(tx, { run_id, message_id: 턴1.id })
      expect(사유들).toHaveLength(1)
      expect(사유들[0].error).toBe('TimeoutError: 30s')
      expect(사유들[0].provider).toBe('gemini')
      expect(await failureReasons(tx, { run_id, message_id: 턴2.id })).toEqual([])
    })
  })

  it('토큰 합계는 숫자로 오고, 하나라도 모르면 합계도 모름이다', async () => {
    await 트랜잭션(async (tx) => {
      const { 씨, session_id, run_id } = await 회차_씨앗(tx)
      const 턴 = await insertMessage(tx, {
        session_id,
        scene_id: 씨.scene_ids.sc_test_03,
        speaker_type: 'child',
        text: '아이 말',
      })
      await insertAttempts(tx, {
        run_id,
        message_id: 턴.id,
        attempts: [시도(), 시도({ input_tokens: 50, output_tokens: 5, duration_ms: 1000 })],
      })

      const 합계 = await attemptTotals(tx, { run_id, message_id: 턴.id })
      // ⚠️ 문자열이 아니라 숫자여야 한다 — postgres-js 는 bigint 를 문자열로 준다.
      expect(합계).toEqual({
        attempt_count: 2,
        duration_ms: 2234,
        input_tokens: 150,
        output_tokens: 25,
      })

      // 모르는 값이 하나 섞이면 0 으로 채우지 않고 모름으로 둔다.
      await insertAttempts(tx, {
        run_id,
        message_id: 턴.id,
        attempts: [시도({ input_tokens: null, duration_ms: 10 })],
      })
      const 이제 = await attemptTotals(tx, { run_id, message_id: 턴.id })
      expect(이제.attempt_count).toBe(3)
      expect(이제.duration_ms).toBe(2244)
      expect(이제.input_tokens).toBeNull()
      expect(이제.output_tokens).toBe(45)
    })
  })

  it('llm_calls 는 purpose 를 analysis·character 로만 받는다 (바꿔 주지 않는다)', async () => {
    await 트랜잭션(async (tx) => {
      const { run_id } = await 회차_씨앗(tx)
      // 파이썬은 `{"분석": "analysis"}` 표로 옮겨 담았다. 여기서는 옮겨 담지 않으므로
      // 부르는 쪽이 처음부터 컬럼 값을 써야 하고, 아니면 DB 가 거절한다.
      const 오류 = await insertAttempts(tx, {
        run_id,
        message_id: null,
        attempts: [시도({ purpose: '분석' })],
      }).then(
        () => null,
        (e: unknown) => e,
      )
      // 드리즐은 진짜 사유를 `cause` 에 담고 겉에는 문장만 보여 준다.
      const 사유 = 오류 instanceof Error && 오류.cause instanceof Error ? 오류.cause.message : ''
      expect(사유).toMatch(/llm_calls_purpose_check/)
    })
  })
})

/** 검사 눈으로 보기 좋게 (용도, 번호) 짝만 뽑는다. */
function 넘겨진_번호(행들: (typeof llm_calls.$inferSelect)[]): [string, number][] {
  return 행들.map((행) => [행.purpose, 행.attempt_no])
}

// ═══════════════════════════════════════════════════════════════════════════

검사('repo/turn-conditions — 턴별 상태·판정 박제', () => {
  /** 아이 메시지 하나를 넣고 그 턴의 판정을 박제한다. */
  async function 턴_하나(
    tx: Conn,
    session_id: string,
    run_id: string,
    scene_id: string,
    덮어쓰기: Partial<TurnConditionInput> = {},
  ): Promise<string> {
    const 메시지 = await insertMessage(tx, {
      session_id,
      scene_id,
      speaker_type: 'child',
      text: '며느리가 창피했을 것 같아',
      utterance_source: 'synthetic_adult',
    })
    await upsertTurnCondition(tx, {
      message_id: 메시지.id,
      run_id,
      seed_revision: 0,
      prompt_version: 'mvp_v1',
      current_child_turn_count: 1,
      accumulated_elements: ['EMPATHY'],
      last_response_mode: null,
      turns_without_new_element: 0,
      consecutive_low_information_turns: 0,
      response_mode: 판정.response_mode,
      guidance_target: 판정.guidance_target,
      soft_cue: 판정.soft_cue,
      reaction_key: 판정.reaction_key,
      scene_goal_met: 판정.scene_goal_met,
      scene_end_reason: 판정.scene_end_reason,
      ...덮어쓰기,
    })
    return 메시지.id
  }

  it('지난 턴의 상태와 판정을 그대로 되살린다', async () => {
    await 트랜잭션(async (tx) => {
      const { 씨, session_id, run_id } = await 회차_씨앗(tx)
      await enterScene(tx, session_id, 씨.scene_ids.sc_test_03)
      const message_id = await 턴_하나(tx, session_id, run_id, 씨.scene_ids.sc_test_03)

      const 행 = await readTurnCondition(tx, message_id)
      expect(행).not.toBeNull()
      // [상태] 줄
      expect(행!.current_child_turn_count).toBe(1)
      expect(행!.accumulated_elements).toEqual(['EMPATHY'])
      expect(행!.last_response_mode).toBeNull()
      expect(행!.turns_without_new_element).toBe(0)
      expect(행!.consecutive_low_information_turns).toBe(0)
      // [판정] 줄
      expect(행!.response_mode).toBe('GUIDED')
      expect(행!.guidance_target).toBe('SOLUTION')
      expect(행!.soft_cue).toBe(false)
      expect(행!.reaction_key).toBe('directResponse')
      expect(행!.scene_goal_met).toBe(false)
      expect(행!.scene_end_reason).toBeNull()
      // 회차에서 베껴 박제한다
      expect(행!.prompt_version).toBe('mvp_v1')
    })
  })

  it('판정이 안 난 턴은 null 이다', async () => {
    await 트랜잭션(async (tx) => {
      expect(await readTurnCondition(tx, randomUUID())).toBeNull()
    })
  })

  it('⭐ 판정을 다시 돌리면 덮어쓴다 — 턴당 한 행이다', async () => {
    // 관리자 화면이 모드를 바꿔 ② 를 다시 돌리는 것이 이 레포의 존재 이유다.
    // 두 번째 판정이 행을 늘리면 턴 로그가 같은 턴을 두 번 그린다.
    await 트랜잭션(async (tx) => {
      const { 씨, session_id, run_id } = await 회차_씨앗(tx)
      await enterScene(tx, session_id, 씨.scene_ids.sc_test_03)
      const message_id = await 턴_하나(tx, session_id, run_id, 씨.scene_ids.sc_test_03)

      await upsertTurnCondition(tx, {
        message_id,
        run_id,
        seed_revision: 0,
        prompt_version: 'mvp_v1',
        current_child_turn_count: 1,
        accumulated_elements: ['EMPATHY', 'REASON'],
        last_response_mode: 'GUIDED',
        turns_without_new_element: 0,
        consecutive_low_information_turns: 0,
        response_mode: 'NORMAL',
        guidance_target: null,
        soft_cue: true,
        reaction_key: 'empathyFromChild',
        scene_goal_met: false,
        scene_end_reason: null,
      })

      const 행 = await readTurnCondition(tx, message_id)
      expect(행!.response_mode).toBe('NORMAL')
      expect(행!.soft_cue).toBe(true)
      expect(행!.accumulated_elements).toEqual(['EMPATHY', 'REASON'])
      expect(await readRunTurnConditions(tx, run_id)).toHaveLength(1)
    })
  })

  it('회차의 판정을 아이가 말한 순서대로 준다 — 장면이 바뀌어도 안 뒤섞인다', async () => {
    // ⚠️ current_child_turn_count 로 세우면 장면이 바뀔 때 1 로 돌아가 뒤섞인다.
    await 트랜잭션(async (tx) => {
      const { 씨, session_id, run_id } = await 회차_씨앗(tx)

      await enterScene(tx, session_id, 씨.scene_ids.sc_test_03)
      await 턴_하나(tx, session_id, run_id, 씨.scene_ids.sc_test_03, {
        current_child_turn_count: 1,
        reaction_key: '장면3-첫턴',
      })
      await 턴_하나(tx, session_id, run_id, 씨.scene_ids.sc_test_03, {
        current_child_turn_count: 2,
        reaction_key: '장면3-둘째턴',
      })
      await enterScene(tx, session_id, 씨.scene_ids.sc_test_05)
      await 턴_하나(tx, session_id, run_id, 씨.scene_ids.sc_test_05, {
        current_child_turn_count: 1, // 장면이 바뀌어 1 로 돌아갔다
        reaction_key: '장면5-첫턴',
      })

      const 행들 = await readRunTurnConditions(tx, run_id)
      expect(행들.map((행) => 행.reaction_key)).toEqual([
        '장면3-첫턴',
        '장면3-둘째턴',
        '장면5-첫턴',
      ])
    })
  })

  it('⭐ 메시지를 지우면 같이 사라진다 — 원본 003 의 함정을 닫았다', async () => {
    // 원본 sql/003 은 맨 REFERENCES 라 001 의 CASCADE 를 무력화했다.
    // 회차가 한 번이라도 돈 세션은 DELETE 가 막혔다. 여기서는 안 막힌다.
    await 트랜잭션(async (tx) => {
      const { 씨, session_id, run_id } = await 회차_씨앗(tx)
      await enterScene(tx, session_id, 씨.scene_ids.sc_test_03)
      const message_id = await 턴_하나(tx, session_id, run_id, 씨.scene_ids.sc_test_03)

      await tx.delete(messages).where(eq(messages.id, message_id))
      expect(await readTurnCondition(tx, message_id)).toBeNull()
    })
  })
})
