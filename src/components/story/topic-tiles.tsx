import { MaterialSymbol } from "@/components/ui/material-symbol";

export type TopicTile = {
  label: string;
  /** 데이터(stories.topic)와 대조하는 값 — 라벨과 다를 수 있다("나눔" → "나눔·배려") */
  topic: string;
  icon: string;
  color: string;
  /** 아이콘 배경 · 이야기 카드의 주제 칩이 함께 쓰는 옅은 바탕.
      시안은 주제색 15%(예: 자기이해 49:1064)를 깔지만, 「다름」만 디자인시스템 토큰
      brand/900(#daedf6= 주제색 26%)을 그대로 쓴다(49:1058) — 그래서 값으로 적어 둔다. */
  tint: string;
  /** 주제 칩 글자 — tint 바탕 위에서 읽히도록 주제색을 20% 어둡게(HSL 명도 -20%p) 한 값.
      시안이 「다름」 칩(49:1112)에 쓴 #2c8fba 가 이 규칙과 정확히 같아 나머지도 그렇게 뽑았다. */
  ink: string;
};

/* 주제 타일(시안 21-886) — 홈과 이야기 목록이 같이 쓴다.
   시안의 "지혜" 자리는 카탈로그에 실재하는 "정직" 으로 채웠다. */
export const TOPIC_TILES: readonly TopicTile[] = [
  {
    label: "다름",
    topic: "다름",
    icon: "extension",
    color: "#6fbcdd",
    tint: "#daedf6",
    ink: "#2c8fba",
  },
  {
    label: "자기이해",
    topic: "자기이해",
    icon: "sentiment_satisfied",
    color: "#f0a83c",
    tint: "#f0a83c26",
    ink: "#b8740e",
  },
  {
    label: "장점발견",
    topic: "장점발견",
    icon: "star",
    color: "#fd7c51",
    tint: "#fd7c5126",
    ink: "#e53b03",
  },
  {
    label: "나눔",
    topic: "나눔·배려",
    icon: "card_giftcard",
    color: "#e86a8f",
    tint: "#e86a8f26",
    ink: "#cc2052",
  },
  {
    label: "용기",
    topic: "용기",
    icon: "shield",
    color: "#7bc47f",
    tint: "#7bc47f26",
    ink: "#439648",
  },
  {
    label: "정직",
    topic: "정직",
    icon: "verified",
    color: "#9b8cf0",
    tint: "#9b8cf026",
    ink: "#4d32e4",
  },
  {
    label: "우정",
    topic: "우정",
    icon: "group",
    color: "#4bb3c9",
    tint: "#4bb3c926",
    ink: "#287586",
  },
  {
    label: "가족",
    topic: "가족",
    icon: "home",
    color: "#d98b5f",
    tint: "#d98b5f26",
    ink: "#aa5728",
  },
];

/** 이야기 목록 맨 앞의 "전체" 타일 */
export const ALL_TILE: TopicTile = {
  label: "전체",
  topic: "전체",
  icon: "apps",
  color: "#45a9d3",
  tint: "#45a9d326",
  ink: "#226f90",
};

/**
 * 이야기 카드의 주제 칩 색 — 타일과 같은 주제색을 쓴다(시안 49:1112 칩 ↔ 49:1058 타일).
 *
 * 바탕은 타일 아이콘 배경과 같은 tint 라, 주제 타일 줄 바로 밑에 깔리는 카드의 칩이
 * 타일과 같은 색으로 보인다. 카탈로그에 없는 주제가 들어오면 하늘색으로 떨어뜨린다.
 */
export function topicChipStyle(topic: string) {
  const tile = TOPIC_TILES.find((candidate) => candidate.topic === topic);
  return {
    backgroundColor: tile?.tint ?? "#daedf6",
    color: tile?.ink ?? "#2c8fba",
  };
}

export function TopicTileButton({
  tile,
  count,
  selected,
  onClick,
}: {
  tile: TopicTile;
  count: number;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className="flex min-w-0 flex-1 cursor-pointer flex-col items-center gap-3 rounded-[20px] border-2 bg-story-bg px-2 py-4"
      style={{ borderColor: selected ? tile.color : "transparent" }}
    >
      <span
        className="flex size-16 items-center justify-center rounded-[20px]"
        style={{ backgroundColor: tile.tint, color: tile.color }}
      >
        <MaterialSymbol name={tile.icon} size={32} />
      </span>
      <span className="flex flex-col items-center gap-1 leading-[1.6]">
        <span className="text-[18px] font-bold text-ink-strong">
          {tile.label}
        </span>
        <span className="text-[14px] font-extrabold text-[#8a8a8a]">
          {count}편
        </span>
      </span>
    </button>
  );
}
