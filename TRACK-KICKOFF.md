# TRACK-KICKOFF — 이슈 #2 · LLM 대화 턴 이어하기

> 이 워크트리는 https://github.com/Wondukids/goodQuestion/issues/2 를 진행하는 트랙이다.
> 기반: `api_team` (명세 커밋 02bf6db 포함) · 브랜치: `rlaqudwn1/issue-2-turn-resume`

## 계약 문서 — 이것이 정본이다

**`docs/대화턴_이어하기_명세.md`** 를 먼저 통독하라. 이슈 #2 본문은 그 요약이다.
명세와 이 파일이 어긋나면 명세가 이긴다.

## 한 줄 목표

끊긴 대화 턴을 **죽은 단계부터 마저 돌리는** 것을 아이 앱 계약으로 노출한다.
새 규칙은 0 — 엔진의 `resumeTurn()`·`pendingTurn()`(`src/llm/service/run.ts`)이 이미
전부 알고 있고, 이 트랙은 그것을 세션 도메인의 컨트롤러·서비스로 엮는 일이다.

## 작업 순서 제안

1. `src/llm/README.md` 로 층 규칙을 익힌다 (controller → service → repo, 위에서 아래로만).
2. 명세 4절의 계약대로 컨트롤러를 세운다:
   - `POST /api/sessions/{session_id}/turns/resume` — body 없음
   - 미완 턴이 있을 때 새 발화를 막는 409 `TURN_INCOMPLETE` (기존 `analysisStep()` 문지기 재사용)
3. 세션 id → 회차 매핑은 `runOfSession()`. **아이 앱 세션에 회차가 없으면 이 길이 막힌다** —
   명세 6절의 전제(세션 생성 시 `started_by='app'` 회차 동반 생성)가 아직 미구현이면,
   이 트랙에서는 회차가 있는 세션을 전제로 하고 그 사실을 PR 본문에 적어라.
4. 검사: 명세 8절 수용 기준 여섯을 그대로 테스트로 옮긴다 (`tests/` 의 기존 방식 —
   바깥 트랜잭션으로 되돌리는 패턴 참조: `tests/repo.test.ts`).

## 지키는 것 (명세 5절 불변 조건)

- 아이 `messages` 행을 새로 만들지 않는다 — 행 수·턴 카운트 불변.
- `character` 에서 죽은 턴은 재판정하지 않는다 — 박제된 `turn_conditions` 그대로.
- 캐릭터 행이 이미 있으면 덮어쓴다. 행을 늘리지 않는다.
- CLOSING 이면 캐릭터 LLM 을 부르지 않는다.

## 비스코프 — 손대지 말 것

이야기 수준 이어하기 · TTS/오디오 저장 · `client_turn_id` 중복 방지 · 다중 인스턴스 잠금.
전부 별도 이슈다 (명세 7절).

## 완료 정의

- 명세 8절 수용 기준 6개가 테스트로 존재하고 초록이다.
- `pnpm typecheck` · `pnpm lint` · `pnpm test` 통과.
- PR 은 `api_team` 을 향한다. 본문에 이슈 #2 를 연결한다 (`Closes #2` 는 리뷰 후 판단).
