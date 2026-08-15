// 화면이 읽는 절반 — 회차를 **그리기 위해** 저장된 사실을 조립한다 (이슈 #26 화면-3).
//
// 파이썬 `goodquestion_admin/회차.py` 의 읽는 절반(`메시지_목록`·`턴_로그_줄들`)과
// `routes/runs.py` 의 조립 함수 셋(`_장면_묶음들`·`_예비공급자_쓴_턴들`·`_상세_문맥`)을
// 옮긴 것이다. `service/run.ts` 머리말이 「읽어서 화면에 그리는 절반은 화면 트랙이
// 가져간다」고 남겨 둔 자리가 여기다.
//
// ## ⛔ 여기서 판정하지 않는다 (`CLAUDE.md` 경계 6)
//
// 모드도 장면 종료도 **다시 계산하지 않는다.** `turn_conditions` 에 박제된 값을 되살려
// 문자열로 만들 뿐이다. 스냅샷이 없는 턴이면 `null` 을 준다 — **꾸며 내지 않는다.**
//
// ⭐ 딱 둘만 매번 다시 센다. 둘 다 **저장하지 않기로 한 값**이라 그렇다.
//
// | 무엇 | 왜 |
// |---|---|
// | `missing_elements` | `required_elements − accumulated_elements` (경계 5) |
// | `dropped`(버림) | `postProcess()` 가 (원본 요소, 아이 발화) 만으로 같은 답을 내는 순수 함수다 |
//
// ## 로그 세 줄은 **새로 만들지 않는다**
//
// `lib/log.ts` 의 `analysisLine()`·`stateLine()`·`decisionLine()` 을 불러 **그 문자열을
// 그대로** 쓴다. 꾸미는 것은 이 문자열 **옆**에 두지 **대신** 두지 않는다
// (`CLAUDE.md` 로그 절 — 지우거나 요약하지 말 것).

import { 단가표_읽기, 비용_계산 } from '@/llm/config'
import type { Decision } from '@/llm/domain/decide'
import { nextStep, type Step } from '@/llm/domain/progress'
import { postProcess } from '@/llm/engine/analyze'
import { analysisLine, decisionLine, stateLine } from '@/llm/log'
import { listStories, scenesOfStory, type SceneRow, type StoryRow } from '@/llm/repo/content'
import { getDb, type Conn } from '@/llm/repo/db'
import {
  autoScoreSummary,
  currentAutoScores,
  type AutoScoreSummary,
  type ScoreRow,
} from '@/llm/repo/review'
import {
  attemptTotals,
  listRunsWithStory,
  readAttempts,
  readRun,
  type LlmCallRow,
  type RunRow,
  type RunWithStory,
} from '@/llm/repo/runs'
import {
  readMessage,
  readSavedAnalysis,
  readSessionWithStory,
  sessionTranscript,
  type SessionWithStory,
  type TranscriptRow,
} from '@/llm/repo/sessions'
import {
  readRunTurnConditions,
  readTurnCondition,
  type TurnConditionRow,
} from '@/llm/repo/turn-conditions'

import {
  inProgress,
  pendingTurn,
  restoreDecision,
  runState,
  turnFailureState,
  type PendingStage,
  type TurnFailureState,
} from './run'

// ═══════════════════════════════════════════════════════════════════════════
// 순수 조립 — DB 를 모른다. 값만 받아 값을 낸다
// ═══════════════════════════════════════════════════════════════════════════

/** 대화 장면 하나 = 쪽 하나. 앞선 전개 지문이 그 대화에 딸려 붙는다. */
export interface ScenePage {
  scene_order: number
  character_name: string | null
  scenes: SceneRow[]
}

/**
 * 장면 목록을 사람이 「장면」이라 부르는 단위로 묶는다 (파이썬 `_장면_묶음들()`).
 *
 * 시드가 「전개 · 전개 · 며느리와 대화 · 전개 · 시아버지와 대화 …」라서 사람이 세는
 * 단위는 **대화 상대가 바뀌는 자리**다. 전개 지문만 따로 한 쪽으로 떼면 읽을 것이 없는
 * 빈 쪽이 생긴다.
 *
 * ⭐ 끝에 대화 없이 전개만 남으면 **그것도 한 쪽이다.** 안 그러면 화면에서 통째로 사라진다.
 */
