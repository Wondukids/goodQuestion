// 골든셋 화면이 쓰는 조각 (파이썬 `templates/goldenset_row.html` 자리).
//
// ⛔ **여기에 규칙이 없다.** 값을 어떻게 보이느냐만 정한다 — 맞음·틀림·판정 불가를
//    가르는 것은 `lib/scoring.ts` 의 `isCorrect()` 이고, 그 답은 이미 `ResultView` 에 들어 있다.
// ⚠️ 라우트 파일(`page.tsx`)에서 이런 것을 export 하지 않는다 — Next 가 그 파일의 export 를
//    규격으로 검사하므로, 화면 조각은 라우트가 **아닌** 파일에 둔다.

import { elementNames } from '@/llm/elements'
import type { ResultView } from '@/llm/service/goldenset'

// ⭐ `한칸`·`오류띠`·`라벨` 은 여기에도 글자까지 같은 것이 있었다. 화면 전부가 쓰므로
//    `app/(admin)/ui.tsx` 한 곳으로 모으고 여기서는 다시 내보내기만 한다 (2026-08-13).
export { 한칸, 오류띠, 라벨 } from '../ui'

export function 경고띠({ children }: { children: React.ReactNode }) {
  return (
    <p className="border border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
      {children}
    </p>
  )
}

/** 요소 코드 목록을 화면 이름으로. 비어 있으면 `(없음)` — 빈칸으로 두면 안 나온 것과 헷갈린다. */
export function 요소들({ 코드들 }: { 코드들: readonly string[] }) {
  const 이름들 = elementNames(코드들)
  return <code>{이름들.length === 0 ? '(없음)' : 이름들.join(', ')}</code>
}

/** 점수 한 칸. 파이썬 틀의 `'%.3f' | format(...)` 자리다 — 자릿수를 흔들지 않는다. */
export function 소수셋(값: number): string {
  return 값.toFixed(3)
}

const 칸_색 = (행: ResultView | undefined): string => {
  if (행 === undefined) return ''
  if (행.판정불가) return 'bg-zinc-100 dark:bg-zinc-900'
  return 행.맞음 ? 'bg-green-50 dark:bg-green-950' : 'bg-red-50 dark:bg-red-950'
}

/**
 * 항목 한 건의 결과 칸 (파이썬 `goldenset_row.html`).
 *
 * 결과가 셋 중 어디에 떨어졌는지(맞음·틀림·판정 불가)를 **먼저 말하고**, 틀렸으면 무엇이
 * 달랐는지 붙인다. ⚠️ 「안 돌림」과 「판정 불가」를 섞지 않는다 — 앞은 아직 안 부른 것이고
 * 뒤는 불렀는데 대조하지 못한 것이다.
 */
export function 결과칸({
  행,
  기대,
  단추,
}: {
  행: ResultView | undefined
  기대: { child_intent: string; utterance_validity: string; detected_elements: readonly string[] }
  단추: React.ReactNode
}) {
  return (
    <td className={`align-top py-1 pr-3 text-xs ${칸_색(행)}`}>
      {단추}
      {행 === undefined ? (
        <p className="mt-1 text-zinc-500">아직 안 돌렸습니다.</p>
      ) : 행.판정불가 ? (
        <>
          <p className="mt-1 font-semibold">판정 불가</p>
          <p className="break-all text-zinc-600 dark:text-zinc-400">{행.판정불가_사유}</p>
        </>
      ) : 행.맞음 ? (
        <>
          <p className="mt-1 font-semibold">맞음</p>
          <p className="text-zinc-600 dark:text-zinc-400">의도·유효성·요소가 전부 기대와 같습니다.</p>
        </>
      ) : (
        <>
          <p className="mt-1 font-semibold">틀림</p>
          <dl className="mt-1 flex flex-col gap-1">
            <div>
              <dt className="font-mono text-zinc-500">child_intent</dt>
              <dd>
                {행.채점?.child_intent_맞음 ? (
                  <>
                    같음 <code>{행.라벨?.child_intent}</code>
                  </>
                ) : (
                  <>
                    기대 <code>{기대.child_intent}</code> → 나온 값{' '}
                    <code>{행.라벨?.child_intent || '(빈 값)'}</code>
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-zinc-500">utterance_validity</dt>
              <dd>
                {행.채점?.utterance_validity_맞음 ? (
                  <>
                    같음 <code>{행.라벨?.utterance_validity}</code>
                  </>
                ) : (
                  <>
                    기대 <code>{기대.utterance_validity}</code> → 나온 값{' '}
                    <code>{행.라벨?.utterance_validity || '(빈 값)'}</code>
                  </>
                )}
              </dd>
            </div>
            <div>
              <dt className="font-mono text-zinc-500">detected_elements</dt>
              <dd>
                기대 <요소들 코드들={기대.detected_elements} />
                <br />
                나온 값 <요소들 코드들={행.라벨?.detected_elements ?? []} />
                {(행.채점?.놓친_요소.length ?? 0) > 0 && (
                  <>
                    <br />못 낸 것 <요소들 코드들={행.채점?.놓친_요소 ?? []} />
                  </>
                )}
                {(행.채점?.지어낸_요소.length ?? 0) > 0 && (
                  <>
                    <br />없는데 낸 것 <요소들 코드들={행.채점?.지어낸_요소 ?? []} />
                  </>
                )}
              </dd>
            </div>
          </dl>
        </>
      )}

      {행?.라벨?.main_point && (
        <p className="mt-1 text-zinc-500">
          main_point(자동 채점하지 않음): {행.라벨.main_point}
        </p>
      )}
      {행?.got_model && <p className="mt-1 font-mono text-zinc-500">got_model={행.got_model}</p>}
    </td>
  )
}
