// 라우트 넷이 부르는 진입점 — **세션 id 하나로 ①②③④ 를 연다** (이슈 #26 화면-2·4).
//
// ⚠️ **이 파일은 조립 트랙이 남긴 구멍을 메운다.** `service/turn.ts` 의 단계 함수 셋은
//    `conn`·`run_id`·`scene`·`precedingNarrations` 를 이미 손에 쥔 쪽을 위한 것이고,
//    `service/run.ts` 의 `submitTurn()` 은 ①②③ 을 **한 번에** 돈다.
//    그런데 라우트 계약은 「`session_id` 와 이번 발화뿐」을 받고 **셋으로 갈라** 부른다
//    (`docs/설계/라우트계약.md` 1·3~5절). 그 사이를 잇는 자리가 여기다.
//
// ⛔ **라우트가 이 일을 하면 안 된다.** 「회차를 찾고 · 장면을 고르고 · 설정을 만들고」는
//    규칙이고, 규칙이 라우트에 새면 화면이 부르는 길과 라우트가 부르는 길이 갈린다
//    (`docs/설계/코드구조.md` 2절). 그래서 라우트는 이 파일의 함수 넷만 부른다.
//
// ## 이 파일이 새로 정하지 않는 것
//
// 판정은 `decide()`, 다음 할 일은 `nextStep()`, CLOSING 갈림은 `characterTurn()` 이 한다.
// 여기서 하는 일은 **셋 뿐**이다 — 세션에서 회차·장면을 찾고, 「지금 이 단계를 부를
// 차례인가」를 `nextStep()`·`pendingTurn()` 의 답으로 판단하고, 계약이 정한 모양으로 담는다.
//
// ## 🔴 전개 장면은 404 가 아니라 409 다
//
// `requireDialogueScene()` 은 `SceneNotFound`(404)를 던지는데 계약은 그 자리에
// 409 `TURN_NOT_ALLOWED` 를 적어 뒀다 (`라우트계약.md` 7절 표). **계약이 맞다** —
// 「그런 장면이 없다」가 아니라 「지금 아이가 말할 차례가 아니다」이기 때문이다.
// 그래서 단계 함수에 닿기 **전에** `nextStep()` 이 `발화받기` 를 냈는지 보고,
// 아니면 `TurnNotAllowed` 를 던진다. `submitTurn()` 이 하던 것과 같은 문지기다.

import type { Settings } from '@/lib/config'
import { type Decision } from '@/lib/domain/decide'
import { ValueError } from '@/lib/domain/progress'
import { printLine, sceneEndLine } from '@/lib/log'
import { findScene, type SceneRow } from '@/lib/repo/content'
import { getDb, type Conn } from '@/lib/repo/db'
import { latestSeedRevision } from '@/lib/repo/seed'
import {
  readMessage,
  readSessionWithStory,
  type MessageRow,
  type SessionRow,
} from '@/lib/repo/sessions'
import { readTurnCondition } from '@/lib/repo/turn-conditions'
import type { LLMResult } from '@/lib/llm'
import type { RunRow } from '@/lib/repo/runs'

import { experimentPrompts } from './prompt-lab'
import { narrationsBefore } from './story'
import {
  completeRun,
  inProgress,
  pendingTurn,
  restoreDecision,
  runOfSession,
  runSettings,
  runState,
  TurnInProgress,
  진행중_문구,
  TurnNotAllowed,
} from './run'
import {
  isUsableUtterance,
  runAnalysisStage,
  runDecisionStage,
  runDialogueStage,
} from './turn'

/** `message_id` 가 없거나 **그 세션 것이 아니다** (404 `MESSAGE_NOT_FOUND`). */
export class MessageNotFound extends Error {
  constructor(메시지: string) {
    super(메시지)
    this.name = 'MessageNotFound'
  }
}

/**
 * 응답한 공급자와 모델 ID. **fallback 이 돌았는지 눈으로 봐야 한다** (`CLAUDE.md` 로그 절).
 *
 * LLM 을 부르지 않은 호출(② · CLOSING 인 ③ · ④)에는 실리지 않는다 — 그때 `null` 이다.
 */
