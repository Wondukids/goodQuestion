// 미션 LLM 층 — 미션 턴 대사(아이대답요약)와 종료 요약의 재료를 만들고 부른다
// (이슈 #18 · `docs/미션_명세.md` 9절).
//
// `material.ts`(재료만)·`character.ts`(부르기만)가 일반 턴에서 가른 두 일을 미션 쪽은
// 파일 하나에 담되, 함수의 경계는 같다 — 재료를 만드는 함수는 LLM 을 모르고, 부르는
// 함수는 재료가 어디서 왔는지 모른다. DB 에 넣고 로그를 찍는 것은 여기 없다(조립층 몫).
//
// ## ⛔ 분석은 여기 없다 (M2)
//
// 미션 턴의 발화분석은 기존 `analyze.ts` + `prompts/analysis` 를 **그대로** 쓴다 —
// 프롬프트·기준·후처리(`postProcess`) 재사용, 신설 금지. 이 파일이 만드는 것은
// 판정(`domain/mission.ts`) 뒤의 캐릭터 대사 두 종류뿐이다.
//
// ## 🔴 재료 JSON 을 만드는 자리는 여기 두 함수뿐이다
//
// `materialJson()` 하나로만 글자를 만든다 (`material.ts` 머리말과 같은 이유 —
// 자리가 둘이면 회차와 골든셋이 갈린다).
//
// ## 받은 대사를 고치지 않는다
//
// 앞뒤 공백만 턴다 — `character.ts` 와 같은 원칙. 프롬프트가 금지한 군더더기를 코드가
// 조용히 치워 주면 프롬프트가 안 지켜지고 있다는 걸 아무도 모른다.

import { complete, type LLMResult } from '@/llm/provider'
import { chooseBody, materialJson } from '@/llm/prompts'
import type { Settings } from '@/llm/config'

import type { CharacterScene, PastMessage } from './material'

/**
 * 화자 이름표 — `buildCharacterMaterialBundle()` 의 `said_so_far` 와 같은 규칙이다.
 * `mission_messages.speaker_type` 은 child/character/system 인데, system 행(건너뜀 기록)을
 * 실을지 말지는 부르는 쪽이 정한다 — 여기서는 모르는 값은 그대로 흘린다.
 */
function 말_목록(
  rows: readonly PastMessage[],
  character_name: string | null,
): { speaker: string; text: string }[] {
  const 이름: Record<string, string> = {
    child: '아이',
    character: character_name || '캐릭터',
  }
  return rows.map((줄) => ({ speaker: 이름[줄.speaker_type] ?? 줄.speaker_type, text: 줄.text }))
}

/** character 묶음 다섯 칸 — 캐릭터 재료와 같은 다섯이다. 없으면 빈칸, 지어내지 않는다. */
function 캐릭터_묶음(scene: CharacterScene): Record<string, unknown> {
  return {
    name: scene.character_name ?? '',
    persona: scene.persona ?? '',
    speech_style: scene.speech_style ?? '',
    guidance_style: scene.guidance_style ?? '',
    forbidden: [...(scene.forbidden ?? [])],
  }
}

// ── 미션 턴 대사 (아이대답요약 · 다리 대사) ────────────────────────────────

/** `story_missions` 에서 오는 미션 칸 + 이번 스텝의 자리. 이름은 DB 컬럼명 그대로다. */
export interface MissionInfo {
  /** `story_missions.mission_goal` — LLM 재료용 미션 목적 한 문장 */
  mission_goal: string | null
  /** 지금 스텝 key. 다리 대사(트리거 턴)엔 아직 스텝이 없다 — null */
  step?: string | null
  /** 그 스텝의 고정 질문 — config 의 ask (치환이 끝난 문장). 없으면 null */
  question?: string | null
  /** 아이가 고른 소품·카드의 화면 이름 (예: 소쿠리). 없으면 null */
  selection?: string | null
}

