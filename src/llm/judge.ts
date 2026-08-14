// 캐릭터 대사가 **경계를 넘었는지** 자동으로 채점한다 (이슈 #26 일감 10 · char 트랙 #22 ③).
//
// 파이썬 `src/goodquestion/scoring.py`(418줄, `rlaqudwn1/character-guidance` 판)를 옮긴 것이다.
//
// # 🔴 `lib/scoring.ts` 와 **다른 파일이다** — 여기서 속기 쉽다
//
// 이름이 닮았지만 하는 일이 전혀 다르다. 8차 인계가 실제로 여기서 한 번 속아
// 「채점기가 절반 왔다」고 잘못 셌다.
//
// | | 원본 | 무엇을 재나 | 정답지 |
// |---|---|---|---|
// | `lib/scoring.ts` | `goldenset.py` | **분석 LLM** 이 라벨을 맞혔나 | 있다 (골든셋) |
// | `lib/judge.ts` (여기) | `scoring.py` | **캐릭터 LLM** 이 경계를 넘었나 | **없어도 된다** |
//
// 대사가 "좋은가"에는 정답이 없다. 정답 대사를 아무도 안 써 뒀기 때문이다.
// 하지만 **"하면 안 되는 짓을 했나"는 정답 없이 판정된다** — `CLAUDE.md` 경계 3·4 가
// 이미 금지 목록을 주고 있어서다. 그래서 이 파일은 정답지를 기다리지 않고 오늘 돈다.
//
// # 파이썬 ↔ 여기
//
// | `scoring.py` | 여기 |
// |---|---|
// | `채점재료` | `JudgeInput` |
// | `채점` · `.위반인가` · `.판정했나` | `CheckResult` · `isViolation()` · `isGraded()` |
// | `위반_수` · `판정한_수` | `violationCount()` · `gradedCount()` |
// | `_뼈대` · `_고정대사가_들어있나` · `_JSON_뽑기` | `skeleton()` · `containsFixedLine()` · `extractJson()` |
// | `고정대사_지어냈나` | `fabricatedFixedLine()` |
// | `종료턴_생성했나` | `closingGenerated()` |
// | `장면목표_누출` | `sceneGoalLeak()` |
// | `_심판` | `runJudge()` |
// | `아이_대신_말했나` | `gaveAwayElement()` |
// | `과녁을_향했나` | `guidedTowardTarget()` |
// | `설정_지어냈나` | `inventedSetting()` |
// | `경계_채점` | `boundaryChecks()` |
//
// # 채점 대상
//
// **캐릭터 LLM 이 생성한 텍스트 한 줄**이다. `story_scenes` 의 고정 대사는 채점 대상이 아니다 —
// 사람이 써서 넣은 문장이라 「경계를 넘었나」를 물을 자리가 아니고, 넣으면 「고정 대사를
// 지어냈나」가 항상 위반으로 나온다 (`CLAUDE.md` 경계 4).
//
// CLOSING 턴은 고정 대사만 재생하므로 **생성된 텍스트가 아예 없다** (결정 36).
// 그 턴에 채점할 대사가 들어온다면 그것 자체가 위반이다(`closing_generated`).
//
// # 점수 규칙
//
// `value` 는 **1.0 = 지켰다 / 0.0 = 넘었다 / null = 판정하지 않았다** 셋뿐이다 (결정 29).
// `null` 은 통과가 아니다. 검사 조건이 아예 성립하지 않았거나 심판을 믿을 수 없었다는 뜻이고,
// 평균에 넣으면 위반율이 조용히 낮아진다. 그래서 `violationCount` / `gradedCount` 가
// `null` 을 빼고 센다.
//
// # ⛔ 이 파일이 모르는 것
//
// DB 도 화면도 모른다. 디스크는 **프롬프트 파일 하나**에만 닿는다(`lib/prompts`).
// 파이썬이 랭퓨즈를 몰랐던 것과 같은 선이다 — 점수를 어디에 남기느냐는 서비스 층 몫이다.

import { type Settings } from '@/llm/config'
import { complete } from '@/llm/provider'
import { chooseBody, sendableBody } from '@/llm/prompts'

