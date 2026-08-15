// 보호자 리포트 지표 집계 — **순수 함수만** (이슈 #36 · 명세 `docs/보호자_리포트_명세.md` 4절).
//
// 읽어 온 DB 행들을 받아 `ReportMetrics` 하나를 돌려준다. **같은 입력이면 언제나 같은 출력**이다.
//
// ⛔ DB 도 LLM 도 시각도 난수도 모른다 (`src/report/README.md` 층 표 · `src/session/README.md`
//    와 같은 규칙). `Date.now()` 를 부르지 않고, 행을 읽지 않으며, 아무것도 저장하지 않는다.
//    필요한 값은 전부 인자로 받는다.
//
// ## 이름에 대해
//
// 함수 이름은 영어다 — 옆의 도메인 셋(`llm/domain/decide.ts` · `progress.ts` · `mission.ts`)과
// 같은 결이다. **DB 컬럼 이름(`turn_order`·`child_intent`·`scene_order`…)은 그대로 두고**
// 안쪽 헬퍼와 주석은 한국어다. 그래서 한 객체 안에 영어와 한국어가 섞인다 — 그게 맞다.
//
// ## 이 파일이 정하는 것 / 정하지 않는 것
//
// - 정한다: 무엇을 몇 번 셌나. 축 다섯의 점수. 인용 후보 목록.
// - 정하지 않는다: 정규화(프론트가 `max(axes[*].score)` 로 그린다) · 문장(LLM #37) ·
//   저장과 배선(#38).

import type { Axis, AxisName, Quote, ReportMetrics } from '../types'

// ═══════════════════════════════════════════════════════════════════════════
// 조정할 수 있는 상수 — 🔴 실측 없이 정한 임의값이다 (명세 4.2 · 위험 M1)
//
// 목데이터 10명(#40)을 돌려 본 뒤 고친다. 그때 **고칠 자리가 이 위쪽 묶음 하나**여야 해서
// 함수 안에 숫자를 흩지 않고 여기 이름을 붙여 세워 둔다.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 축 → 그 축에 묶인 사고 요소 (명세 4.2 표 · 결정 R17).
 *
 * 「상호작용」만 요소가 아니라 대화 지표다(결정 R4). 값이 빈 배열인 것은 **빠뜨린 게 아니라**
 * 요소로 세지 않는다는 뜻이고, 아래 `상호작용_점수칸` 이 그 자리를 대신 채운다.
 */
export const 축_요소: Readonly<Record<AxisName, readonly string[]>> = {
  관점과공감: ['PERSPECTIVE', 'EMPATHY'],
  감정표현: ['EMOTION'],
  생각과이유: ['DECISION', 'REASON'],
  결과와해결: ['SOLUTION', 'RESULT'],
  상호작용: [],
}

/**
 * 어느 축에도 안 들어가는 사고 요소.
 *
 * 🔴 **빠뜨린 게 아니라 일부러 뺐다** (결정 R4 — 「요청」은 시안 다섯 축 어디와도 뜻이
 * 어긋나서 쓰지 않기로 했다). 목록으로 세워 두는 이유는 두 가지다.
 *
 * 1. 읽는 사람이 「8종 중 7종만 있네, 흘렸나?」 하고 멈추지 않는다.
 * 2. `tests/report-metrics.test.ts` 가 `축_요소` + 이 목록 = 8요소 전부인지 기계로 잰다.
 *    나중에 요소가 늘면 그 검사가 먼저 빨개진다 — 조용히 안 세는 요소가 생기지 않는다.
 */
export const 축밖_요소: readonly string[] = ['REQUEST']

/**
 * 「상호작용」 점수를 만드는 대화 지표 셋 (명세 4.2 · 결정 R4 · 실측 뒤 셋째 항 추가).
 *
 * 점수 = 여기 적힌 칸들의 **단순 합**이다. 가중치를 두지 않는다.
 *
 * ## 🔴 셋째 항(`soft_cue_answered`)이 왜 붙었나 — 2026-08-15 목데이터 실측
 *
 * 원래 둘(`child_questions` + `reprompt_recovered`)뿐이었는데 목데이터 활동 12건을 재 보니
 * **점수가 거꾸로 섰다.** `reprompt_recovered` 는 「캐릭터가 다시 물어봐 준 다음 턴에
 * 살아났나」라서 **먼저 헤매야 얻는 점수**다. 그래서 —
 *
 * | 아이 | 다른 네 축 | 옛 상호작용 |
 * |---|---|---|
 * | 민서 (가장 풍부하게 말함) | 7~9 | **0** |
 * | 서준 (짧게만 답함) | 2~3 | 2 |
 * | 시우 (3마디 하고 중단) | 전부 0 | 1 |
 *
 * 처음부터 잘 답한 아이는 영영 0 이고, 오각형이 「말을 잘한 아이일수록 주고받기가 낮다」로
 * 그려졌다. 12건 22점 중 20점이 회복이라 사실상 한 항짜리 축이기도 했다.
 *
 * 셋째 항은 **헤매지 않아도 얻는 주고받기**를 센다. 캐릭터는 아이가 잘 답했을 때도 대화를
 * 잇기 위해 걱정·궁금함을 한 줄 얹는데(soft-cue · `src/llm/domain/decide.ts:255`), 거기에
 * 곧바로 반응한 발화다. 실측에서 민서 0 → 8 로 올라오고 순서가 바로 섰다.
 *
 * ⛔ **가중치를 곱해 단위를 맞추지 않았다.** 다른 네 축이 전부 「그런 말을 한 발화 수」라는
 *    같은 뜻의 정수라서, 셋째 항도 **세는 것**이어야 그 결이 안 깨진다.
 */
