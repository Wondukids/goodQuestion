import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { CharacterAvatar } from "@/components/child/character-avatar";

export function TopNav({
  name,
  characterId,
}: {
  name: string;
  characterId: string;
}) {
  return (
    <header className="relative h-[140px] w-full overflow-hidden bg-surface">
      <Link href="/home" className="absolute top-[30px] left-12">
        <Logo />
      </Link>

      <Link
        href="/children"
        className="absolute top-[30px] right-[33px] flex h-[70px] items-center gap-2.5 rounded-full border-2 border-primary/60 bg-surface py-2 pr-[18px] pl-3.5"
      >
        <CharacterAvatar characterId={characterId} size={48} />
        <span className="text-[20px] font-extrabold text-ink">{name}</span>
      </Link>
    </header>
  );
}
