"use client";

import { useActionState, useId, useState } from "react";
import { createChild } from "@/app/onboarding/child/actions";
import { AgeStepper } from "@/components/onboarding/age-stepper";
import { CharacterPicker } from "@/components/onboarding/character-picker";
import { CHARACTERS } from "@/lib/characters";

export function ChildRegisterForm() {
  const nameId = useId();
  const [characterId, setCharacterId] = useState(CHARACTERS[0].id);
  const [name, setName] = useState("");
  const [age, setAge] = useState(7);
  const [state, formAction, pending] = useActionState(createChild, null);

  return (
    <form action={formAction} className="flex w-full flex-col items-center">
      {/* 캐릭터와 나이는 버튼으로 고르는 값이라 폼에 실리도록 hidden 으로 함께 보낸다. */}
      <input type="hidden" name="characterId" value={characterId} />
      <input type="hidden" name="age" value={age} />

      <div className="flex w-full items-center justify-center gap-[58px]">
        <CharacterPicker value={characterId} onChange={setCharacterId} />

        <div className="flex flex-col items-center justify-center gap-7">
          <div className="flex w-[520px] max-w-full flex-col gap-9 rounded-[28px] border-2 border-primary-soft bg-surface p-11 drop-shadow-[0_8px_7px_rgb(74_62_49_/_0.1)]">
            <div className="flex w-full flex-col gap-3">
              <label
                htmlFor={nameId}
                className="text-[16px] font-extrabold text-ink"
              >
                아이 이름
              </label>
              <div className="flex w-full items-center rounded-2xl border-2 border-ink/20 bg-surface px-[18px] py-3.5">
                <input
                  id={nameId}
                  name="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="아이 이름을 입력해 주세요"
                  className="min-w-0 flex-1 bg-transparent text-[17px] text-ink outline-none placeholder:text-ink-soft"
                />
              </div>
            </div>

            <div className="flex w-full flex-col gap-3">
              <span className="text-[16px] font-extrabold text-ink">
                아이 나이
              </span>
              <AgeStepper value={age} onChange={setAge} />
            </div>
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
