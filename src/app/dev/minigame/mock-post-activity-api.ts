/**
 * 후활동 API 목 어댑터 (이슈 #46) — `docs/말하기후활동_명세.md` 5절 A~D 계약 모양의
 * 응답을 고정 지연으로 돌려준다. `mock-mission-api.ts` 와 같은 결이고 같은 자리다:
 * /dev/minigame 전용이며, 아이 앱(play.tsx)은 실구현(REAL_POST_ACTIVITY_API)을 주입한다.
 *
 * 이걸 두는 값은 **서버·DB 없이 전 흐름이 도는 것**이다 — 카드가 서버 값으로 그려지는지,
 * 「다 놓았어요!」가 몇 번째로 세어지는지, 판정이 죽어도 화면이 끝까지 가는지(수용 10)를
 * 눈으로 본다.
 *
 * ## 진짜와 다른 자리 셋 (전부 일부러 그렇다)
 *
 * 1. **받아쓰기만 진짜다.** 마이크→녹음→STT 라우트까지 태운다 (미션 목과 같은 이유).
 * 2. **단어 판정은 ①규칙 단만 흉내 낸다.** 「비슷한 말」(`similar`)은 LLM 단이라 목에 없다 —
 *    글자로 못 찾은 단어는 전부 `missing` 이다. 진짜 판정은 `src/post-activity/` 에 있다.
 * 3. **행이 딱 하나다.** 세션 개념이 없어 `session_id` 를 보지 않는다.
 *
 * 값(카드·정답 순서·트레이 순서)은 화면 상수에서 뜬다. 그 상수가 DB(sql/007)·시드와
 * 글자까지 같다는 것은 `tests/post-activity-schema.test.ts` 가 이미 재고 있다.
 */

import { SCENES, TRAY_ORDER } from "@/stories/fart-bride/minigame/finale-script";
import type {
  PostActivityApi,
  PostActivityCompleteReason,
  PostActivityCompleteResult,
  PostActivityConfig,
  PostActivityKeyword,
  PostActivityOpen,
  PostActivityOrderResult,
  PostActivityResult,
  PostActivityRetellingResult,
} from "@/stories/fart-bride/session-api";
import { transcribeAudio } from "@/stt/client";

/** 미션 목과 같은 값 — 실서버의 왕복 대신 눈에 보이는 짧은 지연 */
const DELAY_MS = 600;
const delay = () => new Promise((resolve) => setTimeout(resolve, DELAY_MS));

/** 화면 상수를 `post_activity_config` 모양으로 옮긴 것 (명세 4.1 — 그림·칩 색은 안 넣는다) */
const CONFIG: PostActivityConfig = {
  cards: SCENES.map((scene) => ({
    id: scene.id,
    title: scene.title,
    keywords: [...scene.keywords],
  })),
  answer_order: SCENES.map((scene) => scene.id),
  tray_order: [...TRAY_ORDER],
};

/** `post_activity_results` 한 행 — 세션이 하나뿐이라 행도 하나다 */
const emptyRow = (): PostActivityResult => ({
  submitted_order: null,
  is_order_correct: null,
  attempt_count: 0,
  retelling_text: null,
  completed_at: null,
});

let row = emptyRow();
/** 리포트를 이미 띄웠나 — `complete` 가 `queued`/`exists` 를 가르는 값 */
let reportQueued = false;
/** 켜면 판정이 죽은 척한다 — 수용 기준 10 을 눈으로 재는 손잡이 */
let judgeDead = false;

/** 지금까지 쌓인 것 — 개발 화면이 기록으로 찍는다 */
export function mockPostActivityRow(): PostActivityResult {
  return { ...row };
}

/** 처음부터 다시 — 「이어하기」가 아니라 첫 판을 보고 싶을 때 */
export function resetMockPostActivity(): void {
  row = emptyRow();
  reportQueued = false;
}

