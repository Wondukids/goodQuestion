/**
 * 계약 문서 4절의 **샘플 응답 둘**을 그대로 옮긴 것 (`docs/보호자_리포트_프론트_계약.md`).
 *
 * 리포트 API(#38)가 아직 없어 화면을 붙여 볼 서버가 없다 — /dev/minigame 이 목 미션 API 로
 * 미니게임을 띄웠던 것과 같은 자리다. 이 둘이 이 화면이 마주칠 **양극단**이고,
 * `/dev/report` 와 `tests/report-screen.test.ts` 가 **같은 값**을 본다.
 *
 * ⚠️ 여기를 고치기 전에 계약 문서를 먼저 고쳐라. 화면과 서버가 같은 글자를 보는 자리다.
 */

import type { ParentReport } from "@/report/types";

/** 4.1 말을 잘한 아이 — 두 탭이 다 차는 판 */
export const 잘한_아이: ParentReport = {
  status: "complete",
  generated_at: "2026-08-03T19:38:00+09:00",
  read_at: null,
  regenerated: 0,
  metrics: {
    activity: {
      story_slug: "fart-bride",
      story_title: "방귀 뀌는 며느리",
      played_at: "2026-08-03T19:12:00+09:00",
      duration_minutes: 24,
      completed: true,
      prior_activities: 2,
    },
    counts: { child_utterances: 32, new_words: 7, asked_words: 4 },
    axes: {
      관점과공감: { score: 6, parts: { PERSPECTIVE: 4, EMPATHY: 2 } },
      감정표현: { score: 7, parts: { EMOTION: 7 } },
      생각과이유: { score: 5, parts: { DECISION: 0, REASON: 5 } },
      결과와해결: { score: 4, parts: { SOLUTION: 3, RESULT: 1 } },
      상호작용: {
        score: 6,
        parts: { child_questions: 4, reprompt_recovered: 2 },
        context: { child_turns: 12 },
      },
    },
    words: {
      main: [
        { word: "부끄럽다", count: 3 },
        { word: "당당하다", count: 2 },
        { word: "참다", count: 2 },
        { word: "신기하다", count: 4 },
      ],
      asked: [
        { word: "며느리", meaning: "아들의 아내", scene_code: "sc_banggui_03" },
        { word: "배나무", meaning: "배가 열리는 나무", scene_code: "sc_banggui_07" },
      ],
      repeated: [
        { phrase: "왜냐하면", count: 5 },
        { phrase: "그래서", count: 4 },
        { phrase: "진짜", count: 3 },
      ],
      new: [
        { word: "당당하다", first_scene_code: "sc_banggui_05" },
        { word: "참다", first_scene_code: "sc_banggui_03" },
      ],
    },
    quotes: [
      {
        message_id: "m-101",
        scene_code: "sc_banggui_03",
        scene_label: "장면 2 · 방귀를 참는 며느리",
        text: "며느리가 부끄러워했어요.",
        elements: ["EMOTION"],
      },
      {
        message_id: "m-118",
        scene_code: "sc_banggui_05",
        scene_label: "장면 3 · 들켜버린 큰 방귀",
        text: "며느리가 부끄러워했어요. 왜냐하면 사람들이 이상하게 볼까 봐 무서웠기 때문이에요.",
        elements: ["EMOTION", "REASON"],
      },
      {
        message_id: "m-133",
        scene_code: "sc_banggui_07",
        scene_label: "장면 4 · 배나무 앞 방귀 대작전",
        text: "며느리가 배를 땄어요.",
        elements: ["RESULT", "SOLUTION"],
      },
    ],
  },
  narrative: {
    overall: "감정 표현과 상호작용이 특히 잘 드러났어요",
    cards: [
      {
        axis: "어휘",
        summary: "마음을 나타내는 낱말을 상황에 맞게 골라 썼어요",
        quote_message_id: "m-101",
        did_well: "'부끄럽다·당당하다' 같은 마음 낱말 7개를 새로 썼어요",
        to_improve: "'좋다/싫다' 대신 더 구체적인 낱말을 함께 찾아보면 좋아요",
      },
      {
        axis: "표현",
        summary: "인물의 말을 그대로 흉내 내어 실감나게 말했어요",
        quote_message_id: "m-118",
        did_well: "인물이 되어 말하는 장면이 특히 자연스러웠어요",
        to_improve: "장면을 설명하는 말도 한 문장 덧붙이면 더 좋아요",
      },
      {
        axis: "논리",
        summary: "'왜냐하면'으로 이유를 붙여 말하기 시작했어요",
        quote_message_id: "m-118",
        did_well: "이유를 붙인 문장이 이번 활동에서 5번 나왔어요",
        to_improve: "'그래서 어떻게 됐어?'로 결과까지 이어 말해보면 좋아요",
      },
    ],
    highlight: {
      quote_message_id: "m-118",
      why: "인물의 마음과 그 이유를 한 문장으로 이어 말해, 지우의 강점이 가장 잘 드러난 말이에요",
    },
    word_tip:
      "오늘 저녁에는 '신기하다' 대신 쓸 수 있는 말을 함께 찾아보면 어휘가 더 넓어질 것 같아요",
    reason: "이유·결과를 묻는 질문으로 골랐어요",
    story_questions: [
      {
        element: "REASON",
        scene_code: "sc_banggui_03",
        quote_message_id: "m-101",
        question: "왜 부끄러웠을까? 이유까지 말해줄래?",
        fallback: '"몰라"라고 한다면 — "지우라면 그때 어땠을 것 같아?"',
      },
      {
        element: "PERSPECTIVE",
        scene_code: "sc_banggui_05",
        quote_message_id: "m-118",
        question: "가족들은 그때 어떤 마음이었을까?",
        fallback: '짧게 답한다면 — "지우가 시아버지였다면 뭐라고 했을까?"',
      },
      {
        element: "RESULT",
        scene_code: "sc_banggui_07",
        quote_message_id: "m-133",
        question: "배를 딴 다음에는 어떻게 됐을까?",
        fallback: '막힌다면 — "마을 사람들은 뭐라고 했을까?"',
      },
    ],
    daily_questions: [
      {
        label: "내 경험과 이유",
        question: "지우도 부끄러웠던 적 있어? 왜 그런 마음이 들었어?",
        goal: "자기 경험의 원인을 설명해보기",
      },
      {
        label: "이해와 배려",
        question: "친구가 부끄러워하면 뭐라고 말해줄 거야?",
        goal: "다른 사람의 감정을 헤아려보기",
      },
      {
        label: "결과 예상",
        question: "그렇게 말해주면 친구 기분은 어떨까?",
        goal: "행동 이후의 결과를 예상해보기",
      },
    ],
  },
};

