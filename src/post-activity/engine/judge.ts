// 단어 판정 엔진 — ①을 돌리고, 남은 것만 LLM 에 한 번 묻고, ③으로 근거를 대조한다
// (이슈 #44 · 명세 6절).
//
// `src/report/engine/narrative.ts` 와 같은 자리다 — 재료는 인자로 받고, 응답은 zod 로 읽고,
// **검증 실패가 fallback 을 일으키지 않는다**(`complete()` 가 끝난 뒤에 검증하므로 구조적으로
// 그렇게 된다).
//
// ## 🔴 던지지 않는다 (결정 F4·F8 · 수용 기준 10)
//
// 받아쓴 글은 **판정보다 먼저 저장**되고, 판정이 실패해도 아이 화면은 200 으로 끝까지 간다.
// 그래서 실패는 예외가 아니라 값으로 나온다 — `analyzed: false` · `words: null`.
// `generateReport()`(`src/report/service/generate.ts`)가 같은 이유로 안 던진다.
//
// 🔴 **「판정을 못 했다」와 「단어를 하나도 안 썼다」는 다른 말이다.** 뒤엣것은 12행이 전부
// `missing` 이고 `analyzed: true` 다 (명세 4.2 — `analyzed_at` 이 그 둘을 가른다).
//
// ## 🔴 활동 한 건에 LLM 호출은 한 번뿐이다 (명세 6.3)
//
// 단어마다 부르지 않는다. ①이 먼저 거르므로 아이가 단어를 잘 썼을수록 물어볼 것이 줄고,
// **하나도 안 남으면 아예 안 부른다.**
//
// ## ⛔ 이 파일이 안 하는 것
//
// DB 를 모른다. `post_activity_keywords` 에 넣는 것도 `analyzed_at` 을 채우는 것도 이슈 #45 다.
// 여기는 **넣을 값을 돌려줄 뿐**이다.

import { z } from 'zod'

import { ValueError } from '@/llm/domain/progress'
import { extractJson } from '@/llm/judge'
import { chooseBody } from '@/llm/prompts'
import { complete, type LLMResult } from '@/llm/provider'
import type { Settings } from '@/llm/config'
import {
  근거가_원문에_있나,
  규칙_단계,
  단어_열쇠,
  빈_장부,
  줄거리_뼈대,
  type 규칙_판정,
} from '@/post-activity/domain/keywords'
import type {
  단어판정,
  버린것,
  판정결과,
  판정할_단어,
  후활동이야기,
  후활동카드,
} from '@/post-activity/types'

import { buildRetellingKeywordsMaterial } from './material'

/** 프롬프트 폴더 이름. `chooseBody()` 가 이 이름으로 `보낼것.md` 를 읽는다. */
export const 단어판정_프롬프트 = 'retelling_keywords'

/**
 * `llm_calls.purpose` 에 그대로 들어갈 글자다.
 *
 * ⚠️ 지금 `llm_calls_purpose_check` 는 `('analysis','character','mission_reply',
 * 'mission_summary')` 넷만 받는다(`src/llm/db/schema.ts:841`). **이 값을 넣으려면 CHECK 를
 * 넓혀야 하고, 그것은 저장 배선(이슈 #45)의 몫이다** — 리포트 두 편이 같은 자리에서 같은
 * 방식으로 갔다(`src/report/engine/narrative.ts` 의 `말하기분석_용도` 머리말).
 * 안 넓히면 #45 에서 INSERT 가 막힌다. **판정 자체는 DB 를 안 타므로 여기서는 안 막힌다.**
 */
export const 단어판정_용도 = 'retelling_keywords'

/** `post_activity_results.analysis_version` 에 넣을 값 (명세 4.2). */
export const 판정_버전 = 'retelling_v1'

/**
 * 판정 응답이 규격에 안 맞는다. ⛔ **fallback 사유가 아니다.**
 *
 * `ReportNarrativeError` 와 같은 갈래다 — 「받은 것이 잘못됐다」라서 `ValueError` 를
 * 그대로 물려받는다.
 */
export class RetellingKeywordsError extends ValueError {
  constructor(메시지: string) {
    super(메시지)
    this.name = 'RetellingKeywordsError'
  }
}

