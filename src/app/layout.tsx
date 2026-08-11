import type { Metadata, Viewport } from "next";
import { Jua, Nanum_Gothic } from "next/font/google";
import "./globals.css";

/* preload 를 반드시 꺼 둔다.
   구글은 한글 폰트를 unicode-range 로 100 개 넘게 쪼개 서빙하는데, subsets 옵션은
   이름 있는 서브셋만 거르고 이 번호 서브셋들은 걸러 내지 못한다. preload 기본값(true)
   이면 next/font 가 그 전부에 <link rel="preload" as="font"> 를 찍어 버려서
   페이지마다 186 개 · 1.9MB 를 최우선순위로 받아 오느라 첫 렌더가 밀렸다.
   끄면 브라우저가 CSS 의 unicode-range 를 보고 실제로 쓰인 글자의 조각만 가져온다. */
const nanumGothic = Nanum_Gothic({
  variable: "--font-nanum-gothic",
  weight: ["400", "700", "800"],
  subsets: ["latin"],
  preload: false,
});

const jua = Jua({
  variable: "--font-jua",
  weight: "400",
  subsets: ["latin"],
  preload: false,
});

export const metadata: Metadata = {
  title: "굿퀘스천",
  description: "아이가 이야기 속 캐릭터와 대화하며 생각을 말로 표현하는 서비스",
};

/* 데모 기기는 iPad Air 3세대(1112×834). 시안 1366×1024 와 종횡비가 같은 4:3 이라
   (1.33333 vs 1.33398) 뷰포트를 1366 으로 고정하면 Safari 가 0.814배로 균일 축소한다.
   이때 CSS 높이가 834/0.814 = 1024 로 시안 캔버스와 그대로 맞고, 리플로우가 없으니
   홈 카드 그리드도 4열(48 + 295×4 + 30×3 + 48 = 1366)을 유지한다.
   device-width 로 두면 1112 에서 3열로 깨지고 오른쪽 131px 이 빈다. */
export const viewport: Viewport = {
  width: 1366,
  /* Next 기본값 initial-scale=1 을 반드시 지운다. 배율이 1 로 고정되면
     축소 대신 가로 스크롤이 생겨 위 계산이 통째로 무의미해진다.
     키를 명시해야 기본값을 덮어쓰고(resolve-metadata mergeViewport),
     undefined 면 태그에서 빠진다(metadata.js 의 != null 체크). */
  initialScale: undefined,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${nanumGothic.variable} ${jua.variable} h-full antialiased`}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
