"use server";

import { redirect } from "next/navigation";
import { markAttendance } from "@/lib/attendance";
import { requireSelectedChild } from "@/lib/selected-child";
import { createClient } from "@/lib/supabase/server";

/**
 * "이야기 시작하기" — 재생 화면으로 가기 전에 story_sessions 에 흔적을 남긴다.
 * 홈 "이어서 볼까요?" 와 추천 캐시 무효 판정이 이 기록을 읽는다.
 * 같은 이야기의 진행중 세션이 있으면 새로 만들지 않고 활동 시각만 당긴다.
 */
export async function startStory(slug: string) {
  const child = await requireSelectedChild();
  const supabase = await createClient();

  const { data: story } = await supabase
    .from("stories")
    .select("id, status")
    .eq("slug", slug)
    .maybeSingle();
  if (!story || story.status !== "published") redirect(`/stories/${slug}`);

  const { data: existing } = await supabase
    .from("story_sessions")
    .select("id")
    .eq("child_id", child.id)
    .eq("story_id", story.id)
    .eq("status", "in_progress")
    .order("last_activity_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  /* 기록이 실패해도 재생을 막지 않는다 — 에러는 로그만 남기고 이동한다. */
  const { error } = existing
    ? await supabase
        .from("story_sessions")
        .update({ last_activity_at: new Date().toISOString() })
        .eq("id", existing.id)
    : await supabase
        .from("story_sessions")
        .insert({ child_id: child.id, story_id: story.id });
  if (error) console.error("세션 기록 실패:", error.message);

  /* 이야기를 시작했으면 그날 온 것이다 — 마이페이지에서 따로 누르지 않아도 출석이 찍힌다.
     이어하기는 세션을 새로 만들지 않아 started_at 이 안 움직이므로 여기서 챙겨야 한다.
     출석도 재생을 막지 않는다. */
  await markAttendance(child.id).catch((cause: unknown) =>
    console.error("출석 기록 실패:", cause),
  );

  redirect(`/stories/${slug}/play`);
}