export function scenePages(scenes: readonly SceneRow[]): ScenePage[] {
  const 쪽들: ScenePage[] = []
  let 모으는_중: SceneRow[] = []

  for (const 장면 of scenes) {
    모으는_중.push(장면)
    if (장면.character_id !== null) {
      쪽들.push({
        scene_order: 장면.scene_order,
        character_name: 장면.character_name,
        scenes: 모으는_중,
      })
      모으는_중 = []
    }
  }
  if (모으는_중.length > 0) {
    쪽들.push({
      scene_order: 모으는_중[모으는_중.length - 1].scene_order,
      character_name: null,
      scenes: 모으는_중,
    })
  }
  return 쪽들
}

/**
 * 예비 공급자가 답한 시도 하나.
 *
 * ⚠️ `chosen_model` 만 영어로 새로 지은 이름이다 (파이썬 `고른_모델`). DB 컬럼도
 *    도메인 값도 아니라 `코드구조.md` 3절의 「그대로 두는 것」에 들지 않는다.
 */
export interface FallbackAttempt {
  purpose: string
  provider: string
  model: string
  /** 회차가 고르려 했던 모델. **무엇을 고르려 했는지가 함께 남아야 한다.** */
  chosen_model: string
  attempt_no: number
}

/** `_고른_모델()` — 용도에 따라 회차의 두 칸 중 하나. */
function 고른_모델(
  run: Pick<RunRow, 'analysis_model' | 'character_model'>,
  purpose: string,
): string | null {
  return purpose === 'analysis' ? run.analysis_model : run.character_model
}

/**
 * 턴마다 「고른 모델이 아닌 것이 **대답한**」 시도를 모은다 (파이썬 `_예비공급자_쓴_턴들()`).
 *
 * fallback 이 돌았다는 사실은 눈에 띄어야 한다 (`CLAUDE.md` 로그 절 — 눈으로 봐야 한다).
 * 시도 목록을 펼쳐야만 보이면 회차를 훑는 사람은 어느 턴이 예비로 답했는지 모른다.
 *
 * ⛔ **실패한 시도는 안 센다.** 실패는 `turnFailureState()` 가 따로 보여 준다. 여기서 말하는
 *    것은 「끝내 답을 준 것이 고른 모델이 아니었다」는 사실 하나다. 실패까지 세면 제미나이가
 *    한 번 막혔다가 제미나이가 답한 턴도 예비로 잘못 잡힌다.
 *
 * ⚠️ **파이썬과 한 자리가 갈린다** — 회차에 모델이 안 박혀 있으면(`null`, 설정 기본값을 썼다는
 *    뜻) **세지 않는다.** 파이썬은 그때 `시도["model"] == None` 이 늘 거짓이라 **성공한 모든
 *    시도가 예비로 잡혔다.** 우리 `startRun()` 은 모델을 안 주면 `null` 로 두므로 그대로 옮기면
 *    거의 모든 턴에 띠가 붙는다. 견줄 대상이 없으면 「예비였다」고 말할 수 없다.
 */
export function fallbackTurns(
  run: Pick<RunRow, 'analysis_model' | 'character_model'>,
  attempts: readonly Pick<
    LlmCallRow,
    'message_id' | 'purpose' | 'provider' | 'model' | 'attempt_no' | 'ok'
  >[],
): Map<string, FallbackAttempt[]> {
  const 결과 = new Map<string, FallbackAttempt[]>()

  for (const 시도 of attempts) {
    if (!시도.ok) continue
    if (시도.message_id === null) continue
    const 고른 = 고른_모델(run, 시도.purpose)
    if (고른 === null || 고른 === '') continue
    if (시도.model === 고른) continue

    const 쌓인 = 결과.get(시도.message_id) ?? []
    쌓인.push({
      purpose: 시도.purpose,
      provider: 시도.provider,
      model: 시도.model,
      chosen_model: 고른,
      attempt_no: 시도.attempt_no,
    })
    결과.set(시도.message_id, 쌓인)
  }
  return 결과
}

