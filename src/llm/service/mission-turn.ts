// 미션의 llm 쪽 문 ② — 팝업 안에서 도는 것 (이슈 #19 · `docs/미션_명세.md` 7절 B·C·D).
//
// `mission.ts` 가 **일반 턴에 끼는 것**(트리거·다리 대사·세션 열기)이라면, 여기는 팝업이
// 열린 뒤의 셋이다. 갈라 둔 이유는 방향이다 — 저쪽은 `run.ts` 가 부르고, 여기는 `run.ts` 의
// 잠금(`inProgress`)과 설정(`runSettings`)을 불러다 쓴다. 한 파일에 두면 순환한다.
//
// ## 🔴 미션 턴은 「모아서 한 번에 커밋」이다 (명세 7절 C)
//
// 일반 턴은 아이 발화 행을 **먼저** 넣고 커밋한다 — `utterance_analyses.message_id` 가
// NOT NULL FK 라 순서를 바꿀 수 없고, 이어 돌리기(resume)가 그 행에 붙기 때문이다.
// 미션 턴에는 이어 돌리기가 없다(M4). 그래서 거꾸로다: **LLM 둘이 다 끝난 뒤에** 행을
// 넣는다. 502 면 `mission_messages` 도 `story_sessions` 도 한 글자 안 변하고, 아이는
// 그냥 다시 말하면 된다.
//
// ⚠️ `llm_calls` 만 예외다 — 실패도 남긴다(결정 33). 그래서 트랜잭션 **밖**이다.
//    `message_id` 는 `null` 이다: 미션 발화는 `messages` 행이 아니라 FK 를 걸 데가 없다.
//
// ## 씬 상태는 **누적 요소 한 칸만** 건드린다 (M3)
//
// 씬 턴 수도 유도 카운터 넷도 미션 턴에서는 불변이다. 그 규칙은 두 자리가 함께 지킨다 —
// `domain/mission.decideMissionTurn()` 의 답에 그 칸이 아예 없고(저장할 값이 없다),
// `repo/sessions.accumulateElements()` 가 한 칸만 쓴다(쓸 자리가 없다).

import type { Settings } from '@/llm/config'
import { decideMissionTurn } from '@/llm/domain/mission'
import { LookupError, ValueError } from '@/llm/domain/progress'
import { analyze, postProcess, type AnalysisPayload } from '@/llm/engine/analyze'
import { buildAnalysisMaterial } from '@/llm/engine/material'
import { buildMissionSummaryMaterial, missionReplyTurn, missionSummary } from '@/llm/engine/mission'
import { LLMError, type LLMResult } from '@/llm/provider'
import { readScene, scenesOfStory, type SceneRow } from '@/llm/repo/content'
import { getDb, type Conn } from '@/llm/repo/db'
import {
  appendMissionSelection,
  completeMissionSession,
  insertMissionMessage,
  missionMessages,
  setMissionStep,
  type MissionMessageRow,
  type MissionRow,
  type MissionSessionRow,
} from '@/llm/repo/missions'
import { insertAttempts, readRun } from '@/llm/repo/runs'
import {
  accumulateElements,
  insertMessage,
  markSceneGoalMet,
  missionSummaryMessage,
  readSession,
  sceneMessages,
} from '@/llm/repo/sessions'

import {
  missionCard,
  missionConfig,
  missionItem,
  MissionNotActive,
  readMissionAttempt,
  stepAsk,
  stepKeys,
  type MissionConfig,
} from './mission'
import { experimentPrompts } from './prompt-lab'
import { inProgress, runSettings, TurnInProgress, 진행중_문구 } from './run'
import { advanceAfterClosing } from './session-turn'
import { narrationsBefore, storyCodeOfSession } from './story'

/** 세 문이 공통으로 받는 것 — 회차 잠금과 설정이 `run_id` 에 달려 있다. */
interface MissionCallArgs {
  run_id: string
  session_id: string
  mission_session_id: string
  conn?: Conn
  base_settings?: Settings
}

/** 무음으로 건너뛴 자리에 남기는 system 행의 글. `text` 가 NOT NULL 이라 빈칸을 못 넣는다. */
const 건너뜀_기록 = '(무음으로 건너뜀)'

// ═══════════════════════════════════════════════════════════════════════════
// 공통 — 시도 한 벌을 열고 잠근다
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 세 문의 입구. **`in_progress` 가 아니면 409** 다 (명세 7절 E).
 *
 * ⚠️ `complete` 는 이 문을 안 쓴다 — 반복 안전이라 `completed` 도 받아야 한다.
 */
