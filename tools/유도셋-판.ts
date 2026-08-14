// 유도 골든셋 하네스 — **판을 돌리고**(대사를 내서 심판을 태우고) **재심을 돈다**(대사는 그대로
// 두고 심판만 다시 태운다).
//
// 파이썬 `src/goodquestion/goldenset_유도.py` 의 두 절(「판 돌리기」·「재심」)을 옮긴 것이다
// (이슈 #26 · char 트랙 #22). CLI 는 `tools/유도셋.ts` 다.
//
// | 파이썬 | 여기 |
// |---|---|
// | `한판` (dataclass) | `RoundResult` |
// | `한판.점수(이름)` | `roundScore()` |
// | `한판.깔때기` (property) | `RoundResult.깔때기` (만들 때 한 번 센다) |
// | `판_합계` (dataclass) | `RoundTotals` |
// | `판_합계.과녁_적중률` | `targetHitRate()` |
// | `판_돌리기()` | `runRound()` |
// | `재심결과` (dataclass) | `RejudgeResult` |
// | `재심결과.뒤집힘` · `.흔들렸나` | `RejudgeResult.뒤집힘` · `.흔들렸나` |
// | `재심결과.표_글()` | `tableText()` |
// | `_표()` | `tally()` |
// | `_다수결()` | `majority()` |
// | `과녁_심판_지문()` | `targetJudgeDigest()` |
// | `재심_돌리기()` | `runRejudge()` |
// | `재심_적기()` | `recordRejudge()` |
//
// 앞선 조각들은 이미 있다. **다시 만들지 않고 부른다** —
// 심판 둘은 `@/llm/service/goldenset-guidance` 의 `twoJudges()`·`isFunnel()`,
// 파일을 고치는 자리는 `tools/유도셋-기록` 의 `rewriteLines()` 다.
//
// ## ⛔ 이 파일은 LLM 을 직접 부르지 않는다
//
// `runRound()` 는 **대사 내는 함수를 인자로 받는다**(`LineMaker`). 진짜로 돌릴 때는
// `engineLineMaker()` 를 넘기고, 검사에서는 가짜를 꽂는다. 심판도 같다 — `call` 을 주면
// 그것을 타고, 안 주면 `lib/judge.ts` 의 기본 호출이 진짜 공급자로 나간다.
// `scoring.ts` 가 랭퓨즈를 모르는 것과 같은 선이다.
//
// ## 🔴 한 항목이 죽어도 판은 안 죽는다 (FR-002)
//
// 실패도 기록이다. 대사를 못 낸 항목은 `대사=null`·`실패="..."` 로 남고 `대사실패` 에 세어진다.
// 스무 항목을 돌리다 열아홉째가 죽었다고 앞의 열여덟을 잃으면 그날 잰 것이 사라진다.
//
// ## 🔴 「판정 못 함」을 0 으로 세지 않는다 (결정 29)
//
// `targetHitRate()` 는 **분모에서 `과녁_못셈` 을 뺀다.** 「모르겠다」와 「틀렸다」를 섞으면
// 숫자가 조용히 낮아지고, 그러면 심판이 흔들린 것과 캐릭터가 못한 것을 못 가른다.

import path from 'node:path'

import type { Settings } from '@/llm/config'
import type { GuidanceItem } from '@/llm/goldenset-guidance'
import type { CheckResult, JudgeCall } from '@/llm/judge'
import { promptsDir } from '@/llm/prompts'
import { fileDigest } from '@/llm/service/goldenset'
import { isFunnel, twoJudges } from '@/llm/service/goldenset-guidance'
import { lineRequest, rewriteLines, type LineMaker } from './유도셋-기록'

/** 로그를 흘려보낼 곳. 안 주면 아무것도 안 찍는다 (파이썬 `찍기=None`). */
export type Printer = (줄: string) => void

// ═══════════════════════════════════════════════════════════════════════════
// ① 판 돌리기
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 항목 하나를 돌린 결과 (파이썬 `한판`).
 *
 * `유도셋-기록.ts` 의 `RoundLine` 을 만족한다 — 그래서 이 값을 그대로 `recordLines()` 에
 * 넘길 수 있다. 저쪽이 통째 타입을 요구하지 않는 것이 그 뜻이었다.
 */
