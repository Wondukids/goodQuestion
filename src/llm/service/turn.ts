// 한 턴 — 분석 → 판단 → 대사를 잇는 자리 (이슈 #26 조립-1).
//
// 파이썬 `runner.분석까지()`·`대사까지()`·`한_턴()` 에 `회차._판정_기록()`·`_대사_단계()`·
// `_실패_기록()` 을 합친 것이다. 파이썬은 엔진(`runner.py`)과 관리 도구(`회차.py`)가
// 갈려 있어 「턴을 돌리는 순서」와 「관리 기록을 남기는 순서」가 두 파일에 나뉘어 있었다.
// 여기서는 **한 파일**이다 — 「본 서버」라는 바깥 경계가 없어졌기 때문이다 (`CLAUDE.md`).
//
// ⛔ 이 파일은 **공급자를 모르고**(`lib/llm` 만 안다) **규칙을 다시 쓰지 않는다**(`lib/domain`).
//    하는 일은 순서를 잡고, DB 와 LLM 사이를 오가고, 매 턴 세 줄을 찍는 것뿐이다.
//
// ## 한 턴의 순서 (결정 18 — `docs/기준/대화작동규칙.md:53-62` 의 1.1 표)
//
// ```
// 1. messages INSERT (child)      ─── 커밋      ①
// 2. 분석 LLM                      (DB 를 붙잡지 않는다)
// 3. 후처리 (결정 26)
// 4. utterance_analyses INSERT + llm_calls  ─── 커밋
// 5. decide()                      (순수 함수)                     ②
// 6. story_sessions UPDATE + turn_conditions UPSERT ─── 커밋
// 7. 캐릭터 LLM                    CLOSING 이면 **부르지 않는다**   ③
// 8. messages INSERT (character) + llm_calls  ─── 커밋
// ```
//
// 파이썬과 갈린 자리는 **어디서 끊어 부를 수 있나**뿐이다. 파이썬은 1~6 을 `분석까지()`,
// 7~8 을 `대사까지()` 로 갈랐고(결정 44), 여기서는 라우트 계약이 ①②③ 으로 가르므로
// **셋으로** 갈랐다 (`docs/설계/라우트계약.md` 3~5절). `runTurn()` 은 셋을 이어 부를 뿐이다.
//
// ## 커밋 경계 (결정 18 — 커밋은 부르는 쪽이 한다)
//
// 파이썬은 `커밋: Callable` 을 인자로 받아 세 자리에서 `conn.commit()` 했다. 검사가
// 되돌릴 수 있어야 했기 때문이다. 드리즐에는 그 손잡이가 없고 대신 `conn.transaction()` 이
// 있는데, **밖에서 트랜잭션이 안 열려 있으면 그 안이 한 트랜잭션으로 커밋되고,
// 열려 있으면 savepoint 가 된다.** 그래서 검사는 바깥 트랜잭션 하나로 전부 되돌린다
// (`tests/repo.test.ts` 와 같은 방식).
//
// - **함께 살아남아야 하는 쓰기만** `한묶음()` 으로 감싼다.
// - 낱개 쓰기(아이 메시지 한 행)는 그대로 둔다 — 문장 하나가 곧 한 트랜잭션이다.
// - ⛔ `lib/repo/` 는 여전히 트랜잭션을 여닫지 않는다. 경계는 **이 파일에만** 있다.
//
// ## 🔴 이 파일이 지키는 규칙 여섯
//
// 1. 캐릭터는 `characterTurn()` 만 부른다. `generateLine()` 을 직접 부르지 않는다 —
//    CLOSING 갈림(`CLAUDE.md` 경계 4)이 그 함수 안에 있고, 여기서 한 번 더 보면
//    **가르는 자리가 둘이 된다.** 그래서 이 파일에는 `'CLOSING'` 이라는 글자가 없다.
// 2. `missing_elements` 를 저장하지 않는다 (경계 5). `required_elements −
//    accumulated_elements` 로 매번 계산한다.
// 3. `turn_conditions` 에 이번 턴 판정을 박제한다 — 엔진은 그 표를 모르고
//    **부르는 쪽이 받아 적는다.** 없으면 턴 로그 화면이 회차 전체를 못 그린다.
// 4. 로그 세 줄(`[분석]`·`[상태]`·`[판정]`)을 찍는다. **이 로그가 이 레포의 존재 이유다.**
// 5. 커밋은 부르는 쪽이 한다 (위 절).
// 6. `character_opening`·`character_closing` 은 고정 텍스트다. 생성하지 않는다
//    (여는 말은 `service/story.ts` 의 `startScene()`, 닫는 말은 `characterTurn()` 이 준다).

