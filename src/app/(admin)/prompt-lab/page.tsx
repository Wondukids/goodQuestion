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

import { promptLabView, type PromptItem } from '@/llm/service/prompt-lab'

import { 한칸, 오류띠 } from '../runs/ui'
import { 개발자용, 단추, 라벨, 카드, 화면머리말 } from '../ui'
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

      <화면머리말
        제목="지시문 작업대"
        설명="AI 에게 주는 지시문(＂너는 이런 역할이고 이렇게 답해라＂)을 회차 하나에만 바꿔 넣어 시험하는 곳입니다. 원본 파일은 여기서 바뀌지 않습니다 — 시험해 보고 좋으면 사람이 직접 파일로 옮깁니다."
      />

      <카드 제목="지금 무엇을 보고 있나">
        {본것.run === null ? (
          <p className="text-[15px] text-ink">
            회차를 고르지 않아 <b>원본 파일 그대로</b> 보여 주고 있습니다. 고쳐 보려면 회차
            목록에서 회차 하나를 골라 들어오세요.
          </p>
        ) : (
          <p className="text-[15px] text-ink">
            회차{' '}
            <Link href={`/runs/${본것.run.id}`} className="font-bold text-primary-strong underline">
              {본것.run.id.slice(0, 8)}
            </Link>{' '}
            에 쓸 지시문입니다.{' '}
            {본것.experiment_names.length === 0
              ? '아직 이 회차만의 지시문은 없습니다 — 아래에서 고쳐 저장하면 생깁니다.'
              : `이 회차만 바꾼 것: ${본것.experiment_names.join(', ')}`}
          </p>
        )}
      </카드>

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
    <카드
      제목={프롬프트.name}
      설명={
        고칠_수_있나
          ? '아래를 고쳐 저장하면 이 회차에만 적용됩니다. 원본 파일은 그대로입니다.'
          : '읽기만 할 수 있습니다.'
      }
      곁들이기={
        프롬프트.is_experiment ? (
          <span className="rounded-lg bg-warn-soft px-2.5 py-1 text-[13px] font-bold text-warn">
            이 회차만 바꾼 것
          </span>
        ) : undefined
      }
    >
      {/* ⭐ 「정본 보기」라고 쓰지 않는다 — 파일이 정본인 것과 회차가 무엇으로 돌았는지는 다른 말이다. */}
      <개발자용 제목="원본 파일 내용">
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all font-mono text-[12px] text-ink">
          {프롬프트.canonical_body}
        </pre>
      </개발자용>

      {고칠_수_있나 ? (
        <form action={saveExperimentPromptAction} className="flex flex-col gap-3">
          <input type="hidden" name="run_id" value={run_id} />
          <input type="hidden" name="name" value={프롬프트.name} />
          <라벨 이름="이 회차에 쓸 내용">
            <textarea
              name="body"
              rows={24}
              required
              defaultValue={프롬프트.display_body}
              className="w-full rounded-xl border border-divider bg-surface p-3 font-mono text-[13px] text-ink outline-none focus:border-primary"
            />
          </라벨>
          {/* ⭐ AI 를 부르지 않고 되돌릴 수도 있는 저장이라 보통 단추다 (규칙 3-5 갈래 A). */}
          <button type="submit" className={`self-start ${단추.보통}`}>
            이 회차에 저장
          </button>
        </form>
      ) : (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-chip p-3 font-mono text-[13px] text-ink">
          {프롬프트.display_body}
        </pre>
      )}
    </카드>
  )
}
