// 엔진이 쓰는 영문 값을 **화면에서만** 사람 말로 옮기는 표와 조각 (규칙 1-1).
//
// 🔴 **왜 이 파일이 생겼나** — 회차 진행 화면이 `[분석] [상태] [판정]` 세 줄과 `칸들` 을
//    통째로 찍어서, 운영자에게 `child_intent=OFF_TOPIC` · `detected_elements=[]` ·
//    `reaction_key=playfulUtterance` 같은 글자가 **본문**으로 보이고 있었다.
//    규칙 1-1 은 「예외 없다 — 로그 세 줄도 번역한다」이고, 원문은 규칙 1-4 에 따라
//    「개발자용」 안으로 접는다.
//
// ⛔ **여기에 규칙이 없다.** 값이 무엇인지는 이미 정해져 있고 이 파일은 **이름표만** 붙인다.
//    판정도 계산도 하지 않는다 (경계 6). 표에 없는 코드가 오면 **그 코드를 그대로 보여 준다** —
//    새 값이 생겼을 때 화면이 조용히 거짓말하는 것보다 낫다.
//
// ⛔ **`llm/log.ts` 는 건드리지 않는다** (규칙 1-1 의 맞바꿈). 터미널 로그는 지금 형식
//    그대로 두고, 화면용 문장을 이 층에서 따로 만든다. 개발자가 두 쪽을 대조할 원문은
//    화면마다 「개발자용」 안에 그대로 남는다.
//
// ## 이름표의 출처 (짐작해 적은 것이 하나도 없어야 한다)
//
// | 표 | 어디서 확인했나 |
// |---|---|
// | `진행상태이름` | `llm/db/schema.ts` 의 `story_sessions.status` 검사 제약 |
// | `다음할일이름` | `llm/domain/progress.ts` 의 `Step.kind` 넷 |
// | `단계이름` | `llm/service/run.ts` 의 `PendingStage` 셋 |
// | `의도이름` | `llm/engine/analyze.ts` 의 `의도_값` 13 + `prompts/analysis/보낼것.md` |
// | `유효성이름` | `llm/engine/analyze.ts` 의 `유효성_값` 5 + 같은 프롬프트의 `utterance_validity` 절 |
// | `모드이름` | `llm/domain/decide.ts` + `prompts/character/보낼것.md` 의 `response_mode` 절 |
// | `반응이름` | `prompts/character/보낼것.md` 의 `reaction_key` 절 (일곱 줄 그대로) |
// | `장면끝이름` | `llm/domain/decide.ts` 의 `scene_end_reason` 두 자리 |
// | 사고 요소 8종 | `llm/elements.ts` — **이미 있는 표를 쓴다.** 여기서 다시 짓지 않는다 |

import { elementMeaning, elementName, 요소 } from '@/llm/elements'

import { 값 } from '../ui'

// ═══════════════════════════════════════════════════════════════════════════
// 이름표 — 코드 하나에 사람 말 하나
// ═══════════════════════════════════════════════════════════════════════════

/** `story_sessions.status`. */
export const 진행상태이름: Readonly<Record<string, string>> = {
  in_progress: '진행 중',
  post_activity: '마무리 활동 중',
  completed: '끝남',
  stopped: '중간에 멈춤',
  abandoned: '중간에 멈춤',
}

/** `nextStep()` 이 내는 `Step.kind` 넷. */
export const 다음할일이름: Readonly<Record<string, string>> = {
  장면시작: '다음 장면 시작하기',
  발화받기: '아이가 말할 차례',
  장면끝: '이 장면 마치기',
  회차끝: '이 회차 마치기',
}

/**
 * 끝나지 않은 턴이 멈춘 자리 (`PendingStage`).
 *
 * ⚠️ 셋은 한 턴 안의 **차례**다 — 아이 말을 읽고, 다음 행동을 정하고, 캐릭터가 답한다.
 */
export const 단계이름: Readonly<Record<string, string>> = {
  analysis: '아이 말 읽기',
  decision: '다음 행동 정하기',
  character: '캐릭터 대답 만들기',
}