export const 상호작용_점수칸 = [
  'child_questions',
  'reprompt_recovered',
  'soft_cue_answered',
] as const

/**
 * 담기만 하고 **점수에 넣지 않는** 칸 (`Axis.context`).
 *
 * `child_turns` 를 점수에 넣으면 말수가 많을수록 커져서 「주고받았나」가 아니라
 * 「많이 말했나」를 재게 된다 (명세 4.2).
 */
export const 상호작용_참고칸 = ['child_turns'] as const

// ═══════════════════════════════════════════════════════════════════════════
// 받는 것 — 실제 표의 모양 그대로
//
// 칸 이름은 DB 컬럼 그대로다(`CLAUDE.md` DB 절 — 변환 층을 두지 않는다).
// 실제로 넘어오는 행에는 칸이 더 많지만, 이 층은 여기 적힌 것 말고 아무것도 보지 않는다.
// ═══════════════════════════════════════════════════════════════════════════

/** 시각 한 칸. 드리즐은 `Date` 로 주지만 손으로 만든 검사는 글자로 주는 게 편하다. */
export type 시각 = Date | string

/** `story_sessions` 한 행 중 이 층이 보는 칸 (`src/llm/db/schema.ts:276`). */
export interface 세션행 {
  status: string
  started_at: 시각
  /** 끝나지 않은 활동은 `null` 이다 — 그때 길이는 `last_activity_at` 까지로 잰다. */
  completed_at: 시각 | null
  last_activity_at: 시각
}

/** `stories` 한 행 중 이 층이 보는 칸 (`:100` 언저리). */
export interface 이야기행 {
  slug: string
  title: string
}

/** `story_scenes` 한 행 중 이 층이 보는 칸 (`:176`). */
export interface 장면행 {
  id: string
  code: string
  scene_order: number
  /**
   * #35(P-1)가 붙이는 칸이다 — **이 브랜치의 `schema.ts` 에는 아직 없다.**
   * 그래서 선언을 고치지 않고 여기 인자 쪽에만 모양을 적어 둔다 (명세 6.3).
   */
  vocabulary?: readonly { word: string; meaning: string }[] | null
  /**
   * 화면에 찍을 장면 이름 (`"들켜버린 큰 방귀"`).
   *
   * ⚠️ `story_scenes` 에 **이런 칸이 없다.** 지금 이 이름을 들고 있는 곳은 말하기 후 활동의
   *    카드 목록(`src/stories/fart-bride/minigame/finale-script.ts`)뿐이고 장면 코드와
   *    이어져 있지 않다. 그래서 이 층은 **부르는 쪽이 알면 준다** 로 두고, 없으면
   *    `scene_label` 을 「장면 N」까지만 만든다 (아래 `장면라벨()`).
   */
  name?: string | null
}

/** `messages` 한 행 중 이 층이 보는 칸 (`:329`). */
export interface 발화행 {
  id: string
  scene_id: string
  /** `'child' | 'character' | 'system'` — 이 층은 `'child'` 만 센다 */
  speaker_type: string
  /** 세션 전체를 통틀어 몇 번째 발화인지 (장면별이 아니다) */
  turn_order: number
  text: string
}

/** 분석 LLM 이 채우는 네 칸 (`utterance_analyses:368` · `mission_messages.analysis` 사본). */
export interface 분석 {
  /** 13종. 이 층은 `'QUESTION'` 만 따로 센다 */
  child_intent: string
  /**
   * `[{ type: 'REASON', evidence: '억울하니까' }, …]`
   *
   * ⚠️ `evidence` 는 **`null` 일 수 있다.** 빈 문자열로 바꾸지 않는다 — 이 층은 `type` 만
   *    보지만, 모양을 흘리면 위층이 「안 줬다」와 「빈칸이다」를 못 가른다.
   */
  detected_elements: readonly { type: string; evidence: string | null }[]
  /** `'VALID' | 'SHORT' | 'UNCLEAR' | 'OFF_TOPIC' | 'PLAYFUL'` */
  utterance_validity: string
}

/** `utterance_analyses` 한 행 — 아이 메시지 한 건당 한 행이다 (`:368`). */
export interface 분석행 extends 분석 {
  message_id: string
}

