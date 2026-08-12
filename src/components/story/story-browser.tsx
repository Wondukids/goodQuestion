"use client";

import { useState } from "react";
import { StoryBrowseCard } from "@/components/story/story-card";
import { STORY_TOPICS, type Story, type StoryTopic } from "@/lib/story-types";

export function StoryBrowser({ stories }: { stories: Story[] }) {
  const [topic, setTopic] = useState<StoryTopic>("전체");

  const visible =
    topic === "전체" ? stories : stories.filter((story) => story.topic === topic);

  return (
    <div className="flex flex-col">
      <div
        role="tablist"
        aria-label="주제별 보기"
        className="flex h-[74px] items-start gap-3 overflow-x-auto px-[60px] py-4"
      >
        {STORY_TOPICS.map((item) => {
          const selected = item === topic;

          return (
            <button
              key={item}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setTopic(item)}
              className={`shrink-0 rounded-full px-6 py-3.5 text-[16px] ${
                selected
                  ? "bg-primary font-extrabold text-white"
                  : "bg-[#efefef] font-bold text-[#767676]"
              }`}
            >
              {item}
            </button>
          );
        })}
      </div>

      <div className="mt-[15px] flex flex-wrap content-start items-start gap-x-[30px] gap-y-[60px] px-12">
        {visible.map((story) => (
          <StoryBrowseCard key={story.id} story={story} />
        ))}
      </div>

      {visible.length === 0 && (
        <p className="px-12 pt-6 text-[18px] font-bold text-ink-soft">
          이 주제의 이야기는 아직 없어요.
        </p>
      )}
    </div>
  );
}
