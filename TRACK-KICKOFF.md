# TRACK-KICKOFF — 이슈 #18 미션 도메인·엔진

> 이 트랙: 브랜치 `rlaqudwn1/issue-18-mission-engine` · 베이스 `api_team`(`852a15a`).
> 병렬 트랙 #17(스키마·시드)·#20(프론트)이 동시에 돈다 — **파일 경계를 지켜라**(아래).
> 관례: 머지 전 마지막 커밋에서 이 파일을 걷어낸다.

## 목표

미션 턴의 판정 순수 함수 2개와 프롬프트 2벌, 재료 조립을 만든다.
이슈: https://github.com/Wondukids/goodQuestion/issues/18
**정본: `docs/미션_명세.md` 4·5·9절** — 먼저 읽어라(1·2·3절 포함).
핵심 결정 M2: 미션 턴은 일반 턴의 분석→판정→대사 3단을 그대로 타고, **판정 함수와
캐릭터 프롬프트만 미션판**이다. 분석은 기존 `analysis` 프롬프트 재사용 — 신설 금지.

## 할 일

1. **순수 함수 2개** — `src/llm/domain/` 에, `decide.ts` 와 같은 결(import 0, 열거·표 주석):
   - 트리거 판정: `(config.trigger.any_elements ∈ 이번 감지 ∪ 씬 누적) OR (아이 턴 수 ≥
     min_turns)`. 그리고 **닫힘 게이트**: 미션 씬에서 미션 완료 전에 `decide()` 가
     CLOSING 을 내면 CLOSING 대신 트리거를 발동한다 (명세 5절).
   - 미션 턴 판정: 요소 합산 대상 계산(씬 턴 수·유도 카운터는 건드리지 않는다 — M3),
     스텝 진행, SHORT/UNCLEAR 되묻기 1회 (M9 — 두 미션 공통, 스텝당 1회).
   - 입력 타입은 **plain 객체로 자체 정의**한다 — config 모양은 명세 6절 jsonc 가 정본.
     드리즐 스키마(`src/llm/db/**`)를 import 하지 마라(#17 트랙 소유·경합 방지).
2. **프롬프트 2벌** — 폴더 두 파일 체제(`보낼것.md` + `해설.md`), 한 줄바꿈은 LF:
   - `prompts/mission_reply` — 아이대답요약. 재료 모양은 명세 9절
     (`direction.kind: "summary_reply" | "bridge_into_mission"`). 기존
     `prompts/character/보낼것.md` 의 언어·구조(영어 본문)와 경계 규칙 결을 따른다.
   - `prompts/mission_summary` — 종료 요약. `guidance.remaining_worry` 가 있으면
     그 걱정을 묻는 질문으로 끝나게 지시.
   - 경계(둘 다): 정답 판정 금지("맞았어/틀렸어" — 미션1은 어느 소품이든 정답),
     요소 코드·명칭 노출 금지, 새 설정 발명 금지.
   - ⚠️ `prompts/README.md` 는 일부 낡았다 — 로딩 규칙의 정본은
     `src/llm/prompts/render.ts`/`parse.ts` 다.
3. **재료 조립** — `src/llm/engine/mission.ts` (신규): 명세 9절의 재료 JSON 을 만들고
   `chooseBody()` + `complete(purpose:'mission_reply'|'mission_summary')` 로 호출.
   기존 `engine/material.ts`·`character.ts` 의 결(무엇을 넣고 무엇을 일부러 빼는지 주석)을
   따른다. `engine/analyze.ts`·`material.ts`·`character.ts` 는 **수정하지 않는다**.
4. `tests/prompts.test.ts` 의 프롬프트 이름 목록에 두 폴더를 추가한다.
5. 순수 함수 단위 테스트 — 기존 domain 테스트 스타일로.

## 만지지 말 것 (다른 트랙 소유)

- `sql/**`, `src/llm/db/**` → #17
- `src/stories/**`, `src/session/**`, `src/app/**` → #20·#19
- `prompts/analysis|character|child|judge_*/**` 기존 폴더 — 수정 금지.
- `purpose` 문자열은 `'mission_reply'`/`'mission_summary'` 로 고정 (#17 이 CHECK 를 넓힌다.
  DB 없이도 코드·테스트는 돌 수 있게 하라 — provider 호출은 목으로).

## 끝났다고 말할 수 있는 조건 (이슈 #18 본문과 동일)

- 대화3 시나리오: SOLUTION 감지 턴에 트리거 참, 없어도 아이 턴 2회면 참.
  대화4: PERSPECTIVE 첫 턴 즉발 (M7).
- 미션 턴 판정 결과가 요소 합산분만 내놓고 턴 카운트·유도 카운터를 건드리지 않는다.
- SHORT 첫 시도 → 되묻기 지시, 두 번째 → 그대로 진행.
- `pnpm test` 에서 프롬프트 검사 포함 이 트랙 관련 검사가 초록.

## 환경 함정 (레포 공통)

- 새 체크아웃이라 `pnpm install` 먼저.
- **프롬프트 md 가 CRLF 로 체크아웃되면 프롬프트 검사가 가짜로 붉어진다** — 새로 만드는
  파일은 LF 로 쓰고, 기존 검사 실패가 보이면 줄바꿈부터 의심.
- DB 안 쓰는 검사만 돌리면 된다(이 트랙은 DB 불필요). lint 기존 오류 3건
  (`play/page.tsx`·`interactive-scene.tsx`)은 이 트랙 책임 아님 — 건드리지 마라.

## 마무리

1. 커밋은 레포 스타일(한국어 현재형, 예: `feat(llm): 미션 판정과 프롬프트 2벌을 만든다`).
2. 이 파일을 걷는 커밋을 마지막에 얹고, 브랜치를 origin 에 푸시.
3. `gh pr create --base api_team` — 본문에 이슈 `#18` 링크. **머지는 사용자 몫.**
4. 체크포인트마다 `orca worktree set --worktree active --comment "..."`.
