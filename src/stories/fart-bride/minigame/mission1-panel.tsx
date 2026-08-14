"use client";

import Image from "next/image";
import { SCENE } from "./mission1-script";

/**
 * 미션1 화면 아래에 깔리는 대화 패널 (시안 DialoguePanel).
 *
 * 왼쪽 위는 말하는 사람과 대사, 오른쪽 위는 "다시 듣기",
 * 아래 줄은 마이크와 상태 배지다. 아이가 말하는 동안에는 오른쪽에 파형이,
 * 이야기가 끝나면 "다음으로" 버튼이 그 자리에 온다 (시안 08·09).
 *
 * 좌표는 감싸는 미션 화면(1092×820 시안 캔버스) 기준이라 여기서는
 * inset-x-0 bottom-0 으로만 붙는다.
 */

/** 마이크 상태 — off 는 아이 차례가 아직 아니라 누를 수 없는 상태다 */
export type MicState = "off" | "ready" | "listening" | "thinking" | "heard";

const BADGE: Record<MicState, string> = {
  off: "말할 준비가 됐어요",
  ready: "말할 준비가 됐어요",
  listening: "내가 말하는 중",
  thinking: "듣고 생각하는 중",
  heard: "잘 들었어요",
};

/* 시안 08 파형 막대의 높이(px). 말하는 동안 제자리에서 오르내린다 */
const WAVE_HEIGHTS = [10, 18, 24, 14, 32, 40, 20, 28, 12];

export function DialoguePanel({
  speaker,
  line,
  onReplay,
  mic,
  transcript,
  hint,
  next,
}: {
  speaker: { name: string; avatar: string };
  /** 대사 — "\n" 은 줄바꿈으로 그린다 */
  line: string;
  /** 없으면 "다시 듣기" 가 눌리지 않는다 (음성이 아직 없거나 재생 중) */
  onReplay?: () => void;
  /** 없으면 마이크 줄이 통째로 빠진다 (시안 09 처럼 아이 차례가 끝난 화면) */
  mic?: { state: MicState; onToggle: () => void };
  /** 아이 말을 알아들은 결과 — 있으면 배지 아래 보여 준다 */
  transcript?: string;
  /** 마이크를 못 쓸 때 같은 안내 — 있으면 배지 아래 붉게 보여 준다 */
  hint?: string;
  /** 있으면 오른쪽에 "다음으로" 버튼이 뜬다 (시안 09) */
  next?: { label: string; onClick: () => void };
}) {
  const listening = mic?.state === "listening";

  return (
    <div className="absolute inset-x-0 bottom-0 flex flex-col gap-5 rounded-t-3xl border-t border-white/10 bg-[#1f1813]/95 px-8 pt-5 pb-6">
      {/* NPCRow — 누가 무슨 말을 하는지 */}
      <div className="flex w-full items-center justify-between">
        <div className="flex items-center gap-4">
          <Image
            src={speaker.avatar}
            alt=""
            width={48}
            height={48}
            className="size-12 shrink-0 rounded-full border-2 border-white object-cover"
          />
          <div className="flex flex-col gap-1">
            <p className="text-[14px] font-extrabold text-[#f2743d]">{speaker.name}</p>
            <p className="w-[830px] whitespace-pre-line text-[16px] font-bold text-white">
              {line}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onReplay}
          disabled={!onReplay}
          className={`flex shrink-0 items-center gap-1.5 rounded-[30px] border border-white/20 bg-white/10 px-3 py-1.5 ${
            onReplay ? "" : "opacity-40"
          }`}
        >
          <Image src={SCENE.volume} alt="" width={14} height={14} className="size-3.5" />
          <span className="text-[12px] font-bold text-white">다시 듣기</span>
        </button>
      </div>

      <div className="h-px w-full bg-white/10" />

      {/* VoiceInputRow — 마이크와 상태 */}
      <div
        className={`flex min-h-16 w-full items-center ${mic ? "justify-between" : "justify-end"}`}
      >
        {mic && (
          <div className="flex items-center gap-5">
            <button
              type="button"
              onClick={mic.onToggle}
              disabled={mic.state !== "ready" && !listening}
              aria-label={listening ? "다 말했어요" : "말하기"}
              className={`flex size-16 shrink-0 items-center justify-center rounded-full bg-primary drop-shadow-[0_0_8px_rgba(111,188,221,0.5)] ${
                mic.state === "ready" || listening ? "" : "opacity-60"
              }`}
            >
              <Image src={SCENE.mic} alt="" width={24} height={24} className="size-6" />
            </button>

            <div className="flex flex-col gap-1.5">
              <span className="w-fit rounded bg-white/10 px-2 py-0.5 text-[11px] font-extrabold text-primary">
                {BADGE[mic.state]}
              </span>
              {(transcript || listening || hint) && (
                <div className="flex h-[27px] items-center gap-0.5">
                  {hint ? (
                    <span className="text-[15px] font-bold text-[#f2743d]">{hint}</span>
                  ) : (
                    <>
                      <span className="text-[15px] font-bold text-white">{transcript}</span>
                      {listening && (
                        <span className="stt-caret h-6 w-0.5 bg-primary opacity-80" />
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {listening && (
          <div className="flex items-center gap-1">
            {WAVE_HEIGHTS.map((height, i) => (
              <span
                key={i}
                className="voice-wave w-1 rounded-[2px] bg-primary"
                style={{ height, animationDelay: `${i * 0.08}s` }}
              />
            ))}
          </div>
        )}

        {next && (
          <button
            type="button"
            onClick={next.onClick}
            className="flex shrink-0 items-center gap-2.5 rounded-[32px] bg-primary py-4 pr-[26px] pl-8 shadow-[0_3px_8px_rgba(0,0,0,0.22)]"
          >
            <span className="text-[20px] font-bold text-white">{next.label}</span>
            <Image
              src={SCENE.arrow}
              alt=""
              width={22}
              height={22}
              className="size-[22px] brightness-0 invert"
            />
          </button>
        )}
      </div>
    </div>
  );
}