// ── 응답 규격 ──────────────────────────────────────────────────────────────

/**
 * 프롬프트가 내는 것 (명세 6.1 ② · `보낼것.md` 의 `[W-ONLY]`·`[W-JSON]`).
 *
 * 🔴 **`similar` 참·거짓 하나뿐이다.** `used`·`missing` 으로 가르는 것은 이 파일이다 —
 * 세 단계 이름을 프롬프트에 알려 주면 모델이 ①이 이미 낸 `used` 를 다시 낸다 — 까닭은
 * `prompts/retelling_keywords/` 의 사람이 읽는 쪽 「판정은 3단」 절에 적혀 있다.
 *
 * ⚠️ `strictObject` 가 아니다. 곁가지 필드 하나 때문에 판정 열두 개가 통째로 날아가는 것보다
 * 아는 칸만 받아 쓰는 편이 낫다 (`narrative.ts` 와 같은 판단).
 * ⚠️ `evidence` 는 **빈 문자열로 온다**(`similar: false` 일 때). `null` 로 오는 판도 받아 둔다.
 */
export const 단어판정_응답_스키마 = z.object({
  words: z.array(
    z.object({
      word: z.string(),
      similar: z.boolean(),
      evidence: z.string().nullable().default(null),
    }),
  ),
})

export type 단어판정_응답 = z.infer<typeof 단어판정_응답_스키마>
export type 응답단어 = 단어판정_응답['words'][number]

/**
 * LLM 에 그대로 나가는 스키마. 프롬프트에 JSON 모양을 다시 적지 않는 이유가 이것이다 —
 * **모양을 두 곳에 적으면 갈라진다** (`narrative.ts` 의 두 스키마와 같은 자리).
 *
 * ⚠️ 프롬프트 본문에도 예시 JSON 이 한 줄 적혀 있다. 짧아서 그렇게 둔 것이고
 * (프롬프트 갈래의 「프롬프트에서 뺀 것」 표), 규격의 정본은 여기다.
 */
export const 단어판정_출력_스키마: Record<string, unknown> = {
  type: 'object',
  properties: {
    words: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          word: { type: 'string' },
          similar: { type: 'boolean' },
          evidence: { type: 'string' },
        },
        required: ['word', 'similar', 'evidence'],
      },
    },
  },
  required: ['words'],
}

/**
 * 응답 글자에서 JSON 을 꺼내 규격을 잰다.
 *
 * 코드 울타리를 걷어 내고 중괄호 안을 꺼내는 일은 `extractJson()`(`src/llm/judge.ts`)이
 * 이미 한다 — 같은 일을 하는 자리를 둘로 만들지 않는다.
 */
export function parseRetellingKeywordsResponse(본문: string): 단어판정_응답 {
  const 값 = extractJson(본문)
  if (값 === null) {
    throw new RetellingKeywordsError(
      `retelling_keywords 응답이 JSON 이 아니다\n받은 것: ${본문.slice(0, 200)}`,
    )
  }
  const 읽은것 = 단어판정_응답_스키마.safeParse(값)
  if (!읽은것.success) {
    throw new RetellingKeywordsError(
      `retelling_keywords 출력이 규격에 안 맞는다:\n${z.prettifyError(읽은것.error)}`,
    )
  }
  return 읽은것.data
}

// ── ②③ 합치기 ─────────────────────────────────────────────────────────────

/**
 * ①이 낸 것과 ②의 응답을 합쳐 **12행을 세운다.** ③ 대조가 여기서 돈다. 순수 함수다.
 *
 * 차례는 `규칙.전체` — 곧 `post_activity_config.cards[]` 순서다.
 *
 * 🔴 **응답에 없는 단어도 행이 된다** (명세 4.3 — 판정한 단어는 12개 전부 행이 생긴다).
 * 「없는 것」을 세려면 행이 있어야 한다.
 *
 * ⚠️ 응답은 `card_id` 를 안 싣는다 — 12개 단어가 서로 겹치지 않아 `word` 만으로 찾을 수
 * 있기 때문이다(프롬프트 갈래의 「이 갈래가 정한 것」 표). 그래도 **같은 글자가 두 카드에
 * 놓일 때를 대비해 목록으로 받아 두 자리에 같은 판정을 얹는다** — 이야기가 늘어 그런 날이
 * 오면 재료·출력 양쪽에 `card_id` 를 실어야 하고, 그때 이 함수가 고쳐질 자리다.
 *
 * ⚠️ 같은 단어가 두 번 오면 **먼저 온 것을 남긴다** (`낱말_거르기()` 와 같은 결).
 */
