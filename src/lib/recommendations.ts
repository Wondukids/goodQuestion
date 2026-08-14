import "server-only";

import type { SelectedChild } from "@/lib/selected-child";
import type { ChildStorySession } from "@/lib/story-sessions";
import type { Story } from "@/lib/story-types";
import { createClient } from "@/lib/supabase/server";

/**
 * 홈 "추천" 섹션의 데이터.
 *
 * LLM(Gemini)이 아이 프로필·플레이 이력·카탈로그 전체를 보고 3편을 고르고,
 * 결과는 child_recommendations 에 캐시한다. 홈은 캐시를 읽고, 캐시가 없거나
 * 낡았을 때만(새 세션이 생긴 뒤) 다시 생성한다.
 *
 * GEMINI_RECOMMEND_API_KEY(Google AI Studio 무료 발급)가 없으면 규칙 기반으로 고르고
 * 이유는 템플릿으로 만든다 — 화면은 똑같이 동작하고, 키를 넣는 순간 LLM 경로가 우선한다.
 */
export type Recommendation = {
  story: Story;
  /** 추천 이유 한 문장 — LLM 또는 규칙 템플릿이 만든다. */
  reason: string | null;
};

const RECOMMEND_COUNT = 3;

export async function getRecommendations(
  child: SelectedChild,
  stories: Story[],
  sessions: ChildStorySession[],
): Promise<Recommendation[]> {
  const storyBySlug = new Map(stories.map((story) => [story.id, story]));
  const playedSlugs = new Set(sessions.map((session) => session.slug));
  const candidates = stories.filter((story) => !playedSlugs.has(story.id));
  if (candidates.length === 0) return [];

  const supabase = await createClient();

  const cached = await readCache(supabase, child.id);
  if (cached && isFresh(cached, sessions, storyBySlug, playedSlugs)) {
    return cached.items.map(({ slug, reason }) => ({
      story: storyBySlug.get(slug)!,
      reason,
    }));
  }

  const generated = await generateWithGemini(
    child,
    candidates,
    sessions,
    storyBySlug,
  );
  if (!generated) {
    /* 생성 실패 시: 낡았어도 아직 쓸 수 있는 캐시(안 본 작품)가 있으면 그게 폴백보다 낫다. */
    const usable = cached?.items.filter(
      ({ slug }) => storyBySlug.has(slug) && !playedSlugs.has(slug),
    );
    if (usable && usable.length > 0) {
      return usable.map(({ slug, reason }) => ({
        story: storyBySlug.get(slug)!,
        reason,
      }));
    }
    return recommendByRules(child, candidates, sessions, storyBySlug);
  }

  await writeCache(supabase, child.id, generated);
  return generated.map(({ slug, reason }) => ({
    story: storyBySlug.get(slug)!,
    reason,
  }));
}

/* ── 캐시 ───────────────────────────────────────────────────────────── */

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;
type CachedItem = { slug: string; reason: string };
type Cache = { items: CachedItem[]; generatedAt: string };

async function readCache(
  supabase: SupabaseClient,
  childId: string,
): Promise<Cache | null> {
  const { data, error } = await supabase
    .from("child_recommendations")
    .select("reason, rank, generated_at, stories(slug)")
    .eq("child_id", childId)
    .order("rank");

  if (error || !data || data.length === 0) return null;

  const rows = data as unknown as {
    reason: string;
    generated_at: string;
    stories: { slug: string } | null;
  }[];
  const items = rows
    .filter((row) => row.stories?.slug)
    .map((row) => ({ slug: row.stories!.slug, reason: row.reason }));
  if (items.length === 0) return null;

  return { items, generatedAt: rows[0].generated_at };
}

/** 생성 이후 새 세션이 생겼거나(추천작을 이미 시작했거나) 목록에서 빠진 작품이 있으면 낡은 캐시다. */
function isFresh(
  cache: Cache,
  sessions: ChildStorySession[],
  storyBySlug: Map<string, Story>,
  playedSlugs: Set<string>,
): boolean {
  if (sessions.some((session) => session.startedAt > cache.generatedAt)) {
    return false;
  }
  return cache.items.every(
    ({ slug }) => storyBySlug.has(slug) && !playedSlugs.has(slug),
  );
}

