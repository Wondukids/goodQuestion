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
import { 값, 경고상자, 단추, 빈자리, 입력칸, 카드, 화면머리말 } from '../../ui'
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

      <화면머리말
        제목="검수 — 기준을 정해야 할 자리"
        설명="아이가 한 말을 AI 가 판정하다가 「모르겠다」고 넘긴 것들이 여기 모입니다. 모르겠다고 넘긴 것은 성적에서 아예 빠지므로, 여기가 비어 있을수록 성적을 믿을 수 있습니다. 각 건마다 「이 장면에서는 이런 뜻이다」를 적어 두면 다음부터 AI 가 그 기준으로 판정합니다."
        곁들이기={
          <a
            href="/review/export/goldenset"
            className="text-[14px] font-bold text-primary-strong underline"
          >
            정답지로 내보내기
          </a>
        }
      />

      {보기.goldenset_stale && (
        <경고상자>
          <b>정답지 파일이 검수 기록보다 오래됐습니다.</b> 여기서 정한 기준이 아직 정답지에
          반영되지 않았다는 뜻입니다 — 위 「정답지로 내보내기」로 내려받아 파일을 갱신하세요.
        </경고상자>
      )}

      <카드
        제목="아직 기준이 없는 것"
        설명="AI 가 판정하지 못하고 넘긴 것들입니다."
        곁들이기={
          <span className="text-[15px] font-bold text-ink-muted">{보기.pending.length}건</span>
        }
      >
        {보기.pending.length === 0 ? (
          <빈자리
            무엇="판정을 넘긴 것이 없습니다."
            다음="AI 가 모든 말을 판정했다는 뜻입니다. 회차를 더 돌려 보면 여기에 쌓일 수 있습니다."
          />
        ) : (
          <ul className="flex flex-col gap-4">
            {보기.pending.map((보류) => (
              <li
                key={보류.id}
                className="flex flex-col gap-2 rounded-2xl border border-divider p-4"
              >
                <p className="text-[13px] text-ink-faint">
                  {보류.scene_order}번째 장면 · {보류.turn_order}번째 차례 · {보류.target_label} ·
                  판정한 것: {보류.graded_by}
                </p>
                <p className="text-[16px] text-ink">
                  <span className="font-bold">아이:</span> {보류.child_utterance}
                </p>
                <p className="text-[14px] text-ink-muted">
                  못 정한 이유: <값 것={보류.comment} 없을때="적혀 있지 않음" />
                </p>
                <Link
                  href={`/review/runs/${보류.run_id}#turn-${보류.message_id}`}
                  className="w-fit text-[14px] font-bold text-primary-strong underline"
                >
                  이 회차 열어서 다시 보기 →
                </Link>
                <details className="mt-1">
                  <summary className="w-fit cursor-pointer text-[14px] font-bold text-ink">
                    이 장면의 기준 적기
                  </summary>
                  <form action={criterionAction} className="mt-3 flex flex-col gap-3">
                    <input type="hidden" name="scene_id" value={보류.scene_id} />
                    <input type="hidden" name="run_id" value={보류.run_id} />
                    <라벨 이름="어떤 것에 대한 기준인가">
                      <select name="element" required className={`w-fit ${입력칸}`}>
                        {교정_고를_값.elements.map(([코드, 이름]) => (
                          <option key={코드} value={코드}>
                            {이름}
                          </option>
                        ))}
                      </select>
                    </라벨>
                    <라벨
                      이름="이 장면에서 그것은 어떤 것인가"
                      도움말="다음부터 AI 가 이 문장을 기준으로 판정합니다"
                    >
                      <textarea name="criterion" rows={2} required className={`w-full ${입력칸}`} />
                    </라벨>
                    <p className="text-[13px] text-ink-muted">
                      적은 것은 <b>{출처_이름.draft}</b> 로만 저장됩니다 — 원본 설정을 건드리지
                      않으니 마음 편히 적으셔도 됩니다.
                    </p>
                    {/* ⭐ 되돌릴 수 있는 저장이라 보통 단추다 (규칙 3-5 갈래 A). */}
                    <button type="submit" className={`w-fit ${단추.보통}`}>
                      기준 저장
                    </button>
                  </form>
                </details>
              </li>
            ))}
          </ul>
        )}
      </카드>
    </main>
  )
}
