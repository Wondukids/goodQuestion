// 가짜 완주 — **관리자 화면이 쓰는 경로 그대로** 장면 1→9 를 끝까지 돈다 (이슈 #26 · 레인 A).
//
// ## 왜 이 파일이 따로 있나 — 이미 있는 완주 검사는 다른 길을 돈다
//
// `tests/service.test.ts` 의 완주 검사는 **터미널 경로**(`runStory()`)다. 한 함수가 스스로
// 장면을 열고 발화를 받아 끝까지 돈다. **화면은 그 길로 안 간다.** 화면은 사람이 단추를
// 누를 때마다 서비스 함수를 **따로따로** 부른다 (`app/(admin)/runs/actions.ts`) —
//
//   `startRunAction` → `startRunStep()` + `advanceStep()`
//   `advanceAction`  → `advanceStep()`          (「계속」 · 전개 재생)
//   `turnAction`     → `submitTurn()`           (아이 발화 한 건)
//
// 그 호출과 호출 **사이**가 배선이다. 옮겨 담는 자리이고, 이 레포에서 버그가 실제로 세 번
// 나온 곳이다(인계 「옮겨 담는 자리가 버그가 사는 곳」). 진짜 LLM 으로 완주하면 아이 턴이
// 열두어 개라 10~20분이 든다. 3장면에서 배선이 틀린 것을 그 뒤에 알면 20분이 통째로 버려진다.
// **이 검사는 같은 길을 몇 초에 돈다.** 그리고 그 뒤로도 회귀 그물로 남는다.
//
// ## ⭐ 숫자가 지난 회차 기준선과 **같아야** 한다
//
// 인계에 박힌 진짜 완주 기준선은 메시지 28행 · `turn_conditions` 12행 · LLM 20건
// (분석 12 + 캐릭터 8) · 모드 NORMAL 6 / GUIDED 2 / CLOSING 4 (`GOAL_MET` 3 · `MAX_TURNS` 1) 이다.
// 아래 「대본」은 그 숫자가 그대로 나오게 짜 뒀다 — 진짜 회차와 **같은 모양**을 재야 이 그물이
// 진짜 완주의 대역이 된다. 숫자가 어긋나면 대본이 아니라 진행 규칙이 바뀐 것이다.
//
// ## LLM 은 SDK 생성자 자리에서 가짜로 바꾼다 — 한 겹 위를 mock 하지 않는다
//
// F-1 그물(`tests/support/sdk-gate.ts`)이 `GoogleGenAI`·`Anthropic` **클라이언트를 만드는
// 순간** 터뜨린다. 가짜를 안 꽂으면 그 자리에서 죽으므로 진짜 호출이 나갈 길이 없다.
// ⛔ 게이트웨이(`lib/llm`)를 `vi.mock` 하지 않는 이유는 이 검사가 재려는 것이
// **「전개 장면에서 호출 0건」·「CLOSING 턴에 캐릭터 호출 0건」**이기 때문이다. 그건 SDK 자리에서
// 세야 진짜로 센 것이고, 덤으로 **실제로 나간 글자**(모델 이름·아이 발화 원문)까지 잴 수 있다.
//
// ## 진짜 DB 를 쓰고 끝나면 되돌린다
//
// `tests/service.test.ts`·`tests/repo.test.ts` 와 같은 방식이다 — 트랜잭션을 열고 무조건 롤백한다.
// 배선의 알맹이가 「무엇이 어느 순서로 저장되나」라서 가짜 DB 로는 잴 것이 남지 않는다.
// ⚠️ **`npx tsx db/seed.ts` 를 한 번도 안 돌린 DB 라면 빨개진다. 그게 맞다** — 콘텐츠의 정본은
//    `sql/002_seed_banggui.sql`(=`db/seed.ts`)이고, 그것이 없으면 잴 대상 자체가 없다.
//    DB 자체에 못 붙는 것과는 다르다. 그쪽은 아래 문지기가 `describe.skip` 으로 갈라 놓는다.

import { asc, eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { llm_calls, messages, scores } from '@/llm/db/schema'
import { loadSettings } from '@/llm/config'
import { closeDb, getDb, type Conn } from '@/llm/repo/db'
import { readRun } from '@/llm/repo/runs'
import { readSession, sceneMessages } from '@/llm/repo/sessions'
import { readRunTurnConditions } from '@/llm/repo/turn-conditions'
import { advanceStep, runState, startRunStep, submitTurn } from '@/llm/service/run'

import { installFakeSdk } from './support/sdk-gate'

/** 「방귀 뀌는 며느리」 — 전개 다섯(1·2·4·6·8) · 대화 넷(3·5·7·9). */
const 이야기 = 'fart-bride'

// ── DB 가 있나 (repo.test.ts · service.test.ts 와 같은 문지기) ─────────────

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
    `\n[full-run.test] Postgres 에 못 붙어 완주 검사를 건너뛴다 (도커가 꺼져 있나?)\n` +
      `                ${못붙는_이유}\n\n`,
  )
}
const 검사 = 못붙는_이유 === null ? describe : describe.skip