export interface Meta {
  provider: string
  model: string
  elapsed_ms: number | null
}

/** 라우트가 봉투에 담을 것 — 알맹이와 (있으면) `meta`. */
export interface StepResult<T> {
  data: T
  meta: Meta | null
}

/** 성공한 시도의 `duration_ms`. 못 찾으면 `null`(모름)이다. 지어내지 않는다. */
function meta_of(llm: LLMResult | null): Meta | null {
  if (llm === null) return null
  const 성공 = [...llm.attempts].reverse().find((시도) => 시도.ok)
  return {
    provider: llm.provider,
    model: llm.model,
    elapsed_ms: 성공 === undefined ? null : 성공.duration_ms,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 공통 — 세션에서 회차·장면을 찾는다
// ═══════════════════════════════════════════════════════════════════════════

interface 회차_한벌 {
  run: RunRow
  session: SessionRow
  settings: { analysis: Settings; character: Settings }
}

/**
 * 세션 id 하나로 회차까지 간다.
 *
 * - 세션이 없다 → `LookupError` (404 `SESSION_NOT_FOUND`. `readSessionWithStory` 가 던진다)
 * - 세션은 있는데 회차가 없다 → `TurnNotAllowed` (409). 라우트는 세션을 만들지 않으므로
 *   회차 없는 세션은 이 API 로 돌릴 수 없다 (`라우트계약.md` 7절).
 */
async function 회차를_찾는다(
  conn: Conn,
  session_id: string,
  base_settings?: Settings,
): Promise<회차_한벌> {
  const session = await readSessionWithStory(conn, session_id)
  const run = await runOfSession(conn, session_id)
  if (run === null) {
    throw new TurnNotAllowed(`이 세션에는 회차가 없다: ${session_id}`)
  }
  return { run, session, settings: runSettings(run, base_settings) }
}

/**
 * ② ③ 이 가리키는 아이 메시지를 찾는다. **세 호출이 같은 턴을 가리킨다는 증거다.**
 *
 * 다른 세션의 id 를 주면 404 다 — 계약이 `MESSAGE_NOT_FOUND` 에 그 경우를 함께 적어 뒀다.
 */
async function 아이_메시지를_찾는다(
  conn: Conn,
  { session_id, message_id }: { session_id: string; message_id: string },
): Promise<MessageRow> {
  const 행 = await readMessage(conn, message_id)
  if (행 === null || 행.session_id !== session_id) {
    throw new MessageNotFound(`이 세션의 메시지가 아니다: ${message_id}`)
  }
  if (행.speaker_type !== 'child') {
    // 있기는 한데 턴의 열쇠가 아니다. 「없다」가 아니라 「부를 차례가 아니다」다.
    throw new TurnNotAllowed(`아이 메시지가 아니다: ${message_id}`)
  }
  return 행
}

/**
 * 이 회차에 저장된 실험 본문 하나 (T094 · FR-057 · 파이썬 `회차.실험_프롬프트들()`).
 *
 * ⚠️ **계약이 ①②③ 으로 갈린 탓에 파이썬처럼 「턴 시작에 한 번」 붙잡을 수 없다.**
 *    ① 과 ③ 이 서로 다른 HTTP 호출이라 그 사이에 사람이 작업대에서 본문을 고칠 수 있고,
 *    실어 나를 자리도 계약에 없다. 그래서 **각 단계가 부를 때 읽는다** — 「고친 다음
 *    호출부터 바로 반영된다」(`CLAUDE.md`)와 같은 성질이고, 한 턴 안에서 갈렸는지는
 *    `turn_conditions.prompt_version`·`seed_revision` 이 아니라 사람이 알아야 한다.
 *
 * 부르는 쪽이 명시로 넘긴 값이 있으면 그것이 이긴다.
 */
async function 이_회차의_프롬프트(
  conn: Conn,
  run_id: string,
  주어진: string | null | undefined,
  갈래: 'analysis' | 'character',
): Promise<string | null> {
  if (주어진 !== null && 주어진 !== undefined) return 주어진
  return (await experimentPrompts(run_id, conn))[갈래]
}

/** 회차의 장면 목록에서 한 장면과 앞선 전개를 집는다. */
async function 장면을_집는다(
  conn: Conn,
  run_id: string,
  scene_id: string,
): Promise<{ scene: SceneRow; preceding: readonly SceneRow[] }> {
  const { scenes } = await runState(conn, run_id)
  const scene = scenes.find((행) => 행.scene_id === scene_id)
  if (scene === undefined) {
    throw new ValueError(`장면 목록에 없는 scene_id 다: ${scene_id}`)
  }
  return { scene, preceding: narrationsBefore(scenes, scene) }
}

/**
 * 🔴 전개 장면·끝난 세션·끝난 장면을 **여기서** 409 로 막는다 (이 파일 머리말).
 *
 * `nextStep()` 이 `발화받기` 를 내지 않으면 아이가 말할 자리가 아니다.
 */
async function 발화받을_차례인가(conn: Conn, run_id: string): Promise<string> {
  const { step } = await runState(conn, run_id)
  if (step.kind !== '발화받기' || step.scene_id === null) {
    throw new TurnNotAllowed(`지금은 발화를 받을 차례가 아니다 (${step.kind})`)
  }
  return step.scene_id
}

/** 이 턴으로 장면이나 회차가 끝났으면 세션과 회차를 함께 닫는다 (`submitTurn()` 의 꼬리). */
async function 끝났으면_닫는다(conn: Conn, run_id: string): Promise<void> {
  const { run, session, step } = await runState(conn, run_id)
  if (step.kind === '장면끝' || step.kind === '회차끝') {
    await completeRun(conn, { run, session })
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ① 분석 — `POST /api/v1/analysis`
// ═══════════════════════════════════════════════════════════════════════════

export interface AnalysisStepArgs {
  session_id: string
  child_utterance: string
  /** 안 주면 `getDb()`. 검사는 트랜잭션을 넘겨 끝나면 되돌린다. */
  conn?: Conn
  base_settings?: Settings
  analysis_prompt?: string | null
}

export interface AnalysisStepData {
  message_id: string
  turn_order: number
  analysis: {
    child_intent: string
    main_point: string | null
    detected_elements: readonly { type: string; evidence: string | null }[]
    utterance_validity: string
  }
  detected_elements_kept: readonly string[]
  dropped: readonly string[]
}

/** 계약 3절. ⛔ **여기서 `decide()` 를 부르지 않는다.** */
export async function analysisStep(
  args: AnalysisStepArgs,
): Promise<StepResult<AnalysisStepData>> {
  const conn = args.conn ?? getDb()

  if (!isUsableUtterance(args.child_utterance)) {
    // 확정 텍스트가 없으면 행을 만들지 않는다 (`docs/기준/db구조.md:302`). 400 자리다.
    throw new ValueError('아이 발화가 비어 있다')
  }

  const { run, settings } = await 회차를_찾는다(conn, args.session_id, args.base_settings)
  if (!inProgress.start(run.id)) {
    throw new TurnInProgress(진행중_문구(run.id))
  }
  try {
    const scene_id = await 발화받을_차례인가(conn, run.id)

    // 끝나지 않은 턴이 있으면 새 발화를 받지 않는다 (FR-035 · 계약 8절).
    // 그 턴은 ②③ 재호출로만 이어진다.
    const 미완 = await pendingTurn(conn, { session_id: args.session_id })
    if (미완 !== null) {
      throw new TurnNotAllowed(
        `끝나지 않은 턴이 있다 (${미완.stage}). 그 턴을 이어서 돌려라: ${미완.message_id}`,
      )
    }

    const { scene, preceding } = await 장면을_집는다(conn, run.id, scene_id)
    const 결과 = await runAnalysisStage({
      conn,
      run_id: run.id,
      session_id: args.session_id,
      scene,
      precedingNarrations: preceding,
      child_utterance: args.child_utterance,
      utterance_source: run.default_utterance_source,
      settings: settings.analysis,
      prompt: await 이_회차의_프롬프트(conn, run.id, args.analysis_prompt, 'analysis'),
      notify: inProgress.notify(run.id),
    })

    return {
      data: {
        message_id: 결과.child_message_id,
        turn_order: 결과.turn_order,
        analysis: 결과.analysis,
        detected_elements_kept: 결과.kept,
        dropped: 결과.dropped,
      },
      meta: meta_of(결과.llm),
    }
  } finally {
    inProgress.end(run.id)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ② 판단 — `POST /api/v1/decision`
// ═══════════════════════════════════════════════════════════════════════════

export interface DecisionStepArgs {
  session_id: string
  message_id: string
  /** ⚠️ `detected_elements` 는 ① 의 `detected_elements_kept` 다. 원본이 아니다 (계약 4절). */
  analysis: {
    child_intent: string
    detected_elements: readonly string[]
    utterance_validity: string
  }
  conn?: Conn
  base_settings?: Settings
}

export interface DecisionStepData {
  decision: {
    response_mode: string
    guidance_target: string | null
    soft_cue: boolean
    reaction_key: string
    scene_goal_met: boolean
    scene_end_reason: string | null
  }
  missing_elements: readonly string[]
  session: {
    current_child_turn_count: number
    accumulated_elements: readonly string[]
    last_detected_elements: readonly string[]
    last_response_mode: string | null
    last_guidance_target: string | null
    turns_without_new_element: number
    consecutive_low_information_turns: number
    scene_goal_met: boolean
    scene_end_reason: string | null
  }
}

/**
 * 계약 4절. **LLM 이 아니다** — `decide()` 순수 함수 한 번이다.
 *
 * ⚠️ **같은 턴에 두 번 부를 수 없다.** `decide()` 에 들어가는 턴 수 +1 이 여기 있어
 * (결정 17-a) 두 번 부르면 `current_child_turn_count` 가 두 칸 오른다. 그래서
 * 「이 턴의 죽은 자리가 `decision` 인가」를 `pendingTurn()` 에 물어 아니면 409 다.
 * ⛔ 이것은 새 규칙이 아니라 `submitTurn()` 이 이미 갖고 있던 문지기를 단계별로 옮긴 것이다.
 *
 * ⚠️ **시드 판 번호를 잇지 못하는 자리는 ①→② 사이뿐이다.** ① 과 ② 가 **서로 다른 HTTP
 *    호출**이라 ① 이 본 판을 실어 나를 칸이 계약에 없고, 그 사이에 몇 분이 지날 수도 있다.
 *    그래서 ① 이 본 판과 ② 가 박는 판은 갈릴 수 있고, 갈렸는지는 사람이 알아야 한다
 *    (실험 프롬프트를 단계마다 다시 읽는 것과 같은 이유다 — `이_회차의_프롬프트()` 머리말).
 *
 * 🔴 **하지만 ② 한 호출 안의 창은 `submitTurn()` 과 똑같이 닫는다.** 아래에서 장면 행을 읽기
 *    전에 `latestSeedRevision()` 을 붙잡아 `runDecisionStage()` 로 내려보낸다(파이썬
 *    `회차.턴_돌리기()` 의 T083 과 같은 순서). 2026-08-13 까지 여기 「이 길에서는 그렇게 할
 *    수가 없다」고 적혀 있었는데 **틀린 말이었다** — 못 잇는 것은 호출 **사이**지 호출 **안**이
 *    아니다. 탐침을 박아 재 보니 `expected 612 to be 328` 로, 쓴 장면과 박힌 판이 어긋났다.
 */
export async function decisionStep(
  args: DecisionStepArgs,
): Promise<StepResult<DecisionStepData>> {
  const conn = args.conn ?? getDb()
  const { run } = await 회차를_찾는다(conn, args.session_id, args.base_settings)
  const 아이 = await 아이_메시지를_찾는다(conn, {
    session_id: args.session_id,
    message_id: args.message_id,
  })

  if (!inProgress.start(run.id, '판단')) {
    throw new TurnInProgress(진행중_문구(run.id))
  }
  try {
    const 미완 = await pendingTurn(conn, { session_id: args.session_id })
    if (미완 === null || 미완.message_id !== args.message_id || 미완.stage !== 'decision') {
      throw new TurnNotAllowed(
        `이 턴의 판단을 부를 차례가 아니다: ${args.message_id}` +
          (미완 === null ? ' (끝나지 않은 턴이 없다)' : ` (${미완.stage} 자리다)`),
      )
    }

    // ⭐ 조건 번호를 장면 행보다 먼저 붙잡는다 (머리말 · `submitTurn()` 과 같은 순서).
    const seed_revision = await latestSeedRevision(conn)
    const { scene } = await 장면을_집는다(conn, run.id, 아이.scene_id)
    const 결과 = await runDecisionStage({
      conn,
      run_id: run.id,
      prompt_version: run.prompt_version,
      seed_revision,
      session_id: args.session_id,
      scene,
      child_message_id: args.message_id,
      analysis: args.analysis,
    })

    return { data: 계약_모양(결과.decision, 결과.missing, 결과.session), meta: null }
  } finally {
    inProgress.end(run.id)
  }
}

/** `Decision` 과 세션 한 행에서 **계약이 적은 칸만** 골라 담는다 (칸을 더하지 않는다). */
function 계약_모양(
  decision: Decision,
  missing: readonly string[],
  session: SessionRow,
): DecisionStepData {
  return {
    decision: {
      response_mode: decision.response_mode,
      guidance_target: decision.guidance_target,
      soft_cue: decision.soft_cue,
      reaction_key: decision.reaction_key,
      scene_goal_met: decision.scene_goal_met,
      scene_end_reason: decision.scene_end_reason,
    },
    missing_elements: missing,
    session: {
      current_child_turn_count: session.current_child_turn_count,
      accumulated_elements: session.accumulated_elements,
      last_detected_elements: session.last_detected_elements,
      last_response_mode: session.last_response_mode,
      last_guidance_target: session.last_guidance_target,
      turns_without_new_element: session.turns_without_new_element,
      consecutive_low_information_turns: session.consecutive_low_information_turns,
      scene_goal_met: session.scene_goal_met,
      scene_end_reason: session.scene_end_reason,
    },
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ③ 대사 — `POST /api/v1/dialogue`
// ═══════════════════════════════════════════════════════════════════════════

export interface DialogueStepArgs {
  session_id: string
  message_id: string
  /** ② 응답에서 그대로. 관리자 화면은 이 셋을 바꿔 ③ 만 다시 돌린다 (계약 1절). */
  response_mode: string
  reaction_key: string
  guidance_target: string | null
  main_point: string | null
  conn?: Conn
  base_settings?: Settings
  character_prompt?: string | null
}

export interface DialogueStepData {
  message_id: string
  turn_order: number
  text: string
  source: 'generated' | 'fixed'
}

/**
 * 계약 5절. **CLOSING 이면 캐릭터 LLM 을 아예 부르지 않는다** — 그 갈림은
 * `characterTurn()` 안에 있고 이 파일에는 `'CLOSING'` 이라는 글자가 없다.
 *
 * ⭐ **같은 `message_id` 로 다시 부를 수 있다** (계약 8절 결정 2). 캐릭터 `messages` 행이
 * 이미 있으면 `runDialogueStage()` 가 덮어쓴다 — 여기서 막지 않는 것이 그 결정이다.
 */
export async function dialogueStep(
  args: DialogueStepArgs,
): Promise<StepResult<DialogueStepData>> {
  const conn = args.conn ?? getDb()
  const { run, settings } = await 회차를_찾는다(conn, args.session_id, args.base_settings)
  const 아이 = await 아이_메시지를_찾는다(conn, {
    session_id: args.session_id,
    message_id: args.message_id,
  })

  if (!inProgress.start(run.id, '대사')) {
    throw new TurnInProgress(진행중_문구(run.id))
  }
  try {
    const { scene, preceding } = await 장면을_집는다(conn, run.id, 아이.scene_id)
    if (scene.character_id === null) {
      // 전개 장면에는 캐릭터가 없다. 404 가 아니라 409 다 (이 파일 머리말).
      throw new TurnNotAllowed(`${scene.code} 는 전개 장면이라 대사가 없다`)
    }

    const 결과 = await runDialogueStage({
      conn,
      run_id: run.id,
      session_id: args.session_id,
      scene,
      precedingNarrations: preceding,
      child_utterance: 아이.text,
      child_message_id: args.message_id,
      turn_order: 아이.turn_order,
      main_point: args.main_point,
      decision: {
        response_mode: args.response_mode,
        reaction_key: args.reaction_key,
        guidance_target: args.guidance_target,
      },
      settings: settings.character,
      prompt: await 이_회차의_프롬프트(conn, run.id, args.character_prompt, 'character'),
      notify: inProgress.notify(run.id),
    })

    // `runTurn()`·`resumeTurn()` 과 같은 자리에서 같은 줄을 찍는다.
    // ⛔ CLOSING 인지 다시 보지 않는다 — `source === 'fixed'` 가 그 판정의 **결과**다.
    if (결과.source === 'fixed') {
      // 박제된 판정을 되살려 찍는다. **다시 판정하지 않는다** (FR-016).
      const 조건 = await readTurnCondition(conn, args.message_id)
      if (조건 !== null) printLine(sceneEndLine(scene, restoreDecision(조건)))
    }

    await 끝났으면_닫는다(conn, run.id)

    return {
      data: {
        message_id: 결과.message_id,
        turn_order: 결과.turn_order,
        text: 결과.text,
        source: 결과.source,
      },
      meta: meta_of(결과.llm),
    }
  } finally {
    inProgress.end(run.id)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ④ 장면 조회 — `GET /api/v1/stories/{story_code}/scenes/{scene_code}`
// ═══════════════════════════════════════════════════════════════════════════

export interface SceneViewData {
  code: string
  scene_order: number
  scene_type: 'dialogue' | 'narration'
  scene_description: string | null
  character_name: string | null
  character_opening: string | null
}

/**
 * 계약 6절. 세션과 무관한 **콘텐츠 조회**라 `session_id` 를 받지 않는다.
 *
 * ⛔ `required_elements`·`element_criteria`·`remaining_worries`·`scene_goal` 을 주지 않는다 —
 *    **아이가 말할 답을 미리 알려주는 값**이다 (`docs/기준/대화작동규칙.md:81`).
 *    `character_closing` 은 때가 되면 ③ 이 준다.
 */
export async function sceneView({
  story_code,
  scene_code,
  conn,
}: {
  story_code: string
  scene_code: string
  conn?: Conn
}): Promise<StepResult<SceneViewData>> {
  const { scene } = await findScene(conn ?? getDb(), { story_code, scene_code })
  return {
    data: {
      code: scene.code,
      scene_order: scene.scene_order,
      // 대화/전개 구분은 `character_id` 만 따른다 (결정 11 · `isDialogueScene()` 과 같은 기준).
      scene_type: scene.character_id === null ? 'narration' : 'dialogue',
      scene_description: scene.scene_description,
      character_name: scene.character_name,
      character_opening: scene.character_opening,
    },
    meta: null,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 라우트가 옮길 예외 목록 — **한 자리에 모아 둔다**
// ═══════════════════════════════════════════════════════════════════════════
//
// ⛔ `app/` 은 `lib/repo` 와 `lib/llm` 을 직접 import 하지 않는다 (eslint 가 막아 뒀다).
//    그래서 라우트가 `SceneNotFound`·`LLMError` 를 이름으로 알아볼 방법이 없어진다.
//    여기서 다시 내보내는 것이 그 구멍을 막는 자리이고, 덤으로 **라우트가 계약 8절의
//    오류 표로 옮겨야 하는 것 전부**가 한 목록이 된다.
export { LookupError, ValueError } from '@/lib/domain/progress'
export { AnalysisResponseError } from '@/lib/engine/analyze'
export { LLMError } from '@/lib/llm'
export { SceneNotFound } from '@/lib/repo/content'
export { TurnInProgress, TurnNotAllowed } from './run'
export { TurnFailed } from './turn'
