// 관리자 화면 **전부**가 함께 쓰는 조각 (이슈 #26).
//
// ⛔ **여기에 규칙이 없다.** 값을 어떻게 보이느냐만 정한다.
// ⚠️ 라우트 파일(`page.tsx`)에서 이런 것을 export 하지 않는다 — Next 가 그 파일의 export 를
//    규격으로 검사하므로, 화면 조각은 라우트가 **아닌** 파일에 둔다.
//
// ## 왜 `runs/ui.tsx` 가 아니라 여기인가 (2026-08-13)
//
// 화면마다 담당이 갈려 있어 이 셋이 두 벌 있었다 — `runs/ui.tsx` 와 `goldenset/ui.tsx` 에
// **글자까지 같은** `한칸`·`오류띠`·`라벨` 이. 그리고 시드·프롬프트 작업대·검수 화면은
// `../runs/ui` 를 가져다 썼는데, 그러면 「시드 화면이 회차 화면에 딸려 있다」로 읽힌다.
//
// 두 `ui.tsx` 는 그대로 두고 여기서 다시 내보내게 했다 — 화면 파일들의 import 줄을
// 건드리지 않으려는 것이다. **합치면서 보이는 것을 바꾸지 않는다.**

/** `?error=` · `?file=` 는 배열로도 올 수 있다. 첫 값만 본다. */
export function 한칸(값: string | string[] | undefined): string | null {
  if (값 === undefined) return null
  return Array.isArray(값) ? (값[0] ?? null) : 값
}

export function 오류띠({ 문구 }: { 문구: string }) {
  return (
    <p className="border border-red-500 bg-red-50 px-3 py-2 font-mono text-xs text-red-700">
      {문구}
    </p>
  )
}

export function 라벨({ 이름, children }: { 이름: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-mono text-xs text-zinc-500">{이름}</span>
      {children}
    </label>
  )
}
