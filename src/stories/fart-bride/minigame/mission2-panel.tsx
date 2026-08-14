"use client";

import Image from "next/image";
import { BRIDE, SCENE } from "./mission2-script";

/**
 * 미션2 화면 아래에 깔리는 대화 패널 (시안 DialoguePanel, 1366×245).
 *
 * 미션1 패널과 생김새가 아예 다르다 — 짙은 먹색 바탕에 주황 강조색이고,
 * 마이크 자리에는 아이 캐릭터가 앉는다. 그래서 미션별로 패널을 따로 둔다.
 *
 * 아래 줄은 상황에 따라 셋 중 하나다: 마이크+상태칩 / 선택 버튼 / 다음으로.
 */

/** 마이크 상태 — off 는 아이 차례가 아직 아니라 누를 수 없는 상태다 */
export type MicState = "off" | "ready" | "listening" | "thinking";

/* 시안 03 파형 막대의 높이(px) */
const WAVE_HEIGHTS = [18, 34, 50, 30, 44, 22, 38, 26];

export type PanelChoice = { label: string; onClick: () => void; primary?: boolean };

export function Mission2Panel({
  line,
  onReplay,
  mic,
  choices,
  hint,
}: {
  /** 며느리 대사 */
  line: string;
  /** 없으면 "다시 듣기" 가 눌리지 않는다 (음성이 아직 없거나 재생 중) */
  onReplay?: () => void;
  /** 마이크 줄 — 버튼을 보여 줄 때는 넘기지 않는다 */
  mic?: { state: MicState; label: string; onToggle: () => void };
  /** 마이크 대신 놓이는 버튼들 (시안 05 의 두 갈래, 07 의 "다음으로") */
  choices?: PanelChoice[];
  /** 마이크를 못 쓸 때 같은 안내 — 버튼 오른쪽에 붙는다 */
  hint?: string;
}) {
  const listening = mic?.state === "listening";
  const active = mic?.state === "ready" || listening;

  return (
    <div className="absolute bottom-0 left-0 h-[245px] w-[1366px] overflow-hidden bg-[#2c2c2a]">
      <Image
        src={BRIDE.avatar}
        alt=""
        width={60}
        height={60}
        className="absolute top-[25px] left-[40px] size-[60px]"
      />
      <p className="absolute top-[25px] left-[116px] text-[17px] text-[#ef9f27]">
        {BRIDE.name}
      </p>
      <p className="absolute top-[52px] left-[116px] w-[1000px] text-[23px] font-bold text-[#f1efe8]">
        {line}
      </p>

      <button
        type="button"
        onClick={onReplay}
        disabled={!onReplay}
        className={`absolute top-[39px] left-[1239px] rounded-[17px] bg-white/12 px-4 py-2 text-[14px] text-[#ccc9c2] ${
          onReplay ? "" : "opacity-40"
        }`}
      >
        다시 듣기
      </button>

      <div className="absolute top-[110px] left-[40px] h-px w-[1286px] bg-white/14" />

      {mic && (
        <>
          {/* 마이크 자리에 아이 캐릭터가 앉는다 — 말할 차례면 테두리가 켜진다 */}
          <button
            type="button"
            onClick={mic.onToggle}
            disabled={!active}
            aria-label={listening ? "다 말했어요" : "말하기"}
            className={`absolute top-[135px] left-[40px] size-[80px] ${
              active ? "" : "opacity-35"
            }`}
          >
            <Image
              src={listening ? SCENE.childAvatarActive : SCENE.childAvatar}
              alt=""
              width={listening ? 108 : 80}
              height={listening ? 108 : 80}
              className={
                listening
                  ? "absolute -inset-[14px] max-w-none size-[108px]"
                  : "size-[80px]"
              }
            />
          </button>

          <span
            className={`absolute top-[159px] left-[136px] rounded-[16px] px-4 py-2 text-[15px] text-[#d9d6cf] ${
              listening ? "bg-[#6fa8dc]/22" : "bg-white/12"
            } ${active ? "" : "opacity-35"}`}
          >
            {mic.label}
          </span>

          {listening && (
            <div className="absolute top-[150px] left-[1236px] flex items-center gap-1.5">
              {WAVE_HEIGHTS.map((height, i) => (
                <span
                  key={i}
                  className="voice-wave w-1.5 rounded-[3px] bg-[#6fa8dc]"
                  style={{ height, animationDelay: `${i * 0.08}s` }}
                />
              ))}
            </div>
          )}
        </>
      )}

      {choices && (
        <div className="absolute top-[148px] left-[136px] flex items-start gap-4">
          {choices.map((choice) => (
            <button
              key={choice.label}
              type="button"
              onClick={choice.onClick}
              className={`rounded-[28px] px-7 py-4 text-[19px] ${
                choice.primary ? "bg-[#ef9f27] text-white" : "bg-white/14 text-[#e0ded6]"
              }`}
            >
              {choice.label}
            </button>
          ))}
        </div>
      )}

      {hint && (
        <p className="absolute top-[168px] left-[400px] text-[15px] text-[#ef9f27]">{hint}</p>
      )}
    </div>
  );
}
