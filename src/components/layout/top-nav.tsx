import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import type { Child } from "@/lib/mock-data";

export function TopNav({ child }: { child: Child }) {
  return (
    <header className="relative h-[140px] w-full overflow-hidden bg-surface">
      <Link href="/home" className="absolute top-[30px] left-12">
        <Logo />
      </Link>

      <Link
        href="/children"
        className="absolute top-[30px] right-[33px] flex h-[70px] items-center gap-2.5 rounded-full border-2 border-primary/60 bg-surface py-2 pr-[18px] pl-3.5"
      >
        <Image
          src={child.avatar}
          alt=""
          width={48}
          height={48}
          className="size-12 shrink-0 rounded-full"
        />
        <span className="text-[20px] font-extrabold text-ink">
          {child.name}
        </span>
      </Link>
    </header>
  );
}
