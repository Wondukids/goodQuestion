"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isCharacterId } from "@/lib/characters";
import { createClient } from "@/lib/supabase/server";

/* AgeStepper 와 같은 범위. 폼을 거치지 않은 POST 도 서버 액션을 직접 호출할 수 있으므로
   화면에서 막았더라도 여기서 다시 검사한다. */
const MIN_AGE = 4;
const MAX_AGE = 13;

export type ChildFormState = { error: string } | null;

export async function createChild(
  _previous: ChildFormState,
  formData: FormData,
): Promise<ChildFormState> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const name = String(formData.get("name") ?? "").trim();
  const age = Number(formData.get("age"));
  const characterId = String(formData.get("characterId") ?? "");

  if (!name) return { error: "아이 이름을 입력해 주세요." };
  if (name.length > 100) return { error: "이름은 100자까지 넣을 수 있어요." };
  if (!Number.isInteger(age) || age < MIN_AGE || age > MAX_AGE) {
    return { error: `나이는 ${MIN_AGE}세부터 ${MAX_AGE}세까지 등록할 수 있어요.` };
  }
  if (!isCharacterId(characterId)) return { error: "캐릭터를 골라 주세요." };

  const { error } = await supabase.from("children").insert({
    parent_id: user.id,
    name,
    /* 아이 선택 화면에서 다시 나이로 되돌리므로 같은 기준(연 나이)을 쓴다. */
    birth_year: new Date().getFullYear() - age,
    character_id: characterId,
  });

  if (error) return { error: `아이를 등록하지 못했어요. ${error.message}` };

  revalidatePath("/children");
  redirect("/children");
}