export interface RoundResult {
  항목_id: string
  guidance_target: string
  /** 대사를 못 냈으면 `null`. 그때 `실패` 에 까닭이 있다. */
  대사: string | null
  채점들: readonly CheckResult[]
  /** 대사를 냈으면 빈 글자다 (파이썬 기본값과 같다). */
  실패: string
  /**
   * 과녁은 맞혔는데 아이 몫을 없앴나 (파이썬 `한판.깔때기` 프로퍼티).
   *
   * ⚠️ 파이썬은 볼 때마다 다시 셌고 여기서는 **만들 때 한 번** 센다. `채점들` 이 바뀌지
   * 않으므로 값은 같다 — 이 판은 만들고 나서 안 고친다.
   */
  깔때기: boolean
}

/** 채점 목록에서 이름으로 값 하나 (파이썬 `한판.점수()`). 없으면 `null` — 판정 안 한 것과 같다. */
export function roundScore(한: Pick<RoundResult, '채점들'>, 이름: string): number | null {
  return 한.채점들.find((하나) => 하나.name === 이름)?.value ?? null
}

/**
 * 한 판의 셈 (파이썬 `판_합계`).
 *
 * ⚠️ **이 숫자는 심판을 믿는다는 전제 위에 있다.** 심판이 사람과 얼마나 맞는지는
 * `judgeAgreement()` 가 따로 낸다. 그 대조를 하기 전에는 **판 사이 비교로만** 쓸 것 —
 * 절대값으로 「유도가 N% 된다」고 말하지 말 것.
 */
export interface RoundTotals {
  돌린수: number
  과녁_성공: number
  과녁_실패: number
  과녁_못셈: number
  누출_위반: number
  깔때기: number
  대사실패: number
}

/**
 * 과녁 적중률 (파이썬 `판_합계.과녁_적중률`).
 *
 * 🔴 **분모에서 「판정 못 함」을 뺀다** (결정 29 — 평균에 넣으면 조용히 낮아진다).
 * 잰 것이 하나도 없으면 `null` 이다. **0% 가 아니다** — 0% 는 「다 빗나갔다」는 뜻이라
 * 「아무것도 못 쟀다」와 정반대의 말이 된다.
 */
export function targetHitRate(합계: Pick<RoundTotals, '과녁_성공' | '과녁_실패'>): number | null {
  const 분모 = 합계.과녁_성공 + 합계.과녁_실패
  return 분모 === 0 ? null : 합계.과녁_성공 / 분모
}

export interface RunRoundOptions {
  /**
   * `대사_내기(system, user)`. **밖에서 받는다** — 이 모듈이 LLM 을 직접 부르지 않는 구조다.
   * 진짜로 돌릴 때는 `engineLineMaker()`, 검사에서는 가짜를 꽂는다.
   */
  대사_내기: LineMaker
  /** 심판을 부르는 함수. 안 주면 진짜 공급자로 나간다. **검사는 반드시 가짜를 꽂는다.** */
  call?: JudgeCall
  settings?: Settings
  찍기?: Printer
}

/** 로그에 찍는 과녁 판정 낱말 (파이썬 `표 = {1.0: "적중", 0.0: "빗나감", None: "판정불가"}`). */
function 과녁_낱말(점수: number | null): string {
  if (점수 === 1.0) return '적중'
  if (점수 === 0.0) return '빗나감'
  return '판정불가'
}

/**
 * 항목마다 대사를 하나 만들고 두 심판을 돌린다 (파이썬 `판_돌리기()`).
 *
 * ⚠️ **한 항목이 죽어도 판 전체를 죽이지 않는다** — 실패도 기록이다 (FR-002).
 *
 * ⚠️ **차례로 돈다.** 파이썬과 같다. 한꺼번에 던지면 분당 문지기(`llm_rpm`)가 뒤에서
 * 재우기만 할 뿐 순서가 뒤섞여, 어느 항목에서 무엇이 났는지 로그로 못 따라간다.
 *
 * 🔴 **`lineRequest()` 에 프롬프트를 안 넘긴다 — 파이썬 그대로다.** `--프롬프트` 로 준
 * 실험 본문은 `대사_내기`(= `engineLineMaker({ prompt })`) 안에서 **system 에만** 닿고,
 * 여기서 만드는 `user` 는 `prompts/character.md` 의 재료 틀로 지어진다.
 * ⛔ **일부러 안 고쳤다.** 옮기는 일과 고치는 일을 같이 하면 숫자가 달라졌을 때 원인을
 * 못 가른다 (`CLAUDE.md` 경계 2). 오늘 실험 본문은 재료 틀을 안 건드리므로 결과는 같다.
 */
