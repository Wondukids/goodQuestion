// 회차 — 실행과 읽기 조립, 그리고 **두 번 보내기 잠금** (이슈 #26 조립-3).
//
// 파이썬 `goodquestion_admin/회차.py` 703줄 중 **실행하는 절반**과 `진행중.py` 44줄을
// 옮긴 것이다. 읽어서 화면에 그리는 절반(`메시지_목록`·`턴_로그_줄들`·`섞인_조건`)은
// 화면 트랙이 가져간다 — 이 파일은 **회차를 돌리는 쪽**이다.
//
// ## 회차와 세션은 1:1 이다 — 그것이 잠금의 근거다
//
// `runs.session_id` 가 UNIQUE 라 (`db/schema.ts`) 「회차마다 하나」와 「세션마다 하나」가
// 같은 말이다. 그래서 **잠금은 회차 단위**이고, 같은 회차에 두 번 보내면 뒤엣것이
// `TurnInProgress`(409 · retryable) 로 튕긴다. 안 막으면 `messages` 행이 하나 더 생겨
// 턴 수가 어긋난다 (FR-035).
//
// ⚠️ 잠금은 **이 프로세스 안에서만** 유효하다. 파이썬도 같았다(모듈 전역 dict + Lock).
//    자바스크립트는 이벤트 루프가 하나라 「검사하고 넣기」 사이에 다른 코드가 끼어들지
//    못하므로 Lock 이 필요 없다 — 그것이 파이썬과 갈린 유일한 자리다.
//
// ## 세션을 만드는 라우트는 없다
//
// 회차 시작 화면이 **서버에서** `startRun()` 을 직접 부른다 (`라우트계약.md` 7절).
// ⛔ 라우트가 세션을 만들어 주지 않는다 — 「없으면 만든다」로 두면 회차 없이 돌아간 세션이
// 조용히 쌓이고, 그 행들은 어느 회차의 기록도 아니게 된다.

import { loadSettings, type Settings } from '@/llm/config'
import type { Decision } from '@/llm/domain/decide'
import { nextStep, ValueError, type Step } from '@/llm/domain/progress'
import { postProcess } from '@/llm/engine/analyze'
import { printLine, sceneEndLine } from '@/llm/log'
import { scenesOfStory, type SceneRow } from '@/llm/repo/content'
import { getDb, type Conn } from '@/llm/repo/db'
import {
  createRun,
  endRun,
  failureReasons,
  readAttempts,
  readRun,
  readRunBySession,
  type RunRow,
} from '@/llm/repo/runs'
import {
  completeSession,
  createSession,
  lastChildMessageId,
  nextMessage,
  readMessage,
  readSavedAnalysis,
  readSessionWithStory,
  sceneMessages,
  type SessionWithStory,
} from '@/llm/repo/sessions'
import { latestSeedRevision } from '@/llm/repo/seed'
import { readTurnCondition, type TurnConditionRow } from '@/llm/repo/turn-conditions'
import { experimentPrompts } from './prompt-lab'
import { advanceScenes, narrationsBefore, type Scope } from './story'
import {
  isUsableUtterance,
  runDecisionStage,
  runDialogueStage,
  runTurn,
  type DialogueStage,
  type Notify,
  type TurnResult,
} from './turn'

/** 파이썬 `회차.기본_발화_출처`. 회차에 저장되고 아이 메시지에 그대로 붙는다. */
export const 기본_발화_출처 = 'synthetic_adult'
/** 파이썬 `회차.기본_프롬프트_버전`. `turn_conditions` 에 베껴 박제한다. */
export const 기본_프롬프트_버전 = 'mvp_v1'

/** 지금 이 단계를 부를 차례가 아니다 (409 `TURN_NOT_ALLOWED`). 재시도해도 같다. */
export class TurnNotAllowed extends Error {
  constructor(메시지: string) {
    super(메시지)
    this.name = 'TurnNotAllowed'
  }
}

