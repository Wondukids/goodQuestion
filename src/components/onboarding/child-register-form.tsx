"use client";

import { useActionState, useId, useState } from "react";
import { createChild } from "@/app/onboarding/child/actions";
import { BirthYearStepper } from "@/components/onboarding/birth-year-stepper";
import { CharacterPicker } from "@/components/onboarding/character-picker";
import { ConsentCard } from "@/components/onboarding/consent-card";
import { birthYearRange } from "@/lib/birth-year";
import { CHARACTERS } from "@/lib/characters";
import { CONSENT_VERSION } from "@/lib/consent";

/* 범위 한가운데(만 7세 무렵)에서 시작한다. */
const DEFAULT_BIRTH_YEAR = birthYearRange().max - 3;

export function ChildRegisterForm() {
  const nameId = useId();
  const [characterId, setCharacterId] = useState(CHARACTERS[0].id);
  const [name, setName] = useState("");
  const [birthYear, setBirthYear] = useState(DEFAULT_BIRTH_YEAR);
  const [agreed, setAgreed] = useState(false);
  const [state, formAction, pending] = useActionState(createChild, null);

  /* 동의 → 아이 정보 입력 순서. 실제 저장은 마지막 "등록하기" 한 번에 함께 일어난다. */
  if (!agreed) return <ConsentCard onAgree={() => setAgreed(true)} />;

  return (
    <form action={formAction} className="flex w-full flex-col items-center">
      {/* 캐릭터와 출생연도는 버튼으로 고르는 값이라 폼에 실리도록 hidden 으로 함께 보낸다. */}
      <input type="hidden" name="characterId" value={characterId} />
      <input type="hidden" name="birthYear" value={birthYear} />
      <input type="hidden" name="consentVersion" value={CONSENT_VERSION} />

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
                아이 출생연도
              </span>
              <BirthYearStepper value={birthYear} onChange={setBirthYear} />
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