/** 저장된 값으로 되살린 콘솔 세 줄 + 그 줄이 쓴 두 목록. */
export interface TurnLogLines {
  /** `[분석]` — 분석 행이 없으면 `null` 이다 (턴이 거기서 죽었다). */
  분석: string | null
  /** `[상태]` */
  상태: string
  /** `[판정]` */
  판정: string
  accumulated_elements: readonly string[]
  missing_elements: readonly string[]
  /**
   * `[분석]` 줄의 `버림` — 근거를 아이 말에서 못 찾아 떨어낸 요소.
   *
   * ⭐ **문자열 안에만 있던 값을 밖으로 낸 것뿐이다** (2026-08-15). 세 줄을 화면에서 사람
   *    말로 옮기려면(규칙 1-1) 화면이 이 목록을 손에 쥐어야 하는데, 유일한 길이 `[분석]`
   *    문자열을 되파싱하거나 화면이 `postProcess()` 를 다시 돌리는 것이었다.
   *    앞은 로그 형식에 화면을 매고, 뒤는 엔진 규칙을 화면에 복사한다 — 둘 다 안 된다.
   *    ⛔ **계산은 그대로 여기서 한다.** 새로 하는 일이 없고 이미 낸 답을 함께 실을 뿐이다.
   */
  dropped: readonly string[]
}

/**
 * 저장된 값으로 콘솔 세 줄을 **되살린다** (파이썬 `턴_로그_줄들()` · FR-011 · SC-005).
 *
 * 되살릴 수 있는 이유는 `turn_conditions` 가 판정 당시 값을 박제하기 때문이다.
 * 스냅샷이 없는 옛 턴이면 `null` 을 돌려준다 — **꾸며 내지 않는다.**
 */
