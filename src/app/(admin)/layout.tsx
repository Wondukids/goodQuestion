// 관리자 화면의 껍데기 (이슈 #26 화면-3).
//
// 🔴 **이 화면은 도구지 엔진이 아니다** (`CLAUDE.md` 경계 6). 모드·장면 종료를 스스로
// 계산하지 않고 `lib/service/*` 를 부를 뿐이다. 아이가 쓰는 제품 화면도 아니다.
//
// ⚠️ **여기 화면은 여기서 보는 용도다.** 팀 repo 규약(「자기 폴더 안에서만」)과 부딪히므로
//    그대로 옮겨가지 않는다. 그래도 만드는 이유는 **엔진을 사람 눈으로 확인하는 자리**가
//    있어야 하기 때문이다. 그래서 최소로 만든다 — 프론트엔드 빌드 도구를 새로 들이지 않는다.
//
// ⚠️ `(admin)` 은 **경로에 안 들어가는 묶음 폴더**다 (Next `route-groups.md`).
//    주소는 `/runs` 이지 `/(admin)/runs` 가 아니다.

import Link from 'next/link'

export const metadata = {
  title: '굿퀘스천 관리자',
}

/**
 * 차림표 — 화면 여섯으로 가는 길.
 *
 * ⚠️ **여기 말고 화면에 들어갈 길이 없다.** 각 화면을 따로 세운 탓에 `/runs` 밖의 다섯은
 *    주소를 손으로 쳐야만 닿았다. 그 자리를 메운 것이 이 목록이다.
 *
 * ⛔ 새 디자인이 아니다 — 머리말에 이미 있던 `Link` 와 같은 모양·같은 크기를 쓴다.
 */
const 차림표: readonly (readonly [string, string])[] = [
  ['/runs', '회차'],
  ['/seed', '시드 작업대'],
  ['/review/pending', '검수'],
  ['/goldenset', '골든셋'],
  ['/characters', '캐릭터 보기'],
  ['/prompt-lab', '프롬프트 작업대'],
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 text-sm">
      <header className="mb-6 flex flex-col gap-2 border-b border-zinc-300 pb-3 dark:border-zinc-700">
        <div className="flex items-baseline gap-4">
          <Link href="/runs" className="text-base font-semibold">
            굿퀘스천 관리자
          </Link>
          <span className="text-xs text-zinc-500">
            엔진을 눈으로 확인하는 자리다. 아이가 쓰는 화면이 아니다.
          </span>
        </div>
        <nav className="flex flex-wrap items-baseline gap-3 text-xs">
          {차림표.map(([주소, 이름]) => (
            <Link key={주소} href={주소} className="underline">
              {이름}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </div>
  )
}
