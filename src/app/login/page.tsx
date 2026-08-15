import { GoogleLogin } from "@/components/auth/google-login";
import { Logo } from "@/components/brand/logo";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  /* 구글 콜백이 실패하면 /login?error=... 로 되돌아온다. */
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : undefined;

  return (
    <main className="flex min-h-full items-center justify-center bg-auth-bg px-6 py-12">
      <div className="flex w-[858px] max-w-full flex-col items-center gap-10">
        <Logo size="lg" />

        <section className="flex w-full flex-col items-center justify-center overflow-hidden rounded-[32px] bg-surface px-6 pt-[70px] pb-[70px] shadow-panel">
          <div className="flex w-[632px] max-w-full flex-col items-center gap-10">
            <div className="flex flex-col items-center gap-3">
              <h1 className="text-center text-[30px] font-extrabold text-ink">
                보호자 로그인
              </h1>
              <p className="text-center text-[16px] font-bold text-ink-soft">
                구글 계정으로 간편하게 시작해요.
              </p>
            </div>

            <GoogleLogin initialError={error} />
          </div>
        </section>
      </div>
    </main>
  );
}