export interface MissionReplyMaterialArgs {
  scene: CharacterScene
  mission: MissionInfo
  /** 이 미션 안에서 오간 말(`mission_messages`). **이번 발화는 빼고** 준다 — 캐릭터 재료와 같은 규칙 */
  missionMessages?: readonly PastMessage[]
  child_utterance: string
  main_point: string | null
  /** 'summary_reply'(미션 턴) | 'bridge_into_mission'(트리거 턴 다리 대사) — 명세 9절 */
  direction_kind: string
}

/**
 * 미션 턴 대사 LLM 에 보낼 user 본문 (명세 9절 `prompts/mission_reply` 재료).
 *
 * **안 넣는 것이 이 함수의 절반이다** (캐릭터 재료의 원칙 그대로):
 *
 * - ⛔ `remaining_worry` · 유도 지시 — 미션 턴은 유도하지 않는다(M3). 걱정 한 줄은
 *   종료 요약 재료(`guidance`)에만 실린다.
 * - ⛔ `scene_goal` — 읽으면 아이 대신 그 문장을 말해 버린다 (`material.ts` 와 같은 이유).
 * - `story_so_far` · 본 대화 `said_so_far` — 명세 9절 재료에 없다. 팝업 안의 짧은
 *   구간이라 `mission_said_so_far` 로 충분하고, 토큰을 아낀다.
 * - `response_mode` · `reaction_key` — 미션 턴에는 모드가 없다. 갈림은 `direction.kind` 둘뿐.
 */
export function buildMissionReplyMaterial(args: MissionReplyMaterialArgs): string {
  const { scene, mission, missionMessages = [] } = args

  const 재료: Record<string, unknown> = {
    character: 캐릭터_묶음(scene),
    scene: {
      conflict: scene.conflict ?? '',
      stance: scene.scene_stance ?? '',
    },
    mission: {
      goal: mission.mission_goal ?? '',
      step: mission.step ?? '',
      question: mission.question ?? '',
      selection: mission.selection ?? '',
    },
    mission_said_so_far: 말_목록(missionMessages, scene.character_name),
    latest: {
      child_utterance: args.child_utterance,
      main_point: args.main_point ?? '',
    },
    direction: { kind: args.direction_kind },
  }

  return materialJson(재료)
}

// ── 종료 요약 ──────────────────────────────────────────────────────────────

/**
 * `mission_sessions.selections` 한 칸. ⚠️ `at`(시각)은 받아도 재료에 싣지 않는다 —
 * 모델에게 쓸모가 없고 토큰만 먹는다.
 */
export interface MissionSelection {
  step?: string | null
  kind?: string | null
  value?: string | null
}

export interface MissionSummaryMaterialArgs {
  scene: CharacterScene
  mission: Pick<MissionInfo, 'mission_goal'>
  /** `mission_sessions.selections` 의 선택 기록 */
  selections?: readonly MissionSelection[]
  /** 미션 대화 **전체** (`mission_messages` 전부) — 종료 요약은 다 보고 되짚는다 */
  missionMessages?: readonly PastMessage[]
  /**
   * 남은 요소의 걱정 한 줄 — complete 가 계산한 missing 첫 요소의 `remaining_worries[...]`.
   * 부족 요소가 없으면 null → 재료의 `guidance` 도 null 로 나간다 (명세 9절).
   */
  remaining_worry?: string | null
}

/**
 * 종료 요약 LLM 에 보낼 user 본문 (명세 9절 `prompts/mission_summary` 재료).
 *
 * `scene`(conflict·stance)과 `latest` 는 **일부러 없다** — complete 는 턴이 아니라
 * 「이번 발화」가 없고(명세 7절 D), 맥락은 `mission_dialogue` 전체가 이미 담는다.
 * 명세 9절의 `mission_dialogue` 자리는 `mission_said_so_far` 와 같은
 * `{speaker, text}` 목록으로 채운다 — 화자 없이 문장만 주면 누가 한 말인지 못 가른다.
 */
export function buildMissionSummaryMaterial(args: MissionSummaryMaterialArgs): string {
  const { scene, mission, selections = [], missionMessages = [] } = args

  const 재료: Record<string, unknown> = {
    character: 캐릭터_묶음(scene),
    mission: {
      goal: mission.mission_goal ?? '',
      selections: selections.map((고른것) => ({
        step: 고른것.step ?? '',
        kind: 고른것.kind ?? '',
        value: 고른것.value ?? '',
      })),
    },
    mission_dialogue: 말_목록(missionMessages, scene.character_name),
    guidance: args.remaining_worry ? { remaining_worry: args.remaining_worry } : null,
  }

  return materialJson(재료)
}

