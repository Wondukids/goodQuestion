// 화면 4 — 사람 검수 (`/review/runs/{run_id}`).
//
// 파이썬 `routes/review.py` 의 `검수_화면()` + `templates/review.html` 자리다.
//
// 🔴 **이 화면이 이 레포의 존재 이유에 가장 가깝다.** 기획자가 생성된 대사를 사람 눈으로
//    보고 점수와 교정을 남긴다. 분석·판단·대사를 한 호출로 묶지 않는 까닭이 여기 있다.
//
// ⛔ **이 화면은 계산하지 않는다** (경계 6). 턴도 판정 이력도 기준 문장도
//    `service/review.ts` 가 조립해 준 것을 그릴 뿐이고, 단추는 서버 액션이 받는다.
//
// ⚠️ 주소가 파이썬과 갈렸다 — 파이썬은 `/runs/{run_id}/review` 였다. 회차 화면 폴더
//    (`app/(admin)/runs/**`)를 건드리지 않으려고 검수 폴더 아래로 모았다.

import Link from 'next/link'
import { connection } from 'next/server'

import { elementName } from '@/llm/elements'
import {
  reviewView,
  type ReviewRecordView,
  type ReviewTurnView,
  type ReviewView,
  대사_체크리스트,
  분석_체크리스트,
  교정_고를_값,
  출처_이름,
} from '@/llm/service/review'

import { 라벨, 오류띠, 한칸 } from '../../../runs/ui'
import { analysisScoreAction, criterionAction, utteranceScoreAction } from '../../actions'

export const metadata = { title: '회차 검수 — 굿퀘스천 관리자' }

export default async function ReviewPage({
  params,
  searchParams,
}: {
  // ⚠️ Next 16 에서 `params`·`searchParams` 는 둘 다 **프라미스**다.
  params: Promise<{ run_id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await connection()
  const { run_id } = await params
  const 검색 = await searchParams
  const 오류 = 한칸(검색.error)
  const 보기 = await reviewView(run_id, Number(한칸(검색.index) ?? 0))

  return (
    <main className="flex flex-col gap-6">
      {오류 !== null && <오류띠 문구={오류} />}
      <머리 보기={보기} />
      {보기.turn === null ? (
        <p className="text-xs text-zinc-500">검수할 아이 발화가 없다.</p>
      ) : (
        <>
          <턴이동 보기={보기} />
          <article id={`turn-${보기.turn.message_id}`} className="flex flex-col gap-6">
            <발화 turn={보기.turn} />
            <분석검수 run_id={run_id} turn={보기.turn} />
            <대사검수 run_id={run_id} turn={보기.turn} />
            <요소기준 run_id={run_id} turn={보기.turn} />
            <판정이력 records={보기.records} />
          </article>
        </>
      )}
    </main>
  )
}

// ═══════════════════════════════════════════════════════════════════════════

function 머리({ 보기 }: { 보기: ReviewView }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-semibold">
          회차 검수 <span className="font-mono text-xs text-zinc-500">{보기.run.id}</span>
        </h2>
        <Link href={`/runs/${보기.run.id}`} className="text-xs underline">
          대화 보기
        </Link>
        <Link href="/review/pending" className="text-xs underline">
          보류 모아 보기
        </Link>
        <a href="/review/export/goldenset" className="text-xs underline">
          분석 정답지 내보내기
        </a>
        <a href="/review/export/utterances" className="text-xs underline">
          대사 검수 내보내기
        </a>
      </div>
      {보기.goldenset_stale && (
        <p role="alert" className="border border-amber-500 px-3 py-1 text-xs text-amber-700">
          <strong>정답지 파일이 검수 기록보다 오래됐다.</strong> 내보내 새 스냅샷으로 갱신할 것.
        </p>
      )}
      {보기.stale_count > 0 && (
        <p role="alert" className="border border-amber-500 px-3 py-1 text-xs text-amber-700">
          <strong>기준이 바뀌어 다시 볼 대상 {보기.stale_count}건</strong>이 있다.
        </p>
      )}
    </section>
  )
}

function 턴이동({ 보기 }: { 보기: ReviewView }) {
  return (
    <nav aria-label="턴 이동" className="flex items-center gap-3 font-mono text-xs">
      {보기.index > 0 && (
        <Link href={`?index=${보기.index - 1}`} className="underline">
          ← 이전 턴
        </Link>
      )}
      <span>
        {보기.index + 1} / {보기.turns.length}
      </span>
      {보기.index + 1 < 보기.turns.length && (
        <Link href={`?index=${보기.index + 1}`} className="underline">
          다음 턴 →
        </Link>
      )}
    </nav>
  )
}

function 발화({ turn }: { turn: ReviewTurnView }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="font-semibold">
        장면 {turn.scene_order} · 턴 {turn.turn_order}
      </h3>
      <p className="text-xs text-zinc-500">
        직전 캐릭터: {turn.previous_character_message ?? '없음'}
      </p>
      <p>아이: {turn.child_utterance}</p>
    </section>
  )
}

