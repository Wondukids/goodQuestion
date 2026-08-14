'use client'

// 보내는 동안 자기를 잠그는 제출 단추 (이슈 #26 · 2026-08-13 회차가 멈춘 건).
//
// 🔴 **왜 이 파일이 생겼나 — 파이썬에 있던 성질을 되찾는 것이다.**
//
// 파이썬 `run_body.html` 은 턴을 202 로 받고 htmx 가 1초마다 `/runs/{id}/status` 를 물었다.
// 그래서 **도는 동안 발화 폼이 화면에서 사라졌고**, 사람이 두 번 누를 자리가 없었다
// (`{% elif progress %}` 갈래).
//
// 이식본은 서버 액션이 **동기**다. ① 은 LLM 을 기다리느라 6초쯤 걸리는데 그동안 화면은
// 아무 표시도 없이 그대로 서 있다. 2026-08-13 사람이 3.2초를 기다리다 다시 눌렀고,
// 둘째 호출이 회차 잠금(`inProgress`)에 걸려 409 `TURN_IN_PROGRESS` 로 튕겼다.
// 첫 호출은 그 뒤 분석을 정상으로 저장했지만, 화면에 남은 것은 오류 띠뿐이었다.
//
// ⛔ **여기에 규칙이 없다.** 잠금 자체는 여전히 서버(`service/run.inProgress`)가 한다 —
//    이 단추는 사람이 잠금에 부딪히지 않게 막을 뿐이고, 잠금을 대신하지 않는다.
//    JS 가 아직 안 붙은 순간에는 안 먹으므로 서버 쪽 잠금이 마지막 문지기다.

import { useFormStatus, type FormStatus } from 'react-dom'

/** 서버 액션 하나의 모양. `formAction` prop 과 `useFormStatus().action` 이 같은 값이다. */
type 액션 = (폼: FormData) => void | Promise<void>

/**
 * 「어느 단추를 눌렀나」를 폼에 실어 보내는 칸 이름.
 *
 * ⚠️ 서버 액션은 이 칸을 **안 읽는다.** 화면이 제 단추를 알아보려고 붙이는 표시일 뿐이고,
 *    액션들은 자기가 쓸 칸만 골라 읽으므로(`actions.ts` 의 `칸(폼, …)`) 남아도 해가 없다.
 *    JS 가 안 붙은 브라우저도 이 칸을 그냥 같이 보낼 뿐 동작이 달라지지 않는다.
 */
export const 눌린_단추_칸 = 'pressed'

/**
 * 지금 도는 것이 **이 단추**인가.
 *
 * 🔴 **`useFormStatus().pending` 만 보면 안 되는 까닭** (2026-08-13 거짓 문구).
 *    `pending` 은 **폼 단위**라 한 폼의 단추 둘이 같은 값을 본다. 그래서 「① 분석만」을 눌러도
 *    옆 단추가 「한 턴 도는 중… (LLM 2회)」로 바뀌었다 — 실제로 나가는 LLM 은 1회인데
 *    화면이 2회라고 말한 것이다. 직전 커밋 `a1724ce`(없는 단추를 가리키던 자리)와 같은 종류다.
 *
 * ⛔ **잠금은 이 판정과 무관하다.** 안 눌린 단추도 `pending` 이면 잠긴다 — 도는 중에 다른
 *    단추를 누르면 409 `TURN_IN_PROGRESS` 이기 때문이다. 여기서 가르는 것은 **글자**뿐이다.
 *
 * ⭐ 눌린 단추를 알아보는 길이 **둘**인 것은 React 19 가 그렇게 생겼기 때문이다
 *    (`react-dom/cjs/react-dom-client.development.js` 의 `extractEvents$1`):
 *    - 단추에 `formAction` 이 있으면 React 는 그것을 `status.action` 으로 올리고
 *      **submitter 를 버린다** — 그래서 그 단추의 `name`/`value` 는 `data` 에 안 들어온다.
 *    - `formAction` 이 없는 단추(=폼의 `action` 을 쓰는 단추)면 submitter 가 살아 있어
 *      `createFormDataWithSubmitter()` 가 `name`/`value` 를 `data` 에 넣어 준다.
 *    둘 다 보므로 어느 쪽이 눌렸어도 하나는 맞는다.
 */
