"use client";

import { useEffect, useState } from "react";
import { ContinueStoryCard } from "@/components/story/story-card";
import type { Story } from "@/lib/story-types";

/**
 * 홈 이어하기 카드 + 실제 진행률 (이슈 #8 — `docs/이야기_세션_명세.md` 4.2절).
 *
 * 진행률은 세션 API(GET /api/sessions/{id})의 `progress {scene_order, total}` 다.
 * 서버 컴포넌트(홈)는 자기 API 라우트를 부르기 어색하니, 카드가 클라이언트에서
 * 채운다 — 조회 전·실패 시엔 진행바만 빠진 카드가 그대로 보인다.
 *
 * 이어서 보기는 재생 화면 직접 진입이다 — 세션 열기는 재생 화면의
 * 「이야기 시작」이 POST /api/sessions 로 다시 하므로 여기서는 링크만 바꾼다.
 */
export function ContinueStoryLive({
  story,
  sessionId,
}: {
  story: Story;
  sessionId: string;
}) {
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`);
        const body = (await res.json()) as {
          ok: boolean;
          data?: { progress?: { scene_order: number; total: number } };
        };
        const p = body.ok ? body.data?.progress : undefined;
        if (!cancelled && p && p.total > 0) {
          setProgress(Math.min(p.scene_order / p.total, 1));
        }
      } catch {
        /* 조회 실패 — 진행바 없이 그대로 (카드가 막히면 안 된다) */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <ContinueStoryCard
      story={{ ...story, progress }}
      href={`/stories/${story.id}/play`}
    />
  );
}
