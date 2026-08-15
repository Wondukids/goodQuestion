import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * 마이페이지 통계 두 칸 — 「내가 말한 문장」과 「새로 배운 낱말」.
 *
 * 셋 다 목업이던 자리다. 읽은 이야기 수는 화면이 세션 목록으로 이미 세고 있어
 * 여기서는 DB 를 봐야 하는 둘만 낸다.
 *
 * ## 문장은 **본 대화 + 미션**을 함께 센다 (결정 R23)
 *
 * 보호자 리포트의 「말한 문장 수」와 같은 정의여야 한다
 * (`src/report/domain/metrics.ts` 의 `아이발화` 머리말 — 「세는 자리마다 『미션도 세나?』를
 * 다시 묻게 되면 언젠가 한 군데를 빠뜨린다」). 미션 발화는 `mission_messages` 에 따로 살아
 * `messages` 를 아무리 세도 안 잡힌다 (M5).
 *
 * ## 왜 질의를 넷으로 나눴나
 *
 * 세 표를 한 번에 조인하려면 `mission_messages → mission_sessions → story_sessions` 로
 * 두 단계를 타야 하는데, supabase-js 의 중첩 필터로는 그 조건이 조용히 빠지기 쉽다.
 * 세션 id 를 먼저 받아 `in` 으로 좁히면 각 질의가 눈으로 읽히고, 셋 다 `head: true` 라
 * 행을 실어 오지도 않는다.
 */
export type ChildStats = {
  /** 아이가 말한 문장 수 — 본 대화 + 미션 */
  utterances: number;
  /** 새로 배운 낱말 수 — `child_words` 누적 (같은 낱말은 한 번만, R6) */
  words: number;
};

export async function getChildStats(childId: string): Promise<ChildStats> {
  const supabase = await createClient();

  const [{ data: sessionRows }, wordCount] = await Promise.all([
    supabase.from("story_sessions").select("id").eq("child_id", childId),
    supabase
      .from("child_words")
      .select("*", { count: "exact", head: true })
      .eq("child_id", childId),
  ]);

  const sessionIds = (sessionRows ?? []).map((row) => row.id as string);
  if (sessionIds.length === 0) {
    return { utterances: 0, words: wordCount.count ?? 0 };
  }

  const [dialogue, missionSessions] = await Promise.all([
    supabase
      .from("messages")
      .select("*", { count: "exact", head: true })
      .in("session_id", sessionIds)
      .eq("speaker_type", "child"),
    supabase.from("mission_sessions").select("id").in("session_id", sessionIds),
  ]);

  const missionIds = (missionSessions.data ?? []).map((row) => row.id as string);
  const mission =
    missionIds.length === 0
      ? { count: 0 }
      : await supabase
          .from("mission_messages")
          .select("*", { count: "exact", head: true })
          .in("mission_session_id", missionIds)
          .eq("speaker_type", "child");

  return {
    utterances: (dialogue.count ?? 0) + (mission.count ?? 0),
    words: wordCount.count ?? 0,
  };
}
