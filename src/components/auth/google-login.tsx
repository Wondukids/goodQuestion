"use client";

import Image from "next/image";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type GoogleLoginProps = {
  /** 콜백 라우트가 ?error= 로 되돌려준 실패 사유 */
  initialError?: string;
};

/* Supabase 에 연결된 provider 는 구글뿐이라 로그인 수단도 구글 하나만 둔다. */
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
        onClick={signInWithGoogle}
        disabled={pending}
        className="flex w-[400px] max-w-full items-center justify-center gap-3 rounded-2xl border border-[#d9d2ca] bg-surface px-8 py-4 text-[20px] font-extrabold text-ink shadow-card transition hover:bg-[#f7f4f1] disabled:opacity-60"
      >
        <Image
          src="/figma/icons/google.svg"
          alt=""
          width={28}
          height={28}
          className="size-7 shrink-0"
        />
        {pending ? "구글로 이동 중…" : "구글로 로그인"}
      </button>

      {message && (
        <p role="alert" className="text-center text-[14px] font-bold text-[#d94b4b]">
          {message}
        </p>
      )}
    </div>
  );
}
