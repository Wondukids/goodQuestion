// 시드 작업대의 조각들 (이슈 #26 화면-2).
//
// ⛔ **여기에 규칙이 없다.** 값을 어떻게 보이느냐만 정한다.
// ⚠️ 라우트 파일(`page.tsx`)에서 이런 것을 export 하지 않는다 — Next 가 그 파일의 export 를
//    규격으로 검사하므로, 화면 조각은 라우트가 **아닌** 파일에 둔다
//    (`app/(admin)/runs/ui.tsx` 와 같은 규칙이다).

import { 고를_수_있는_출처, 출처_이름 } from '@/llm/service/seed'

/** 폼이 어느 칸을 고치는지. 파이썬에서는 이것이 주소(`/seed/{table}/{row_id}/{column}`)였다. */
export function 숨은칸들({
  table_name,
  row_id,
  column_name,
  json_key,
}: {
  table_name: string
  row_id: string
  column_name: string
  json_key?: string
}) {
  return (
    <>
      <input type="hidden" name="table_name" value={table_name} />
      <input type="hidden" name="row_id" value={row_id} />
      <input type="hidden" name="column_name" value={column_name} />
      {json_key !== undefined && <input type="hidden" name="json_key" value={json_key} />}
    </>
  )
}

/** 칸 이름 + 지금 출처 배지. 배지에는 **셋 다** 뜬다 (`표시 없음` 도 상태다). */
export function 칸머리({ 이름, 출처 }: { 이름: string; 출처: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="text-[15px] font-bold text-ink">{이름}</span>
      <span className="rounded-md bg-chip px-2 py-0.5 text-[12px] font-bold text-ink-mid">
        {출처_이름[출처] ?? 출처}
      </span>
    </span>
  )
}

/**
 * 출처 고르개. **고를 수 있는 것 둘뿐이다** — `unmarked` 는 읽기 전용 상태라 넣지 않는다
 * (넣으면 고른 순간 400 이 난다).
 */
export function 출처고르개({ 지금 }: { 지금: string }) {
  // 지금 값이 `unmarked` 면 고르개에 그 값이 없다. 그때는 `draft` 가 첫 값이 된다.
  const 처음 = 지금 in 고를_수_있는_출처 ? 지금 : 'draft'
  return (
    <label className="flex items-center gap-2 text-[14px] text-ink-soft">
      이 값의 출처
      <select
        name="origin"
        defaultValue={처음}
        className="rounded-lg border border-divider bg-surface px-2 py-1.5 text-[14px] text-ink outline-none focus:border-primary"
      >
        {Object.entries(고를_수_있는_출처).map(([값, 글]) => (
          <option key={값} value={값}>
            {글}
          </option>
        ))}
      </select>
    </label>
  )
}

/**
 * 「시드 파일 값 보기」 — ⭐ **대조용으로 읽기만 한다** (2026-08-10 결정 8).
 *
 * 파일을 못 읽었으면 `null` 이 와서 「값 없음」이 뜬다. 화면이 안 죽는 것이 먼저다.
 */
export function 시드파일값({ 값 }: { 값: string | null }) {
  return (
    <details>
      <summary className="w-fit cursor-pointer text-[13px] text-ink-faint">
        원본 파일에 있는 값과 견주기
      </summary>
      <pre className="mt-1.5 overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-chip p-3 text-[13px] text-ink">
        {값 ?? '원본 파일에 이 값이 없습니다.'}
      </pre>
    </details>
  )
}

/**
 * 이 칸 저장 단추. 파이썬 템플릿의 「이 칸 저장」·「입장 저장」 자리다.
 *
 * ⭐ AI 를 부르지 않고 되돌리기도 있는 저장이라 **보통 단추**다 (규칙 3-5 갈래 A).
 */
export function 저장단추({ 글 = '이 칸 저장' }: { 글?: string }) {
  return (
    <button
      type="submit"
      className="rounded-xl border border-divider bg-surface px-4 py-2 text-[14px] font-bold text-ink hover:border-primary"
    >
      {글}
    </button>
  )
}
