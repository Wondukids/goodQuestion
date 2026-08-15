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
import {
  값,
  개발자용,
  경고상자,
  곁링크,
  단추,
  빈자리,
  입력칸,
  카드,
  화면머리말,
} from '../../../ui'
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
        <빈자리
          무엇="이 회차에는 검수할 아이 말이 없습니다."
          다음="아이가 아직 말한 적이 없는 회차입니다. 회차를 더 진행한 뒤 다시 오세요."
        />
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
    <section className="flex flex-col gap-3">
      <화면머리말
        제목="이 회차 검수하기"
        설명="아이가 한 말을 AI 가 제대로 알아들었는지, 캐릭터가 한 말이 규칙을 지켰는지 사람이 직접 보고 판정하는 곳입니다. 아이가 말한 차례를 하나씩 넘겨 가며 봅니다."
        곁들이기={
          <span className="flex flex-wrap items-baseline gap-4">
            <곁링크 href={`/runs/${보기.run.id}`}>← 이 회차의 대화 보기</곁링크>
            <곁링크 href="/review/pending">기준을 정해야 할 것 모아 보기 →</곁링크>
          </span>
        }
      />
      <p className="flex flex-wrap items-center gap-4">
        <a
          href="/review/export/goldenset"
          className="text-[14px] font-bold text-primary-strong underline"
        >
          아이 말 판정을 정답지로 내보내기
        </a>
        <a
          href="/review/export/utterances"
          className="text-[14px] font-bold text-primary-strong underline"
        >
          캐릭터 대사 판정 내보내기
        </a>
      </p>
      {보기.goldenset_stale && (
        <경고상자>
          <b>정답지 파일이 검수 기록보다 오래됐습니다.</b> 여기서 매긴 판정이 아직 정답지에
          반영되지 않았다는 뜻입니다 — 위 「정답지로 내보내기」로 내려받아 갱신하세요.
        </경고상자>
      )}
      {보기.stale_count > 0 && (
        <경고상자>
          <b>기준이 바뀌어 다시 봐야 할 것이 {보기.stale_count}건 있습니다.</b> 판정한 뒤에 그
          장면의 기준 문장이 바뀌어서, 지금 기준으로는 판정이 달라질 수 있습니다.
        </경고상자>
      )}
    </section>
  )
}

function 턴이동({ 보기 }: { 보기: ReviewView }) {
  return (
    <nav
      aria-label="차례 이동"
      className="flex items-center gap-4 rounded-2xl bg-chip px-5 py-3 text-[15px]"
    >
      {보기.index > 0 ? (
        <Link href={`?index=${보기.index - 1}`} className="font-bold text-primary-strong underline">
          ← 앞 차례
        </Link>
      ) : (
        <span className="text-ink-faint">← 앞 차례</span>
      )}
      <span className="font-bold text-ink">
        아이가 말한 {보기.turns.length}번 가운데 {보기.index + 1}번째
      </span>
      {보기.index + 1 < 보기.turns.length ? (
        <Link href={`?index=${보기.index + 1}`} className="font-bold text-primary-strong underline">
          다음 차례 →
        </Link>
      ) : (
        <span className="text-ink-faint">다음 차례 →</span>
      )}
    </nav>
  )
}

function 발화({ turn }: { turn: ReviewTurnView }) {
  return (
    <카드
      제목={`${turn.scene_order}번째 장면 · ${turn.turn_order}번째 차례`}
      설명="이 차례에 오간 말입니다. 아래에서 이 말들을 판정합니다."
    >
      <div className="flex flex-col gap-3">
        <p className="text-[15px] text-ink-muted">
          <span className="font-bold">직전에 캐릭터가 한 말:</span>{' '}
          <값 것={turn.previous_character_message} 없을때="없음 (이 차례가 처음입니다)" />
        </p>
        <p className="rounded-2xl bg-primary-soft px-5 py-4 text-[17px] text-ink">
          <span className="font-bold">아이:</span> {turn.child_utterance}
        </p>
      </div>
    </카드>
  )
}

