// 분석·캐릭터 LLM 에 보낼 **재료**를 만든다 (이슈 #26 말-4).
//
// 파이썬 `src/goodquestion/runner.py` 의 `분석_재료()`·`캐릭터_재료()`·`_낱개()`·`_평평하게()`
// 자리다. 재료를 만드는 일만 하고 **LLM 을 부르지 않는다** — 부르는 것은 `analyze.ts`·
// `character.ts` 다. 관리자 화면이 「이 턴에 무엇을 보냈나」를 따로 들여다보려면
// 재료를 만드는 자리와 보내는 자리가 갈려 있어야 한다 (`CLAUDE.md` — 한 호출로 묶지 않는다).
//
// ## ⛔ `conn` 을 받지 않는다 (2026-08-12 · 이슈 #26)
//
// 콘텐츠는 부르는 쪽이 `scene` 으로 이미 넘겨주고, 세션에서 오던 값은 인자로 올렸다
// (`previous_character_message` · `pastMessages`). **코어는 그 값이 어디서 왔는지 모른다.**
// eslint 가 `lib/engine/` 에서 `repo` import 를 막아 이걸 구조로 지킨다.
//
// ## 🔴 재료 JSON 을 만드는 자리는 `materialJson()` 하나뿐이다
//
// 2026-08-10 에 파이썬에서 골든셋이 엔진과 **다른 프롬프트**로 돌고 있던 것이 드러났고,
// 원인은 재료를 만드는 자리가 둘이었던 것이다(`lib/prompts/parse.ts` 의 `materialJson` 머리말).
// 그래서 이 파일은 JSON 을 직접 만들지 않고 그 함수만 부른다. 또 나누면 또 갈라진다.
//
// ## ⛔ 이 파일은 프롬프트 본문을 아예 모른다 (2026-08-14)
//
// 그전에는 md 의 「## 받는 것」 절 뒤 코드블록을 틀로 뽑아 `{analysis_material}` 을 채웠다.
// 그 절은 **사람이 읽는 층**에 있었고, 나가는 쪽과 사람 쪽을 다른 파일로 나누면서
// `보낼것.md` 에서 사라졌다. 채울 자리도 파일마다 하나뿐이라 틀을 뽑을 이유가 없었다.
//
// 그래서 지금은 **user 본문이 곧 `materialJson(재료)`** 다. 프롬프트 본문은 system 으로만
// 나가고(`analyze.ts`·`character.ts`), 이 파일은 그 글자를 한 번도 안 본다.

import { materialJson } from '@/llm/prompts'

// ── 장면 · 메시지가 이 층에 보이는 모양 ─────────────────────────────────────
//
// ⚠️ 칸 이름은 **DB 컬럼 이름 그대로**다 (`docs/설계/코드구조.md` 3절 — 변환 층을 만들지 않는다).
//    `repo/content.ts` 가 돌려주는 행이 그대로 들어맞게 구조 타입으로만 적는다.
//    nullable 인 것은 전개 장면에서 실제로 비어 있는 칸들이다 (`db/schema.ts` 5절).

/** 분석 재료에 쓰이는 장면 칸. ⛔ 캐릭터 쪽 칸은 여기 없다 (`docs/기준/대화작동규칙.md:81`). */
export interface AnalysisScene {
  scene_description: string | null
  conflict: string | null
  required_elements: readonly string[] | null
  element_criteria: Readonly<Record<string, string>> | null
  /** 🔴 `goal` 플래그가 켜졌을 때만 실린다. 아래 `analysisGoalEnabled()` 를 볼 것. */
  scene_goal?: string | null
}

/** 캐릭터 재료에 쓰이는 장면 칸. */
export interface CharacterScene {
  character_name: string | null
  persona: string | null
  speech_style: string | null
  guidance_style: string | null
  forbidden: readonly string[] | null
  conflict: string | null
  scene_stance: string | null
  remaining_worries: Readonly<Record<string, string>> | null
}

/** 앞선 전개 장면. 설명만 쓴다. */
export interface NarrationScene {
  scene_description: string | null
}

/** 이 장면에서 이미 오간 말 한 줄 (`messages` 행). */
export interface PastMessage {
  speaker_type: string
  text: string
}

// ── 🔴 `goal` 플래그 ───────────────────────────────────────────────────────

/** `goal` 을 끄는 환경변수 이름. 없으면 **켜져 있다**(기본 켬). */
export const GOAL_ENV = 'GQ_ANALYSIS_GOAL'

