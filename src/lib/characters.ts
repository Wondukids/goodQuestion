/**
 * 캐릭터 고르기(24) 그리드 이미지.
 *
 * Figma 는 200×200 카드 안에서 원본 이미지를 확대·이동해 얼굴을 맞춰 두었다.
 * `crop` 은 그 값을 그대로 옮긴 것으로, 카드 크기에 대한 백분율이다.
 */
export type Character = {
  id: string;
  label: string;
  src: string;
  /** 원본 파일 크기 (next/image 용) */
  intrinsic: { width: number; height: number };
  crop: { left: string; top: string; width: string; height: string };
};

export const CHARACTERS: Character[] = [
  {
    id: "rabbit",
    label: "토끼",
    src: "/figma/characters/rabbit.png",
    intrinsic: { width: 418, height: 588 },
    crop: { left: "9.41%", top: "-2.61%", width: "76.95%", height: "108.24%" },
  },
  {
    id: "lion",
    label: "사자",
    src: "/figma/characters/lion.png",
    intrinsic: { width: 418, height: 588 },
    crop: { left: "13.19%", top: "-1.92%", width: "77.05%", height: "108.38%" },
  },
  {
    id: "fox",
    label: "여우",
    src: "/figma/characters/fox.png",
    intrinsic: { width: 418, height: 494 },
    crop: { left: "15.61%", top: "13.92%", width: "78.32%", height: "92.56%" },
  },
  /* 곰·강아지·호랑이 남아 컷은 Figma(22:2072~2078)에서 새로 추출했다 —
     원래 있던 세 파일은 여아 그림이어서 *-girl 로 옮겼다. */
  {
    id: "bear",
    label: "곰",
    src: "/figma/characters/bear.png",
    intrinsic: { width: 482, height: 543 },
    crop: { left: "7.4%", top: "4%", width: "85.2%", height: "96%" },
  },
  {
    id: "dog",
    label: "강아지",
    src: "/figma/characters/dog.png",
    intrinsic: { width: 1124, height: 843 },
    crop: { left: "-21%", top: "-2%", width: "142%", height: "106.5%" },
  },
  {
    id: "tiger",
    label: "호랑이",
    src: "/figma/characters/tiger.png",
    intrinsic: { width: 482, height: 488 },
    crop: { left: "2.6%", top: "4%", width: "94.8%", height: "96%" },
  },
  /* 여아 6종 — 토끼·여우는 Figma 시트(22:2070·2069)에서 잘랐고, 사자는 개별 원본,
     곰·강아지·호랑이는 원래 남아 자리에 있던 여아 그림을 그대로 가져왔다. */
  {
    id: "rabbit-girl",
    label: "여아 토끼",
    src: "/figma/characters/rabbit-girl.png",
    intrinsic: { width: 481, height: 542 },
    crop: { left: "7.4%", top: "4%", width: "85.2%", height: "96%" },
  },
  {
    id: "lion-girl",
    label: "여아 사자",
    src: "/figma/characters/lion-girl.png",
    intrinsic: { width: 1611, height: 1208 },
    crop: { left: "-31%", top: "-17%", width: "163%", height: "122%" },
  },
  {
    id: "fox-girl",
    label: "여아 여우",
    src: "/figma/characters/fox-girl.png",
    intrinsic: { width: 482, height: 488 },
    crop: { left: "2.6%", top: "4%", width: "94.8%", height: "96%" },
  },
  {
    id: "bear-girl",
    label: "여아 곰",
    src: "/figma/characters/bear-girl.png",
    intrinsic: { width: 512, height: 512 },
    crop: { left: "6.08%", top: "16.57%", width: "87.92%", height: "87.92%" },
  },
  {
    id: "dog-girl",
    label: "여아 강아지",
    src: "/figma/characters/dog-girl.png",
    intrinsic: { width: 1254, height: 1254 },
    crop: {
      left: "-72.43%",
      top: "-115.23%",
      width: "243.61%",
      height: "243.61%",
    },
  },
  {
    id: "tiger-girl",
    label: "여아 호랑이",
    src: "/figma/characters/tiger-girl.png",
    intrinsic: { width: 512, height: 512 },
    crop: { left: "3.01%", top: "13.71%", width: "94%", height: "94%" },
  },
];

/** children.character_id 로 저장해도 되는 값인지 — DB 의 CHECK 제약과 같은 목록이다. */
export function isCharacterId(value: string) {
  return CHARACTERS.some((character) => character.id === value);
}

/** 모르는 id 가 들어와도 카드가 비지 않도록 첫 캐릭터로 떨어진다. */
export function getCharacter(id: string): Character {
  return CHARACTERS.find((character) => character.id === id) ?? CHARACTERS[0];
}