/** `gq_admin.turn_conditions` 한 행 중 이 층이 보는 칸 (`:805`). */
export interface 턴조건행 {
  /** PK — 턴당 한 행이라 아이 메시지 하나에 판정 하나다 */
  message_id: string
  /** `'NORMAL' | 'GUIDED' | 'CLOSING'` (`src/llm/domain/decide.ts:99`) */
  response_mode: string
  /**
   * 이번 턴의 캐릭터 대사가 **끌어내려 한 사고 요소** (`'EMPATHY'`·`'SOLUTION'`…).
   * `GUIDED`(대놓고 다시 물음)와 soft-cue(걱정 한 줄 얹음) 둘 다 여기에 남는다.
   *
   * ⚠️ **부르는 쪽이 알면 준다.** `src/report/repo/materials.ts` 는 준다. `seed-report-mock.ts`
   *    의 `--metrics` 는 옛 두 칸만 뽑아서 안 준다 — 그때는 `soft_cue_answered` 가 0 이 된다.
   */
  guidance_target?: string | null
  /**
   * 이 턴의 캐릭터 대사에 **걱정 한 줄(soft-cue)이 얹혔나** (`src/llm/domain/decide.ts:255`).
   *
   * `response_mode === 'NORMAL'` 이면서 아이가 새 요소를 말했고 아직 못 채운 요소가 남았을 때
   * 참이다. 즉 **아이가 잘 답한 턴에만 선다** — 헤맨 턴은 `GUIDED` 로 갈라진다.
   *
   * ⚠️ 위 `guidance_target` 과 같은 이유로 없을 수 있다.
   */
  soft_cue?: boolean
}

/**
 * 미션 시도 한 건 — `mission_sessions` 와 `story_missions` 를 합쳐 이 층이 보는 만큼만.
 *
 * 두 표를 하나로 접은 이유: 이 층이 미션 발화에서 알아야 하는 것은 「어느 대화 장면에
 * 끼어든 미션인가」와 「미션 이름이 무엇인가」 둘뿐이고, 조인은 부르는 쪽(#38)이 한다.
 */
export interface 미션시도행 {
  /** `mission_sessions.id` — `미션발화행.mission_session_id` 가 가리키는 값 */
  id: string
  /** `story_missions.scene_id` — 이 미션이 끼어든 대화 장면 */
  scene_id: string
  /** `story_missions.title` — 예: `"배 따기"` */
  title: string
}

/** `mission_messages` 한 행 중 이 층이 보는 칸 (`:521`). */
export interface 미션발화행 {
  id: string
  mission_session_id: string
  /** 미션 안 순번 (세션 전체 순번이 아니다) */
  turn_order: number
  speaker_type: string
  text: string
  /** 아이 행에만 있다. `utterance_analyses` 네 칸의 jsonb 사본이다 */
  analysis: 분석 | null
}

/** `aggregateMetrics()` 가 받는 재료 한 덩이. 전부 **읽어 온 행**이고 DB 핸들이 아니다. */
export interface 집계재료 {
  session: 세션행
  story: 이야기행
  scenes: readonly 장면행[]
  messages: readonly 발화행[]
  analyses: readonly 분석행[]
  turn_conditions: readonly 턴조건행[]
  mission_sessions: readonly 미션시도행[]
  mission_messages: readonly 미션발화행[]
  /**
   * 이 아이의 **이전 완료 활동 수**. `0` 이면 첫 활동이고, 그때 프론트가
   * 「새로 쓴 낱말」 라벨을 「처음 만난 낱말」로 바꾼다 (계약 문서 2절 ③).
   */
  prior_activities: number
}

/**
 * `applyExtractedWords()` 가 받는 것 — LLM(#37)이 뽑은 낱말과 대조할 누적 목록.
 *
 * 낱말만 LLM 이 뽑는다(결정 R21 · 명세 5.3). 한국어를 낱말로 쪼개려면 형태소 분석기가
 * 필요한데 이 레포에 없고, 넣지 않기로 했기 때문이다. **「새 낱말인가」의 판정은 규칙**이고
 * 그 자리가 여기다.
 */
export interface 낱말재료 {
  /** `report_analysis` 의 `words.extracted` — 기본형으로 뽑은 낱말 (명세 5.2) */
  extracted: readonly string[]
  /** `report_analysis` 의 `words.repeated` — 반복 표현. 발화에 나온 그 글자다 */
  repeated: readonly string[]
  /** `child_words.word` 목록 — 이 아이가 **지난 활동까지** 쓴 낱말 (명세 6.2) */
  child_words: readonly string[]
}

// ═══════════════════════════════════════════════════════════════════════════
// 안쪽 — 아이 발화 한 줄로 접기
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 본 대화와 미션 발화를 **한 모양으로 접은** 아이 발화 하나.
 *
 * 둘을 접는 이유는 결정 R23 이다 — 세는 자리마다 「미션도 세나?」를 다시 묻게 되면 언젠가
 * 한 군데를 빠뜨리고, 그러면 「말한 문장 수」가 실제보다 적게 나온다.
 */
