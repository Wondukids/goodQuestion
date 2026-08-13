// 한 턴의 LLM 시도 화면 조각 (이슈 #26 E-3 · C-2 · C-3 · C-4).
//
// 파이썬 htmx 조각 **둘**을 한 쪽에 합친 것이다 —
// `templates/run_calls.html`(표) + `templates/run_prompt.html`(원문 셋).
// 조각이 둘이었던 것은 htmx 가 펼칠 때 따로 받아 오려던 것이고(`hx-get` · `toggle once`),
// 서버 렌더링에는 그 왕복이 없다. 값은 이미 한 번에 실려 온다.
//
// ⛔ **여기에 규칙이 없다.** 값을 어떻게 보이느냐만 정한다 — `runs/ui.tsx` 와 같은 잣대다.
// ⚠️ 라우트 파일(`page.tsx`)에서 이런 것을 export 하지 않는다. Next 가 그 파일의 export 를
//    규격으로 검사하므로 화면 조각은 라우트가 **아닌** 이 파일에 둔다.
//    (검사가 이 조각을 그대로 렌더해 보는 자리이기도 하다 — `tests/cost.test.ts`.)

import type { AttemptView, TurnAttemptsView } from '@/lib/service/view'

/**
 * 금액 한 칸. **모르면 「모름」이고 0 을 찍지 않는다.**
 *
 * 소수 여섯 자리로 끊는 것은 파이썬 틀(`run_calls.html:16` 의 `"%.6f"`)과 같다 —
 * 한 호출이 0.000几 달러라 여기서 더 끊으면 전부 0.00 이 된다.
 */
export function 금액(값: number | null, 통화: string | null): string {
  if (값 === null) return '모름'
  return 통화 === null ? 값.toFixed(6) : `${값.toFixed(6)} ${통화}`
}

/** 토큰 한 칸. `null` 은 「모름」이다 — 0 과 다르다. */
function 토큰(값: number | null): string {
  return 값 === null ? '모름' : String(값)
}

const 칸 = 'border border-zinc-300 px-2 py-1 align-top dark:border-zinc-700'

/**
 * 시도 표. 열은 파이썬 `run_calls.html:5` 그대로다 —
 * 용도/번호 · 실제 공급자·모델 · 강도 · 결과 · 토큰 · 비용 · 시간 · 원문.
 */
export function 시도표({ 시도들 }: { 시도들: TurnAttemptsView }) {
  const { attempts, totals } = 시도들
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold">LLM 시도 {totals.attempt_count}건</h3>
      {attempts.length === 0 && (
        <p className="text-xs text-zinc-500">
          호출 없음 (전개 또는 고정 대사만 재생한 턴이면 정상)
        </p>
      )}
      {attempts.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left">
                {['용도/번호', '실제 공급자·모델', '강도', '결과', '토큰', '비용', '시간', '원문'].map(
                  (이름) => (
                    <th key={이름} className={`${칸} font-mono text-zinc-500`}>
                      {이름}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {attempts.map((시도) => (
                <시도줄 key={시도.id} 시도={시도} 통화={totals.통화} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="font-mono text-xs">
        합계: {totals.duration_ms}ms · 입력 토큰 {토큰(totals.input_tokens)} · 출력 토큰{' '}
        {토큰(totals.output_tokens)}
      </p>
      <p className="font-mono text-xs">비용: {금액(totals.cost, totals.통화)}</p>
    </section>
  )
}

function 시도줄({ 시도, 통화 }: { 시도: AttemptView; 통화: string | null }) {
  return (
    <tr>
      <td className={`${칸} font-mono whitespace-nowrap`}>
        {시도.purpose === 'analysis' ? '분석' : '캐릭터'} #{시도.attempt_no}
      </td>
      <td className={`${칸} font-mono`}>
        {시도.provider} · {시도.model}
        {/* ⭐ 고른 모델과 다르면 굵게. fallback 이 돌았는지 **눈으로 봐야 한다**
            (`CLAUDE.md` 「로그」 절 · 파이썬 `run_calls.html:11`). */}
        {시도.model_differs && (
          <>
            <br />
            <strong>고른 모델 {시도.selected_model}과 다름</strong>
          </>
        )}
        {시도.selected_model === null && (
          // 견줄 대상이 없다. 「같다」고 말하지 않는다 — 회차에 안 박혔다고 말한다.
          <>
            <br />
            <span className="text-zinc-500">고른 모델이 회차에 안 박혀 있다 (설정 기본값)</span>
          </>
        )}
      </td>
      <td className={`${칸} font-mono`}>{시도.effort ?? '강도 없음'}</td>
      <td className={칸}>
        {시도.ok ? '성공' : <span className="text-amber-700">실패 · {시도.error}</span>}
      </td>
      <td className={`${칸} font-mono whitespace-nowrap`}>
        입력 {토큰(시도.input_tokens)} · 출력 {토큰(시도.output_tokens)}
      </td>
      <td className={`${칸} font-mono whitespace-nowrap`}>{금액(시도.cost, 통화)}</td>
      <td className={`${칸} font-mono whitespace-nowrap`}>{시도.duration_ms}ms</td>
      <td className={칸}>
        <원문 시도={시도} />
      </td>
    </tr>
  )
}

/**
 * 보낸 것과 받은 것 그대로 (파이썬 `run_prompt.html`).
 *
 * 🔴 **요약하지 않는다.** 프롬프트를 고쳐 가며 견주는 것이 이 레포의 존재 이유라,
 *    실제로 나간 글자가 그대로 보여야 한다.
 */
function 원문({ 시도 }: { 시도: AttemptView }) {
  return (
    <details className="max-w-[48rem]">
      <summary className="cursor-pointer">원문 펼치기</summary>
      <원문칸 이름="보낸 시스템 프롬프트" 글={시도.system_text} />
      <원문칸 이름="보낸 사용자 입력" 글={시도.user_text} />
      <원문칸 이름="받은 응답 원문" 글={시도.response_text ?? '응답 없음'} />
    </details>
  )
}

function 원문칸({ 이름, 글 }: { 이름: string; 글: string }) {
  return (
    <div className="mt-2 flex flex-col gap-1">
      <h4 className="font-mono text-xs text-zinc-500">{이름}</h4>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all bg-zinc-100 p-2 font-mono text-xs dark:bg-zinc-900">
        {글}
      </pre>
    </div>
  )
}