afterAll(async () => {
  await closeDb()
})

// ── 트랜잭션을 열고 끝나면 되돌린다 ────────────────────────────────────────

class 되돌림 extends Error {}

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

// ── 가짜 제미나이 ─────────────────────────────────────────────────────────
//
// `tests/service.test.ts` 의 것을 본떴다(그 파일은 다른 레인이 쥐고 있어 손대지 않는다).
// 다른 점 하나 — **드라이버가 턴마다 `요소들` 을 갈아 끼운다.** 「이번 발화에서 무엇을
// 찾아냈다고 할 것인가」가 곧 모드 갈림이라, 그 손잡이가 바깥에 있어야 한 회차 안에서
// `GOAL_MET` 과 `MAX_TURNS` 를 **둘 다** 만들 수 있다.

interface 가짜_호출 {
  용도: '분석' | '대사'
  /** SDK 본문에 실제로 실린 모델 이름. 회차에 박힌 값이 여기까지 오는지 본다. */
  model: string
  user: string
  system: string
}

interface 가짜_기록 {
  호출: 가짜_호출[]
  /** 다음 분석이 「찾아냈다」고 할 요소들. 드라이버가 턴마다 갈아 끼운다. */
  요소들: (목표: readonly string[]) => readonly string[]
}

/** 재료 JSON 에서 `target_elements` 를 되읽는다 — 콘텐츠가 실제로 실려 나갔다는 증거이기도 하다. */
function 목표_뽑기(user: string): string[] {
  const 맞은것 = /"target_elements":\[([^\]]*)\]/.exec(user)
  if (맞은것 === null || 맞은것[1].trim() === '') return []
  return JSON.parse(`[${맞은것[1]}]`) as string[]
}

function 뽑기(user: string, 열쇠: string): string {
  const 맞은것 = new RegExp(`"${열쇠}":"((?:[^"\\\\]|\\\\.)*)"`).exec(user)
  return 맞은것 === null ? '' : (JSON.parse(`"${맞은것[1]}"`) as string)
}

/**
 * SDK 자리에 가짜를 꽂는다. 분석과 대사는 **`response_format` 유무**로 가른다 —
 * 분석만 JSON 스키마를 실어 보내기 때문이다 (`lib/llm/index.ts` 의 `geminiRequest()`).
 */
function 가짜_제미나이(): 가짜_기록 {
  const 기록: 가짜_기록 = { 호출: [], 요소들: (목표) => 목표 }

  installFakeSdk('gemini', () => ({
    interactions: {
      create: async (요청: Record<string, unknown>) => {
        const user = String(요청.input ?? '')
        const 분석인가 = 요청.response_format !== undefined
        기록.호출.push({
          용도: 분석인가 ? '분석' : '대사',
          model: String(요청.model ?? ''),
          user,
          system: String(요청.system_instruction ?? ''),
        })

        if (분석인가) {
          const 발화 = 뽑기(user, 'child_utterance')
          return {
            output_text: JSON.stringify({
              child_intent: 'OPINION',
              main_point: 발화,
              // evidence 를 아이 발화 원문으로 둔다 — 그래야 후처리(`postProcess`)를 그대로
              // 통과한다. 여기서 걸러지면 대본이 아니라 후처리를 재게 된다.
              detected_elements: 기록.요소들(목표_뽑기(user)).map((type) => ({
                type,
                evidence: 발화,
              })),
              utterance_validity: 'VALID',
            }),
            usage_metadata: { prompt_token_count: 100, candidates_token_count: 20 },
          }
        }

        return {
          output_text: `그러게 말이다 (${기록.호출.length}번째)`,
          usage_metadata: { prompt_token_count: 200, candidates_token_count: 30 },
        }
      },
    },
  }))

  return 기록
}

