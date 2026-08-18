"use client";

import { useState } from "react";
import { CompactStoryCard } from "@/components/story/story-card";
import { TOPIC_TILES, TopicTileButton } from "@/components/story/topic-tiles";
import type { Story } from "@/lib/story-types";

/**
 * 주제 타일 + 아래 이야기 목록(시안 49:920).
 *
 * 고르기 전에는 타일만 보이고, 타일을 누르면 홈을 떠나지 않고 그 주제의
 * 이야기 전체가 아래에 뜬다(다시 누르면 해제되어 다시 타일만 남는다).
 * 이어하기가 있든(77) 없든(76) 시안이 같은 그리드 카드라, 예전처럼 가로 카드로
 * 갈라지지 않는다.
 */
export function TopicBrowse({
  stories,
  initialTopic = null,
}: {
  stories: Story[];
  /** 프리뷰·딥링크용 — 처음부터 이 주제가 골라진 채로 연다. */
  initialTopic?: string | null;
}) {
  const [topic, setTopic] = useState<string | null>(initialTopic);

  const visible = topic
    ? stories
        .filter((story) => story.topic === topic)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    : [];

  return (
    <div className="flex flex-col gap-[30px]">
      <div className="flex gap-4">
        {TOPIC_TILES.map((tile) => {
          const selected = topic === tile.topic;
          return (
            <TopicTileButton
              key={tile.label}
              tile={tile}
              count={
                stories.filter((story) => story.topic === tile.topic).length
              }
              selected={selected}
              onClick={() => setTopic(selected ? null : tile.topic)}
            />
          );
        })}
      </div>

      {topic &&
        (visible.length === 0 ? (
          <p className="px-4 text-[18px] font-bold text-ink-soft">
            이 주제의 이야기는 아직 없어요.
          </p>
        ) : (
          /* 카드가 4장이 안 돼도 폭이 늘어나지 않게 4열 그리드로 고정한다
             (300 카드 넉 장 + 사이 23px = 1269 로 1270 폭에 꼭 맞는다) */
          <div className="grid grid-cols-4 gap-[23px]">
            {visible.map((story) => (
              <CompactStoryCard key={story.id} story={story} />
            ))}
          </div>
        ))}
    </div>
  );
}
