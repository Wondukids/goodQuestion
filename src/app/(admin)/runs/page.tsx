// 화면 1 — 회차 시작 · 회차 목록 (`/runs`).
//
// 파이썬 `goodquestion_admin/routes/runs.py` 의 `회차_목록()` + `run_list.html` 자리다.
//
// ⛔ **이 화면은 계산하지 않는다.** 이야기 목록과 회차 목록을 `service/view.ts` 에서
//    읽어 그릴 뿐이고, 시작 단추는 서버 액션이 `startRunStep()` 을 부른다 (경계 6).
//
// ## 2026-08-14 — 글자를 사람 말로 (#28)
//
// 🔴 **폼 칸 이름(`name`)은 그대로 두고 라벨만 바꿨다.** 칸 이름을 바꾸면 서버 액션이
//    값을 못 찾는다. 바뀐 것은 **사람이 읽는 글자뿐**이다 (규칙 1-1).
// 🔴 **표를 9열에서 5열로 줄였다** (규칙 1-5). 나머지 넷(어디까지 · 지시문 판 · 시작한
//    사람 · 끝난 시각)은 행을 눌러 여는 상세 화면에 있다.

import Link from 'next/link'
import { connection } from 'next/server'

import { 고를_수_있는_강도, loadSettings, 모델_목록 } from '@/llm/config'
import { listRunsView, listStoriesView } from '@/llm/service/view'

import { 값, 단추, 빈자리, 입력칸, 카드, 화면머리말 } from '../ui'
import { startRunAction } from './actions'
import { 보내기 } from './submit'
import { LLM칸, 라벨, 오류띠, 자동채점칸, 한칸 } from './ui'

export const metadata = { title: '회차 — 굿퀘스천 관리자' }

/**
 * `story_sessions.status` 를 사람 말로 (규칙 1-1 · 2-5).
 *
 * ⛔ 여기에 규칙이 없다 — 어떤 값이 있는지는 `db/schema.ts` 의 검사 제약이 정한다
 *    (`in_progress`·`post_activity`·`completed`·`stopped`).
 * ⚠️ 모르는 값이 오면 **꾸며 내지 않고** 원래 글자를 그대로 보여 준다. 새 상태가 생겼을 때
 *    화면이 조용히 거짓말하는 것보다 낫다.
 */