// ── 대본 — 「가짜 아이」가 장면마다 무엇을 보이나 ──────────────────────────
//
// ⭐ **한 가지만 나오는 대본은 절반만 재는 것이다.** 요소를 다 찾아 주면 모든 장면이
//    `GOAL_MET` 으로만 닫히고 `MAX_TURNS` 갈래는 한 번도 안 밟힌다. 그래서 장면마다 다르게 짠다.
//
// | 장면 | 대본 | 왜 |
// |---|---|---|
// | 3 (pref 2 · max 4) | 첫 턴부터 다 찾는다 | 가장 짧은 길 — 2턴 `GOAL_MET` |
// | 5 (pref 3 · max 5) | 두 턴 비우고 셋째에 다 | 「신규 요소 없음 2연속」이 **GUIDED** 를 부른다 |
// | 7 (pref 3 · max 5) | 늘 다 찾는다 | 요소가 다 모여도 `preferred_turns` 를 못 채우면 안 닫힌다 |
// | 9 (pref 2 · max 4) | 끝내 하나만 | 목표를 못 채운 채 **`MAX_TURNS`** 로 닫히는 유일한 장면 |
const 대본: Record<string, (턴: number, 목표: readonly string[]) => readonly string[]> = {
  sc_banggui_03: (_턴, 목표) => 목표,
  sc_banggui_05: (턴, 목표) => (턴 < 3 ? [] : 목표),
  sc_banggui_07: (_턴, 목표) => 목표,
  sc_banggui_09: (_턴, 목표) => 목표.slice(0, 1),
}

/**
 * 대본에서 따라 나오는 진행. **손으로 적어 둔다** — 계산해서 맞추면 규칙이 바뀌어도
 * 기대값이 같이 따라 움직여 아무것도 안 잰다.
 */
const 기대 = [
  { code: 'sc_banggui_03', modes: ['NORMAL', 'CLOSING'], end: 'GOAL_MET' },
  { code: 'sc_banggui_05', modes: ['NORMAL', 'GUIDED', 'CLOSING'], end: 'GOAL_MET' },
  { code: 'sc_banggui_07', modes: ['NORMAL', 'NORMAL', 'CLOSING'], end: 'GOAL_MET' },
  { code: 'sc_banggui_09', modes: ['NORMAL', 'GUIDED', 'NORMAL', 'CLOSING'], end: 'MAX_TURNS' },
] as const

const 아이_턴_수 = 기대.reduce((합, 장면) => 합 + 장면.modes.length, 0) // 12
const 닫는_턴_수 = 기대.length // 4 — 장면마다 마지막 한 턴이 CLOSING 이다

// ── 한 판을 돌고 잴 것을 다 담아 온다 ─────────────────────────────────────

interface 턴기록 {
  scene_code: string
  /** `decide()` 가 본 턴 번호 — 이번 발화를 **포함한** 값이다. 장면이 바뀌면 1로 돌아와야 한다. */
  scene_turn: number
  /** 이 발화 **전**의 누적 요소. 장면 첫 턴이면 비어 있어야 한다. */
  누적_전: readonly string[]
  response_mode: string
  scene_end_reason: string | null
  dialogue_source: 'generated' | 'fixed'
  dialogue_text: string
  child_utterance: string
  /** 이 턴 하나가 SDK 를 몇 번 두드렸나. CLOSING 갈림이 여기서 드러난다. */
  분석_호출: number
  대사_호출: number
}

interface 전개기록 {
  /** 이 「계속」 한 번에 재생된 전개 지문의 `scene_order` 들. */
  전개들: number[]
  /** 이 「계속」 동안 나간 SDK 호출 수. **0 이어야 한다** (경계 4 — 고정 텍스트다). */
  호출: number
  /** 이 「계속」이 연 대화 장면과 그 첫 대사 (`character_opening`). */
  연_장면: { code: string; opening: string | null; 고정본: string | null } | null
  /** 장면에 들어간 **직후**의 세션 — 앞 장면의 누적이 지워졌나. */
  들어간_직후: {
    current_child_turn_count: number
    accumulated_elements: string[]
    last_response_mode: string | null
    scene_end_reason: string | null
  } | null
}

interface 완주기록 {
  turns: 턴기록[]
  advances: 전개기록[]
  /** 마지막에 `nextStep()` 이 낸 할 일. `회차끝` 이어야 회차가 닫힌 것이다. */
  마지막_할일: string
  session: { status: string; completed_at: Date | null }
  run: { ended_at: Date | null; scored_at: Date | null }
  메시지들: { id: string; speaker_type: string; scene_code: string; text: string }[]
  turn_conditions: number
  llm_calls: { purpose: string; ok: boolean }[]
  /** 자동 경계 채점이 남긴 행 (`lib/judge.ts` → `scores`). `graded_by='auto'` 만 나온다. */
  scores: {
    message_id: string | null
    check_name: string
    value: number | null
    comment: string | null
    graded_by: string
    target: string
    llm_call_id: string | null
  }[]
  /** 닫는 대사의 정본 — `story_scenes.character_closing` 원문. */
  고정_마지막대사: Record<string, string | null>
  호출: 가짜_호출[]
  printed: string[]
  모델: string
}

/** 아이 발화. 장면·턴마다 다르게 둬서 「어느 발화가 어느 호출에 실렸나」를 글자로 가를 수 있게 한다. */
function 발화(code: string, 턴: number): string {
  return `며느리가 창피했을 것 같아 (${code} ${턴}번째)`
}

