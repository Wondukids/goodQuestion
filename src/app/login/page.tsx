import Link from "next/link";
import { SocialLogin } from "@/components/auth/social-login";
import { Logo } from "@/components/brand/logo";
import { TextField } from "@/components/ui/text-field";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  /* 구글 콜백이 실패하면 /login?error=... 로 되돌아온다. */
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;

  return (
    <main className="flex min-h-screen items-center justify-center bg-auth-bg px-6 py-12">
      <div className="flex w-[858px] max-w-full flex-col items-center gap-10">
        <Logo size="lg" />

        <section className="flex w-full flex-col items-center justify-center overflow-hidden rounded-[32px] bg-surface pt-[50px] pb-[60px] shadow-panel">
          <form className="flex w-[632px] max-w-full flex-col gap-6 px-6">
            <h1 className="text-center text-[30px] font-extrabold text-ink">
              보호자 로그인
            </h1>

            <div className="flex w-full flex-col gap-7">
              <TextField
                label="이메일"
                name="email"
                type="email"
                placeholder="parent@email.com"
                clearable
              />
              <TextField
                label="비밀번호"
                name="password"
                type="password"
                placeholder="••••••••"
                clearable
              />
            </div>

            <button
              type="submit"
              className="flex w-full items-center justify-center rounded-xl bg-primary px-10 py-4 text-[24px] font-extrabold text-white"
            >
              로그인
            </button>

            <p className="flex justify-center gap-2 py-2 text-[14px] font-bold">
              <span className="text-ink-soft">아직 계정이 없나요?</span>
              <Link href="/signup" className="text-ink">
                회원가입
              </Link>
            </p>

            <div className="flex w-full items-center gap-3 py-2">
              <span className="h-px min-w-0 flex-1 bg-divider" />
              <span className="font-gothic text-[13px] font-bold text-ink-muted">
                또는
              </span>
              <span className="h-px min-w-0 flex-1 bg-divider" />
            </div>

            <SocialLogin initialError={error} />
          </form>
        </section>
      </div>
    </main>
  );
}