export function 걸러낸_단어판정(
  규칙: 규칙_판정,
  응답단어들: readonly 응답단어[],
  줄거리뼈대: string,
  장부: 버린것,
): 단어판정[] {
  const 판정 = new Map<string, 단어판정>()
  for (const 것 of 규칙.결정) 판정.set(단어_열쇠(것.card_id, 것.word), 것)

  const 물어본것 = new Map<string, 판정할_단어[]>()
  for (const 것 of 규칙.남은것) {
    const 자리들 = 물어본것.get(것.word) ?? []
    자리들.push(것)
    물어본것.set(것.word, 자리들)
  }

  const 답한것 = new Set<string>()

  for (const 답 of 응답단어들) {
    const 단어 = 답.word.trim()
    const 자리들 = 물어본것.get(단어)
    if (자리들 === undefined) {
      // 물어보지 않은 단어다 — ①이 이미 끝냈거나 아예 없는 글자다. 얹지 않는다.
      장부.unasked.push(답.word)
      continue
    }
    if (답한것.has(단어)) continue
    답한것.add(단어)

    const 근거 = (답.evidence ?? '').trim()
    // ③ — 지어낸 근거는 여기서 버린다. `similar: false` 면 댈 근거가 없으니 볼 것도 없다.
    const 살았나 = 답.similar && 근거가_원문에_있나(근거, 줄거리뼈대)
    if (답.similar && !살았나) 장부.evidence.push(단어)

    for (const 자리 of 자리들) {
      판정.set(단어_열쇠(자리.card_id, 자리.word), {
        card_id: 자리.card_id,
        word: 자리.word,
        // 근거는 **아이 원문에서 떼어 온 조각 그대로** 담는다 (`[W-VERBATIM]`).
        // `missing` 이면 인용할 말이 없으므로 NULL 이다 (명세 4.3) — 🔴 빈 문자열이 아니다.
        ...(살았나
          ? { status: 'similar' as const, evidence: 근거 }
          : { status: 'missing' as const, evidence: null }),
        decided_by: 'llm',
      })
    }
  }

  // 물어봤는데 답이 안 온 단어. 「안 쓴 것」으로 떨어뜨린다 (`[W-DOUBT]` 와 같은 방향).
  for (const 것 of 규칙.남은것) {
    const 열쇠 = 단어_열쇠(것.card_id, 것.word)
    if (판정.has(열쇠)) continue
    장부.unanswered.push(것.word)
    판정.set(열쇠, {
      card_id: 것.card_id,
      word: 것.word,
      status: 'missing',
      evidence: null,
      decided_by: 'llm',
    })
  }

  return 규칙.전체
    .map((것) => 판정.get(단어_열쇠(것.card_id, 것.word)))
    .filter((것): 것 is 단어판정 => 것 !== undefined)
}

// ── 부르기 ─────────────────────────────────────────────────────────────────

/**
 * LLM 을 부르는 함수. 기본은 `complete()` 다.
 *
 * 🔴 **검사가 바꿔치기해서 네트워크 없이 판정 규칙만 볼 수 있게 둔다** —
 * `ReportCall`(`src/report/engine/narrative.ts`)·`JudgeCall`(`src/llm/judge.ts`)과 같은 자리다.
 * 검사에서 진짜 API 를 치면 돈이 나가고 답이 회차마다 흔들린다.
 */
export type RetellingCall = (
  system: string,
  user: string,
  options: {
    json_schema: Record<string, unknown>
    settings?: Settings
    purpose: string
    notify?: (제목: string, 내용: string) => void
  },
) => Promise<LLMResult>