export async function runRound(
  항목들: readonly GuidanceItem[],
  { 대사_내기, call, settings, 찍기 }: RunRoundOptions,
): Promise<{ 결과들: RoundResult[]; 합계: RoundTotals }> {
  const 결과들: RoundResult[] = []
  const 합계: RoundTotals = {
    돌린수: 0,
    과녁_성공: 0,
    과녁_실패: 0,
    과녁_못셈: 0,
    누출_위반: 0,
    깔때기: 0,
    대사실패: 0,
  }

  for (const 항목 of 항목들) {
    합계.돌린수 += 1
    const { system, user } = lineRequest(항목)

    let 대사: string
    try {
      대사 = await 대사_내기(system, user)
    } catch (오류) {
      // 한 줄이 죽어도 판은 계속 돈다.
      const 사유 = 오류 instanceof Error ? `${오류.name}: ${오류.message}` : String(오류)
      합계.대사실패 += 1
      결과들.push({
        항목_id: 항목.id,
        guidance_target: 항목.guidance_target,
        대사: null,
        채점들: [],
        실패: 사유,
        깔때기: false,
      })
      찍기?.(`[유도셋] ${항목.id} 대사 실패 — ${사유}`)
      continue
    }

    const 채점들 = await twoJudges(항목, 대사, { call, settings })
    const 한: RoundResult = {
      항목_id: 항목.id,
      guidance_target: 항목.guidance_target,
      대사,
      채점들,
      실패: '',
      깔때기: isFunnel(채점들),
    }
    결과들.push(한)

    const 과녁 = roundScore(한, 'guided_toward_target')
    if (과녁 === 1.0) 합계.과녁_성공 += 1
    else if (과녁 === 0.0) 합계.과녁_실패 += 1
    else 합계.과녁_못셈 += 1
    if (roundScore(한, 'gave_away_element') === 0.0) 합계.누출_위반 += 1
    if (한.깔때기) 합계.깔때기 += 1

    찍기?.(
      `[유도셋] ${항목.id} 과녁=${항목.guidance_target} ` +
        `${과녁_낱말(과녁)}${한.깔때기 ? ' ⚠️깔때기' : ''} «${대사.slice(0, 40)}»`,
    )
  }

  return { 결과들, 합계 }
}

// ═══════════════════════════════════════════════════════════════════════════
// ② 재심 — 심판을 고치고 **같은 대사를** 다시 판정한다
// ═══════════════════════════════════════════════════════════════════════════

/** 대사 하나를 새 심판으로 다시 판정한 것 (파이썬 `재심결과`). 옛 판정을 나란히 들고 있다. */
export interface RejudgeResult {
  항목_id: string
  대사: string
  옛_과녁: string
  새_과녁: string
  옛_답누출: string
  새_답누출: string
  /** 반복해 돌렸을 때 각 판정이 몇 번 나왔나. 흔들림이 여기 보인다. */
  과녁_표: Readonly<Record<string, number>>
  답누출_표: Readonly<Record<string, number>>
  /** 파이썬 `재심결과.뒤집힘` 프로퍼티. */
  뒤집힘: boolean
  /** 한 번이라도 다른 답이 나왔나 (파이썬 `.흔들렸나`). **심판을 못 믿는다는 신호다.** */
  흔들렸나: boolean
}

/** 판정마다 몇 번 나왔나 (파이썬 `_표()`). 열쇠 차례는 **처음 나온 차례**다 (파이썬 dict 와 같다). */
export function tally(값들: readonly string[]): Record<string, number> {
  const 모음: Record<string, number> = {}
  for (const 값 of 값들) 모음[값] = (모음[값] ?? 0) + 1
  return 모음
}

/**
 * 제일 많이 나온 판정 (파이썬 `_다수결()`).
 *
 * 🔴 **동점이면 `판정불가`** 다 — 심판이 안 정한 것이다. 반올림해서 한쪽에 붙이지 않는다.
 * 「모르겠다」와 「틀렸다」를 섞지 않는 것이 이 레포의 셈법이다 (결정 29).
 * 최다가 하나면 그것이고, 최다가 둘 이상이면 `판정불가`. (2 대 1 이면 많은 쪽이 이긴다.)
 *
 * ⚠️ **빈 목록이면 `판정불가` 다.** 파이썬은 `max()` 가 터졌다. 부르는 자리
 * (`runRejudge()`)가 `반복 >= 1` 을 보장해 실제로는 안 오는 값이고, 여기서 터뜨려 봐야
 * 판 전체가 죽을 뿐이라 「안 정했다」로 떨어뜨린다. **일부러 갈라 둔 자리다.**
 */
