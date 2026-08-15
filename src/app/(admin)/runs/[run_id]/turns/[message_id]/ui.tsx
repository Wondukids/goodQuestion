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

import type { AttemptView, ScoreRow, TurnAttemptsView } from '@/llm/service/view'

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

const 칸 = 'border border-divider px-2 py-1 align-top'

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
        <p className="text-xs text-ink-muted">
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
                    <th key={이름} className={`${칸} font-mono text-ink-muted`}>
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

/**
 * 판정 한 칸의 표기. **세 상태가 눈으로 갈려야 한다** (`lib/judge.ts` 「점수 규칙」).
 *
 * 🔴 `null` 을 「지킴」처럼 보이게 하지 않는다. 이 채점기의 핵심 규칙이 「**`null` 은 통과가
 * 아니다**」이고 (결정 29), 회색 「지킴」과 회색 「판정 안 함」이 같아 보이면 화면이 그 규칙을
 * 깨뜨린다. 그래서 위반은 빨간 굵은 글씨, 판정 안 함은 회색 물음표, 지킴만 초록이다.
 */
function 판정표기(값: number | null): { 글: string; 꾸밈: string } {
  if (값 === null) return { 글: '판정 안 함', 꾸밈: 'text-ink-muted' }
  if (값 === 0) return { 글: '위반', 꾸밈: 'font-bold text-danger' }
  // ⚠️ 제품 토큰만 쓴다 (규칙 1-7). 여기 초록은 Tailwind 기본 팔레트였고 견본과 색이 갈렸다.
  return { 글: '지킴', 꾸밈: 'font-bold text-ok' }
}

/**
 * 이 턴에서 어느 검사가 걸렸나 (경계 채점기 `lib/judge.ts` → `scores`, `graded_by='auto'`).
 *
 * 🔴 **검사 이름을 그대로 찍는다** (`fabricated_fixed_line`·`closing_generated`·
 *    `scene_goal_leak` · 심판을 켰다면 셋 더). `CLAUDE.md` 로그 절의 「DB 컬럼명을 그대로
 *    찍는다」와 같은 이유다 — 화면에서 본 이름으로 `scores` 를 바로 찾을 수 있어야 한다.
 *
 * ⭐ `comment` 가 이 표의 알맹이다. **위반일 때 무엇이 걸렸는지가 거기에만 있다**
 *    (「고정 첫 대사를 그대로 만들어 냈다」 · 「장면 목표의 «…» 가 대사에 그대로 나왔다」).
 *    판정 안 함일 때도 왜 안 쟀는지가 거기 있다.
 *
 * ⛔ **사람이 매긴 판정은 여기 없다.** 그쪽은 `/review` 화면이고 `graded_by <> 'auto'` 로
 *    자동 채점을 뺀다. 두 이력을 섞지 않는 것이 원래 설계다.
 */
export function 경계채점표({ 채점들 }: { 채점들: readonly ScoreRow[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold">경계 채점 {채점들.length}건</h3>
      {채점들.length === 0 && (
        <p className="text-xs text-ink-muted">
          채점 행 없음 (채점기를 끄고 돌린 턴이거나, 전개만 재생한 턴이면 정상)
        </p>
      )}
      {채점들.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left">
                {['check_name', '판정', 'comment', 'target'].map((이름) => (
                  <th key={이름} className={`${칸} font-mono text-ink-muted`}>
                    {이름}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {채점들.map((행) => {
                const { 글, 꾸밈 } = 판정표기(행.value)
                return (
                  <tr key={행.id}>
                    <td className={`${칸} font-mono whitespace-nowrap`}>{행.check_name}</td>
                    <td className={`${칸} whitespace-nowrap`}>
                      <span className={꾸밈}>{글}</span>{' '}
                      <span className="font-mono text-ink-muted">
                        value={행.value === null ? 'null' : 행.value.toFixed(1)}
                      </span>
                    </td>
                    {/* 위반일 때 **무엇이 걸렸는지**가 여기 있다. 요약하지 않는다. */}
                    <td className={칸}>{행.comment === null || 행.comment === '' ? '—' : 행.comment}</td>
                    <td className={`${칸} font-mono whitespace-nowrap`}>{행.target}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink-muted">
        ⚠️ <strong>「판정 안 함」은 통과가 아니다</strong> — 검사 조건이 아예 안 섰거나 심판을 믿을
        수 없었다는 뜻이고, 회차 목록의 위반율에서 <strong>분모에서 빠진다</strong> (결정 29).
      </p>
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
            <span className="text-ink-muted">고른 모델이 회차에 안 박혀 있다 (설정 기본값)</span>
          </>
        )}
      </td>
      <td className={`${칸} font-mono`}>{시도.effort ?? '강도 없음'}</td>
      <td className={칸}>
        {시도.ok ? '성공' : <span className="text-warn">실패 · {시도.error}</span>}
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
      <h4 className="font-mono text-xs text-ink-muted">{이름}</h4>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all bg-chip p-2 font-mono text-xs text-ink">
        {글}
      </pre>
    </div>
  )
}