async function 도는_시도(
  conn: Conn,
  args: MissionCallArgs,
): Promise<{ attempt: MissionSessionRow; mission: MissionRow }> {
  const 한벌 = await readMissionAttempt({
    session_id: args.session_id,
    mission_session_id: args.mission_session_id,
    conn,
  })
  if (한벌.attempt.status !== 'in_progress') {
    throw new MissionNotActive(
      `이 미션 시도는 도는 중이 아니다 (status=${한벌.attempt.status}): ${args.mission_session_id}`,
    )
  }
  return 한벌
}

/** 미션 API 도 기존 회차 잠금을 **공유한다** (명세 7절 E) — 턴과 미션이 동시에 못 돈다. */
async function 잠그고<T>(run_id: string, 단계: string, 본문: () => Promise<T>): Promise<T> {
  if (!inProgress.start(run_id, 단계)) throw new TurnInProgress(진행중_문구(run_id))
  try {
    return await 본문()
  } finally {
    inProgress.end(run_id)
  }
}

/** 미션이 걸린 장면 한 행과 그 앞의 전개들 (분석 재료가 둘 다 본다). */
async function 미션_장면(
  conn: Conn,
  { session_id, mission }: { session_id: string; mission: MissionRow },
): Promise<{ scene: SceneRow; preceding: { scene_description: string | null }[] }> {
  const scene = await readScene(conn, mission.scene_id)
  const 장면들 = await scenesOfStory(conn, await storyCodeOfSession(conn, session_id))
  return { scene, preceding: [...narrationsBefore(장면들, scene)] }
}

/** 아이가 고른 소품의 **화면 이름** (prop_choice). 아직 안 골랐으면 `null`. */
function 고른_소품(attempt: MissionSessionRow, mission: MissionRow): string | null {
  const 고름 = [...attempt.selections].reverse().find((하나) => 하나.kind === 'prop_select')
  return 고름 === undefined ? null : missionItem(mission, 고름.value).name
}

/** 이미 도운 친구 id 들 (card_help). 선택 기록이 정본이다 — 프론트의 `helped` 와 같은 값. */
function 도운_친구들(attempt: MissionSessionRow): string[] {
  const 모음: string[] = []
  for (const 하나 of attempt.selections) {
    if (하나.kind === 'friend_select' && !모음.includes(하나.value)) 모음.push(하나.value)
  }
  return 모음
}

/** 미션 대화 한 줄을 LLM 재료 모양으로 (`engine/mission` 의 `PastMessage`). */
function 재료용_말(rows: readonly MissionMessageRow[]): { speaker_type: string; text: string }[] {
  return rows.map((행) => ({ speaker_type: 행.speaker_type, text: 행.text }))
}

/** 실패한 시도도 기록에 남긴다 (결정 33). 미션 발화에는 `messages` 행이 없어 `message_id` 는 null 이다. */
async function 남긴다(
  conn: Conn,
  { run_id, attempts }: { run_id: string; attempts: LLMResult['attempts'] },
): Promise<void> {
  if (attempts.length === 0) return
  await conn.transaction(async (tx) => {
    await insertAttempts(tx, { run_id, message_id: null, attempts })
  })
}

// ═══════════════════════════════════════════════════════════════════════════
// B. 선택 이벤트 — 말이 아닌 입력 (명세 7절 B)
// ═══════════════════════════════════════════════════════════════════════════

/** 앱이 보내는 네 갈래. `value` 는 소품·친구 id 또는 `'yes'`/`'no'` 다. */
export type MissionEventType = 'prop_select' | 'friend_select' | 'more' | 'skip'

/** 명세 7절 B 의 응답 — `done` 이면 앱은 `complete` 를 부른다. */
export interface MissionEventData {
  /** 그 스텝의 고정 대사. `done` 이면 `null`. */
  line: { text: string; source: 'fixed' } | null
  step: string | null
  /** 이제 아이 말을 받을 차례인가 — 계속/그만 물음에는 `false` 다. */
  mic: boolean
  done: boolean
}

export interface MissionEventArgs extends MissionCallArgs {
  type: MissionEventType
  value?: string | null
}

const 끝났다: MissionEventData = { line: null, step: null, mic: false, done: true }

/**
 * 선택·건너뜀을 기록하고 그 스텝의 고정 대사를 돌려준다 (명세 7절 B).
 *
 * 고정 대사도 **`mission_messages` 캐릭터 행(fixed)으로 남긴다** — 그래야 아이대답요약과
 * 종료 요약의 재료(`mission_said_so_far`)에 「캐릭터가 무엇을 물었는지」가 들어간다.
 * 남기지 않으면 LLM 은 아이 말만 보고 대답하게 된다.
 */
