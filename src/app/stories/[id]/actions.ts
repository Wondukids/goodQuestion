"use server";

import { redirect } from "next/navigation";
import { requireSelectedChild } from "@/lib/selected-child";
import { LookupError, ValueError } from "@/llm/service/step";
import { openSession } from "@/session/service/open";

/**
 * "이야기 시작하기" — 세션 열기(4.1)를 거쳐 재생 화면으로 간다 (이슈 #6).
 *
 * 전에는 Supabase 로 `story_sessions` 에 흔적만 남기고 **실패해도 넘어갔다.**
 * 이제 세션이 이어하기의 근거라서 생성 실패는 막는다 (`docs/이야기_세션_명세.md` 4절
 * 운영 전제) — `openSession()` 이 세션·회차 동반 생성과 따라잡기까지 다 안다.
 */
export async function startStory(slug: string) {
  const child = await requireSelectedChild();

  try {
    await openSession({ child_id: child.id, story: slug });
  } catch (오류) {
    // 없는 이야기·공개 전 이야기는 인트로로 돌려보낸다 — 전과 같은 흐름이다.
    if (오류 instanceof LookupError || 오류 instanceof ValueError) redirect(`/stories/${slug}`);
    throw 오류;
  }

  redirect(`/stories/${slug}/play`);
}
