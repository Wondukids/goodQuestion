import "server-only";

import { createClient } from "@/lib/supabase/server";

/** 아이 한 명의 이야기 세션 — 홈(이어보기)과 추천 캐시 무효 판정이 읽는다. */
export type ChildStorySession = {
  /** story_sessions.id — 세션 API(GET /api/sessions/{id}) 조회 키 (이슈 #8) */
  id: string;
  /** stories.slug — 앱 전역 키 */
  slug: string;
  status: "in_progress" | "post_activity" | "completed" | "stopped";
  startedAt: string;
  lastActivityAt: string;
};

type SessionRow = {
  id: string;
  status: ChildStorySession["status"];
  started_at: string;
  last_activity_at: string;
  stories: { slug: string } | null;
};

/** 최근 활동 순. story_sessions.story_id 는 uuid 라 slug 로 조인해 돌려준다. */
export async function listChildSessions(
  childId: string,
): Promise<ChildStorySession[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("story_sessions")
    .select("id, status, started_at, last_activity_at, stories(slug)")
    .eq("child_id", childId)
    .order("last_activity_at", { ascending: false });

  if (error) throw new Error(`세션 목록 조회 실패: ${error.message}`);

  return ((data ?? []) as unknown as SessionRow[])
    .filter((row) => row.stories?.slug)
    .map((row) => ({
      id: row.id,
      slug: row.stories!.slug,
      status: row.status,
      startedAt: row.started_at,
      lastActivityAt: row.last_activity_at,
    }));
}