export async function missionEvent(args: MissionEventArgs): Promise<MissionEventData> {
  const conn = args.conn ?? getDb()
  const { attempt, mission } = await 도는_시도(conn, args)

  return 잠그고(args.run_id, '미션 선택', async () => {
    const 설정 = missionConfig(mission)
    const 값 = args.value ?? null

    /** 고정 대사 한 줄을 남기고 응답으로 싣는다. */
    const 고정 = async (text: string, step: string | null, mic: boolean): Promise<MissionEventData> => {
      await insertMissionMessage(conn, {
        mission_session_id: attempt.id,
        speaker_type: 'character',
        step,
        text,
        line_source: 'fixed',
      })
      await setMissionStep(conn, { mission_session_id: attempt.id, step })
      return { line: { text, source: 'fixed' }, step, mic, done: false }
    }

    if (mission.mission_type === 'prop_choice') {
      if (args.type === 'prop_select') {
        const 소품 = missionItem(mission, 있어야_한다(값, 'value'))
        const 첫_스텝 = stepKeys(mission)[0]
        await appendMissionSelection(conn, {
          mission_session_id: attempt.id,
          selection: { step: 첫_스텝, kind: 'prop_select', value: 소품.id },
        })
        return 고정(stepAsk(mission, 첫_스텝, 소품.name), 첫_스텝, true)
      }
      if (args.type === 'skip') {
        // 현행 「다음으로」의 승계 — 무음 재시도가 소진됐다. 이 스텝은 말 없이 지나간다.
        // ⚠️ 소품을 아직 안 골랐으면 건너뛸 스텝도 없다 — 물음의 `{item}` 을 채울 이름이 없어
        //    빈 자리가 그대로 아이에게 읽힌다. 그 앞에서 막는다.
        const 지금 = 있어야_한다(attempt.current_step, '미션 스텝 (소품을 먼저 골라라)')
        await insertMissionMessage(conn, {
          mission_session_id: attempt.id,
          speaker_type: 'system',
          step: 지금,
          text: 건너뜀_기록,
        })
        await appendMissionSelection(conn, {
          mission_session_id: attempt.id,
          selection: { step: 지금, kind: 'skip', value: '' },
        })
        const 다음 = 다음_스텝(mission, 지금)
        if (다음 === null) {
          await setMissionStep(conn, { mission_session_id: attempt.id, step: null })
          return 끝났다
        }
        return 고정(stepAsk(mission, 다음, 고른_소품(attempt, mission)), 다음, true)
      }
      throw new ValueError(`${mission.mission_type} 에 없는 이벤트다: ${args.type}`)
    }

    // card_help — 카드 하나를 고르고 말하고, 「더 도울래?」로 순환한다 (명세 8절 미션2).
    const 카드수 = 설정.cards?.length ?? 0
    if (args.type === 'friend_select') {
      const 카드 = missionCard(mission, 있어야_한다(값, 'value'))
      await appendMissionSelection(conn, {
        mission_session_id: attempt.id,
        selection: { step: 카드.id, kind: 'friend_select', value: 카드.id },
      })
      // 공용 질문 하나다 — 친구별 질문 문구는 config 에 없다 (명세 6절 config 예시).
      return 고정(있어야_한다(설정.ask, 'config.ask'), 카드.id, true)
    }
    if (args.type === 'skip') {
      const 지금 = attempt.current_step
      await insertMissionMessage(conn, {
        mission_session_id: attempt.id,
        speaker_type: 'system',
        step: 지금,
        text: 건너뜀_기록,
      })
      await appendMissionSelection(conn, {
        mission_session_id: attempt.id,
        selection: { step: 지금 ?? '', kind: 'skip', value: '' },
      })
      if (도운_친구들(attempt).length >= 카드수) {
        await setMissionStep(conn, { mission_session_id: attempt.id, step: null })
        return 끝났다
      }
      return 고정(있어야_한다(설정.more, 'config.more'), null, false)
    }
    if (args.type === 'more') {
      await appendMissionSelection(conn, {
        mission_session_id: attempt.id,
        selection: { step: '', kind: 'more', value: 값 ?? '' },
      })
      if (값 !== 'yes' || 도운_친구들(attempt).length >= 카드수) {
        await setMissionStep(conn, { mission_session_id: attempt.id, step: null })
        return 끝났다
      }
      return 고정(있어야_한다(설정.more_pick, 'config.more_pick'), null, false)
    }
    throw new ValueError(`${mission.mission_type} 에 없는 이벤트다: ${args.type}`)
  })
}

