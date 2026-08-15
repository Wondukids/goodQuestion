// 골든셋 채점 화면 (`/goldenset`) — 파이썬 `routes/goldenset.py` + `templates/goldenset.html`.
//
// 정답지 `goldenset/*.jsonl` 을 **읽고 · 돌리고 · 결과를 보는** 자리다.
//
// ⚠️ **정답지 파일을 쓰지 않는다.** 고치는 주소가 아예 없다. 정본은 파일이고 사람이 옮긴다
//    (`CLAUDE.md` 경계 6 의 프롬프트 규칙과 같은 원리 · FR-058 · SC-015).
//
// ⚠️ **전체를 무조건 돌리지 않는다.** 한 건씩 돌리는 길이 따로 있고, 전체 돌리기에도
//    「몇 건까지」 상한을 준다. 레이트 리밋에 걸리면 나머지가 전부 판정 불가로 떨어져
//    그날의 측정이 통째로 날아간다.
//
// ⛔ **이 화면은 계산하지 않는다.** 점수는 `lib/scoring.ts` 가, 조립은
//    `lib/service/goldenset.ts` 가 한다 (`CLAUDE.md` 경계 6).
//
// 축1 결과는 `runs` 가 아니라 골든셋 전용 표에 원자료와 지문을 함께 남긴다.
// `runs.prompt_version` 은 코드에 박힌 상수 하나를 쓰므로 사람이 올리는 것을 잊는다.
// 따라서 정답지와 분석 프롬프트의 **원문 지문**을 골든셋 판에 박제해야 전후를 가릴 수 있다.

import Link from 'next/link'
import { connection } from 'next/server'

import { 제미나이_키_번호들 } from '@/llm/config'
import { elementNames } from '@/llm/elements'
import { goldensetScreen, type GoldensetScreen } from '@/llm/service/goldenset'
import { trustworthy } from '@/llm/scoring'

import { 곁링크, 단추, 보내기, 오류상자, 입력칸, 카드, 화면머리말 } from '../ui'
import { runGoldensetAction, runGoldensetItemAction } from './actions'
import { 결과칸, 경고띠, 라벨, 소수셋, 오류띠, 요소들, 한칸 } from './ui'

export const metadata = { title: '골든셋 채점 — 굿퀘스천 관리자' }