export interface JudgeRetellingArgs {
  /** 이야기 제목과 한 줄 요지. 아이 말을 읽을 때 무슨 이야기인지 알라고 준다 */
  story: 후활동이야기
  /** `stories.post_activity_config.cards[]` 그대로 — 카드 넉 장 × 단어 셋 */
  cards: readonly 후활동카드[]
  /** 서버가 받아쓴 아이 줄거리 원문 (`post_activity_results.retelling_text`) */
  retelling: string
  /** 주면 그 본문을 system 으로 보낸다. **안 주면 `보낼것.md` 를 읽는다** (`chooseBody`) */
  prompt?: string | null
  settings?: Settings
  notify?: (제목: string, 내용: string) => void
  call?: RetellingCall
}

function 사유(오류: unknown): string {
  return 오류 instanceof Error ? `${오류.name}: ${오류.message}` : String(오류)
}

/**
 * 받아쓴 줄거리 한 덩이를 받아 **단어 12개의 판정**을 낸다 (명세 6절). 이 도메인의 진입점이다.
 *
 * ```
 * const 결과 = await judgeRetellingKeywords({ story, cards, retelling })
 * 결과.words     // post_activity_keywords 에 넣을 12행. 판정을 못 했으면 null
 * 결과.analyzed  // false 면 analyzed_at 을 NULL 로 둔다
 * 결과.dropped   // 대조에서 버린 것 — 로그로 남길 것
 * ```
 *
 * ⛔ **던지지 않는다.** 프롬프트 파일을 못 읽는 것도, LLM 이 죽은 것도, 응답이 규격에 안
 * 맞는 것도 전부 `analyzed: false` 로 나온다.
 *
 * ⚠️ `retelling` 이 빈 글이어도 **여기서 막지 않는다.** 아무 단어도 못 찾아 12개가 전부
 * ②로 가고, LLM 이 전부 거짓을 내 12행이 `missing` 이 된다 — 답은 맞지만 호출 한 번이
 * 헛나간다. 아이가 아무 말도 안 했을 때 **부르지 않는 판단은 부르는 쪽(#45)의 몫**이다.
 * 여기서 막으면 「빈 글이면 무엇이 나가나」를 검사가 잴 수 없고, 그 판단이 두 곳에 생긴다.
 */
export async function judgeRetellingKeywords(args: JudgeRetellingArgs): Promise<판정결과> {
  const 뼈대 = 줄거리_뼈대(args.retelling)
  const 규칙 = 규칙_단계(args.cards, 뼈대)
  const 장부 = 빈_장부()

  // ①이 다 끝냈다 (또는 판정할 단어가 아예 없다) — 🔴 LLM 을 부르지 않는다 (명세 6.3).
  if (규칙.남은것.length === 0) {
    return {
      analyzed: true,
      words: 걸러낸_단어판정(규칙, [], 뼈대, 장부),
      failed: null,
      llm: null,
      dropped: 장부,
      version: 판정_버전,
    }
  }

  let 응답: LLMResult | null = null
  try {
    const 재료 = buildRetellingKeywordsMaterial({
      story: args.story,
      cards: args.cards,
      words: 규칙.남은것,
      retelling: args.retelling,
    })
    const 본문 = chooseBody(단어판정_프롬프트, args.prompt ?? null)
    const 호출 = args.call ?? complete

    응답 = await 호출(본문, 재료, {
      json_schema: 단어판정_출력_스키마,
      settings: args.settings,
      purpose: 단어판정_용도,
      notify: args.notify,
    })
    const 읽은것 = parseRetellingKeywordsResponse(응답.text)

    return {
      analyzed: true,
      words: 걸러낸_단어판정(규칙, 읽은것.words, 뼈대, 장부),
      failed: null,
      llm: 응답,
      dropped: 장부,
      version: 판정_버전,
    }
  } catch (오류) {
    // 🔴 여기서 나오는 것은 **「판정 못 했다」**이지 「단어를 안 썼다」가 아니다.
    //    ①이 찾아 둔 `used` 까지 버리는 것이 아깝게 보이지만, 반만 판정한 12행을 저장하면
    //    보호자 화면이 그것을 「이 단어들은 안 나왔어요」로 읽는다 (명세 4.2).
    return {
      analyzed: false,
      words: null,
      failed: 사유(오류),
      llm: 응답,
      dropped: 장부,
      version: 판정_버전,
    }
  }
}