/**
 * 화면이 누르는 순서 그대로 한 회차를 완주시킨다.
 *
 * ⛔ **`runStory()` 를 부르지 않는다.** 그 함수를 부르면 이 검사가 재려던 배선이 통째로
 *    빠진다 — 화면은 그것을 못 부른다(`app/` 은 `conn` 을 손에 쥘 수 없다).
 */
async function 한판(tx: Conn, 기록: 가짜_기록, printed: string[]): Promise<완주기록> {
  const 바닥 = loadSettings()
  // `startRunAction` 이 넘기는 것과 같은 모양 — **빈 칸을 NULL 로 두지 않는다.**
  const { run } = await startRunStep({
    story_code: 이야기,
    scope: 'story',
    scene_order: null,
    started_by: '가짜 완주 검사',
    analysis_model: 바닥.gemini_model,
    analysis_effort: 바닥.gemini_effort,
    character_model: 바닥.gemini_model,
    character_effort: 바닥.gemini_effort,
    conn: tx,
  })

  const turns: 턴기록[] = []
  const advances: 전개기록[] = []
  const 장면별_턴 = new Map<string, number>()
  let 마지막_할일 = ''

  for (let 걸음 = 0; ; 걸음 += 1) {
    // 진행이 제자리를 돌면 여기서 끊는다. 안 끊으면 검사가 영원히 매달린다.
    if (걸음 > 40) throw new Error(`완주가 안 끝난다 — ${걸음} 걸음째. 진행이 제자리를 돈다`)

    const { step, scenes } = await runState(tx, run.id)
    마지막_할일 = step.kind
    if (step.kind === '회차끝') break

    // ── 「계속」 단추 = `advanceAction` → `advanceStep()` ──────────────────
    if (step.kind === '장면시작') {
      const 앞_줄 = printed.length
      const 앞_호출 = 기록.호출.length
      await advanceStep({ run_id: run.id, conn: tx })

      const 뒤 = await runState(tx, run.id)
      const 연_장면 =
        뒤.step.scene_id === null
          ? null
          : (뒤.scenes.find((행) => 행.scene_id === 뒤.step.scene_id) ?? null)
      const 첫_대사 =
        연_장면 === null
          ? []
          : await sceneMessages(tx, { session_id: run.session_id, scene_id: 연_장면.scene_id })
      const 세션 = await readSession(tx, run.session_id)

      advances.push({
        전개들: printed
          .slice(앞_줄)
          .map((줄) => /^\[전개 (\d+)\]/.exec(줄))
          .filter((맞은것): 맞은것 is RegExpExecArray => 맞은것 !== null)
          .map((맞은것) => Number(맞은것[1])),
        호출: 기록.호출.length - 앞_호출,
        연_장면:
          연_장면 === null
            ? null
            : {
                code: 연_장면.code,
                opening: 첫_대사.length === 0 ? null : 첫_대사[0].text,
                고정본: 연_장면.character_opening,
              },
        들어간_직후: {
          current_child_turn_count: 세션.current_child_turn_count,
          accumulated_elements: [...세션.accumulated_elements],
          last_response_mode: 세션.last_response_mode,
          scene_end_reason: 세션.scene_end_reason,
        },
      })
      continue
    }

    if (step.kind !== '발화받기' || step.scene_id === null) {
      throw new Error(`모르는 할 일이다: ${step.kind}`)
    }

    // ── 발화 폼의 기본 단추 = `turnAction` → `submitTurn()` ────────────────
    const 장면 = scenes.find((행) => 행.scene_id === step.scene_id)
    if (장면 === undefined) throw new Error(`장면 목록에 없는 scene_id 다: ${step.scene_id}`)

    const 턴 = (장면별_턴.get(장면.code) ?? 0) + 1
    장면별_턴.set(장면.code, 턴)
    const 짜인_대본 = 대본[장면.code]
    if (짜인_대본 === undefined) throw new Error(`대본에 없는 대화 장면이다: ${장면.code}`)
    기록.요소들 = (목표) => 짜인_대본(턴, 목표)

    const 앞_분석 = 기록.호출.filter((하나) => 하나.용도 === '분석').length
    const 앞_대사 = 기록.호출.filter((하나) => 하나.용도 === '대사').length
    const 말 = 발화(장면.code, 턴)
    const 결과 = await submitTurn({ run_id: run.id, child_utterance: 말, conn: tx })

    turns.push({
      scene_code: 장면.code,
      scene_turn: 결과.state.current_child_turn_count,
      누적_전: [...결과.state.accumulated_elements],
      response_mode: 결과.decision.response_mode,
      scene_end_reason: 결과.decision.scene_end_reason,
      dialogue_source: 결과.dialogue.source,
      dialogue_text: 결과.dialogue.text,
      child_utterance: 말,
      분석_호출: 기록.호출.filter((하나) => 하나.용도 === '분석').length - 앞_분석,
      대사_호출: 기록.호출.filter((하나) => 하나.용도 === '대사').length - 앞_대사,
    })
  }

  // ── 끝난 뒤에 DB 를 한 번 훑는다 (롤백 전에 담아 둬야 한다) ───────────────
  const { scenes } = await runState(tx, run.id)
  const 장면이름 = new Map(scenes.map((행) => [행.scene_id, 행.code]))

  const 메시지_행 = await tx
    .select({
      id: messages.id,
      speaker_type: messages.speaker_type,
      scene_id: messages.scene_id,
      text: messages.text,
    })
    .from(messages)
    .where(eq(messages.session_id, run.session_id))
    .orderBy(asc(messages.turn_order))

  const 호출_행 = await tx
    .select({ purpose: llm_calls.purpose, ok: llm_calls.ok })
    .from(llm_calls)
    .where(eq(llm_calls.run_id, run.id))

  const 채점_행 = await tx
    .select({
      message_id: scores.message_id,
      check_name: scores.check_name,
      value: scores.value,
      comment: scores.comment,
      graded_by: scores.graded_by,
      target: scores.target,
      llm_call_id: scores.llm_call_id,
    })
    .from(scores)
    .where(eq(scores.run_id, run.id))
    .orderBy(asc(scores.created_at), asc(scores.id))

  const 세션 = await readSession(tx, run.session_id)
  const 회차 = await readRun(tx, run.id)

  return {
    turns,
    advances,
    마지막_할일,
    session: { status: 세션.status, completed_at: 세션.completed_at },
    run: { ended_at: 회차.ended_at, scored_at: 회차.scored_at },
    메시지들: 메시지_행.map((행) => ({
      id: 행.id,
      speaker_type: 행.speaker_type,
      scene_code: 장면이름.get(행.scene_id) ?? '?',
      text: 행.text,
    })),
    turn_conditions: (await readRunTurnConditions(tx, run.id)).length,
    llm_calls: 호출_행,
    scores: 채점_행,
    고정_마지막대사: Object.fromEntries(scenes.map((행) => [행.code, 행.character_closing])),
    호출: 기록.호출,
    printed,
    모델: 바닥.gemini_model,
  }
}

