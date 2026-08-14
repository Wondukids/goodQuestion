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

/* 축소는 브라우저(width=1366) 가 아니라 CSS 캔버스가 맡는다 — globals.css 의
   .canvas 참고. 뷰포트를 1366 으로 고정하면 가로만 맞고 세로는 화면 비율에 딸려
   가서, 4:3 이 아닌 11인치 아이패드에서 시안 아래쪽이 잘렸다.
   여기서는 화면을 있는 그대로 받아 두고(device-width) 배율 계산은 캔버스에 넘긴다. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  /* 아이 손에 들어가는 화면이라 실수로 확대되지 않게 막는다. */
  maximumScale: 1,
  userScalable: false,
};

/* 캔버스 배율 = min(가로비, 세로비). 화면 전체를 채우되 어느 쪽도 잘리지 않는 값이다.
   하이드레이션을 기다리면 첫 프레임이 100% 로 그려졌다가 튀므로, body 첫 줄에서
   동기로 실행해 --canvas-scale 을 먼저 채운다.
   next/script 의 beforeInteractive 는 쓰지 않는다 — App Router 에서 <html> 직계
   자식으로 주입돼 "In HTML, <script> cannot be a child of <html>" 이 뜬다. */
const CANVAS_SCALE_SCRIPT = `(function(){
  var el = document.documentElement;
  function fit(){
    el.style.setProperty("--canvas-scale", String(Math.min(innerWidth / 1366, innerHeight / 1024)));
  }
  fit();
  addEventListener("resize", fit);
  addEventListener("orientationchange", fit);
})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${nanumGothic.variable} ${jua.variable} h-full antialiased`}
      /* 위 스크립트가 하이드레이션 전에 <html> 의 style 에 --canvas-scale 을 심는다.
         서버 HTML 에는 없는 속성이라 이걸 붙이지 않으면 불일치로 경고가 뜬다. */
      suppressHydrationWarning
    >
      {/* 배경색은 body 에 둔다 — 홈의 고정 하늘 배경(-z-10)이 위 레이어 배경에 가려지지 않도록. */}
      <body className="min-h-full bg-app-bg">
        <script dangerouslySetInnerHTML={{ __html: CANVAS_SCALE_SCRIPT }} />
        <div className="canvas-stage">
          <div className="canvas">
            <div className="canvas-scroll">{children}</div>
          </div>
        </div>
      </body>
    </html>
  );
}
