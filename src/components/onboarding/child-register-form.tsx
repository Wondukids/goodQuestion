"use client";

import { useActionState, useState } from "react";
import { createChild } from "@/app/onboarding/child/actions";
import { CharacterPicker } from "@/components/onboarding/character-picker";
import { ConsentCard } from "@/components/onboarding/consent-card";
import { TextField } from "@/components/ui/text-field";
import { CHARACTERS } from "@/lib/characters";
import { CONSENT_VERSION } from "@/lib/consent";

export function ChildRegisterForm() {
  const [characterId, setCharacterId] = useState(CHARACTERS[0].id);
  const [agreed, setAgreed] = useState(false);
  const [state, formAction, pending] = useActionState(createChild, null);

  /* 동의 → 아이 정보 입력 순서. 실제 저장은 마지막 "등록하기" 한 번에 함께 일어난다. */
  if (!agreed) return <ConsentCard onAgree={() => setAgreed(true)} />;

  return (
    <form action={formAction} className="flex w-full flex-col items-center">
      {/* 캐릭터는 버튼으로 고르는 값이라 폼에 실리도록 hidden 으로 함께 보낸다. */}
      <input type="hidden" name="characterId" value={characterId} />
      <input type="hidden" name="consentVersion" value={CONSENT_VERSION} />

      <div className="flex w-full items-center justify-center gap-[58px]">
        <CharacterPicker value={characterId} onChange={setCharacterId} />

        <div className="flex flex-col items-center justify-center gap-7">
          <div className="flex w-[520px] max-w-full flex-col gap-9 rounded-[28px] border-2 border-primary-soft bg-surface p-11 drop-shadow-[0_8px_7px_rgb(74_62_49_/_0.1)]">
            <TextField
              label="아이 이름"
              name="name"
              placeholder="아이 이름을 입력해 주세요"
              clearable
            />

            {/* 시안 79(56:1336)에서 +/− 스테퍼가 직접 적는 칸으로 바뀌었다.
                범위(4~13세)를 화면에서 막지 않으므로, 벗어난 해는 등록 버튼을 눌렀을 때
                서버 액션이 "4세부터 13세까지…" 로 되돌려준다. */}
            <TextField
              label="아이 출생연도"
              name="birthYear"
              placeholder="아이 출생연도를 입력해 주세요"
              numeric
              maxLength={4}
              clearable
            />
          </div>

          <button
            type="submit"
            disabled={pending}
            className="flex w-full items-center justify-center rounded-full bg-primary px-[120px] py-[22px] text-[26px] font-extrabold text-white disabled:opacity-60"
          >
            {pending ? "등록 중…" : "등록하기"}
          </button>

          {state?.error && (
            <p
              role="alert"
              className="text-center text-[16px] font-bold text-[#d94b4b]"
            >
              {state.error}
            </p>
          )}
        </div>
      </div>
    </form>
  );
}