/** `child_intent` — 아이가 그 말로 **무엇을 하려 했나**. */
export const 의도이름: Readonly<Record<string, string>> = {
  QUESTION: '물어봤습니다',
  OPINION: '자기 생각을 말했습니다',
  REASONING: '까닭을 댔습니다',
  SOLUTION: '어떻게 하면 되는지 방법을 냈습니다',
  DECISION: '둘 중 하나를 골랐습니다',
  PERSPECTIVE: '다른 사람 입장에서 말했습니다',
  EMOTION: '자기 마음을 말했습니다',
  REQUEST: '누구에게 무엇을 해 달라고 했습니다',
  CHALLENGE: '캐릭터 말에 반박했습니다',
  PLAYFUL: '장난으로 말했습니다',
  OFF_TOPIC: '지금 장면과 상관없는 말을 했습니다',
  SHORT_RESPONSE: '「응」·「몰라」처럼 짧게만 답했습니다',
  UNCLEAR: '무슨 말인지 알아듣기 어려웠습니다',
}

/** `utterance_validity` — 그 말에 **이야기를 이어갈 알맹이가 있었나**. */
export const 유효성이름: Readonly<Record<string, string>> = {
  VALID: '생각이 담긴 말',
  SHORT: '짧은 대답뿐',
  UNCLEAR: '뜻을 알기 어려운 말',
  OFF_TOPIC: '장면과 상관없는 말',
  PLAYFUL: '장난으로 한 말',
}

/** `response_mode` — 캐릭터가 이번에 **어떻게 답할 것인가**. */
export const 모드이름: Readonly<Record<string, string>> = {
  NORMAL: '평소대로 답하기',
  GUIDED: '아직 안 나온 것을 끌어내기',
  CLOSING: '장면 마무리하기',
}

/** `reaction_key` — 캐릭터 대답의 **결**. `prompts/character/보낼것.md` 일곱 줄 그대로다. */
export const 반응이름: Readonly<Record<string, string>> = {
  playfulUtterance: '장난을 받아 주기',
  questionFromChild: '아이가 물어본 것에 먼저 답하기',
  proposalFromChild: '아이가 낸 방법을 받아 주고 걱정 하나 얹기',
  unclearUtterance: '짧게 되묻기',
  empathyFromChild: '아이가 알아챈 마음에 마음으로 답하기',
  disagreement: '딱 자르지 않고 걱정 하나 말하기',
  directResponse: '방금 한 말에 그대로 답하기',
}

/**
 * `scene_end_reason` — 장면이 끝난 까닭.
 *
 * ⚠️ 셋째 값 `SKIPPED` 는 `decide()` 가 내지 않는다 — 아이가 대화 장면을 건너뛴 앱이
 *    적는 값이다 (`llm/db/schema.ts` 의 `story_sessions_scene_end_reason_check`).
 */
export const 장면끝이름: Readonly<Record<string, string>> = {
  GOAL_MET: '끌어내려던 것을 다 채웠습니다',
  MAX_TURNS: '정해 둔 최대 차례를 다 썼습니다',
  SKIPPED: '아이가 이 장면을 건너뛰었습니다',
}

/**
 * 표에서 이름표를 찾는다. **없으면 코드를 그대로 준다.**
 *
 * ⚠️ 비어 있으면 `null` 이다 — 「없음」으로 그릴지는 부르는 쪽의 `값` 조각이 정한다 (규칙 2-5).
 */
export function 이름표(
  표: Readonly<Record<string, string>>,
  코드: string | null | undefined,
): string | null {
  if (코드 === null || 코드 === undefined || 코드 === '') return null
  return 표[코드] ?? 코드
}

/** 사고 요소 8종의 코드. 고르는 칸이 쓰는 목록이고, 표는 `llm/elements.ts` 것이다. */
export const 요소_코드들: readonly string[] = Object.keys(요소)

// ═══════════════════════════════════════════════════════════════════════════
// 값 그리기
// ═══════════════════════════════════════════════════════════════════════════

const 칩 = 'rounded-lg bg-chip px-2 py-0.5 text-[13px] font-bold text-ink-mid'

/**
 * 사고 요소 목록을 한국어 이름 칩으로. 비어 있으면 「없음」이다.
 *
 * ⭐ 원문 코드와 정본의 뜻은 **칩에 마우스를 올리면** 뜬다 (규칙 1-1 이 허락한 자리).
 */
