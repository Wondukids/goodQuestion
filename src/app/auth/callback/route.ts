import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/* 구글에서 돌아온 사람을 되돌려보낼 "우리 집 주소".
   request.url 에서 뽑으면 안 된다 — 리버스 프록시 뒤에서 `next start` 로 돌리면
   request.url 의 오리진이 서버가 실제로 듣는 주소(http://localhost:3300)로 나온다(실측).
   그대로 쓰면 로그인을 마친 사람이 https://localhost:3300/children 으로 튕겨
   아무 데도 도착하지 못한다. 반면 headers() 는 프록시가 붙여 준 x-forwarded-host 를
   그대로 들고 있어 공개 주소가 나온다. 앱 포트는 바깥에서 직접 닿지 않고 프록시만
   통과하므로 이 헤더는 믿을 수 있다. */
async function requestOrigin(request: Request): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return new URL(request.url).origin;

  const proto =
    h.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return `${proto}://${host}`;
}

/* 구글 OAuth 가 되돌아오는 착지점.
   PKCE code 를 세션 쿠키로 바꾼 뒤 next 로 보낸다. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = await requestOrigin(request);

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
