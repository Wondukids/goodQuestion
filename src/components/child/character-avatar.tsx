import Image from "next/image";
import { getCharacter } from "@/lib/characters";

/**
 * 프리셋 캐릭터를 원형으로 잘라 보여 준다.
 * characters.ts 의 crop 은 카드 크기에 대한 백분율이라 지름이 달라져도 얼굴 위치가 유지된다.
 */
export function CharacterAvatar({
  characterId,
  size,
  className = "",
}: {
  characterId: string;
  size: number;
  className?: string;
}) {
  const character = getCharacter(characterId);

  return (
    <span
      style={{ width: size, height: size }}
      className={`relative block shrink-0 overflow-hidden rounded-full bg-primary-avatar/60 ${className}`}
    >
      <Image
        src={character.src}
        alt=""
        width={character.intrinsic.width}
        height={character.intrinsic.height}
        style={{
          left: character.crop.left,
          top: character.crop.top,
          width: character.crop.width,
          height: character.crop.height,
        }}
        className="absolute max-w-none"
      />
    </span>
  );
}
