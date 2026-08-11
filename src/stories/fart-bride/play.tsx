/**
 * 방귀 뀌는 며느리 — 재생 화면 (시안 8~17).
 *
 * **이 폴더(src/stories/fart-bride/)는 이 이야기 담당자 것이다.**
 * 파일을 몇 개로 쪼개든, 상태를 어떻게 들든, 안에서는 자유롭게 하면 된다.
 * 바깥과의 약속은 하나뿐이다 — 이 파일이 컴포넌트를 default export 한다.
 *
 * ── 어디서 들어오나
 * /stories/fart-bride 의 "이야기 시작하기" → /stories/fart-bride/play → 이 컴포넌트.
 * 라우트(src/app/stories/[id]/play/page.tsx)는 id 로 이 컴포넌트를 찾아 그리기만 한다.
 * 다른 이야기는 각자 src/stories/<id>/ 폴더를 쓰므로 이 파일과 섞이지 않는다.
 *
 * ── 만들어야 하는 것 (시안 8~17)
 *  8      전면 장면 + 하단 내레이션 바 + 장면 점 + 다음 버튼
 *  9~11   좌우 분할. 오른쪽 대화 패널, 마이크 대기 → 녹음 중
 *  12~14  아이 답변 말풍선, "다시 말하기 / 잘했어", 며느리 응답 대기
 *  15-1·2 완료 모달
 *  16~17  이야기 순서 맞추기 미션
 *
 * ── 쓸 수 있는 것 (새로 만들지 말 것)
 * - 제목·요약·칩          src/lib/mock-data.ts 의 getStoryDetail("fart-bride")
 * - 아이 원형 아바타       src/components/child/character-avatar.tsx
 * - 색·그림자 토큰         src/app/globals.css 의 @theme
 * - 뒤로가기 아이콘        public/figma/icons/arrow-left.svg
 * - 장면 이미지            지금은 public/figma/stories/ 에 7번 히어로 한 장뿐이다.
 *                        시안 8~14 의 장면 컷은 아직 없으니 받아서 넣어야 한다.
 *
 * ── 시안 옮길 때 반복해서 걸리는 것
 * - Figma 텍스트는 거의 전부 line-height: normal 이다. globals.css 가 body 에 걸어
 *   뒀으니, 줄간격이 필요한 곳만 leading-[1.6] 처럼 직접 준다.
 * - 캔버스는 1366×1024 고정이고 루트 레이아웃이 뷰포트를 1366 으로 잠근다.
 * - next/image 는 fill 과 sizes 를 꼭 같이 준다. sizes 를 빼면 3840px 을 받아 온다.
 * - 새 확장자의 정적 파일을 쓰면 src/proxy.ts 의 matcher 제외 목록에 추가한다.
 *   빠뜨리면 파일마다 인증 왕복이 붙는다.
 */
export default function FartBridePlay() {
  return (
    <main className="flex h-[1024px] w-full items-center justify-center bg-story-bg">
      <p className="text-[20px] font-bold text-ink-mid">
        방귀 뀌는 며느리 — 재생 화면(시안 8~17) 준비 중
      </p>
    </main>
  );
}
