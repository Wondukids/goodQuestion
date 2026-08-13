import { notFound } from "next/navigation";
import { getSelectedChild } from "@/lib/selected-child";
import { createClient } from "@/lib/supabase/server";
import { getPlayScreen } from "@/stories";

/**
 * 재생 화면으로 들어가는 문.
 *
 * 화면 자체는 이야기마다 다르므로 여기서 그리지 않는다. id 로 해당 이야기의
 * 컴포넌트를 찾아 넘기기만 하고, 실제 화면은 src/stories/<id>/ 안에 있다.
 * 이야기가 늘어도 이 파일은 그대로다.
 *
 * params.id 는 **이야기** id 다(예: "fart-bride"). 유저 id 가 아니다 —
 * 유저는 URL 이 아니라 세션 쿠키로만 식별한다.
 *
 * 상단·하단 네비가 없는 전체 화면이라 (main) 레이아웃 밖에 둔다.
 */

/** 선택된 아이(쿠키) 이름. 쿠키가 없거나 남의 아이면 첫 아이로, 그마저 없으면 null. */
async function getChildName(): Promise<string | null> {
  const selected = await getSelectedChild();
  if (selected) return selected.name;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("children")
    .select("name")
    .eq("parent_id", user.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .single();
  return data?.name ?? null;
}

export default async function StoryPlayPage(
  props: PageProps<"/stories/[id]/play">,
) {
  const { id } = await props.params;
  const PlayScreen = getPlayScreen(id);
  if (!PlayScreen) notFound();

  return <PlayScreen childName={await getChildName()} />;
}
