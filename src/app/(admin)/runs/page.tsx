// 화면 1 — 회차 시작 · 회차 목록 (`/runs`).
//
// 파이썬 `goodquestion_admin/routes/runs.py` 의 `회차_목록()` + `run_list.html` 자리다.
//
// ⛔ **이 화면은 계산하지 않는다.** 이야기 목록과 회차 목록을 `service/view.ts` 에서
//    읽어 그릴 뿐이고, 시작 단추는 서버 액션이 `startRunStep()` 을 부른다 (경계 6).

import Link from 'next/link'
import { connection } from 'next/server'

import { 고를_수_있는_강도, loadSettings, 모델_목록 } from '@/lib/config'
import { listRunsView, listStoriesView } from '@/lib/service/view'

import { startRunAction } from './actions'
import { 보내기 } from './submit'
import { LLM칸, 라벨, 오류띠, 한칸 } from './ui'

export const metadata = { title: '회차 — 굿퀘스천 관리자' }

export default async function RunsPage({
  searchParams,
}: {
  // ⚠️ Next 16 에서 `searchParams` 는 **프라미스**다 (`03-layouts-and-pages.md`).
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // 렌더링이 요청을 기다리게 한다 — 안 그러면 빌드 때 DB 에 붙으려 든다 (`connection.md`).
  await connection()

  const 오류 = 한칸((await searchParams).error)
  const [이야기들, 회차들] = await Promise.all([listStoriesView(), listRunsView()])

  // 폼의 바닥값. ⛔ 여기서 고르는 것이 아니라 `.env.local` 이 가리키는 값을 그대로 보여 준다
  // (`lib/config.ts` — `Settings` 를 손으로 짜는 길을 남기지 않는다).
  const 설정 = loadSettings()
  const 모델들 = 모델_목록(설정.gemini_model)

  return (
    <main className="flex flex-col gap-8">
      {오류 !== null && <오류띠 문구={오류} />}

      <section>
        <h2 className="mb-2 font-semibold">회차 시작</h2>
        <p className="mb-3 text-xs text-zinc-500">
          `story_sessions` 한 행과 `runs` 한 행이 함께 생기고, 대화 장면에 닿을 때까지 전개를
          재생한다. ⛔ 여기서 LLM 을 부르지 않는다 — 전개 지문도 고정 첫 대사도 DB 텍스트다.
        </p>
        <form action={startRunAction} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <라벨 이름="story_code">
              <select
                name="story_code"
                className="border px-2 py-1"
                defaultValue={이야기들[0]?.code}
              >
                {이야기들.map((이야기) => (
                  <option key={이야기.id} value={이야기.code}>
                    {이야기.title} ({이야기.code})
                  </option>
                ))}
              </select>
            </라벨>
            <라벨 이름="scope">
              <select name="scope" className="border px-2 py-1" defaultValue="story">
                <option value="story">story</option>
                <option value="scene">scene</option>
              </select>
            </라벨>
            <라벨 이름="scene_order">
              <input
                name="scene_order"
                type="number"
                min={1}
                placeholder="scene 범위일 때만"
                className="w-36 border px-2 py-1"
              />
            </라벨>
            <라벨 이름="started_by">
              <input name="started_by" className="w-32 border px-2 py-1" />
            </라벨>
            <라벨 이름="experiment_note">
              <input name="experiment_note" className="w-56 border px-2 py-1" />
            </라벨>
          </div>

          {/* 🔴 이 넷이 비면 `runs` 에 NULL 이 남아 「무엇으로 돌렸나」가 기록에서 사라진다.
              회차끼리 견주는 것이 이 도구의 존재 이유라 그게 실질적 손실이다. */}
          <div className="flex flex-wrap gap-3">
            <LLM칸
              제목="분석 LLM"
              이름="analysis"
              모델들={모델들}
              기본_모델={설정.gemini_model}
              강도들={고를_수_있는_강도}
              기본_강도={설정.gemini_effort}
            />
            <LLM칸
              제목="캐릭터 LLM"
              이름="character"
              모델들={모델들}
              기본_모델={설정.gemini_model}
              강도들={고를_수_있는_강도}
              기본_강도={설정.gemini_effort}
            />
          </div>
          <p className="text-xs text-zinc-500">
            추론 강도는 <strong>두 공급자에 다 갑니다</strong> — 제미나이는{' '}
            <code>thinking_level</code>, Anthropic 은 <code>effort</code> 로 받습니다. 올릴수록
            느려지고 토큰을 더 씁니다.
          </p>

          <div>
            {/* ⭐ 눌린 뒤 스스로 잠긴다. 2026-08-13 에 두 번 눌려 회차가 둘 생겼다. */}
            <보내기 도는중="시작하는 중…">시작</보내기>
          </div>
        </form>
        {이야기들.length === 0 && (
          <p className="mt-2 text-xs text-red-600">
            `stories` 가 비었다. `npx tsx db/seed.ts` 로 시드를 넣어라.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold">회차 {회차들.length}건</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-400 text-left">
                {[
                  'started_at',
                  'story',
                  'scope',
                  'status',
                  '아이 턴',
                  'prompt_version',
                  'started_by',
                  'ended_at',
                ].map((이름) => (
                  <th key={이름} className="py-1 pr-3 font-mono font-normal">
                    {이름}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {회차들.map((회차) => (
                <tr key={회차.id} className="border-b border-zinc-200 dark:border-zinc-800">
                  <td className="py-1 pr-3">
                    <Link href={`/runs/${회차.id}`} className="underline">
                      {회차.started_at.toISOString().slice(0, 19).replace('T', ' ')}
                    </Link>
                  </td>
                  <td className="py-1 pr-3">
                    {회차.story_title}
                    {회차.experimental && <span className="ml-1 text-amber-600">실험</span>}
                  </td>
                  <td className="py-1 pr-3 font-mono">
                    {회차.scope}
                    {회차.scene_order === null ? '' : `/${회차.scene_order}`}
                  </td>
                  <td className="py-1 pr-3 font-mono">{회차.status}</td>
                  <td className="py-1 pr-3 font-mono">{회차.turn_count}</td>
                  <td className="py-1 pr-3 font-mono">{회차.prompt_version}</td>
                  <td className="py-1 pr-3">{회차.started_by ?? 'null'}</td>
                  <td className="py-1 pr-3 font-mono">
                    {회차.ended_at === null
                      ? 'null'
                      : 회차.ended_at.toISOString().slice(11, 19)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {회차들.length === 0 && <p className="mt-2 text-xs text-zinc-500">아직 돌린 회차가 없다.</p>}
      </section>
    </main>
  )
}
