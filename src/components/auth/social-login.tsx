"use client";

import Image from "next/image";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/* 소셜 로그인 — 카카오·네이버는 원형 배경까지 포함된 SVG, 구글은 흰 원 안에 아이콘만.
   현재 Supabase 에 연결된 provider 는 구글뿐이다. */
const SOCIALS = [
  { id: "kakao", label: "카카오로 로그인", src: "/figma/icons/kakao.svg" },
  { id: "naver", label: "네이버로 로그인", src: "/figma/icons/naver.svg" },
] as const;

type SocialLoginProps = {
  /** 콜백 라우트가 ?error= 로 되돌려준 실패 사유 */
  initialError?: string;
};

export function SocialLogin({ initialError }: SocialLoginProps) {
  const [message, setMessage] = useState(initialError ?? "");
  const [pending, setPending] = useState(false);

  async function signInWithGoogle() {
    setPending(true);
    setMessage("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/children`,
      },
    });

    /* 성공하면 구글 동의 화면으로 이동하므로 아래는 실패했을 때만 실행된다. */
    if (error) {
      setPending(false);
      setMessage(error.message);
    }
  }

  return (
    <div className="flex w-full flex-col items-center gap-3">
      <div className="flex w-full items-center justify-center gap-[30px]">
        {SOCIALS.map((social) => (
          <button
            key={social.id}
            type="button"
            aria-label={social.label}
            onClick={() => setMessage("아직 준비 중이에요. 구글로 로그인해 주세요.")}
            className="size-[60px] shrink-0"
          >
            <Image
              src={social.src}
              alt=""
              width={60}
              height={60}
              className="size-full"
            />
          </button>
        ))}

        <button
          type="button"
          aria-label="구글로 로그인"
          onClick={signInWithGoogle}
          disabled={pending}
          className="flex size-[60px] shrink-0 items-center justify-center rounded-full border border-[#d9d2ca] bg-surface disabled:opacity-60"
        >
          <Image
            src="/figma/icons/google.svg"
            alt=""
            width={28}
            height={28}
            className="size-7"
          />
        </button>
      </div>

      {message && (
        <p role="alert" className="text-center text-[14px] font-bold text-[#d94b4b]">
          {message}
        </p>
      )}
    </div>
  );
}
