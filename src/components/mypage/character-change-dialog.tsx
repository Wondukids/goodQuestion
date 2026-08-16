"use client";

import { useActionState, useEffect, useState } from "react";
import { updateCharacter } from "@/app/(main)/mypage/actions";
import { CharacterPicker } from "@/components/onboarding/character-picker";

/** 프로필 카드 오른쪽 위의 "캐릭터 변경" 알약(시안 61:1365) — 누르면 온보딩의 캐릭터 고르기가 모달로 뜬다. */
export function CharacterChangeButton({
  characterId,
}: {
  characterId: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex cursor-pointer items-center rounded-full bg-story-bg/80 p-2.5 text-[12px] font-bold text-ink-strong"
      >
        캐릭터 변경
      </button>

      {open && (
        <CharacterChangeDialog
          characterId={characterId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function CharacterChangeDialog({
  characterId,
  onClose,
}: {
  characterId: string;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState(characterId);
  const [state, formAction, pending] = useActionState(updateCharacter, null);
  const changed = picked !== characterId;

  /* 저장되면 닫는다 — revalidate 로 프로필 카드·상단 아바타가 새 캐릭터로 다시 그려진다. */
  useEffect(() => {
    if (state && "saved" in state) onClose();
  }, [state, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="캐릭터 바꾸기"
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <form
        action={formAction}
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-[calc(100%-48px)] flex-col gap-5 overflow-y-auto rounded-[24px] bg-white px-9 py-8 shadow-[0_12px_32px_rgb(0_0_0_/_0.18)]"
      >
        <input type="hidden" name="characterId" value={picked} />

        <h2 className="text-[24px] font-extrabold text-ink-strong">
          어떤 친구랑 이야기할까요?
        </h2>

        <CharacterPicker value={picked} onChange={setPicked} />

        {state && "error" in state && (
          <p role="alert" className="text-[16px] font-bold text-[#d94b4b]">
            {state.error}
          </p>
        )}

        <div className="flex items-center justify-end gap-4">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer px-2 text-[17px] font-extrabold text-[#707070]"
          >
            다음에 할래요
          </button>
          <button
            type="submit"
            disabled={!changed || pending}
            className="cursor-pointer rounded-full bg-primary-strong px-7 py-3.5 text-[18px] font-extrabold text-white disabled:opacity-60"
          >
            {pending ? "변신하는 중…" : "이걸로 바꿀래요!"}
          </button>
        </div>
      </form>
    </div>
  );
}