import type { Settings } from '@/llm/config'
import {
  decide,
  type AnalysisResult,
  type Decision,
  type SceneConstants,
  type SessionState,
} from '@/llm/domain/decide'
import { ValueError } from '@/llm/domain/progress'
import { analyze, postProcess, type AnalysisPayload } from '@/llm/engine/analyze'
import { characterTurn, type CharacterDirection } from '@/llm/engine/character'
import { buildAnalysisMaterial, type NarrationScene } from '@/llm/engine/material'
import { LLMError, type LLMResult } from '@/llm/provider'
import { analysisLine, decisionLine, dialogueLine, printLine, sceneEndLine, stateLine } from '@/llm/log'
import { boundaryChecks, type JudgeInput } from '@/llm/judge'
import { requireDialogueScene, type SceneRow } from '@/llm/repo/content'
import type { Conn } from '@/llm/repo/db'
import { insertScore } from '@/llm/repo/review'
import { insertAttempts, type LlmCallRow } from '@/llm/repo/runs'
import {
  insertAnalysis,
  insertMessage,
  lastCharacterMessage,
  nextMessage,
  overwriteMessageText,
  readSession,
  sceneMessages,
  updateSession,
  type SessionRow,
} from '@/llm/repo/sessions'
import { latestSeedRevision } from '@/llm/repo/seed'
import { upsertTurnCondition } from '@/llm/repo/turn-conditions'

/** 진행 상황을 화면에 알리는 자리. 기본은 아무것도 하지 않는다 (파이썬 `안알림`). */
export type Notify = (제목: string, 내용: string) => void

const 안알림: Notify = () => {}

/**
 * 함께 살아남아야 하는 쓰기를 한 트랜잭션으로 묶는다.
 *
 * 바깥에 트랜잭션이 없으면 이 안이 커밋 단위가 되고, 있으면 savepoint 가 된다
 * (검사가 그 성질로 되돌린다). 파이썬 `커밋()` 콜백이 놓이던 자리다.
 */
async function 한묶음<T>(conn: Conn, 본문: (tx: Conn) => Promise<T>): Promise<T> {
  return conn.transaction(async (tx) => 본문(tx))
}

/**
 * 한 턴이 LLM 실패로 끊겼다. **어디까지 갔는지**를 같이 싣는다 (파이썬 `턴실패`, 결정 44).
 *
 * `LLMError` 를 그대로 상속한다 — `catch (e instanceof LLMError)` 하던 자리가 안 깨진다.
 * 라우트는 이것을 502 `LLM_UNAVAILABLE`(retryable) 로 옮긴다.
 *
 * ⚠️ 파이썬은 여기에 **그때까지의 시도 전부**를 실어 부르는 쪽이 기록하게 했다.
 *    여기서는 **단계마다 그 자리에서 `llm_calls` 에 남기고** 던지므로 이어 붙이지 않는다 —
 *    분석 시도는 분석 단계가 이미 커밋했다 (결정 44 가 노린 것이 그것이다).
 */
export class TurnFailed extends LLMError {
  readonly child_message_id: string
  readonly stage: 'analysis' | 'character'

  constructor(
    원인: Error,
    {
      child_message_id,
      stage,
      attempts = [],
    }: {
      child_message_id: string
      stage: 'analysis' | 'character'
      attempts?: LLMResult['attempts']
    },
  ) {
    super(원인.message, attempts)
    this.name = 'TurnFailed'
    this.cause = 원인
    this.child_message_id = child_message_id
    this.stage = stage
  }
}

/**
 * `docs/기준/db구조.md:302` — 확정된 텍스트가 없으면 메시지를 생성하지 않는다.
 *
 * 터미널에서 엔터만 친 것, 화면에서 빈 칸을 보낸 것이 여기 해당한다. 턴 카운트도 안 올린다.
 * (파이썬 `runner.유효한_발화()`)
 */
export function isUsableUtterance(글: string | null | undefined): boolean {
  return Boolean(글 && 글.trim())
}

// ═══════════════════════════════════════════════════════════════════════════
// ① 분석 — 아이 발화를 저장하고 분석 LLM 을 부른다
// ═══════════════════════════════════════════════════════════════════════════