/** 수용 기준 10 손잡이 — 판정 LLM 을 죽여 놓고 돌려 본다 */
export function setMockJudgeDead(dead: boolean): void {
  judgeDead = dead;
}

/** 세션 id 를 아예 안 받는다 — 목에는 행이 하나뿐이다 (실구현과 자리만 맞으면 된다) */
async function fetchPostActivity(): Promise<PostActivityOpen> {
  await delay();
  return { config: CONFIG, result: { ...row } };
}

/**
 * 명세 5.B — 판정은 **서버가** 정답과 대조해 한다. 앱이 보낸 판정은 받지 않는다.
 * 「첫 제출은 안 덮는다」(F7)와 「끝내 맞췄나」(F18)가 여기 다 들어 있다.
 */
async function submitPostActivityOrder(
  _sessionId: string,
  submittedOrder: readonly string[],
): Promise<PostActivityOrderResult> {
  await delay();
  const answer = CONFIG.answer_order;
  const isCorrect =
    submittedOrder.length === answer.length &&
    submittedOrder.every((id, index) => id === answer[index]);

  row.attempt_count += 1;
  row.submitted_order ??= [...submittedOrder];
  row.is_order_correct = row.is_order_correct === true || isCorrect;
  return { is_correct: isCorrect, attempt_count: row.attempt_count };
}

/**
 * ①규칙 단만 흉내 낸다 — **두 글자 바닥**을 깔고 글자로 찾는다 (F14).
 *
 * 「참다」의 어간은 「참」 한 글자라 바닥에 걸려 규칙을 건너뛴다. 진짜 서버는 그 단어를
 * LLM 에게 물어 「꾹 눌렀어요」를 `similar` 로 잡지만, 목에는 LLM 이 없어 `missing` 이 된다.
 */
function ruleJudge(retelling: string): PostActivityKeyword[] {
  return CONFIG.cards.flatMap((card) =>
    card.keywords.map((word): PostActivityKeyword => {
      const stem = word.endsWith("다") ? word.slice(0, -1) : word;
      const found = stem.length >= 2 && retelling.includes(stem);
      return {
        card_id: card.id,
        word,
        status: found ? "used" : "missing",
        evidence: found ? stem : null,
        decided_by: found ? "rule" : "llm",
      };
    }),
  );
}

/**
 * 명세 5.C — 받아쓴 글을 **먼저** 저장하고 그다음 판정한다.
 * 판정이 죽어도 200 이고 글은 남는다 (F4·F8 · 수용 기준 10).
 */
async function submitPostActivityRetelling(
  _sessionId: string,
  audio: Blob,
  channelCount: number,
): Promise<PostActivityRetellingResult> {
  /* 받아쓰기만 진짜 — 무음이면 "" 가 와서 명세대로 { empty: true } + 아무것도 저장 안 함 */
  const retelling = (await transcribeAudio(audio, channelCount)).trim();
  await delay();
  if (retelling === "") return { empty: true };

  row.retelling_text = retelling;
  if (judgeDead) return { text: retelling, analyzed: false, keywords: null };
  return { text: retelling, analyzed: true, keywords: ruleJudge(retelling) };
}

/** 명세 5.D — ⭐ 리포트를 띄우는 자리. 반복 호출이 안전하다. */
async function completePostActivity(
  _sessionId: string,
  reason: PostActivityCompleteReason,
): Promise<PostActivityCompleteResult> {
  await delay();
  /* `left` 는 아무것도 안 쓴다 — 활동을 안 하고 떠난 아이에게 빈 행을 세우지 않는다 */
  if (reason === "finished") row.completed_at ??= new Date().toISOString();

  const existed = reportQueued;
  reportQueued = true;
  return { report: existed ? "exists" : "queued" };
}

export const MOCK_POST_ACTIVITY_API: PostActivityApi = {
  fetchPostActivity,
  submitPostActivityOrder,
  submitPostActivityRetelling,
  completePostActivity,
};
