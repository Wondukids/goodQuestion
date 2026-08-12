"use client";

import { useActionState, useState } from "react";
import { updateCharacter } from "@/app/(main)/mypage/actions";
import { CharacterAvatar } from "@/components/child/character-avatar";
import { CharacterPicker } from "@/components/onboarding/character-picker";

/** 온보딩의 캐릭터 그리드를 재사용하고, 오른쪽 미리보기 카드에서 저장한다. */
export function CharacterChangeForm({
  name,
  characterId,
}: {
  name: string;
  characterId: string;
}) {
  const [picked, setPicked] = useState(characterId);
  const [state, formAction, pending] = useActionState(updateCharacter, null);

  const changed = picked !== characterId;

  const label = pending
    ? "변신하는 중…"
    : changed
      ? "이 모습으로 변신!"
      : state && "saved" in state
        ? "변신 완료!"
        : "지금 내 모습이에요";

  return (
    <form
      action={formAction}
      className="flex flex-wrap items-start gap-x-[58px] gap-y-10 px-[60px]"
    >
      <input type="hidden" name="characterId" value={picked} />

      <CharacterPicker value={picked} onChange={setPicked} />

      <div className="flex w-[295px] flex-col items-center gap-6 rounded-[28px] border-2 border-primary-soft bg-surface px-8 pt-9 pb-8 shadow-card">
        <CharacterAvatar characterId={picked} size={185} />
        <span className="text-[26px] font-extrabold text-ink">{name}</span>

        <button
          type="submit"
          disabled={!changed || pending}
          className="flex w-full items-center justify-center rounded-full bg-primary px-6 py-4 text-[20px] font-extrabold text-white disabled:opacity-60"
        >
          {label}
        </button>

        {state && "error" in state && (
          <p
            role="alert"
            className="text-center text-[16px] font-bold text-[#d94b4b]"
          >
            {state.error}
          </p>
        )}
      </div>
    </form>
  );
}
