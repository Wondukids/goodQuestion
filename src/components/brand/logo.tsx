import Image from "next/image";

const SIZES = {
  /* 로그인 화면 중앙 로고 (34) */
  lg: { width: 248, height: 89 },
  /* 상단 네비게이션 로고 (24 · 31 · 32) */
  sm: { width: 160, height: 57 },
} as const;

export function Logo({
  size = "sm",
  className,
}: {
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const { width, height } = SIZES[size];

  return (
    <Image
      src="/figma/logo.png"
      alt="Good Question"
      width={width}
      height={height}
      className={className}
      priority
    />
  );
}