export function majority(값들: readonly string[]): string {
  const 표 = tally(값들)
  const 짝들 = Object.entries(표)
  if (짝들.length === 0) return '판정불가'
  const 최다 = Math.max(...짝들.map(([, 수]) => 수))
  const 이긴것 = 짝들.filter(([, 수]) => 수 === 최다)
  return 이긴것.length === 1 ? 이긴것[0][0] : '판정불가'
}

/** `과녁 적중×2 빗나감×1 · 답누출 지킴×3` (파이썬 `재심결과.표_글()`). */
export function tableText(한: Pick<RejudgeResult, '과녁_표' | '답누출_표'>): string {
  // 파이썬 `sorted(…, key=lambda 짝: -짝[1])` — 많은 순, 같으면 처음 나온 차례.
  // 자바스크립트 `sort` 도 안정 정렬이라 (ES2019) 같은 뜻이다.
  const 한줄 = (표: Readonly<Record<string, number>>): string =>
    Object.entries(표)
      .sort((가, 나) => 나[1] - 가[1])
      .map(([값, 수]) => `${값}×${수}`)
      .join(' ')
  return `과녁 ${한줄(한.과녁_표)} · 답누출 ${한줄(한.답누출_표)}`
}

/**
 * 과녁 심판 프롬프트의 지문 (파이썬 `과녁_심판_지문()`).
 *
 * 어느 심판으로 낸 판정인지를 `판정대기.심판_지문` 에 박제한다. 캐릭터 쪽 지문
 * (`characterPromptDigest()`)과 **다른 파일**이다 — 그 둘을 섞으면 무엇을 고쳐서
 * 숫자가 움직였는지 못 가른다.
 */
export function targetJudgeDigest(): string {
  return fileDigest(path.join(promptsDir(), 'judge_guided_toward_target.md'))
}

/** 채점 하나의 값을 심판이 쓰는 낱말로 (파이썬 `_판정값()`). `null` 은 **판정불가**다 (결정 29). */
function 판정값(점수: number | null, 좋음: string, 나쁨: string): string {
  if (점수 === 1.0) return 좋음
  if (점수 === 0.0) return 나쁨
  return '판정불가'
}

export interface RunRejudgeOptions {
  /** 대사 하나를 몇 번 판정하고 다수결을 취할까. 1 미만은 1 로 본다. */
  반복?: number
  call?: JudgeCall
  settings?: Settings
  찍기?: Printer
}

/**
 * 이미 나온 대사들을 **다시 짓지 않고** 심판만 다시 돌린다 (파이썬 `재심_돌리기()`).
 *
 * 심판 프롬프트를 고쳤을 때 그 효과를 보는 길이다. 판을 다시 돌리면 캐릭터 LLM 이
 * **다른 대사**를 내놓아 사람 판정이 붙은 대사가 사라지고, 그러면 `judgeAgreement()` 의
 * 분모가 비어 **심판을 고친 효과를 못 잰다.** 여기서는 대사를 고정해 심판만 바꾼다.
 *
 * ⚠️ 두 심판을 **짝으로** 다시 돌린다. 과녁 심판만 고쳤어도 그렇게 한다 —
 * 깔때기(「과녁 통과 + 답누출 위반」)는 두 판정이 **같은 회차**의 것일 때만 뜻이 있다.
 * 덤으로, 안 고친 답누출 축이 얼마나 흔들리는지가 곧 심판 자체의 흔들림이다.
 *
 * ⭐ **`반복` 을 2 이상으로 두면 같은 대사를 여러 번 판정하고 다수결을 취한다.**
 * 2026-08-13 에 이것 때문에 데었다 — 프롬프트를 **안 고치고** 다시 돌렸는데 대조가
 * 80% 에서 60% 로 떨어졌다. 한 번 돌린 대조는 심판의 흔들림과 프롬프트의 효과를 못 가른다.
 * 표(`과녁_표`)를 함께 남기므로 **얼마나 흔들리는지 자체가 값**이 된다.
 */
