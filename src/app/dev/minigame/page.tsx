"use client";

import { useState } from "react";
import { MinigamePopup } from "@/stories/fart-bride/minigame-popup";

/**
 * 미니게임만 따로 띄워 보는 개발용 화면 — 로그인 없이 /dev/minigame 로 연다.
 *
 * 이야기를 처음부터 재생하지 않고도 미션 흐름을 확인할 수 있다.
 * 배포 화면과 무관한 개발 도구라 (main) 레이아웃 밖 /dev 아래 둔다.
 */

const MISSIONS = [
  { id: 1 as const, title: "미션1 · 배나무 아래 소품 고르기" },
  { id: 2 as const, title: "미션2 · 며느리 친구들의 고민 다시 보기" },
  { id: 3 as const, title: "마무리 · 순서 맞추고 줄거리 들려주기" },
];

export default function MinigameDevPage() {
  const [open, setOpen] = useState<1 | 2 | 3 | null>(null);
  const [childName, setChildName] = useState("지훈");
  const [log, setLog] = useState<string[]>([]);

  const note = (text: string) => setLog((lines) => [...lines, text]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-warm p-10">
      <h1 className="text-[28px] font-extrabold text-ink">미니게임·마무리 미리보기</h1>
      <p className="text-[15px] font-bold text-ink-mid">마이크 권한이 필요해요</p>

      <label className="flex items-center gap-3 text-[15px] font-bold text-ink-mid">
        아이 이름
        <input
          value={childName}
          onChange={(event) => setChildName(event.target.value)}
          className="w-32 rounded-xl border border-divider bg-white px-3 py-2 text-ink"
        />
      </label>

      <div className="flex gap-4">
        {MISSIONS.map((mission) => (
          <button
            key={mission.id}
            type="button"
            onClick={() => {
              setLog([]);
              setOpen(mission.id);
            }}
            className="rounded-2xl bg-primary px-7 py-4 text-[16px] font-extrabold text-white"
          >
            {mission.title}
          </button>
        ))}
      </div>

      {log.length > 0 && (
        <ul className="flex flex-col gap-1 text-[14px] font-bold text-ink-mid">
          {log.map((text, i) => (
            <li key={i}>· {text}</li>
          ))}
        </ul>
      )}

      <MinigamePopup
        open={open !== null}
        mission={open ?? 1}
        childName={childName.trim() || null}
        onClose={() => {
          note("닫음");
          setOpen(null);
        }}
        onComplete={() => {
          note("미션 완료");
          setOpen(null);
        }}
      />
    </main>
  );
}
