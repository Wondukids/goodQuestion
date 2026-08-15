/**
 * 서버 `post_activity_config` → 마무리 화면이 그리는 장면 넷 (이슈 #46 · 명세 4.1·8절).
 *
 * **순수 함수만 둔다** — 화면 없이 잰다 (`tests/post-activity-screen.test.ts`).
 * 붙일 서버도 마이크도 없어야 돌아간다.
 *
 * ## 무엇이 서버 값이고 무엇이 앱 값인가 (F1)
 *
 * | 서버 `post_activity_config` | 앱 `finale-script.ts` |
 * |---|---|
 * | 카드 id · 제목 · 핵심 단어 · 정답 순서 · 트레이 순서 | 카드 그림 · 칩 색 · 문구 |
 *
 * 그림·칩 색을 DB 에 넣지 않기로 한 것은 명세 4.1 이다 — 시안에서 나온 앱 자산이라
 * `id` 로 앱이 잇는다. 그래서 이 파일이 **둘을 잇는 유일한 자리**다.
 *
 * ## 상수는 지우지 않는다 (명세 8절 4)
 *
 * `SCENES`·`TRAY_ORDER` 는 이제 **비상용 사본**이다. 서버가 안 열려 `config` 가 null 로
 * 오면 그 값으로 그린다 — 활동이 서버 없이도 끝까지 돈다. 값이 서버와 글자까지 같은지는
 * `tests/post-activity-schema.test.ts` 가 이미 재고 있다 (007 · seed · 화면 상수 · DB 행).
 */

import type { PostActivityCard, PostActivityConfig, PostActivityResult } from "../session-api";
import { SCENES, TRAY_ORDER, type StoryScene } from "./finale-script";

/**
 * 카드 하나가 쓸 앱 자산(그림·칩 색).
 *
 * 🟡 **모르는 id 면 자리 순서로 빌려 온다** — 명세에 없는 판단이라 되돌려도 된다.
 *    새 이야기의 카드 id 가 와도 화면이 회색으로 비지 않게 하려는 것이다. 그 이야기의
 *    진짜 그림이 필요해지면 여기에 이야기별 자산표가 들어온다.
 */
function assetFor(id: string, index: number): StoryScene {
  return SCENES.find((scene) => scene.id === id) ?? SCENES[index % SCENES.length];
}

/**
 * 카드를 **정답 차례**로 세운다.
 *
 * `cards` 의 차례가 곧 정답이지만 `answer_order` 를 따로 적은 것이 명세 4.1 이라 그쪽을
 * 정본으로 본다. 다만 그 목록에 모르는 id 가 섞였거나 카드 수와 안 맞으면 **못 믿는
 * 목록**이므로 `cards` 차례로 돈다 — 카드 한 장이 통째로 사라지는 것보다 낫다.
 */
function inAnswerOrder(
  config: PostActivityConfig,
  cards: PostActivityCard[],
): PostActivityCard[] {
  const byId = new Map(cards.map((card) => [card.id, card]));
  const ordered = config.answer_order.map((id) => byId.get(id));
  const sound =
    ordered.length === cards.length &&
    new Set(config.answer_order).size === cards.length &&
    ordered.every((card) => card !== undefined);
  return sound ? (ordered as PostActivityCard[]) : cards;
}

/**
 * 화면이 그릴 장면들 — **제목과 핵심 단어는 서버 값이다** (수용 기준 2).
 * `post_activity_config` 를 고치면 화면이 바뀐다.
 */
export function toScenes(config: PostActivityConfig | null): StoryScene[] {
  const cards = config?.cards ?? [];
  /* 서버가 없거나 카드가 비었다 — 비상용 상수로 그린다 (명세 8절 4) */
  if (config === null || cards.length === 0) return SCENES;

  return inAnswerOrder(config, cards).map((card, index) => {
    const { image, chip } = assetFor(card.id, index);
    return { id: card.id, title: card.title, keywords: [...card.keywords], chip, image };
  });
}

/**
 * 트레이에 처음 깔리는 (섞인) 순서.
 *
 * 🔴 **빠진 카드는 뒤에 붙인다.** 트레이에 없는 카드는 아이가 놓을 방법이 없어 활동이
 * 거기서 멈춘다 — 설정이 성기게 들어와도 끝까지는 가야 한다.
 */
export function toTrayOrder(
  config: PostActivityConfig | null,
  scenes: StoryScene[],
): string[] {
  const ids = scenes.map((scene) => scene.id);
  const laid = (config?.tray_order ?? TRAY_ORDER).filter(
    (id, index, order) => ids.includes(id) && order.indexOf(id) === index,
  );
  return [...laid, ...ids.filter((id) => !laid.includes(id))];
}

/** 활동을 어디서부터 다시 시작할까 — `resumeFrom()` 의 답. */
export type FinaleResume = {
  step: "order" | "tell";
  /** 이미 들려준 줄거리. 있으면 2단계를 「다 말한 뒤」 자리에서 연다 */
  retelling: string | null;
};

/**
 * 중간에 나갔다 돌아온 아이의 자리를 되살린다.
 *
 * 🟡 **명세는 「결과를 함께 준다」까지만 정했다** (5.A). 그것으로 무엇을 할지는 이 갈래가
 *    정했으므로 되돌려도 된다 — 되돌리면 언제나 1단계부터 다시 시작한다.
 *
 * | 저장된 것 | 여는 자리 | 왜 |
 * |---|---|---|
 * | 줄거리를 이미 말했다 | 2단계 · 말한 뒤 | 같은 이야기를 두 번 시키지 않는다 |
 * | 순서를 **끝내 맞췄다** (F18) | 2단계 · 처음 | 이미 푼 문제를 다시 풀리지 않는다 |
 * | 그 밖 | 1단계 | 순서를 아직 못 맞췄다 |
 *
 * ⚠️ `attempt_count` 는 보지 않는다 — 몇 번 눌렀든 못 맞췄으면 1단계다.
 */
export function resumeFrom(result: PostActivityResult | null): FinaleResume {
  const told = result?.retelling_text?.trim() ?? "";
  if (told !== "") return { step: "tell", retelling: told };
  if (result?.is_order_correct === true) return { step: "tell", retelling: null };
  return { step: "order", retelling: null };
}