interface 아이발화 {
  message_id: string
  scene_code: string
  scene_label: string
  text: string
  분석: 분석 | null
  /** 본 대화면 `true`. `reprompt_recovered` 는 여기만 센다 (미션 턴은 유도하지 않는다) */
  본대화: boolean
}

/**
 * 화면에 찍을 장면 이름 (`Quote.scene_label`).
 *
 * 「장면 N」의 N 은 `scene_order` 다. 이름은 `story_scenes` 에 칸이 없어 못 만들 수 있고,
 * 그때는 번호까지만 낸다 — 빈 이름을 지어내지 않는다.
 */
function 장면라벨(장면: 장면행): string {
  const 번호 = `장면 ${장면.scene_order}`
  return 장면.name ? `${번호} · ${장면.name}` : 번호
}

/**
 * 미션 발화의 장면 이름 — ✅ **사람이 정했다** (2026-08-15 · 미정 M7 확정).
 *
 * 계약 문서 5절이 「장면 4 · 배나무 앞 방귀 대작전」과 「미션 · 배 따기」 둘을 놓고 열어
 * 두었던 자리다. 기획이 **뒤엣것**으로 정했다 — 본 대화의 「장면 3 · 들켜버린 큰 방귀」와
 * 나란히 서되 「미션에서 한 말」인 것이 화면에서 구별되는 값이다.
 *
 * 미션 이름은 `story_missions.title` 이고 로컬 DB 에 「배 따기」·「친구 돕기」 둘이 있다.
 */
function 미션장면라벨(미션: 미션시도행): string {
  return `미션 · ${미션.title}`
}

/**
 * 아이 발화를 **정해진 순서로** 편다 — 본 대화(`turn_order`) → 미션(장면 순 → 시도 → 순번).
 *
 * ⚠️ 실제로 미션은 대화 도중에 끼어들지만 두 표의 순번이 서로 다른 축이라(`messages` 는
 *    세션 전체 순번, `mission_messages` 는 미션 안 순번) 하나로 세울 키가 없다. 시각으로
 *    섞을 수도 있지만 그러면 이 층이 시각을 보게 된다. 그래서 **미션을 뒤에 붙이고**,
 *    순서에 기대는 것은 「GUIDED 다음 발화」(본 대화 안에서만) 하나로 좁혔다.
 */
function 아이발화들(재료: 집계재료): 아이발화[] {
  const 장면_id로 = new Map(재료.scenes.map((장면) => [장면.id, 장면]))
  const 분석_message_id로 = new Map(재료.analyses.map((행) => [행.message_id, 행 as 분석]))

  const 본대화 = [...재료.messages]
    .filter((행) => 행.speaker_type === 'child')
    .sort((가, 나) => 가.turn_order - 나.turn_order)
    .map((행): 아이발화 => {
      const 장면 = 장면_id로.get(행.scene_id)
      return {
        message_id: 행.id,
        scene_code: 장면?.code ?? '',
        scene_label: 장면 ? 장면라벨(장면) : '',
        text: 행.text,
        분석: 분석_message_id로.get(행.id) ?? null,
        본대화: true,
      }
    })

  // 미션 시도는 「끼어든 대화 장면 순서 → 시도 id」로 세운다. 부르는 쪽이 배열을 어떤
  // 순서로 주든 결과가 같아야 하기 때문이다 (같은 입력 = 같은 출력).
  const 시도들 = [...재료.mission_sessions].sort((가, 나) => {
    const 가순 = 장면_id로.get(가.scene_id)?.scene_order ?? 0
    const 나순 = 장면_id로.get(나.scene_id)?.scene_order ?? 0
    return 가순 - 나순 || (가.id < 나.id ? -1 : 가.id > 나.id ? 1 : 0)
  })

  const 미션 = 시도들.flatMap((시도) => {
    const 장면 = 장면_id로.get(시도.scene_id)
    return [...재료.mission_messages]
      .filter((행) => 행.mission_session_id === 시도.id && 행.speaker_type === 'child')
      .sort((가, 나) => 가.turn_order - 나.turn_order)
      .map((행): 아이발화 => ({
        message_id: 행.id,
        scene_code: 장면?.code ?? '',
        scene_label: 미션장면라벨(시도),
        text: 행.text,
        분석: 행.analysis,
        본대화: false,
      }))
  })

  return [...본대화, ...미션]
}

// ═══════════════════════════════════════════════════════════════════════════
// 안쪽 — 축
// ═══════════════════════════════════════════════════════════════════════════

/** 이 발화에서 확인된 요소 코드들. 같은 코드가 근거만 달리해 여러 번 와도 **한 번만** 센다. */
function 감지된_요소(발화: 아이발화): Set<string> {
  const 코드 = new Set<string>()
  for (const 것 of 발화.분석?.detected_elements ?? []) {
    if (것?.type) 코드.add(것.type)
  }
  return 코드
}

