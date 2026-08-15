'use client'

// 관리자 차림표 (이슈 #27 · 규칙 2-1).
//
// 🔴 **왜 클라이언트 조각인가** — 지금 어느 화면에 있는지 표시하려면 주소를 알아야 하고,
//    `usePathname()` 은 클라이언트에서만 돈다. 레이아웃 전체를 클라이언트로 만들지 않으려고
//    차림표만 떼어 냈다.
//
// ⛔ **여기에 규칙이 없다.** 어느 화면이 있는지는 아래 목록이 전부고, 이 조각은 그릴 뿐이다.

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * 화면 여섯으로 가는 길.
 *
 * 🔴 **각 줄에 한 줄 설명이 붙는다** (규칙 2-1 의 연장). 예전에는 이름만 있는 밑줄 링크
 *    여섯이라, 처음 온 사람이 「골든셋」이 무엇인지 알 길이 차림표에 없었다.
 *
 * ⚠️ 이름은 `docs/관리자_디자인_규칙.md` 규칙 2-2 의 용어표를 따른다. 거기서 뜻이 바뀌면
 *    여기 글자도 함께 바뀐다.
 */
const 차림표: readonly { 주소: string; 이름: string; 설명: string }[] = [
  {
    주소: '/runs',
    이름: '회차',
    설명: '아이와 AI 가 이야기를 진행한 기록을 보고, 새로 진행해 봅니다',
  },
  {
    주소: '/seed',
    이름: '이야기 설정',
    설명: '이야기와 캐릭터의 설정값을 고칩니다',
  },
  {
    주소: '/review/pending',
    이름: '검수',
    설명: 'AI 가 매긴 판정을 사람이 다시 봅니다',
  },
  {
    주소: '/goldenset',
    이름: '정답지 채점',
    설명: '미리 적어 둔 정답과 맞춰 AI 가 얼마나 맞히는지 잽니다',
  },
  {
    주소: '/characters',
    이름: '캐릭터 보기',
    설명: '원작에서 온 값과 우리가 지어낸 값을 갈라 봅니다',
  },
  {
    주소: '/prompt-lab',
    이름: '지시문 작업대',
    설명: 'AI 에게 주는 지시문을 회차 하나에만 바꿔 넣어 시험합니다',
  },
]

/** 지금 보는 화면인가. `/runs/{id}` 처럼 아래로 더 들어간 주소도 같은 화면으로 친다. */
function 여기인가(지금: string, 주소: string): boolean {
  // ⚠️ `/review/pending` 은 앞머리가 `/review` 라, 검수 화면 아래(`/review/runs/…`)도
  //    같은 차림표 줄로 잡아야 사람이 「내가 검수에 있다」를 안다.
  const 뿌리 = 주소 === '/review/pending' ? '/review' : 주소
  return 지금 === 뿌리 || 지금.startsWith(`${뿌리}/`)
}

/**
 * ⚠️ **이 함수만 이름이 영어다.** `react-hooks/rules-of-hooks` 가 「대문자로 시작하면
 *    컴포넌트」로 훅 자리를 판별하는데, 한글 이름은 대문자가 없어 컴포넌트로 안 쳐 준다.
 *    검사를 끄는 대신 이름을 맞추고, 화면이 쓰는 이름은 아래에서 `차림` 으로 내보낸다
 *    (`runs/submit.tsx` 의 `SubmitButton` 과 같은 처리다).
 */
function AdminNav({ 접힘 = false }: { 접힘?: boolean }) {
  const 지금 = usePathname()
  return (
    <nav className="flex flex-wrap gap-2">
      {차림표.map(({ 주소, 이름, 설명 }) => {
        const 여기 = 여기인가(지금, 주소)
        return (
          <Link
            key={주소}
            href={주소}
            aria-current={여기 ? 'page' : undefined}
            className={`flex flex-col gap-0.5 rounded-2xl border px-4 py-2.5 transition-colors ${
              여기
                ? 'border-primary bg-primary-soft'
                : 'border-divider bg-surface hover:border-primary'
            }`}
          >
            <span
              className={`text-[15px] font-extrabold ${여기 ? 'text-primary-strong' : 'text-ink'}`}
            >
              {이름}
            </span>
            {!접힘 && <span className="text-[12px] text-ink-faint">{설명}</span>}
          </Link>
        )
      })}
    </nav>
  )
}

export { AdminNav as 차림 }
