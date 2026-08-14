// 화면 2 — 시드 작업대 (`/seed`).
//
// 파이썬 `goodquestion_admin/routes/seed.py` 의 `시드_화면()` + `templates/seed.html` 자리다.
//
// ⭐ 기획자가 캐릭터·장면 값을 **한 칸씩** 고치고, 고친 이력을 보고, 시드 파일 값과 견주고,
//    다 됐으면 `/seed/export` 로 내려받아 사람이 `sql/002_seed_banggui.sql` 로 옮긴다.
//    그 왕복이 콘텐츠 정본 관리의 전부다 (`CLAUDE.md` 「DB」 절).
//
// ⛔ **이 화면은 계산하지 않는다.** `service/seed.ts` 가 준 것을 그릴 뿐이다 (경계 6).

import { connection } from 'next/server'

import { elementName } from '@/lib/elements'
import { seedWorkbench, 출처_이름, 칸_id, 칸_이름, 칸자리_이름 } from '@/lib/service/seed'

import { 오류띠, 한칸 } from '../runs/ui'
import { saveSeedCellAction, undoSeedRevisionAction } from './actions'
import { 시드파일값, 저장단추, 숨은칸들, 출처고르개, 칸머리 } from './ui'

export const metadata = { title: '시드 작업대 — 굿퀘스천 관리자' }

/** 시드 파일 값 하나를 화면 글자로. 목록은 한 줄에 하나로 편다 (폼과 같은 모양이다). */
function 파일값_글자(값: string | number | readonly string[] | undefined): string | null {
  if (값 === undefined) return null
  if (Array.isArray(값)) return 값.join('\n')
  return String(값)
}

