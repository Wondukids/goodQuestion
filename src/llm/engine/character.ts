// 캐릭터 LLM 층 — 재료를 보내고 대사 한 마디를 받는다 (이슈 #26 말-6).
//
// 파이썬 `src/goodquestion/character.py` + `runner.대사까지()` 의 **부르나 마나를 가르는 부분**을
// 옮긴 것이다. DB 에 넣고 로그를 찍는 것은 여기 없다 — 그건 `service/turn.ts`(조립) 몫이다.
//
// `CLAUDE.md` 경계 3 — 캐릭터 LLM 은 주어진 모드와 반응 원칙에 따라 **대사만** 만든다.
// 장면을 끝내지 않고, 아이 대신 사고 요소를 말하지 않고, 새 설정을 지어내지 않는다.
// 그 지시는 전부 `prompts/character.md` 에 있다. 이 파일은 부르고 받을 뿐이다.
//
// **JSON 이 아니다.** 문장을 그대로 받는다(`prompts/character.md` 「내보내는 것」).
// 그래서 `json_schema` 를 주지 않는다 — 결정 20 대로 `complete()` 를 그대로 쓴다.
//
// ## 받은 대사를 고치지 않는다
//
// 앞뒤 공백만 턴다. 자르지도, 따옴표를 벗기지도, 이름표를 떼지도 않는다.
//
// - **길이** — 문서에 기준이 없다. "1~2문장" 의 근거는 주석 한 줄뿐이라 자르면 문장이 깨진다.
// - **군더더기** — 프롬프트가 이미 금지한 것들이다(따옴표·이름표·괄호 지문·코드블록).
//   코드가 조용히 치워 주면 프롬프트가 안 지켜지고 있다는 걸 아무도 모른다.
//   이 레포는 무엇이 나왔는지 보려고 있다.

import { complete, type LLMResult } from '@/llm/provider'
import { chooseBody, sendableBody } from '@/llm/prompts'
import type { Settings } from '@/llm/config'

import {
  buildCharacterMaterial,
  type CharacterScene,
  type NarrationScene,
  type PastMessage,
} from './material'

export interface GenerateLineOptions {
  /** 주면 그 본문을 system 으로 보낸다. **안 주면 `prompts/character.md` 를 읽는다.** */
  prompt?: string | null
  settings?: Settings
  notify?: (제목: string, 내용: string) => void
}

/** 대사 한 마디와 「누가 대답했는지」. */
export interface GeneratedLine {
  line: string
  llm: LLMResult
}

/**
 * 캐릭터 LLM 을 부른다 (파이썬 `character.대사_만들기()`).
 *
 * ⛔ **CLOSING 인지 여기서 보지 않는다.** 이 함수까지 왔다는 것은 이미 부르기로 정해졌다는 뜻이다.
 *    가르는 자리는 아래 `characterTurn()` 하나뿐이다 — 두 곳에서 보면 한쪽만 고쳐진다.
 *
 * 준 본문의 출처는 이 함수의 관심 밖이다.
 */
export async function generateLine(
  재료: string,
  options: GenerateLineOptions = {},
): Promise<GeneratedLine> {
  const 본문 = sendableBody(chooseBody('character', options.prompt))
  const 응답 = await complete(본문, 재료, {
    settings: options.settings,
    // ⚠️ `llm_calls.purpose` 에 그대로 들어간다. 옮겨 담는 표를 두지 않는다 (`analyze.ts` 참고).
    purpose: 'character',
    notify: options.notify,
  })
  return { line: 응답.text.trim(), llm: 응답 }
}

/** 이 턴에서 캐릭터가 할 말을 정하는 데 필요한 판정 조각. `decide()` 의 답에서 온다. */
export interface CharacterDirection {
  response_mode: string
  reaction_key: string
  guidance_target: string | null
}

/** 장면의 고정 마지막 대사. **생성하지 않는다** (`CLAUDE.md` 경계 4). */
export interface ClosingScene {
  character_closing: string | null
}

export interface CharacterTurnArgs extends GenerateLineOptions {
  scene: CharacterScene & ClosingScene
  precedingNarrations?: readonly NarrationScene[]
  child_utterance: string
  main_point: string | null
  decision: CharacterDirection
  /** 이 장면에서 오간 말. **이번 발화는 빼고** 준다. */
  pastMessages?: readonly PastMessage[]
}

/**
 * 이 턴에 캐릭터가 할 말. **`line` 과 `fixed_closing` 중 하나만 찬다.**
 *
 * 어느 쪽이든 `messages` 는 **한 행**이다 (결정 21 · 36).
 */
export interface CharacterTurn {
  /** 캐릭터 LLM 이 만든 대사. CLOSING 이면 `null` — 안 불렀다는 뜻이다. */
  line: string | null
  /** CLOSING 일 때만. `story_scenes.character_closing` 원문 그대로다. */
  fixed_closing: string | null
  /** 대사와 같이 움직인다. CLOSING 이면 `null`. */
  llm: LLMResult | null
}

/**
 * 🔴 **캐릭터 LLM 을 부를지 말지를 가르는 유일한 자리** (파이썬 `runner.대사까지()` 의 7단계).
 *
 * ⛔ **CLOSING 이면 캐릭터 LLM 을 아예 부르지 않는다** (`CLAUDE.md` 경계 4 · 결정 36).
 *    장면의 마지막 말은 `story_scenes.character_closing` 의 **고정 텍스트뿐**이고,
 *    그 앞에 붙이던 "짧은 반응 1문장"은 없앴다 (정본 `발화분석:364` · `DB구조:322`).
 *    재료조차 만들지 않는다 — 안 보낼 것을 만들 이유가 없고, 만들면 언젠가 보내진다.
 *
 * ⚠️ 조립층(`service/turn.ts`)은 **이 함수를 부른다.** `generateLine()` 을 직접 부르면
 *    CLOSING 갈림이 조립층으로 새고, 그러면 라우트가 부르는 길과 화면이 부르는 길이 갈릴 수 있다.
 *
 * `character_opening` 도 마찬가지로 고정 텍스트다. 그건 장면 시작(`startScene()`) 자리라 여기 없다.
 */
export async function characterTurn(args: CharacterTurnArgs): Promise<CharacterTurn> {
  const { scene, decision, prompt = null, settings, notify } = args

  if (decision.response_mode === 'CLOSING') {
    return { line: null, fixed_closing: scene.character_closing, llm: null }
  }

  const 재료 = buildCharacterMaterial({
    scene,
    precedingNarrations: args.precedingNarrations,
    child_utterance: args.child_utterance,
    main_point: args.main_point,
    response_mode: decision.response_mode,
    reaction_key: decision.reaction_key,
    guidance_target: decision.guidance_target,
    pastMessages: args.pastMessages,
    prompt,
  })

  const { line, llm } = await generateLine(재료, { prompt, settings, notify })
  return { line, fixed_closing: null, llm }
}