/** prop_choice 의 다음 스텝 key. 지금이 마지막이거나 아직 안 정해졌으면 `null`. */
function 다음_스텝(mission: MissionRow, 지금: string | null): string | null {
  const 키들 = stepKeys(mission)
  if (지금 === null) return 키들[0] ?? null
  const 자리 = 키들.indexOf(지금)
  if (자리 === -1) throw new ValueError(`스텝이 step_keys 에 없다: ${지금}`)
  return 자리 + 1 < 키들.length ? 키들[자리 + 1] : null
}

function 있어야_한다<T>(값: T | null | undefined, 이름: string): T {
  if (값 === null || 값 === undefined || 값 === '') {
    throw new ValueError(`${이름} 이(가) 없다`)
  }
  return 값
}

// ═══════════════════════════════════════════════════════════════════════════
// C. 미션 턴 — 분석 → 판정 → 아이대답요약 (명세 7절 C · 4절 파이프라인)
// ═══════════════════════════════════════════════════════════════════════════

/** 미션 턴 뒤 앱이 할 일. `미션끝` 이면 앱은 `config.closing` 을 재생하며 `complete` 를 부른다. */
export interface MissionNext {
  kind: '미션계속' | '미션끝'
  /** 다음(되묻기면 **같은**) 스텝. card_help 는 「더 도울래?」 차례라 `null` 이다. */
  step: string | null
  /** 그 스텝의 고정 대사 — 되묻기 문구·다음 물음·「더 도울래?」. `미션끝` 이면 `null`. */
  fixed_line: { text: string } | null
}

export interface MissionTurnSpoken {
  empty?: undefined
  child: { text: string }
  /** 아이대답요약. **되묻기면 `null`** — LLM 을 아예 안 불렀다는 뜻이다 (M9). */
  dialogue: { text: string; source: 'generated' } | null
  elements: { gained: string[]; missing: string[] }
  next: MissionNext
}

/** 무음 — 서버 상태 불변 (일반 턴과 같은 규칙). */
export interface MissionTurnEmpty {
  empty: true
}

export type MissionTurnData = MissionTurnSpoken | MissionTurnEmpty

export interface MissionTurnArgs extends MissionCallArgs {
  /** STT 가 받아쓴 아이 발화. 빈/공백이면 아무것도 저장하지 않는다. */
  utterance: string
}

/**
 * 미션 안 아이 발화 하나를 끝까지 돌린다 (명세 4절 표의 미션 열).
 *
 * ① 받아쓰기는 컨트롤러가 끝냈다 → ② 분석은 **기존 `analyze()` 그대로**(M2) →
 * ③ `decideMissionTurn()` → ④ `missionReplyTurn()`. 되묻기 갈림은 ④ 안에 있다 —
 * 여기서 한 번 더 보면 가르는 자리가 둘이 된다 (`engine/mission.ts` 머리말).
 */