export function 요소칩들({ 코드들 }: { 코드들: readonly string[] | null | undefined }) {
  if (코드들 === null || 코드들 === undefined || 코드들.length === 0) {
    return <span className="text-ink-faint">없음</span>
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {코드들.map((코드) => (
        <span key={코드} className={칩} title={`${코드} — ${elementMeaning(코드)}`}>
          {elementName(코드)}
        </span>
      ))}
    </span>
  )
}

/** 분석이 찾아낸 요소들 — 아이 말의 **어느 대목**을 근거로 봤는지까지 함께 보여 준다. */
export function 찾은요소들({
  요소들,
}: {
  요소들: readonly { type: string; evidence: string | null }[] | null | undefined
}) {
  if (요소들 === null || 요소들 === undefined || 요소들.length === 0) {
    return <span className="text-ink-faint">없음</span>
  }
  return (
    <ul className="flex flex-col gap-1">
      {요소들.map((하나, 자리) => (
        <li key={`${하나.type}-${자리}`} className="flex flex-wrap items-baseline gap-2">
          <span className={칩} title={`${하나.type} — ${elementMeaning(하나.type)}`}>
            {elementName(하나.type)}
          </span>
          {하나.evidence !== null && hasText(하나.evidence) && (
            <span className="text-[13px] text-ink-muted">아이 말에서 「{하나.evidence}」</span>
          )}
        </li>
      ))}
    </ul>
  )
}

function hasText(글: string): boolean {
  return 글.trim() !== ''
}

/** 「예 / 아니오」로 읽히는 값. `값` 조각이 참·거짓을 이미 그렇게 그린다. */
export function 예아니오({ 것 }: { 것: boolean }) {
  return <값 것={것} />
}

// ═══════════════════════════════════════════════════════════════════════════
// 「이름 — 값」 표와 묶음
// ═══════════════════════════════════════════════════════════════════════════

export interface 풀이줄 {
  /** 사람이 읽는 이름. */
  이름: string
  /** 마우스를 올리면 뜨는 원래 필드 이름 — 개발자가 대조할 자리다 (규칙 1-1 의 예외). */
  원래?: string
  값: React.ReactNode
}

/** 「이름 — 값」 여러 줄. 12px 를 쓰지 않는다 (규칙 1-3). */
export function 풀이표({ 줄들 }: { 줄들: readonly 풀이줄[] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-5 gap-y-2 text-[14px]">
      {줄들.map((줄) => (
        <div key={줄.이름} className="contents">
          <dt className="whitespace-nowrap text-ink-muted" title={줄.원래}>
            {줄.이름}
          </dt>
          <dd className="text-ink">{줄.값}</dd>
        </div>
      ))}
    </dl>
  )
}

