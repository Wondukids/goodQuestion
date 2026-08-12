import type { NextConfig } from "next";

/* 이야기 이미지(썸네일·히어로)는 Supabase Storage 의 story-assets public 버킷에서 온다.
   next.config 평가 전에 .env.local 이 로드되므로 process.env 를 바로 쓸 수 있다. */
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

const nextConfig: NextConfig = {
  images: {
    remotePatterns: supabaseUrl
      ? [new URL(`${supabaseUrl}/storage/v1/object/public/story-assets/**`)]
      : [],
  },
};

export default nextConfig;