/**
 * 장면 목표 누출 판정 기준. 목표 문장의 어절이 이만큼 **연달아** 대사에 나오면 샌 것으로 본다.
 *
 * 2 로 내리면 "숨기고 싶어" 같은 흔한 말에 걸리고, 4 로 올리면 짧은 누출을 놓친다 (결정 30).
 */
export const 연속_어절_기준 = 3

/** 고정 첫 대사에 들어 있는 이름 자리표. 이름이 아니다 (`prompts/character.md`). */
export const 이름_자리표 = 'ㅇㅇ'

/**
 * 띄어쓰기와 문장부호. 파이썬 `_지울_것` 과 **같은 목록**이다.
 *
 * ⚠️ `g` 플래그가 있어야 파이썬 `re.sub` 의 「전부 바꾼다」와 같아진다.
 *    `.replace()` 로만 쓴다 — `.test()` 에 쓰면 `lastIndex` 가 남아 답이 흔들린다.
 */
const 지울_것 = /[\s.,!?…·~"'“”‘’「」『』()[\]\-—]+/g

/** ```` ```json ```` 울타리. 파이썬은 `re.MULTILINE` 이라 여기서는 `m` + `g` 다. */
const 코드블록 = /^```[a-zA-Z]*\n?|```$/gm

/** 심판이 돌려줘야 하는 모양. 세 칸 다 필수다. */
const 심판_스키마: Record<string, unknown> = {
  type: 'object',
  properties: {
    판정: { type: 'string', enum: ['위반', '통과', '판정불가'] },
    근거: { type: 'string' },
    이유: { type: 'string' },
  },
  required: ['판정', '근거', '이유'],
}

/**
 * 대사 한 줄과, 그 대사가 만들어질 때 옆에 있던 값들 (파이썬 `채점재료`).
 *
 * DB 에서 온 값은 컬럼명 그대로 쓴다 (`CLAUDE.md` DB 절 — 변환하지 않는다).
 * 우리가 만든 이름만 한국어다.
 */
export interface JudgeInput {
  대사: string
  response_mode: string
  character_opening?: string | null
  character_closing?: string | null
  scene_goal?: string | null
  child_utterance?: string | null
  /**
   * 심판이 "지어낸 설정"을 가릴 때 대조할 시드 원문.
   * 앞 전개 장면의 scene_description + conflict + persona 를 이어 붙인 것.
   */
  이야기_재료?: string | null
  // ── 과녁 채점용 (`guidedTowardTarget`) ──
  /**
   * `decide()` 가 이번 턴에 고른 유도 대상과, 그 요소가 무엇으로 쳐지는지의 기준 문장.
   *
   * ⛔ 캐릭터 LLM 은 둘 다 못 본다 — 요소 **이름**조차 안 간다(기준 문서 13절).
   *    캐릭터가 받는 것은 `remaining_worries[대상]` 걱정 문장 하나뿐이다.
   *    그래서 이 둘은 채점 쪽에만 있다.
   */
  guidance_target?: string | null
  element_criterion?: string | null
  remaining_worry?: string | null
}

/** 검사 하나의 결과 (파이썬 `채점`). 랭퓨즈 `Evaluation` 과 같은 모양이다(name/value/comment). */
export interface CheckResult {
  name: string
  /** 1.0 지킴 / 0.0 넘음 / null 판정 안 함 */
  value: number | null
  comment: string
}

/** 파이썬 `채점.위반인가`. */
export function isViolation(항목: CheckResult): boolean {
  return 항목.value === 0.0
}

/** 파이썬 `채점.판정했나`. */
export function isGraded(항목: CheckResult): boolean {
  return 항목.value !== null
}

/** 파이썬 `위반_수`. */
export function violationCount(결과: readonly CheckResult[]): number {
  return 결과.filter(isViolation).length
}

/**
 * 판정하지 않은 항목은 빼고 센다 (파이썬 `판정한_수`).
 *
 * 위반율의 **분모**가 되는 값이다.
 */
export function gradedCount(결과: readonly CheckResult[]): number {
  return 결과.filter(isGraded).length
}

// ── 공용 도구 ───────────────────────────────────────────────────

/**
 * 띄어쓰기와 문장부호를 걷어낸 글자만 남긴다 (파이썬 `_뼈대`).
 *
 * LLM 은 같은 말을 하면서 띄어쓰기와 마침표를 자주 바꾼다. 문장부호까지 같아야
 * 걸리는 검사는 "다시 쓰면 안 걸리는" 검사라 쓸모가 없다.
 */
export function skeleton(글: string): string {
  return 글.replace(지울_것, '')
}

/**
 * 파이썬 `str.split()` (인자 없는 판) 과 같다.
 *
 * ⚠️ JS `'  '.split(/\s+/)` 는 빈 조각을 남긴다. 파이썬은 안 남긴다.
 *    이 차이를 안 막으면 `sceneGoalLeak` 이 빈 어절을 세어 값이 갈린다.
 */
function 공백으로_나누기(글: string): string[] {
  const 다듬은 = 글.trim()
  return 다듬은 === '' ? [] : 다듬은.split(/\s+/)
}

/**
 * 고정 대사가 대사 안에 통째로 들어 있는지 본다 (파이썬 `_고정대사가_들어있나`).
 *
 * `ㅇㅇ` 자리표는 아무 이름이나 들어갈 수 있으므로 그 자리를 건너뛰고 조각별로 맞춘다.
 * 이름을 채워 넣었다고 지어내지 않은 것이 되지는 않기 때문이다.
 */
export function containsFixedLine(대사_뼈대: string, 고정: string): boolean {
  const 조각들 = skeleton(고정)
    .split(이름_자리표)
    .filter((조각) => 조각 !== '')
  let 자리 = 0
  for (const 조각 of 조각들) {
    const 찾은_곳 = 대사_뼈대.indexOf(조각, 자리)
    if (찾은_곳 < 0) return false
    자리 = 찾은_곳 + 조각.length
  }
  return 조각들.length > 0
}

/**
 * 심판 응답에서 JSON 을 꺼낸다 (파이썬 `_JSON_뽑기`).
 *
 * 못 꺼내면 `null` 이다 — 예외를 올리지 않는다.
 */
export function extractJson(응답: string): Record<string, unknown> | null {
  const 글 = 응답.replace(코드블록, '').trim()
  const 시작 = 글.indexOf('{')
  const 끝 = 글.lastIndexOf('}')
  if (시작 < 0 || 끝 <= 시작) return null
  let 값: unknown
  try {
    값 = JSON.parse(글.slice(시작, 끝 + 1))
  } catch {
    return null
  }
  // 파이썬 `isinstance(값, dict)` — 배열이나 원시값은 받지 않는다.
  if (typeof 값 !== 'object' || 값 === null || Array.isArray(값)) return null
  return 값 as Record<string, unknown>
}

// ── 검사 1~3. 순수 함수. LLM 을 타지 않는다 ─────────────────────

/**
 * `character_opening` / `character_closing` 을 캐릭터가 만들어 냈나 (파이썬 `고정대사_지어냈나`).
 *
 * 이 둘은 `story_scenes` 에 저장된 고정 텍스트다. 생성하는 것이 아니라 붙이는 것이고,
 * 붙이는 것도 캐릭터 LLM 이 아니다 (`CLAUDE.md` 경계 4).
 */
export function fabricatedFixedLine(재료: JudgeInput): CheckResult {
  const name = 'fabricated_fixed_line'
  const 고정들: readonly (readonly [string, string | null | undefined])[] = [
    ['첫 대사', 재료.character_opening],
    ['마지막 대사', 재료.character_closing],
  ]
  const 있는_것 = 고정들.filter(([, 글]) => 글 !== null && 글 !== undefined && 글.trim() !== '')
  if (있는_것.length === 0) {
    return { name, value: null, comment: '고정 대사가 없는 장면이라 판정하지 않았다' }
  }

  const 대사_뼈대 = skeleton(재료.대사)
  const 걸린_곳 = 있는_것
    .filter(([, 글]) => containsFixedLine(대사_뼈대, 글 as string))
    .map(([자리]) => 자리)
  if (걸린_곳.length > 0) {
    return { name, value: 0.0, comment: `고정 ${걸린_곳.join(' · ')}를 그대로 만들어 냈다` }
  }
  return { name, value: 1.0, comment: '' }
}

/**
 * CLOSING 턴인데 캐릭터가 만든 대사가 있나 (파이썬 `종료턴_생성했나` · `CLAUDE.md` 경계 4).
 *
 * 닫는 턴에는 캐릭터 LLM 을 **아예 부르지 않는다** (결정 36). 그러니 채점할 대사가
 * 있다는 것 자체가 호출이 되살아났다는 신호다.
 *
 * 예전에는 「1문장을 넘겼나」를 셌지만(결정 28), 생성이 사라지면서 셀 것도 사라졌다.
 * 검사를 지우는 대신 **되돌아오는 것을 잡는 검사**로 바꿔 둔다.
 */
export function closingGenerated(재료: JudgeInput): CheckResult {
  const name = 'closing_generated'
  if (재료.response_mode !== 'CLOSING') {
    return { name, value: null, comment: `${재료.response_mode} 턴이라 이 검사를 하지 않았다` }
  }

  if (재료.대사.trim() !== '') {
    return {
      name,
      value: 0.0,
      comment: 'CLOSING 턴인데 대사를 생성했다 (고정 대사만 재생해야 한다)',
    }
  }
  return { name, value: 1.0, comment: '' }
}

/**
 * `scene_goal` 문구가 대사에 새어 나왔나 (파이썬 `장면목표_누출`).
 *
 * `scene_goal` 은 캐릭터에게 **주지 않는 값**이다 (`docs/기준/LLM입출력규격.md:275-278`).
 * 그런데도 문구가 대사에 나오면, 대사가 나쁜 것이 아니라 **재료를 조립하는 쪽이 새고 있다**는
 * 뜻이다. 그래서 이 검사는 대사 품질 검사라기보다 배선 검사에 가깝다.
 */
export function sceneGoalLeak(재료: JudgeInput): CheckResult {
  const name = 'scene_goal_leak'
  const 목표 = 재료.scene_goal
  if (목표 === null || 목표 === undefined || 목표.trim() === '') {
    return { name, value: null, comment: '장면 목표가 없어 판정하지 않았다' }
  }

  // ⚠️ **자른 것과 센 것의 자리가 어긋날 수 있다.** 문장부호만으로 된 어절(`—` 같은)은
  //    뼈대가 빈 문자열이 되어 `어절들` 에서 빠지는데 `날것` 에서는 안 빠진다. 그러면
  //    아래 `샌_말` 이 한 칸씩 밀린다. 파이썬이 그랬고, 이식이라 그대로 뒀다
  //    (`CLAUDE.md` — 옮기는 일과 고치는 일을 같이 하지 않는다). 판정값은 안 흔들린다 —
  //    밀리는 것은 사람이 읽는 `comment` 뿐이다.
  const 날것 = 공백으로_나누기(목표)
  const 어절들 = 날것.map(skeleton).filter((어절) => 어절 !== '')
  if (어절들.length === 0) {
    return { name, value: null, comment: '장면 목표가 없어 판정하지 않았다' }
  }

  const 폭 = Math.min(연속_어절_기준, 어절들.length)
  const 대사_뼈대 = skeleton(재료.대사)
  for (let 자리 = 0; 자리 <= 어절들.length - 폭; 자리 += 1) {
    const 토막 = 어절들.slice(자리, 자리 + 폭).join('')
    if (대사_뼈대.includes(토막)) {
      const 샌_말 = 날것.slice(자리, 자리 + 폭).join(' ')
      return { name, value: 0.0, comment: `장면 목표의 «${샌_말}» 가 대사에 그대로 나왔다` }
    }
  }
  return { name, value: 1.0, comment: '' }
}

// ── 검사 4~6. LLM 심판. 심판도 LLM 이라 못 믿는다 ───────────────

/**
 * 심판을 부르는 함수. 기본은 `lib/llm` 의 `complete()` 다.
 *
 * 파이썬 `호출_함수` 자리 — 검사가 바꿔치기해서 네트워크 없이 **판정 규칙만** 볼 수 있게 둔다.
 */
export type JudgeCall = (
  system: string,
  user: string,
  options: { json_schema: Record<string, unknown>; settings?: Settings; purpose: string },
) => Promise<{ text: string }>

export interface JudgeOptions {
  call?: JudgeCall
  settings?: Settings
  /**
   * 프롬프트 본문을 직접 준다. 안 주면 `prompts/<이름>.md` 를 읽는다.
   * 관리 페이지의 실험 프롬프트가 들어오는 자리다.
   */
  prompt?: string | null
}

/**
 * ⚠️ `complete()` 의 `purpose` 는 **콘솔 로그에만** 간다.
 *
 * 🔴 `llm_calls.purpose` 에는 `IN ('analysis','character')` CHECK 가 걸려 있다
 *    (`db/schema.ts:526` · `sql/001_schema.sql`). 그러니 **심판 호출을 `llm_calls` 에
 *    남기려면 스키마부터 넓혀야 한다.** 파이썬도 심판 호출은 그 표에 안 남겼다.
 *
 * ✅ **2026-08-14 사람이 「지금은 그대로 둔다」로 정했다.** 근거 셋 —
 *    파이썬도 안 남겼고, 콘솔 로그에는 공급자·모델이 그대로 찍혀 `CLAUDE.md` 로그 규칙이
 *    지켜지며, 심판은 기본 꺼짐이라 당장 새는 것이 없다.
 *    ⚠️ 심판을 상시로 켜기로 하면 **그때 이 CHECK 부터 넓혀야 한다** — 안 그러면
 *    비용 화면에서 심판 호출이 통째로 안 보인다.
 */
const 용도_머리 = 'judge:'

function 기본_호출(): JudgeCall {
  return (system, user, options) =>
    complete(system, user, {
      json_schema: options.json_schema,
      settings: options.settings,
      purpose: options.purpose,
    })
}

/**
 * 심판을 한 번 부르고, **그 대답을 다시 검사해서** 채점으로 바꾼다 (파이썬 `_심판` · 결정 29).
 *
 * 심판은 LLM 이라 세 가지로 못 믿는다. 셋 다 위반이 아니라 `null`(판정 불가)로 떨어뜨린다.
 * 위반으로 세면 심판이 헛소리한 만큼 위반율이 부풀고, 통과로 세면 숨는다.
 *
 * 1. 호출 자체가 실패한다 → 판정 불가
 * 2. JSON 이 아닌 말을 한다 → 판정 불가
 * 3. **인용을 지어낸다** → 판정 불가. 위반이라 하면서 대사에 없는 문장을 근거로 대면
 *    그 심판은 대사를 읽지 않은 것이다. 그래서 근거를 대사와 대조한다.
 */
async function runJudge(args: {
  name: string
  프롬프트_이름: string
  사용자_블록: string
  대사: string
  options: JudgeOptions
}): Promise<CheckResult> {
  const { name, 프롬프트_이름, 사용자_블록, 대사, options } = args
  const 호출 = options.call ?? 기본_호출()
  // ⛔ 프롬프트 **글자**는 우리 것이 아니다 (8차 사람 확정). 읽어 보낼 뿐이다.
  //    표식(`<!-- 보내는 것 시작 -->`)이 없으면 `sendableBody` 는 통째로 돌려주므로
  //    오늘 심판 프롬프트 셋에서는 파이썬 `_프롬프트_읽기()` 와 **한 글자도 안 다르다**.
  const system = sendableBody(chooseBody(프롬프트_이름, options.prompt))

  let 응답: { text: string }
  try {
    응답 = await 호출(system, 사용자_블록, {
      json_schema: 심판_스키마,
      settings: options.settings,
      purpose: `${용도_머리}${name}`,
    })
  } catch (오류) {
    // 채점이 파이프라인을 죽이면 안 된다.
    const 사유 =
      오류 instanceof Error ? `${오류.name}: ${오류.message}` : String(오류)
    return { name, value: null, comment: `심판 호출이 실패했다 (${사유})` }
  }

  const 글 = typeof 응답?.text === 'string' ? 응답.text : String(응답)
  const 값 = extractJson(글)
  if (값 === null) {
    return { name, value: null, comment: '심판이 JSON 이 아닌 답을 했다' }
  }

  const 판정 = String(값['판정'] ?? '').trim()
  const 이유 = String(값['이유'] ?? '').trim()
  const 근거 = String(값['근거'] ?? '').trim()

  if (판정 === '통과') {
    return { name, value: 1.0, comment: 이유 }
  }
  if (판정 !== '위반') {
    return {
      name,
      value: null,
      comment: `심판이 판정을 못 했다 (${판정 || '빈 값'}) ${이유}`.trim(),
    }
  }

  if (근거 === '' || !skeleton(대사).includes(skeleton(근거))) {
    return {
      name,
      value: null,
      comment: `심판이 댄 근거가 대사에 없다 — 판정을 믿지 않는다 «${근거}»`,
    }
  }

  return { name, value: 0.0, comment: `${이유} «${근거}»`.trim() }
}

/**
 * 캐릭터가 아이 대신 까닭·마음·방법을 말해 버렸나 (파이썬 `아이_대신_말했나` · `CLAUDE.md` 경계 3).
 */
export async function gaveAwayElement(
  재료: JudgeInput,
  options: JudgeOptions = {},
): Promise<CheckResult> {
  const 사용자_블록 = [
    '[아이가 방금 한 말]',
    재료.child_utterance || '(없음)',
    '',
    '[캐릭터가 한 말 — 채점 대상]',
    재료.대사,
  ].join('\n')
  return runJudge({
    name: 'gave_away_element',
    프롬프트_이름: 'judge_gave_away_element',
    사용자_블록,
    대사: 재료.대사,
    options,
  })
}

/**
 * 이 대사가 아이를 이번 턴의 유도 대상 쪽으로 끌었나 (파이썬 `과녁을_향했나`).
 *
 * 🔴 **이 파일의 다른 검사들과 방향이 반대다.** 나머지는 전부 「하면 안 되는 짓을 했나」인데
 * 이것만 「해야 할 일을 했나」다. 그래서 정답 없이는 못 재고, 재려면 `guidance_target` 과
 * 그 요소의 기준 문장이 있어야 한다.
 *
 * ⚠️ **답을 흘렸는지는 여기서 안 본다.** `gaveAwayElement()` 와 **짝으로** 돌려라.
 * 「과녁 통과 + 답 누출 위반」이 곧 깔때기이고(`docs/조사/좁히기_유도방법.md` 3-2),
 * 한 심판이 둘을 같이 보면 두 축이 섞여 못 가른다.
 *
 * 재료가 모자라면 부르지 않고 `null`(판정 안 함)을 돌려준다 — 과녁이 없는 턴
 * (NORMAL 이고 soft-cue 도 아닌 턴)에는 물음 자체가 성립하지 않는다.
 */
export async function guidedTowardTarget(
  재료: JudgeInput,
  options: JudgeOptions = {},
): Promise<CheckResult> {
  const name = 'guided_toward_target'
  if (!재료.guidance_target || !재료.element_criterion) {
    return { name, value: null, comment: '과녁이 없는 턴이다 (유도 대상 미지정)' }
  }

  const 사용자_블록 = [
    '[이번 턴의 과녁]',
    재료.guidance_target,
    '',
    '[과녁의 기준] — 아이가 이런 말을 하면 과녁을 맞힌 것이다',
    재료.element_criterion,
    '',
    '[캐릭터가 받은 걱정 한 줄] — 이 문장을 캐릭터 말로 바꾸라고 준 것이다',
    재료.remaining_worry || '(없음)',
    '',
    '[아이가 방금 한 말]',
    재료.child_utterance || '(없음)',
    '',
    '[캐릭터가 한 말 — 채점 대상]',
    재료.대사,
  ].join('\n')
  return runJudge({
    name,
    프롬프트_이름: 'judge_guided_toward_target',
    사용자_블록,
    대사: 재료.대사,
    options,
  })
}

/**
 * 시드에 없는 사람·장소·물건·사건을 만들어 냈나
 * (파이썬 `설정_지어냈나` · `prompts/character.md` 「절대 하지 않는 것」).
 */
export async function inventedSetting(
  재료: JudgeInput,
  options: JudgeOptions = {},
): Promise<CheckResult> {
  const name = 'invented_setting'
  const 재료_글 = 재료.이야기_재료
  if (재료_글 === null || 재료_글 === undefined || 재료_글.trim() === '') {
    return { name, value: null, comment: '대조할 시드 재료가 없어 판정하지 않았다' }
  }

  const 사용자_블록 = [
    '[시드에 있는 것 — 이 밖은 전부 지어낸 것이다]',
    재료_글,
    '',
    // 프롬프트가 「아이가 먼저 꺼낸 것을 캐릭터가 받아 말한 것은 지어낸 것이 아니다」라고
    // 시키는데 2026-08-13 까지 이 블록을 안 보냈다. 심판이 아이 말을 못 보니
    // **지킬 수 없는 규칙**이었다. 다른 두 심판은 처음부터 이걸 받는다.
    '[아이가 방금 한 말] — 여기 있는 것을 캐릭터가 받아 말한 것은 지어낸 것이 아니다',
    재료.child_utterance || '(없음)',
    '',
    '[캐릭터가 한 말 — 채점 대상]',
    재료.대사,
  ].join('\n')
  return runJudge({
    name,
    프롬프트_이름: 'judge_invented_setting',
    사용자_블록,
    대사: 재료.대사,
    options,
  })
}

// ── 한꺼번에 돌리기 ─────────────────────────────────────────────

export interface BoundaryChecksOptions extends JudgeOptions {
  /**
   * 심판(LLM)까지 돌릴지. 기본은 **끈다** — 느리고 돈이 들며, 사람 판정과 얼마나 맞는지
   * 아직 대조하지 않았다 (`docs/설계/eval_계획.md` 7장). 순수 검사 셋은 늘 돈다.
   */
  judges?: boolean
  /** 심판별로 프롬프트 본문을 따로 줄 때. 안 주면 파일을 읽는다. */
  prompts?: Partial<Record<'gave_away_element' | 'guided_toward_target' | 'invented_setting', string>>
}

/**
 * 대사 한 줄을 검사 전부에 통과시킨다 (파이썬 `경계_채점`).
 *
 * 🔴 **파이썬과 한 군데 다르다 — 심판이 둘이 아니라 셋이다.**
 *    파이썬 `경계_채점` 은 `과녁을_향했나` 를 **정의만 해 두고 안 불렀다**. 그래서 그 심판이
 *    파이썬에서도 회차에서 한 번도 안 돌았다. 여기서 셋째로 넣는 것은 8차 인계의 지시다 —
 *    「**답 누출과 짝으로 돌려라**. 「과녁 통과 + 답 누출 위반」이 곧 깔때기다」.
 *    과녁이 없는 턴에서는 `guidedTowardTarget` 이 스스로 `null` 로 빠지므로
 *    **호출도 안 늘어난다**(LLM 을 안 탄다).
 *
 * ⚠️ 심판 셋은 **나란히** 부른다. 서로를 안 보기 때문이다 — 순서를 지킬 이유가 없고,
 *    한 턴에 세 번 기다리면 저장이 그만큼 늦어진다.
 */
export async function boundaryChecks(
  재료: JudgeInput,
  options: BoundaryChecksOptions = {},
): Promise<CheckResult[]> {
  const 결과: CheckResult[] = [
    fabricatedFixedLine(재료),
    closingGenerated(재료),
    sceneGoalLeak(재료),
  ]
  if (options.judges !== true) return 결과

  const 공통 = { call: options.call, settings: options.settings }
  const 심판들 = await Promise.all([
    gaveAwayElement(재료, { ...공통, prompt: options.prompts?.gave_away_element ?? null }),
    guidedTowardTarget(재료, { ...공통, prompt: options.prompts?.guided_toward_target ?? null }),
    inventedSetting(재료, { ...공통, prompt: options.prompts?.invented_setting ?? null }),
  ])
  결과.push(...심판들)
  return 결과
}
