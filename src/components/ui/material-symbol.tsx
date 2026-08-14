/**
 * Material Symbols Rounded 아이콘.
 * 시안이 쓰는 글리프 폰트는 전체가 수 MB 라, 필요한 아이콘의 SVG 만
 * public/figma/icons/ms 에 셀프호스팅하고 mask 로 깔아 currentColor 로 칠한다.
 * 색은 부모(또는 자신)의 text-* 클래스로 정한다.
 */
export function MaterialSymbol({
  name,
  size,
  className = "",
}: {
  name: string;
  size: number;
  className?: string;
}) {
  const mask = `url(/figma/icons/ms/${name}.svg)`;
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{
        width: size,
        height: size,
        maskImage: mask,
        maskSize: "100% 100%",
        WebkitMaskImage: mask,
        WebkitMaskSize: "100% 100%",
      }}
    />
  );
}
