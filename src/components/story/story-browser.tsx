"use client";

import { useState } from "react";
import { CompactStoryCard } from "@/components/story/story-card";
import {
  ALL_TILE,
  TOPIC_TILES,
  TopicTileButton,
} from "@/components/story/topic-tiles";
import type { Story } from "@/lib/story-types";

/**
 * 이야기 목록(시안 21-682). 상단은 홈과 같은 주제 타일에 "전체" 를 앞세운 필터,
 * 아래는 "읽던 이야기 N편"(진행 중일 때만) · "새로운 이야기" 두 섹션이다.
 * 완결한 이야기도 다시 볼 수 있어야 하므로 "새로운 이야기" 에는
 * 진행 중인 것만 빼고 전부 담는다.
 */
export function StoryBrowser({
  stories,
  continueStories,
  initialTopic = "전체",
}: {
  stories: Story[];
  /** 진행 중 세션의 이야기 — 최근 활동 순 */
  continueStories: Story[];
  initialTopic?: string;
}) {
  const [topic, setTopic] = useState<string>(initialTopic);

  const matches = (story: Story) =>
    topic === "전체" || story.topic === topic;

  const continueVisible = continueStories.filter(matches);
  const reading = new Set(continueStories.map((story) => story.id));
  const newVisible = stories.filter(
    (story) => !reading.has(story.id) && matches(story),
  );

  return (
    <div className="flex flex-col gap-[40px]">
      <div className="flex gap-4">
        {[ALL_TILE, ...TOPIC_TILES].map((tile) => (
          <TopicTileButton
            key={tile.label}
            tile={tile}
            count={
              tile.topic === "전체"
                ? stories.length
                : stories.filter((story) => story.topic === tile.topic).length
            }
            selected={topic === tile.topic}
            onClick={() => setTopic(tile.topic)}
          />
        ))}
      </div>

      {continueVisible.length > 0 && (
        <section className="flex flex-col gap-[15px]">
          <div className="flex items-center gap-2 px-4">
            <h2 className="text-[24px] leading-[1.6] font-extrabold text-ink-strong">
              읽던 이야기 {continueVisible.length}편
            </h2>
            <p className="font-gothic text-[15px] font-extrabold text-ink-faint">
              이어서 보면 마지막에 봤던 장면부터 시작해요
            </p>
          </div>
          <div className="grid grid-cols-4 gap-6">
            {continueVisible.map((story) => (
              <CompactStoryCard key={story.id} story={story} progress={null} />
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-[15px]">
        <div className="flex items-center gap-2 px-4">
          <h2 className="text-[24px] leading-[1.6] font-extrabold text-ink-strong">
            새로운 이야기
          </h2>
          <p className="font-gothic text-[15px] font-extrabold text-ink-faint">
            눌러서 어떤 이야기인지 살펴보세요
          </p>
        </div>
        {newVisible.length > 0 ? (
          <div className="grid grid-cols-4 gap-6">
            {newVisible.map((story) => (
              <CompactStoryCard key={story.id} story={story} />
            ))}
          </div>
        ) : (
          <p className="px-4 text-[18px] font-bold text-ink-soft">
            이 주제의 이야기는 아직 없어요.
          </p>
        )}
      </section>
    </div>
  );
}