/**
 * 요소 축 넷의 점수 = **그 축에 묶인 요소가 감지된 발화 수의 합** (결정 R17).
 *
 * 🔴 「이야기가 요구한 요소 대비 충족률」로 매기지 않는다. 「방귀 뀌는 며느리」 대화 4장면의
 *    `required_elements` 합집합에 `EMOTION` 과 `DECISION` 이 **한 번도 없어서**
 *    (`src/llm/db/seed.ts:292 · :343 · :381 · :415`) 충족률로 매기면 시안의 「감정 표현」
 *    축이 **항상 0**이 된다. 감지 횟수 그대로 센다 — 시안 카드의 "이번 활동에서 5번
 *    나왔어요"와 같은 값이어야 한다. 정규화는 프론트가 그린다.
 */
function 요소축(발화들: readonly 아이발화[], 요소코드들: readonly string[]): Axis {
  // 0 인 요소도 칸을 남긴다 — 시안 표가 `"DECISION": 0` 을 그대로 보여 준다 (명세 4.1).
  const parts: Record<string, number> = {}
  for (const 코드 of 요소코드들) parts[코드] = 0

  for (const 발화 of 발화들) {
    for (const 코드 of 감지된_요소(발화)) {
      if (코드 in parts) parts[코드] += 1
    }
  }

  const score = 요소코드들.reduce((합, 코드) => 합 + parts[코드], 0)
  return { score, parts }
}

/**
 * 「상호작용」 축 — 요소가 아니라 대화 지표 셋의 합이다 (명세 4.2 · 결정 R4).
 *
 * - `child_questions` — `child_intent === 'QUESTION'` 인 아이 발화 수 (미션 포함, R23)
 * - `reprompt_recovered` — `GUIDED` 인 턴 **다음** 아이 발화가 `VALID` 인 횟수.
 * - `soft_cue_answered` — soft-cue 가 얹힌 턴 **다음** 아이 발화가 그 `guidance_target` 을
 *   실제로 말한 횟수. 셋째 항이 왜 붙었는지는 위 `상호작용_점수칸` 머리말에 있다.
 *
 * ⚠️ 셋 다 **아이 발화를 센다.** 뒤 둘은 「앞 턴에 무슨 판정이 났나」를 조건으로 쓸 뿐,
 *    오르는 것은 **뒤 발화 하나**다. 네 요소 축이 「그런 말을 한 발화 수」인 것과 같은 단위다.
 *
 * ⚠️ 뒤 둘은 **본 대화에서만** 센다. 미션 발화에는 `turn_conditions` 가 없다 — 미션 턴은
 *    유도하지 않기 때문이다 (`src/llm/domain/mission.ts:206`).
 *
 * ⚠️ **장면 경계를 따로 막지 않는다.** 장면은 `CLOSING` 턴에서만 끝나는데
 *    (`src/llm/domain/progress.ts:134` — `scene_end_reason` 이 붙은 턴), `GUIDED` 도
 *    soft-cue 도 `CLOSING` 이 아닌 턴에만 선다. 그래서 조건이 맞은 턴의 「다음 발화」는
 *    **언제나 같은 장면 안**이거나(대화가 이어졌다) 아예 없다(활동을 중단했다).
 *
 * ⚠️ 두 항은 **겹치지 않는다.** `soft_cue` 는 `response_mode === 'NORMAL'` 일 때만 참이라
 *    같은 앞 턴이 `GUIDED` 이면서 soft-cue 일 수는 없다.
 */
function 상호작용축(발화들: readonly 아이발화[], turn_conditions: readonly 턴조건행[]): Axis {
  const child_questions = 발화들.filter((발화) => 발화.분석?.child_intent === 'QUESTION').length

  const 판정_message_id로 = new Map(turn_conditions.map((행) => [행.message_id, 행]))
  const 본대화 = 발화들.filter((발화) => 발화.본대화)

  let reprompt_recovered = 0
  let soft_cue_answered = 0
  for (let i = 1; i < 본대화.length; i += 1) {
    const 앞턴 = 판정_message_id로.get(본대화[i - 1].message_id)

    if (앞턴?.response_mode === 'GUIDED' && 본대화[i].분석?.utterance_validity === 'VALID') {
      reprompt_recovered += 1
    }

    // 걱정 한 줄을 얹었고(=아이가 잘 답한 턴), 그 걱정이 가리킨 요소를 다음 발화가 말했다.
    const 걱정 = 앞턴?.soft_cue === true ? (앞턴.guidance_target ?? null) : null
    if (걱정 !== null && 감지된_요소(본대화[i]).has(걱정)) soft_cue_answered += 1
  }

  const parts: Record<string, number> = {
    child_questions,
    reprompt_recovered,
    soft_cue_answered,
  }
  const score = 상호작용_점수칸.reduce((합, 칸) => 합 + parts[칸], 0)

  // `child_turns` 는 담기만 하고 점수에 안 넣는다 — 위 `상호작용_참고칸` 머리말 참고.
  const context: Record<string, number> = { child_turns: 본대화.length }
  return { score, parts, context }
}

