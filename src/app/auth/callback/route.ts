import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/* 구글 OAuth 가 되돌아오는 착지점.
   PKCE code 를 세션 쿠키로 바꾼 뒤 next 로 보낸다. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);

  const fail = (message: string) =>
    NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(message)}`,
    );

  /* 사용자가 구글 동의 화면에서 취소하면 code 대신 error 가 온다. */
  const providerError =
    searchParams.get("error_description") ?? searchParams.get("error");
  if (providerError) return fail(providerError);

  const code = searchParams.get("code");
  if (!code) return fail("인증 코드가 전달되지 않았습니다.");

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return fail(error.message);

  /* 오픈 리다이렉트 방지 — 같은 오리진의 절대경로만 허용한다. */
  const next = searchParams.get("next");
  const to = next?.startsWith("/") && !next.startsWith("//") ? next : "/children";

  return NextResponse.redirect(`${origin}${to}`);
}
