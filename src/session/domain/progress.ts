// 세션 진행 판정 — **순수 함수만** (이슈 #4 · `src/llm/domain` 과 같은 규칙: DB 도 LLM 도 모른다).
//
// 지금 사는 것은 「턴이 끝난 뒤 앱이 할 일」 하나다. 세션 열기의 따라잡기 판정(이슈 #6)과
// 턴 API 의 장면 전진 판정(이슈 #7)이 이 층에 들어온다.

/** 아이 앱 응답의 `next` 한 칸 (`docs/대화턴_이어하기_명세.md` 4.2절). */
export interface NextForApp {
  kind: '발화받기' | '장면끝'
  scene_id: string
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