export async function missionTurn(args: MissionTurnArgs): Promise<MissionTurnData> {
  const conn = args.conn ?? getDb()
  const { attempt, mission } = await 도는_시도(conn, args)
  if (args.utterance.trim() === '') return { empty: true }

  return 잠그고(args.run_id, '미션 턴', async () => {
    const 설정 = missionConfig(mission)
    const step = 있어야_한다(attempt.current_step, '미션 스텝 (선택 이벤트를 먼저 보내라)')
    const { scene, preceding } = await 미션_장면(conn, { session_id: args.session_id, mission })
    const 지난_말 = await missionMessages(conn, attempt.id)
    const 세션 = await readSession(conn, args.session_id)
    const 실험 = await experimentPrompts(args.run_id, conn)
    const 설정_두벌 = runSettings(await readRun(conn, args.run_id), args.base_settings)

    // ② 분석 — 프롬프트·기준·후처리 전부 기존 것이다 (M2). 재료의 「직전 캐릭터 말」은
    //    본 대화가 아니라 **팝업 안의 마지막 캐릭터 줄**이다 — 아이가 대답하는 상대가 그것이다.
    const 재료 = buildAnalysisMaterial({
      scene,
      precedingNarrations: preceding,
      child_utterance: args.utterance,
      previous_character_message:
        [...지난_말].reverse().find((행) => 행.speaker_type === 'character')?.text ?? null,
    })
    let 분석: AnalysisPayload
    let 분석_응답: LLMResult
    try {
      const 결과 = await analyze(재료, { prompt: 실험.analysis, settings: 설정_두벌.analysis })
      분석 = 결과.analysis
      분석_응답 = 결과.llm
    } catch (오류) {
      if (오류 instanceof LLMError) await 남긴다(conn, { run_id: args.run_id, attempts: 오류.attempts })
      throw 오류
    }
    const { kept } = postProcess(분석.detected_elements, args.utterance)

    // ③ 판정 — 순수 함수. 씬 턴 수·유도 카운터 칸이 답에 아예 없다 (M3).
    const 판정 = decideMissionTurn(
      {
        step,
        reask_used: 되물었나(지난_말, { mission, step, 설정 }),
        accumulated_elements: 세션.accumulated_elements,
      },
      { mission_type: mission.mission_type, step_keys: stepKeys(mission) },
      { required_elements: scene.required_elements ?? [] },
      { detected_elements: kept, utterance_validity: 분석.utterance_validity },
    )

    // ④ 대사 — 되묻기면 부르지 않는다(M9). 그 갈림은 `missionReplyTurn()` 안에 있다.
    let 대사
    try {
      대사 = await missionReplyTurn({
        scene,
        mission: {
          mission_goal: mission.mission_goal,
          step,
          question: 이_스텝의_물음(지난_말, step),
          selection: 고른_것(attempt, mission, step),
        },
        missionMessages: 재료용_말(지난_말),
        child_utterance: args.utterance,
        main_point: 분석.main_point,
        direction_kind: 'summary_reply',
        reask: 판정.reask,
        settings: 설정_두벌.character,
      })
    } catch (오류) {
      if (오류 instanceof LLMError) {
        // 분석 시도도 함께 남긴다 — 여기까지 오면 그 호출은 성공했지만, 기록은 시도 단위다.
        await 남긴다(conn, { run_id: args.run_id, attempts: [...분석_응답.attempts, ...오류.attempts] })
      }
      throw 오류
    }

    const next = 다음_할_일({ mission, 설정, attempt, step, 판정 })

    // ⑤ 모아서 한 번에. 여기까지 왔으면 LLM 이 둘 다 끝났다 (머리말).
    await conn.transaction(async (tx) => {
      await insertMissionMessage(tx, {
        mission_session_id: attempt.id,
        speaker_type: 'child',
        step,
        text: args.utterance,
        stt_raw_text: args.utterance,
        // **후처리 전 원본**이다 — `insertAnalysis()` 와 같은 규칙 (결정 26).
        // `utterance_analyses` 로 가지 않고 행 안 jsonb 사본으로 남는다 (명세 4절 표).
        analysis: {
          child_intent: 분석.child_intent,
          main_point: 분석.main_point,
          detected_elements: 분석.detected_elements.map((하나) => ({
            type: 하나.type,
            evidence: 하나.evidence,
          })),
          utterance_validity: 분석.utterance_validity,
        },
      })
      if (대사.line !== null) {
        await insertMissionMessage(tx, {
          mission_session_id: attempt.id,
          speaker_type: 'character',
          step,
          text: 대사.line,
          line_source: 'generated',
        })
      }
      if (next.fixed_line !== null) {
        await insertMissionMessage(tx, {
          mission_session_id: attempt.id,
          speaker_type: 'character',
          step: next.step,
          text: next.fixed_line.text,
          line_source: 'fixed',
        })
      }
      await setMissionStep(tx, { mission_session_id: attempt.id, step: next.step })
      // 🔴 씬 상태는 이 한 칸뿐이다 (M3).
      await accumulateElements(tx, {
        session_id: args.session_id,
        accumulated: 판정.accumulated_elements,
      })
    })

    await 남긴다(conn, {
      run_id: args.run_id,
      attempts: [...분석_응답.attempts, ...(대사.llm?.attempts ?? [])],
    })

    return {
      child: { text: args.utterance },
      dialogue: 대사.line === null ? null : { text: 대사.line, source: 'generated' as const },
      elements: { gained: [...판정.gained_elements], missing: [...판정.missing_elements] },
      next,
    }
  })
}

/**
 * 이 스텝에서 **이미 되물었는가** (M9 — 스텝당 1회).
 *
 * 되묻기 문구가 그 스텝의 고정 행으로 남아 있는지로 본다. 「아이 행이 둘째인가」로 세지
 * 않는 이유는 card_help 다 — 같은 친구를 다시 고르면 옛 행이 남아 있어 첫 시도가
 * 되묻기를 못 받는다. 문구로 보면 그 함정이 없다.
 */
