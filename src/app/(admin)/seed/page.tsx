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

import { elementName } from '@/llm/elements'
import { seedWorkbench, 출처_이름, 칸_id, 칸_이름, 칸자리_이름 } from '@/llm/service/seed'

import { 오류띠, 한칸 } from '../runs/ui'
import { 값, 경고상자, 빈자리, 카드, 화면머리말 } from '../ui'
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
    <main className="flex flex-col gap-6">
      {/* ⚠️ 머리말이 경고·오류보다 먼저다 — 「여기가 어디인가」를 먼저 읽어야 한다 (규칙 2-1). */}
      <화면머리말
        제목="이야기 설정"
        설명="이야기에 나오는 캐릭터와 장면의 설정값을 한 칸씩 고치는 곳입니다. 고친 값은 다음 회차부터 바로 쓰입니다. 다 고쳤으면 「내보내기」로 파일을 받아 개발 담당자에게 넘기면 원본에 반영됩니다."
        곁들이기={
          <a
            href="/seed/export"
            className="text-[14px] font-bold text-primary-strong underline"
          >
            고친 값 내보내기
          </a>
        }
      />

      {오류 !== null && (
        <div className="flex flex-col gap-1">
          <오류띠 문구={오류} />
          {경고_칸 !== null && 칸자리_이름(경고_칸) !== null && (
            <p>
              <a
                href={`#${경고_칸}`}
                className="text-[14px] font-bold text-primary-strong underline"
              >
                문제가 된 「{칸자리_이름(경고_칸)}」 칸으로 가기 →
              </a>
            </p>
          )}
        </div>
      )}

      {자료.file_differs && (
        <경고상자>
          <b>화면 값이 원본 파일과 다릅니다.</b> 누군가 여기서 고쳤고 아직 내보내지 않았다는
          뜻입니다 —{' '}
          <a href="/seed/export" className="font-bold underline">
            고친 값 내보내기
          </a>
        </경고상자>
      )}

      {자료.file_read_error !== null && (
        <경고상자>
          <b>원본 파일을 읽지 못했습니다.</b> 그래서 아래 「원본 파일에 있는 값과 견주기」가 전부
          비어 있습니다. 고치고 저장하는 것은 그대로 됩니다 — 견주기만 안 됩니다.
        </경고상자>
      )}

      {/* ── 캐릭터 ─────────────────────────────────────────────── */}
      <카드
        제목="캐릭터"
        설명="캐릭터마다 성격·말투·아이를 이끄는 방식과, 하면 안 되는 말을 정합니다."
        곁들이기={
          <span className="text-[15px] font-bold text-ink-muted">{자료.characters.length}명</span>
        }
      >
        <div className="flex flex-col gap-4">
          {자료.characters.map((캐릭터) => (
            <article key={캐릭터.id} className="rounded-2xl border border-divider p-4">
              <h3 className="mb-3 text-[17px] font-extrabold text-ink">{캐릭터.name}</h3>
              <div className="flex flex-col gap-4">
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
                      className="w-full rounded-xl border border-divider bg-surface px-3 py-2 text-[14px] text-ink outline-none focus:border-primary"
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
                    className="w-full rounded-xl border border-divider bg-surface px-3 py-2 text-[14px] text-ink outline-none focus:border-primary"
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
      </카드>

      {/* ── 대화 장면 ──────────────────────────────────────────── */}
      <카드
        제목="대화 장면"
        설명="아이가 캐릭터와 말을 주고받는 장면마다, 캐릭터의 입장과 아이에게 남길 걱정 문장을 정합니다."
        곁들이기={
          <span className="text-[15px] font-bold text-ink-muted">
            {자료.scenes.length}개 · 걱정 문장{' '}
            {자료.scenes.reduce((합, 장면) => 합 + Object.keys(장면.remaining_worries).length, 0)}줄
          </span>
        }
      >
        <div className="flex flex-col gap-4">
          {자료.scenes.map((장면) => (
            <article key={장면.id} className="rounded-2xl border border-divider p-4">
              <h3 className="mb-3 text-[17px] font-extrabold text-ink">
                {장면.scene_order}번째 장면{' '}
                <span className="text-[14px] font-normal text-ink-faint">
                  {장면.character_name}
                </span>
              </h3>

              <div className="flex flex-col gap-4">
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
                    className="w-full rounded-xl border border-divider bg-surface px-3 py-2 text-[14px] text-ink outline-none focus:border-primary"
                  />
                  <시드파일값 값={파일값_글자(장면.file_values?.scene_stance)} />
                  <div className="flex items-center gap-3">
                    <출처고르개 지금={장면.origins.scene_stance} />
                    <저장단추 글="입장 저장" />
                  </div>
                </form>

                <h5 className="mt-2 text-xs font-semibold text-ink-muted">
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
                      className="w-full rounded-xl border border-divider bg-surface px-3 py-2 text-[14px] text-ink outline-none focus:border-primary"
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
                    className="w-full rounded-xl border border-divider bg-surface px-3 py-2 text-[14px] text-ink outline-none focus:border-primary"
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
      </카드>

      {/* ── 개정 이력 ─────────────────────────────────────────── */}
      <카드
        제목="고친 기록"
        설명="여기서 고친 것이 모두 남습니다. 잘못 고쳤으면 「직전 값으로 되돌리기」를 누르세요."
        곁들이기={
          <span className="text-[15px] font-bold text-ink-muted">{자료.revisions.length}건</span>
        }
      >
        {자료.revisions.length === 0 ? (
          <빈자리
            무엇="아직 화면에서 고친 값이 없습니다."
            다음="위에서 값을 고쳐 저장하면 여기에 기록이 쌓입니다."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-divider text-left text-ink-muted">
                  {['언제', '어느 칸', '출처', '바꾼 사람', '이전 → 새 값', ''].map(
                    (이름, 자리) => (
                      <th key={자리} className="py-2 pr-4 font-bold">
                        {이름}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {자료.revisions.map((개정) => (
                  <tr key={개정.id} className="border-b border-divider">
                    <td className="py-2 pr-4 whitespace-nowrap">
                      {개정.created_at.toISOString().slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="py-2 pr-4">{개정.display_name}</td>
                    <td className="py-2 pr-4">{출처_이름[개정.origin] ?? 개정.origin}</td>
                    <td className="py-2 pr-4">
                      <값 것={개정.changed_by} 없을때="알 수 없음" />
                    </td>
                    <td className="py-2 pr-4 text-[13px]">
                      <span className="break-all text-ink-faint">
                        {JSON.stringify(개정.old_value)}
                      </span>{' '}
                      → <span className="break-all">{JSON.stringify(개정.new_value)}</span>
                    </td>
                    <td className="py-2">
                      {/* ⭐ 되돌리기가 있어서 시드 고치기가 「갈래 A」다 — 확인창을 안 다는
                          근거의 절반이 이 단추다 (규칙 3-5). */}
                      <form action={undoSeedRevisionAction}>
                        <input type="hidden" name="revision_id" value={개정.id} />
                        <button
                          type="submit"
                          className="rounded-lg border border-divider bg-surface px-3 py-1.5 text-[13px] font-bold text-ink whitespace-nowrap hover:border-primary"
                        >
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
      </카드>
    </main>
  )
}
