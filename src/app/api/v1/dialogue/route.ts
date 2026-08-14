// ③ 대사 — `POST /api/v1/dialogue`.
//
// 핸들러 알맹이는 `src/llm/controller/dialogue.ts` 에 있다. Next 는 라우트를 **파일 위치**로
// 찾으므로 이 파일 자체를 옮길 수 없다 — 그래서 도메인 폴더(`src/llm`)에 둔 컨트롤러를
// 여기서 다시 내보내기만 한다. 이 파일에 로직을 적지 말 것.
export { POST } from '@/llm/controller/dialogue'