function 되물었나(
  rows: readonly MissionMessageRow[],
  { mission, step, 설정 }: { mission: MissionRow; step: string; 설정: MissionConfig },
): boolean {
  const 문구 = 되묻기_문구(mission, 설정, step)
  if (문구 === null) return false
  return rows.some((행) => 행.step === step && 행.line_source === 'fixed' && 행.text === 문구)
}

/** 되묻기 문구 — prop_choice 는 공통 하나(`config.reask`), card_help 는 친구별이다 (M9). */
function 되묻기_문구(mission: MissionRow, 설정: MissionConfig, step: string): string | null {
  if (mission.mission_type === 'prop_choice') return 설정.reask ?? null
  return 설정.cards?.find((카드) => 카드.id === step)?.reask ?? null
}

/** 그 스텝에서 캐릭터가 던진 고정 물음 — LLM 재료의 `mission.question` 이다. */
function 이_스텝의_물음(rows: readonly MissionMessageRow[], step: string): string | null {
  const 행 = [...rows]
    .reverse()
    .find((하나) => 하나.step === step && 하나.line_source === 'fixed')
  return 행?.text ?? null
}

/** 아이가 고른 것의 화면 이름 — 소품(prop_choice) 또는 친구 카드(card_help). */
function 고른_것(attempt: MissionSessionRow, mission: MissionRow, step: string): string | null {
  if (mission.mission_type === 'prop_choice') return 고른_소품(attempt, mission)
  return missionConfig(mission).cards?.find((카드) => 카드.id === step)?.name ?? null
}

/**
 * 미션 턴 뒤에 앱이 할 일 (명세 7절 C).
 *
 * | 갈래 | `next` |
 * |---|---|
 * | 되묻기 | `미션계속` · 같은 스텝 · 되묻기 문구 |
 * | prop_choice 다음 스텝 | `미션계속` · 그 스텝 · 그 스텝의 물음 |
 * | prop_choice 마지막 스텝을 마쳤다 | `미션끝` — 앱이 `config.closing` 을 재생한다 |
 * | card_help, 도울 친구가 남았다 | `미션계속` · 스텝 없음 · 「더 도울래?」 |
 * | card_help, 네 명 다 도왔다 | `미션끝` |
 *
 * ⛔ `미션끝` 에 `fixed_line` 을 싣지 않는다 — 마무리 문구의 정본은 `config.closing` 이고,
 *    앱은 그것을 재생한다(`minigame/mission1.tsx`). 두 자리에서 주면 두 번 들린다.
 */
function 다음_할_일({
  mission,
  설정,
  attempt,
  step,
  판정,
}: {
  mission: MissionRow
  설정: MissionConfig
  attempt: MissionSessionRow
  step: string
  판정: ReturnType<typeof decideMissionTurn>
}): MissionNext {
  const 끝 = { kind: '미션끝' as const, step: null, fixed_line: null }

  if (판정.reask) {
    // 되묻기면 스텝이 그대로다 (`decideMissionTurn()` 이 `next_step` 에 지금 스텝을 담는다).
    const 문구 = 되묻기_문구(mission, 설정, step)
    return {
      kind: '미션계속',
      step: 판정.next_step,
      fixed_line: 문구 === null ? null : { text: 문구 },
    }
  }
  if (mission.mission_type === 'prop_choice') {
    if (판정.steps_done || 판정.next_step === null) return 끝
    return {
      kind: '미션계속',
      step: 판정.next_step,
      fixed_line: { text: stepAsk(mission, 판정.next_step, 고른_소품(attempt, mission)) },
    }
  }
  // card_help — 이번 카드의 발화가 끝났다. 고른 순간 `selections` 에 적혔으므로 이 친구도
  // 이미 세어져 있다. 남은 카드가 없으면 「더 도울래?」를 묻지 않고 바로 끝낸다
  // (명세 7절 B 의 「4명 모두 도움」과 같은 자리다).
  if (도운_친구들(attempt).length >= (설정.cards?.length ?? 0)) return 끝
  return { kind: '미션계속', step: null, fixed_line: { text: 설정.more ?? '' } }
}

// ═══════════════════════════════════════════════════════════════════════════
// D. 종료 요약 — 미션이 씬을 닫을 수도 있다 (명세 7절 D)
// ═══════════════════════════════════════════════════════════════════════════

/** 명세 7절 D 의 응답. `next` 에 `scene_id` 가 없는 것이 턴 API 와 갈리는 자리다. */
export interface MissionCompleteData {
  summary: { message_id: string; text: string }
  /** 씬이 닫혔을 때만 — 앱이 재생하고 답변 컷을 건너뛴다 (M6). */
  closing_line: { text: string } | null
  elements: { accumulated: string[]; missing: string[] }
  next: { kind: '발화받기' | '장면끝' | '회차끝'; next_scene?: { scene_id: string; code: string } }
}

