"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/* 이메일·비밀번호 로그인.
   구글은 동의 화면으로 나갔다 `/auth/callback` 으로 돌아오지만, 이쪽은 브라우저에서
   바로 세션 쿠키가 서므로 콜백 라우트를 타지 않는다. 그래서 이동은 여기서 직접 한다.

   ⚠️ 세션은 클라이언트 쿠키에 서고 서버 컴포넌트는 요청 시점에 그 쿠키를 읽는다.
      `router.refresh()` 로 서버 쪽을 한 번 다시 그려야 `/children` 이 로그인된 상태로 뜬다. */
export function EmailLogin({ next = "/children" }: { next?: string }) {
  const router = useRouter();
  const emailId = useId();
  const passwordId = useId();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function signIn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage("");

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
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
    <form onSubmit={signIn} className="flex w-[400px] max-w-full flex-col gap-4">
      <div className="flex w-full flex-col gap-2">
        <label htmlFor={emailId} className="text-[15px] font-extrabold text-ink">
          이메일
        </label>
        <div className="flex w-full items-center rounded-2xl border-2 border-ink/20 bg-surface px-[18px] py-3.5">
          <input
            id={emailId}
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="이메일을 입력해 주세요"
            className="min-w-0 flex-1 bg-transparent text-[17px] text-ink outline-none placeholder:text-ink-soft"
          />
        </div>
      </div>

      <div className="flex w-full flex-col gap-2">
        <label
          htmlFor={passwordId}
          className="text-[15px] font-extrabold text-ink"
        >
          비밀번호
        </label>
        <div className="flex w-full items-center rounded-2xl border-2 border-ink/20 bg-surface px-[18px] py-3.5">
          <input
            id={passwordId}
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="비밀번호를 입력해 주세요"
            className="min-w-0 flex-1 bg-transparent text-[17px] text-ink outline-none placeholder:text-ink-soft"
          />
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="mt-2 flex w-full items-center justify-center rounded-2xl bg-primary px-8 py-4 text-[20px] font-extrabold text-white transition disabled:opacity-60"
      >
        {pending ? "로그인 중…" : "이메일로 로그인"}
      </button>

      {message && (
        <p
          role="alert"
          className="text-center text-[14px] font-bold text-[#d94b4b]"
        >
          {message}
        </p>
      )}
    </form>
  );
}