export default async function SeedPage({
  searchParams,
}: {
  // ⚠️ Next 16 에서 `searchParams` 는 **프라미스**다 (`03-layouts-and-pages.md`).
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  // 렌더링이 요청을 기다리게 한다 — 안 그러면 빌드 때 DB 에 붙으려 든다 (`connection.md`).
  await connection()

  const 물음 = await searchParams
  const 오류 = 한칸(물음.error)
  const 경고_칸 = 한칸(물음.field)
  const 자료 = await seedWorkbench()

  return (
    <main className="flex flex-col gap-8">
      {오류 !== null && (
        <div className="flex flex-col gap-1">
          <오류띠 문구={오류} />
          {경고_칸 !== null && 칸자리_이름(경고_칸) !== null && (
            <p className="text-xs">
              <a href={`#${경고_칸}`} className="underline">
                {칸자리_이름(경고_칸)} 칸으로
              </a>
            </p>
          )}
        </div>
      )}

      {자료.file_differs && (
        <p className="border border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <strong>화면 값과 시드 파일 값이 다릅니다.</strong>{' '}
          <a href="/seed/export" className="underline">
            현재 작업값 내보내기
          </a>
        </p>
      )}

      {자료.file_read_error !== null && (
        <p className="border border-amber-500 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <strong>시드 파일을 못 읽었습니다.</strong> 아래 「시드 파일 값 보기」가 전부 비어
          있습니다 — {자료.file_read_error}
        </p>
      )}

      <section>
        <h2 className="mb-1 font-semibold">시드 작업대</h2>
        <p className="text-xs text-zinc-500">
          여기서 고친 값은 <strong>다음 호출부터 바로</strong> 엔진에 반영된다 (콘텐츠를 DB 에서
          읽는다). 시드 파일 `sql/002_seed_banggui.sql` 은 이 화면이 쓰지 않는다 —{' '}
          <a href="/seed/export" className="underline">
            현재 작업값을 SQL 형식으로 내보내기
          </a>{' '}
          로 받아 사람이 옮긴다.
        </p>
      </section>

      {/* ── 캐릭터 ─────────────────────────────────────────────── */}
      <section>
        <h3 className="mb-2 font-semibold">캐릭터 {자료.characters.length}명</h3>
        <div className="flex flex-col gap-4">
          {자료.characters.map((캐릭터) => (
            <article key={캐릭터.id} className="border border-zinc-300 p-3 dark:border-zinc-700">
              <h4 className="mb-2 font-semibold">
                {캐릭터.name} <span className="font-mono text-xs text-zinc-500">{캐릭터.code}</span>
              </h4>
              <div className="flex flex-col gap-3">
                {(['persona', 'speech_style', 'guidance_style'] as const).map((열) => (
                  <form
                    key={열}
                    id={칸_id('characters', 캐릭터.id, 열)}
                    action={saveSeedCellAction}
                    className="flex flex-col gap-1"
                  >
                    <숨은칸들 table_name="characters" row_id={캐릭터.id} column_name={열} />
                    <칸머리 이름={칸_이름('characters', 열)} 출처={캐릭터.origins[열]} />
                    <textarea
                      name="value"
                      rows={4}
                      defaultValue={캐릭터[열]}
                      className="w-full border px-2 py-1 text-xs"
                    />
                    <시드파일값 값={파일값_글자(캐릭터.file_values?.[열])} />
                    <div className="flex items-center gap-3">
                      <출처고르개 지금={캐릭터.origins[열]} />
                      <저장단추 />
                    </div>
                  </form>
                ))}

                <form
                  id={칸_id('characters', 캐릭터.id, 'forbidden')}
                  action={saveSeedCellAction}
                  className="flex flex-col gap-1"
                >
                  <숨은칸들 table_name="characters" row_id={캐릭터.id} column_name="forbidden" />
                  <칸머리
                    이름={`${칸_이름('characters', 'forbidden')} (한 줄에 하나)`}
                    출처={캐릭터.origins.forbidden}
                  />
                  <textarea
                    name="value"
                    rows={5}
                    defaultValue={캐릭터.forbidden.join('\n')}
                    className="w-full border px-2 py-1 text-xs"
                  />
                  <시드파일값 값={파일값_글자(캐릭터.file_values?.forbidden)} />
                  <div className="flex items-center gap-3">
                    <출처고르개 지금={캐릭터.origins.forbidden} />
                    <저장단추 />
                  </div>
                </form>
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ── 대화 장면 ──────────────────────────────────────────── */}
      <section>
        <h3 className="mb-2 font-semibold">
          대화 장면 {자료.scenes.length}개와 걱정 문장{' '}
          {자료.scenes.reduce((합, 장면) => 합 + Object.keys(장면.remaining_worries).length, 0)}줄
        </h3>
        <div className="flex flex-col gap-4">
          {자료.scenes.map((장면) => (
            <article key={장면.id} className="border border-zinc-300 p-3 dark:border-zinc-700">
              <h4 className="mb-2 font-semibold">
                장면 {장면.scene_order} · {장면.character_name}{' '}
                <span className="font-mono text-xs text-zinc-500">{장면.code}</span>
              </h4>

              <div className="flex flex-col gap-3">
                <form
                  id={칸_id('story_scenes', 장면.id, 'scene_stance')}
                  action={saveSeedCellAction}
                  className="flex flex-col gap-1"
                >
                  <숨은칸들
                    table_name="story_scenes"
                    row_id={장면.id}
                    column_name="scene_stance"
                  />
                  <칸머리
                    이름={칸_이름('story_scenes', 'scene_stance')}
                    출처={장면.origins.scene_stance}
                  />
                  <textarea
                    name="value"
                    rows={3}
                    defaultValue={장면.scene_stance ?? ''}
                    className="w-full border px-2 py-1 text-xs"
                  />
                  <시드파일값 값={파일값_글자(장면.file_values?.scene_stance)} />
                  <div className="flex items-center gap-3">
                    <출처고르개 지금={장면.origins.scene_stance} />
                    <저장단추 글="입장 저장" />
                  </div>
                </form>

                <h5 className="mt-2 text-xs font-semibold text-zinc-500">
                  {칸_이름('story_scenes', 'remaining_worries')}
                </h5>
                {Object.entries(장면.remaining_worries).map(([요소, 걱정]) => (
                  <form
                    key={요소}
                    id={칸_id('story_scenes', 장면.id, 'remaining_worries', 요소)}
                    action={saveSeedCellAction}
                    className="flex flex-col gap-1"
                  >
                    <숨은칸들
                      table_name="story_scenes"
                      row_id={장면.id}
                      column_name="remaining_worries"
                      json_key={요소}
                    />
                    <칸머리
                      이름={`${elementName(요소)} (${요소})`}
                      출처={장면.origins.remaining_worries}
                    />
                    <textarea
                      name="value"
                      rows={2}
                      defaultValue={걱정}
                      className="w-full border px-2 py-1 text-xs"
                    />
                    <시드파일값 값={파일값_글자(장면.file_values?.remaining_worries?.[요소])} />
                    <div className="flex items-center gap-3">
                      <출처고르개 지금={장면.origins.remaining_worries} />
                      <저장단추 글="문장 저장" />
                    </div>
                  </form>
                ))}

                <form
                  id={칸_id('story_scenes', 장면.id, 'required_elements')}
                  action={saveSeedCellAction}
                  className="flex flex-col gap-1"
                >
                  <숨은칸들
                    table_name="story_scenes"
                    row_id={장면.id}
                    column_name="required_elements"
                  />
                  <칸머리
                    이름={`${칸_이름('story_scenes', 'required_elements')} (한 줄 또는 쉼표로 구분)`}
                    출처={장면.origins.required_elements}
                  />
                  <input
                    name="value"
                    defaultValue={장면.required_element_names.join(', ')}
                    className="w-full border px-2 py-1 text-xs"
                  />
                  <시드파일값
                    값={
                      장면.file_values === null
                        ? null
                        : 장면.file_values.required_elements.map(elementName).join(', ')
                    }
                  />
                  <div className="flex items-center gap-3">
                    <출처고르개 지금={장면.origins.required_elements} />
                    <저장단추 글="요구 요소 저장" />
                  </div>
                </form>

                {(['preferred_turns', 'max_turns'] as const).map((열) => (
                  <form
                    key={열}
                    id={칸_id('story_scenes', 장면.id, 열)}
                    action={saveSeedCellAction}
                    className="flex flex-wrap items-center gap-3"
                  >
                    <숨은칸들 table_name="story_scenes" row_id={장면.id} column_name={열} />
                    <칸머리 이름={칸_이름('story_scenes', 열)} 출처={장면.origins[열]} />
                    <input
                      type="number"
                      min={1}
                      name="value"
                      defaultValue={장면[열] ?? ''}
                      className="w-20 border px-2 py-1 text-xs"
                    />
                    <시드파일값 값={파일값_글자(장면.file_values?.[열])} />
                    <출처고르개 지금={장면.origins[열]} />
                    <저장단추 글={`${칸_이름('story_scenes', 열)} 저장`} />
                  </form>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      {/* ── 개정 이력 ─────────────────────────────────────────── */}
      <section>
        <h3 className="mb-2 font-semibold">개정 이력 {자료.revisions.length}건</h3>
        {자료.revisions.length === 0 ? (
          <p className="text-xs text-zinc-500">아직 화면에서 고친 값이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-zinc-400 text-left">
                  {['시각', '칸', '출처', '바꾼 사람', '이전 → 새 값', ''].map((이름, 자리) => (
                    <th key={자리} className="py-1 pr-3 font-normal">
                      {이름}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {자료.revisions.map((개정) => (
                  <tr key={개정.id} className="border-b border-zinc-200 dark:border-zinc-800">
                    <td className="py-1 pr-3 font-mono">
                      {개정.created_at.toISOString().slice(0, 19).replace('T', ' ')}
                    </td>
                    <td className="py-1 pr-3">{개정.display_name}</td>
                    <td className="py-1 pr-3">{출처_이름[개정.origin] ?? 개정.origin}</td>
                    <td className="py-1 pr-3">{개정.changed_by ?? '알 수 없음'}</td>
                    <td className="py-1 pr-3">
                      <code className="break-all">{JSON.stringify(개정.old_value)}</code> →{' '}
                      <code className="break-all">{JSON.stringify(개정.new_value)}</code>
                    </td>
                    <td className="py-1">
                      <form action={undoSeedRevisionAction}>
                        <input type="hidden" name="revision_id" value={개정.id} />
                        <button type="submit" className="border border-zinc-500 px-2 py-0.5">
                          직전 값으로 되돌리기
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
