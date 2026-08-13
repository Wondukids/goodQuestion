import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/* Next 16 부터 middleware 는 proxy 로 이름이 바뀌었다(docs/01-app/01-getting-started/16-proxy.md).
   서버 컴포넌트는 응답 헤더가 이미 열려 쿠키를 쓸 수 없으므로, 만료된 액세스 토큰의
   갱신분을 응답에 실어 보내는 건 여기가 유일한 지점이다. */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet, headers) => {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
          /* 세션 쿠키가 실린 응답이 CDN 에 캐시되면 남의 세션이 그대로 나간다.
             @supabase/ssr 이 넘겨주는 no-store 계열 헤더를 그대로 붙인다. */
          for (const [key, value] of Object.entries(headers)) {
            response.headers.set(key, value);
          }
        },
      },
    },
  );

  /* 응답이 확정되기 전에 한 번 호출해야 갱신된 토큰이 위 setAll 로 흘러 들어간다. */
  await supabase.auth.getUser();

  return response;
}

export const config = {
  /* 정적 자산까지 통과시키면 로그인 세션 갱신 때문에 이미지·CSS 가 느려진다.
     폰트 확장자를 빠뜨리면 public/fonts 의 파일마다 위 getUser() 왕복이 붙는다
     (측정: otf 33~69ms vs 제외된 png 1.8ms). 나중에 woff2 로 되돌리거나 웨이트를
     추가해도 다시 새지 않도록 폰트 확장자를 모두 적어 둔다. */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|otf|ttf|woff|woff2|mp4|wav|mp3)$).*)",
  ],
};