/** 4.2 짧게만 답한 아이 · 첫 활동 — `narrative: null` · 빈 칸이 생기는 판 */
export const 짧게_답한_아이: ParentReport = {
  status: "metrics_only",
  generated_at: "2026-08-05T18:20:00+09:00",
  read_at: null,
  regenerated: 0,
  metrics: {
    activity: {
      story_slug: "fart-bride",
      story_title: "방귀 뀌는 며느리",
      played_at: "2026-08-05T18:04:00+09:00",
      duration_minutes: 9,
      completed: true,
      prior_activities: 0,
    },
    counts: { child_utterances: 7, new_words: 2, asked_words: 0 },
    axes: {
      관점과공감: { score: 0, parts: { PERSPECTIVE: 0, EMPATHY: 0 } },
      감정표현: { score: 2, parts: { EMOTION: 2 } },
      생각과이유: { score: 1, parts: { DECISION: 1, REASON: 0 } },
      결과와해결: { score: 0, parts: { SOLUTION: 0, RESULT: 0 } },
      상호작용: {
        score: 1,
        parts: { child_questions: 0, reprompt_recovered: 1 },
        context: { child_turns: 7 },
      },
    },
    words: {
      main: [{ word: "무섭다", count: 2 }],
      asked: [],
      repeated: [{ phrase: "몰라요", count: 3 }],
      new: [{ word: "무섭다", first_scene_code: "sc_banggui_03" }],
    },
    quotes: [
      {
        message_id: "m-402",
        scene_code: "sc_banggui_03",
        scene_label: "장면 2 · 방귀를 참는 며느리",
        text: "무서웠어요.",
        elements: ["EMOTION"],
      },
    ],
  },
  narrative: null,
};

/** 깊은 복사 — 샘플은 여러 곳이 함께 보므로 손댈 때는 사본을 만든다. */
export function 사본(report: ParentReport): ParentReport {
  return JSON.parse(JSON.stringify(report)) as ParentReport;
}
