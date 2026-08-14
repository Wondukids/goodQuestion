import { MaterialSymbol } from "@/components/ui/material-symbol";

export type TopicTile = {
  label: string;
  /** 데이터(stories.topic)와 대조하는 값 — 라벨과 다를 수 있다("나눔" → "나눔·배려") */
  topic: string;
  icon: string;
  color: string;
};

/* 주제 타일(시안 21-886) — 홈과 이야기 목록이 같이 쓴다.
   시안의 "지혜" 자리는 카탈로그에 실재하는 "정직" 으로 채웠다. */
export const TOPIC_TILES: readonly TopicTile[] = [
  { label: "다름", topic: "다름", icon: "extension", color: "#6fbcdd" },
  {
    label: "자기이해",
    topic: "자기이해",
    icon: "sentiment_satisfied",
    color: "#f0a83c",
  },
  { label: "장점발견", topic: "장점발견", icon: "star", color: "#fd7c51" },
  { label: "나눔", topic: "나눔·배려", icon: "card_giftcard", color: "#e86a8f" },
  { label: "용기", topic: "용기", icon: "shield", color: "#7bc47f" },
  { label: "정직", topic: "정직", icon: "verified", color: "#9b8cf0" },
  { label: "우정", topic: "우정", icon: "group", color: "#4bb3c9" },
  { label: "가족", topic: "가족", icon: "home", color: "#d98b5f" },
];

/** 이야기 목록 맨 앞의 "전체" 타일 */
export const ALL_TILE: TopicTile = {
  label: "전체",
  topic: "전체",
  icon: "apps",
  color: "#45a9d3",
};

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
        style={{ backgroundColor: `${tile.color}26`, color: tile.color }}
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
