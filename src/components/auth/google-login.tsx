"use client";

import Image from "next/image";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type GoogleLoginProps = {
  /** 콜백 라우트가 ?error= 로 되돌려준 실패 사유 */
  initialError?: string;
};

/* 시안 0:1090 — 이메일 로그인 아래 "또는" 다음에 서는 원형 구글 버튼.
   계정은 구글 첫 로그인에서 함께 만들어지므로 가입 경로도 이 하나다. */
export function GoogleLogin({ initialError }: GoogleLoginProps) {
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
    <div className="flex w-full flex-col items-center gap-4">
      <button
        type="button"
        aria-label="구글로 로그인"
        onClick={signInWithGoogle}
        disabled={pending}
        className="flex size-[60px] cursor-pointer items-center justify-center rounded-full border border-[#d6d6d6] bg-story-bg transition hover:bg-surface-muted disabled:opacity-60"
      >
        {/* 아이콘 원본이 정사각형이 아니다(23.65×24.49) — 24×25 로 두어야 G 가 찌그러지지 않는다.
            CSS 로 다시 크기를 주면 next/image 가 가로세로 비율 경고를 낸다. */}
        <Image
          src="/figma/icons/google.svg"
          alt=""
          width={24}
          height={25}
          className="shrink-0"
        />
      </button>

      {message && (
        <p
          role="alert"
          className="text-center text-[14px] font-bold text-[#d94b4b]"
        >
          {message}
        </p>
      )}
    </div>
  );
}
