import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/* 지금 고른 아이는 URL 이 아니라 쿠키에 둔다. 화면마다 들고 다니지 않아도 되고,
   httpOnly 라 브라우저 쪽에서 다른 아이 id 로 바꿔치기할 수 없다.
   그래도 쿠키 값은 신뢰하지 않고 매번 DB 에서 소유 여부를 다시 확인한다. */
const COOKIE = "selected_child";
const MAX_AGE = 60 * 60 * 24 * 30; // 30일

export type SelectedChild = {
  id: string;
  name: string;
  birth_year: number;
  character_id: string;
  /** 마이페이지의 "함께한 지 N일차" 가 읽는다 */
  created_at: string;
};

export async function setSelectedChild(childId: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE, childId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSelectedChild() {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE);
}

/** 고른 아이가 없거나, 지워졌거나, 내 아이가 아니면 null. */
export async function getSelectedChild(): Promise<SelectedChild | null> {
  const cookieStore = await cookies();
  const childId = cookieStore.get(COOKIE)?.value;
  if (!childId) return null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  /* RLS(children_own)가 이미 본인 것만 내주지만, 정책이 바뀌어도 새지 않도록 조건을 명시한다. */
  const { data } = await supabase
    .from("children")
    .select("id, name, birth_year, character_id, created_at")
    .eq("id", childId)
    .eq("parent_id", user.id)
    .maybeSingle();

  return data;
}

/** 아이가 정해져 있어야만 열리는 화면용 — 없으면 선택 화면으로 보낸다. */
export async function requireSelectedChild(): Promise<SelectedChild> {
  const child = await getSelectedChild();
  if (!child) redirect("/children");
  return child;
}
