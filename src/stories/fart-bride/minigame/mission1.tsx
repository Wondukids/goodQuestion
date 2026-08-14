"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeAudio } from "@/stt/client";
import { startRecording, type Recording } from "@/stt/record";
import { STT_DEFAULTS } from "../data";
import { MissionCanvas } from "./canvas";
import { DialoguePanel, type MicState } from "./mission1-panel";
import { CHIEF, GUIDE_TEXT, LINES, PROPS, SCENE, type MissionProp } from "./mission1-script";
import { useNpcVoice } from "./use-npc-voice";

/**
 * 미니게임 미션1 — 배나무 아래에서 소품을 골라 보고, 왜 골랐는지 말하는 씬.
 *
 * 흐름 (시안 번호):
 *   01 탐색      소품 셋이 놓여 있다. 누르면 설명 말풍선이 뜬다.
 *   02·03·04     소품 설명 + "선택하기" — 다른 소품을 눌러 옮겨 볼 수 있다.
 *   06 선택      고른 소품만 빛나고 나머지는 흐려진다. 아이가 이유를 말한다.
 *   07·08 대화   이장님이 한 번 더 묻고, 아이가 답한다.
 *   09 마무리    이장님 마지막 대사 + "다음으로".
 *
 * 정답을 가리지 않는다 — 어떤 소품을 골라도 그 소품이 빛나고 이야기가 이어진다.
 * 아이에게 묻는 건 "무엇이 맞느냐" 가 아니라 "왜 그렇게 생각했느냐" 라서다.
 *
 * 좌표·크기는 전부 시안 캔버스(1092×820) 기준 값을 그대로 쓴다.
 * 화면이 좁으면 캔버스째로 축소된다 (useFitScale).
 */

const CANVAS = { w: 1092, h: 820 };

/* 소품 한 칸 — 01_탐색 기준. left/top 은 이미지의 왼쪽 위 모서리다
   (시안은 위아래 14.52 패딩이 붙은 컨테이너라 top 410 + 14.52 = 424.52). */
const PROP = { w: 214.613, h: 143.075, gap: 8.8, left: 321, top: 424.52 };

/* 말풍선 — 고른 소품 바로 위에 뜬다. 시안 02 기준 아래 모서리가 y=376 */
const BUBBLE = { w: 211, h: 162, bottom: 376 };

/* 이장님 자리 — 소품을 보여 줄 때는 왼쪽에서 가리키고, 대화할 때는 가운데로 나온다 */
const CHIEF_ASIDE = { left: 64, top: 245, width: 243.936, height: 365.904 };
const CHIEF_CENTER = { left: 399.876, top: 171.819, width: 292.248, height: 439.085 };

/** 알아들은 말을 눈으로 확인할 틈 (ms) */
const HEARD_LINGER_MS = 1600;

type Phase = "explore" | "inspect" | "reveal" | "talk" | "finish";

/**
 * 아이 쪽 차례. 이장님이 말하는 중인지는 따로 보지 않고
 * "지금 대사의 재생이 끝났는가"(spokenLine)로 판단한다.
 */
type ChildTurn = "idle" | "listening" | "thinking" | "heard" | "failed";

