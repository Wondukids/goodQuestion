"use server";

import { redirect } from "next/navigation";
import { requireSelectedChild } from "@/lib/selected-child";

/**
 * "이야기 시작하기" — 아이 확인만 하고 재생 화면으로 보낸다.
 *
 * 세션 열기(4.1)는 재생 화면의 `beginStory` 가 맡는다 (`docs/이야기_세션_명세.md` 6.2절).
 * 여기서 열면 재생 화면의 열기가 그 세션을 다시 찾아 첫 시작이 이어하기로 둔갑한다
 * (2026-08-14 실사용 — part1 을 건너뛰고 대화 씬으로 점프하던 버그).
 */
export async function startStory(slug: string) {
  await requireSelectedChild();
  redirect(`/stories/${slug}/play`);
}
