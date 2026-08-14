// 화면 — 한 턴의 LLM 시도 (`/runs/{run_id}/turns/{message_id}`).
//
// 파이썬 라우트 둘(`routes/runs.py` 의 `시도_보기()`·`프롬프트_원문()`)과 조각 둘
// (`run_calls.html`·`run_prompt.html`)이 여기 하나로 합쳐졌다 (이슈 #26 E-3 · C-2·C-3·C-4).
// 파이썬은 턴 카드 안에서 htmx 로 펼치는 조각이었고(`turn.html:91-97`), 이 판은 쪽 하나다.
//
// 🔴 **이 화면이 있어야 하는 이유** — `CLAUDE.md` 「로그」 절이 「LLM 호출마다 실제로 응답한
//    공급자와 모델 ID 를 함께 찍는다(fallback 이 돌았는지 **눈으로 봐야 한다**)」고 요구한다.
//    터미널에서는 그 줄이 찍히지만 화면에는 볼 자리가 없었다. 여기가 그 자리다.
//
// ⭐ 2026-08-14 에 **경계 채점표**가 여기 붙었다. 채점기(`lib/judge.ts`)는 턴마다 도는데 그
//    결과를 보여 주는 화면이 하나도 없어 DB 를 직접 봐야 했다. 이 턴에 어느 검사가 걸렸는지는
//    「이 턴이 무엇을 했나」의 일부라 시도표와 같은 쪽에 둔다.
//
// ⛔ **여기서 아무것도 판정하지 않는다** (경계 6). `llm_calls` 에 남은 사실을 그대로 그리고,
//    비용만 단가표를 곱해 낸다 — 그 곱셈도 `lib/config.ts` 가 하고 화면은 받아 쓴다.
// ⚠️ 화면은 `lib/repo` 를 직접 부르지 못한다 (eslint 층 경계). `service/view.turnAttempts()` 를 거친다.

import Link from 'next/link'
import { connection } from 'next/server'

import { turnAttempts } from '@/llm/service/view'

import { 칸들 } from '../../../ui'
import { 경계채점표, 시도표 } from './ui'

export const metadata = { title: 'LLM 시도 — 굿퀘스천 관리자' }

export default async function TurnCallsPage({
  params,
}: {
  // ⚠️ Next 16 에서 `params` 는 프라미스다.
  params: Promise<{ run_id: string; message_id: string }>
}) {
  await connection()
  const { run_id, message_id } = await params
  const 시도들 = await turnAttempts(run_id, message_id)
  const { run } = 시도들

  return (
    <main className="flex flex-col gap-6">
      <section className="flex flex-wrap items-baseline gap-3">
        <h2 className="font-semibold">
          LLM 시도 <span className="font-mono text-xs text-zinc-500">turn {message_id}</span>
        </h2>
        <Link href={`/runs/${run.id}`} className="text-xs underline">
          ← 진행 화면
        </Link>
        <Link href={`/runs/${run.id}/log`} className="text-xs underline">
          턴 로그 →
        </Link>
      </section>

      {/* 「고른 모델」이 무엇이었는지가 옆에 있어야 표의 굵은 줄을 읽을 수 있다. */}
      <칸들
        값들={[
          ['run_id', run.id],
          ['message_id', message_id],
          ['analysis_model', run.analysis_model],
          ['analysis_effort', run.analysis_effort],
          ['character_model', run.character_model],
          ['character_effort', run.character_effort],
        ]}
      />

      <시도표 시도들={시도들} />

      {/* 🔴 `scores.message_id` 는 **아이 발화 id** 라 이 쪽이 쥔 값과 그대로 맞는다. */}
      <경계채점표 채점들={시도들.auto_scores} />

      <p className="text-xs text-zinc-500">
        ⚠️ 비용은 기록이 아니라 「볼 때마다 계산한 값」이다. `llm_calls` 에는 토큰만 남고 금액
        칸이 없다 — 단가는 `web/단가표.toml` 에서 읽고, 표에 없는 모델은 0 이 아니라 「모름」이다.
      </p>
    </main>
  )
}
