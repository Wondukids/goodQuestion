"use client";

import { Popup } from "@/frontendlib";

/**
 * 미니게임 팝업 — 아직 게임이 없어 빈 껍데기다.
 *
 * 재생 화면(play.tsx)에서 SPACE 로 열어 흐름을 테스트한다 (개발용).
 * 실제 게임이 정해지면 가운데 자리에 게임 컴포넌트가 들어가고,
 * 클리어 시 onComplete 로 이야기 진행(다음 스텝)을 알리게 된다 —
 * video-plan 의 after: "stt-minigame" 컷과 연결할 자리다.
 */
export function MinigamePopup({
  open,
  onClose,
  onComplete,
}: {
  open: boolean;
  /** 닫기 버튼·배경 클릭 — 게임 없이 그냥 닫는다 */
  onClose: () => void;
  /** 게임 클리어 (지금은 "게임 완료" 버튼이 대신한다) */
  onComplete: () => void;
}) {
  return (
    <Popup
      open={open}
      onClose={onClose}
      className="flex w-[560px] max-w-[90vw] flex-col items-center gap-6 rounded-3xl bg-white p-10"
    >
      <h2 className="text-[26px] font-extrabold text-ink">미니게임</h2>
      <div className="flex h-[280px] w-full items-center justify-center rounded-2xl bg-chip">
        <p className="text-center text-[15px] font-bold text-ink-muted">
          여기에 미니게임이 들어갑니다.
          <br />
          (아직 준비 중이에요)
        </p>
      </div>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onClose}
          className="rounded-xl bg-chip px-6 py-3 text-[16px] font-extrabold text-ink"
        >
          닫기
        </button>
        <button
          type="button"
          onClick={onComplete}
          className="rounded-xl bg-primary px-6 py-3 text-[16px] font-extrabold text-white"
        >
          게임 완료
        </button>
      </div>
    </Popup>
  );
}
