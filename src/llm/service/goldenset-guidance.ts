// 유도 정답지 ↔ 경계 심판을 잇는 **다리** (이슈 #26 · char 트랙 #22).
//
// 파이썬 `src/goodquestion/goldenset_유도.py` 의 「── 채점 ──」 절만 옮긴 것이다.
//
// | 파이썬 | 여기 |
// |---|---|
// | `채점재료(항목, 대사)` | `buildJudgeInput()` |
// | `두_심판(항목, 대사, 호출=…, settings=…)` | `twoJudges()` |
// | `깔때기인가(결과)` | `isFunnel()` |
// | `읽기(경로)` 의 **파일 읽는 부분** | `readGuidanceGoldensetFile()` |
//
// # 왜 `lib/goldenset-guidance.ts` 가 아니라 여기인가
//
// 저쪽은 **import 가 하나도 없는 것이 규약**이다 — 글자를 넣으면 값이 나오고, 파일도 LLM 도
// 모른다. 이 다리는 `lib/judge.ts` 를 부르고 그 끝에 LLM 이 있으므로 저 규약을 깬다.
// 그래서 `lib/service/goldenset.ts` 와 같은 층에 둔다 — **파일을 읽고 LLM 을 부르는 층**이다.
//
// # 두 심판은 **짝으로** 돈다
//
// 과녁만 보면 「아이가 「네」라고만 하면 되게 좁혀 준 대사」가 만점을 받는다. 그것이 깔때기고
// (`docs/조사/좁히기_유도방법.md` 3-2), 한 심판이 두 축을 같이 보면 섞여서 못 가른다.
// 그래서 심판을 둘로 갈라 두고, 갈라 둔 값을 `isFunnel()` 이 다시 맞춰 본다.
//
// ⛔ 실험 하네스는 여기 없다 — `tools/유도셋-판.ts`(판_돌리기·재심_돌리기) ·
//    `tools/유도셋-기록.ts`(항목_뽑기·적기) · `tools/유도셋.ts`(CLI) 에 있다.
//    **이 파일은 그것들이 있는 줄 모른다.** 방향은 tools → service 한쪽뿐이다.

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { PROJECT_ROOT, type Settings } from '@/llm/config'
import {
  childUtterance,
  parseGuidanceGoldenset,
  remainingWorry,
  responseMode,
  type GuidanceItem,
} from '@/llm/goldenset-guidance'
import {
  gaveAwayElement,
  guidedTowardTarget,
  type CheckResult,
  type JudgeCall,
  type JudgeInput,
} from '@/llm/judge'

/** 유도 정답지가 있는 곳. `web/` 아래가 아니다 — 파이썬 판과 **같은 파일**을 읽는다. */
export const GUIDANCE_GOLDENSET_PATH = path.join(PROJECT_ROOT, 'goldenset', '유도', '검수전.jsonl')

/**
 * 유도 정답지 한 파일을 읽는다 (파이썬 `읽기()` 의 파일 쪽).
 *
 * 글자를 항목으로 바꾸는 일은 `lib/goldenset-guidance.ts` 가 한다 — 그 파일은 경로를 모른다.
 * 오류 메시지 앞에 붙는 `출처` 는 경로 그대로다 (사람이 그 줄을 열어야 하기 때문).
 */
export function readGuidanceGoldensetFile(
  경로: string = GUIDANCE_GOLDENSET_PATH,
  { 검수완료만 = false }: { 검수완료만?: boolean } = {},
): GuidanceItem[] {
  return parseGuidanceGoldenset(readFileSync(경로, 'utf-8'), 경로, { 검수완료만 })
}