async function writeCache(
  supabase: SupabaseClient,
  childId: string,
  items: CachedItem[],
) {
  /* slug → uuid. 캐시 저장은 실패해도 화면에 영향이 없으므로 에러를 흘려보낸다. */
  const { data } = await supabase
    .from("stories")
    .select("id, slug")
    .in(
      "slug",
      items.map((item) => item.slug),
    );
  const idBySlug = new Map(
    ((data ?? []) as { id: string; slug: string }[]).map((row) => [
      row.slug,
      row.id,
    ]),
  );

  const rows = items
    .filter((item) => idBySlug.has(item.slug))
    .map((item, index) => ({
      child_id: childId,
      story_id: idBySlug.get(item.slug)!,
      reason: item.reason,
      rank: index + 1,
    }));
  if (rows.length === 0) return;

  await supabase.from("child_recommendations").delete().eq("child_id", childId);
  await supabase.from("child_recommendations").insert(rows);
}

/* ── LLM 생성 (Gemini) ──────────────────────────────────────────────── */

/* Google AI Studio 무료 티어로 충분한 모델. SDK 없이 REST 로 바로 부른다.
   버전을 핀으로 박으면 신규 키에서 막히는 일이 있어(2.5-flash 404) 최신 별칭을 쓴다. */
const GEMINI_MODEL = "gemini-flash-latest";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const SYSTEM_PROMPT =
  "너는 4~13세 아이가 목소리로 참여하는 인터랙티브 동화 앱의 추천 큐레이터다. " +
  "아이 정보와 동화 목록을 읽고, 아이가 다음에 가장 즐겁고 의미 있게 들을 동화를 고른다.";

/** 실패(키 없음·타임아웃·이상한 slug)는 전부 null — 호출부가 규칙 기반으로 폴백한다. */
async function generateWithGemini(
  child: SelectedChild,
  candidates: Story[],
  sessions: ChildStorySession[],
  storyBySlug: Map<string, Story>,
): Promise<CachedItem[] | null> {
  /* TTS 가 쓰는 GEMINI_API_KEY 와 별개 키 — 이름이 겹쳐 용도별로 분리했다. */
  const apiKey = process.env.GEMINI_RECOMMEND_API_KEY;
  if (!apiKey) return null;

  const age = new Date().getFullYear() - child.birth_year;

  const historyLines = sessions.map((session) => {
    const story = storyBySlug.get(session.slug);
    const label = session.status === "in_progress" ? "진행중" : "완료";
    return story
      ? `- ${story.title} (주제: ${story.topic || "없음"}, ${label})`
      : `- ${session.slug} (${label})`;
  });
  const catalogLines = candidates.map(
    (story) =>
      `- ${story.id} | ${story.title} | 주제: ${story.topic || "없음"} | ${
        story.minutes ?? "?"
      }분 | ${story.summary}`,
  );

  const prompt = [
    "[아이]",
    `- 이름 ${child.name}, ${age}세`,
    "",
    "[지금까지 들은 이야기]",
    ...(historyLines.length > 0 ? historyLines : ["- 아직 없음 — 첫 추천이다"]),
    "",
    "[고를 수 있는 동화 목록]",
    ...catalogLines,
    "",
    "[할 일]",
    `위 목록에서 정확히 ${Math.min(RECOMMEND_COUNT, candidates.length)}개를 골라라. slug 는 목록의 값을 그대로 쓴다.`,
    "reason 은 아이와 보호자가 함께 읽는 추천 이유다:",
    "- 한 문장, 45자 이내, \"-어요/-해요\"로 끝나는 다정한 말투.",
    "- 들은 이야기가 있으면 그와 연결하고, 첫 추천이면 나이에 맞는 이유를 쓴다.",
    "",
    '출력은 다른 말 없이 JSON 하나만: {"recommendations":[{"slug":"...","reason":"..."}]}',
  ].join("\n");

  try {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) {
      console.error("Gemini 응답 오류:", res.status, await res.text());
      return null;
    }

    const data = (await res.json()) as {
      candidates?: {
        content?: { parts?: { text?: string; thought?: boolean }[] };
      }[];
    };
    /* 생각(thought) 파트가 섞여 올 수 있어 실제 답 파트만 고른다. */
    const text = data.candidates?.[0]?.content?.parts?.find(
      (part) => part.text && !part.thought,
    )?.text;
    if (!text) return null;
    const parsed = JSON.parse(text) as { recommendations: CachedItem[] };

    /* 목록에 실제로 있는 slug 만, 중복 없이 3개까지 */
    const candidateSlugs = new Set(candidates.map((story) => story.id));
    const seen = new Set<string>();
    const items = parsed.recommendations.filter(({ slug }) => {
      if (!candidateSlugs.has(slug) || seen.has(slug)) return false;
      seen.add(slug);
      return true;
    });
    return items.length > 0 ? items.slice(0, RECOMMEND_COUNT) : null;
  } catch (error) {
    console.error("추천 생성 실패 — 최신순으로 폴백:", error);
    return null;
  }
}