// ═══════════════════════════════════════════════════════════════════════════
// 안쪽 — 낱말 대조
// ═══════════════════════════════════════════════════════════════════════════

const 한글_첫_코드 = 0xac00
const 한글_끝_코드 = 0xd7a3

/** 한 글자에서 받침을 뗀다. 한글 음절이 아니거나 받침이 없으면 그대로 (`먹` → `머`, `A` → `A`). */
function 받침없이(글자: string): string {
  const 코드 = 글자.charCodeAt(0)
  if (코드 < 한글_첫_코드 || 코드 > 한글_끝_코드) return 글자
  const 받침 = (코드 - 한글_첫_코드) % 28
  return 받침 === 0 ? 글자 : String.fromCharCode(코드 - 받침)
}

/**
 * 낱말 하나를 발화에서 찾을 때 **차례로 대 볼 글자들**.
 *
 * 🔴 명세의 두 줄이 서로 어긋나는 자리다. LLM 은 낱말을 **기본형**으로 뽑고(4.3 ①),
 *    서버는 그 낱말이 발화 안에 **글자로 있는지** 대조해 없으면 버린다(5.3 ②). 그런데
 *    한국어에서 「부끄럽다」는 발화에 「부끄러워했어요」로 나온다 — 글자 그대로만 보면
 *    거의 다 버려져서 `words.main` 이 늘 빈 목록이 된다.
 *
 *    형태소 분석기는 넣지 않기로 했으므로(명세 5.3) **앞머리를 조금씩 깎아** 댄다:
 *
 *    | 대 보는 것 | 「부끄럽다」 | 「무섭다」 | 「신기하다」 | 「참다」 |
 *    |---|---|---|---|---|
 *    | ① 낱말 그대로 | 부끄럽다 | 무섭다 | 신기하다 | 참다 |
 *    | ② 「다」 뗀 어간 | 부끄럽 | 무섭 | 신기하 | 참 |
 *    | ③ 어간의 받침 뗀 것 | 부끄러 ✅ | 무서 ✅ | 신기하 | — |
 *    | ④ 어간의 끝 글자 뗀 것 | 부끄 | — | 신기 ✅ | — |
 *
 *    ③은 ㅂ·ㅅ 불규칙(무섭다→무서워), ④는 「-하다」(신기하다→신기했어요)를 건진다.
 *
 * ⚠️ 두 글자 밑으로는 내려가지 않는다. 한 글자까지 깎으면 「참」이 「차」가 되어 「차를
 *    마셨어요」에 걸린다 — 지나친 대조는 안 세는 것보다 나쁘다.
 */
export function 대조형들(낱말: string): string[] {
  const 다듬은 = 낱말.trim()
  if (다듬은.length === 0) return []

  const 형들 = [다듬은]
  const 밀어넣기 = (것: string) => {
    if (것.length >= 2 && !형들.includes(것)) 형들.push(것)
  }

  const 어간 = 다듬은.length >= 2 && 다듬은.endsWith('다') ? 다듬은.slice(0, -1) : 다듬은
  if (어간 !== 다듬은) {
    // 「참다」→「참」처럼 한 글자만 남는 어간은 그 자체로는 살린다. 더 깎지 않을 뿐이다.
    if (!형들.includes(어간)) 형들.push(어간)
  }
  if (어간.length >= 2) {
    밀어넣기(어간.slice(0, -1) + 받침없이(어간.slice(-1)))
    밀어넣기(어간.slice(0, -1))
  }
  return 형들
}

/** 글 안에 조각이 몇 번 나오나 (겹치지 않게 센다). 조각이 비었으면 0. */
function 나온횟수(글: string, 조각: string): number {
  if (조각.length === 0) return 0
  return 글.split(조각).length - 1
}

/**
 * 발화들에서 낱말이 몇 번 나왔나. **처음 걸린 대조형 하나로만** 센다.
 *
 * 여러 대조형을 다 더하면 「부끄럽다」의 ①②③이 같은 글자를 겹쳐 세어 3배가 된다.
 */
function 낱말_나온횟수(발화들: readonly 아이발화[], 낱말: string): number {
  for (const 형 of 대조형들(낱말)) {
    const 합 = 발화들.reduce((수, 발화) => 수 + 나온횟수(발화.text, 형), 0)
    if (합 > 0) return 합
  }
  return 0
}

/** 이 낱말이 처음 나온 아이 발화. 없으면 `null`. */
function 처음_나온_발화(발화들: readonly 아이발화[], 낱말: string): 아이발화 | null {
  const 형들 = 대조형들(낱말)
  for (const 발화 of 발화들) {
    if (형들.some((형) => 발화.text.includes(형))) return 발화
  }
  return null
}

