"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { birthYearRange, MAX_AGE, MIN_AGE } from "@/lib/birth-year";
import { isCharacterId } from "@/lib/characters";
import { CONSENT_VERSION } from "@/lib/consent";
import { createClient } from "@/lib/supabase/server";

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
  const birthYear = Number(formData.get("birthYear"));
  const characterId = String(formData.get("characterId") ?? "");
  const consentVersion = String(formData.get("consentVersion") ?? "");

  /* 폼을 거치지 않은 POST 도 서버 액션을 직접 호출할 수 있으므로
     화면에서 막았더라도 여기서 다시 검사한다. */
  const { min, max } = birthYearRange();

  if (!name) return { error: "아이 이름을 입력해 주세요." };
  if (name.length > 100) return { error: "이름은 100자까지 넣을 수 있어요." };
  if (!Number.isInteger(birthYear) || birthYear < min || birthYear > max) {
    return {
      error: `${MIN_AGE}세부터 ${MAX_AGE}세까지(${min}~${max}년생) 등록할 수 있어요.`,
    };
  }
  if (!isCharacterId(characterId)) return { error: "캐릭터를 골라 주세요." };
  if (consentVersion !== CONSENT_VERSION) {
    return { error: "개인정보 처리동의를 다시 확인해 주세요." };
  }

  /* 아이 행과 동의 행이 한쪽만 남지 않도록 한 트랜잭션(RPC)으로 넣는다. */
  const { error } = await supabase.rpc("create_child_with_consent", {
    p_name: name,
    p_birth_year: birthYear,
    p_character_id: characterId,
    p_consent_version: consentVersion,
  });

  if (error) return { error: `아이를 등록하지 못했어요. ${error.message}` };

  revalidatePath("/children");
  redirect("/children");
}
