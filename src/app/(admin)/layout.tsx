// 관리자 화면의 껍데기 (이슈 #27).
//
// 🔴 **이 화면은 도구지 엔진이 아니다** (`CLAUDE.md` 경계 6). 모드·장면 종료를 스스로
// 계산하지 않고 `lib/service/*` 를 부를 뿐이다.
//
// ⚠️ **여기 화면은 여기서 보는 용도다.** 팀 repo 규약(「자기 폴더 안에서만」)과 부딪히므로
//    그대로 옮겨가지 않는다. 그래도 만드는 이유는 **엔진을 사람 눈으로 확인하는 자리**가
//    있어야 하기 때문이다. 그래서 최소로 만든다 — 프론트엔드 빌드 도구를 새로 들이지 않는다.
//
// ⚠️ `(admin)` 은 **경로에 안 들어가는 묶음 폴더**다 (Next `route-groups.md`).
//    주소는 `/runs` 이지 `/(admin)/runs` 가 아니다.
//
// ## 2026-08-14 — 「아이 화면이 아니다」에서 「운영자도 보는 화면」으로 (#27)
//
// 🔴 예전 머리말은 「아이가 쓰는 화면이 아니다」라고 적고 있었다. 그때는 개발자만 봤기
//    때문이다. 이제 **해커톤 운영자가 직접 클릭한다** — 그 사람은 AI 도 우리 DB 도 모른다.
//    그래서 껍데기부터 제품 토큰(`bg-app-bg`·`text-ink`·`shadow-panel`)을 쓰고,
//    차림표에 각 화면이 무엇을 하는 곳인지 한 줄씩 붙였다
//    (`docs/관리자_디자인_규칙.md` 규칙 1-7 · 2-1).

import Link from 'next/link'

import { 차림 } from './nav'

export const metadata = {
  title: '굿퀘스천 관리자',
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-8">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <Link href="/runs" className="text-[20px] font-extrabold text-ink">
            굿퀘스천 관리자
          </Link>
          <span className="text-[14px] text-ink-muted">
            아이와 AI 가 나눈 이야기를 사람이 확인하고 다듬는 곳입니다.
          </span>
        </div>
        <차림 />
      </header>
      {children}
    </div>
  )
}
