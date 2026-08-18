"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TextField } from "@/components/ui/text-field";
import { createClient } from "@/lib/supabase/client";

/* 이메일·비밀번호 로그인 — 시안 0:1079~0:1082 (라벨 칸 두 개 + 로그인 버튼).
   구글은 동의 화면으로 나갔다 `/auth/callback` 으로 돌아오지만, 이쪽은 브라우저에서
   바로 세션 쿠키가 서므로 콜백 라우트를 타지 않는다. 그래서 이동은 여기서 직접 한다.

   ⚠️ 세션은 클라이언트 쿠키에 서고 서버 컴포넌트는 요청 시점에 그 쿠키를 읽는다.
      `router.refresh()` 로 서버 쪽을 한 번 다시 그려야 `/children` 이 로그인된 상태로 뜬다. */
export function EmailLogin({ next = "/children" }: { next?: string }) {
  const router = useRouter();

  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");

    /* 값은 TextField 가 제 안에서 들고 있으므로 폼에서 한 번에 꺼낸다. */
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setPending(false);
      /* Supabase 는 아이디 오류와 비밀번호 오류를 같은 문구로 낸다 — 계정 존재 여부를 흘리지 않으려는 것이다. */
      setMessage(
        error.message === "Invalid login credentials"
          ? "이메일 또는 비밀번호가 맞지 않아요."
          : error.message,
      );
      return;
    }

    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={signIn} className="flex w-full flex-col gap-10">
      <div className="flex w-full flex-col gap-[30px]">
        <TextField
          label="이메일"
          name="email"
          type="email"
          placeholder="이메일을 입력해주세요"
          autoComplete="username"
          clearable
          required
        />

        <TextField
          label="비밀번호"
          name="password"
          type="password"
          placeholder="비밀번호를 입력해주세요"
          autoComplete="current-password"
          clearable
          required
        />
      </div>

      <div className="flex w-full flex-col gap-3">
        <button
          type="submit"
          disabled={pending}
          className="flex h-[61px] w-full cursor-pointer items-center justify-center rounded-lg bg-primary-strong px-6 text-[22px] leading-[1.5] font-extrabold text-[#fcfcfc] transition disabled:opacity-60"
        >
          {pending ? "로그인 중…" : "로그인"}
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
    </form>
  );
}
