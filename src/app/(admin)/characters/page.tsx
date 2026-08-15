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

import { elementName } from '@/llm/elements'
import {
  charactersView,
  출처_이름,
  type CharactersView,
  type FieldView,
  type Origin,
} from '@/llm/service/characters'

import { 경고상자, 곁링크, 카드, 화면머리말 } from '../ui'

export const metadata = { title: '캐릭터 보기 — 굿퀘스천 관리자' }

export default async function CharactersPage() {
  // 렌더링이 요청을 기다리게 한다 — 안 그러면 빌드 때 DB 에 붙으려 든다 (`connection.md`).
  await connection()
  const 본것 = await charactersView()

  return (
    <main className="flex flex-col gap-8">
      <화면머리말
        제목="캐릭터 보기"
        설명="이야기에 나오는 캐릭터와 장면의 설정값을 모아 봅니다. 어느 것이 원작 그대로이고 어느 것을 우리가 지어냈는지 갈라 볼 수 있습니다. 여기서는 고칠 수 없습니다 — 고치려면 「이야기 설정」 화면으로 가세요."
        곁들이기={<곁링크 href="/seed">이야기 설정에서 고치기 →</곁링크>}
      />

      <카드 제목="값이 어디서 왔나" 설명="칸마다 출처를 표시해 두었습니다.">
        <p className="flex flex-wrap items-center gap-3">
          {(Object.entries(본것.counts) as [Origin, number][])
            .filter(([, 몇]) => 몇 > 0)
            .map(([출처, 몇]) => (
              <span key={출처} className="flex items-center gap-1.5 text-[15px] text-ink">
                <배지 출처={출처} /> {몇}칸
              </span>
            ))}
        </p>
        {본것.file_differs && (
          <경고상자>
            <b>아래 값은 원본 파일에 저장된 값과 다릅니다.</b> 누군가 화면에서 고쳤고 아직 파일로
            내보내지 않았다는 뜻입니다.
          </경고상자>
        )}
      </카드>

      <카드
        제목="캐릭터"
        설명="아이가 이야기 속에서 만나는 인물들입니다."
        곁들이기={
          <span className="text-[15px] font-bold text-ink-muted">{본것.characters.length}명</span>
        }
      >
        {본것.characters.map((캐릭터) => (
          <article key={캐릭터.id} className="rounded-2xl border border-divider p-4">
            <h3 className="mb-3 text-[17px] font-extrabold text-ink">
              {캐릭터.name}{' '}
              <span className="text-[14px] font-normal text-ink-faint">
                {캐릭터.story_title}
              </span>
            </h3>
            <칸목록 칸들={캐릭터.fields} />
          </article>
        ))}
      </카드>

      <카드
        제목="대화 장면"
        설명="아이가 캐릭터와 실제로 말을 주고받는 장면들입니다."
        곁들이기={
          <span className="text-[15px] font-bold text-ink-muted">{본것.scenes.length}개</span>
        }
      >
        {본것.scenes.map((장면) => (
          <article key={장면.id} className="rounded-2xl border border-divider p-4">
            <h3 className="mb-3 text-[17px] font-extrabold text-ink">
              {장면.scene_order}번째 장면{' '}
              <span className="text-[14px] font-normal text-ink-faint">
                {장면.character_name}
              </span>
            </h3>
            {/* ⚠️ `remaining_worries` 는 아래 표로 따로 그린다. 여기서는 뺀다. */}
            <칸목록 칸들={장면.fields.filter((칸) => 칸.column !== 'remaining_worries')} />
            <걱정표 장면={장면} 출처={본것.worry_origin} />
          </article>
        ))}
      </카드>
    </main>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 조각 — ⚠️ export 하지 않는다. Next 가 `page.tsx` 의 export 를 규격으로 검사한다.
// ═══════════════════════════════════════════════════════════════════════════

const 배지색: Record<Origin, string> = {
  canon: 'border-ok text-ok',
  draft: 'border-warn text-warn',
  unmarked: 'border-divider text-ink-faint',
}

function 배지({ 출처, 도움말 }: { 출처: Origin; 도움말?: string }) {
  return (
    <span
      data-origin={출처}
      title={도움말}
      className={`rounded-md border px-1.5 py-0.5 text-[12px] font-bold ${배지색[출처]}`}
    >
      {출처_이름[출처]}
    </span>
  )
}

/** 값 하나를 화면 표기로. 배열은 목록으로, 없으면 「비어 있음」. */
function 값보기({ 칸 }: { 칸: FieldView }) {
  if (칸.value === null || 칸.value === undefined) {
    return <em className="text-ink-faint not-italic">비어 있음</em>
  }
  if (Array.isArray(칸.value)) {
    // 요구 사고 요소만 한국어 이름표를 붙인다 (`lib/elements.ts` — 화면에서만 쓴다).
    const 값들 =
      칸.column === 'required_elements' ? 칸.value.map((하나) => elementName(String(하나))) : 칸.value
    return <span>{값들.map(String).join(', ')}</span>
  }
  return <span className="whitespace-pre-wrap">{String(칸.value)}</span>
}

/**
 * 칸 목록.
 *
 * 🔴 **DB 컬럼명(`칸.column`)을 옆에 붙이던 것을 뺐다** (규칙 1-1). `칸.label` 이 이미 사람
 *    말이라 컬럼명은 운영자에게 잡음이었다. 개발자가 필요하면 `title` 로 뜬다.
 */
function 칸목록({ 칸들 }: { 칸들: readonly FieldView[] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-[14px]">
      {칸들.map((칸) => (
        <div key={칸.column} className="contents">
          <dt
            title={칸.column}
            className="flex items-baseline gap-1.5 whitespace-nowrap font-bold text-ink-soft"
          >
            {칸.label}
            <배지 출처={칸.origin} 도움말={`${칸.origin_help} (${칸.source})`} />
          </dt>
          <dd className={칸.review_needed ? 'border-l-2 border-warn pl-2 text-ink' : 'text-ink'}>
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
      <p className="text-xs text-ink-muted">
        <strong>부족한 사고 요소를 캐릭터 대사로 미리 옮겨 둔 문장들입니다.</strong> 아이가 아직
        말하지 않은 요소가 있을 때 캐릭터가 이 문장을 그대로 씁니다. 문장이 어색하면 그 자리의
        대화가 통째로 어색해집니다.
      </p>
      {줄들.length === 0 ? (
        <p className="text-xs">
          <em className="text-ink-muted">이 장면에는 걱정 문장이 없습니다.</em>
        </p>
      ) : (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-divider text-left">
              <th className="py-1 pr-3 font-normal">사고 요소</th>
              <th className="py-1 font-normal">그 요소가 아직 없을 때 캐릭터가 하는 걱정</th>
            </tr>
          </thead>
          <tbody>
            {줄들.map(([요소, 걱정]) => (
              <tr key={요소} className="border-b border-divider">
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
