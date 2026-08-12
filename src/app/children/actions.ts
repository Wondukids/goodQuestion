"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SELECTED_CHILD_COOKIE } from "@/lib/selected-child";
import { createClient } from "@/lib/supabase/server";

/**
 * 아이 카드 클릭 = 이 아이로 플레이하겠다는 선택.
 * 쿠키에 담아 두면 재생 화면(대화 씬)이 아이 이름을 부르는 데 쓴다.
 */
export async function selectChild(childId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  /* 내 아이가 맞는지 확인 — RLS 가 막아 주지만 children 페이지처럼 조건을 명시한다 */
  const { data: child } = await supabase
    .from("children")
    .select("id")
    .eq("id", childId)
    .eq("parent_id", user.id)
    .single();

  if (child) {
    (await cookies()).set(SELECTED_CHILD_COOKIE, child.id, {
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  redirect("/home");
}
