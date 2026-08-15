// 보호자 리포트가 주고받는 값의 **모양 하나**.
//
// 🔴 이 파일은 `docs/보호자_리포트_프론트_계약.md` 1절을 **그대로** 옮긴 것이다.
//    화면과 서버가 같은 글자를 보게 하려고 둔 자리이고, 여기가 어긋나면 계약이 어긋난다.
//    이름을 바꾸거나 칸을 없애기 전에 그 문서를 먼저 고쳐라.
//
// ## 왜 세 갈래가 이 한 파일을 공유하나
//
// 지표(#36)가 `ReportMetrics` 를 **만들고**, 엔진(#37)이 그것을 **받아** `ReportNarrative` 를
// 만들고, API(#38)가 둘을 합쳐 `ParentReport` 로 내보낸다. 세 갈래가 각자 타입을 세우면
// 합칠 때 셋이 미묘하게 어긋난다. 그래서 **선언은 여기 하나**이고 각 갈래는 import 만 한다.
//
// ⚠️ 늘리는 것은 되지만 **이름을 바꾸거나 칸을 지우지 마라.** 다른 갈래가 같은 이름을
//    보고 있다. 늘릴 일이 생기면 계약 문서에도 같이 적는다.
//
// ## 이름이 영어인 이유
//
// 이 레포의 안쪽 코드는 한국어 식별자를 쓰지만, 여기 있는 것들은 **프론트엔드와의 계약**이라
// 계약 문서에 적힌 글자 그대로 둔다. 주석은 사람이 읽는 것이므로 한국어다.

// ═══════════════════════════════════════════════════════════════════════════
// 지표 — 규칙이 세는 것 (명세 4절 · #36 이 만든다)
// ═══════════════════════════════════════════════════════════════════════════

/** 시안 오각형의 다섯 칸. 넷은 사고 요소를 묶은 것이고 「상호작용」만 대화 지표다 (결정 R4). */
export type AxisName = '관점과공감' | '감정표현' | '생각과이유' | '결과와해결' | '상호작용'

export interface Axis {
  /**
   * 🔴 **감지된 발화 수 그대로다. 0~100 이 아니다** (결정 R17).
   * 시안 카드의 "이번 활동에서 5번 나왔어요"와 **같은 값**이어야 한다.
   * 오각형 크기는 프론트가 `max(axes[*].score)` 로 그 활동 안에서만 맞춘다.
   */
  score: number
  /** 무엇이 이 점수를 만들었나. 요소 코드 또는 대화 지표 이름 → 횟수 */
  parts: Record<string, number>
  /** 점수에 안 들어가는 참고값 (예: `child_turns`) */
  context?: Record<string, number>
}

/** LLM 이 인용할 수 있는 발화 후보. ⛔ **이 목록 밖의 발화는 인용될 수 없다.** */
export interface Quote {
  message_id: string
  scene_code: string
  /** 화면에 찍을 이름. 예: "장면 3 · 들켜버린 큰 방귀" */
  scene_label: string
  text: string
  /** 사고 요소 8종 코드 (`src/llm/elements.ts`) */
  elements: string[]
}

export interface ReportMetrics {
  activity: {
    story_slug: string
    story_title: string
    /** ISO 8601 */
    played_at: string
    duration_minutes: number
    /** false 면 중간에 그만둔 활동 */
    completed: boolean
    /** 이 아이의 이전 완료 활동 수. 0 이면 **첫 활동**이라 「새 낱말」 라벨이 바뀐다 (4.3) */
    prior_activities: number
  }
  counts: {
    /** 본 대화 + 미션 발화 (결정 R23) */
    child_utterances: number
    new_words: number
    asked_words: number
  }
  axes: Record<AxisName, Axis>
  words: {
    main: { word: string; count: number }[]
    asked: { word: string; meaning: string | null; scene_code: string }[]
    repeated: { phrase: string; count: number }[]
    new: { word: string; first_scene_code: string }[]
  }
  quotes: Quote[]
}

// ═══════════════════════════════════════════════════════════════════════════
// 서술 — LLM 이 쓰는 것 (명세 5절 · #37 이 만든다)
// ═══════════════════════════════════════════════════════════════════════════

export interface SkillCard {
  /** 셋 고정이고 **순서도 고정**이다 */
  axis: '어휘' | '표현' | '논리'
  summary: string
  /** `metrics.quotes` 안의 id. 🔴 목록 밖이면 서버가 버리고 `null` 이 된다 (5.2) */
  quote_message_id: string | null
  did_well: string
  /** 「~하면 좋아요」 꼴로 끝난다 (5.5) */
  to_improve: string
}

export interface StoryQuestion {
  /** 사고 요소 8종 코드. 배지 이름은 프론트가 `elementName()` 으로 바꾼다 */
  element: string
  scene_code: string
  quote_message_id: string
  question: string
  /** 아이가 「몰라」라고 할 때의 대안 한 줄 */
  fallback: string
}

export interface DailyQuestion {
  /** "내 경험과 이유" 같은 배지 글자 */
  label: string
  question: string
  goal: string
}

export interface ReportNarrative {
  overall: string
  /** 어휘 · 표현 · 논리 순서 고정 */
  cards: SkillCard[]
  highlight: { quote_message_id: string; why: string } | null
  word_tip: string | null
  reason: string
  /** 3개 고정 */
  story_questions: StoryQuestion[]
  /** 3개 고정 */
  daily_questions: DailyQuestion[]
}

// ═══════════════════════════════════════════════════════════════════════════
// 화면이 받는 것 (명세 7절 · #38 이 내보낸다)
// ═══════════════════════════════════════════════════════════════════════════

/** `'metrics_only'` 면 `narrative` 가 `null` 이다 — 숫자는 있고 문장이 없는 리포트 (결정 R18) */
export type ReportStatus = 'metrics_only' | 'complete'

/** `GET /api/reports/{session_id}` 의 응답 */
export interface ParentReport {
  status: ReportStatus
  metrics: ReportMetrics
  narrative: ReportNarrative | null
  generated_at: string
  read_at: string | null
  regenerated: number
}

/** `GET /api/children/{child_id}/reports` 의 한 줄 — 상단 활동 드롭다운을 채운다 */
export interface ReportListItem {
  session_id: string
  story_title: string
  played_at: string
  status: ReportStatus
  /** `read_at IS NULL` — 탭 옆 빨간 점 */
  unread: boolean
}