export async function runRejudge(
  항목들: readonly GuidanceItem[],
  { 반복 = 1, call, settings, 찍기 }: RunRejudgeOptions = {},
): Promise<RejudgeResult[]> {
  const 결과들: RejudgeResult[] = []
  const 횟수 = Math.max(1, 반복)

  for (const 항목 of 항목들) {
    for (const 대기 of 항목.대기들) {
      if (!대기.대사) continue

      const 과녁들: string[] = []
      const 누출들: string[] = []
      for (let 번 = 0; 번 < 횟수; 번 += 1) {
        const 채점들 = await twoJudges(항목, 대기.대사, { call, settings })
        const 점수 = new Map(채점들.map((하나) => [하나.name, 하나.value]))
        과녁들.push(판정값(점수.get('guided_toward_target') ?? null, '적중', '빗나감'))
        누출들.push(판정값(점수.get('gave_away_element') ?? null, '지킴', '위반'))
      }

      const 과녁_표 = tally(과녁들)
      const 답누출_표 = tally(누출들)
      const 새_과녁 = majority(과녁들)
      const 새_답누출 = majority(누출들)
      const 한: RejudgeResult = {
        항목_id: 항목.id,
        대사: 대기.대사,
        옛_과녁: 대기.심판_과녁,
        새_과녁,
        옛_답누출: 대기.심판_답누출,
        새_답누출,
        과녁_표,
        답누출_표,
        뒤집힘: 대기.심판_과녁 !== 새_과녁 || 대기.심판_답누출 !== 새_답누출,
        흔들렸나: Object.keys(과녁_표).length > 1 || Object.keys(답누출_표).length > 1,
      }
      결과들.push(한)

      if (찍기) {
        const 표시 = 한.뒤집힘 ? '↻' : ' '
        const 흔들림 = 한.흔들렸나 ? ' 〰흔들림' : ''
        찍기(
          `[재심]${표시} ${항목.id} 과녁 ${대기.심판_과녁}→${한.새_과녁} · ` +
            `답누출 ${대기.심판_답누출}→${한.새_답누출}${흔들림} «${대기.대사.slice(0, 32)}»`,
        )
        if (횟수 > 1) 찍기(`        ${tableText(한)}`)
      }
    }
  }

  return 결과들
}

export interface RecordRejudgeOptions {
  돌린날: string
  /** `targetJudgeDigest()` 의 앞머리. 어느 심판으로 낸 판정인지. */
  심판_지문?: string
}

/**
 * 새 판정으로 덮고 **옛 판정은 `옛심판` 으로 내려 둔다** (파이썬 `재심_적기()`). 고친 줄 수를 준다.
 *
 * 지우지 않는 이유는 `recordHumanVerdict({ 덮어쓰기: true })` 와 같다 —
 * 무엇이 왜 뒤집혔는지가 곧 기록이고, 심판을 고친 효과가 그 차이이기 때문이다.
 * 그래서 `옛심판` 은 **쌓인다.** 재심을 여섯 번 돌면 여섯 줄이다.
 */
export function recordRejudge(
  경로: string,
  결과들: readonly RejudgeResult[],
  { 돌린날, 심판_지문 = '' }: RecordRejudgeOptions,
): number {
  const by_id = new Map<string, RejudgeResult[]>()
  for (const 한 of 결과들) {
    const 몫 = by_id.get(한.항목_id)
    if (몫 === undefined) by_id.set(한.항목_id, [한])
    else 몫.push(한)
  }

  return rewriteLines(경로, (자료) => {
    const 몫 = by_id.get(String(자료.id ?? ''))
    if (몫 === undefined || 몫.length === 0) return null

    const 새것_by_대사 = new Map(몫.map((한) => [한.대사, 한]))
    const 대기들 = Array.isArray(자료.판정대기) ? [...(자료.판정대기 as unknown[])] : []
    let 바뀜 = false

    for (const 것 of 대기들) {
      if (typeof 것 !== 'object' || 것 === null) continue
      const 대기 = 것 as Record<string, unknown>
      const 한 = 새것_by_대사.get(String(대기.대사 ?? ''))
      if (한 === undefined) continue

      const 옛_지문 = String(대기.심판_지문 ?? '')
      const 옛_표 = String(대기.심판_표 ?? '')
      const 옛줄 =
        `[${String(대기.돌린날 ?? '')} 과녁=${한.옛_과녁} 답누출=${한.옛_답누출}` +
        ` 심판지문=${옛_지문 || '(안 적힘)'}` +
        (옛_표 ? ` 표: ${옛_표}` : '') +
        ']'

      대기.옛심판 = [...(Array.isArray(대기.옛심판) ? (대기.옛심판 as unknown[]) : []), 옛줄]
      대기.심판_과녁 = 한.새_과녁
      대기.심판_답누출 = 한.새_답누출
      대기.돌린날 = 돌린날
      대기.심판_지문 = 심판_지문
      대기.심판_표 = tableText(한)
      바뀜 = true
    }

    if (!바뀜) return null
    자료.판정대기 = 대기들
    return 자료
  })
}
