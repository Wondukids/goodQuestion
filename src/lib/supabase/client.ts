import { createBrowserClient } from "@supabase/ssr";

/* 브라우저(클라이언트 컴포넌트)용 Supabase 클라이언트.
   세션과 PKCE code_verifier 를 쿠키에 저장하므로 서버에서도 같은 세션을 읽는다. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
