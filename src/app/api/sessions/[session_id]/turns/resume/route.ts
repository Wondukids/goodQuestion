// 끊긴 턴 이어하기 — `POST /api/sessions/{session_id}/turns/resume` (이슈 #2).
//
// 핸들러 알맹이는 `src/session/controller/turn-resume.ts` 에 있다. Next 는 라우트를
// **파일 위치**로 찾으므로 이 파일 자체를 옮길 수 없다 — 그래서 도메인 폴더(`src/session`)에
// 둔 컨트롤러를 여기서 다시 내보내기만 한다. 이 파일에 로직을 적지 말 것.
export { POST } from '@/session/controller/turn-resume'