export interface AnalysisStageArgs {
  conn: Conn
  run_id: string
  session_id: string
  scene: SceneRow
  /** 이 장면보다 앞선 **전개** 장면들 (결정 25 — 뒷이야기 스포일러 금지). */
  precedingNarrations?: readonly NarrationScene[]
  child_utterance: string
  /**
   * 이미 저장된 아이 메시지. 주면 **그 행을 그대로 쓴다** (같은 턴 재시도 · 결정 44).
   * `messages` 행을 새로 만들지 않으므로 턴 수도 `turn_order` 도 어긋나지 않는다.
   */
  child_message?: { id: string; turn_order: number } | null
  /** `runs.default_utterance_source` 에서 온다. 요청에 두지 않는다 (계약 3절). */
  utterance_source?: string | null
  settings?: Settings
  /** 회차에 저장된 실험 프롬프트. 안 주면 `prompts/analysis.md` 를 읽는다. */
  prompt?: string | null
  notify?: Notify
}

export interface AnalysisStage {
  child_message_id: string
  turn_order: number
  /** **후처리 전 원본**이다. 저장된 것과 같다 (결정 26). */
  analysis: AnalysisPayload
  /** 후처리로 살린 요소 `type` 들 — ② 에 넣을 값이다. */
  kept: readonly string[]
  /** 후처리로 버린 것. 로그와 화면용. */
  dropped: readonly string[]
  llm: LLMResult
}

/**
 * 1~4 단계 (계약 ①). ⛔ **여기서 `decide()` 를 부르지 않는다.**
 *
 * 파이썬 `분석까지()` 는 판정까지 한 함수였다. 그것을 ① 과 ② 로 가르는 것이 계약의 핵심이고
 * (`라우트계약.md` 3절), 관리자 화면이 분석만 다시 돌려 보는 자리가 여기서 생긴다.
 */
export async function runAnalysisStage(args: AnalysisStageArgs): Promise<AnalysisStage> {
  const {
    conn,
    run_id,
    session_id,
    scene,
    precedingNarrations = [],
    child_utterance,
    child_message = null,
    utterance_source = null,
    settings,
    prompt = null,
    notify = 안알림,
  } = args

  // 아이가 말하지 않는 장면에는 턴이 없다. 여기서 막지 않으면 `preferred_turns` 가 null 인
  // 채로 규칙에 들어가 첫 턴에 장면이 끝난다.
  requireDialogueScene(scene)

  // 1 ─ 아이 발화 저장. 분석보다 먼저다(1.1 표 4단계 → 5단계).
  //     `utterance_analyses.message_id` 가 NOT NULL FK 라 순서를 바꿀 수도 없다.
  //     ⚠️ 분석이 죽어도 이 행은 되돌리지 않는다 (결정 18).
  const 아이_메시지 =
    child_message ??
    (await insertMessage(conn, {
      session_id,
      scene_id: scene.scene_id,
      speaker_type: 'child',
      text: child_utterance,
      utterance_source,
    }))

  // 2 ─ 분석 LLM. 트랜잭션 밖이다(타임아웃 30초 × 공급자 여럿).
  const 재료 = buildAnalysisMaterial({
    scene,
    precedingNarrations,
    child_utterance,
    // 우리가 상태 주인이므로 우리 `messages` 에서 읽는다. 재료를 만드는 층은
    // 이 값이 어디서 왔는지 모른다 (`engine/material.ts` 머리말).
    previous_character_message: await lastCharacterMessage(conn, {
      session_id,
      scene_id: scene.scene_id,
    }),
    prompt,
  })

  notify('분석 시작', '')
  let 분석: AnalysisPayload
  let 응답: LLMResult
  try {
    const 결과 = await analyze(재료, { prompt, settings, notify })
    분석 = 결과.analysis
    응답 = 결과.llm
  } catch (오류) {
    // 시도 기록을 **여기서** 남긴다. 흘리면 사유가 예외 안에서 소멸하고
    // `llm_calls` 에 한 건도 안 남아 화면이 실패를 읽을 곳이 사라진다 (FR-002 · FR-040).
    if (오류 instanceof LLMError) {
      await 남긴다(conn, { run_id, message_id: 아이_메시지.id, attempts: 오류.attempts })
      throw new TurnFailed(오류, {
        child_message_id: 아이_메시지.id,
        stage: 'analysis',
        attempts: 오류.attempts,
      })
    }
    throw 오류
  }

  // 3 ─ 후처리. `decide()` 앞에서 끝나 있어야 한다 (`decide.ts` 머리말, 결정 26).
  const { kept, dropped } = postProcess(분석.detected_elements, child_utterance)

  // 4 ─ 분석 저장(**후처리 전 원본**)과 시도 기록을 한 트랜잭션에.
  await 한묶음(conn, async (tx) => {
    await insertAnalysis(tx, {
      message_id: 아이_메시지.id,
      // zod 는 `evidence` 가 없으면 `null` 로 둔다(LLM 이 안 줄 수 있다).
      // 스키마와 저장 계층이 그 `null` 을 받으므로 **값을 지어내 채우지 않는다.**
      analysis: 분석,
    })
    await insertAttempts(tx, { run_id, message_id: 아이_메시지.id, attempts: 응답.attempts })
  })

  // 로그 첫 줄. 나머지 둘은 판정이 나야 찍을 수 있다 (② 가 찍는다).
  printLine(analysisLine(분석, { 버린: dropped }))

  return {
    child_message_id: 아이_메시지.id,
    turn_order: 아이_메시지.turn_order,
    analysis: 분석,
    kept,
    dropped,
    llm: 응답,
  }
}

