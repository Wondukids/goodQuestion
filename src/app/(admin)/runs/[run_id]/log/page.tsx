// 화면 3 — 턴 로그 (`/runs/{run_id}/log`). 회차 전체를 되짚는 자리다.
//
// 🔴 **이 화면이 `turn_conditions` 를 읽는 이유** — `story_sessions` 는 매 턴 덮어써서
//    지난 턴의 모드·누적 요소·카운터가 어디에도 안 남는다. 그래서 판정 당시 값을 그 표에
//    박제했고(FR-011 · SC-005), 그러라고 세운 표를 읽는 곳이 여기다.
//
// ⛔ **판정을 다시 계산하지 않는다.** 박제된 값을 되살려 `[분석] [상태] [판정]` 세 줄을
//    **글자 그대로** 찍는다 (`CLAUDE.md` 로그 절 — 지우거나 요약하지 말 것).
//    스냅샷이 없는 턴이면 「없다」고 말한다. 꾸며 내지 않는다.

import { connection } from 'next/server'

import { runDetail, type RunDetail } from '@/llm/service/view'

import { 개발자용, 곁링크, 빈자리, 카드, 화면머리말 } from '../../../ui'
import { 로그세줄, 시도링크 } from '../../ui'

export const metadata = { title: '턴 로그 — 굿퀘스천 관리자' }

export default async function TurnLogPage({
  params,
}: {
  params: Promise<{ run_id: string }>
}) {
  await connection()
  const { run_id } = await params
  const 상세 = await runDetail(run_id)
  const 아이턴 = 상세.messages.filter((행) => 행.speaker_type === 'child')

  return (
    <main className="flex flex-col gap-6">
      <화면머리말
        제목={`차례별 기록 · ${상세.session.story_title}`}
        설명="이 회차에서 오간 말을 처음부터 끝까지 순서대로 되짚어 봅니다. 아이가 말한 차례마다 AI 가 그때 무엇을 보고 어떻게 판단했는지도 함께 남아 있습니다."
        곁들이기={<곁링크 href={`/runs/${상세.run.id}`}>← 이 회차로 돌아가기</곁링크>}
      />

      {/* 규칙 1-6 — 목록 앞에 숫자 요약. */}
      <카드 제목="한눈에">
        <dl className="flex flex-wrap gap-x-10 gap-y-3">
          {(
            [
              ['오간 말', `${상세.messages.length}줄`],
              ['아이가 말한 횟수', `${아이턴.length}번`],
              [
                '판단 기록이 남은 차례',
                `${아이턴.filter((행) => 행.turn_condition !== null).length}번`,
              ],
              ['지나온 장면', `${상세.scene_pages.length}개`],
            ] as const
          ).map(([이름, 값]) => (
            <div key={이름} className="flex flex-col gap-0.5">
              <dt className="text-[13px] text-ink-muted">{이름}</dt>
              <dd className="text-[20px] font-extrabold text-ink">{값}</dd>
            </div>
          ))}
        </dl>
      </카드>

      <쪽목록 상세={상세} />

      <카드
        제목="오간 말"
        설명="위에서부터 순서대로입니다."
        곁들이기={
          <span className="text-[15px] font-bold text-ink-muted">{상세.messages.length}줄</span>
        }
      >
        {상세.messages.length === 0 ? (
          <빈자리
            무엇="아직 오간 말이 없습니다."
            다음="회차를 진행하면 여기에 쌓입니다."
          />
        ) : (
          상세.messages.map((행) => (
            <article key={행.id} className="rounded-2xl border border-divider p-4">
              <p className="text-[13px] text-ink-faint">
                {행.scene_order}번째 장면 · {행.turn_order}번째 차례 ·{' '}
                {행.speaker_type === 'child' ? '아이' : '캐릭터'}
              </p>
              <p className="my-2 text-[16px] text-ink">
                {행.speaker_type === 'character' && (
                  <span className="mr-1 font-bold text-ink-muted">
                    {행.character_name ?? ''}:
                  </span>
                )}
                {행.text}
              </p>
              {(상세.fallback.get(행.id) ?? []).map((시도) => (
                <p
                  key={`${시도.purpose}-${시도.attempt_no}`}
                  className="rounded-xl border border-warn bg-warn-soft px-3 py-2 text-[13px] text-warn"
                >
                  고르려던 AI 가 답하지 못해 다른 AI 가 대신 답했습니다 — {시도.provider}/
                  {시도.model} (고르려던 것: {시도.chosen_model})
                </p>
              ))}
              {행.speaker_type === 'child' && (
                <>
                  {/* 🔴 규칙 1-1 — 화면에는 사람 말, 원문 로그는 접어 둔다. */}
                  <개발자용 제목="AI 가 그때 본 것과 판단">
                    <로그세줄 줄들={행.log_lines} />
                  </개발자용>
                  {행.character_response === null && (
                    // 「바로 다음 한 행」이 이 장면의 캐릭터가 아니었다 — 이 턴은 대사를 못 받았다.
                    <p className="mt-2 text-[14px] font-bold text-warn">
                      이 차례에는 캐릭터가 답하지 못했습니다.
                    </p>
                  )}
                  {/* 되짚는 자리에서 「무엇을 보내고 무엇이 답했나」로 내려가는 길. */}
                  <p className="mt-2">
                    <시도링크 run_id={상세.run.id} message_id={행.id} />
                  </p>
                </>
              )}
            </article>
          ))
        )}
      </카드>
    </main>
  )
}

/**
 * 도달한 장면까지의 쪽 나누기.
 *
 * 대화 장면 하나 = 쪽 하나이고 앞선 전개가 그 대화에 딸린다. 아직 안 간 장면은 쪽으로
 * 만들지 않는다 — 있지도 않은 대화를 빈 쪽으로 보여 주면 「여기까지 왔다」를 잘못 읽는다.
 */
function 쪽목록({ 상세 }: { 상세: RunDetail }) {
  if (상세.scene_pages.length === 0) return null
  return (
    <카드 제목="지나온 장면" 설명="아이가 대화한 장면들입니다. 아직 안 간 장면은 나오지 않습니다.">
      <ol className="flex flex-wrap gap-2">
        {상세.scene_pages.map((쪽) => (
          <li
            key={쪽.scene_order}
            className="rounded-xl border border-divider px-3 py-2 text-[14px] text-ink"
          >
            <b>{쪽.scene_order}번째</b>{' '}
            <span className="text-ink-muted">{쪽.character_name ?? '전개'}</span>
          </li>
        ))}
      </ol>
    </카드>
  )
}
