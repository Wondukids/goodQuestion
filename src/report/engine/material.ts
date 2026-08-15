// 리포트 프롬프트 둘에 보낼 **재료**를 만든다 (이슈 #37 · 명세 5.2·5.4).
//
// `src/llm/engine/material.ts` 와 같은 자리다 — 재료를 만드는 일만 하고 **LLM 을 부르지
// 않는다.** 부르는 것은 `narrative.ts` 다. 갈라 두면 「이 리포트에 무엇을 보냈나」를
// 따로 들여다볼 수 있고, 검사가 재료만 떼어 잴 수 있다.
//
// ## 🔴 재료 JSON 을 만드는 자리는 `materialJson()` 하나뿐이다
//
// 2026-08-10 에 골든셋이 엔진과 **다른 프롬프트**로 돌고 있던 것이 드러났고, 원인은
// 재료를 만드는 자리가 둘이었던 것이다(`src/llm/prompts/parse.ts` 의 `materialJson` 머리말).
// 그래서 이 파일도 JSON 을 직접 만들지 않고 그 함수만 부른다.
//
// ## ⛔ 자리표시자를 쓰지 않는다
//
// user 본문은 언제나 재료 JSON 한 덩이다. 프롬프트 본문은 system 으로만 나가고
// 이 파일은 그 글자를 한 번도 안 본다 (`prompts/README.md` 2절).
//
// ## ⛔ `ReportMetrics` 를 만들지 않는다
//
// 지표는 규칙이 세고(이슈 #36 · `src/report/domain/metrics.ts`) 이 파일은 **인자로 받는다.**
// 여기서 숫자를 하나라도 다시 세면 화면 두 곳에 다른 숫자가 뜬다 (프론트 계약 2절 ①).

import { materialJson } from '@/llm/prompts'
import type { ReportMetrics } from '@/report/types'

import { 요소_코드 } from './verify'

/**
 * 프롬프트에 실을 아이 정보 (결정 R12).
 *
 * 🔴 **이름은 넣되 로그에는 안 남긴다.** 콘솔 `[LLM]` 줄은 공급자·모델·토큰만 찍으므로
 * (`src/llm/provider/index.ts:505`) 지금 새는 자리는 없다.
 * ⚠️ 저장 배선(이슈 #38)이 `llm_calls.user_text` 를 채울 때는 가려야 한다 — 이 재료가
 * 그 칸에 통째로 들어간다.
 */
export interface ChildInfo {
  name: string
  /** 모르면 `null`. 프롬프트가 나이로 문장을 조절한다 */
  age: number | null
}

export interface ReportMaterialArgs {
  metrics: ReportMetrics
  child: ChildInfo
}

// ── 모자란 요소 ────────────────────────────────────────────────────────────

/**
 * 축이 세는 요소들. **`REQUEST` 만 빠진다.**
 *
 * 🔴 결정 R4 가 「남는 `REQUEST` 는 뜻이 어긋나 쓰지 않는다」로 다섯 축에서 뺐다.
 * 그래서 `axes` 만 보면 `REQUEST` 는 **언제나 0** 이고, 넣어 두면 매번 모자란 요소로
 * 뽑혀 여섯 질문이 전부 그쪽으로 쏠린다. 「축이 안 세는 것」과 「이번에 모자랐던 것」은
 * 다른 말이다.
 *
 * ⚠️ 질문의 `element` 는 **여덟 코드를 다 받는다**(`요소_코드`). 여기서 빼는 것은
 * 「모자랐다고 세는 대상」뿐이다 — 발화가 받쳐 주면 `REQUEST` 질문을 못 낼 이유는 없다.
 */
export const 축이_세는_요소: readonly string[] = 요소_코드.filter((코드) => 코드 !== 'REQUEST')

/** 「모자랐다」로 볼 요소를 최대 몇 개까지 실을지. */
export const 모자란_요소_최대 = 3