/**
 * 미션을 마치고 요약 한 줄을 본 대화에 남긴다 (명세 7절 D).
 *
 * **반복 안전**하다 — 이미 완료면 저장된 요약을 그대로 다시 낸다. 두 번째 호출은
 * 아무것도 쓰지 않고, `next` 도 그때의 답과 같아진다(요소 산식이 그대로라서다).
 *
 * ## 닫힘은 산식만 본다
 *
 * `missing = required_elements − accumulated_elements` 뿐이다. ⛔ `decide()` 를 다시
 * 부르지 않고 `turn_conditions` 도 박제하지 않는다 — 완료 시점에는 **이번 발화가 없어**
 * `decide()` 의 입력이 성립하지 않고, 턴이 아닌 것을 턴으로 적으면 회차 로그가 거짓이 된다.
 */
export async function missionComplete(args: MissionCallArgs): Promise<MissionCompleteData> {
  const conn = args.conn ?? getDb()
  const { attempt, mission } = await readMissionAttempt({
    session_id: args.session_id,
    mission_session_id: args.mission_session_id,
    conn,
  })
  if (attempt.status === 'abandoned') {
    throw new MissionNotActive(`버려진 미션 시도다: ${args.mission_session_id}`)
  }

  return 잠그고(args.run_id, '미션 마무리', async () => {
    const scene = await readScene(conn, mission.scene_id)
    const 세션 = await readSession(conn, args.session_id)
    const accumulated = [...세션.accumulated_elements]
    // 저장하지 않고 매번 계산한다 (`CLAUDE.md` 경계 5 · `required_elements` 순서를 살린다).
    const missing = (scene.required_elements ?? []).filter((요소) => !accumulated.includes(요소))

    if (attempt.status === 'completed') {
      return 되풀이_응답(conn, { args, attempt, scene, accumulated, missing })
    }

    const 지난_말 = await missionMessages(conn, attempt.id)
    const 설정_두벌 = runSettings(await readRun(conn, args.run_id), args.base_settings)

    // 남은 요소의 걱정 한 줄 — 요약이 그 걱정을 묻는 질문으로 끝난다 (명세 9절 `guidance`).
    const 걱정 = missing.length === 0 ? null : (scene.remaining_worries[missing[0]] ?? null)

    let 요약
    try {
      요약 = await missionSummary(
        buildMissionSummaryMaterial({
          scene,
          mission: { mission_goal: mission.mission_goal },
          selections: attempt.selections.map((하나) => ({
            step: 하나.step,
            kind: 하나.kind,
            value: 하나.value,
          })),
          missionMessages: 재료용_말(지난_말),
          remaining_worry: 걱정,
        }),
        { settings: 설정_두벌.character },
      )
    } catch (오류) {
      if (오류 instanceof LLMError) await 남긴다(conn, { run_id: args.run_id, attempts: 오류.attempts })
      throw 오류
    }

    const 닫는다 = missing.length === 0
    const 저장 = await conn.transaction(async (tx) => {
      await completeMissionSession(tx, {
        mission_session_id: attempt.id,
        summary_text: 요약.line,
      })
      // 미션 대화의 마지막 줄이기도 하다 — 팝업 기록만 보고도 어떻게 끝났는지 읽힌다.
      await insertMissionMessage(tx, {
        mission_session_id: attempt.id,
        speaker_type: 'character',
        step: null,
        text: 요약.line,
        line_source: 'summary',
      })
      // 🔴 본 대화로 넘어가는 것은 **이 한 행뿐이다** (M5). 재개 지점(마지막 캐릭터 행)과
      //    다음 턴의 캐릭터 재료에 자동으로 반영된다.
      const summary_행 = await insertMessage(tx, {
        session_id: args.session_id,
        scene_id: scene.scene_id,
        speaker_type: 'character',
        text: 요약.line,
        utterance_source: 'mission_summary',
      })
      if (닫는다) {
        await markSceneGoalMet(tx, args.session_id)
        // 닫는 말의 정본은 `story_scenes.character_closing` 이다 (명세 6절 「대사 정본 주의」).
        if (scene.character_closing !== null) {
          await insertMessage(tx, {
            session_id: args.session_id,
            scene_id: scene.scene_id,
            speaker_type: 'character',
            text: scene.character_closing,
          })
        }
      }
      return summary_행
    })

    await 남긴다(conn, { run_id: args.run_id, attempts: 요약.llm.attempts })

    // 턴 API 와 **같은 방식으로** 다음 대화 씬까지 전진한다 — 여는 말이 여기서 저장된다.
    const next_scene = 닫는다 ? await advanceAfterClosing({ run_id: args.run_id, conn }) : null

    return {
      summary: { message_id: 저장.id, text: 요약.line },
      closing_line: 닫는다 && scene.character_closing !== null ? { text: scene.character_closing } : null,
      elements: { accumulated, missing },
      next: 닫는다
        ? next_scene === null
          ? { kind: '회차끝' as const }
          : { kind: '장면끝' as const, next_scene }
        : { kind: '발화받기' as const },
    }
  })
}

