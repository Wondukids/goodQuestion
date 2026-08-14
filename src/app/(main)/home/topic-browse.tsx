"use client";

import { useState } from "react";
import {
  CompactStoryCard,
  WideStoryCard,
} from "@/components/story/story-card";
import { TOPIC_TILES, TopicTileButton } from "@/components/story/topic-tiles";
import type { Story } from "@/lib/story-types";

/**
 * 주제 타일 + 아래 이야기 목록(시안 21-581).
 *
 * 고르기 전에는 타일만 보이고, 타일을 누르면 홈을 떠나지 않고 그 주제의
 * 이야기 전체가 아래에 뜬다(다시 누르면 해제되어 다시 타일만 남는다).
 * 카드 모양은 이어하기 유무를 따라간다 — 있으면 그리드(21-631), 없으면 가로 카드(21-936).
 */
export function TopicBrowse({
  stories,
  hasContinue,
  initialTopic = null,
}: {
  stories: Story[];
  hasContinue: boolean;
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
        ) : hasContinue ? (
          /* 카드가 4장이 안 돼도 폭이 늘어나지 않게 4열 그리드로 고정한다 */
          <div className="grid grid-cols-4 gap-6">
            {visible.map((story) => (
              <CompactStoryCard key={story.id} story={story} />
            ))}
          </div>
        ) : (
          /* 카드 3장+간격이 1270 을 3px 넘겨 flex 로는 줄바꿈된다 — 3열 그리드로 폭을 맞춘다 */
          <div className="grid grid-cols-3 gap-5">
            {visible.map((story) => (
              <WideStoryCard key={story.id} story={story} />
            ))}
          </div>
        ))}
    </div>
  );
}