/**
 * 질문한 낱말 (명세 4.3 ④ · 결정 R15).
 *
 * 아이의 `QUESTION` 발화 원문에 장면 낱말 목록(`story_scenes.vocabulary`)의 낱말이
 * **글자로 있으면** 센다. **LLM 을 거치지 않는다.**
 *
 * - 대조 대상은 **이야기 전체의 낱말 목록**이다. 3장면에서 배운 말을 7장면에서 물을 수
 *   있으므로 그 발화가 난 장면의 목록으로 좁히지 않는다.
 * - `scene_code` 는 **물어본 자리**다 — 낱말이 실린 장면이 아니라 아이가 그 말을 물은 장면.
 *   보호자 화면이 「어디서 물었나」를 보여 주는 칸이기 때문이다.
 * - 낱말 목록의 낱말은 이미 발화에 나오는 꼴(「며느리」)이라 위 `대조형들()` 을 쓰지 않고
 *   글자 그대로 본다. 기본형 흔들림은 LLM 이 뽑은 낱말 쪽에만 있다.
 */
function 질문한_낱말(
  발화들: readonly 아이발화[],
  scenes: readonly 장면행[],
): ReportMetrics['words']['asked'] {
  // 같은 낱말이 두 장면에 실려 있으면 앞 장면의 뜻을 쓴다.
  const 뜻 = new Map<string, string | null>()
  for (const 장면 of [...scenes].sort((가, 나) => 가.scene_order - 나.scene_order)) {
    for (const 것 of 장면.vocabulary ?? []) {
      if (!뜻.has(것.word)) 뜻.set(것.word, 것.meaning ?? null)
    }
  }

  const 나온것: ReportMetrics['words']['asked'] = []
  const 이미 = new Set<string>()
  for (const 발화 of 발화들) {
    if (발화.분석?.child_intent !== 'QUESTION') continue
    for (const [낱말, 낱말뜻] of 뜻) {
      if (이미.has(낱말) || !발화.text.includes(낱말)) continue
      이미.add(낱말)
      나온것.push({ word: 낱말, meaning: 낱말뜻, scene_code: 발화.scene_code })
    }
  }
  return 나온것
}

// ═══════════════════════════════════════════════════════════════════════════
// 바깥 — ① 규칙만으로 셀 수 있는 것 전부
// ═══════════════════════════════════════════════════════════════════════════

/** 시각 한 칸을 밀리초로. 못 읽으면 `null` — 이 층은 시계를 보지 않으므로 지금 시각으로 때우지 않는다. */
function 밀리초(값: 시각): number | null {
  const 수 = 값 instanceof Date ? 값.getTime() : Date.parse(값)
  return Number.isNaN(수) ? null : 수
}

/** `played_at` 은 ISO 8601 이다. 글자로 받았으면 **그대로 흘린다** — `+09:00` 을 `Z` 로 바꾸지 않는다. */
function ISO로(값: 시각): string {
  return 값 instanceof Date ? 값.toISOString() : 값
}

/**
 * 활동 한 건의 지표를 센다. **LLM 이 필요한 칸(`words.main`·`repeated`·`new`)은 비워** 둔다.
 *
 * 명세 4.3 의 순서 그대로다 — LLM 이 낱말을 뽑기 전에도 숫자가 담긴 리포트가 나와야 하고
 * (결정 R18 `metrics_only`), 낱말은 뒤에 `applyExtractedWords()` 로 얹는다.
 *
 * 발화가 세 건뿐인 활동에서도 터지지 않고 축이 전부 0 인 결과를 낸다 (결정 R16).
 */
export function aggregateMetrics(재료: 집계재료): ReportMetrics {
  const 발화들 = 아이발화들(재료)

  const 시작 = 밀리초(재료.session.started_at)
  const 끝 = 밀리초(재료.session.completed_at ?? 재료.session.last_activity_at)
  const duration_minutes =
    시작 === null || 끝 === null ? 0 : Math.max(0, Math.round((끝 - 시작) / 60_000))

  const asked = 질문한_낱말(발화들, 재료.scenes)

  const axes = {} as Record<AxisName, Axis>
  for (const 축 of Object.keys(축_요소) as AxisName[]) {
    axes[축] =
      축 === '상호작용' ? 상호작용축(발화들, 재료.turn_conditions) : 요소축(발화들, 축_요소[축])
  }

  return {
    activity: {
      story_slug: 재료.story.slug,
      story_title: 재료.story.title,
      played_at: ISO로(재료.session.started_at),
      duration_minutes,
      completed: 재료.session.status === 'completed',
      prior_activities: 재료.prior_activities,
    },
    counts: {
      // 본 대화 + 미션 (결정 R23). 안 세면 「말한 문장 수」가 실제보다 적게 나온다.
      child_utterances: 발화들.length,
      // 낱말 둘은 LLM 이 뽑은 목록이 와야 채워진다 — `applyExtractedWords()`.
      new_words: 0,
      asked_words: asked.length,
    },
    axes,
    words: { main: [], asked, repeated: [], new: [] },
    quotes: 인용후보(발화들),
  }
}