/** 한 번만 돌린다. 단언마다 다시 돌리면 진짜 DB 를 열두 턴씩 몇 번이고 두드린다. */
async function 완주한다(): Promise<완주기록> {
  const printed: string[] = []
  const 기록 = 가짜_제미나이()
  const 원래_log = vi.spyOn(console, 'log').mockImplementation((...조각들: unknown[]) => {
    printed.push(조각들.map((하나) => String(하나)).join(' '))
  })
  try {
    let 결과: 완주기록 | null = null
    await 트랜잭션(async (tx) => {
      결과 = await 한판(tx, 기록, printed)
    })
    if (결과 === null) throw new Error('완주가 아무것도 안 남겼다')
    return 결과
  } finally {
    원래_log.mockRestore()
  }
}

// ═══════════════════════════════════════════════════════════════════════════

검사('완주 — 화면 경로로 「방귀 뀌는 며느리」 장면 1→9', () => {
  let 완주!: 완주기록

  beforeAll(async () => {
    // ⚠️ `installFakeSdk()` 는 `tests/setup.ts` 의 `beforeEach` 가 매번 비운다.
    //    그래서 한 판을 여기서 **다 돌려 놓고** 아래 단언들은 그 기록만 읽는다.
    완주 = await 완주한다()
  }, 120_000)

  it('⭐ 회차가 닫힌다 — 장면 아홉을 다 지나고 nextStep 이 회차끝을 낸다', () => {
    // 이 한 줄이 「완주했다」의 정의다. 중간에 멈췄으면 여기가 `발화받기`·`장면시작` 이다.
    expect(완주.마지막_할일).toBe('회차끝')
    expect(완주.session.status).toBe('completed')
    expect(완주.session.completed_at).not.toBeNull()
    // 세션만 닫고 회차를 안 닫으면 목록 화면에 「도는 중」으로 영영 남는다.
    expect(완주.run.ended_at).not.toBeNull()

    // 대화 장면 넷을 `scene_order` 순서대로 지났다. 하나를 건너뛰면 여기서 드러난다.
    expect([...new Set(완주.turns.map((턴) => 턴.scene_code))]).toEqual(
      기대.map((장면) => 장면.code),
    )
    expect(완주.turns).toHaveLength(아이_턴_수)
  })

  it('⭐ 전개 장면 다섯은 LLM 을 한 번도 안 부른다 — 지문은 고정 텍스트다 (결정 22)', () => {
    // 전개 1·2 · 4 · 6 · 8 이 그 순서로, 그리고 **한 번씩만** 재생됐다.
    expect(완주.advances.flatMap((하나) => 하나.전개들)).toEqual([1, 2, 4, 6, 8])
    // ⭐ 「계속」 한 번마다 SDK 호출이 0 이다. 합계로 세면 대화 턴의 호출에 묻혀 안 보인다.
    expect(완주.advances.map((하나) => 하나.호출)).toEqual([0, 0, 0, 0])

    // 그 「계속」이 연 것은 대화 장면이고, 첫 대사는 `story_scenes` 원문 그대로다 (경계 4).
    expect(완주.advances.map((하나) => 하나.연_장면?.code ?? null)).toEqual(
      기대.map((장면) => 장면.code),
    )
    for (const 하나 of 완주.advances) {
      expect(하나.연_장면?.opening).toBe(하나.연_장면?.고정본)
      expect(하나.연_장면?.opening).not.toBeNull()
    }
  })

  it('🔴 CLOSING 턴에는 캐릭터 LLM 을 안 부른다 — 분석 12 · 대사 8 로 갈린다 (경계 4)', () => {
    const 닫는_턴 = 완주.turns.filter((턴) => 턴.response_mode === 'CLOSING')
    expect(닫는_턴).toHaveLength(닫는_턴_수)

    for (const 턴 of 닫는_턴) {
      // 분석은 부르고 대사는 안 부른다. **이 갈림이 경계 4 의 증거다** — 두 수가 같으면
      // CLOSING 에서도 캐릭터 LLM 이 돈 것이고, 고정 마지막 대사가 생성물로 바뀐 것이다.
      expect(턴.분석_호출).toBe(1)
      expect(턴.대사_호출).toBe(0)
      expect(턴.dialogue_source).toBe('fixed')
      expect(턴.dialogue_text).toBe(완주.고정_마지막대사[턴.scene_code])
    }
    for (const 턴 of 완주.turns.filter((턴) => 턴.response_mode !== 'CLOSING')) {
      expect(턴.분석_호출).toBe(1)
      expect(턴.대사_호출).toBe(1)
    }

    // 인계의 기준선 — 20 = 분석 12 + 캐릭터 8.
    const 분석 = 완주.호출.filter((하나) => 하나.용도 === '분석')
    const 대사 = 완주.호출.filter((하나) => 하나.용도 === '대사')
    expect(분석).toHaveLength(아이_턴_수)
    expect(대사).toHaveLength(아이_턴_수 - 닫는_턴_수)

    // ⭐ **실제로 나간 글자**로도 확인한다. 닫는 턴의 아이 발화는 어느 대사 호출에도 안 실렸다.
    const 닫는_발화 = new Set(닫는_턴.map((턴) => 턴.child_utterance))
    expect(대사.filter((하나) => [...닫는_발화].some((말) => 하나.user.includes(말)))).toEqual([])
    // 안 닫는 턴의 발화는 반대로 전부 실려 나갔다 (위 단언이 「대사가 아예 안 나갔다」로도
    // 만족되지 않게 반대쪽을 함께 박아 둔다).
    for (const 턴 of 완주.turns.filter((턴) => 턴.response_mode !== 'CLOSING')) {
      expect(대사.some((하나) => 하나.user.includes(턴.child_utterance))).toBe(true)
    }

    // 회차에 박힌 모델이 SDK 본문까지 갔다. 여기가 끊기면 회차끼리 견주는 일이 거짓이 된다.
    expect([...new Set(완주.호출.map((하나) => 하나.model))]).toEqual([완주.모델])

    // DB 쪽 기록도 같은 수여야 한다 — 호출은 갔는데 `llm_calls` 가 안 쌓이면 비용 화면이 빈다.
    expect(완주.llm_calls.filter((행) => 행.purpose === 'analysis')).toHaveLength(아이_턴_수)
    expect(완주.llm_calls.filter((행) => 행.purpose === 'character')).toHaveLength(
      아이_턴_수 - 닫는_턴_수,
    )
    expect(완주.llm_calls.every((행) => 행.ok)).toBe(true)
  })

  it('messages · turn_conditions 행 수와 speaker_type 분포가 앞뒤로 맞는다', () => {
    const 아이 = 완주.메시지들.filter((행) => 행.speaker_type === 'child')
    const 캐릭터 = 완주.메시지들.filter((행) => 행.speaker_type === 'character')

    // 아이 한 줄 · 캐릭터 한 줄이 턴마다, 거기에 장면마다 `character_opening` 한 줄.
    expect(아이).toHaveLength(아이_턴_수)
    expect(캐릭터).toHaveLength(아이_턴_수 + 기대.length)
    // 인계의 기준선 28행. 전개 장면이 한 줄이라도 남기면 여기가 어긋난다 (결정 22).
    expect(완주.메시지들).toHaveLength(아이_턴_수 * 2 + 기대.length)
    expect(완주.메시지들.filter((행) => 행.speaker_type === 'system')).toEqual([])

    // 장면별로도 맞는다 — 합계만 보면 한 장면이 넘치고 다른 장면이 모자란 것을 못 잡는다.
    for (const 장면 of 기대) {
      const 이_장면 = 완주.메시지들.filter((행) => 행.scene_code === 장면.code)
      expect(이_장면.filter((행) => 행.speaker_type === 'child')).toHaveLength(장면.modes.length)
      expect(이_장면.filter((행) => 행.speaker_type === 'character')).toHaveLength(
        장면.modes.length + 1,
      )
    }

    // 턴 판정은 아이가 말한 만큼 남는다 (턴 로그 화면과 회차 비교의 재료다).
    expect(완주.turn_conditions).toBe(아이_턴_수)
  })

  // ── 경계 채점이 실제로 붙어 도나 (이슈 #26 일감 10 · char 트랙 #22 ③) ──────
  //
  // `lib/judge.ts` 는 그 자체로는 순수 함수 묶음이라 단위 검사로 다 잴 수 있다. 여기서
  // 재는 것은 **배선**이다 — 턴을 저장할 때 정말 불리나, 어느 메시지에 붙나, 고정 대사가
  // 채점 대상에 섞이지 않나. 파이썬에서 이 자리가 `회차._자동_채점()` 이었다.

  it('🔴 턴마다 규칙 심판 셋이 돌아 scores 에 auto 로 쌓인다 (심판 LLM 은 안 켠다)', () => {
    const 이름들 = ['fabricated_fixed_line', 'closing_generated', 'scene_goal_leak']

    // 기본값은 「심판 끔」이다 (파이썬 `경계_채점(심판_포함=False)`). 켜졌다면 여섯이 된다 —
    // ⚠️ 그건 턴마다 LLM 호출이 셋 더 나갔다는 뜻이라 **돈이 새는 것을 이 줄이 잡는다.**
    expect(완주.scores).toHaveLength(아이_턴_수 * 3)
    expect(new Set(완주.scores.map((행) => 행.check_name))).toEqual(new Set(이름들))
    expect(완주.scores.every((행) => 행.graded_by === 'auto')).toBe(true)
    expect(완주.scores.every((행) => 행.target === 'utterance')).toBe(true)

    // 🔴 **아이 발화 행에 붙는다**, 캐릭터 행이 아니다 (`scores.message_id` 의 뜻).
    const 아이_id = new Set(
      완주.메시지들.filter((행) => 행.speaker_type === 'child').map((행) => 행.id),
    )
    expect(완주.scores.every((행) => 행.message_id !== null && 아이_id.has(행.message_id))).toBe(
      true,
    )

    // 턴 하나에 정확히 셋. 순서도 늘 같다.
    for (const id of 아이_id) {
      expect(완주.scores.filter((행) => 행.message_id === id).map((행) => 행.check_name)).toEqual(
        이름들,
      )
    }
  })

  it('⭐ CLOSING 턴은 고정 대사를 채점 대상으로 넘기지 않는다 (경계 4)', () => {
    // 이게 이 배선에서 제일 미끄러운 자리다. `dialogue_text` 를 그대로 채점기에 넘기면
    // 고정 마지막 대사가 「캐릭터가 지어낸 대사」로 들어가 `fabricated_fixed_line` 이
    // **CLOSING 턴마다 위반**으로 뜬다. 넘기는 것은 생성된 줄뿐이라야 한다.
    const 턴별 = 완주.메시지들
      .filter((행) => 행.speaker_type === 'child')
      .map((행, 자리) => ({ 턴: 완주.turns[자리], 점수: 완주.scores.filter((s) => s.message_id === 행.id) }))

    const 닫는 = 턴별.filter((하나) => 하나.턴.response_mode === 'CLOSING')
    expect(닫는).toHaveLength(닫는_턴_수)
    for (const 하나 of 닫는) {
      const 값 = Object.fromEntries(하나.점수.map((행) => [행.check_name, 행.value]))
      // 대사가 빈 글자로 들어갔다는 증거 — 셋 다 「지켰다」다.
      expect(값['closing_generated']).toBe(1)
      expect(값['fabricated_fixed_line']).toBe(1)
      expect(값['scene_goal_leak']).toBe(1)
    }

    // CLOSING 이 아닌 턴에서는 `closing_generated` 가 **판정 안 함**(null)으로 빠진다.
    for (const 하나 of 턴별.filter((하나) => 하나.턴.response_mode !== 'CLOSING')) {
      const 값 = Object.fromEntries(하나.점수.map((행) => [행.check_name, 행.value]))
      expect(값['closing_generated']).toBeNull()
    }
  })

  it('판정의 출처가 남는다 — 캐릭터 호출이 있던 턴만 llm_call_id 가 찬다', () => {
    const 아이_행 = 완주.메시지들.filter((행) => 행.speaker_type === 'child')
    for (const [자리, 행] of 아이_행.entries()) {
      const 점수 = 완주.scores.filter((s) => s.message_id === 행.id)
      // CLOSING 턴은 캐릭터 LLM 을 아예 안 부르므로 댈 출처가 없다.
      const 있어야 = 완주.turns[자리].response_mode !== 'CLOSING'
      for (const 하나 of 점수) {
        expect(하나.llm_call_id === null).toBe(!있어야)
      }
    }
  })

  it('회차를 닫을 때 scored_at 이 찍힌다 (파이썬 `회차_채점완료`)', () => {
    expect(완주.run.scored_at).not.toBeNull()
  })

  it('⭐ 장면이 바뀌면 누적 요소·턴 수가 0 으로 리셋된다 (안 지우면 첫 턴에 GOAL_MET)', () => {
    // 장면에 들어간 **직후**의 세션. 여기 값이 남아 있으면 다음 장면이 앞 장면을 물려받는다.
    for (const 하나 of 완주.advances) {
      expect(하나.들어간_직후?.current_child_turn_count).toBe(0)
      expect(하나.들어간_직후?.accumulated_elements).toEqual([])
      expect(하나.들어간_직후?.last_response_mode).toBeNull()
      expect(하나.들어간_직후?.scene_end_reason).toBeNull()
    }

    // 판정이 본 값으로도 확인한다 — 장면마다 1부터 다시 센다.
    for (const 장면 of 기대) {
      const 이_장면 = 완주.turns.filter((턴) => 턴.scene_code === 장면.code)
      expect(이_장면.map((턴) => 턴.scene_turn)).toEqual(
        장면.modes.map((_모드, 자리) => 자리 + 1),
      )
      // 첫 턴의 「이 발화 전 누적」이 비어 있다. 안 지우면 앞 장면 요소가 여기 남는다.
      expect(이_장면[0].누적_전).toEqual([])
    }
  })

  it('⭐ 모드가 NORMAL/GUIDED/CLOSING 로 갈리고 종료 사유가 GOAL_MET·MAX_TURNS 둘 다 나온다', () => {
    // 장면마다 모드 순서가 대본대로다. 합계만 재면 어느 장면에서 어긋났는지 못 가른다.
    for (const 장면 of 기대) {
      const 이_장면 = 완주.turns.filter((턴) => 턴.scene_code === 장면.code)
      expect(이_장면.map((턴) => 턴.response_mode)).toEqual([...장면.modes])
      // 마지막 턴에서만 장면이 닫힌다 — 그전 턴에 사유가 차면 장면이 일찍 끝난 것이다.
      expect(이_장면.map((턴) => 턴.scene_end_reason)).toEqual(
        장면.modes.map((모드) => (모드 === 'CLOSING' ? 장면.end : null)),
      )
    }

    const 셈 = (값: string) => 완주.turns.filter((턴) => 턴.response_mode === 값).length
    // 인계의 기준선 — NORMAL 6 / GUIDED 2 / CLOSING 4.
    expect({ NORMAL: 셈('NORMAL'), GUIDED: 셈('GUIDED'), CLOSING: 셈('CLOSING') }).toEqual({
      NORMAL: 6,
      GUIDED: 2,
      CLOSING: 4,
    })
    // 🔴 **둘 다** 나와야 한다. 한쪽만 나오는 완주는 장면 종료 갈래의 절반만 밟은 것이다.
    const 사유 = 완주.turns.map((턴) => 턴.scene_end_reason).filter((값) => 값 !== null)
    expect(사유.filter((값) => 값 === 'GOAL_MET')).toHaveLength(3)
    expect(사유.filter((값) => 값 === 'MAX_TURNS')).toHaveLength(1)
  })

  it('세 줄 로그가 턴마다 그 순서로 찍힌다 (이 로그가 이 레포의 존재 이유다)', () => {
    const 세줄 = 완주.printed.filter((줄) => /^\[(분석|상태|판정)\]/.test(줄))
    expect(세줄).toHaveLength(아이_턴_수 * 3)
    for (let 자리 = 0; 자리 < 아이_턴_수; 자리 += 1) {
      expect(세줄.slice(자리 * 3, 자리 * 3 + 3).map((줄) => /^\[[^\]]+\]/.exec(줄)?.[0])).toEqual([
        '[분석]',
        '[상태]',
        '[판정]',
      ])
    }
    // 장면이 닫힐 때마다 `[장면끝]` 한 줄. 화면 없이 로그만 봐도 완주가 보여야 한다.
    expect(완주.printed.filter((줄) => /^\[장면끝 /.test(줄))).toHaveLength(닫는_턴_수)
  })
})