// ═══════════════════════════════════════════════════════════════════════════
// 채점
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 항목과 생성된 대사를 심판이 먹는 모양으로 바꾼다 (파이썬 `채점재료()`).
 *
 * 어느 칸이 어디서 오는지가 이 함수의 전부다 —
 *
 * | `JudgeInput` | 어디서 |
 * |---|---|
 * | `대사` | 캐릭터 LLM 이 방금 낸 것 (인자) |
 * | `response_mode` | `재료.direction.response_mode` |
 * | `child_utterance` | `재료.latest.child_utterance` |
 * | `remaining_worry` | `재료.direction.remaining_worry` — 캐릭터가 **실제로 받은** 걱정 한 줄 |
 * | `guidance_target` | `채점.guidance_target` ⛔ 캐릭터는 못 본다 |
 * | `element_criterion` | `채점.element_criterion` ⛔ 캐릭터는 못 본다 |
 *
 * ⚠️ 나머지 칸(`character_opening`·`scene_goal`·`이야기_재료` …)은 **일부러 안 채운다.**
 *    파이썬도 이 여섯만 넘긴다. 유도 정답지는 고정 대사도 장면 목표도 담지 않으므로
 *    거기 걸린 검사들은 스스로 `null`(판정 안 함)로 빠진다.
 */
export function buildJudgeInput(항목: GuidanceItem, 대사: string): JudgeInput {
  return {
    대사,
    response_mode: responseMode(항목),
    child_utterance: childUtterance(항목),
    guidance_target: 항목.guidance_target,
    element_criterion: 항목.element_criterion,
    remaining_worry: remainingWorry(항목),
  }
}

/** 파이썬 `두_심판(…, 호출=…, settings=…)` 의 키워드 인자 자리. */
export interface TwoJudgesOptions {
  /** 안 주면 진짜 `complete()` 를 탄다. **검사는 반드시 가짜를 꽂는다.** */
  call?: JudgeCall
  settings?: Settings
}

/**
 * 과녁과 답 누출을 **짝으로** 돌린다 (파이썬 `두_심판()`).
 *
 * 둘을 따로 보면 뜻이 없다 — 과녁만 보면 「아이가 「네」라고만 하면 되게 좁혀 준 대사」가
 * 만점을 받는다. 그게 깔때기고, 인계서가 최악이라 부른 자리다.
 *
 * ⚠️ **나란히 부른다.** 두 심판은 서로를 안 보므로 순서를 지킬 이유가 없다
 *    (`judge.boundaryChecks()` 도 그렇게 한다). 돌아오는 **차례는 파이썬과 같다** —
 *    `guided_toward_target` 이 먼저고 `gave_away_element` 가 뒤다.
 *
 * 과녁이 없는 턴이면 `guidedTowardTarget()` 이 스스로 `null` 로 빠져 LLM 을 안 탄다.
 */
export async function twoJudges(
  항목: GuidanceItem,
  대사: string,
  { call, settings }: TwoJudgesOptions = {},
): Promise<CheckResult[]> {
  const 재료 = buildJudgeInput(항목, 대사)
  return Promise.all([
    guidedTowardTarget(재료, { call, settings }),
    gaveAwayElement(재료, { call, settings }),
  ])
}

/**
 * 과녁은 맞혔는데 아이 몫을 없앴다 (파이썬 `깔때기인가()`).
 *
 * 요소는 세어지는데 아이는 생각하지 않는 상태다. **한 축만 보면 못 잡는다** —
 * 과녁 심판에게는 만점짜리 대사이기 때문이다.
 *
 * 정의는 정확히 이것뿐이다: `guided_toward_target === 1.0` **그리고**
 * `gave_away_element === 0.0`. `null`(판정 안 함)은 어느 쪽도 아니므로 깔때기가 아니다.
 */
export function isFunnel(결과: readonly CheckResult[]): boolean {
  // 파이썬 dict 컴프리헨션과 같다 — 같은 이름이 두 번 오면 **뒤엣것이 이긴다.**
  const 점수 = new Map(결과.map((항목) => [항목.name, 항목.value]))
  return 점수.get('guided_toward_target') === 1.0 && 점수.get('gave_away_element') === 0.0
}