const 상태_이름: Readonly<Record<string, string>> = {
  in_progress: '진행 중',
  post_activity: '마무리 활동 중',
  completed: '끝남',
  stopped: '중간에 멈춤',
  abandoned: '중간에 멈춤',
}

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
    <main className="flex flex-col gap-6">
      <화면머리말
        제목="회차"
        설명="아이와 AI 가 이야기를 한 번 처음부터 끝까지 진행한 기록을 회차라고 합니다. 아래에서 새로 진행해 볼 수 있고, 지난 기록을 눌러 무슨 말이 오갔는지 볼 수 있습니다."
      />

      {오류 !== null && <오류띠 문구={오류} />}

      <카드
        제목="새 회차 시작"
        설명="이야기를 골라 시작을 누르면 아이가 말할 차례가 될 때까지 이야기가 자동으로 진행됩니다. 이 단계에서는 AI 를 부르지 않습니다 — 미리 적어 둔 대사를 재생할 뿐입니다."
      >
        <form action={startRunAction} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-4">
            <라벨 이름="이야기">
              <select name="story_code" className={입력칸} defaultValue={이야기들[0]?.slug}>
                {이야기들.map((이야기) => (
                  <option key={이야기.id} value={이야기.slug}>
                    {이야기.title}
                  </option>
                ))}
              </select>
            </라벨>
            <라벨 이름="어디까지 진행할지">
              <select name="scope" className={입력칸} defaultValue="story">
                <option value="story">이야기 전체</option>
                <option value="scene">장면 하나만</option>
              </select>
            </라벨>
            <라벨 이름="몇 번째 장면" 도움말="「장면 하나만」을 골랐을 때 적습니다">
              <input name="scene_order" type="number" min={1} className={`w-36 ${입력칸}`} />
            </라벨>
            <라벨 이름="시작한 사람" 도움말="나중에 누가 돌렸는지 찾을 때 씁니다">
              <input name="started_by" className={`w-40 ${입력칸}`} />
            </라벨>
            <라벨 이름="실험 메모" 도움말="무엇을 확인하려고 돌리는지 적어 둡니다">
              <input name="experiment_note" className={`w-64 ${입력칸}`} />
            </라벨>
          </div>

          {/* 🔴 이 넷이 비면 `runs` 에 NULL 이 남아 「무엇으로 돌렸나」가 기록에서 사라진다.
              회차끼리 견주는 것이 이 도구의 존재 이유라 그게 실질적 손실이다. */}
          <div className="flex flex-wrap gap-4">
            <LLM칸
              제목="아이 말을 알아듣는 AI"
              이름="analysis"
              모델들={모델들}
              기본_모델={설정.gemini_model}
              강도들={고를_수_있는_강도}
              기본_강도={설정.gemini_effort}
            />
            <LLM칸
              제목="캐릭터가 되어 말하는 AI"
              이름="character"
              모델들={모델들}
              기본_모델={설정.gemini_model}
              강도들={고를_수_있는_강도}
              기본_강도={설정.gemini_effort}
            />
          </div>

          <div>
            {/* ⭐ 눌린 뒤 스스로 잠긴다. 2026-08-13 에 두 번 눌려 회차가 둘 생겼다.
                ⭐ AI 를 부르는 단추라 색과 **글자 둘 다**로 알린다 (규칙 3-6). 확인창은
                   쓰지 않기로 했으므로(규칙 3-5) 이 글자가 유일한 예고다. */}
            <보내기 className={단추.AI} 도는중="시작하는 중…">
              회차 시작 (AI 호출)
            </보내기>
          </div>
        </form>

        {이야기들.length === 0 && (
          <오류띠 문구="이야기 목록이 비어 있어 회차를 시작할 수 없습니다. 앱에 이야기 자료가 아직 심어지지 않았습니다 — 개발 담당자에게 알려 주세요." />
        )}
      </카드>

      <카드
        제목="지난 회차"
        설명="줄을 누르면 그 회차에서 무슨 말이 오갔는지, 어떤 설정으로 돌렸는지 볼 수 있습니다."
        곁들이기={<span className="text-[15px] font-bold text-ink-muted">{회차들.length}건</span>}
      >
        {회차들.length === 0 ? (
          <빈자리
            무엇="아직 진행한 회차가 없습니다."
            다음="위 「새 회차 시작」에서 이야기를 골라 시작해 보세요."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[14px]">
              <thead>
                <tr className="border-b border-divider text-left text-ink-muted">
                  {['언제', '이야기', '상태', '아이가 말한 횟수', '대사 규칙 위반'].map(
                    (이름) => (
                      <th key={이름} className="py-2 pr-4 font-bold">
                        {이름}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {회차들.map((회차) => (
                  <tr key={회차.id} className="border-b border-divider hover:bg-chip">
                    <td className="py-2.5 pr-4 whitespace-nowrap">
                      <Link
                        href={`/runs/${회차.id}`}
                        className="font-bold text-primary-strong underline"
                      >
                        {회차.started_at.toISOString().slice(0, 16).replace('T', ' ')}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-4">
                      {회차.story_title}
                      {회차.experimental && (
                        <span className="ml-2 rounded-lg bg-warn-soft px-2 py-0.5 text-[12px] font-bold text-warn">
                          실험
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 whitespace-nowrap">
                      {상태_이름[회차.status] ?? 회차.status}
                    </td>
                    <td className="py-2.5 pr-4">
                      <값 것={회차.turn_count === 0 ? null : `${회차.turn_count}번`} 없을때="아직 없음" />
                    </td>
                    {/* 🔴 캐릭터 **대사**의 채점이다. 아이 말 분석 채점(골든셋)과 다른 것이고,
                        이름을 갈라 부르는 것이 규칙 2-9 다. */}
                    <td className="py-2.5 pr-4">
                      <자동채점칸 요약={회차.score} />
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