/**
 * 두 번째 `complete` — **아무것도 쓰지 않는다** (명세 7절 D 반복 안전).
 *
 * ## 🔴 지금 세션 값으로 다시 빼면 안 된다
 *
 * 첫 호출이 씬을 닫았으면 그 요청 안에서 다음 장면까지 전진했고, `enterScene()` 이 새 장면을
 * 열며 **누적 요소를 0 으로 되돌린다.** 그 값으로 `required − accumulated` 를 다시 계산하면
 * 「요소가 다 남았다」가 나와, 두 번째 응답만 `발화받기` 로 갈린다 (2026-08-15 실측 — 이
 * 검사가 잡았다).
 *
 * 그래서 **닫혔는지는 `messages` 에 남은 사실로 읽는다** — 요약 행 **바로 뒤**가 닫는 말이면
 * 이 미션이 닫은 것이다. 둘을 한 트랜잭션에 이어 넣으므로 그 인접이 곧 증거이고, 나중에
 * 대화 턴이 따로 닫은 경우(중간에 아이 행이 낀다)와도 갈린다.
 *
 * ⚠️ 닫혔을 때의 `elements` 는 **씬의 필수 요소로 되짚는다.** 완료 시점의 누적을 남길 칸이
 *    `mission_sessions` 에 없기 때문이다(스키마는 #17 소유 — 넓히려면 PR 로 제안한다).
 *    닫혔다는 것이 곧 `missing` 이 비었다는 뜻이라 그 사실은 정확하고, 필수 밖 요소까지
 *    섞여 있던 첫 응답보다 좁아질 수 있다. 앱은 이 칸을 재생에 쓰지 않는다(요약과
 *    `closing_line` 만 쓴다).
 */
async function 되풀이_응답(
  conn: Conn,
  {
    args,
    attempt,
    scene,
    accumulated,
    missing,
  }: {
    args: MissionCallArgs
    attempt: MissionSessionRow
    scene: SceneRow
    accumulated: string[]
    missing: string[]
  },
): Promise<MissionCompleteData> {
  const 요약_행 = await missionSummaryMessage(conn, {
    session_id: args.session_id,
    scene_id: scene.scene_id,
  })
  if (요약_행 === null) {
    // 완료 표시는 있는데 본 대화에 요약 행이 없다 — 한 트랜잭션에 넣으므로 있을 수 없다.
    throw new LookupError(`완료된 미션의 요약 행이 없다: ${attempt.id}`)
  }

  const 그_씬 = await sceneMessages(conn, { session_id: args.session_id, scene_id: scene.scene_id })
  const 요약_다음 = 그_씬[그_씬.findIndex((행) => 행.turn_order === 요약_행.turn_order) + 1] ?? null
  const 닫았다 =
    scene.character_closing !== null && 요약_다음?.text === scene.character_closing

  if (!닫았다) {
    return {
      summary: { message_id: 요약_행.id, text: 요약_행.text },
      closing_line: null,
      // 씬이 그대로라 지금 세션 값이 그때 값이다.
      elements: { accumulated, missing },
      next: { kind: '발화받기' },
    }
  }

  const 세션 = await readSession(conn, args.session_id)
  let next: MissionCompleteData['next'] = { kind: '장면끝' }
  if (세션.status !== 'in_progress') next = { kind: '회차끝' }
  else if (세션.current_scene_id !== null && 세션.current_scene_id !== scene.scene_id) {
    const 지금_장면 = await readScene(conn, 세션.current_scene_id)
    next = { kind: '장면끝', next_scene: { scene_id: 지금_장면.scene_id, code: 지금_장면.code } }
  }

  return {
    summary: { message_id: 요약_행.id, text: 요약_행.text },
    closing_line: { text: scene.character_closing! },
    elements: { accumulated: [...(scene.required_elements ?? [])], missing: [] },
    next,
  }
}
