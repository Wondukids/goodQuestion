import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Story, StoryIntro, StoryStatus } from "@/lib/story-types";

export type { ContinueStory, Story, StoryIntro } from "@/lib/story-types";

/* RLS(stories_select_visible)가 draft·published 만 통과시킨다(archived 숨김).
   draft 는 목록에 "제작 중" 으로 보여 주고, 입장은 published 만 허용한다. */
const STORY_COLUMNS =
  "slug, status, title, summary, difficulty, topics, estimated_minutes, thumbnail_url, hero_url, intro, created_at";

type StoryRow = {
  slug: string;
  status: StoryStatus;
  title: string;
  summary: string;
  difficulty: string;
  topics: string[] | null;
  estimated_minutes: number | null;
  thumbnail_url: string | null;
  hero_url: string | null;
  intro: StoryIntro | null;
  created_at: string;
};

function toStory(row: StoryRow): Story {
  return {
    id: row.slug,
    status: row.status,
    title: row.title,
    summary: row.summary,
    topic: row.topics?.[0] ?? "",
    minutes: row.estimated_minutes,
    difficulty: row.difficulty,
    thumbnail: row.thumbnail_url ?? "",
    hero: row.hero_url,
    intro: row.intro,
    createdAt: row.created_at,
  };
}

export async function listStories(): Promise<Story[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stories")
    .select(STORY_COLUMNS)
    // published('p')가 draft('d')보다 뒤 글자라 내림차순이면 공개작이 앞에 온다.
    .order("status", { ascending: false })
    .order("title");

  if (error) throw new Error(`이야기 목록 조회 실패: ${error.message}`);
  return ((data ?? []) as StoryRow[]).map(toStory);
}

/** 없는 slug 면 null — 페이지가 404 로 떨어뜨린다. */
export async function getStory(slug: string): Promise<Story | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("stories")
    .select(STORY_COLUMNS)
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw new Error(`이야기 조회 실패: ${error.message}`);
  return data ? toStory(data as StoryRow) : null;
}