/** 카드 안에서 한 덩이를 다시 가르는 작은 묶음 (규칙 1-2 의 축소판). */
export function 작은묶음({ 제목, 설명, children }: { 제목: string; 설명?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-2xl border border-divider p-4">
      <h4 className="text-[15px] font-extrabold text-ink">{제목}</h4>
      {설명 !== undefined && <p className="text-[13px] text-ink-faint">{설명}</p>}
      {children}
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 세 줄을 사람 말로 — `[분석]` · `[상태]` · `[판정]`
// ═══════════════════════════════════════════════════════════════════════════

/** `[분석]` 줄이 담던 값. `utterance_analyses` 넷 + 후처리가 떨어낸 것. */
export interface 분석값 {
  child_intent: string | null
  main_point: string | null
  detected_elements: readonly { type: string; evidence: string | null }[] | null
  utterance_validity: string | null
  /** 근거를 아이 말에서 못 찾아 떨어낸 요소. 없으면 빈 목록이다. */
  dropped: readonly string[]
}

/** `[상태]` 줄이 담던 값. `missing` 만 저장하지 않고 뺄셈으로 나온 것이다 (경계 5). */
export interface 상태값 {
  current_child_turn_count: number
  accumulated_elements: readonly string[]
  missing_elements: readonly string[]
  last_response_mode: string | null
  turns_without_new_element: number
  consecutive_low_information_turns: number
}

/** `[판정]` 줄이 담던 값 — `decide()` 가 낸 것. */
export interface 판정값 {
  response_mode: string
  guidance_target: string | null
  soft_cue: boolean
  reaction_key: string
  scene_goal_met: boolean
  scene_end_reason: string | null
}

/** `[분석]` — AI 가 아이 말을 어떻게 읽었나. */
export function 말읽기({ 분석 }: { 분석: 분석값 }) {
  return (
    <작은묶음 제목="AI 가 아이 말을 이렇게 읽었습니다">
      <풀이표
        줄들={[
          {
            이름: '무엇을 하려는 말이었나',
            원래: 'child_intent',
            값: <값 것={이름표(의도이름, 분석.child_intent)} 없을때="읽지 못했습니다" />,
          },
          {
            이름: '한 줄로 옮기면',
            원래: 'main_point',
            값: <값 것={분석.main_point} 없을때="한 줄로 옮기지 못했습니다" />,
          },
          {
            이름: '이야기를 이어갈 알맹이',
            원래: 'utterance_validity',
            값: <값 것={이름표(유효성이름, 분석.utterance_validity)} 없을때="아직 안 봤습니다" />,
          },
          {
            이름: '찾아낸 생각 조각',
            원래: 'detected_elements',
            값: <찾은요소들 요소들={분석.detected_elements} />,
          },
          {
            // 근거가 아이 말에 실제로 없으면 떨어낸다 — 없으면 왜 안 쌓였는지 알 수 없다.
            이름: '근거를 못 찾아 뺀 것',
            원래: 'dropped (버림)',
            값: <요소칩들 코드들={분석.dropped} />,
          },
        ]}
      />
    </작은묶음>
  )
}

/** `[상태]` — 이 장면에서 지금까지 쌓인 것. */
export function 쌓인것({ 상태 }: { 상태: 상태값 }) {
  return (
    <작은묶음 제목="이 장면에서 여기까지 쌓였습니다">
      <풀이표
        줄들={[
          {
            // ⚠️ 「몇 번 했나」가 아니라 「이번이 몇 번째인가」다 — 이번 발화를 **포함해** 1부터
            //    센다 (`domain/decide.ts` 머리말의 읽기).
            이름: '이 장면에서 아이가 말한 차례',
            원래: 'current_child_turn_count',
            값: `${상태.current_child_turn_count}번째`,
          },
          {
            이름: '지금까지 모은 생각 조각',
            원래: 'accumulated_elements',
            값: <요소칩들 코드들={상태.accumulated_elements} />,
          },
          {
            이름: '아직 안 나온 생각 조각',
            원래: 'missing_elements',
            값: <요소칩들 코드들={상태.missing_elements} />,
          },
          {
            이름: '직전에 캐릭터가 답한 방식',
            원래: 'last_response_mode',
            값: <값 것={이름표(모드이름, 상태.last_response_mode)} 없을때="아직 없음" />,
          },
          {
            이름: '새 조각이 안 나온 채 이어진 차례',
            원래: 'turns_without_new_element',
            값: `${상태.turns_without_new_element}번`,
          },
          {
            이름: '짧거나 딴소리가 이어진 차례',
            원래: 'consecutive_low_information_turns',
            값: `${상태.consecutive_low_information_turns}번`,
          },
        ]}
      />
    </작은묶음>
  )
}

/** `[판정]` — 그래서 다음에 무엇을 하기로 했나. */
export function 정한것({ 판정 }: { 판정: 판정값 }) {
  return (
    <작은묶음 제목="그래서 이렇게 하기로 정했습니다">
      <풀이표
        줄들={[
          {
            이름: '캐릭터가 답할 방식',
            원래: 'response_mode',
            값: <값 것={이름표(모드이름, 판정.response_mode)} />,
          },
          {
            이름: '이번에 끌어낼 생각 조각',
            원래: 'guidance_target',
            값: <요소칩들 코드들={판정.guidance_target === null ? [] : [판정.guidance_target]} />,
          },
          {
            이름: '살짝만 얹어 볼까',
            원래: 'soft_cue',
            값: <예아니오 것={판정.soft_cue} />,
          },
          {
            이름: '대답의 결',
            원래: 'reaction_key',
            값: <값 것={이름표(반응이름, 판정.reaction_key)} />,
          },
          {
            이름: '끌어낼 것을 다 채웠나',
            원래: 'scene_goal_met',
            값: <예아니오 것={판정.scene_goal_met} />,
          },
          {
            이름: '장면이 끝나는가',
            원래: 'scene_end_reason',
            값: <값 것={이름표(장면끝이름, 판정.scene_end_reason)} 없을때="아직 안 끝납니다" />,
          },
        ]}
      />
    </작은묶음>
  )
}
