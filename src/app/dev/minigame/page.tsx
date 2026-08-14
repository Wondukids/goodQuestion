"use client";

import { useCallback, useEffect, useState } from "react";
import { MinigamePopup } from "@/stories/fart-bride/minigame-popup";
import type { MissionConfig } from "@/stories/fart-bride/session-api";
import { MOCK_MISSION_API, openMockMission } from "./mock-mission-api";

/**
 * 미니게임만 따로 띄워 보는 개발용 화면 — 로그인 없이 /dev/minigame 로 연다.
 *
 * 미션 1·2 에는 **목 미션 API**(mock-mission-api.ts — 명세 7절 계약 모양)를 주입해,
 * 서버(#19) 없이도 선택→대답→요약→되묻기→미션끝→complete 전 흐름이 돈다 (이슈 #20).
 * 받아쓰기만 진짜 STT 라 마이크 권한이 필요하다. 재현 손잡이:
 * - 6자 미만으로 짧게 답하면 되묻기(M9), 두 번째는 그대로 진행
 * - 무음으로 두 번 흘리면 건너뜀 — complete 가 발화받기(유도 대화) 분기로 온다
 * - 전부 말로 채우면 complete 가 장면끝 — 아래 기록에 「답변 컷 스킵」이 찍힌다 (M6)
 *
 * SPACE 순환(닫힘 → 미션1 → 미션2 → 마무리 → 닫힘)은 예전에 재생 화면에 있던
 * 개발 손잡이를 여기로 격리한 것이다 — 아이 앱에서 SPACE 는 이제 아무 일도 안 한다.
 * 배포 화면과 무관한 개발 도구라 (main) 레이아웃 밖 /dev 아래 둔다.
 */

const MISSIONS = [
  { id: 1 as const, title: "미션1 · 배나무 아래 소품 고르기" },
  { id: 2 as const, title: "미션2 · 며느리 친구들의 고민 다시 보기" },
  { id: 3 as const, title: "마무리 · 순서 맞추고 줄거리 들려주기" },
];

/* 목에는 세션 개념이 없다 — 자리만 채우는 개발용 id */
const DEV_SESSION_ID = "dev-session";

export default function MinigameDevPage() {
  const [open, setOpen] = useState<1 | 2 | 3 | null>(null);
  const [wiring, setWiring] = useState<{
    missionSessionId: string;
    config: MissionConfig;
  } | null>(null);
  const [childName, setChildName] = useState("지훈");
  const [log, setLog] = useState<string[]>([]);

  const note = (text: string) => setLog((lines) => [...lines, text]);

  /* 열 때마다 새 목 미션 세션 — 재개는 처음부터라는 M4 와 같은 결이다 */
  const openMission = useCallback((id: 1 | 2 | 3) => {
    setLog([]);
    setWiring(id === 3 ? null : openMockMission(id));
    setOpen(id);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      /* 누르고 있으면 키가 연타로 들어와 미션이 순식간에 지나간다 */
      if (event.code !== "Space" || event.repeat) return;
      /* 이름 입력 칸의 띄어쓰기는 그대로 둔다 */
      if (event.target instanceof HTMLInputElement) return;
      /* 스크롤·포커스된 버튼의 스페이스 동작을 막고 미션 전환으로만 쓴다 */
      event.preventDefault();
      if (open === 3) setOpen(null);
      else openMission(open === null ? 1 : ((open + 1) as 2 | 3));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, openMission]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-warm p-10">
      <h1 className="text-[28px] font-extrabold text-ink">미니게임·마무리 미리보기</h1>
      <p className="text-[15px] font-bold text-ink-mid">
        마이크 권한이 필요해요 · 미션 1·2 는 목(mock) 서버로 돌아요 · SPACE 로 순환
      </p>
      <p className="text-[13px] font-bold text-ink-muted">
        짧게(6자 미만) 답하면 되묻기, 무음 2회면 건너뜀 → 종료 요약이 유도 질문으로
        와요
      </p>

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
            onClick={() => openMission(mission.id)}
            className="rounded-2xl bg-primary px-7 py-4 text-[16px] font-extrabold text-white"
          >
            {mission.title}
          </button>
        ))}
      </div>

      {log.length > 0 && (
        <ul className="flex max-w-[720px] flex-col gap-1 text-[14px] font-bold text-ink-mid">
          {log.map((text, i) => (
            <li key={i}>· {text}</li>
          ))}
        </ul>
      )}

      <MinigamePopup
        open={open !== null}
        mission={open ?? 1}
        childName={childName.trim() || null}
        sessionId={wiring ? DEV_SESSION_ID : null}
        missionSessionId={wiring?.missionSessionId ?? null}
        config={wiring?.config ?? null}
        missionApi={MOCK_MISSION_API}
        onClose={() => {
          note("닫음 — 시도는 abandoned (M4), 재생 화면이면 대화로 복귀");
          setOpen(null);
        }}
        onComplete={(result) => {
          /* 재생 화면이라면 이 결과를 대화 패널이 재생하고 분기한다 (M8·M6) */
          if (result) {
            note(`미션 완료 — 종료 요약: ${result.summary.text}`);
            if (result.closing_line) note(`닫는 말: ${result.closing_line.text}`);
            note(
              result.next.kind === "발화받기"
                ? "next: 발화받기 — 부족 요소 유도 대화로 이어진다"
                : `next: ${result.next.kind} — 답변 컷을 건너뛰고 다음 스텝 (M6)`,
            );
          } else {
            note("미션 완료 — 서버 결과 없음 (complete 실패·마무리 활동)");
          }
          setOpen(null);
        }}
      />
    </main>
  );
}
