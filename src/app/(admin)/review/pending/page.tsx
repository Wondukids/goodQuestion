// 화면 4-b — 보류 모아 보기 (`/review/pending`).
//
// 파이썬 `routes/review.py` 의 `보류_화면()` + `templates/review_pending.html` 자리다.
//
// 🔴 **보류는 분모에서 빠진다** (FR-045a·b) — 「모르겠다」를 「지킴」으로 세면 위반율이
//    조용히 낮아진다. 그 대신 빠진 것이 **눈에 보이는 자리**가 이 화면이고, 여기서 바로
//    그 장면의 기준 문장을 적을 수 있다. 그래서 제목이 「기준을 정해야 할 자리」다.
//
// ⛔ 이 화면도 계산하지 않는다 (경계 6). `service/review.pendingView()` 가 준 목록을 그린다.

import Link from 'next/link'
import { connection } from 'next/server'

import { pendingView, 교정_고를_값, 출처_이름 } from '@/llm/service/review'

import { 라벨, 오류띠, 한칸 } from '../../runs/ui'
import { criterionAction } from '../actions'

export const metadata = { title: '보류 검수 — 굿퀘스천 관리자' }

export default async function PendingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await connection()
  const 오류 = 한칸((await searchParams).error)
  const 보기 = await pendingView()

  return (
    <main className="flex flex-col gap-6">
      {오류 !== null && <오류띠 문구={오류} />}

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <h2 className="font-semibold">기준을 정해야 할 자리 — 보류 {보기.pending.length}건</h2>
          <Link href="/runs" className="text-xs underline">
            회차 목록
          </Link>
          <a href="/review/export/goldenset" className="text-xs underline">
            분석 정답지 내보내기
          </a>
        </div>
        {보기.goldenset_stale && (
          <p role="alert" className="border border-amber-500 px-3 py-1 text-xs text-amber-700">
            <strong>정답지 파일이 검수 기록보다 오래됐다.</strong>
          </p>
        )}
      </section>

      {보기.pending.length === 0 ? (
        <p className="text-xs text-zinc-500">보류한 판정이 없다.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {보기.pending.map((보류) => (
            <li
              key={보류.id}
              className="flex flex-col gap-2 border border-zinc-300 p-3 dark:border-zinc-700"
            >
              <p className="font-mono text-xs text-zinc-500">
                장면 {보류.scene_order} · 턴 {보류.turn_order} · {보류.target_label} ·{' '}
                {보류.graded_by}
              </p>
              <p>아이: {보류.child_utterance}</p>
              <p className="text-xs">못 정한 이유: {보류.comment ?? '(없음)'}</p>
              <Link
                href={`/review/runs/${보류.run_id}#turn-${보류.message_id}`}
                className="w-fit text-xs underline"
              >
                다시 검수 →
              </Link>
              <details>
                <summary className="cursor-pointer text-xs">이 장면의 기준 쓰기</summary>
                <form action={criterionAction} className="mt-2 flex flex-col gap-2">
                  <input type="hidden" name="scene_id" value={보류.scene_id} />
                  <input type="hidden" name="run_id" value={보류.run_id} />
                  <라벨 이름="element">
                    <select name="element" required className="w-fit border px-2 py-1">
                      {교정_고를_값.elements.map(([코드, 이름]) => (
                        <option key={코드} value={코드}>
                          {이름} ({코드})
                        </option>
                      ))}
                    </select>
                  </라벨>
                  <라벨 이름="criterion (이 장면에서 이 요소는 이런 것)">
                    <textarea
                      name="criterion"
                      rows={2}
                      required
                      className="w-full border px-2 py-1"
                    />
                  </라벨>
                  <p className="text-xs text-zinc-500">
                    <mark className="bg-amber-200 px-1 dark:bg-amber-900">{출처_이름.draft}</mark>
                    으로만 저장된다.
                  </p>
                  <button
                    type="submit"
                    className="w-fit border border-zinc-700 px-3 py-1 font-semibold"
                  >
                    기준 남기기
                  </button>
                </form>
              </details>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
