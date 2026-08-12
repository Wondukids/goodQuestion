"use server";

import { redirect } from "next/navigation";
import { setSelectedChild } from "@/lib/selected-child";
import { createClient } from "@/lib/supabase/server";

/** 아이 카드를 누르면 그 아이를 "지금 함께하는 아이" 로 저장하고 홈으로 보낸다. */
export async function selectChild(childId: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  /* 서버 액션은 폼을 거치지 않고도 호출되므로 남의 아이 id 가 오지 않는지 여기서 막는다. */
  const { data: child } = await supabase
    .from("children")
    .select("id")
    .eq("id", childId)
    .eq("parent_id", user.id)
    .maybeSingle();
  if (!child) redirect("/children");

  await setSelectedChild(child.id);
  redirect("/home");
}
