import Link from "next/link";

/** 보호자 리포트로 들어가는 문. 아이용 파란 톤과 구분되도록 따뜻한 색을 쓴다. */
export function ParentReportCard() {
  return (
    <div className="flex flex-col gap-6 rounded-[28px] border-2 border-line bg-warm px-10 py-8">
      <div className="flex flex-col gap-2">
        <span className="text-[16px] font-extrabold text-brand-900">
          보호자님께
        </span>
        <p className="text-[22px] font-extrabold text-ink">
          우리 아이가 나눈 대화와 성장이 궁금하신가요?
        </p>
        <p className="text-[16px] font-bold text-ink-soft">
          아이의 관심사와 멋진 답변을 리포트로 정리해 드려요.
        </p>
      </div>

      <Link
        href="/report"
        className="self-start rounded-full bg-brand-900 px-10 py-4 text-[20px] font-extrabold text-white"
      >
        보호자 리포트 보기
      </Link>
    </div>
  );
}
