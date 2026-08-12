import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { CharacterAvatar } from "@/components/child/character-avatar";

/**
 * 카드(295×401) 아래에 타원 그림자(310×60)가 30px 겹쳐 깔린다.
 * 트랙 폭 335px = 카드 295 + 좌우 여백 → 카드 사이 간격은 40px.
 */
function CardShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative w-[295px] shrink-0">
      <Image
        src="/figma/icons/ellipse-shadow.svg"
        alt=""
        width={310}
        height={60}
        aria-hidden
        className="absolute top-[371px] left-1/2 h-[60px] w-[310px] max-w-none -translate-x-1/2"
      />
      {children}
    </div>
  );
}

const CARD_CLASS =
  "relative z-10 flex h-[401px] w-full flex-col items-center gap-6 overflow-hidden rounded-[28px] border-2 border-primary-soft bg-surface pt-9 pb-8 shadow-card";

export function ChildCard({
  name,
  age,
  characterId,
  action,
}: {
  name: string;
  age: number;
  characterId: string;
  /** 서버 액션 — 이 아이를 선택하고 홈으로 이동한다 */
  action: (formData: FormData) => Promise<void>;
}) {
  return (
    <CardShell>
      <form action={action}>
        <button type="submit" className={`${CARD_CLASS} cursor-pointer`}>
          <CharacterAvatar characterId={characterId} size={185} />
          <span className="flex flex-col items-center gap-2">
            <span className="text-[26px] font-extrabold text-ink">{name}</span>
            <span className="text-[16px] font-bold text-ink-soft">{age}세</span>
          </span>
        </button>
      </form>
    </CardShell>
  );
}

export function AddChildCard({ href }: { href: string }) {
  return (
    <CardShell>
      <Link href={href} className={CARD_CLASS}>
        <span className="flex size-[180px] shrink-0 items-center justify-center rounded-full bg-[#a39890]/13">
          <Image
            src="/figma/icons/plus.svg"
            alt=""
            width={60}
            height={60}
            className="size-[60px]"
          />
        </span>
        <span className="text-[26px] font-extrabold text-ink">아이 추가</span>
      </Link>
    </CardShell>
  );
}