export function 도는_단추인가(
  상태: FormStatus,
  단추: { formAction?: 액션; 표식?: string },
): boolean {
  if (!상태.pending) return false
  // 단추가 하나뿐인 폼 — 가를 것이 없다. 도는 것은 그 단추다.
  if (단추.표식 === undefined && 단추.formAction === undefined) return true
  if (단추.표식 !== undefined && 상태.data.get(눌린_단추_칸) === 단추.표식) return true
  if (단추.formAction !== undefined && 상태.action === 단추.formAction) return true
  return false
}

/**
 * ⚠️ **이 함수만 이름이 영어다.** `react-hooks/rules-of-hooks` 가 「대문자로 시작하면
 *    컴포넌트」로 훅 자리를 판별하는데, 한글 이름은 대문자가 없어 컴포넌트로 안 쳐 준다.
 *    검사를 끄는 대신 이름을 맞추고, 화면이 쓰는 이름은 아래에서 `보내기` 로 내보낸다.
 */
function SubmitButton({
  children,
  className = 'border border-zinc-700 px-3 py-1 font-semibold',
  도는중 = '보내는 중…',
  formAction,
  표식,
}: {
  children: React.ReactNode
  className?: string
  /** 눌린 뒤 글자. LLM 이 나가는 단추는 몇 초씩 걸려서 이 표시가 있어야 한다. */
  도는중?: string
  /**
   * 한 폼에 단추가 둘일 때 **이 단추만** 다른 서버 액션으로 보낸다
   * (React 19 / Next 16 · `next/dist/docs/01-app/02-guides/forms.md:458`).
   * 안 주면 폼의 `action` 그대로다.
   *
   * ⚠️ 폼을 둘로 쪼개는 대신 이것을 쓴다 — 쪼개면 발화 입력칸이 갈라져 사람이 두 번 적어야 한다.
   */
  formAction?: 액션
  /**
   * 한 폼에 단추가 둘일 때 **어느 것이 눌렸나**를 가르는 이름. 단추의 `name`/`value` 로 나가
   * `useFormStatus().data` 로 돌아온다. 단추가 하나뿐인 폼에서는 안 준다.
   */
  표식?: string
}) {
  // ⚠️ `useFormStatus` 는 **폼 안**에서만 값이 온다. 폼 밖에서 쓰면 언제나 `pending: false` 다.
  //    ⭐ 한 폼의 단추 **둘 다** 같은 `pending` 을 본다 — 어느 쪽이 눌렸어도 나머지 하나가
  //    함께 잠긴다. 그게 맞다: 도는 동안 다른 단추를 누르면 409 `TURN_IN_PROGRESS` 다.
  //    ⛔ **잠기는 것과 글자가 바뀌는 것은 다른 일이다** — 글자는 눌린 단추만 바꾼다.
  const 상태 = useFormStatus()

  // 🔴 **`formAction` 이 있는 단추에는 `name`/`value` 를 얹지 않는다.** React 가 그 자리에
  //    액션 id(`$ACTION_ID_…`)를 넣어야 해서 우리 이름을 **덮어쓰고**, 개발 콘솔에 이렇게
  //    찍는다 — 「Cannot specify a "name" prop for a button that specifies a function as a
  //    formAction. … It will get overridden.」
  //    (`react-dom/cjs/react-dom-server.node.development.js` 의 `pushFormActionAttribute`.
  //     실측 2026-08-13: 이름은 HTML 에서 사라지고 `value` 만 남아 남의 칸에 얹힌다.)
  //    ⛔ 그러니 그 단추의 표식은 **어차피 아무 데도 안 닿는다** — 서버로도, `data` 로도.
  //    가르는 길은 `status.action` 쪽 하나뿐이고 `도는_단추인가()` 가 그것을 본다.
  const 이름 = 표식 === undefined || formAction !== undefined ? undefined : 눌린_단추_칸
  return (
    <button
      type="submit"
      formAction={formAction}
      name={이름}
      value={이름 === undefined ? undefined : 표식}
      disabled={상태.pending}
      className={`${className} disabled:cursor-not-allowed disabled:opacity-50`}
    >
      {도는_단추인가(상태, { formAction, 표식 }) ? 도는중 : children}
    </button>
  )
}

export { SubmitButton as 보내기 }
