import { EmailLogin } from "@/components/auth/email-login";
import { GoogleLogin } from "@/components/auth/google-login";
import { SignUpLink } from "@/components/auth/sign-up-link";
import { Logo } from "@/components/brand/logo";

/* 시안 0:1072 — 로고 + 로그인 폼 카드. 이메일 로그인이 앞, 구글은 "또는" 아래 원형 버튼. */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  /* 구글 콜백이 실패하면 /login?error=... 로 되돌아온다. */
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;

  return (
    <main className="flex min-h-full items-center justify-center bg-primary-pale px-6 py-12">
      <div className="flex w-[858px] max-w-full flex-col items-center gap-10">
        <Logo size="lg" />

        <section className="flex w-full flex-col items-center justify-center overflow-hidden rounded-[32px] bg-story-bg px-6 pt-[50px] pb-10 shadow-panel">
          <div className="flex w-[632px] max-w-full flex-col gap-6">
            <h1 className="text-center text-[30px] leading-[1.5] font-extrabold text-ink-deep">
              보호자 로그인
            </h1>

            <EmailLogin />

            <SignUpLink />

            {/* 구분선 — 여기만 나눔고딕 13px 이다(시안 0:1088). */}
            <div className="flex w-full items-center gap-3 py-2">
              <span className="h-px flex-1 bg-surface-muted" />
              <span className="font-gothic text-[13px] font-bold text-[#575757]">
                또는
              </span>
              <span className="h-px flex-1 bg-surface-muted" />
            </div>

            <GoogleLogin initialError={error} />
          </div>
        </section>
      </div>
    </main>
  );
}