/** 실패한 시도도 한 행씩 남긴다 (결정 33). 남길 것이 없으면 아무것도 안 한다. */
async function 남긴다(
  conn: Conn,
  {
    run_id,
    message_id,
    attempts,
  }: { run_id: string; message_id: string | null; attempts: LLMResult['attempts'] },
): Promise<void> {
  if (attempts.length === 0) return
  await 한묶음(conn, async (tx) => {
    await insertAttempts(tx, { run_id, message_id, attempts })
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// ② 판단 — 순수 함수 한 번. LLM 이 아니다
// ═══════════════════════════════════════════════════════════════════════════

export interface DecisionStageArgs {
  conn: Conn
  run_id: string
  /** `runs.prompt_version`. `turn_conditions` 에 베껴 박제한다. */
  prompt_version: string
  /**
   * 이 턴이 본 시드 판 번호. **안 주면 여기서 `latestSeedRevision()` 을 읽는다.**
   *
   * ⚠️ 파이썬은 턴을 시작할 때 **장면 행보다도 먼저** 붙잡아 내려보냈다
   *    (`회차.턴_돌리기()` — 「T083: 조건 번호를 먼저 붙잡고, 그 다음 장면 행을 한 번 읽어」).
   *    그 사이에 사람이 시드를 고치면 **이 턴이 실제로 쓴 장면은 N 판인데 여기 박히는 것은
   *    N+1** 이 되고, 회차끼리 견주는 일이 조용히 거짓이 된다.
   *
   * 🔴 그래서 붙잡는 자리는 **장면 행을 읽는 쪽**이다 — 읽기 전에 잡아 여기로 내려보낸다.
   *    안 받고 스스로 읽으면 지켜지는 것은 「분석 LLM 앞」까지고 **「장면 읽기 앞」이 아니다.**
   *    내려보내는 자리는 넷이고, 넷을 검사가 하나씩 잡고 있다: `run.submitTurn()` ·
   *    `run.resumeTurn()` 의 두 갈래 · `step.decisionStep()` · `story.runStory()` 의 루프.
   */
  seed_revision?: number
  session_id: string
  scene: SceneRow
  child_message_id: string
  /**
   * ⚠️ `detected_elements` 는 **후처리로 살린 것(`kept`)** 이다. 저장된 원본이 아니다 —
   * 원본을 그대로 넣으면 판정이 달라진다 (`라우트계약.md` 4절).
   */
  analysis: AnalysisResult
}

export interface DecisionStage {
  decision: Decision
  /** 저장하지 않고 매번 계산한다 (`CLAUDE.md` 경계 5). */
  missing: readonly string[]
  /** `decide()` 에 넣은 값 — 이번 발화를 **포함한** 턴 수다. */
  state: SessionState
  /** `story_sessions` 에 저장된 값 = `[상태]` 줄. */
  saved_state: SessionState
  /** 갱신된 뒤의 세션 한 행. 화면의 「누적 상태」가 이걸 그린다. */
  session: SessionRow
}

/**
 * 5~6 단계 (계약 ②). **LLM 을 부르지 않는다** (`CLAUDE.md` 경계 2).
 *
 * ⚠️ **턴 수 +1 은 여기서 놓는다.** DB 값은 이번 발화 **전**, `decide()` 는 이번 발화
 * **포함** 값을 받는다 (결정 17-a · `decide.ts` 머리말). 부르는 쪽은 이 규칙을 몰라도 된다.
 */
export async function runDecisionStage(args: DecisionStageArgs): Promise<DecisionStage> {
  const { conn, run_id, prompt_version, session_id, scene, child_message_id, analysis } = args
  // FR-060a — 「고친 값은 **다음 턴부터** 붙는다」가 여기서 나온다. 판정을 낼 때의 판을
  // 박제하므로 앞 턴의 행은 뒤에 시드를 고쳐도 그대로다 (SC-014).
  const seed_revision = args.seed_revision ?? (await latestSeedRevision(conn))

  // 결정 19 — 매 턴 DB 에서 읽는다. 메모리에 들고 있지 않는다.
  const 세션 = await readSession(conn, session_id)
  const 상태: SessionState = {
    // DB 값은 이번 발화 전, decide() 는 이번 발화 포함 값을 받는다 (결정 17-a).
    // 이 +1 이 조립층이 놓는 다리다 (결정 18).
    current_child_turn_count: 세션.current_child_turn_count + 1,
    accumulated_elements: 세션.accumulated_elements,
    last_response_mode: 세션.last_response_mode,
    last_guidance_target: 세션.last_guidance_target,
    turns_without_new_element: 세션.turns_without_new_element,
    consecutive_low_information_turns: 세션.consecutive_low_information_turns,
  }

  const 상수: SceneConstants = {
    required_elements: scene.required_elements ?? [],
    // 대화 장면이면 CHECK 가 NOT NULL 을 보장한다 (`db/schema.ts` 5절).
    preferred_turns: scene.preferred_turns ?? 0,
    max_turns: scene.max_turns ?? 0,
  }

  const 판정 = decide(상태, 상수, analysis)

  // ⛔ 경계 5 — missing 은 저장하지 않고 매번 계산한다.
  //    `required_elements` 의 배열 순서를 그대로 살린다 (결정 14).
  const missing = 상수.required_elements.filter(
    (요소) => !판정.accumulated_elements.includes(요소),
  )

  const 저장된_상태: SessionState = {
    current_child_turn_count: 상태.current_child_turn_count,
    accumulated_elements: 판정.accumulated_elements,
    // 직전 값이다. 이름에 `last_` 가 붙어 있어 헷갈리지 않는다.
    last_response_mode: 세션.last_response_mode,
    // 이쪽은 **이번 턴을 반영한** 값이다. 다음 턴이 이걸 보고 같은 요소를 피한다 (이슈 #27).
    last_guidance_target: 판정.last_guidance_target,
    turns_without_new_element: 판정.turns_without_new_element,
    consecutive_low_information_turns: 판정.consecutive_low_information_turns,
  }

  await 한묶음(conn, async (tx) => {
    // 1.1 표 6·7단계를 한 번에 (결정 18).
    await updateSession(tx, {
      session_id,
      decision: 판정,
      turn_count: 상태.current_child_turn_count,
      last_detected: analysis.detected_elements,
    })
    // ⭐ 판정을 **판정 직후** 박제한다 (결정 44). 턴이 끝난 뒤에 몰아 쓰면 캐릭터 LLM 이
    //    죽을 때 판정 스냅샷까지 함께 사라지고, ③ 재호출이 그때의 모드를 되살릴 곳이 없다.
    //    ⛔ `missing_elements` 는 여기에도 안 들어간다 — 이 표는 뺄셈의 **재료**를 남긴다.
    await upsertTurnCondition(tx, {
      message_id: child_message_id,
      run_id,
      seed_revision,
      prompt_version,
      current_child_turn_count: 저장된_상태.current_child_turn_count,
      accumulated_elements: [...저장된_상태.accumulated_elements],
      last_response_mode: 저장된_상태.last_response_mode,
      turns_without_new_element: 저장된_상태.turns_without_new_element,
      consecutive_low_information_turns: 저장된_상태.consecutive_low_information_turns,
      response_mode: 판정.response_mode,
      guidance_target: 판정.guidance_target,
      soft_cue: 판정.soft_cue,
      reaction_key: 판정.reaction_key,
      scene_goal_met: 판정.scene_goal_met,
      scene_end_reason: 판정.scene_end_reason,
    })
  })

  printLine(stateLine(저장된_상태, { missing }))
  printLine(decisionLine(판정))

  return {
    decision: 판정,
    missing,
    state: 상태,
    saved_state: 저장된_상태,
    session: await readSession(conn, session_id),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ③ 대사 — 문장 하나. CLOSING 갈림은 `characterTurn()` 안에 있다
// ═══════════════════════════════════════════════════════════════════════════

export interface DialogueStageArgs {
  conn: Conn
  run_id: string
  session_id: string
  scene: SceneRow
  precedingNarrations?: readonly NarrationScene[]
  child_utterance: string
  child_message_id: string
  /** 아이 메시지의 `turn_order`. 이번 발화를 「지난 말」에서 빼는 기준이다. */
  turn_order: number
  main_point: string | null
  /** ② 가 돌려준 값 그대로. 관리자 화면은 이 셋을 바꿔 ③ 만 다시 돌린다. */
  decision: CharacterDirection
  settings?: Settings
  prompt?: string | null
  notify?: Notify
  /**
   * 경계 채점을 돌릴지 (파이썬 `회차._자동_채점`). 기본은 **켬** — 파이썬이 턴마다 돌렸다.
   * 끄는 자리는 검사와, 채점 없이 대사만 다시 뽑아 보는 화면이다.
   */
  autoScore?: boolean
  /**
   * 경계 채점에서 **심판(LLM)까지** 부를지. 기본은 **끔** (파이썬 `경계_채점(심판_포함=False)`).
   *
   * 🔴 켜면 턴마다 LLM 호출이 최대 셋 더 붙는다 — **돈이 든다.** 되풀이는 무료로,
   *    검수할 때만 태운다는 규칙이 여기에도 걸린다 (`CLAUDE.md` LLM 공급자 절).
   */
  judges?: boolean
}

export interface DialogueStage {
  /** 새로 만들었거나 **덮어쓴** 캐릭터 `messages` 행. */
  message_id: string
  turn_order: number
  /** TTS 로 그대로 읽히는 문장. */
  text: string
  /** `fixed` = `story_scenes.character_closing` 원문 (`CLAUDE.md` 경계 4). */
  source: 'generated' | 'fixed'
  /** 이번 호출이 이미 있던 캐릭터 행을 덮어썼나 (③ 재호출). */
  overwritten: boolean
  llm: LLMResult | null
}

/**
 * 채점기에 넣을 재료를 짠다 (파이썬 `회차._자동_채점` 의 앞부분).
 *
 * 🔴 **`대사` 에는 「캐릭터 LLM 이 만든 것」만 넣는다.** 고정 마지막 대사(`source === 'fixed'`)
 *    는 사람이 써 넣은 문장이라 「경계를 넘었나」를 물을 자리가 아니고, 넣으면
 *    `fabricated_fixed_line` 이 **언제나 위반**으로 나온다 (`CLAUDE.md` 경계 4).
 *    파이썬도 `대사단계.대사` 가 CLOSING 이면 `None` 이라 같은 값이 들어갔다.
 *
 * ⚠️ **파이썬보다 네 칸을 더 채운다** — `child_utterance` · `guidance_target` ·
 *    `element_criterion` · `remaining_worry`. 넷 다 **심판(LLM)만 읽는 값**이라
 *    규칙 심판 셋의 결과는 파이썬과 한 글자도 안 달라진다. 파이썬이 이 칸들을 비워 둔 것은
 *    거기서 심판을 아예 안 켰기 때문이고, 비운 채로 켜면 과녁 심판이 늘 「판정 안 함」이 된다.
 */
function 경계채점_재료(args: {
  scene: SceneRow
  precedingNarrations: readonly NarrationScene[]
  decision: CharacterDirection
  child_utterance: string
  글: string
  source: 'generated' | 'fixed'
}): JudgeInput {
  const { scene, precedingNarrations, decision, child_utterance, 글, source } = args
  const 과녁 = decision.guidance_target
  return {
    대사: source === 'generated' ? 글 : '',
    response_mode: decision.response_mode,
    character_opening: scene.character_opening,
    character_closing: scene.character_closing,
    scene_goal: scene.scene_goal,
    child_utterance,
    이야기_재료: [
      ...precedingNarrations.map((앞) => 앞.scene_description ?? ''),
      scene.conflict ?? '',
      scene.persona ?? '',
    ]
      .filter((글) => 글 !== '')
      .join('\n'),
    guidance_target: 과녁,
    element_criterion: 과녁 === null ? null : (scene.element_criteria[과녁] ?? null),
    remaining_worry: 과녁 === null ? null : (scene.remaining_worries[과녁] ?? null),
  }
}

/**
 * 7~8 단계 (계약 ③). **`story_sessions` 를 건드리지 않는다** — 세션 갱신은 ② 가 끝냈다.
 *
 * 그래서 이 함수만 다시 부르는 재호출이 **턴 카운트를 두 번 올리지 않는다** (FR-035 · 결정 44).
 *
 * ⛔ `generateLine()` 을 직접 부르지 않는다. 부를지 말지를 가르는 자리는
 *    `characterTurn()` 하나뿐이다 (`engine/character.ts`).
 */
export async function runDialogueStage(args: DialogueStageArgs): Promise<DialogueStage> {
  const {
    conn,
    run_id,
    session_id,
    scene,
    precedingNarrations = [],
    child_utterance,
    child_message_id,
    turn_order,
    main_point,
    decision,
    settings,
    prompt = null,
    notify = 안알림,
    autoScore = true,
    judges = false,
  } = args

  // 이 장면에서 오간 말. **이번 발화는 빼고** 준다 — 그 규칙을 우리가 지킨다 (계약 5절).
  const 지난_말 = await sceneMessages(conn, {
    session_id,
    scene_id: scene.scene_id,
    before_turn_order: turn_order,
  })

  // ⚠️ CLOSING 인지 여기서 보지 않으므로 알림도 가르지 않는다. 고정 대사면 즉시 끝나
  //    이 알림이 화면에 남지 않는다 — 갈림을 하나로 두는 값이 그 정도다.
  notify('캐릭터 대사 시작', '')

  let 결과
  try {
    결과 = await characterTurn({
      scene,
      precedingNarrations,
      child_utterance,
      main_point,
      decision,
      pastMessages: 지난_말,
      prompt,
      settings,
      notify,
    })
  } catch (오류) {
    if (오류 instanceof LLMError) {
      await 남긴다(conn, { run_id, message_id: child_message_id, attempts: 오류.attempts })
      throw new TurnFailed(오류, {
        child_message_id,
        stage: 'character',
        attempts: 오류.attempts,
      })
    }
    throw 오류
  }

  const 글 = 결과.fixed_closing ?? 결과.line
  if (글 === null) {
    // 대화 장면이면 CHECK 가 `character_closing` 을 보장한다. 여기 오면 데이터가 깨진 것이다.
    throw new ValueError(`${scene.code}: 캐릭터가 할 말이 없다 (character_closing 이 비었나?)`)
  }
  const source = 결과.fixed_closing === null ? 'generated' : 'fixed'

  // ⭐ ③ 재호출 — 이 턴의 캐릭터 행이 이미 있으면 **덮어쓴다** (`라우트계약.md` 8절 결정).
  //    새로 넣으면 같은 턴의 대사가 둘이 되어 턴 로그가 어긋난다.
  //    「바로 다음 한 행」만 본다 — 화자를 걸러 집으면 실패한 턴이 **다음 턴의 대사**를
  //    자기 것으로 착각한다 (파이썬 `회차.미완_턴()` 주석).
  const 다음 = await nextMessage(conn, { session_id, turn_order })
  const 덮어쓸_행 =
    다음 !== null && 다음.speaker_type === 'character' && 다음.scene_id === scene.scene_id
      ? 다음
      : null

  // ⭐ 경계 채점은 **트랜잭션 밖**에서 먼저 돌린다. 심판을 켜면 LLM 을 타는데,
  //    열린 트랜잭션을 붙잡고 네트워크를 기다리면 그동안 이 연결이 잠긴다.
  //    심판을 끈 기본값에서는 순수 함수 셋뿐이라 아무것도 안 기다린다.
  const 검사들 = autoScore
    ? await boundaryChecks(경계채점_재료({ scene, precedingNarrations, decision, child_utterance, 글, source }), {
        judges,
        settings,
      })
    : []

  const { 행: 캐릭터_행 } = await 한묶음(conn, async (tx) => {
    const 행 =
      덮어쓸_행 === null
        ? // 어느 쪽이든 `messages` 는 **한 행**이다 (결정 21 · 36).
          await insertMessage(tx, {
            session_id,
            scene_id: scene.scene_id,
            speaker_type: 'character',
            text: 글,
          })
        : await overwriteMessageText(tx, { message_id: 덮어쓸_행.id, text: 글 })
    let 시도들: LlmCallRow[] = []
    if (결과.llm !== null) {
      시도들 = await insertAttempts(tx, {
        run_id,
        message_id: child_message_id,
        attempts: 결과.llm.attempts,
      })
    }
    // 파이썬 `회차.py:269` — 마지막으로 **성공한** 캐릭터 호출이 이 판정의 출처다.
    const 성공_캐릭터 = [...시도들].reverse().find((시도) => 시도.ok) ?? null
    for (const 검사 of 검사들) {
      await insertScore(tx, {
        run_id,
        // 🔴 **아이 발화 id 다**, 캐릭터 행 id 가 아니다 (파이썬 `message_id=아이_메시지_id`).
        //    `scores.message_id` 는 「어느 아이 발화에 대한 판정인가」다 (`repo/review.ts` 머리말).
        message_id: child_message_id,
        llm_call_id: 성공_캐릭터?.id ?? null,
        target: 'utterance',
        check_name: 검사.name,
        value: 검사.value,
        comment: 검사.comment,
        violated_item: null,
        graded_by: 'auto',
      })
    }
    return { 행 }
  })

  printLine(dialogueLine(scene.character_name ?? '', 글, { 고정: source === 'fixed' }))

  return {
    message_id: 캐릭터_행.id,
    turn_order: 캐릭터_행.turn_order,
    text: 글,
    source,
    overwritten: 덮어쓸_행 !== null,
    llm: 결과.llm,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 한 턴 = ① → ② → ③
// ═══════════════════════════════════════════════════════════════════════════

export interface RunTurnArgs {
  conn: Conn
  run_id: string
  prompt_version: string
  session_id: string
  scene: SceneRow
  precedingNarrations?: readonly NarrationScene[]
  child_utterance: string
  child_message?: { id: string; turn_order: number } | null
  utterance_source?: string | null
  /**
   * 이 턴이 본 시드 판 번호. **장면 행을 읽기 전에 붙잡아 여기로 내려보낸다**
   * (`DecisionStageArgs.seed_revision` 의 긴 설명이 그 이유다). 안 주면 아래에서 읽는다.
   */
  seed_revision?: number
  /** 회차에 박힌 모델·강도. 안 주면 `.env.local` 값이다 (`service/run.ts` 의 `runSettings()`). */
  analysis_settings?: Settings
  character_settings?: Settings
  /** 회차에만 저장된 실험 본문. 안 주면 `prompts/*.md` 를 읽는다 (결정 41·42 와 같은 주입). */
  analysis_prompt?: string | null
  character_prompt?: string | null
  notify?: Notify
}

/** 한 턴에서 나온 것 전부. 로그에 찍은 것과 같은 값이다 (파이썬 `턴결과`). */
export interface TurnResult extends AnalysisStage, DecisionStage {
  dialogue: DialogueStage
}

/**
 * 아이 발화 한 건을 끝까지 돌린다. 순서는 이 파일 머리말 참고 (결정 18).
 *
 * 세 단계를 이어 부를 뿐이다 — **순서도 커밋 자리도 그대로**다. 갈라 둔 조각을 따로
 * 부르는 것은 관리자 화면(단계별로 다시 돌리기)과 ③ 재호출뿐이다.
 */
export async function runTurn(args: RunTurnArgs): Promise<TurnResult> {
  // ⭐ 조건 번호는 **부르는 쪽이 장면 행을 읽기 전에** 붙잡아 내려보낸다 (파이썬
  //    `회차.턴_돌리기()` 의 T083 주석). 여기서 읽는 것은 안 내려왔을 때의 차선이고,
  //    그때 지켜지는 것은 「분석 LLM 앞」까지다 — **「장면 읽기 앞」이 아니다.**
  //    ⚠️ 이 레포 안에서 `runTurn()` 을 부르는 자리는 **전부 내려보낸다.** 그러니 이 `??`
  //    가 실제로 쓰이면 그건 새로 생긴 호출부가 규칙을 안 지켰다는 뜻이다 (검사가 잡는다).
  const seed_revision = args.seed_revision ?? (await latestSeedRevision(args.conn))

  const 앞 = await runAnalysisStage({
    conn: args.conn,
    run_id: args.run_id,
    session_id: args.session_id,
    scene: args.scene,
    precedingNarrations: args.precedingNarrations,
    child_utterance: args.child_utterance,
    child_message: args.child_message,
    utterance_source: args.utterance_source,
    settings: args.analysis_settings,
    prompt: args.analysis_prompt,
    notify: args.notify,
  })

  const 가운데 = await runDecisionStage({
    conn: args.conn,
    run_id: args.run_id,
    prompt_version: args.prompt_version,
    seed_revision,
    session_id: args.session_id,
    scene: args.scene,
    child_message_id: 앞.child_message_id,
    analysis: {
      child_intent: 앞.analysis.child_intent,
      // 후처리로 살린 것만 (결정 26).
      detected_elements: 앞.kept,
      utterance_validity: 앞.analysis.utterance_validity,
    },
  })

  const 뒤 = await runDialogueStage({
    conn: args.conn,
    run_id: args.run_id,
    session_id: args.session_id,
    scene: args.scene,
    precedingNarrations: args.precedingNarrations,
    child_utterance: args.child_utterance,
    child_message_id: 앞.child_message_id,
    turn_order: 앞.turn_order,
    main_point: 앞.analysis.main_point,
    decision: 가운데.decision,
    settings: args.character_settings,
    prompt: args.character_prompt,
    notify: args.notify,
  })

  // 고정 마지막 대사가 나갔으면 이 장면은 끝난 것이다 (결정 21 · 36).
  // ⛔ CLOSING 인지 여기서 다시 보지 않는다 — `source === 'fixed'` 가 그 판정의 **결과**다.
  //    글자를 한 번 더 적으면 가르는 자리가 둘이 된다.
  if (뒤.source === 'fixed') printLine(sceneEndLine(args.scene, 가운데.decision))

  return { ...앞, ...가운데, dialogue: 뒤 }
}