export default async function GoldensetPage({
  searchParams,
}: {
  // ⚠️ Next 16 에서 `searchParams` 는 **프라미스**다 (`03-layouts-and-pages.md`).
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // 렌더링이 요청을 기다리게 한다 — 안 그러면 빌드 때 DB 에 붙으려 든다 (`connection.md`).
  await connection()

  const 칸들 = await searchParams
  const 오류 = 한칸(칸들.error)
  const file = 한칸(칸들.file)
  const run = 한칸(칸들.run)

  let 바탕: GoldensetScreen
  let 읽기_오류: string | null = null
  try {
    바탕 = await goldensetScreen({ file, goldenset_run_id: run })
  } catch (그것) {
    // 정답지 폴더가 비었거나, `?run=` 이 없는 판을 가리키거나, 이 화면이 못 읽는 갈래의
    // 정답지를 골랐다. **빈 화면으로 때우지 않는다.**
    읽기_오류 = 그것 instanceof Error ? `${그것.name}: ${그것.message}` : String(그것)
    return (
      <main className="flex flex-col gap-6">
        <화면머리말
          제목="정답지 채점"
          설명="사람이 미리 정답을 적어 둔 문제 모음으로, AI 가 아이 말을 얼마나 제대로 알아듣는지 잽니다."
        />
        {/* 고르는 칸이 이 화면에만 있어서, 링크가 없으면 못 읽는 파일을 고른 사람이 갇힌다. */}
        <오류상자
          무엇="정답지를 읽지 못했습니다."
          왜="정답지 폴더가 비어 있거나, 이 화면이 읽을 수 없는 형식의 정답지를 골랐을 때 이렇게 됩니다."
          어떻게="아래에서 다른 정답지를 골라 보세요. 계속 안 되면 개발 담당자에게 알려 주세요."
          원문={읽기_오류}
        />
        <p>
          <곁링크 href="/goldenset">다른 정답지 고르기 →</곁링크>
        </p>
      </main>
    )
  }

  const 결과 = 바탕.result

  return (
    <main className="flex flex-col gap-6">
      <화면머리말
        제목="정답지 채점"
        설명="사람이 미리 정답을 적어 둔 문제 모음(정답지)으로, AI 가 아이 말을 얼마나 제대로 알아듣는지 잽니다. 여기 점수는 「분석 정확도」이고, 회차 목록의 「대사 규칙 위반」과는 다른 것입니다 — 저쪽은 캐릭터가 한 말을 재고, 여기는 아이 말을 알아들었는지를 잽니다."
      />

      {오류 !== null && <오류띠 문구={오류} />}

      {바탕.draft_count > 0 && (
        <경고띠>
          <strong>이것은 아직 완성된 정답지가 아닙니다.</strong> {바탕.total_count}건 가운데{' '}
          <strong>{바탕.draft_count}건이 사람 검수를 아직 안 거친 초안</strong>입니다. 이 점수를
          품질 판단이나 보고에 쓰지 마세요. 검수를 마친 것만 재려면 아래에서 「검수를 마친 것만」을
          켜세요 (검수 마친 것 {바탕.reviewed_count}건).
        </경고띠>
      )}

      {/* 정답지 고르기. 파일이 하나뿐이면 고르는 칸을 안 띄우되 **무엇을 채점 중인가**는 보인다. */}
      <카드 제목="어느 정답지를 볼까" 설명={`${바탕.file_path} · 모두 ${바탕.total_count}건`}>
        {바탕.files.length > 1 && (
          <form method="get" action="/goldenset" className="flex flex-wrap items-end gap-3">
            <라벨 이름="정답지 고르기">
              <select name="file" className={입력칸} defaultValue={바탕.file}>
                {바탕.files.map((이름) => (
                  <option key={이름} value={이름}>
                    {이름}
                  </option>
                ))}
              </select>
            </라벨>
            <button type="submit" className={단추.보통}>
              이 정답지 보기
            </button>
          </form>
        )}
      </카드>

      <카드
        제목="채점 돌리기"
        설명="누르면 실제로 AI 를 부릅니다 — 사용료가 나가고 시간이 걸립니다."
      >
        <경고띠>
          <strong>{바탕.total_count}건을 한 번에 돌리지 마세요.</strong> AI 가 짧은 시간에 너무 많이
          불리면 나머지가 전부 「판정 못 함」으로 떨어져 그날 잰 것이 통째로 날아갑니다. 나눠 돌릴
          때는 <strong>「몇 번째부터」를 함께 옮기세요</strong> — 안 옮기면 늘 1번째부터 다시 돌아
          같은 건에 사용료가 두 번 나갑니다. 한 건씩 돌리는 단추는 아래 표 오른쪽에 따로 있습니다.
        </경고띠>
        <form action={runGoldensetAction} className="flex flex-wrap items-end gap-4">
          <input type="hidden" name="file" value={바탕.file} />
          <라벨 이름="몇 번째부터" 도움말="비우면 1번째부터">
            <input
              name="offset"
              type="number"
              min={1}
              max={바탕.total_count}
              placeholder="1"
              className={`w-36 ${입력칸}`}
            />
          </라벨>
          <라벨 이름="몇 건을" 도움말="비우면 끝까지">
            <input
              name="limit"
              type="number"
              min={1}
              max={바탕.total_count}
              placeholder={String(바탕.total_count)}
              className={`w-36 ${입력칸}`}
            />
          </라벨>
          <라벨 이름="먼저 쓸 열쇠" 도움말="AI 를 부를 때 쓰는 열쇠가 여러 개입니다">
            <select name="key" className={입력칸} defaultValue={1}>
              {제미나이_키_번호들.map((번호) => (
                <option key={번호} value={번호}>
                  {번호}번 열쇠
                </option>
              ))}
            </select>
          </라벨>
          <라벨 이름="1분에 몇 번까지" 도움말="비우면 쉬지 않고 부릅니다">
            <input
              name="per_minute"
              type="number"
              min={1}
              placeholder="제한 없음"
              className={`w-40 ${입력칸}`}
            />
          </라벨>
          <label className="flex items-center gap-2 pb-2 text-[15px] text-ink">
            <input type="checkbox" name="reviewed_only" value="1" className="accent-primary" />
            검수를 마친 것만
            <span className="text-ink-faint">({바탕.reviewed_count}건)</span>
          </label>
          {/* ⭐ AI 를 부르는 단추다 — 색과 **글자 둘 다**로 알린다 (규칙 3-6). 확인창은 쓰지
              않기로 했으므로(규칙 3-5) 단추 글자가 유일한 예고고, 중복 클릭은 `보내기` 가 막는다. */}
          <보내기 className={단추.AI} 도는중="채점하는 중…">
            정답지 전체 채점 (AI 호출)
          </보내기>
        </form>
      </카드>

      {결과 !== null && (
        <section className="flex flex-col gap-3">
          <h3 className="font-semibold">결과 — {결과.요약.돌린_수}건 돌림</h3>
          {결과.run.note !== null && <경고띠>{결과.run.note}</경고띠>}

          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 font-mono text-xs">
            {(
              [
                ['file_name', 결과.run.file_name],
                ['file_digest', 결과.run.file_digest.slice(0, 12)],
                ['file_item_count', String(결과.run.file_item_count)],
                ['prompt_digest', 결과.run.prompt_digest.slice(0, 12)],
                ['requested_model', 결과.run.requested_model],
                ['started_by', 결과.run.started_by ?? 'null'],
              ] as const
            ).map(([이름, 값]) => (
              <div key={이름} className="contents">
                <dt className="text-ink-muted">{이름}</dt>
                <dd className="break-all">{값}</dd>
              </div>
            ))}
          </dl>

          <table className="w-full max-w-2xl border-collapse text-xs">
            <thead>
              <tr className="border-b border-divider text-left">
                <th className="py-1 pr-3 font-normal">가른 것</th>
                <th className="py-1 pr-3 font-normal">건수</th>
                <th className="py-1 pr-3 font-normal">무슨 뜻인가</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-divider">
                <td className="py-1 pr-3">맞음</td>
                <td className="py-1 pr-3 font-mono">{결과.요약.맞은_수}</td>
                <td className="py-1 pr-3">의도·유효성·요소가 전부 기대와 같다</td>
              </tr>
              <tr className="border-b border-divider">
                <td className="py-1 pr-3">틀림</td>
                <td className="py-1 pr-3 font-mono">{결과.요약.틀린_수}</td>
                <td className="py-1 pr-3">답은 왔는데 기대와 다르다</td>
              </tr>
              <tr className="border-b border-divider">
                <td className="py-1 pr-3">판정 불가</td>
                <td className="py-1 pr-3 font-mono">{결과.요약.판정불가_수}</td>
                <td className="py-1 pr-3">대조하지 못함</td>
              </tr>
              <tr className="border-b border-divider font-semibold">
                <td className="py-1 pr-3">점수를 낸 항목</td>
                <td className="py-1 pr-3 font-mono">{결과.요약.판정한_수}</td>
                <td className="py-1 pr-3">판정 불가 건은 제외</td>
              </tr>
            </tbody>
          </table>

          {결과.요약.점수를_낼_수_있나 ? (
            <>
              <table className="w-full max-w-md border-collapse text-xs">
                <thead>
                  <tr className="border-b border-divider text-left">
                    <th className="py-1 pr-3 font-normal">점수</th>
                    <th className="py-1 pr-3 font-normal">값</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ['child_intent 정확도', 결과.표.child_intent_정확도],
                      ['utterance_validity 정확도', 결과.표.utterance_validity_정확도],
                      ['detected_elements 정밀도', 결과.표.요소_정밀도],
                      ['detected_elements 재현율', 결과.표.요소_재현율],
                      ['detected_elements F1', 결과.표.요소_F1],
                    ] as const
                  ).map(([이름, 값]) => (
                    <tr key={이름} className="border-b border-divider">
                      <td className="py-1 pr-3 font-mono">{이름}</td>
                      <td className="py-1 pr-3 font-mono">{소수셋(값)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!trustworthy(결과.표) && (
                <경고띠>
                  ⚠️ 위 숫자는 <strong>검수 전 정답</strong>으로 낸 것이다 (판정한{' '}
                  {결과.표.건수}건 중 초안 {결과.표.초안_건수}건).
                </경고띠>
              )}
            </>
          ) : (
            <경고띠>
              <strong>판정한 것이 하나도 없습니다.</strong> 돌린 {결과.요약.돌린_수}건이 전부 판정
              불가라 낼 점수가 없습니다.
            </경고띠>
          )}
        </section>
      )}

      <section>
        <h3 className="mb-2 font-semibold">항목 {바탕.total_count}건</h3>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-divider text-left">
                <th className="py-1 pr-3 font-normal">항목</th>
                <th className="py-1 pr-3 font-normal">아이 발화</th>
                <th className="py-1 pr-3 font-normal">기대 정답</th>
                <th className="py-1 pr-3 font-normal">돌린 결과</th>
              </tr>
            </thead>
            <tbody>
              {바탕.items.map((항목) => (
                <tr key={항목.id} className="border-b border-divider align-top">
                  <td className="py-1 pr-3">
                    <code>{항목.id}</code>
                    <br />
                    장면 {항목.scene_order} · {항목.장면_이름}
                    <br />
                    <span
                      className={
                        항목.검수 === '검수완료'
                          ? 'text-green-700'
                          : 'text-warn'
                      }
                    >
                      {항목.검수}
                    </span>
                  </td>
                  <td className="py-1 pr-3">
                    <p>{항목.child_utterance}</p>
                    <details className="mt-1 text-ink-muted">
                      <summary className="cursor-pointer">맥락과 메모</summary>
                      <p>직전 캐릭터 말: {항목.previous_character_message}</p>
                      <p>
                        찾아볼 요소: <code>{elementNames(항목.target_elements).join(', ')}</code>
                      </p>
                      {항목.메모 !== '' && <p>메모: {항목.메모}</p>}
                    </details>
                  </td>
                  <td className="py-1 pr-3 font-mono">
                    child_intent <code>{항목.정답.child_intent}</code>
                    <br />
                    utterance_validity <code>{항목.정답.utterance_validity}</code>
                    <br />
                    detected_elements <요소들 코드들={항목.정답.detected_elements} />
                  </td>
                  <결과칸
                    행={결과?.줄들.get(항목.id)}
                    기대={{
                      child_intent: 항목.정답.child_intent,
                      utterance_validity: 항목.정답.utterance_validity,
                      detected_elements: 항목.정답.detected_elements,
                    }}
                    단추={
                      <form action={runGoldensetItemAction}>
                        <input type="hidden" name="file" value={바탕.file} />
                        <input type="hidden" name="item_id" value={항목.id} />
                        <button type="submit" className="border border-divider px-2 py-0.5">
                          {결과?.줄들.has(항목.id) ? '다시 돌리기' : '이 건만 돌리기'}
                        </button>
                      </form>
                    }
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-2 font-semibold">최근 판 {바탕.recent_runs.length}건</h3>
        <p className="mb-2 text-xs text-ink-muted">
          한 판은 정답지 파일과 분석 프롬프트의 <strong>원문 지문</strong>을 함께 박제한다. 이름표는
          사람이 잊을 수 있어도 지문은 안 흔들린다.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-divider text-left">
                {['started_at', 'file_name', 'file_digest', 'prompt_digest', 'requested_model', 'note'].map(
                  (이름) => (
                    <th key={이름} className="py-1 pr-3 font-mono font-normal">
                      {이름}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {바탕.recent_runs.map((판) => (
                <tr key={판.id} className="border-b border-divider">
                  <td className="py-1 pr-3">
                    <Link
                      href={`/goldenset?file=${encodeURIComponent(판.file_name)}&run=${판.id}`}
                      className="underline"
                    >
                      {판.started_at.toISOString().slice(0, 19).replace('T', ' ')}
                    </Link>
                  </td>
                  <td className="py-1 pr-3">{판.file_name}</td>
                  <td className="py-1 pr-3 font-mono">{판.file_digest.slice(0, 12)}</td>
                  <td className="py-1 pr-3 font-mono">{판.prompt_digest.slice(0, 12)}</td>
                  <td className="py-1 pr-3 font-mono">{판.requested_model}</td>
                  <td className="py-1 pr-3">{판.note ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {바탕.recent_runs.length === 0 && (
          <p className="mt-2 text-xs text-ink-muted">아직 돌린 판이 없다.</p>
        )}
      </section>
    </main>
  )
}
