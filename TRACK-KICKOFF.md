# TRACK-KICKOFF — 이슈 #20 미션 프론트 배선

> 이 트랙: 브랜치 `rlaqudwn1/issue-20-mission-frontend` · 베이스 `api_team`(`852a15a`).
> 병렬 트랙 #17(스키마)·#18(엔진)이 동시에 돌고, 서버 미션 API(#19)는 **아직 없다** —
> 이 트랙은 명세의 API 계약을 목(mock)으로 세워 배선을 끝내 두는 트랙이다.
> 관례: 머지 전 마지막 커밋에서 이 파일을 걷어낸다.

## 목표

미니게임 두 개를 서버 트리거·미션 API 계약에 맞게 배선한다 — 단, 서버가 없으므로
계약 모양의 목 어댑터로 전 흐름이 돌게 만든다.
이슈: https://github.com/Wondukids/goodQuestion/issues/20
**정본: `docs/미션_명세.md` 7·8·10절** (결정 M6·M8·M9 포함) — 먼저 읽어라.

## 할 일

1. **미션 API 클라이언트** — `src/stories/fart-bride/session-api.ts` 에 명세 7절 계약대로:
   `submitMissionEvent(sid, msid, {type, value})` ·
   `submitMissionTurn(sid, msid, blob, channelCount)` · `completeMission(sid, msid)`.
   경로·봉투·오류 코드(`MISSION_IN_PROGRESS`/`MISSION_NOT_ACTIVE`)는 명세 그대로,
   기존 `submitSessionTurn` 의 언랩·재시도 결을 따른다.
2. **목 어댑터** — 미션 컴포넌트가 위 함수 3개 모양의 객체를 주입받게 하고,
   `/dev/minigame` 은 목 구현(고정 지연 + 명세 7절 응답 예시 모양)을 주입한다.
   목에는 **되묻기 케이스(M9)** 와 `미션끝`→`complete` 체인이 포함돼야 개발 화면만으로
   전 흐름을 볼 수 있다. `play.tsx` 는 실구현을 주입한다(서버가 없으면 지금은
   트리거가 안 올 뿐 — 코드 경로는 완성).
3. **팝업 열기 신호 교체** — `play.tsx` 의 SPACE 순환 리스너를 아이 앱에서 제거하고
   `/dev/minigame` 전용으로 격리(알려진 부채). 실제 열기는 턴 응답
   `next.kind === "미션시작"` 처리 지점을 만들어 둔다(서버 오면 바로 붙게).
4. **prop 배선** — `MinigamePopup` → 각 미션에 `sessionId · missionSessionId · config ·
   missionApi(위 3함수)` 전달. config 모양은 명세 6절 jsonc 가 정본 — 임의 변경 금지.
5. **재생 순서 (M8)** — 다리 대사는 대화 패널이 재생을 마친 뒤 팝업 열기.
   **팝업이 열린 동안 배경·대화 오디오 일시정지**(지금은 뒤에서 소리가 계속 나는
   알려진 동작 — `play.tsx:50-53` 주석 참고). 종료 요약·닫는 말은 팝업 닫힌 뒤 패널에서.
6. **답변 컷 스킵 (M6)** — `completeMission` 응답이 `장면끝`이면 그 대화 스텝의 답변
   컷을 건너뛰고 다음 스텝으로. 대화 턴 경유 닫힘은 기존 동작 그대로 둔다.
7. **미션 발화 전송 교체** — `mission1.tsx`/`mission2.tsx` 의 `transcribeAudio(blob, ch)`
   를 `missionApi.submitMissionTurn` 으로 교체(시그니처가 이미 같은 모양이다).
   캐릭터 대사는 응답 텍스트를 앱 TTS(`use-npc-voice` 결)로, 호출 실패 시 기존 로컬
   스크립트 폴백. 무음 `{empty:true}` 는 기존 STT 재시도 연출, 소진 시
   `events({type:'skip'})`.
8. **미션2 「6자 미만」 되묻기 규칙 삭제** — 서버(목) 판정의 되묻기 응답으로 대체(M9).
9. `after: "stt-minigame"` 표식은 편집기 전용으로 둔다 — 재생 코드에 배선하지 마라.

## 만지지 말 것 (다른 트랙 소유)

- `sql/**`, `src/llm/**`, `src/session/**`, `prompts/**`, `tests/*.test.ts`(백엔드) → #17·#18·#19
- `video-plan.json` 의 `scene` 번호 — **절대 건드리지 마라.** 질문 컷 scene 이
  `SCENE_CODES` 키(4·7·10·16)와 일치해야 서버 모드가 돈다(알려진 머지 함정).
- 미션 화면의 시안 레이아웃·에셋 — 이 트랙은 배선만, 디자인 변경 없음.

## 끝났다고 말할 수 있는 조건 (이슈 #20 본문 + 목 전제)

- `/dev/minigame` 에서 목으로: 소품 선택→대답→요약 대사→부탁 질문→대답→요약→
  `미션끝`→complete→종료 요약까지 전 흐름이 돌고, 되묻기 케이스도 재현된다.
- 미션2: 카드 선택→대답→감탄(요약) 대사→"다른 친구도?"→반복/종료가 돈다.
- 팝업이 열린 동안 배경 소리가 멎는다. SPACE 는 아이 앱 재생 화면에서 아무 일도 안 한다.
- 답변 컷 스킵 분기가 코드에 있고(목 `장면끝` 으로 확인), 기존 대화 씬 동작은 불변.
- lint/빌드 초록 (기존 부채 3건 제외).

## 환경 함정 (레포 공통)

- 새 체크아웃이라 `pnpm install` 먼저. dev 서버: 3000에 옛 서버가 살아 있으면 3001로
  뜬다. Next 16 은 같은 폴더에 두 번째 dev 서버를 거부한다(이 워크트리는 별도 폴더라 무관).
- lint 기존 오류 3건(`play/page.tsx`·`interactive-scene.tsx` react-hooks)은 기존 부채 —
  고치려 들지 마라(스코프 밖).
- TTS 429 가 잦다 — 목 검증에는 TTS 실패 폴백(글로 남기기)이 이미 있으니 그대로 두라.

## 마무리

1. 커밋은 레포 스타일(한국어 현재형, 예: `feat(minigame): 미션을 서버 계약에 배선한다`).
2. 이 파일을 걷는 커밋을 마지막에 얹고, 브랜치를 origin 에 푸시.
3. `gh pr create --base api_team` — 본문에 이슈 `#20` 링크와 `/dev/minigame` 검증 요지,
   그리고 "서버 #19 착지 후 목→실전환 확인 필요" 를 남긴다. **머지는 사용자 몫.**
4. 체크포인트마다 `orca worktree set --worktree active --comment "..."`.