/** 판정 라디오 셋 + 걸린 항목 + 의견. 두 패널이 **같은 칸 이름**을 쓴다. */
function 판정칸({ 체크리스트 }: { 체크리스트: readonly { code: string; label: string }[] }) {
  return (
    <>
      <fieldset className="border border-zinc-300 p-2 text-xs dark:border-zinc-700">
        <legend className="text-zinc-500">판정 기준</legend>
        {체크리스트.map((항목) => (
          <label key={항목.code} className="flex items-center gap-1">
            {/* 읽는 표다. 무엇을 보고 매기는지가 폼 안에 있어야 한다. */}
            <input type="checkbox" disabled /> {항목.label}
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-wrap gap-4 border border-zinc-300 p-2 text-xs dark:border-zinc-700">
        <legend className="text-zinc-500">판정</legend>
        <label className="flex items-center gap-1">
          <input type="radio" name="value" value="pass" required /> 지킴
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name="value" value="fail" /> 넘음
        </label>
        <label className="flex items-center gap-1">
          <input type="radio" name="value" value="pending" /> 보류 — 아직 못 정하겠다
        </label>
      </fieldset>
      <라벨 이름="violated_item (넘음에 걸린 항목)">
        <select name="violated_item" className="border px-2 py-1" defaultValue="">
          <option value="">선택</option>
          {체크리스트.map((항목) => (
            <option key={항목.code} value={항목.code}>
              {항목.label}
            </option>
          ))}
        </select>
      </라벨>
      <라벨 이름="comment (의견 / 보류 이유)">
        <textarea name="comment" rows={2} className="w-full border px-2 py-1" />
      </라벨>
    </>
  )
}

function 분석검수({ run_id, turn }: { run_id: string; turn: ReviewTurnView }) {
  return (
    <section className="flex flex-col gap-2 border border-zinc-300 p-3 dark:border-zinc-700">
      <h3 className="font-semibold">분석 검수</h3>
      <p className="font-mono text-xs text-zinc-500">출처: prompts/analysis.md</p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 font-mono text-xs">
        <dt className="text-zinc-500">child_intent</dt>
        <dd>{turn.child_intent ?? 'null'}</dd>
        <dt className="text-zinc-500">main_point</dt>
        <dd className="break-all">{turn.main_point ?? 'null'}</dd>
        <dt className="text-zinc-500">찾은 사고 요소</dt>
        <dd>
          {turn.detected_element_names.length === 0 ? '없음' : turn.detected_element_names.join(', ')}
        </dd>
        <dt className="text-zinc-500">utterance_validity</dt>
        <dd>{turn.utterance_validity ?? 'null'}</dd>
      </dl>
      <form action={analysisScoreAction} className="flex flex-col gap-2">
        <input type="hidden" name="run_id" value={run_id} />
        <input type="hidden" name="message_id" value={turn.message_id} />
        <판정칸 체크리스트={분석_체크리스트} />
        <details>
          <summary className="cursor-pointer text-xs">
            이렇게 나왔어야 했다 — 분석 정답 4칸
          </summary>
          <div className="mt-2 flex flex-col gap-2">
            <라벨 이름="correction_child_intent">
              <select name="correction_child_intent" className="border px-2 py-1" defaultValue="">
                <option value="">선택</option>
                {교정_고를_값.child_intents.map((값) => (
                  <option key={값} value={값}>
                    {값}
                  </option>
                ))}
              </select>
            </라벨>
            <라벨 이름="correction_main_point">
              <textarea name="correction_main_point" rows={2} className="w-full border px-2 py-1" />
            </라벨>
            <라벨 이름="correction_detected_elements">
              <input
                name="correction_detected_elements"
                placeholder="까닭, 입장"
                className="w-full border px-2 py-1"
              />
            </라벨>
            <라벨 이름="correction_utterance_validity">
              <select
                name="correction_utterance_validity"
                className="border px-2 py-1"
                defaultValue=""
              >
                <option value="">선택</option>
                {교정_고를_값.validities.map((값) => (
                  <option key={값} value={값}>
                    {값}
                  </option>
                ))}
              </select>
            </라벨>
          </div>
        </details>
        <button type="submit" className="w-fit border border-zinc-700 px-3 py-1 font-semibold">
          분석 판정 남기기
        </button>
      </form>
    </section>
  )
}

function 대사검수({ run_id, turn }: { run_id: string; turn: ReviewTurnView }) {
  return (
    <section className="flex flex-col gap-2 border border-zinc-300 p-3 dark:border-zinc-700">
      <h3 className="font-semibold">캐릭터 대사 검수</h3>
      <p className="font-mono text-xs text-zinc-500">출처: prompts/character.md</p>
      {/* ⭐ 이 턴에 대사가 없으면 「응답 없음」이다. 다음 턴 대사를 빌려 오지 않는다 (FR-048). */}
      <blockquote className="border-l-2 border-zinc-400 pl-2">
        {turn.character_utterance ?? '응답 없음'}
      </blockquote>
      <form action={utteranceScoreAction} className="flex flex-col gap-2">
        <input type="hidden" name="run_id" value={run_id} />
        <input type="hidden" name="message_id" value={turn.message_id} />
        <판정칸 체크리스트={대사_체크리스트} />
        <라벨 이름="correction_text (이렇게 말했어야 했다)">
          <textarea name="correction_text" rows={2} className="w-full border px-2 py-1" />
        </라벨>
        <button type="submit" className="w-fit border border-zinc-700 px-3 py-1 font-semibold">
          대사 판정 남기기
        </button>
      </form>
    </section>
  )
}

/**
 * 장면별 요소 기준.
 *
 * 🔴 **모든 문장은 「초안」이다** (FR-044d · 헌법 원칙 IV). 전문가 확인 전에는 품질의
 * 근거로 쓰지 않는다 — 그래서 출처를 고르는 칸이 아예 없다.
 */
function 요소기준({ run_id, turn }: { run_id: string; turn: ReviewTurnView }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold">장면별 요소 기준</h3>
      <p className="text-xs text-zinc-500">
        <strong>모든 문장은 「{출처_이름.draft}」다.</strong> 전문가 확인 전에는 품질의 근거로
        쓰지 않는다.
      </p>
      {turn.criteria.length === 0 ? (
        <p className="text-xs text-zinc-500">아직 적힌 기준 문장이 없다.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-xs">
          {turn.criteria.map((기준) => (
            <li key={`${기준.element}-${기준.version}`}>
              <strong>{elementName(기준.element)}</strong> — {기준.criterion}{' '}
              <mark className="bg-amber-200 px-1 dark:bg-amber-900">
                {출처_이름[기준.origin] ?? 기준.origin}
              </mark>{' '}
              기준 {기준.version}판
            </li>
          ))}
        </ul>
      )}
      <form action={criterionAction} className="flex flex-col gap-2">
        <input type="hidden" name="scene_id" value={turn.scene_id} />
        <input type="hidden" name="run_id" value={run_id} />
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
          <textarea name="criterion" rows={2} required className="w-full border px-2 py-1" />
        </라벨>
        <button type="submit" className="w-fit border border-zinc-700 px-3 py-1 font-semibold">
          기준 문장 남기기
        </button>
      </form>
    </section>
  )
}

/** 이 턴의 판정 이력. **덧붙이기 전용**이라 다시 매겨도 앞 판정이 남는다 (FR-047). */
function 판정이력({ records }: { records: ReviewRecordView[] }) {
  if (records.length === 0) {
    return <p className="text-xs text-zinc-500">아직 사람이 매긴 판정이 없다.</p>
  }
  const 판정_글 = (value: number | null) =>
    value === 1 ? '지킴' : value === 0 ? '넘음' : '보류'
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold">이 턴의 판정 이력 {records.length}건</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-zinc-400 text-left">
              {['대상', '판정', '항목', '사람', '기준', '시각'].map((이름) => (
                <th key={이름} className="py-1 pr-3 font-normal">
                  {이름}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((기록) => (
              <tr key={기록.id} className="border-b border-zinc-200 dark:border-zinc-800">
                <td className="py-1 pr-3">{기록.target_label}</td>
                <td className="py-1 pr-3">
                  {판정_글(기록.value)}
                  {기록.is_latest && ' (현재)'}
                </td>
                <td className="py-1 pr-3">{기록.violated_item_label}</td>
                <td className="py-1 pr-3">{기록.graded_by}</td>
                <td className="py-1 pr-3">
                  기준 {기록.criteria_version ?? 0}판
                  {기록.needs_review && <strong className="ml-1">다시 볼 대상</strong>}
                </td>
                <td className="py-1 pr-3 font-mono">
                  {new Date(기록.created_at).toISOString().slice(0, 19).replace('T', ' ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