/** 판정 라디오 셋 + 걸린 항목 + 의견. 두 패널이 **같은 칸 이름**을 쓴다. */
function 판정칸({ 체크리스트 }: { 체크리스트: readonly { code: string; label: string }[] }) {
  return (
    <>
      <fieldset className="rounded-2xl border border-divider p-4">
        <legend className="px-1 text-[14px] font-bold text-ink-soft">
          무엇을 보고 판정하나
        </legend>
        <div className="flex flex-col gap-1 text-[15px] text-ink">
          {체크리스트.map((항목) => (
            /* 읽는 표다. 무엇을 보고 매기는지가 폼 안에 있어야 한다. */
            <span key={항목.code}>· {항목.label}</span>
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-wrap gap-6 rounded-2xl border border-divider p-4">
        <legend className="px-1 text-[14px] font-bold text-ink-soft">판정</legend>
        <label className="flex items-center gap-2 text-[15px] text-ink">
          <input type="radio" name="value" value="pass" required className="accent-primary" />
          잘했다
        </label>
        <label className="flex items-center gap-2 text-[15px] text-ink">
          <input type="radio" name="value" value="fail" className="accent-primary" />
          잘못했다
        </label>
        <label className="flex items-center gap-2 text-[15px] text-ink">
          <input type="radio" name="value" value="pending" className="accent-primary" />
          아직 못 정하겠다
        </label>
      </fieldset>
      <라벨 이름="무엇이 잘못됐나" 도움말="「잘못했다」를 골랐을 때만 고릅니다">
        <select name="violated_item" className={`w-fit ${입력칸}`} defaultValue="">
          <option value="">고르기</option>
          {체크리스트.map((항목) => (
            <option key={항목.code} value={항목.code}>
              {항목.label}
            </option>
          ))}
        </select>
      </라벨>
      <라벨 이름="남길 말" 도움말="「아직 못 정하겠다」를 골랐다면 왜 그런지 적어 주세요">
        <textarea name="comment" rows={2} className={`w-full ${입력칸}`} />
      </라벨>
    </>
  )
}

function 분석검수({ run_id, turn }: { run_id: string; turn: ReviewTurnView }) {
  return (
    <카드
      제목="① AI 가 아이 말을 제대로 알아들었나"
      설명="위의 아이 말을 AI 가 이렇게 이해했습니다. 맞게 이해했는지 판정해 주세요."
    >
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-[15px]">
        <dt className="font-bold text-ink-soft">아이가 하려던 것</dt>
        <dd className="text-ink">
          <값 것={turn.child_intent} 없을때="알아내지 못함" />
        </dd>
        <dt className="font-bold text-ink-soft">아이가 한 말의 요지</dt>
        <dd className="break-all text-ink">
          <값 것={turn.main_point} 없을때="알아내지 못함" />
        </dd>
        <dt className="font-bold text-ink-soft">찾아낸 생각 조각</dt>
        <dd className="text-ink">
          <값
            것={
              turn.detected_element_names.length === 0
                ? null
                : turn.detected_element_names.join(', ')
            }
            없을때="하나도 못 찾음"
          />
        </dd>
        <dt className="font-bold text-ink-soft">말이 되는 답이었나</dt>
        <dd className="text-ink">
          <값 것={turn.utterance_validity} 없을때="판정 못 함" />
        </dd>
      </dl>
      <개발자용 제목="이 판정을 만든 지시문">
        <p className="font-mono text-[12px] text-ink">prompts/analysis.md</p>
      </개발자용>
      <form action={analysisScoreAction} className="flex flex-col gap-3">
        <input type="hidden" name="run_id" value={run_id} />
        <input type="hidden" name="message_id" value={turn.message_id} />
        <판정칸 체크리스트={분석_체크리스트} />
        <details>
          <summary className="w-fit cursor-pointer text-[15px] font-bold text-ink">
            정답은 이랬어야 한다고 적어 두기
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <라벨 이름="아이가 하려던 것">
              <select
                name="correction_child_intent"
                className={`w-fit ${입력칸}`}
                defaultValue=""
              >
                <option value="">고르기</option>
                {교정_고를_값.child_intents.map((값) => (
                  <option key={값} value={값}>
                    {값}
                  </option>
                ))}
              </select>
            </라벨>
            <라벨 이름="아이가 한 말의 요지">
              <textarea name="correction_main_point" rows={2} className={`w-full ${입력칸}`} />
            </라벨>
            <라벨 이름="찾아냈어야 할 생각 조각" 도움말="쉼표로 나눠 적습니다">
              <input
                name="correction_detected_elements"
                placeholder="까닭, 입장"
                className={`w-full ${입력칸}`}
              />
            </라벨>
            <라벨 이름="말이 되는 답이었나">
              <select
                name="correction_utterance_validity"
                className={`w-fit ${입력칸}`}
                defaultValue=""
              >
                <option value="">고르기</option>
                {교정_고를_값.validities.map((값) => (
                  <option key={값} value={값}>
                    {값}
                  </option>
                ))}
              </select>
            </라벨>
          </div>
        </details>
        {/* ⭐ 되돌릴 수 있는 저장이라 보통 단추다 (규칙 3-5 갈래 A) — 다시 판정하면 덮인다. */}
        <button type="submit" className={`w-fit ${단추.보통}`}>
          이 판정 저장
        </button>
      </form>
    </카드>
  )
}

function 대사검수({ run_id, turn }: { run_id: string; turn: ReviewTurnView }) {
  return (
    <카드
      제목="② 캐릭터가 한 말이 규칙을 지켰나"
      설명="아이 말을 듣고 캐릭터가 이렇게 답했습니다. 하면 안 되는 말을 하지 않았는지 판정해 주세요."
    >
      {/* ⭐ 이 턴에 대사가 없으면 「응답 없음」이다. 다음 턴 대사를 빌려 오지 않는다 (FR-048). */}
      <blockquote className="rounded-2xl bg-chip px-5 py-4 text-[17px] text-ink">
        {turn.character_utterance ?? (
          <span className="text-ink-faint">캐릭터가 답하지 못했습니다.</span>
        )}
      </blockquote>
      <개발자용 제목="이 대사를 만든 지시문">
        <p className="font-mono text-[12px] text-ink">prompts/character.md</p>
      </개발자용>
      <form action={utteranceScoreAction} className="flex flex-col gap-3">
        <input type="hidden" name="run_id" value={run_id} />
        <input type="hidden" name="message_id" value={turn.message_id} />
        <판정칸 체크리스트={대사_체크리스트} />
        <라벨 이름="이렇게 말했어야 한다" 도움말="더 나은 대사가 떠오르면 적어 주세요">
          <textarea name="correction_text" rows={2} className={`w-full ${입력칸}`} />
        </라벨>
        <button type="submit" className={`w-fit ${단추.보통}`}>
          이 판정 저장
        </button>
      </form>
    </카드>
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
    <카드
      제목="③ 이 장면의 판정 기준 적기"
      설명="「이 장면에서 그것은 이런 뜻이다」를 적어 두면, 다음부터 AI 가 이 문장을 기준으로 판정합니다."
    >
      <p className="text-[14px] text-ink-muted">
        <b>여기 적은 모든 문장은 「{출처_이름.draft}」입니다.</b> 전문가 확인 전에는 품질을
        따지는 근거로 쓰지 않으니 마음 편히 적으셔도 됩니다.
      </p>
      {turn.criteria.length === 0 ? (
        <빈자리
          무엇="이 장면에는 아직 적힌 기준이 없습니다."
          다음="아래에서 첫 기준을 적어 보세요."
        />
      ) : (
        <ul className="flex flex-col gap-2 text-[15px]">
          {turn.criteria.map((기준) => (
            <li key={`${기준.element}-${기준.version}`} className="text-ink">
              <b>{elementName(기준.element)}</b> — {기준.criterion}{' '}
              <span className="rounded-md bg-warn-soft px-2 py-0.5 text-[12px] font-bold text-warn">
                {출처_이름[기준.origin] ?? 기준.origin}
              </span>{' '}
              <span className="text-[13px] text-ink-faint">{기준.version}번째로 고친 것</span>
            </li>
          ))}
        </ul>
      )}
      <form action={criterionAction} className="flex flex-col gap-3">
        <input type="hidden" name="scene_id" value={turn.scene_id} />
        <input type="hidden" name="run_id" value={run_id} />
        <라벨 이름="어떤 것에 대한 기준인가">
          <select name="element" required className={`w-fit ${입력칸}`}>
            {교정_고를_값.elements.map(([코드, 이름]) => (
              <option key={코드} value={코드}>
                {이름}
              </option>
            ))}
          </select>
        </라벨>
        <라벨 이름="이 장면에서 그것은 어떤 것인가">
          <textarea name="criterion" rows={2} required className={`w-full ${입력칸}`} />
        </라벨>
        <button type="submit" className={`w-fit ${단추.보통}`}>
          기준 저장
        </button>
      </form>
    </카드>
  )
}

/** 이 턴의 판정 이력. **덧붙이기 전용**이라 다시 매겨도 앞 판정이 남는다 (FR-047). */
function 판정이력({ records }: { records: ReviewRecordView[] }) {
  const 판정_글 = (value: number | null) =>
    value === 1 ? '잘했다' : value === 0 ? '잘못했다' : '못 정함'
  return (
    <카드
      제목="지금까지 매긴 판정"
      설명="판정은 덮어쓰지 않고 쌓입니다. 다시 매겨도 앞의 판정이 기록에 남습니다."
      곁들이기={<span className="text-[15px] font-bold text-ink-muted">{records.length}건</span>}
    >
      {records.length === 0 ? (
        <빈자리
          무엇="아직 사람이 매긴 판정이 없습니다."
          다음="위 ①②에서 판정을 저장하면 여기에 쌓입니다."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-divider text-left text-ink-muted">
                {['무엇을', '판정', '무엇이 잘못됐나', '매긴 사람', '언제'].map((이름) => (
                  <th key={이름} className="py-2 pr-4 font-bold">
                    {이름}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((기록) => (
                <tr key={기록.id} className="border-b border-divider">
                  <td className="py-2 pr-4">{기록.target_label}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {판정_글(기록.value)}
                    {기록.is_latest && (
                      <span className="ml-2 rounded-md bg-primary-soft px-2 py-0.5 text-[12px] font-bold text-primary-strong">
                        지금 값
                      </span>
                    )}
                    {기록.needs_review && (
                      <span className="ml-2 rounded-md bg-warn-soft px-2 py-0.5 text-[12px] font-bold text-warn">
                        다시 봐야 함
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <값 것={기록.violated_item_label} />
                  </td>
                  <td className="py-2 pr-4">{기록.graded_by}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {new Date(기록.created_at).toISOString().slice(0, 16).replace('T', ' ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </카드>
  )
}
