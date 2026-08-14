import "server-only";

import { createClient } from "@/lib/supabase/server";

/* 출석은 한국 날짜 기준이다. 서버(Vercel)는 UTC 로 도니 날짜를 자를 때마다
   Asia/Seoul 로 옮겨야 한다 — 그냥 자르면 저녁 9시 이후 활동이 전날로 밀린다. */
const KST = "Asia/Seoul";

/** 오늘(KST) 을 YYYY-MM-DD 로. en-CA 로케일이 그 형식을 그대로 준다. */
export function kstToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: KST }).format(new Date());
}

/** YYYY-MM-DD 문자열에 일수를 더한다. UTC 자정으로 다뤄 서머타임·시차 영향을 뺀다. */
function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 그 주의 월요일. getUTCDay 는 일=0 이라 +6 %7 로 월=0 이 되게 옮긴다. */
function weekStart(date: string): string {
  const weekday = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -weekday);
}

const DAY_LABELS = ["월", "화", "수", "목", "금", "토", "일"] as const;

export type AttendanceDay = {
  /** YYYY-MM-DD (KST) */
  date: string;
  label: (typeof DAY_LABELS)[number];
  attended: boolean;
  isToday: boolean;
  /** 아직 오지 않은 요일 — 도트를 빈 원으로 둔다 */
  isFuture: boolean;
};

export type WeekAttendance = {
  days: AttendanceDay[];
  /** 오늘 이미 출석했는지 — 버튼 문구가 갈린다 */
  todayDone: boolean;
};

/** 이번 주(월~일, KST) 출석 도장. */
export async function getWeekAttendance(
  childId: string,
): Promise<WeekAttendance> {
  const today = kstToday();
  const start = weekStart(today);
  const end = addDays(start, 6);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("child_attendance")
    .select("attended_on")
    .eq("child_id", childId)
    .gte("attended_on", start)
    .lte("attended_on", end);

  if (error) throw new Error(`출석 조회 실패: ${error.message}`);

  const marked = new Set((data ?? []).map((row) => row.attended_on));
  const days = DAY_LABELS.map((label, index) => {
    const date = addDays(start, index);
    return {
      date,
      label,
      attended: marked.has(date),
      isToday: date === today,
      isFuture: date > today,
    };
  });

  return { days, todayDone: marked.has(today) };
}

/**
 * 오늘 출석 도장을 찍는다. (child_id, attended_on) 유니크라 몇 번을 불러도 한 줄이다 —
 * "출석하기" 버튼과 이야기 시작이 같은 날 겹쳐도 안전하다.
 */
export async function markAttendance(childId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("child_attendance")
    .upsert(
      { child_id: childId, attended_on: kstToday() },
      { onConflict: "child_id,attended_on", ignoreDuplicates: true },
    );

  if (error) throw new Error(`출석 기록 실패: ${error.message}`);
}

/** 아이를 등록한 날부터 오늘까지 며칠째인지 — 등록 당일이 1일차. */
export function togetherDays(childCreatedAt: string): number {
  const joined = new Intl.DateTimeFormat("en-CA", { timeZone: KST }).format(
    new Date(childCreatedAt),
  );
  const diff =
    (Date.parse(`${kstToday()}T00:00:00Z`) - Date.parse(`${joined}T00:00:00Z`)) /
    86_400_000;
  return Math.max(1, Math.floor(diff) + 1);
}