export function turnLogLines(
  메시지: Pick<
    TranscriptRow,
    'text' | 'child_intent' | 'main_point' | 'detected_elements' | 'utterance_validity'
  >,
  조건: TurnConditionRow | null,
  required_elements: readonly string[] | null,
): TurnLogLines | null {
  if (조건 === null) return null

  const 상태 = {
    current_child_turn_count: 조건.current_child_turn_count,
    accumulated_elements: 조건.accumulated_elements,
    last_response_mode: 조건.last_response_mode,
    // `turn_conditions` 에 이 칸이 없다 — 일부러 안 박제했다(이슈 #27 · `restoreDecision()`).
    // 세 줄 로그가 안 찍는 값이라 `null` 로 둔다. **지금 세션 값으로 메우지 않는다.**
    last_guidance_target: null,
    turns_without_new_element: 조건.turns_without_new_element,
    consecutive_low_information_turns: 조건.consecutive_low_information_turns,
  }
  const 판정 = restoreDecision(조건)
  // 저장된 값이 아니라 여기서 뺀다 (`CLAUDE.md` 경계 5 · FR-012).
  const missing = (required_elements ?? []).filter(
    (요소) => !상태.accumulated_elements.includes(요소),
  )

  let 분석_줄: string | null = null
  let 버린것: readonly string[] = []
  if (메시지.child_intent !== null && 메시지.child_intent !== '') {
    // `버림` 도 저장하지 않는다 — 순수 함수라 매번 다시 돌린다.
    const { dropped } = postProcess(메시지.detected_elements ?? [], 메시지.text)
    버린것 = dropped
    분석_줄 = analysisLine(
      {
        child_intent: 메시지.child_intent,
        main_point: 메시지.main_point,
        detected_elements: 메시지.detected_elements ?? [],
        utterance_validity: 메시지.utterance_validity ?? '',
      },
      { 버린: dropped },
    )
  }

  return {
    분석: 분석_줄,
    상태: stateLine(상태, { missing }),
    판정: decisionLine(판정),
    accumulated_elements: 상태.accumulated_elements,
    missing_elements: missing,
    dropped: 버린것,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 회차 목록 · 이야기 목록
// ═══════════════════════════════════════════════════════════════════════════

// 화면은 `lib/repo` 를 직접 못 부른다 (eslint 층 경계). 자동 채점의 형도 여기서 다시 내보낸다.
export type { AutoScoreSummary, ScoreRow }

/** 회차 목록 한 줄. 회차 행에 세션 상태 · 이야기 · 아이 턴 수를 붙인 것. */
export interface RunListItem extends RunWithStory {
  /** 아이가 말한 횟수. 파이썬 목록 화면의 `turn_count` 다. */
  turn_count: number
  /** 실험 메모가 붙은 회차인가 (파이썬 `experimental`). */
  experimental: boolean
  /**
   * 경계 채점기(`lib/judge.ts`)가 이 회차에 남긴 것의 집계. 파이썬 목록의 `score` 자리다.
   *
   * 🔴 **`scored_at` 이 `null` 이면 아예 안 부른다** (파이썬 `routes/runs.py:229`). 안 돈
   * 회차와 「돌았는데 잰 것이 없는」 회차는 다른 사실이고, 둘 다 0 건으로 보이면 못 가른다.
   */
  score: AutoScoreSummary | null
}

/** 회차 목록 (최근 것이 위). */
export async function listRunsView(conn?: Conn): Promise<RunListItem[]> {
  const 연결 = conn ?? getDb()
  const 회차들 = await listRunsWithStory(연결)
  const 목록: RunListItem[] = []
  for (const 회차 of 회차들) {
    const 줄들 = await sessionTranscript(연결, 회차.session_id)
    목록.push({
      ...회차,
      turn_count: 줄들.filter((행) => 행.speaker_type === 'child').length,
      experimental: Boolean(회차.experiment_note),
      score:
        회차.scored_at === null ? null : await autoScoreSummary(연결, { run_id: 회차.id }),
    })
  }
  return 목록
}

/** 회차 시작 화면이 고르게 할 이야기 목록. */
export async function listStoriesView(conn?: Conn): Promise<StoryRow[]> {
  return listStories(conn ?? getDb())
}

/**
 * 그 이야기의 장면 전부 (`scene_order` 순 · 전개 장면도 함께다).
 *
 * 회차를 **만들기 전에** 「고른 장면이 이야기에 없다」를 막는 자리다 — 그 검사가 없으면
 * `runs`·`story_sessions` 행이 먼저 생기고 나서 막혀 유령 회차가 남는다.
 *
 * ⛔ **여기에 규칙이 없다.** `repo/content.scenesOfStory()` 를 화면이 닿는 층으로 한 겹
 *    올릴 뿐이다 (`app/` 은 `lib/repo` 를 직접 import 하지 않는다 — eslint 층경계).
 *
 * 이야기가 아예 없거나 장면이 하나도 없으면 **빈 배열**이다. 둘을 여기서 가르지 않는다 —
 * 파이썬도 `db.장면들()` 이 빈 목록을 주면 그때 404 를 냈다 (`routes/runs.py` 의 `if not 장면들`).
 */
export async function listScenesView(story_code: string, conn?: Conn): Promise<SceneRow[]> {
  return scenesOfStory(conn ?? getDb(), story_code)
}

// ═══════════════════════════════════════════════════════════════════════════
// 끝나지 않은 턴 — ②③ 을 이어 부를 재료
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 진행 화면이 ②③ 에 **그대로 실어 보낼** 값들.
 *
 * 🔴 계약이 ①②③ 으로 갈린 것은 「관리자 화면이 단계별로 들여다보고 따로 다시
 * 돌려야 하니까」다 (`CLAUDE.md`). 그래서 ① 의 답을 화면이 손에 쥐고 ② 로 넘기고,
 * ② 의 답을 손에 쥐고 ③ 으로 넘긴다 — 그 「메아리」의 재료가 이것이다.
 *
 * ⛔ 화면이 판정을 다시 계산하지 않는다. `decision` 은 **박제된 값**이다 (FR-016).
 */
export interface PendingDraft {
  message_id: string
  /** 어디서 죽었나 — `analysis` · `decision` · `character`. */
  stage: PendingStage
  turn_order: number
  child_utterance: string
  /** ① 이 낸 것. 분석 행이 없으면 `null` 이다 (`stage === 'analysis'`). */
  analysis: {
    child_intent: string
    main_point: string | null
    utterance_validity: string
    detected_elements: readonly { type: string; evidence: string | null }[]
    /** ⚠️ ② 에 넣는 것은 **이쪽**이다. 후처리 전 원본이 아니다 (계약 4절). */
    detected_elements_kept: readonly string[]
    dropped: readonly string[]
  } | null
  /** ② 가 낸 것. 판정이 아직이면 `null` 이다. */
  decision: Decision | null
}

/** 끝나지 않은 턴 하나를 화면이 이어 돌릴 수 있는 모양으로. 없으면 `null`. */
export async function pendingDraft(
  conn: Conn,
  session_id: string,
): Promise<PendingDraft | null> {
  const 미완 = await pendingTurn(conn, { session_id })
  if (미완 === null) return null

  const 아이 = await readMessage(conn, 미완.message_id)
  if (아이 === null) return null

  const 저장된 = await readSavedAnalysis(conn, 미완.message_id)
  const 조건 = await readTurnCondition(conn, 미완.message_id)

  return {
    message_id: 미완.message_id,
    stage: 미완.stage,
    turn_order: 아이.turn_order,
    child_utterance: 아이.text,
    analysis:
      저장된 === null
        ? null
        : {
            child_intent: 저장된.child_intent,
            main_point: 저장된.main_point,
            utterance_validity: 저장된.utterance_validity,
            detected_elements: 저장된.detected_elements,
            ...postProcessed(저장된.detected_elements, 아이.text),
          },
    decision: 조건 === null ? null : restoreDecision(조건),
  }
}

/** 후처리를 다시 돌린다. 저장하지 않는 값이라 매번 계산한다 (순수 함수다). */
function postProcessed(
  요소들: readonly { type: string; evidence: string | null }[],
  발화: string,
): { detected_elements_kept: readonly string[]; dropped: readonly string[] } {
  const { kept, dropped } = postProcess(요소들, 발화)
  return { detected_elements_kept: kept, dropped }
}

// ═══════════════════════════════════════════════════════════════════════════
// 회차 상세 — 진행 화면과 턴 로그 화면이 함께 쓴다
// ═══════════════════════════════════════════════════════════════════════════

/** 턴 로그 한 줄 — 저장된 메시지에 판정 스냅샷과 로그 세 줄을 붙인 것. */
export interface TurnRow extends TranscriptRow {
  /** 이 턴의 박제된 판정. 아이 메시지가 아니거나 아직 판정 전이면 `null`. */
  turn_condition: TurnConditionRow | null
  log_lines: TurnLogLines | null
  /**
   * ⭐ 이 턴에 캐릭터 대사가 안 붙었으면 `null` 이다.
   *
   * 「뒤에 오는 첫 캐릭터 메시지」로 집으면 실패한 턴이 **다음 턴의 대사**를 제 것으로
   * 착각해 「응답 없음」이 안 뜬다. 그래서 화자를 안 가리고 **바로 다음 한 행**만 보고,
   * 그게 같은 장면의 캐릭터일 때만 이 턴의 대사로 인정한다.
   */
  character_response: string | null
}

export interface RunDetail {
  run: RunRow
  session: SessionWithStory
  scenes: SceneRow[]
  /** 다음에 할 일. **화면이 정하지 않는다** — `nextStep()` 이 정한다 (경계 6). */
  next_action: Step
  messages: TurnRow[]
  current_scene: SceneRow | null
  /** `required_elements − accumulated_elements`. 저장하지 않고 매번 뺀다 (경계 5). */
  current_missing_elements: string[]
  /** 도달한 장면까지만 묶는다. 아직 안 간 장면은 쪽으로 만들지 않는다. */
  scene_pages: ScenePage[]
  /** 지금 도는 중이면 그 표시 문구. 메모리라 서버를 다시 띄우면 비어 있다. */
  progress: string | null
  failure: TurnFailureState | null
  /** `message_id` → 예비 공급자로 답한 시도들. */
  fallback: Map<string, FallbackAttempt[]>
  pending: PendingDraft | null
}

/**
 * 회차 하나를 그리는 데 필요한 것 전부 (파이썬 `_상세_문맥()`).
 *
 * ⛔ **여기서 아무 규칙도 새로 만들지 않는다.** `nextStep()`·`decide()` 가 정한 것과
 *    `turn_conditions` 에 박제된 것을 모아 담을 뿐이다.
 */
export async function runDetail(run_id: string, conn?: Conn): Promise<RunDetail> {
  const 연결 = conn ?? getDb()
  const { run, session, scenes, step } = await runState(연결, run_id)

  const 줄들 = await sessionTranscript(연결, run.session_id)
  const 조건들 = new Map(
    (await readRunTurnConditions(연결, run_id)).map((행) => [행.message_id, 행]),
  )
  const 필수 = new Map(scenes.map((장면) => [장면.scene_id, 장면.required_elements]))

  const messages: TurnRow[] = 줄들.map((행, 자리) => {
    const 조건 = 조건들.get(행.id) ?? null
    // **바로 다음 한 행**만 본다 (위 `character_response` 주석).
    const 다음 = 줄들[자리 + 1]
    const 대사 =
      다음 !== undefined && 다음.speaker_type === 'character' && 다음.scene_id === 행.scene_id
        ? 다음.text
        : null
    return {
      ...행,
      turn_condition: 조건,
      log_lines: turnLogLines(행, 조건, 필수.get(행.scene_id) ?? null),
      character_response: 행.speaker_type === 'child' ? 대사 : null,
    }
  })

  const current_scene = scenes.find((장면) => 장면.scene_id === session.current_scene_id) ?? null
  const current_missing_elements = (current_scene?.required_elements ?? []).filter(
    (요소) => !session.accumulated_elements.includes(요소),
  )

  // 아직 안 간 장면은 아예 쪽으로 만들지 않는다. 있지도 않은 대화를 빈 쪽으로 보여 주면
  // 「여기까지 왔다」를 잘못 읽게 된다.
  const 도달한_장면 =
    run.scope === 'scene'
      ? scenes.filter((장면) => 장면.scene_order === run.scene_order)
      : scenes.filter((장면) => 장면.scene_order <= (current_scene?.scene_order ?? 0))

  return {
    run,
    session,
    scenes,
    next_action: step,
    messages,
    current_scene,
    current_missing_elements,
    scene_pages: scenePages(도달한_장면),
    progress: inProgress.read(run_id),
    // 실패는 메모리가 아니라 기록에서 되살린다 — 새로고침해도 같다 (FR-040).
    failure: await turnFailureState(연결, { run_id, session_id: run.session_id }),
    fallback: fallbackTurns(run, await readAttempts(연결, { run_id })),
    pending: await pendingDraft(연결, run.session_id),
  }
}

/**
 * 회차 하나가 가리키는 세션과 이야기. 시작 직후처럼 상세가 필요 없을 때 쓴다.
 *
 * ⚠️ `runDetail()` 과 갈린 이유는 값이 아니라 **비용**이다 — 상세는 회차의 모든 메시지와
 *    시도를 읽는다.
 */
export async function runHeader(
  run_id: string,
  conn?: Conn,
): Promise<{ run: RunRow; session: SessionWithStory; scenes: SceneRow[]; next_action: Step }> {
  const 연결 = conn ?? getDb()
  const run = await readRun(연결, run_id)
  const session = await readSessionWithStory(연결, run.session_id)
  const scenes = await scenesOfStory(연결, session.story_code)
  return {
    run,
    session,
    scenes,
    next_action: nextStep(scenes, session, { scope: run.scope, scene_order: run.scene_order }),
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 한 턴의 LLM 시도 — 파이썬 `routes/runs.py:시도_보기()` (이슈 #26 E-3 · C-2/C-3/C-4)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 시도 한 행 + 화면이 쓰는 세 칸.
 *
 * ⭐ **`llm_calls` 행을 통째로 그대로 싣는다.** `system_text`·`user_text`·`response_text` 가
 *    거기 있고, 그것이 「프롬프트 원문 보기」(C-3)가 필요로 하는 전부다. 파이썬은 원문을
 *    조각 라우트로 따로 받아 갔지만(htmx `hx-get`), 서버 렌더링이면 한 번에 실어 보내면 된다.
 */
export interface AttemptView extends LlmCallRow {
  /**
   * 회차가 **고르려 했던** 모델 (`runs.analysis_model` · `runs.character_model`).
   * 회차에 안 박혀 있으면 `null` 이다 — 설정 기본값으로 돌았다는 뜻이다.
   */
  selected_model: string | null
  /**
   * ⭐ 고른 모델과 **실제로 응답한** 모델이 다른가. 화면이 이걸 굵게 그린다 —
   * fallback 이 돌았는지 **눈으로 봐야 한다**는 `CLAUDE.md` 「로그」 절이 이 자리다.
   *
   * ⚠️ **파이썬과 한 자리가 갈린다** — 고른 모델이 `null` 이면 `false` 다.
   *    파이썬은 `시도["model"] != None` 이 늘 참이라 **모든 시도가 「다름」으로 잡혔다.**
   *    견줄 대상이 없으면 「다르다」고 말할 수 없다. `fallbackTurns()` 가 같은 이유로
   *    같은 자리에서 갈렸고, 두 곳의 잣대를 맞춘 것이다.
   */
  model_differs: boolean
  /** 이 시도의 비용. **모르면 `null` 이고 0 이 아니다.** */
  cost: number | null
}

/** 한 턴의 시도 전부와 그 합계. */
export interface TurnAttemptsView {
  run: RunRow
  message_id: string
  attempts: AttemptView[]
  /**
   * 이 턴의 대사에 경계 채점기가 매긴 것 (`graded_by='auto'` · 같은 칸의 **최신 한 행**).
   *
   * 🔴 `scores.message_id` 는 **아이 발화 id** 다 (`repo/review.ts` 머리말 ·
   * `service/turn.ts` 의 저장 자리). 이 화면이 쥔 `message_id` 도 아이 발화라 그대로 맞는다 —
   * 캐릭터 행의 id 로는 `llm_calls` 도 `scores` 도 안 걸린다 (`runs/ui.tsx` 의 `시도링크`).
   *
   * ⛔ 사람이 매긴 판정은 **여기 안 섞는다.** 검수 화면(`/review`)이 `graded_by <> 'auto'`
   *    로 자동 채점을 빼는 것과 같은 선이고, 방향만 반대다.
   */
  auto_scores: ScoreRow[]
  totals: {
    attempt_count: number
    duration_ms: number
    /** 모르는 토큰이 하나라도 섞이면 합계도 `null` 이다 (`attemptTotals()`). */
    input_tokens: number | null
    output_tokens: number | null
    /** 한 줄이라도 「모름」이면 합계도 「모름」이다 — 0 으로 메우면 예산 판단이 틀어진다. */
    cost: number | null
    /** 단가표의 `통화` 칸. 표가 비어 있으면 `null`. */
    통화: string | null
  }
}

/**
 * 한 턴이 부른 LLM 시도들 (파이썬 `시도_보기()`).
 *
 * ⭐ 자동 채점(`auto_scores`)도 함께 싣는다 — 파이썬에 없던 자리다. 채점기는 돌지만 그 결과를
 *    볼 화면이 하나도 없어서 DB 를 직접 봐야 했다. 왕복을 하나 더 두지 않은 것은 사람이 이
 *    턴을 열어 보는 이유가 「이 턴이 무엇을 했나」 하나이기 때문이다.
 *
 * ⛔ **여기서 아무것도 판정하지 않는다.** `llm_calls` 에 남은 사실에 단가표를 곱할 뿐이다.
 *    채점도 다시 돌리지 않는다 — 저장된 행을 읽을 뿐이다.
 * ⚠️ 화면은 `lib/repo` 를 직접 못 부른다 (eslint 층 경계). 그 얇은 자리가 여기다.
 */
export async function turnAttempts(
  run_id: string,
  message_id: string,
  conn?: Conn,
): Promise<TurnAttemptsView> {
  const 연결 = conn ?? getDb()
  const run = await readRun(연결, run_id)
  const 시도들 = await readAttempts(연결, { run_id, message_id })
  const 합계 = await attemptTotals(연결, { run_id, message_id })

  // 표를 **한 번만** 읽어 모든 줄에 넘긴다 (`비용_계산()` 머리말).
  const 표 = 단가표_읽기()

  let 비용_합계 = 0
  let 비용_모름 = false
  const attempts: AttemptView[] = 시도들.map((시도) => {
    const 고른 = 고른_모델(run, 시도.purpose)
    const cost = 비용_계산(시도.model, 시도.input_tokens, 시도.output_tokens, 시도.created_at, 표)
    if (cost === null) 비용_모름 = true
    else 비용_합계 += cost
    return {
      ...시도,
      selected_model: 고른,
      model_differs: 고른 !== null && 고른 !== '' && 시도.model !== 고른,
      cost,
    }
  })

  return {
    run,
    message_id,
    attempts,
    auto_scores: await currentAutoScores(연결, { run_id, message_id }),
    totals: {
      ...합계,
      cost: 비용_모름 ? null : 비용_합계,
      통화: 표.통화,
    },
  }
}