// ── LLM 부르기 ─────────────────────────────────────────────────────────────

export interface MissionLineOptions {
  /** 주면 그 본문을 system 으로 보낸다. **안 주면 `prompts/` 의 정본을 읽는다** (`chooseBody`). */
  prompt?: string | null
  settings?: Settings
  notify?: (제목: string, 내용: string) => void
}

/** 대사 한 마디와 「누가 대답했는지」 — `character.ts` 의 답과 같은 모양이다. */
export interface MissionLine {
  line: string
  llm: LLMResult
}

/**
 * 미션 턴 대사 LLM 을 부른다 (명세 4절 ④ `missionReply()`).
 *
 * **JSON 이 아니다** — 문장을 그대로 받으므로 `json_schema` 를 주지 않는다 (캐릭터와 같다).
 */
export async function missionReply(
  재료: string,
  options: MissionLineOptions = {},
): Promise<MissionLine> {
  const 본문 = chooseBody('mission_reply', options.prompt)
  const 응답 = await complete(본문, 재료, {
    settings: options.settings,
    // ⚠️ `llm_calls.purpose` 에 그대로 들어간다 — DB CHECK 를 넓히는 것은 #17 몫이고
    //    이 글자는 트랙 사이의 계약이다. 옮겨 담는 표를 두지 않는다 (`analyze.ts` 참고).
    purpose: 'mission_reply',
    notify: options.notify,
  })
  return { line: 응답.text.trim(), llm: 응답 }
}

/** 종료 요약 LLM 을 부른다 (명세 7절 D — complete 요청이 한 번 부른다). */
export async function missionSummary(
  재료: string,
  options: MissionLineOptions = {},
): Promise<MissionLine> {
  const 본문 = chooseBody('mission_summary', options.prompt)
  const 응답 = await complete(본문, 재료, {
    settings: options.settings,
    purpose: 'mission_summary',
    notify: options.notify,
  })
  return { line: 응답.text.trim(), llm: 응답 }
}

// ── 미션 턴 한 번 — 되묻기 갈림의 유일한 자리 ──────────────────────────────

export interface MissionReplyTurnArgs extends MissionReplyMaterialArgs, MissionLineOptions {
  /** `decideMissionTurn()` 의 답에서 온다. 참이면 LLM 을 아예 부르지 않는다 (M9) */
  reask?: boolean
}

/**
 * 이 턴에 캐릭터가 할 말. **되묻기 턴이면 둘 다 `null`** — 안 불렀다는 뜻이다.
 * 되묻기 문구는 config 고정 대사(`fixed_line`)가 맡고, 그건 조립층이 붙인다.
 */
export interface MissionReplyTurn {
  line: string | null
  llm: LLMResult | null
}

/**
 * 🔴 **미션 턴에서 대사 LLM 을 부를지 말지를 가르는 유일한 자리** —
 * `characterTurn()` 이 CLOSING 을 가르는 것과 같은 꼴이다 (명세 7절 C 되묻기).
 *
 * ⛔ 되묻기(`reask`)면 재료조차 만들지 않는다 — 안 보낼 것을 만들 이유가 없고,
 *    만들면 언젠가 보내진다.
 *
 * ⚠️ 조립층(#19 미션 API)은 **이 함수를 부른다.** `missionReply()` 를 직접 부르면
 *    되묻기 갈림이 조립층으로 새고, 자리가 둘이 되면 한쪽만 고쳐진다.
 */
export async function missionReplyTurn(args: MissionReplyTurnArgs): Promise<MissionReplyTurn> {
  if (args.reask) return { line: null, llm: null }

  const 재료 = buildMissionReplyMaterial(args)
  const { line, llm } = await missionReply(재료, {
    prompt: args.prompt ?? null,
    settings: args.settings,
    notify: args.notify,
  })
  return { line, llm }
}