export function Mission1({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<Phase>("explore");
  /* inspect 에서는 설명을 열어 본 소품, 그 뒤로는 아이가 고른 소품 */
  const [prop, setProp] = useState<MissionProp | null>(null);
  /* 재생이 끝난 이장님 대사 — 지금 대사와 같아야 아이 차례가 된다.
     단계가 넘어가 대사가 바뀌면 저절로 어긋나므로 따로 되돌릴 필요가 없다. */
  const [spokenLine, setSpokenLine] = useState("");
  const [childTurn, setChildTurn] = useState<ChildTurn>("idle");
  const [heard, setHeard] = useState("");
  const [micError, setMicError] = useState("");
  const [replayCount, setReplayCount] = useState(0);

  /* 단계마다 이장님 대사 한 줄. inspect 와 reveal 은 같은 문장이라
     소품을 고르는 사이에 음성이 다시 나오지 않는다 (시안 02 = 06). */
  const line =
    phase === "explore"
      ? LINES.explore
      : phase === "talk"
        ? LINES.talk
        : phase === "finish"
          ? LINES.finish
          : LINES.inspect;

  const voice = useNpcVoice(line, CHIEF);
  /* 대사가 끝났거나, 합성이 실패해 기다릴 음성이 아예 없거나 —
     둘 다 아이에게 차례를 넘겨도 되는 상태다 (실패해도 대사는 글로 남는다) */
  const npcDone = spokenLine === line || voice.failed;

  const advance = useCallback(() => {
    setHeard("");
    setMicError("");
    setChildTurn("idle");
    setPhase((p) => (p === "reveal" ? "talk" : "finish"));
  }, []);

  /* 알아들은 말을 잠깐 보여 준 뒤 다음 단계로 */
  useEffect(() => {
    if (childTurn !== "heard") return;
    const timer = setTimeout(advance, HEARD_LINGER_MS);
    return () => clearTimeout(timer);
  }, [childTurn, advance]);

  /* ── 아이 목소리 받기 ─────────────────────────────────────────── */

  const recordingRef = useRef<Recording | null>(null);
  const retriesRef = useRef(0);

  useEffect(() => {
    return () => recordingRef.current?.dispose();
  }, []);

  const handleRecorded = useCallback(
    async (audio: Blob, channelCount: number) => {
      setChildTurn("thinking");
      try {
        const text = await transcribeAudio(audio, channelCount);
        if (!text) {
          /* 무음 — 한 번 더 기다려 보고, 그래도 조용하면 그냥 진행한다 */
          if (retriesRef.current < STT_DEFAULTS.retryCount) {
            retriesRef.current += 1;
            setChildTurn("listening");
          } else {
            retriesRef.current = 0;
            advance();
          }
          return;
        }
        retriesRef.current = 0;
        setHeard(text);
        setChildTurn("heard");
      } catch {
        setMicError("목소리를 알아듣지 못했어요.");
        setChildTurn("failed");
      }
    },
    [advance],
  );

  /* 녹음 시작 + 최대 청취 시간이 지나면 알아서 멈춘다 */
  useEffect(() => {
    if (childTurn !== "listening") return;

    let cancelled = false;
    (async () => {
      try {
        const recording = await startRecording(handleRecorded);
        if (cancelled) {
          recording.dispose();
          return;
        }
        recordingRef.current = recording;
      } catch {
        setMicError("마이크를 쓸 수 없어요. 브라우저 마이크 권한을 확인해 주세요.");
        setChildTurn("failed");
      }
    })();

    const timer = setTimeout(
      () => recordingRef.current?.stop(),
      STT_DEFAULTS.maxListenSec * 1000,
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [childTurn, handleRecorded]);

  /* ── 화면 상태 ───────────────────────────────────────────────── */

  /* 아이가 말할 차례가 있는 단계 — 탐색·마무리에서는 마이크가 놀고 있다 */
  const micActive = phase === "reveal" || phase === "talk";
  const micReady = micActive && npcDone && childTurn === "idle";
  const micState: MicState = micReady
    ? "ready"
    : micActive && (childTurn === "listening" || childTurn === "thinking" || childTurn === "heard")
      ? childTurn
      : "off";

  const toggleMic = () => {
    if (childTurn === "listening") recordingRef.current?.stop();
    else if (micReady) setChildTurn("listening");
  };

  /* 이장님이 가운데로 나오는 대화 단계 (시안 07·08·09) */
  const talking = phase === "talk" || phase === "finish";
  const pickable = phase === "explore" || phase === "inspect";
  const pickedIndex = PROPS.findIndex((p) => p.id === prop?.id);

  return (
    <MissionCanvas width={CANVAS.w} height={CANVAS.h} className="rounded-3xl bg-story-bg">
      <>
        {/* 배경 — 대화 단계에서는 블러가 살짝 걷히며 이장님에게 눈이 간다 */}
        <div
          className="absolute top-0 left-0 h-[819px] w-[1092px] transition-all duration-700"
          style={{ filter: `blur(${talking ? 3.5 : 5}px)` }}
        >
          <Image
            src={SCENE.background}
            alt=""
            fill
            sizes="1092px"
            loading="eager"
            className="object-cover"
          />
          <Image
            src={SCENE.tree}
            alt=""
            width={891}
            height={891}
            loading="eager"
            className="absolute top-[-308px] left-1/2 size-[891px] max-w-none -translate-x-1/2 object-cover"
          />
        </div>

        {/* 대화 단계에서 화면 위쪽을 눌러 주는 막 (시안 DimOverlay) */}
        <div
          className={`pointer-events-none absolute top-0 left-0 h-[624px] w-[1092px] bg-[#0d0f1a] transition-opacity duration-700 ${
            talking ? "opacity-[0.28]" : "opacity-0"
          }`}
        />

        {/* 소품 — 대화 단계로 넘어가면 화면에서 빠진다 */}
        {!talking && (
          <div
            className="absolute flex items-end"
            style={{ left: PROP.left, top: PROP.top, gap: PROP.gap }}
          >
            {PROPS.map((item) => {
              const picked = prop?.id === item.id;
              return (
                <div
                  key={item.id}
                  className="relative"
                  style={{ width: PROP.w, height: PROP.h }}
                >
                  {phase === "reveal" && picked && (
                    <Image
                      src={SCENE.halo}
                      alt=""
                      width={210}
                      height={54}
                      className="pointer-events-none absolute top-[127.7px] left-1/2 h-[54px] w-[210px] -translate-x-1/2"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setProp(item);
                      setPhase("inspect");
                    }}
                    disabled={!pickable}
                    aria-label={`${item.name} 살펴보기`}
                    className={`absolute inset-0 transition-all duration-500 ${propLook(
                      phase,
                      picked,
                    )} ${picked ? "z-10" : ""}`}
                  >
                    <Image
                      src={item.image}
                      alt=""
                      fill
                      sizes="280px"
                      loading="eager"
                      className="object-contain"
                    />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {/* 이장님 — 소품을 가리키다가 대화 단계에서 가운데로 걸어 나온다 */}
        <div
          className="absolute drop-shadow-[-6px_4px_8px_rgba(46,46,46,0.5)] transition-all duration-700 ease-out"
          style={talking ? CHIEF_CENTER : CHIEF_ASIDE}
        >
          <Image
            src={CHIEF.body}
            alt=""
            fill
            sizes="300px"
            loading="eager"
            className="object-contain"
          />
        </div>

        {phase === "explore" && (
          <p className="absolute top-[328px] left-[456px] whitespace-nowrap text-[40px] font-extrabold text-white [text-shadow:0_0_50px_#000]">
            {GUIDE_TEXT}
          </p>
        )}

        {/* 소품 설명 말풍선 — 고른 소품 바로 위 */}
        {phase === "inspect" && prop && (
          <PropBubble
            prop={prop}
            centerX={PROP.left + PROP.w / 2 + pickedIndex * (PROP.w + PROP.gap)}
            onPick={() => setPhase("reveal")}
          />
        )}

        {voice.url && (
          <audio
            key={`${line}|${replayCount}`}
            src={voice.url}
            autoPlay
            onEnded={() => setSpokenLine(line)}
          />
        )}

        <DialoguePanel
          speaker={{ name: CHIEF.name, avatar: CHIEF.avatar }}
          line={line}
          /* 재생 중에는 겹쳐 들리지 않게 잠가 둔다 */
          onReplay={
            voice.url && npcDone ? () => setReplayCount((n) => n + 1) : undefined
          }
          mic={phase === "finish" ? undefined : { state: micState, onToggle: toggleMic }}
          transcript={heard}
          hint={micError}
          next={
            phase === "finish"
              ? { label: "다음으로", onClick: onComplete }
              : childTurn === "failed"
                ? { label: "다음으로", onClick: advance }
                : undefined
          }
        />
      </>
    </MissionCanvas>
  );
}

/**
 * 소품 하나의 크기·그림자 — 단계와 골랐는지 여부로 정해진다 (시안 01·02·06).
 * 1.3 배는 시안 06 의 소쿠리(278.9×185.9)가 기본 칸(214.6×143.1)의 딱 그 배율이라
 * 나온 값이고, 못 고른 소품이 0.909 로 작아지는 것도 같은 화면에서 잰 값이다.
 */
function propLook(phase: Phase, picked: boolean) {
  if (phase === "reveal") {
    return picked
      ? "scale-[1.3] drop-shadow-[0_0_87.6px_#ffffff]"
      : "scale-[0.909] opacity-60 drop-shadow-[0_0.9px_36.3px_#363636]";
  }
  if (phase === "inspect") {
    return picked
      ? "scale-[1.3] drop-shadow-[0_0_70px_#ffffff]"
      : "drop-shadow-[0_1px_39.9px_rgba(0,0,0,0.5)]";
  }
  return "drop-shadow-[0_1.32px_52.5px_#ffffff]";
}

/** 소품 설명 말풍선 (시안 02·03·04) — 소품 칸 한가운데 위에 뜬다 */
function PropBubble({
  prop,
  centerX,
  onPick,
}: {
  prop: MissionProp;
  centerX: number;
  onPick: () => void;
}) {
  return (
    <div
      className="fx-pop-in absolute z-20"
      style={{
        left: centerX - BUBBLE.w / 2,
        top: BUBBLE.bottom - BUBBLE.h,
        width: BUBBLE.w,
        height: BUBBLE.h,
      }}
    >
      {/* 말풍선 그림 — 그림자 여백까지 담은 235×185 라 상자보다 조금 크게 얹는다 */}
      <Image
        src={SCENE.bubble}
        alt=""
        width={235}
        height={185}
        className="absolute -top-2 -left-3 h-[185px] w-[235px] max-w-none"
      />
      <div className="absolute top-[19px] left-[38px] h-[109px] w-[134px]">
        <div className="absolute top-[0.83px] left-[7px] flex w-[120px] flex-col items-center gap-1 text-center">
          <p className="text-[18px] font-extrabold text-[#2f2f2f]">{prop.name}</p>
          <p className="text-[13px] leading-[1.4] text-[#6e6e6e]">
            {prop.desc[0]}
            <br />
            {prop.desc[1]}
          </p>
        </div>
        <button
          type="button"
          onClick={onPick}
          className="absolute top-[72.83px] left-0 flex h-9 w-[134px] items-center justify-center gap-[5.8px] rounded-[20px] bg-primary"
        >
          <span className="text-[12.83px] font-extrabold text-white">선택하기</span>
          <Image
            src={SCENE.arrow}
            alt=""
            width={14}
            height={14}
            className="size-3.5 brightness-0 invert"
          />
        </button>
      </div>
    </div>
  );
}
