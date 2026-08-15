"use server";

import { redirect } from "next/navigation";
import { markAttendance } from "@/lib/attendance";
import { requireSelectedChild } from "@/lib/selected-child";

/**
 * "이야기 시작하기" — 아이 확인과 출석만 남기고 재생 화면으로 보낸다.
 *
 * 세션 열기(4.1)는 재생 화면의 `beginStory` 가 맡는다 (`docs/이야기_세션_명세.md` 6.2절).
 * 여기서 열면 재생 화면의 열기가 그 세션을 다시 찾아 첫 시작이 이어하기로 둔갑한다
 * (2026-08-14 실사용 — part1 을 건너뛰고 대화 씬으로 점프하던 버그).
 *
 * ⚠️ 2026-08-15 머지 — `main` 쪽은 여기서 `story_sessions` 를 직접 넣고 있었다.
 *    그 부분은 위 버그 때문에 **일부러 걷어낸 것**이라 되살리지 않는다. 같이 들어온
 *    출석 기록만 가져온다.
 */
export async function startStory(slug: string) {
  const child = await requireSelectedChild();

  /* 이야기를 시작했으면 그날 온 것이다 — 마이페이지에서 따로 누르지 않아도 출석이 찍힌다.
     출석 기록이 실패해도 재생을 막지 않는다. */
  await markAttendance(child.id).catch((cause: unknown) =>
    console.error("출석 기록 실패:", cause),
  );

  redirect(`/stories/${slug}/play`);
}
