// 세션 진행 판정 — **순수 함수만** (이슈 #4 · `src/llm/domain` 과 같은 규칙: DB 도 LLM 도 모른다).
//
// 「턴이 끝난 뒤 앱이 할 일」 둘이 산다 — 이어하기(이슈 #2)의 `nextAfterDialogue()` 와
// 턴 API(이슈 #7)의 `nextAfterTurn()`. 세션 열기의 따라잡기 판정(이슈 #6)도 이 층 몫이다.

/** 다음 대화 장면 한 쌍 — 앱은 `code` 로 자기 스텝을 찾는다 (`이야기_세션_명세.md` 3절). */
export interface SceneRef {
  scene_id: string
  code: string
}

/** 아이 앱 응답의 `next` 한 칸 (`docs/이야기_세션_명세.md` 4.3절 · 대화턴 명세 4.2절). */
export interface NextForApp {
  kind: '발화받기' | '장면끝' | '회차끝'
  scene_id: string
  /** `장면끝` 에만 실린다 — 여는 말까지 이미 저장된 다음 대화 장면이다 (명세 4.3절). */
  next_scene?: SceneRef
}

/**
 * 턴이 끝난 뒤 앱이 할 일은 `dialogue.source` 가 정한다.
 *
 * `source === 'fixed'` 가 CLOSING 판정의 **결과**다 — 이 레포는 CLOSING 인지 두 번 보지
 * 않는다 (`llm/service/turn.ts` 규칙 1). 고정 닫는 말이 나갔으면 그 장면은 끝난 것이고
 * (결정 21·36), 아니면 아이가 같은 장면에서 계속 말할 차례다.
 *
 * ⛔ `nextStep()` 을 다시 부르지 않는 이유: `resumeTurn()` 이 CLOSING 턴 뒤에 회차를 이미
 *    닫아 두므로, 그 뒤에 재계산하면 `장면끝` 이 아니라 `회차끝`(scene 범위)이나
 *    `장면시작`(story 범위)으로 뭉개진다 — 앱이 알아야 하는 것은 「이 장면이 끝났다」다.
 */
export function nextAfterDialogue(source: 'generated' | 'fixed', scene_id: string): NextForApp {
  return source === 'fixed' ? { kind: '장면끝', scene_id } : { kind: '발화받기', scene_id }
}

/**
 * 턴 API(4.3절)의 `next` — 이어하기와 달리 **장면 전진이 같은 요청 안에서 끝난 뒤**의 판정이다.
 *
 * `next_scene` 은 엔진이 실제로 전진해 멈춘 자리다(여는 말까지 저장됨). 그래서 이 함수는
 * 재계산하지 않고 **그 사실을 계약 모양으로 옮기기만** 한다:
 *
 * - `source !== 'fixed'` — 장면이 계속된다. 같은 장면에서 `발화받기`.
 * - `fixed` + 다음 대화 장면 있음 — `장면끝` + `next_scene`.
 * - `fixed` + 없음 — `회차끝` (엔진이 세션·회차를 이미 닫았다).
 */
export function nextAfterTurn(
  source: 'generated' | 'fixed',
  scene_id: string,
  next_scene: SceneRef | null,
): NextForApp {
  if (source !== 'fixed') return { kind: '발화받기', scene_id }
  if (next_scene === null) return { kind: '회차끝', scene_id }
  return { kind: '장면끝', scene_id, next_scene }
}
