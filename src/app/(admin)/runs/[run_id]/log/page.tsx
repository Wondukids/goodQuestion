// 화면 3 — 턴 로그 (`/runs/{run_id}/log`). 회차 전체를 되짚는 자리다.
//
// 🔴 **이 화면이 `turn_conditions` 를 읽는 이유** — `story_sessions` 는 매 턴 덮어써서
//    지난 턴의 모드·누적 요소·카운터가 어디에도 안 남는다. 그래서 판정 당시 값을 그 표에
//    박제했고(FR-011 · SC-005), 그러라고 세운 표를 읽는 곳이 여기다.
//
// ⛔ **판정을 다시 계산하지 않는다.** 박제된 값을 되살려 `[분석] [상태] [판정]` 세 줄을
//    **글자 그대로** 찍는다 (`CLAUDE.md` 로그 절 — 지우거나 요약하지 말 것).
//    스냅샷이 없는 턴이면 「없다」고 말한다. 꾸며 내지 않는다.

import Link from 'next/link'
import { connection } from 'next/server'

import { runDetail, type RunDetail } from '@/lib/service/view'

import { 로그세줄, 시도링크, 칸들, 표기 } from '../../ui'

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
      <section className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-semibold">
          턴 로그 · {상세.session.story_title}{' '}
          <span className="font-mono text-xs text-zinc-500">{상세.run.id}</span>
        </h2>
        <Link href={`/runs/${상세.run.id}`} className="text-xs underline">
          ← 진행 화면
        </Link>
      </section>

      <칸들
        값들={[
          ['messages', 상세.messages.length],
          ['아이 턴', 아이턴.length],
          ['turn_conditions', 아이턴.filter((행) => 행.turn_condition !== null).length],
          ['prompt_version', 상세.run.prompt_version],
          ['scene_pages', 상세.scene_pages.map((쪽) => 쪽.scene_order)],
        ]}
      />

      <쪽목록 상세={상세} />

      <section className="flex flex-col gap-4">
        {상세.messages.length === 0 && (
          <p className="text-xs text-zinc-500">아직 남은 메시지가 없다.</p>
        )}
        {상세.messages.map((행) => (
          <article
            key={행.id}
            className="border border-zinc-300 p-3 dark:border-zinc-700"
          >
            <p className="font-mono text-xs text-zinc-500">
              scene_order={행.scene_order} turn_order={행.turn_order} speaker_type=
              {행.speaker_type} utterance_source={표기(행.utterance_source)}
            </p>
            <p className="my-1">
              {행.speaker_type === 'character' && (
                <span className="mr-1 text-zinc-500">{행.character_name ?? ''}:</span>
              )}
              {행.text}
            </p>
            {(상세.fallback.get(행.id) ?? []).map((시도) => (
              <p
                key={`${시도.purpose}-${시도.attempt_no}`}
                className="border border-amber-500 px-2 py-1 font-mono text-xs text-amber-700"
              >
                예비 공급자 · {시도.purpose} #{시도.attempt_no} · {시도.provider}/{시도.model}
                {' ← 고르려던 것 '}
                {시도.chosen_model}
              </p>
            ))}
            {행.speaker_type === 'child' && (
              <>
                <로그세줄 줄들={행.log_lines} />
                {행.character_response === null && (
                  // 「바로 다음 한 행」이 이 장면의 캐릭터가 아니었다 — 이 턴은 대사를 못 받았다.
                  <p className="font-mono text-xs text-amber-600">응답 없음</p>
                )}
                {/* 되짚는 자리에서 「무엇을 보내고 무엇이 답했나」로 내려가는 길. */}
                <p className="mt-1">
                  <시도링크 run_id={상세.run.id} message_id={행.id} />
                </p>
              </>
            )}
          </article>
        ))}
      </section>
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
    <section className="flex flex-col gap-1">
      <h3 className="font-semibold">장면 쪽 {상세.scene_pages.length}개</h3>
      <ol className="flex flex-wrap gap-2 font-mono text-xs">
        {상세.scene_pages.map((쪽) => (
          <li key={쪽.scene_order} className="border border-zinc-300 px-2 py-1 dark:border-zinc-700">
            {쪽.scene_order} · {표기(쪽.character_name)} ·{' '}
            {표기(쪽.scenes.map((장면) => 장면.scene_order))}
          </li>
        ))}
      </ol>
    </section>
  )
}
