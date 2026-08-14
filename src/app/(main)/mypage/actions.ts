"use server";

import { revalidatePath } from "next/cache";
import { markAttendance } from "@/lib/attendance";
import { isCharacterId } from "@/lib/characters";
import { requireSelectedChild } from "@/lib/selected-child";
import { createClient } from "@/lib/supabase/server";

export type CharacterFormState = { error: string } | { saved: true } | null;

/** 지금 함께하는 아이의 프로필 캐릭터를 바꾼다. */
export async function updateCharacter(
  _previous: CharacterFormState,
  formData: FormData,
): Promise<CharacterFormState> {
  /* 쿠키의 아이가 정말 내 아이인지는 requireSelectedChild 가 DB 로 확인한다. */
  const child = await requireSelectedChild();

  /* 폼을 거치지 않은 POST 도 서버 액션을 직접 호출할 수 있으므로 여기서 다시 검사한다. */
  const characterId = String(formData.get("characterId") ?? "");
  if (!isCharacterId(characterId)) return { error: "캐릭터를 골라 주세요." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("children")
    .update({ character_id: characterId })
    .eq("id", child.id);

  if (error) return { error: `캐릭터를 바꾸지 못했어요. ${error.message}` };

  /* 상단 네비 아바타((main) 레이아웃)와 아이 선택 카드에도 새 캐릭터가 보이도록 한다. */
  revalidatePath("/", "layout");
  return { saved: true };
}

/** 마이페이지의 "출석하기" — 오늘 도장을 찍고 주간 도트를 다시 그린다. */
export async function checkInToday() {
  const child = await requireSelectedChild();
  await markAttendance(child.id);
  revalidatePath("/mypage");
}