/* ── 규칙 기반 추천 (무료 모드 · LLM 실패 폴백) ─────────────────────── */

/** 주제별 추천 문구 — STORY_TOPICS 와 짝을 맞춘다. */
const TOPIC_REASONS: Record<string, string> = {
  자기이해: "나를 더 잘 알게 되는 이야기예요",
  장점발견: "숨어 있던 장점을 찾아주는 이야기예요",
  용기: "용기가 쑥쑥 자라나는 이야기예요",
  정직: "정직의 힘을 배우는 이야기예요",
  감정: "내 마음을 말로 표현해보는 이야기예요",
  우정: "친구 사이가 더 돈독해지는 이야기예요",
  "나눔·배려": "나누는 기쁨을 알려주는 이야기예요",
  가족: "가족의 소중함이 느껴지는 이야기예요",
  다름: "서로 다른 게 멋진 이유를 알려주는 이야기예요",
};

/**
 * API 키 없이도 추천 말풍선이 살아 있도록 규칙으로 고른다:
 * 1) 아이가 가장 많이 들은 주제 한 편 더 → 2) 아직 안 만난 주제 하나(다양성)
 * → 3) 나머지는 최신순. 이유는 주제 템플릿으로 채운다.
 */
function recommendByRules(
  child: SelectedChild,
  candidates: Story[],
  sessions: ChildStorySession[],
  storyBySlug: Map<string, Story>,
): Recommendation[] {
  const byNewest = [...candidates].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : -1,
  );

  const topicCount = new Map<string, number>();
  for (const session of sessions) {
    const topic = storyBySlug.get(session.slug)?.topic;
    if (topic) topicCount.set(topic, (topicCount.get(topic) ?? 0) + 1);
  }
  const favoriteTopic =
    [...topicCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const picks: Recommendation[] = [];
  const used = new Set<string>();
  const take = (story: Story, reason: string) => {
    picks.push({ story, reason });
    used.add(story.id);
  };

  if (favoriteTopic) {
    const same = byNewest.find(
      (story) => !used.has(story.id) && story.topic === favoriteTopic,
    );
    if (same) take(same, `좋아하는 ${favoriteTopic} 이야기를 한 편 더 준비했어요`);
  }

  if (topicCount.size > 0 && picks.length < RECOMMEND_COUNT) {
    const unseen = byNewest.find(
      (story) =>
        !used.has(story.id) && story.topic && !topicCount.has(story.topic),
    );
    if (unseen) take(unseen, `이번엔 ${unseen.topic} 이야기도 만나볼까요?`);
  }

  const age = new Date().getFullYear() - child.birth_year;
  for (const story of byNewest) {
    if (picks.length >= RECOMMEND_COUNT) break;
    if (used.has(story.id)) continue;
    take(
      story,
      TOPIC_REASONS[story.topic] ??
        `${age}살 ${child.name}에게 딱 맞는 이야기예요`,
    );
  }

  return picks;
}
