// 화면 7 — 프롬프트 작업대 (`/prompt-lab?run_id=…`).
//
// 파이썬 `goodquestion_admin/routes/prompt_lab.py` + `templates/prompt_lab.html` 자리다.
// ⚠️ 주소만 갈렸다 — 파이썬은 `/prompts` 였다. 이 레포의 `prompts/` 폴더와 헷갈리지 않게
//    화면 폴더 이름을 `prompt-lab` 으로 둔다 (오케스트레이터가 정한 자리).
//
// 🔴 **정본 파일은 이 화면에서 고치지 않는다** (`CLAUDE.md` 경계 6).
//    실험 내용은 고른 회차에만 저장되고, 확정 내용은 사람이 파일로 옮긴다.
//    그래서 폼이 보내는 곳은 `experiment_prompts` 표 하나뿐이다.

import Link from 'next/link'
import { connection } from 'next/server'

import { promptLabView, type PromptItem } from '@/lib/service/prompt-lab'

import { 한칸, 오류띠 } from '../runs/ui'
import { saveExperimentPromptAction } from './actions'

export const metadata = { title: '프롬프트 작업대 — 굿퀘스천 관리자' }

export default async function PromptLabPage({
  searchParams,
}: {
  // ⚠️ Next 16 에서 `searchParams` 는 **프라미스**다 (`03-layouts-and-pages.md`).
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await connection()
  const 물음 = await searchParams
  const 오류 = 한칸(물음.error)
  const run_id = 한칸(물음.run_id)
  const 본것 = await promptLabView({ run_id })

  return (
    <main className="flex flex-col gap-6">
      {오류 !== null && <오류띠 문구={오류} />}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">프롬프트 작업대</h2>
        <p className="text-xs text-zinc-500">
          프롬프트 파일은 이 화면에서 고치지 않습니다. 실험 내용은 고른 회차에만 저장되고, 확정
          내용은 사람이 파일로 옮깁니다.
        </p>
        {본것.run === null ? (
          <p className="text-xs">회차를 지정하지 않아 프롬프트 파일 값을 읽기 전용으로 보여 줍니다.</p>
        ) : (
          <p className="text-xs">
            회차{' '}
            <Link href={`/runs/${본것.run.id}`} className="font-mono underline">
              {본것.run.id}
            </Link>{' '}
            ·{' '}
            {본것.experiment_names.length === 0
              ? '실험용 프롬프트 없음'
              : `실험용: ${본것.experiment_names.join(', ')}`}
          </p>
        )}
      </section>

      {본것.prompts.map((프롬프트) => (
        <프롬프트칸 key={프롬프트.name} 프롬프트={프롬프트} run_id={본것.run_id} />
      ))}
    </main>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 조각 — ⚠️ export 하지 않는다. Next 가 `page.tsx` 의 export 를 규격으로 검사한다.
// ═══════════════════════════════════════════════════════════════════════════

function 프롬프트칸({ 프롬프트, run_id }: { 프롬프트: PromptItem; run_id: string | null }) {
  const 고칠_수_있나 = run_id !== null && 프롬프트.editable
  return (
    <section className="flex flex-col gap-2 border border-zinc-300 p-3 dark:border-zinc-700">
      <h3 className="font-semibold">
        {프롬프트.name}
        {프롬프트.is_experiment && <span className="ml-2 text-xs text-amber-600">· 실험용</span>}
      </h3>

      {/* ⭐ 「정본 보기」라고 쓰지 않는다 — 파일이 정본인 것과 회차가 무엇으로 돌았는지는 다른 말이다. */}
      <details>
        <summary className="cursor-pointer text-xs text-zinc-500">▸ 프롬프트 파일 보기</summary>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-all bg-zinc-100 p-2 font-mono text-xs dark:bg-zinc-900">
          {프롬프트.canonical_body}
        </pre>
      </details>

      {고칠_수_있나 ? (
        <form action={saveExperimentPromptAction} className="flex flex-col gap-2">
          <input type="hidden" name="run_id" value={run_id} />
          <input type="hidden" name="name" value={프롬프트.name} />
          <label className="flex flex-col gap-1">
            <span className="font-mono text-xs text-zinc-500">이 회차에 쓸 내용</span>
            <textarea
              name="body"
              rows={24}
              required
              defaultValue={프롬프트.display_body}
              className="w-full border border-zinc-400 p-2 font-mono text-xs"
            />
          </label>
          <button type="submit" className="self-start border border-zinc-700 px-3 py-1 font-semibold">
            회차에 실험용으로 저장
          </button>
        </form>
      ) : (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all bg-zinc-100 p-2 font-mono text-xs dark:bg-zinc-900">
          {프롬프트.display_body}
        </pre>
      )}
    </section>
  )
}