/** 같은 회차에서 아직 끝나지 않은 호출이 있다 (409 `TURN_IN_PROGRESS`). **재시도 가능하다.** */
export class TurnInProgress extends Error {
  constructor(메시지: string) {
    super(메시지)
    this.name = 'TurnInProgress'
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 두 번 보내기 잠금 (파이썬 `goodquestion_admin/진행중.py`)
// ═══════════════════════════════════════════════════════════════════════════

const 진행중 = new Map<string, string>()

/**
 * 지금 도는 회차의 **표시용 단계**를 잠시 보관한다. 그 보관 자체가 잠금이다.
 *
 * ⚠️ 메모리다. 서버를 다시 띄우면 빈다 — 그래도 **안전한 쪽으로만 틀린다**:
 *    비면 「끝나지 않은 턴」으로 내려앉을 뿐 실패를 지어내지 않는다 (`turnFailureState()`).
 */
export const inProgress = {
  /** 잡혔으면 `true`. 이미 도는 중이면 `false` (파이썬 `시작()`). */
  start(run_id: string, 단계 = '턴 시작'): boolean {
    if (진행중.has(run_id)) return false
    진행중.set(run_id, 단계)
    return true
  },
  /** 도는 중일 때만 단계를 바꾼다 (파이썬 `단계_바꾸기()`). */
  setStage(run_id: string, 단계: string, 자세히 = ''): void {
    if (!진행중.has(run_id)) return
    진행중.set(run_id, 자세히 ? `${단계}: ${자세히}` : 단계)
  },
  /** 조립층에 넘길 알림 콜백 (파이썬 `알림()`). */
  notify(run_id: string): Notify {
    return (단계, 자세히) => inProgress.setStage(run_id, 단계, 자세히)
  },
  read(run_id: string): string | null {
    return 진행중.get(run_id) ?? null
  },
  end(run_id: string): void {
    진행중.delete(run_id)
  },
}

/**
 * 409 `TURN_IN_PROGRESS` 에 실을 한 줄.
 *
 * ⚠️ **id 를 벌거벗겨 던지지 않는다.** 전에는 `… 있다: <run_id>` 였는데, 계약 8절이
 * 「끊긴 턴은 같은 `message_id` 로 이어 돌린다」라고 적어 둔 탓에 2026-08-13 사람이 그 값을
 * `message_id` 로 읽고 어디에 쓰는 값인지 찾다 막혔다. 무엇이 도는 중인지까지 적는다.
 */
export function 진행중_문구(run_id: string): string {
  const 단계 = inProgress.read(run_id)
  return (
    `이 회차에 아직 끝나지 않은 호출이 있다 (run_id=${run_id}` +
    `${단계 === null ? '' : ` · ${단계}`}). 그 호출이 끝난 뒤에 다시 눌러라.`
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 회차 만들기 · 설정 · 상태
// ═══════════════════════════════════════════════════════════════════════════

export interface StartRunArgs {
  story_code: string
  scope?: Scope
  /** `scene` 범위면 그 대화 장면의 `scene_order`. `story` 범위면 `null` 이어야 한다 (CHECK). */
  scene_order?: number | null
  started_by?: string | null
  /**
   * 시험용 아이 id. 안 주면 **설정의 `GQ_EXPERIMENT_CHILD_ID`** 를 쓰고, 그것도 없으면 터진다
   * (결정 71 · 2026-08-13). 지어내지 않는다 — 저쪽에는 `children` FK 가 있다.
   * ⚠️ 우리는 그 값을 불투명하게 흘려보낼 뿐 누구인지 모른다 (`CLAUDE.md` DB 절).
   */
  child_id?: string | null
  analysis_model?: string | null
  analysis_effort?: string | null
  character_model?: string | null
  character_effort?: string | null
  default_utterance_source?: string
  prompt_version?: string
  experiment_note?: string | null
}

/**
 * 세션 한 행과 회차 한 행을 **함께** 만든다 (`라우트계약.md` 7절).
 *
 * 둘을 한 트랜잭션에 두는 이유 — 세션만 남으면 어느 회차의 기록도 아닌 세션이 되고,
 * 회차만 남는 것은 FK 가 애초에 막는다.
 */
export async function startRun(
  conn: Conn,
  args: StartRunArgs,
): Promise<{ run: RunRow; session_id: string }> {
  const 장면들 = await scenesOfStory(conn, args.story_code)
  if (장면들.length === 0) {
    throw new ValueError(`이야기에 장면이 없다: ${args.story_code} (시드를 넣었나?)`)
  }

  // 🔴 여기가 아이를 고르는 **유일한 자리**다 (결정 71). 저장 계층은 설정을 안 읽는다.
  //    없으면 지어내지 않고 터진다 — 지어낸 uuid 는 저쪽 `children` FK 에서 100% 튕기고,
  //    그때 나오는 말(`23503`)은 원인을 안 알려 준다. 차라리 여기서 이름을 대고 죽는다.
  const child_id = args.child_id ?? loadSettings().child_id
  if (!child_id) {
    throw new ValueError(
      '아이 id 가 없다 — `GQ_EXPERIMENT_CHILD_ID` 를 넣거나 `child_id` 를 넘겨라 (결정 71). ' +
        '지어내지 않는다: 저쪽 `story_sessions.child_id` 에는 `children` FK 가 걸려 있다.',
    )
  }

  return conn.transaction(async (tx) => {
    const session_id = await createSession(tx, {
      story_id: 장면들[0].story_id,
      child_id,
    })
    const run = await createRun(tx, {
      session_id,
      scope: args.scope ?? 'story',
      scene_order: args.scene_order ?? null,
      started_by: args.started_by ?? null,
      analysis_model: args.analysis_model ?? null,
      analysis_effort: args.analysis_effort ?? null,
      character_model: args.character_model ?? null,
      character_effort: args.character_effort ?? null,
      default_utterance_source: args.default_utterance_source ?? 기본_발화_출처,
      prompt_version: args.prompt_version ?? 기본_프롬프트_버전,
      experiment_note: args.experiment_note ?? null,
    })
    printLine(`[세션] id=${session_id} story=${args.story_code}`)
    return { run, session_id }
  })
}

/**
 * 회차에 박힌 모델·강도로 분석/캐릭터 설정 두 벌을 만든다 (파이썬 `회차_설정들()`).
 *
 * ⭐ 회차에 적힌 **강도 한 값을 두 공급자에 다 흘린다** (2026-08-11 사람이 정함).
 * 그전에는 anthropic 쪽에만 흘러서, 화면이 「gemini/medium」이라 적어도 제미나이는
 * 모델 기본값으로 돌았다.
 *
 * ⚠️ 바닥값은 **언제나 `loadSettings()`** 에서 온다. `Settings` 를 손으로 짜는 길을
 *    남기면 `.env.local` 이 안 닿는 자리가 생긴다 (`lib/config.ts` 머리말).
 */
export function runSettings(
  run: Pick<RunRow, 'analysis_model' | 'analysis_effort' | 'character_model' | 'character_effort'>,
  기본?: Settings,
): { analysis: Settings; character: Settings } {
  const 바닥 = 기본 ?? loadSettings()
  return {
    analysis: {
      ...바닥,
      gemini_model: run.analysis_model || 바닥.gemini_model,
      gemini_effort: run.analysis_effort || 바닥.gemini_effort,
      anthropic_effort: run.analysis_effort || 바닥.anthropic_effort,
    },
    character: {
      ...바닥,
      gemini_model: run.character_model || 바닥.gemini_model,
      gemini_effort: run.character_effort || 바닥.gemini_effort,
      anthropic_effort: run.character_effort || 바닥.anthropic_effort,
    },
  }
}

export interface RunState {
  run: RunRow
  session: SessionWithStory
  scenes: SceneRow[]
  step: Step
}

/** 회차 한 벌 — 회차·세션·장면 목록과 **다음에 할 일** (파이썬 `회차_상태()`). */
export async function runState(conn: Conn, run_id: string): Promise<RunState> {
  const run = await readRun(conn, run_id)
  const session = await readSessionWithStory(conn, run.session_id)
  const scenes = await scenesOfStory(conn, session.story_code)
  const step = nextStep(scenes, session, {
    scope: run.scope,
    scene_order: run.scene_order,
  })
  return { run, session, scenes, step }
}

/** 회차 하나를 세션 id 로 찾는다. 없으면 `null` (세션당 하나다). */
export async function runOfSession(conn: Conn, session_id: string): Promise<RunRow | null> {
  return readRunBySession(conn, session_id)
}

/**
 * 회차를 닫는다 (파이썬 `_회차_완료()`).
 *
 * ⚠️ 파이썬은 여기서 `회차_채점완료()` 도 불렀다. **채점기는 이식 범위 밖이라**
 *    (`이식_전수목록.md` 3절 — `채점.py` 보류) `runs.scored_at` 을 여기서 찍지 않는다.
 */
export async function completeRun(
  conn: Conn,
  { run, session }: { run: RunRow; session: { status: string } },
): Promise<void> {
  await conn.transaction(async (tx) => {
    if (session.status === 'in_progress') await completeSession(tx, run.session_id)
    await endRun(tx, run.id)
  })
  printLine('[세션] status=completed')
}

/**
 * 화면이 부르는 자리 — **연결을 안 받는다.**
 *
 * ⛔ `app/` 은 `lib/repo` 를 직접 import 하지 않는다 (eslint 가 막아 뒀다 ·
 *    `docs/설계/코드구조.md` 4절). 그래서 화면은 `getDb()` 를 손에 쥘 수 없고,
 *    `conn` 을 첫 인자로 받는 `startRun()` 을 그대로 부를 수 없다.
 *    `analysisStep()` 이 `args.conn ?? getDb()` 로 그 구멍을 막은 것과 **같은 모양**이다.
 */
export async function startRunStep(
  args: StartRunArgs & { conn?: Conn },
): Promise<{ run: RunRow; session_id: string }> {
  return startRun(args.conn ?? getDb(), args)
}

/** `advanceRun()` 의 같은 자리. 검사는 트랜잭션을 넘겨 끝나면 되돌린다. */
export async function advanceStep(args: { run_id: string; conn?: Conn }): Promise<Step> {
  return advanceRun(args.conn ?? getDb(), args.run_id)
}

/**
 * 다음 대화 장면에 닿을 때까지 전개를 재생한다 (파이썬 `장면들을_진행()`).
 *
 * 화면이 「시작」·「계속」을 누르면 여기로 온다. 끝에 닿으면 회차를 닫는다.
 */
export async function advanceRun(conn: Conn, run_id: string): Promise<Step> {
  const { run, session, scenes } = await runState(conn, run_id)
  const step = await advanceScenes(conn, {
    session_id: run.session_id,
    scenes,
    scope: run.scope as Scope,
    scene_order: run.scene_order,
  })
  if (step.kind === '회차끝') await completeRun(conn, { run, session })
  return step
}

// ═══════════════════════════════════════════════════════════════════════════
// 미완 턴 — 저장된 사실만 본다
// ═══════════════════════════════════════════════════════════════════════════

/** 죽은 자리. `decision` 은 파이썬에 없던 값이다 — 계약이 ①②③ 으로 갈렸기 때문이다. */
export type PendingStage = 'analysis' | 'decision' | 'character'

export interface PendingTurn {
  message_id: string
  stage: PendingStage
}

/**
 * 마지막 아이 발화가 아직 안 끝났으면 그 턴과 **죽은 단계**를 돌려준다 (파이썬 `미완_턴()`).
 *
 * 메모리의 진행 표시가 아니라 **저장된 사실만** 본다 (FR-040).
 *
 * - 분석 행이 없다 → `analysis`
 * - 분석은 있는데 판정(`turn_conditions`)이 없다 → `decision` (LLM 을 다시 안 불러도 된다)
 * - 판정은 있는데 **바로 다음 메시지가 이 장면의 캐릭터가 아니다** → `character`
 *
 * ⭐ 「뒤에 오는 첫 캐릭터 메시지」가 아니라 **바로 다음 한 행**을 본다. 화자를 걸러 집으면
 *    실패한 턴이 그 다음 턴의 대사를 자기 것으로 착각한다.
 */
export async function pendingTurn(
  conn: Conn,
  { session_id }: { session_id: string },
): Promise<PendingTurn | null> {
  const message_id = await lastChildMessageId(conn, session_id)
  if (message_id === null) return null

  const 아이 = await readMessage(conn, message_id)
  if (아이 === null) return null

  if ((await readSavedAnalysis(conn, message_id)) === null) {
    return { message_id, stage: 'analysis' }
  }
  if ((await readTurnCondition(conn, message_id)) === null) {
    return { message_id, stage: 'decision' }
  }

  const 다음 = await nextMessage(conn, { session_id, turn_order: 아이.turn_order })
  if (다음 === null || 다음.speaker_type !== 'character' || 다음.scene_id !== 아이.scene_id) {
    return { message_id, stage: 'character' }
  }
  return null
}

export interface TurnFailureState extends PendingTurn {
  /** **이 단계 용도의 실패만** 담는다 (다른 단계에서 이어진 실패는 안 섞는다). */
  reasons: Awaited<ReturnType<typeof failureReasons>>
  /** 그런 실패가 있어야 「실패했다」고 말한다. 없으면 「끝나지 않은 턴」일 뿐이다. */
  failed: boolean
}

/**
 * 미완 턴을 화면에 넘긴다 (파이썬 `턴_실패_상태()` · FR-040).
 *
 * ⭐ 2026-08-07 — **「실패했다」의 근거는 `llm_calls` 의 실패 행이다.** 미완 조건만 보면
 * **실패한 턴과 아직 도는 중인 턴이 똑같이 만족한다.** 그래서 대사가 생성되는 동안
 * 화면이 「두 공급자가 다 실패했다」를 띄웠고, 대사가 도착하면 저절로 사라졌다.
 *
 * 🔴 2026-08-13 — **파이썬은 단계가 둘이었다.** `회차.py:452 미완_턴()` 이 내는 값은
 * `analysis`·`character` 뿐이었고, 한 스레드가 ①②③ 을 끝까지 돌아서 **미완이 관측되면
 * 진짜 고장뿐**이었다. 그래서 문구도 단추도 「고장 전용」으로 만들어졌다.
 * TS 판은 한 턴이 단추 셋이라 그 전제가 깨졌다 — **①직후 `decision`·②직후 `character` 가
 * 정상 대기 상태**다. 그대로 두면 멀쩡한 대기에 주황 띠가 뜬다(사람이 실제로 겪었다).
 * 그래서 단계마다 갈린다:
 *
 * | 죽은 자리 | 내나 | 왜 |
 * |---|---|---|
 * | `analysis` | **항상** | 그 단계만 누를 폼이 없다. 「이어 돌리기」가 유일한 출구다 |
 * | `decision` | **안 낸다** | ② 는 `decide()` 순수 함수다. LLM 이 없어 실패라는 사실이 없다 |
 * | `character` | 마지막 시도가 `ok=false` 일 때만 | ③ 폼이 그 자리에 이미 있다 |
 *
 * ⛔ **fallback 으로 성공한 시도를 실패로 세지 않는다.** `llm_calls` 에는 넘어가기 전
 * 실패한 시도가 그대로 남는다(결정 33). 그 행들을 용도 안 가리고 모으면 **1차 실패·
 * 2차 성공한 멀쩡한 턴이 「두 공급자가 다 실패했다」로 그려진다.** 파이썬
 * `_예비공급자_쓴_턴들` 이 같은 갈래로 틀렸고 `service/view.fallbackTurns()` 주석이
 * 경고해 둔 함정이다. 그래서 **그 단계 용도의 실패만** 사유로 센다.
 *
 * 🔴 **이 수정을 떠받치는 것은 셋뿐이다** (2026-08-13 실측으로 갈라 뒀다):
 *    ① `decision` 게이트 — ② 에는 LLM 이 없어 실패라는 사실이 없다
 *    ② `character` 게이트 — 남은 실패가 없으면 띠를 안 그린다 (③ 폼이 그 자리에 있다)
 *    ③ `purpose` 분리 — ① 에서 이어진 실패가 ③ 의 사유로 새지 않는다
 *
 * ⚠️ **`마지막_성공` 은 닿을 수 없는 방어다 — 근거로 삼지 마라.** 탐침을 넣어 재 보니
 *    호출 아홉 번 전부 `0` 이었고, 이 조건만 지워도 검사가 그대로 초록이다
 *    (`purpose` 필터를 지우면 빨개진다). 닿을 수 없는 이유는 **`ok=true` 시도가 그 단계의
 *    산출물 행과 같은 트랜잭션에 들어가기** 때문이다 — 분석 성공은 `utterance_analyses` 와
 *    함께, 캐릭터 성공은 캐릭터 `messages` 행과 함께 커밋된다 (`service/turn.ts` 의
 *    `한묶음()` 둘). 그래서 그 단계에 성공 시도가 있으면 `pendingTurn()` 이 애초에
 *    그 단계를 내지 않는다. `tests/service.test.ts` 의 「성공 시도가 있으면 그 단계는
 *    미완으로 안 나온다」가 그 사실을 박아 뒀다.
 *    ⛔ 지우려면 그 두 트랜잭션이 여전히 한 묶음인지부터 보라 — 갈라지는 날 되살아난다.
 *
 * ⚠️ 좁히는 일은 여기서 한다 — `failureReasons()` 는 「그 턴의 실패 행 전부」를 주는
 *    저장소 함수 그대로 두고(다른 화면이 쓴다), 뜻을 붙이는 것은 서비스 층 몫이다.
 */
export async function turnFailureState(
  conn: Conn,
  { run_id, session_id }: { run_id: string; session_id: string },
): Promise<TurnFailureState | null> {
  if (inProgress.read(run_id) !== null) return null
  const 미완 = await pendingTurn(conn, { session_id })
  if (미완 === null) return null
  // ② 에는 LLM 이 없다. 「①을 눌렀고 ②를 아직 안 눌렀다」는 정상 대기다.
  if (미완.stage === 'decision') return null

  // 이 단계의 시도만 본다. `purpose` 값이 `PendingStage` 의 두 이름과 같은 글자다
  // (`engine/analyze.ts` · `engine/character.ts` 가 그렇게 적어 보낸다).
  const 이_단계 = (await readAttempts(conn, { run_id, message_id: 미완.message_id })).filter(
    (행) => 행.purpose === 미완.stage,
  )
  // ⚠️ **여기는 닿지 않는다 — 언제나 0 이다** (머리말의 긴 설명). 그 단계에 `ok=true` 가
  //    있으면 산출물 행도 같은 트랜잭션에 있어 `pendingTurn()` 이 그 단계를 안 낸다.
  //    방어로 남긴다: 두 트랜잭션이 갈라지는 날 이 줄이 되살아난다.
  const 마지막_성공 = 이_단계.reduce((가장, 행) => (행.ok ? Math.max(가장, 행.attempt_no) : 가장), 0)
  const 남은_실패 = 이_단계.some((행) => !행.ok && 행.attempt_no > 마지막_성공)

  // ③ 은 폼이 그 자리에 있다 — 실제로 끊긴 것이 아니면 띠를 그리지 않는다.
  if (미완.stage === 'character' && !남은_실패) return null

  const reasons = (await failureReasons(conn, { run_id, message_id: 미완.message_id })).filter(
    (행) => 행.purpose === 미완.stage && 행.attempt_no > 마지막_성공,
  )
  return { ...미완, reasons, failed: reasons.length > 0 }
}

/**
 * `turn_conditions` 한 행을 `Decision` 으로 되돌린다 (파이썬 `되살린_판정()`).
 *
 * 화면도 재호출도 판정을 **다시 계산하지 않는다** (FR-016). 박제된 값을 그대로 담을 뿐이다.
 *
 * `last_guidance_target` 은 `turn_conditions` 에 없어서 되살릴 수 없다(이슈 #27).
 * 표를 늘리지 않으려고 일부러 안 박제했다 — 이 값은 **다음 턴 판정에 들어가는 재료**이지
 * 지난 턴을 화면에 그리는 데 쓰는 값이 아니고, 세 줄 로그도 이 칸을 찍지 않는다.
 * 지난 턴에 무엇을 유도했는지는 그 턴의 `guidance_target` 으로 이미 보인다.
 */
export function restoreDecision(조건: TurnConditionRow): Decision {
  return {
    response_mode: 조건.response_mode,
    guidance_target: 조건.guidance_target,
    last_guidance_target: null,
    soft_cue: 조건.soft_cue,
    reaction_key: 조건.reaction_key,
    scene_goal_met: 조건.scene_goal_met,
    scene_end_reason: 조건.scene_end_reason,
    accumulated_elements: 조건.accumulated_elements,
    turns_without_new_element: 조건.turns_without_new_element,
    consecutive_low_information_turns: 조건.consecutive_low_information_turns,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 턴 보내기 · ③ 재호출
// ═══════════════════════════════════════════════════════════════════════════

export interface SubmitTurnArgs {
  run_id: string
  child_utterance: string
  /** 안 주면 `getDb()`. 검사는 트랜잭션을 넘겨 끝나면 되돌린다. */
  conn?: Conn
  base_settings?: Settings
  /**
   * 회차에만 저장된 실험 본문. **안 주면 회차의 `experiment_prompts` 에서 꺼내 온다**
   * (파이썬 `회차.실험_프롬프트들()`). 그것도 없으면 `prompts/*.md` 를 읽는다 (FR-057).
   */
  analysis_prompt?: string | null
  character_prompt?: string | null
}

/**
 * 이 회차에 저장된 실험 본문을 **한 번만** 꺼낸다 (T094 · FR-057).
 *
 * ⚠️ 파이썬은 시드 개정 번호와 **같은 시점에 한 번** 붙잡았다 (`회차.py:308`) —
 *    한 턴 안에서 분석과 캐릭터가 서로 다른 판을 보지 않게 하기 위해서다. 여기서도 같다.
 *
 * 부르는 쪽이 명시로 넘긴 값이 있으면 그것이 이긴다. 그 자리가 있어야 검사가
 * DB 를 안 거치고도 「본문이 실제로 엔진까지 갔나」를 잴 수 있다.
 */
async function 이_회차의_프롬프트(
  conn: Conn,
  run_id: string,
  주어진: { analysis_prompt?: string | null; character_prompt?: string | null },
): Promise<{ analysis: string | null; character: string | null }> {
  const 저장된 = await experimentPrompts(run_id, conn)
  return {
    analysis: 주어진.analysis_prompt ?? 저장된.analysis,
    character: 주어진.character_prompt ?? 저장된.character,
  }
}

/**
 * 아이 발화 한 건을 회차에 넣어 끝까지 돌린다 (파이썬 `턴_돌리기()`).
 *
 * ⛔ **두 번 보내기 잠금이 여기 있다.** 회차마다 따로이고, 잡지 못하면 `TurnInProgress` 다.
 */
export async function submitTurn(args: SubmitTurnArgs): Promise<TurnResult> {
  const { run_id, child_utterance } = args
  const conn = args.conn ?? getDb()

  if (!isUsableUtterance(child_utterance)) {
    // 확정 텍스트가 없으면 행을 만들지 않는다 (`docs/기준/db구조.md:302`). 400 자리다.
    throw new ValueError('아이 발화가 비어 있다')
  }
  if (!inProgress.start(run_id)) {
    throw new TurnInProgress(진행중_문구(run_id))
  }

  try {
    // ⭐ **조건 번호를 장면 행보다 먼저 붙잡는다** (파이썬 `회차.턴_돌리기()` 의
    //    「T083: 조건 번호를 먼저 붙잡고, 그 다음 장면 행을 한 번 읽어 턴을 끝낸다」).
    //    거꾸로 하면 그 사이에 사람이 시드를 고쳤을 때 **쓴 장면은 N 판인데
    //    `turn_conditions.seed_revision` 에는 N+1** 이 박힌다. 창은 좁지만(DB 쿼리 두어 개)
    //    이 레포는 회차끼리 견주는 곳이라, 조건 번호가 어긋나면 그 비교가 조용히 거짓이 된다.
    const seed_revision = await latestSeedRevision(conn)
    const { run, scenes, step } = await runState(conn, run_id)
    if (step.kind !== '발화받기' || step.scene_id === null) {
      // 현재 장면이 전개 장면이거나 · 세션이 in_progress 가 아니거나 · 장면이 끝났다.
      throw new TurnNotAllowed(`지금은 발화를 받을 차례가 아니다 (${step.kind})`)
    }
    // 끝나지 않은 턴이 있으면 새 발화를 받지 않는다. 받으면 `messages` 행이 하나 더 생겨
    // 턴 수가 어긋난다 (FR-035). 그 턴은 재호출로만 이어진다 (결정 44 · 계약 8절).
    const 미완 = await pendingTurn(conn, { session_id: run.session_id })
    if (미완 !== null) {
      throw new TurnNotAllowed(
        `끝나지 않은 턴이 있다 (${미완.stage}). 그 턴을 이어서 돌려라: ${미완.message_id}`,
      )
    }

    const 장면 = 장면_찾기(scenes, step.scene_id)
    const 설정 = runSettings(run, args.base_settings)
    // T094 — 회차에 실험 프롬프트가 있으면 그것을 재료로 쓴다 (파이썬 `회차.py:308`).
    const 프롬프트 = await 이_회차의_프롬프트(conn, run_id, args)

    const 결과 = await runTurn({
      conn,
      run_id,
      prompt_version: run.prompt_version,
      seed_revision,
      session_id: run.session_id,
      scene: 장면,
      precedingNarrations: narrationsBefore(scenes, 장면),
      child_utterance,
      utterance_source: run.default_utterance_source,
      analysis_settings: 설정.analysis,
      character_settings: 설정.character,
      analysis_prompt: 프롬프트.analysis,
      character_prompt: 프롬프트.character,
      notify: inProgress.notify(run_id),
    })

    // 이 턴으로 장면이나 회차가 끝났으면 닫는다 (파이썬 `_대사_단계()` 의 꼬리).
    await 끝났으면_닫는다(conn, run_id)
    return 결과
  } finally {
    inProgress.end(run_id)
  }
}

export interface ResumeTurnArgs {
  run_id: string
  /** ① 이 만든 **아이** 메시지 id. 이 값이 세 호출을 같은 턴으로 묶는 열쇠다. */
  child_message_id: string
  conn?: Conn
  base_settings?: Settings
  analysis_prompt?: string | null
  character_prompt?: string | null
}

export interface ResumedTurn {
  resumed_from: PendingStage
  child_message_id: string
  decision: Decision
  dialogue: DialogueStage
}

/**
 * ⭐ 끊긴 턴을 **죽은 단계부터** 이어 돌린다 (2026-08-12 사람 결정 · `라우트계약.md` 8절).
 *
 * **아이 메시지를 새로 만들지 않는다.** 이미 저장된 그 행에 이어 붙이므로 `messages` 행 수도
 * `current_child_turn_count` 도 늘지 않는다 (FR-015 · FR-035).
 *
 * | 죽은 자리 | 여기서 하는 일 |
 * |---|---|
 * | `analysis` | 분석부터 다시. 판정이 없어 되살릴 것도 없다 |
 * | `decision` | **LLM 을 안 부른다.** 저장된 분석을 후처리해 판정만 다시 낸다 |
 * | `character` | 대사만. 분석·판정은 **박제된 값**을 되살린다 (다시 판정하지 않는다) |
 *
 * 발화는 저장된 그 문장이다 — 이 함수는 발화를 인자로 받지 않는다.
 */
export async function resumeTurn(args: ResumeTurnArgs): Promise<ResumedTurn> {
  const { run_id, child_message_id } = args
  const conn = args.conn ?? getDb()

  if (!inProgress.start(run_id, '다시 보내기')) {
    throw new TurnInProgress(진행중_문구(run_id))
  }

  try {
    // ⭐ `submitTurn()` 과 같은 자리에서 붙잡는다 — 장면 행을 읽기 **전**이다.
    //    (왜 파이썬과 다른지는 아래 `if (미완.stage === 'analysis')` 앞 주석에 있다.)
    const seed_revision = await latestSeedRevision(conn)
    const { run, scenes } = await runState(conn, run_id)
    const 미완 = await pendingTurn(conn, { session_id: run.session_id })
    if (미완 === null || 미완.message_id !== child_message_id) {
      throw new TurnNotAllowed(`이어 돌릴 턴이 아니다: ${child_message_id}`)
    }

    const 아이 = await readMessage(conn, child_message_id)
    if (아이 === null) throw new TurnNotAllowed(`메시지가 없다: ${child_message_id}`)
    const 장면 = 장면_찾기(scenes, 아이.scene_id)
    const 앞선 = narrationsBefore(scenes, 장면)
    const 설정 = runSettings(run, args.base_settings)
    const notify = inProgress.notify(run_id)
    // ⭐ 이어 돌리는 턴도 **같은 회차의 실험 프롬프트**로 돈다 (T094 · FR-057).
    //    여기를 빼면 처음 시도는 실험 프롬프트로, 이어 돌리기는 정본으로 돌아
    //    한 턴 안에서 조건이 갈린다 — 그 회차의 결과를 못 믿게 된다 (파이썬 `회차.py:404`).
    const 프롬프트 = await 이_회차의_프롬프트(conn, run_id, args)

    // 죽은 자리가 분석이면 그냥 한 턴을 통째로 다시 돈다 — 있는 아이 메시지에 이어서다.
    //
    // ⚠️ **판 번호를 붙잡는 자리에서 파이썬과 갈린다. 일부러다.**
    //    파이썬 `재시도_돌리기()` 는 장면 행(`db.장면들()`)을 **먼저** 읽고 판 번호는
    //    `_판정_기록(… seed_revision=저장.최신_시드_개정(conn))` 에서 — 분석 LLM 이 끝난
    //    **뒤에** — 붙잡았다. T083 주석은 `턴_돌리기()` 에만 달려 있다.
    //    🔴 그 순서를 그대로 옮기면 **이 함수 안에서만 규칙이 둘**이 된다. 파이썬의 재시도는
    //    갈래가 둘(`analysis` · 되살리기)뿐이라 그래도 됐지만, 우리는 ①②③ 이 갈린 탓에
    //    **`decision` 에서 죽은 턴**이라는 갈래가 하나 더 있고 — 파이썬에 없는 길이다 —
    //    거기서 `runDecisionStage()` 가 스스로 읽으면 장면을 읽은 지 한참 뒤가 된다.
    //    그래서 두 갈래 모두 위에서 붙잡은 한 값을 쓴다. 창이 파이썬보다 좁아지는 것은
    //    이 정합의 부산물이지 목적이 아니다 (2026-08-13 결함 6).
    if (미완.stage === 'analysis') {
      const 결과 = await runTurn({
        conn,
        run_id,
        prompt_version: run.prompt_version,
        seed_revision,
        session_id: run.session_id,
        scene: 장면,
        precedingNarrations: 앞선,
        child_utterance: 아이.text,
        child_message: { id: 아이.id, turn_order: 아이.turn_order },
        analysis_settings: 설정.analysis,
        character_settings: 설정.character,
        analysis_prompt: 프롬프트.analysis,
        character_prompt: 프롬프트.character,
        notify,
      })
      await 끝났으면_닫는다(conn, run_id)
      return {
        resumed_from: 미완.stage,
        child_message_id,
        decision: 결과.decision,
        dialogue: 결과.dialogue,
      }
    }

    // 여기부터는 분석을 **다시 부르지 않는다.** 박제된 값을 되살린다 (FR-015).
    const 분석 = await readSavedAnalysis(conn, child_message_id)
    if (분석 === null) throw new TurnNotAllowed(`저장된 분석이 없다: ${child_message_id}`)
    // 후처리는 순수 함수라 (원본 요소, 아이 발화) 만으로 같은 답이 다시 나온다 — 그래서
    // `kept` 를 저장하지 않는다.
    const { kept } = postProcess(분석.detected_elements, 아이.text)

    let 판정: Decision
    if (미완.stage === 'decision') {
      판정 = (
        await runDecisionStage({
          conn,
          run_id,
          prompt_version: run.prompt_version,
          seed_revision,
          session_id: run.session_id,
          scene: 장면,
          child_message_id,
          analysis: {
            child_intent: 분석.child_intent,
            detected_elements: kept,
            utterance_validity: 분석.utterance_validity,
          },
        })
      ).decision
    } else {
      const 조건 = await readTurnCondition(conn, child_message_id)
      if (조건 === null) throw new TurnNotAllowed(`박제된 판정이 없다: ${child_message_id}`)
      판정 = restoreDecision(조건)
    }

    const dialogue = await runDialogueStage({
      conn,
      run_id,
      session_id: run.session_id,
      scene: 장면,
      precedingNarrations: 앞선,
      child_utterance: 아이.text,
      child_message_id,
      turn_order: 아이.turn_order,
      main_point: 분석.main_point,
      decision: 판정,
      settings: 설정.character,
      prompt: 프롬프트.character,
      notify,
    })
    // `runTurn()` 과 같은 자리에서 같은 줄을 찍는다 — 이어 돈 턴도 로그가 온전해야 한다.
    if (dialogue.source === 'fixed') printLine(sceneEndLine(장면, 판정))

    await 끝났으면_닫는다(conn, run_id)
    return { resumed_from: 미완.stage, child_message_id, decision: 판정, dialogue }
  } finally {
    inProgress.end(run_id)
  }
}

/** 이 턴으로 장면이나 회차가 끝났으면 세션과 회차를 함께 닫는다. */
async function 끝났으면_닫는다(conn: Conn, run_id: string): Promise<void> {
  const { run, session, step } = await runState(conn, run_id)
  if (step.kind === '장면끝' || step.kind === '회차끝') {
    await completeRun(conn, { run, session })
  }
}

function 장면_찾기(scenes: readonly SceneRow[], scene_id: string): SceneRow {
  const 장면 = scenes.find((행) => 행.scene_id === scene_id)
  if (장면 === undefined) throw new ValueError(`장면 목록에 없는 scene_id 다: ${scene_id}`)
  return 장면
}

/**
 * 회차의 대화를 재생 순서대로 (파이썬 `메시지_목록()` 의 자리).
 *
 * ⚠️ 여기서는 **현재 장면**의 줄만 준다 — 화면 트랙이 회차 전체를 그릴 때 필요한
 * 조립(분석·판정 붙이기)은 그쪽 몫이다 (`회차.py` 의 읽는 절반).
 */
export async function sceneTranscript(
  conn: Conn,
  { session_id, scene_id }: { session_id: string; scene_id: string },
) {
  return sceneMessages(conn, { session_id, scene_id })
}
