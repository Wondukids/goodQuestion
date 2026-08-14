import { checkInToday } from "@/app/(main)/mypage/actions";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { WeekAttendance } from "@/lib/attendance";

/**
 * 이번 주 출석(시안 41-1717) — 월~일 도트 일곱 개와 출석하기 버튼.
 *
 * 도트 세 가지: 출석한 날은 채운 원 + 체크, 오늘은 같은 원을 진한 색으로,
 * 아직 안 온 날은 테두리만 있는 빈 원.
 */
export function AttendanceCard({ week }: { week: WeekAttendance }) {
  return (
    <section className="flex w-full flex-1 flex-col items-center justify-between rounded-[20px] bg-surface-muted p-5">
      <h2 className="font-gothic text-[16px] font-extrabold text-[#3d3d3d]">
        이번 주 출석
      </h2>

      <ul className="flex w-full items-start gap-1.5">
        {week.days.map((day) => (
          <li
            key={day.date}
            className="flex min-w-0 flex-1 flex-col items-center gap-[5px]"
          >
            <span className="text-[12px] font-extrabold text-ink-strong">
              {day.label}
            </span>
            <span
              aria-label={`${day.label}요일 ${day.attended ? "출석" : "미출석"}`}
              className={`flex size-[18px] items-center justify-center rounded-full ${
                day.attended
                  ? day.isToday
                    ? "bg-primary-strong text-story-bg"
                    : "bg-primary text-story-bg"
                  : "border-[1.5px] border-primary bg-story-bg"
              }`}
            >
              {day.attended && <MaterialSymbol name="check" size={12} />}
            </span>
          </li>
        ))}
      </ul>

      {/* 오늘 이미 찍혔으면 누를 것이 없다 — 이야기를 시작해도 자동으로 찍힌다. */}
      <form action={checkInToday} className="w-full">
        <button
          type="submit"
          disabled={week.todayDone}
          className="flex w-full cursor-pointer items-center justify-center rounded-lg bg-primary-strong px-6 py-2 text-[16px] leading-[1.5] font-extrabold text-story-bg disabled:cursor-default disabled:bg-[#bdbdbd]"
        >
          {week.todayDone ? "오늘 출석 완료!" : "출석하기"}
        </button>
      </form>
    </section>
  );
}