/**
 * 이번 활동에서 **모자랐던 요소** (명세 5.4 재료).
 *
 * 명세가 이 말을 재료 목록에만 적고 산식을 주지 않았다. 가장 되돌리기 쉬운 쪽으로 정한다 —
 * `axes[*].parts` 의 요소별 횟수를 그대로 읽어 **0 인 것**을 모자란 것으로 본다.
 * 하나도 0 이 아니면 **가장 적게 나온 것들**을 최대 셋까지 준다.
 *
 * ⚠️ `상호작용` 축의 `parts` 는 `child_questions` · `reprompt_recovered` 라 요소가 아니다
 * (결정 R4). 8요소 코드가 아닌 열쇠는 그냥 지나친다 — 새 지표가 늘어도 안 깨진다.
 *
 * ⛔ **이것은 규칙 층의 산식이 아니다.** 지표(`ReportMetrics`)에는 이 값이 없고, 재료를
 * 만들 때만 쓴다. 나중에 지표 쪽으로 옮기게 되면 이 함수를 지우고 그 칸을 읽으면 된다.
 */
export function 모자란_요소(axes: ReportMetrics['axes']): string[] {
  const 횟수 = new Map<string, number>(축이_세는_요소.map((코드) => [코드, 0]))

  for (const 축 of Object.values(axes)) {
    for (const [열쇠, 값] of Object.entries(축.parts ?? {})) {
      if (!횟수.has(열쇠)) continue
      횟수.set(열쇠, (횟수.get(열쇠) ?? 0) + 값)
    }
  }

  const 없던_것 = 축이_세는_요소.filter((코드) => (횟수.get(코드) ?? 0) === 0)
  if (없던_것.length > 0) return 없던_것.slice(0, 모자란_요소_최대)

  // 전부 한 번 이상 나온 활동. 그래도 「덜 나온 쪽」은 있다.
  const 가장_적은 = Math.min(...축이_세는_요소.map((코드) => 횟수.get(코드) ?? 0))
  return 축이_세는_요소
    .filter((코드) => (횟수.get(코드) ?? 0) === 가장_적은)
    .slice(0, 모자란_요소_최대)
}

// ── 재료 두 벌 ─────────────────────────────────────────────────────────────

/**
 * 말하기 분석 프롬프트에 보낼 user 본문 (명세 5.2 「받는 재료」).
 *
 * 「`metrics` 전부 + `quotes[]` + 아이 이름·나이 + 이야기·장면 이름」 그대로다.
 * **이야기 이름은 `activity.story_title`, 장면 이름은 `quotes[].scene_label`** 이 나르므로
 * 따로 실을 자리를 만들지 않았다.
 *
 * ⚠️ `quotes` 는 `metrics` 안에 이미 있지만 **맨 뒤로 한 번 더 꺼내 놓는다.** 인용 후보가
 * 「이 목록 밖은 인용할 수 없다」는 닫힌 목록이라(`[A-QUOTEID]`) 재료에서도 한 덩이로
 * 보여야 한다.
 */
export function buildReportAnalysisMaterial(args: ReportMaterialArgs): string {
  const { metrics, child } = args

  const 재료: Record<string, unknown> = {
    child: { name: child.name, age: child.age },
    activity: { ...metrics.activity },
    counts: { ...metrics.counts },
    axes: { ...metrics.axes },
    words: { ...metrics.words },
    quotes: metrics.quotes.map((인용) => ({ ...인용 })),
  }

  return materialJson(재료)
}

/**
 * 가정 연계 프롬프트에 보낼 user 본문 (명세 5.4 「받는 재료」).
 *
 * 「장면별 아이 발화(인용 후보) + 이번 활동에서 모자랐던 요소 + 아이 이름·나이」 **셋뿐**이다.
 *
 * ⛔ **숫자·축·낱말을 안 보낸다.** 질문을 짓는 데 필요한 것은 아이가 **한 말**이지
 * 몇 번 했나가 아니고, 명세 5.4 의 재료 목록에도 없다. 토큰도 그만큼 아낀다.
 * ⛔ `story_title` 도 안 보낸다 — 같은 이유이고, 이야기 맥락은 `scene_label` 과 `text` 가
 * 이미 나른다.
 */
export function buildReportGuideMaterial(args: ReportMaterialArgs): string {
  const { metrics, child } = args

  const 재료: Record<string, unknown> = {
    child: { name: child.name, age: child.age },
    missing_elements: 모자란_요소(metrics.axes),
    quotes: metrics.quotes.map((인용) => ({ ...인용 })),
  }

  return materialJson(재료)
}