const 끄는_값 = new Set(['0', 'false', 'off', 'no'])

/**
 * 분석 재료에 장면 목표(`goal`)를 넣나. **기본은 켬**이고 `GQ_ANALYSIS_GOAL=0` 으로 끈다.
 *
 * 2026-08-12 에 사람이 **넣는 쪽으로 뒤집었다**(`docs/설계/스펙확정_연동기준.md` C).
 * 그런데 안 넣던 이유 둘은 여전히 살아 있다 — 목표를 보여주면 분석 LLM 이 거기 맞춰
 * 요소를 **억지로 찾아내고**, `element_criteria` 가 이미 goal 을 요소별로 더 정확히
 * 쪼개 둔 형태다. 그 둘이 사실인지는 골든셋으로 재면 나오므로 **값을 지우지 않고 끌 수 있게** 했다.
 *
 * ⚠️ **이식 직후 대조는 끄고 한다.** 파이썬은 goal **없이** 골든셋을 재 왔다.
 *    켠 채로 먼저 재면 점수가 떨어졌을 때 「이식 실수」인지 「goal 탓」인지 못 가른다
 *    (`이식_체크리스트.md` B-3 → B-5 순서).
 *
 * ⚠️ 환경변수를 **부를 때마다** 읽는다. 모듈을 불러온 시점에 굳히면 검사와 회차가
 *    같은 프로세스에서 값을 바꿀 수 없다.
 */
export function analysisGoalEnabled(): boolean {
  const 값 = (process.env[GOAL_ENV] ?? '').trim().toLowerCase()
  return 값 === '' ? true : !끄는_값.has(값)
}

// ── 분석 재료 ──────────────────────────────────────────────────────────────

export interface AnalysisMaterialArgs {
  scene: AnalysisScene
  /** 이 장면보다 앞선 전개 장면들. 대화 장면은 `scene_description` 이 비어 있어 여기서 메운다. */
  precedingNarrations?: readonly NarrationScene[]
  child_utterance: string
  previous_character_message?: string | null
  /** 안 주면 `analysisGoalEnabled()`(환경변수, 기본 켬). */
  include_goal?: boolean
}

/**
 * 분석 LLM 에 보낼 user 본문 (파이썬 `runner.분석_재료()`).
 *
 * 재료는 **여섯 조각**이다 — 콘텐츠 넷(`scene.description` · `scene.conflict` ·
 * `target_elements` · `element_criteria`) + 세션 둘(`child_utterance` ·
 * `previous_character_message`). `goal` 을 켜면 일곱이 된다.
 *
 * `story_title` · `character_name` · `accumulated_elements` · `current_child_turn_count`
 * 는 **넣지 않는다.** 전부 답을 미리 알려주는 값이다 (`docs/기준/대화작동규칙.md:81`).
 *
 * 대화 장면은 `scene_description` 이 비어 있어(`콘텐츠_방귀뀌는며느리.md:208`)
 * **직전 전개 장면 하나**로 메운다 (결정 25).
 */
export function buildAnalysisMaterial(args: AnalysisMaterialArgs): string {
  const { scene, precedingNarrations = [], child_utterance } = args
  const 앞선 = precedingNarrations
  const 장면_상황 =
    scene.scene_description || (앞선.length > 0 ? 앞선[앞선.length - 1].scene_description : '')

  const 재료: Record<string, unknown> = {
    scene: {
      description: 장면_상황 ?? '',
      conflict: scene.conflict ?? '',
    },
    previous_character_message: args.previous_character_message ?? '',
    child_utterance,
    target_elements: [...(scene.required_elements ?? [])],
    element_criteria: { ...(scene.element_criteria ?? {}) },
  }

  // 🔴 goal 은 **맨 뒤에** 붙인다. 끈 상태의 여섯 조각이 파이썬이 만들던 글자와
  //    한 바이트도 다르지 않아야 대조(B-3)가 성립하기 때문이다.
  if (args.include_goal ?? analysisGoalEnabled()) {
    재료.goal = scene.scene_goal ?? ''
  }

  return materialJson(재료)
}

// ── 캐릭터 재료 ────────────────────────────────────────────────────────────

