// F-4 「남의 DB 금지」의 알맹이 — **접속을 여는 순간** 터뜨린다.
//
// ## 왜 이 모양인가 (2026-08-14 · 막는 자리를 옮겼다)
//
// 전에는 `tests/setup.ts` 가 읽히는 순간 `검사_대상_가드(process.env.DATABASE_URL)` 를
// 한 번 불렀다. 그물은 확실했지만 `setupFiles` 가 **검사 파일 전부**에 걸리므로 DB 를
// 한 줄도 안 쓰는 검사까지 시작조차 못 했다 — `tests/prompts.test.ts`(프롬프트 md 파서,
// 순수 함수)가 그 피해자였고, 그 바람에 「보낼 층 자르기」가 진짜 버그를 잡고 있는지
// 아무도 볼 수 없었다.
//
// 그래서 F-1(진짜 LLM 금지)이 이미 쓰는 **「클라이언트 생성자를 감싼다」** 모양을 그대로 썼다
// (`tests/support/sdk-gate.ts`). 판정 기준이 「어느 검사 파일인가」에서 **「접속을 여느냐」**로
// 바뀐다. **허용 범위는 한 글자도 안 넓혔다** — 같은 `검사_대상_가드` 를 부른다.
//
// 🔴 우회로가 없다는 말의 근거 — 이 레포에서 접속을 여는 곳은 `src/llm/repo/db.ts` 와
//    `src/llm/db/seed.ts` 둘뿐이고, 둘 다 `import postgres from 'postgres'` 로 연다.
//    파일이 더 생겨도 postgres 에 붙으려면 같은 모듈을 부를 수밖에 없다. 이건 사람이
//    기억해야 하는 규칙이 아니라 **드라이버가 강제하는 병목**이다.
//
// ⛔ 안 고른 길 둘
//
//    · **검사 파일을 목록으로 가른다** (vitest projects / DB 전용 setupFiles) — 목록에
//      안 적힌 **새 DB 검사가 조용히 그물 밖으로 나간다.** 잊었을 때 아무도 안 아프다.
//    · **모듈을 불러오는 순간 막는다** (`vi.mock` 팩토리에서 `DATABASE_URL` 을 본다) —
//      시끄럽기는 한데 **너무 넓다.** `tests/routes.test.ts` 와 `tests/유도셋-판.test.ts` 는
//      머리말에 「DB 도 LLM 도 안 붙는다」라고 적어 둔 순수 검사인데도, 라우트가 물고 오는
//      모듈 그래프가 `repo/db.ts` 에 닿는다는 이유만으로 통째로 막혔다. 실제로 재 봤다.

import { 검사_대상_가드 } from '@/llm/db/push-guard'

/** `postgres` 모듈의 기본 내보내기 자리. 인자를 그대로 흘리기만 하므로 느슨하게 받는다. */
type PostgresFactory = (...args: unknown[]) => unknown

/**
 * 가드를 통과한 접속만 진짜 `postgres()` 로 흘리는 껍데기.
 *
 * ⚠️ `postgres.camel` 같은 **정적 붙임을 그대로 옮긴다.** 안 옮기면 그걸 쓰는 코드가
 *    「가드가 켜져 있을 때만」 다르게 죽어서 원인을 못 찾는다.
 */
export function dbGate(real: PostgresFactory): PostgresFactory {
  const gated = (...args: unknown[]): unknown => {
    거른다(args[0])
    return real(...args)
  }
  Object.assign(gated, real)
  return gated
}

/**
 * ⚠️ **여기서는 「주소가 없으면 통과」가 아니다.**
 *
 * `검사_대상_가드` 는 주소가 비면 그냥 보낸다 — DB 를 안 무는 검사 사백여 건이 그 관문을
 * 지나야 했기 때문이다. 그런데 이 자리는 **이미 접속을 여는 중**이라 사정이 정반대다.
 * `postgres()` 는 인자가 없거나 객체면 `PGHOST`·`PGDATABASE` 같은 환경변수로 알아서 붙으므로,
 * 문자열이 아닌 것을 통과시키면 **어디로 붙는지 이 그물이 볼 수 없는 접속**이 지나간다.
 * 그래서 여기서는 「모르면 거부」로 뒤집는다.
 */
function 거른다(첫_인자: unknown): void {
  try {
    if (typeof 첫_인자 !== 'string' || 첫_인자.trim() === '') {
      throw new Error(
        [
          '',
          '🔴 검사를 막았다 — `postgres()` 가 접속 문자열 없이 불렸다.',
          '',
          '   인자가 없거나 객체면 postgres 가 `PGHOST`·`PGDATABASE` 같은 환경변수로 붙는다.',
          '   그러면 어디에 붙는지 이 그물이 볼 수 없어서, 남의 DB 인지 판정할 방법이 없다.',
          '   검사에서는 접속 문자열을 문자열로 넘겨라.',
          '',
        ].join('\n'),
      )
    }
    검사_대상_가드(첫_인자)
  } catch (오류) {
    삼킴_방지(오류 instanceof Error ? 오류 : new Error(String(오류)))
    throw 오류
  }
}

// ── 삼킴 방지 ─────────────────────────────────────────────────────────────
//
// 🔴 그냥 던지기만 하면 **조용한 초록**이 된다.
//
//    DB 검사 열넷은 첫머리에서 `getDb().execute(sql`select 1`)` 를 `try/catch` 로 감싸고
//    못 붙으면 파일을 통째로 건너뛴다 (도커가 꺼졌을 때를 위한 배려다). 그 catch 는 사유를
//    안 가리므로 **가드가 막은 것까지 같이 삼켜** 「34 skipped」로 초록이 되고 종료 코드가 0 이다.
//    실제로 그렇게 나오는 것을 보고 이 절을 붙였다. 그건 옛 배선보다 **약한** 상태다.
//
//    그래서 아무도 잡을 수 없는 자리 — 다음 매크로태스크 — 에서 한 번 더 던진다.
//    vitest 는 그것을 「Unhandled Error」로 싣고 종료 코드를 1 로 만든다.
//
// ⚠️ 이 되던지기는 **`tests/setup.ts` 가 켤 때만 돈다.** 그물 자체를 재는 검사
//    (`tests/db-guard.test.ts`)는 일부러 막히는 주소를 넣어 보므로, 늘 켜져 있으면
//    그 검사가 제 손으로 만든 지뢰에 죽는다. 켜는 자리는 `vi.mock('postgres', …)` 팩토리라
//    **실제로 postgres 모듈을 문 검사에서만** 켜진다 — 켜는 것을 잊을 사람이 없다.

let 켜짐 = false
let 이미_미뤘나 = false

/** `tests/setup.ts` 의 `vi.mock('postgres', …)` 팩토리가 부른다. */
export function 삼킴방지_켜기(): void {
  켜짐 = true
}

function 삼킴_방지(오류: Error): void {
  if (!켜짐 || 이미_미뤘나) return
  이미_미뤘나 = true
  setTimeout(() => {
    throw 오류
  }, 0)
}
