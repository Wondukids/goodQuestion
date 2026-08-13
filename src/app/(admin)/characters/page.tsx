// 화면 6 — 캐릭터 보기 (`/characters`).
//
// 파이썬 `goodquestion_admin/routes/characters.py` + `templates/characters.html` 자리다.
//
// 🔴 **읽기 전용이다.** 이 폴더에는 `actions.ts` 도 `route.ts` 도 없고 폼도 없다.
//    고치는 자리는 시드 편집 화면 하나뿐이고, 두 곳에서 고치면 어느 쪽이 정본인지 흐려진다
//    (파이썬 `test_이_화면에는_고치는_주소가_없다`). `tests/characters-admin.test.ts` 가
//    이 폴더를 훑어 쓰는 길이 생기면 빨개진다.
//
// ⛔ 화면은 계산하지 않는다 (`CLAUDE.md` 경계 6). 출처 표시도 칸 수도
//    `service/characters.ts` 가 준 것을 그대로 그린다.

import { connection } from 'next/server'

import { elementName } from '@/lib/elements'
import {
  charactersView,
  출처_이름,
  type CharactersView,
  type FieldView,
  type Origin,
} from '@/lib/service/characters'

export const metadata = { title: '캐릭터 보기 — 굿퀘스천 관리자' }

export default async function CharactersPage() {
  // 렌더링이 요청을 기다리게 한다 — 안 그러면 빌드 때 DB 에 붙으려 든다 (`connection.md`).
  await connection()
  const 본것 = await charactersView()

  return (
    <main className="flex flex-col gap-8">
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">캐릭터 보기</h2>
        <p className="text-xs text-zinc-500">
          원문에서 온 값과 우리가 지어낸 값을 가르는 자리다. 고치려면 시드 편집 화면으로 간다.
        </p>
        <p className="flex flex-wrap gap-2">
          {(Object.entries(본것.counts) as [Origin, number][])
            .filter(([, 몇]) => 몇 > 0)
            .map(([출처, 몇]) => (
              <span key={출처} className="text-xs">
                <배지 출처={출처} /> {몇}칸
              </span>
            ))}
        </p>
        {본것.file_differs && (
          <p className="border border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            <strong>아래 값은 시드 파일 값과 다릅니다.</strong>
          </p>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="font-semibold">캐릭터 {본것.characters.length}명</h3>
        {본것.characters.map((캐릭터) => (
          <article key={캐릭터.id} className="border border-zinc-300 p-3 dark:border-zinc-700">
            <h4 className="mb-2 font-semibold">
              {캐릭터.name}{' '}
              <small className="font-mono text-xs font-normal text-zinc-500">
                {캐릭터.code} · {캐릭터.story_title}
              </small>
            </h4>
            <칸목록 칸들={캐릭터.fields} />
          </article>
        ))}
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="font-semibold">대화 장면 {본것.scenes.length}개</h3>
        {본것.scenes.map((장면) => (
          <article key={장면.id} className="border border-zinc-300 p-3 dark:border-zinc-700">
            <h4 className="mb-2 font-semibold">
              장면 {장면.scene_order} · {장면.character_name}{' '}
              <small className="font-mono text-xs font-normal text-zinc-500">
                {장면.character_code}
              </small>
            </h4>
            {/* ⚠️ `remaining_worries` 는 아래 표로 따로 그린다. 여기서는 뺀다. */}
            <칸목록 칸들={장면.fields.filter((칸) => 칸.column !== 'remaining_worries')} />
            <걱정표 장면={장면} 출처={본것.worry_origin} />
          </article>
        ))}
      </section>
    </main>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 조각 — ⚠️ export 하지 않는다. Next 가 `page.tsx` 의 export 를 규격으로 검사한다.
// ═══════════════════════════════════════════════════════════════════════════

const 배지색: Record<Origin, string> = {
  canon: 'border-emerald-600 text-emerald-700 dark:text-emerald-400',
  draft: 'border-amber-600 text-amber-700 dark:text-amber-400',
  unmarked: 'border-zinc-500 text-zinc-500',
}

function 배지({ 출처, 도움말 }: { 출처: Origin; 도움말?: string }) {
  return (
    <span
      data-origin={출처}
      title={도움말}
      className={`border px-1 font-mono text-[10px] ${배지색[출처]}`}
    >
      {출처_이름[출처]}
    </span>
  )
}

/** 값 하나를 화면 표기로. 배열은 목록으로, 없으면 「값 없음」. */
function 값보기({ 칸 }: { 칸: FieldView }) {
  if (칸.value === null || 칸.value === undefined) {
    return <em className="text-zinc-500">값 없음</em>
  }
  if (Array.isArray(칸.value)) {
    // 요구 사고 요소만 한국어 이름표를 붙인다 (`lib/elements.ts` — 화면에서만 쓴다).
    const 값들 =
      칸.column === 'required_elements' ? 칸.value.map((하나) => elementName(String(하나))) : 칸.value
    return <code className="font-mono text-xs">{값들.map(String).join(', ')}</code>
  }
  return <span className="whitespace-pre-wrap">{String(칸.value)}</span>
}

function 칸목록({ 칸들 }: { 칸들: readonly FieldView[] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
      {칸들.map((칸) => (
        <div key={칸.column} className="contents">
          <dt className="flex items-baseline gap-1 whitespace-nowrap text-zinc-500">
            {칸.label} <code className="font-mono">{칸.column}</code>
            <배지 출처={칸.origin} 도움말={`${칸.origin_help} (${칸.source})`} />
          </dt>
          <dd className={칸.review_needed ? 'border-l-2 border-amber-500 pl-2' : ''}>
            <값보기 칸={칸} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

function 걱정표({
  장면,
  출처,
}: {
  장면: CharactersView['scenes'][number]
  출처: CharactersView['worry_origin']
}) {
  const 줄들 = Object.entries(장면.worries)
  return (
    <section className="mt-3 flex flex-col gap-1">
      <h5 className="flex items-baseline gap-1 text-xs font-semibold">
        요소별 걱정 문장 <code className="font-mono font-normal">remaining_worries</code>
        <배지 출처={출처.origin} 도움말={`${출처.origin_help} (${출처.source})`} />
      </h5>
      <p className="text-xs text-zinc-500">
        <strong>부족한 사고 요소를 캐릭터 대사로 미리 옮겨 둔 문장들입니다.</strong> 아이가 아직
        말하지 않은 요소가 있을 때 캐릭터가 이 문장을 그대로 씁니다. 문장이 어색하면 그 자리의
        대화가 통째로 어색해집니다.
      </p>
      {줄들.length === 0 ? (
        <p className="text-xs">
          <em className="text-zinc-500">이 장면에는 걱정 문장이 없습니다.</em>
        </p>
      ) : (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-zinc-400 text-left">
              <th className="py-1 pr-3 font-normal">사고 요소</th>
              <th className="py-1 font-normal">그 요소가 아직 없을 때 캐릭터가 하는 걱정</th>
            </tr>
          </thead>
          <tbody>
            {줄들.map(([요소, 걱정]) => (
              <tr key={요소} className="border-b border-zinc-200 dark:border-zinc-800">
                <td className="py-1 pr-3">
                  <code className="font-mono">{elementName(요소)}</code>
                </td>
                <td className="py-1">{걱정}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
