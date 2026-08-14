import Image from "next/image";
import Link from "next/link";
import { requireSelectedChild } from "@/lib/selected-child";

/**
 * 보호자 리포트 자리 — 마이페이지의 보호자 카드가 이리로 연결된다.
 *
 * 세션 데이터(story_sessions)가 쌓이면 아래 "준비 중" 블록이 실제 내용으로 바뀐다.
 * 보호자용 화면이라 상단·하단 네비 없이 (main) 레이아웃 밖에 둔다.
 */
const UPCOMING = [
  {
    title: "관심사 태그",
    detail: "대화에서 자주 나온 주제를 모아 보여 드려요.",
  },
  {
    title: "답변 하이라이트",
    detail: "아이가 이야기 속에서 한 멋진 말을 골라 드려요.",
  },
  {
    title: "주제 분포",
    detail: "자기이해·용기·감정 중 어떤 이야기를 즐겼는지 정리해요.",
  },
];

export default async function ReportPage() {
  const child = await requireSelectedChild();

  return (
    <main className="min-h-screen bg-warm px-12 py-8">
      <Link
        href="/mypage"
        className="flex w-fit items-center gap-2 text-[18px] font-extrabold text-ink"
      >
        <Image
          src="/figma/icons/arrow-left.svg"
          alt=""
          width={24}
          height={24}
          className="size-6"
        />
        마이페이지로
      </Link>

      <div className="mx-auto flex w-full max-w-[720px] flex-col gap-10 pt-[60px]">
        <header className="flex flex-col gap-3">
          <span className="text-[16px] font-extrabold text-brand-900">
            보호자 리포트
          </span>
          <h1 className="text-[40px] font-extrabold text-ink">
            {child.name}의 성장 이야기
          </h1>
          <p className="text-[18px] font-bold text-ink-soft">
            아이가 이야기 친구와 나눈 대화가 쌓이면 이곳이 채워져요.
          </p>
        </header>

        <ul className="flex flex-col gap-5">
          {UPCOMING.map((block) => (
            <li
              key={block.title}
              className="flex items-center justify-between gap-6 rounded-[20px] border border-line bg-surface px-8 py-6"
            >
              <div className="flex flex-col gap-1.5">
                <h2 className="text-[20px] font-extrabold text-ink">
                  {block.title}
                </h2>
                <p className="text-[16px] font-bold text-ink-soft">
                  {block.detail}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-brand-50 px-3.5 py-1.5 text-[14px] font-bold text-brand-900">
                준비 중
              </span>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
