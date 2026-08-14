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

  /* 런타임에 **디스크에서 읽는** 자산 넷을 배포본에 싣는다 (이슈 #26 착지 ⑤).
     넷 다 `readFileSync`·`readdirSync` 에 **런타임에 계산한 경로**를 넘기므로
     import 그래프에 안 잡히고, 적어 두지 않으면 서버리스 번들 밖에 남는다.

       prompts/**                 프롬프트 작업대가 디렉터리를 훑는다 (lib/service/prompt-lab.ts)
                                  ⚠️ 다섯 개 전부다 — 둘만 실으면 목록이 조용히 줄어든다
       sql/002_seed_banggui.sql   시드 작업대가 원문을 읽어 값을 뽑는다 (lib/service/seed.ts)
       goldenset/**               골든셋·검수 화면 (lib/service/goldenset.ts · review.ts)
       단가표.toml                비용 화면이 매 요청에 읽는다 (lib/config.ts 단가표_읽기)

     ⚠️ 서버 프로세스 배포(`next start`)면 이 줄은 무해하다 — 파일이 어차피 거기 있다.
        서버리스면 필수다. **저쪽 배포 방식을 확인하지 못해** 양쪽 다 되는 쪽을 골랐다.
     ⚠️ 완전한 보증은 아니다. 파일이 실려도 런타임 `process.cwd()` 가 무엇인지는
        플랫폼에 달렸다. 배포본에서 /prompt-lab · /seed · /goldenset · 비용 칸을
        눈으로 봐야 확정된다. 안 뜨면 탐색 후보에 고정 자리를 하나 더하는 것이 뒤처리다. */
  outputFileTracingIncludes: {
    "/**": [
      "./prompts/**",
      "./sql/002_seed_banggui.sql",
      "./goldenset/**",
      "./단가표.toml",
    ],
  },
};

export default nextConfig;
