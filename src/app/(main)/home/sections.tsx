import Link from "next/link";
import {
  RECOMMEND_BADGE_ORDER,
  RecommendedStoryCard,
} from "@/components/story/story-card";
import { TOPIC_TILES } from "@/components/story/topic-tiles";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { getRecommendations } from "@/lib/recommendations";
import type { SelectedChild } from "@/lib/selected-child";
import type { ChildStorySession } from "@/lib/story-sessions";
import type { Story } from "@/lib/story-types";
import { TopicBrowse } from "./topic-browse";

/* 받침 유무로 "와/과" 를 고른다 — "지우와", "하은과" */
function nameWithWa(name: string) {
  const last = name.charCodeAt(name.length - 1);
  const hasBatchim =
    last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 > 0;
  return `${name}${hasBatchim ? "과" : "와"}`;
}

/**
 * 홈의 아래 섹션들(추천 · 주제 둘러보기).
 *
 * 추천 캐시가 없을 때는 LLM 생성 때문에 몇 초 걸릴 수 있어, 페이지가 아니라
 * 이 컴포넌트 단위로 Suspense 에 얹는다. 캐시가 있으면 DB 읽기 한 번이라 즉시다.
 * 주제 섹션의 이야기 목록은 타일을 골랐을 때만 아래에 뜬다(TopicBrowse).
 */
export async function PersonalizedSections({
  child,
  stories,
  sessions,
}: {
  child: SelectedChild;
  stories: Story[];
  sessions: ChildStorySession[];
}) {
  const recommendations = await getRecommendations(child, stories, sessions);

  return (
    <>
      {recommendations.length > 0 && (
        <section className="flex flex-col items-center gap-[30px] px-12">
          <div className="flex w-full flex-col gap-2 text-center">
            <h2 className="text-[26px] leading-[1.6] font-extrabold text-ink-strong">
              {child.name}에게 추천하는 이야기
            </h2>
            <p className="text-[20px] font-bold text-[#8a8a8a]">
              {nameWithWa(child.name)} 함께 생각하고 말하는 이야기, 지금
              시작해요.
            </p>
          </div>

          {/* 408 카드 석 장 + 사이 23px = 1270 으로 폭에 꼭 맞는다 */}
          <div className="flex w-full justify-center gap-[23px]">
            {recommendations.map(({ story, reason }, index) => (
              <RecommendedStoryCard
                key={story.id}
                story={story}
                reason={reason}
                badge={RECOMMEND_BADGE_ORDER[index] ?? "match"}
                childName={child.name}
              />
            ))}
          </div>

          {/* 시안의 캐러셀 점 — 추천이 한 페이지뿐이라 장식으로만 둔다 */}
          <div aria-hidden className="flex items-center gap-[9px] pt-0.5">
            <span className="h-[11px] w-7 rounded-full bg-primary-strong" />
            <span className="size-[11px] rounded-full bg-[#d5e6ef]" />
            <span className="size-[11px] rounded-full bg-[#d5e6ef]" />
          </div>
        </section>
      )}

      <section className="flex flex-col gap-4 px-12">
        <div className="flex items-center justify-between font-gothic">
          <div className="flex items-center gap-2.5">
            <h2 className="text-[24px] font-extrabold text-ink-strong">
              어떤 이야기가 궁금해?
            </h2>
            <p className="text-[16px] font-extrabold text-ink-faint">
              주제를 골라서 둘러봐요
            </p>
          </div>
          <Link
            href="/stories"
            className="flex items-center gap-1.5 rounded-full border border-primary-line bg-story-bg py-3.5 pr-4 pl-5 text-[16px] font-extrabold text-primary-strong"
          >
            이야기 모두 보기
            <MaterialSymbol name="chevron_right" size={16} />
          </Link>
        </div>

        {/* 첫 주제(다름)를 펼쳐 둔다 — 타일만 보이면 아래가 비어 「아무것도 없는 화면」으로
            읽힌다. 다시 누르면 접히고, 다른 타일을 누르면 그쪽으로 바뀐다. */}
        <TopicBrowse stories={stories} initialTopic={TOPIC_TILES[0].topic} />
      </section>
    </>
  );
}

/** 추천을 처음 만드는 동안(콜드스타트)만 보이는 자리 표시. */
export function PersonalizedSectionsSkeleton() {
  return (
    <section className="flex flex-col items-center gap-[30px] px-12">
      <div className="flex w-full flex-col items-center gap-2">
        <div className="h-[42px] w-[340px] animate-pulse rounded-lg bg-chip" />
        <div className="h-[24px] w-[420px] animate-pulse rounded-lg bg-chip" />
      </div>
      <div className="flex w-full justify-center gap-[23px]">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-[495px] w-[408px] animate-pulse rounded-[20px] bg-chip"
          />
        ))}
      </div>
    </section>
  );
}