/**
 * LLM 이 인용할 수 있는 발화 후보 (명세 4.1 · 계약 문서 1절).
 *
 * ⛔ **이 목록 밖의 발화는 인용될 수 없다.** LLM 이 낸 `quote_message_id` 가 여기 없으면
 * 위층(#37·#38)이 그 인용을 버린다.
 *
 * 후보의 조건 둘 — `VALID` 이고 사고 요소가 하나라도 잡힌 발화다. 「몰라요」 같은 발화를
 * 후보에 넣으면 LLM 이 그것을 골라 보호자에게 대표 발화라고 내미는 일이 생긴다.
 */
function 인용후보(발화들: readonly 아이발화[]): Quote[] {
  const 후보: Quote[] = []
  for (const 발화 of 발화들) {
    if (발화.분석?.utterance_validity !== 'VALID') continue
    const 요소 = [...감지된_요소(발화)]
    if (요소.length === 0) continue
    후보.push({
      message_id: 발화.message_id,
      scene_code: 발화.scene_code,
      scene_label: 발화.scene_label,
      text: 발화.text,
      elements: 요소,
    })
  }
  return 후보
}

// ═══════════════════════════════════════════════════════════════════════════
// 바깥 — ② LLM 이 뽑은 낱말을 얹는다
// ═══════════════════════════════════════════════════════════════════════════

/**
 * `report_analysis`(#37)가 뽑은 낱말을 지표에 얹는다 (명세 4.3 ①~④ · 결정 R6·R21).
 *
 * `aggregateMetrics()` 와 나눠 둔 이유는 명세 4.3 의 **순서** 때문이다. LLM 이 실패해도
 * 숫자가 담긴 리포트는 나가야 하므로(R18) 집계가 먼저 끝나고, 낱말은 뒤에 얹힌다.
 * 부르지 않으면 `words.main`·`repeated`·`new` 는 빈 목록 그대로다.
 *
 * 규칙이 하는 일 셋:
 *
 * 1. **버린다** — 뽑힌 낱말이 실제 아이 발화 안에 없으면 (명세 5.3 ②).
 * 2. **센다** — 몇 번 나왔나.
 * 3. **가린다** — `child_words`(아이별 누적)에 없으면 새 낱말이다.
 *
 * ⛔ 이 함수는 `child_words` 에 **넣지 않는다.** 저장은 리포트 저장이 성공한 뒤여야 하고
 *    (`src/report/README.md` 생성 흐름 ⑤), 그 순서는 service 층이 안다.
 *
 * 받은 지표를 고치지 않고 **새 값**을 돌려준다.
 */
export function applyExtractedWords(
  지표: ReportMetrics,
  재료: 집계재료,
  낱말: 낱말재료,
): ReportMetrics {
  const 발화들 = 아이발화들(재료)

  const main: ReportMetrics['words']['main'] = []
  const 본낱말 = new Set<string>()
  for (const 것 of 낱말.extracted) {
    const word = 것.trim()
    if (word.length === 0 || 본낱말.has(word)) continue
    const count = 낱말_나온횟수(발화들, word)
    if (count === 0) continue // 발화에 없는 낱말은 버린다 (명세 5.3 ②)
    본낱말.add(word)
    main.push({ word, count })
  }

  const repeated: ReportMetrics['words']['repeated'] = []
  const 본표현 = new Set<string>()
  for (const 것 of 낱말.repeated) {
    const phrase = 것.trim()
    if (phrase.length === 0 || 본표현.has(phrase)) continue
    // 반복 표현은 발화에 나온 그 글자라 기본형 흔들림이 없다 — 글자 그대로 센다.
    const count = 발화들.reduce((수, 발화) => 수 + 나온횟수(발화.text, phrase), 0)
    if (count === 0) continue
    본표현.add(phrase)
    repeated.push({ phrase, count })
  }

  // 새 낱말 — 누적 목록에 없는 것. ⚠️ 첫 활동이면 누적이 비어 있어 쓴 낱말이 전부 새 낱말이
  // 된다. 그게 맞고, 화면은 `activity.prior_activities === 0` 을 보고 라벨을 바꾼다 (4.3).
  const 이미쓴 = new Set(낱말.child_words.map((것) => 것.trim()))
  const 새낱말: ReportMetrics['words']['new'] = []
  for (const { word } of main) {
    if (이미쓴.has(word)) continue
    새낱말.push({
      word,
      first_scene_code: 처음_나온_발화(발화들, word)?.scene_code ?? '',
    })
  }

  return {
    ...지표,
    counts: { ...지표.counts, new_words: 새낱말.length },
    words: { ...지표.words, main, repeated, new: 새낱말 },
  }
}