export interface CharacterMaterialArgs {
  scene: CharacterScene
  precedingNarrations?: readonly NarrationScene[]
  child_utterance: string
  main_point: string | null
  response_mode: string
  reaction_key: string
  guidance_target?: string | null
  /** 이 장면에서 오간 말. **이번 발화는 빼고** 준다 — 부르는 쪽이 잘라서 넘긴다. */
  pastMessages?: readonly PastMessage[]
}

/**
 * 캐릭터 LLM 재료 **묶음 그 자체**(채우기 전) — 파이썬 `runner.캐릭터_재료_묶음()`.
 *
 * `docs/기준/LLM입출력규격.md:234-341` 의 6묶음. **안 넣는 것 셋이 이 함수의 절반이다.**
 *
 * - ⛔ `scene_goal` — 읽으면 아이 대신 그 문장을 말해 버린다 (`:275-278`).
 *   파이썬 `scoring.py` 에 `scene_goal_leak` 전용 채점까지 있다.
 *   🔴 **분석 쪽에 `goal` 을 켜도 캐릭터 쪽은 그대로다** (`스펙확정_연동기준.md` C).
 * - `missing_elements` 통째 — `remaining_worries[guidance_target]` **한 줄**만 준다 (`:299-309`)
 * - 전체 줄거리 — 스포일러. `scene_order < N` 인 전개까지만 (`:320-340`)
 *
 * ⛔ `guidance_target` **이름 자체는 안 들어간다.** 규칙 층이 넘기는 것은 요소 이름과 걱정
 * 문장인데, 캐릭터 프롬프트에는 걱정 문장만 실어 왔다 (기준 문서 13절). 그 선을 지킨다.
 *
 * 🔴 **채우기와 갈라 둔 이유** — 유도 골든셋이 **이 dict 를 그대로 파일에 박제**해야 하는데,
 * 베껴 쓰면 조용히 갈라진다 (`web/tools/유도셋-기록.ts` 의 `pickItem()`, 파이썬도 같은 자리에서
 * `캐릭터_재료_묶음()` 을 갈라냈다).
 */
export function buildCharacterMaterialBundle(
  args: Omit<CharacterMaterialArgs, 'prompt'>,
): Record<string, unknown> {
  const {
    scene,
    precedingNarrations = [],
    child_utterance,
    main_point,
    response_mode,
    reaction_key,
    guidance_target = null,
    pastMessages = [],
  } = args

  // 없으면 빈칸. 지어내지 않는다 (`docs/기준/LLM입출력규격.md:273`)
  const 걱정 = guidance_target ? ((scene.remaining_worries ?? {})[guidance_target] ?? '') : ''

  const 이름: Record<string, string> = {
    child: '아이',
    character: scene.character_name || '캐릭터',
  }

  const 재료: Record<string, unknown> = {
    character: {
      name: scene.character_name ?? '',
      persona: scene.persona ?? '',
      speech_style: scene.speech_style ?? '',
      guidance_style: scene.guidance_style ?? '',
      forbidden: [...(scene.forbidden ?? [])],
    },
    story_so_far: precedingNarrations.map((전개) => 전개.scene_description ?? ''),
    scene: {
      conflict: scene.conflict ?? '',
      stance: scene.scene_stance ?? '',
    },
    said_so_far: pastMessages.map((줄) => ({
      speaker: 이름[줄.speaker_type] ?? 줄.speaker_type,
      text: 줄.text,
    })),
    latest: {
      child_utterance,
      main_point: main_point ?? '',
    },
    direction: {
      response_mode,
      reaction_key,
      remaining_worry: 걱정,
    },
  }

  return 재료
}

/**
 * 만들어 둔 재료 묶음을 user 본문으로 (파이썬 `runner.캐릭터_재료()` 의 뒷대목).
 *
 * 묶음이 어디서 왔는지 모른다 — 방금 만든 것이든 골든셋 파일에서 읽어 온 것이든 같다.
 * **JSON 으로 만드는 자리도 하나여야 한다**(위 `buildCharacterMaterialBundle()` 머리말과
 * 같은 이유 — 자리가 둘이면 회차와 골든셋이 갈린다).
 */
export function renderCharacterMaterial(재료: Readonly<Record<string, unknown>>): string {
  return materialJson(재료)
}

/** 캐릭터 LLM 에 보낼 user 본문 (파이썬 `runner.캐릭터_재료()`). 위 둘을 이어 부른다. */
export function buildCharacterMaterial(args: CharacterMaterialArgs): string {
  return renderCharacterMaterial(buildCharacterMaterialBundle(args))
}
