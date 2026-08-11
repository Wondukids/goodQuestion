import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/* 서버 컴포넌트·라우트 핸들러·서버 액션용 Supabase 클라이언트.
   요청마다 새로 만들어야 한다 — 모듈 스코프에 캐싱하면 세션이 섞인다. */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            /* 서버 컴포넌트에서는 스트리밍이 시작돼 쿠키를 쓸 수 없다.
               토큰 갱신은 proxy.ts 가 응답에 대신 반영하므로 무시해도 된다. */
          }
        },
      },
    },
  );
}
