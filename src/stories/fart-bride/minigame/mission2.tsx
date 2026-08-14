"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeAudio } from "@/stt/client";
import { startRecording, type Recording } from "@/stt/record";
import { STT_DEFAULTS } from "../data";
import { fillChildName } from "../name";
import { MissionCanvas } from "./canvas";
import { Mission2Panel, type MicState, type PanelChoice } from "./mission2-panel";
import {
  BRIDE_POSE,
  FRIENDS,
  GUIDE_TEXT,
  LINES,
  RESULT_LABEL,
  SCENE,
  SHORT_ANSWER_CHARS,
  type Friend,
  type MissionLine,
} from "./mission2-script";

/**
 * 미니게임 미션2 — 며느리의 친구들이 가진 고민을 아이가 다시 보게 해 주는 씬.
 * 미션1(배 따기 소품 고르기)과는 별개의 미션이다.
 *
 * 흐름 (시안 번호):
 *   01 친구 고르기   네 친구 카드 중 한 명을 누른다.
 *   02 카드 확대     고민이 적힌 카드가 커지고, 며느리가 아이에게 묻는다.
 *   03 발화중        아이가 마이크를 눌러 이야기한다.
 *   08 되묻기        너무 짧게 답하면 며느리가 한 번만 다시 묻는다.
 *   05 반응          카드의 고민에 줄이 그어지고 아이 말이 자리를 대신한다.
 *                    "다른 친구도 도와줄래요" / "이제 괜찮아요" 를 고른다.
 *   06 2회차         더 돕겠다면 도운 친구에 ✓ 가 붙은 채로 다시 고른다.
 *   07 완료          며느리가 인사하고 "다음으로".
 *
 * 며느리 목소리는 사전 녹음(mission2-script.ts 의 audio)을 그대로 튼다.
 * 되묻기(08)만은 녹음이 없어 글로만 보여 준다. 아이 답에 며느리가 되받는
 * LLM 대화는 아직 이어지지 않았다 — 지금은 어떤 답이든 다음으로 넘어간다.
 *
 * 좌표·크기는 전부 시안 캔버스(1366×1024) 기준 값을 그대로 쓴다.
 */

const CANVAS = { w: 1366, h: 1024 };

/* 며느리 자리 — 포즈마다 크기가 달라 시안 값을 그대로 담아 둔다.
   flip 은 시안에서 그림을 좌우로 뒤집어 쓴 경우다 (06). */
const POSE = {
  point: { src: BRIDE_POSE.point, left: 35, top: 285, width: 289, height: 452 },
  point2: { src: BRIDE_POSE.point2, left: 35, top: 273, width: 300, height: 450, flip: true },
  listen: { src: BRIDE_POSE.listen, left: 80, top: 262, width: 300, height: 450 },
  think: { src: BRIDE_POSE.think, left: 80, top: 262, width: 334.667, height: 502 },
  worry: { src: BRIDE_POSE.worry, left: 80, top: 262, width: 334.667, height: 502 },
  smile: { src: BRIDE_POSE.smile, left: 80, top: 262, width: 300, height: 450 },
  joy: { src: BRIDE_POSE.joy, left: 462, top: 120, width: 442, height: 660 },
};

/* 카드 한 장 (시안 01) */
const CARD = { w: 229.5, h: 306, art: { w: 184.008, h: 245.718 } };

type Phase = "pick" | "ask" | "again" | "result" | "done";

/** 아이 쪽 차례. 며느리가 말하는 중인지는 spokenLine 으로 따로 본다. */
type ChildTurn = "idle" | "listening" | "thinking" | "failed";

/** 아이가 친구 하나를 도와준 기록 — quote 가 비면 목소리를 못 받은 경우다 */
type Helped = { id: string; quote: string };

export function Mission2({
  childName,
  onComplete,
  onQuit,
}: {
  /** 선택된 아이 이름 — 며느리가 아이를 부를 때 쓴다 */
  childName: string | null;
  onComplete: () => void;
  /** 왼쪽 위 뒤로가기 */
  onQuit: () => void;
}) {
  /* 이름을 모르면 "친구" 로 부른다 — 대사에 "ㅇㅇ" 이 그대로 남지 않게 */
  const kid = childName ?? "친구";

  const [phase, setPhase] = useState<Phase>("pick");
  const [friend, setFriend] = useState<Friend | null>(null);
  const [helped, setHelped] = useState<Helped[]>([]);
  /* 이 친구에게 이미 한 번 되물었는가 (시안 08 은 한 번만 뜬다) */
  const [reasked, setReasked] = useState(false);
  const [childTurn, setChildTurn] = useState<ChildTurn>("idle");
  const [micError, setMicError] = useState("");
  const [spokenLine, setSpokenLine] = useState("");
  /* 녹음 파일을 못 불러온 대사 — spokenLine 과 같은 요령으로 지금 대사와 비교한다 */
  const [failedLine, setFailedLine] = useState("");
  const [replayCount, setReplayCount] = useState(0);

  /* 단계마다 며느리 대사 한 줄 — 사전 녹음 음성과 자막 텍스트 묶음.
     카드를 고른 뒤의 질문(ask)은 친구마다 녹음이 따로 있고,
     되묻기(again)는 녹음이 없어 글로만 보여 준다. */
  const line: MissionLine =
    phase === "pick"
      ? helped.length === 0
        ? LINES.intro
        : LINES.more
      : phase === "ask"
        ? (friend?.ask ?? LINES.intro)
        : phase === "again"
          ? { text: friend?.reask ?? "" }
          : phase === "result"
            ? LINES.react
            : LINES.done;
  const lineText = fillChildName(line.text, kid);

  /* 대사가 끝났거나, 녹음이 아예 없거나 못 불러왔거나 —
     어느 쪽이든 아이에게 차례를 넘겨도 되는 상태다 (대사는 글로 남는다) */
  const npcDone = !line.audio || spokenLine === lineText || failedLine === lineText;

  /* ── 아이 목소리 받기 ─────────────────────────────────────────── */

  const recordingRef = useRef<Recording | null>(null);

  useEffect(() => {
    return () => recordingRef.current?.dispose();
  }, []);

  const remember = useCallback(
    (quote: string) => {
      if (friend) setHelped((list) => [...list, { id: friend.id, quote }]);
      setChildTurn("idle");
      setPhase("result");
    },
    [friend],
  );

  const handleRecorded = useCallback(
    async (audio: Blob, channelCount: number) => {
      setChildTurn("thinking");
      try {
        const text = await transcribeAudio(audio, channelCount);
        /* 한마디만 하고 말면 며느리가 한 번만 되묻는다 (시안 08).
           두 번째까지 짧으면 그대로 넘어간다 — 아이를 붙잡아 두지 않는다. */
        if (text.length < SHORT_ANSWER_CHARS && !reasked) {
          setReasked(true);
          setChildTurn("idle");
          setPhase("again");
          return;
        }
        remember(text);
      } catch {
        setMicError("목소리를 알아듣지 못했어요.");
        setChildTurn("failed");
      }
    },
    [reasked, remember],
  );

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

  const micActive = phase === "ask" || phase === "again";
  const micReady = micActive && npcDone && childTurn === "idle";
  const micState: MicState = micReady
    ? "ready"
    : micActive && (childTurn === "listening" || childTurn === "thinking")
      ? childTurn
      : "off";

  const micLabel =
    childTurn === "listening"
      ? "듣고 있어요"
      : childTurn === "thinking"
        ? "듣고 생각하는 중"
        : phase === "pick"
          ? "친구를 눌러줘"
          : phase === "again"
            ? "한 번 더 이야기해줘"
            : "말할 준비가 됐어요";

  const toggleMic = () => {
    if (childTurn === "listening") recordingRef.current?.stop();
    else if (micReady) setChildTurn("listening");
  };

  /* 다른 친구를 마저 돕는다 — 넷 다 도왔으면 더 고를 카드가 없어 바로 마무리 */
  const helpMore = () => {
    setFriend(null);
    setReasked(false);
    setMicError("");
    setPhase(helped.length >= FRIENDS.length ? "done" : "pick");
  };

  const choices: PanelChoice[] | undefined =
    childTurn === "failed"
      ? [
          {
            label: "다음으로",
            primary: true,
            onClick: () => {
              setMicError("");
              remember("");
            },
          },
        ]
      : phase === "result"
        ? [
            { label: "다른 친구도 도와줄래요", primary: true, onClick: helpMore },
            { label: "이제 괜찮아요", onClick: () => setPhase("done") },
          ]
        : phase === "done"
          ? [{ label: "다음으로", primary: true, onClick: onComplete }]
          : undefined;

  const pose =
    phase === "pick"
      ? helped.length === 0
        ? POSE.point
        : POSE.point2
      : phase === "ask"
        ? childTurn === "listening" || childTurn === "thinking"
          ? POSE.think
          : POSE.listen
        : phase === "again"
          ? POSE.worry
          : phase === "result"
            ? POSE.smile
            : POSE.joy;

  const expanded = phase === "ask" || phase === "again" || phase === "result";
  const quote = friend ? (helped.find((h) => h.id === friend.id)?.quote ?? "") : "";

  return (
    <MissionCanvas width={CANVAS.w} height={CANVAS.h} className="rounded-3xl bg-[#f8f1e4]">
      <>
        <Image
          src={SCENE.background}
          alt=""
          fill
          sizes="1366px"
          loading="eager"
          className="object-cover"
        />

        {/* 카드가 커지면 배경을 눌러 카드에 눈이 가게 한다 (시안 블러오버레이) */}
        <div
          className={`absolute inset-0 backdrop-blur-[4px] transition-opacity duration-500 ${
            phase === "pick" ? "opacity-0" : "opacity-100"
          } bg-black/30`}
        />

        <button
          type="button"
          onClick={onQuit}
          aria-label="미션 그만두기"
          className="absolute top-[32px] left-[32px] flex size-16 items-center justify-center rounded-full bg-white/90 text-[28px] font-bold text-[#4d4d4d]"
        >
          {"<"}
        </button>

        {/* 며느리 — 단계마다 포즈와 자리가 바뀐다 */}
        <div
          className="absolute"
          style={{ left: pose.left, top: pose.top, width: pose.width, height: pose.height }}
        >
          <Image
            src={pose.src}
            alt=""
            fill
            sizes="450px"
            loading="eager"
            className={`object-contain ${"flip" in pose && pose.flip ? "-scale-x-100" : ""}`}
          />
        </div>

        {/* 친구 고르기 (시안 01·06) */}
        {phase === "pick" && (
          <div className="absolute top-[calc(50%-57px)] left-[321px] flex w-[984px] -translate-y-1/2 flex-col items-center gap-[60px] px-px">
            <p className="w-full text-center text-[36px] font-extrabold text-white [text-shadow:0_2px_20px_#000]">
              {GUIDE_TEXT}
            </p>
            <div className="flex w-full items-center gap-3 px-[13px] py-[9px]">
              {FRIENDS.map((item) => (
                <FriendCard
                  key={item.id}
                  friend={item}
                  done={helped.some((h) => h.id === item.id)}
                  onPick={() => {
                    setFriend(item);
                    setPhase("ask");
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* 고른 친구 카드 확대 (시안 02·08 은 그대로, 05 는 결과 모습) */}
        {expanded && friend && (
          <FriendPanel
            friend={friend}
            result={phase === "result"}
            quote={quote}
            resultLabel={fillChildName(RESULT_LABEL, kid)}
          />
        )}

        {line.audio && (
          <audio
            key={`${line.audio}|${replayCount}`}
            src={line.audio}
            autoPlay
            onEnded={() => setSpokenLine(lineText)}
            onError={() => setFailedLine(lineText)}
          />
        )}

        <Mission2Panel
          line={lineText}
          /* 재생 중에는 겹쳐 들리지 않게 잠가 둔다 */
          onReplay={line.audio && npcDone ? () => setReplayCount((n) => n + 1) : undefined}
          mic={choices ? undefined : { state: micState, label: micLabel, onToggle: toggleMic }}
          choices={choices}
          hint={childTurn === "failed" ? micError : undefined}
        />
      </>
    </MissionCanvas>
  );
}

/** 친구 카드 한 장 (시안 01·06) — 이미 도운 친구는 흐려지고 ✓ 가 붙는다 */
function FriendCard({
  friend,
  done,
  onPick,
}: {
  friend: Friend;
  done: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      disabled={done}
      aria-label={`${friend.name} 도와주기`}
      className={`relative shrink-0 overflow-hidden rounded-[32px] border-[3.06px] border-[#fafafa] bg-[#fafafa] drop-shadow-[0_4.08px_6.12px_rgba(0,0,0,0.18)] transition-opacity ${
        done ? "opacity-50" : "opacity-[0.92]"
      }`}
      style={{ width: CARD.w, height: CARD.h }}
    >
      <div className="flex h-full flex-col items-center justify-end">
        <div
          className="relative mb-[-20.4px]"
          style={{ width: CARD.art.w, height: CARD.art.h }}
        >
          <Image
            src={friend.image}
            alt=""
            fill
            sizes="184px"
            loading="eager"
            className="object-contain"
          />
        </div>
        <div className="flex h-[72.42px] w-full items-center justify-center">
          <span className="text-[17px] text-[#332e29]">{friend.name}</span>
        </div>
      </div>
      {done && (
        <span className="absolute top-[9.18px] left-[165.24px] flex size-[48.96px] items-center justify-center rounded-full bg-[#5cad6b] text-[22px] text-[#fafafa]">
          ✓
        </span>
      )}
    </button>
  );
}

/**
 * 고른 친구 카드를 크게 편 패널 (시안 확대패널_카드, 720×405).
 * 아이가 이야기하고 나면 고민에 줄이 그어지고, 아이 말이 그 아래에 남는다.
 */
function FriendPanel({
  friend,
  result,
  quote,
  resultLabel,
}: {
  friend: Friend;
  /** 아이가 이야기를 끝낸 뒤의 모습인가 (시안 04·05) */
  result: boolean;
  /** 아이가 한 말 — 목소리를 못 받았으면 빈 문자열이라 상자를 접는다 */
  quote: string;
  resultLabel: string;
}) {
  return (
    <div className="absolute top-[241px] left-[452px] h-[405px] w-[720px] rounded-[24px] bg-[#fcf8f0] drop-shadow-[0_8px_12px_rgba(0,0,0,0.25)]">
      <div
        className={`absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center ${
          result ? "gap-10" : ""
        }`}
      >
        {result ? (
          <div className="flex w-[370px] flex-col items-center justify-center gap-[14px] text-center">
            <p className="w-full text-[24px] font-extrabold text-[#6b6459]">{friend.name}</p>
            <p className="w-full text-[16px] leading-[1.55] font-bold text-[#9a9287] line-through">
              {friend.trouble}
            </p>
            <p className="w-full text-[26px] font-extrabold text-[#4165c1]">↓</p>
            {quote && (
              <div className="flex w-[326px] flex-col gap-2 rounded-[18px] bg-[#e6f2fb] px-[22px] pt-[18px] pb-5">
                <p className="w-full text-[16px] font-bold text-[#7f9be1]">{resultLabel}</p>
                <p className="w-full text-[20px] leading-[29px] font-extrabold text-[#4165c1]">
                  “{quote}”
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex w-[370px] flex-col gap-[18px] text-center">
            <p className="w-full text-[32px] font-extrabold text-[#332e29]">{friend.name}</p>
            <p className="w-full text-[21px] leading-[1.55] font-bold text-[#6b6359]">
              {friend.trouble}
            </p>
          </div>
        )}

        <div className="relative h-[360px] w-[270px] shrink-0 overflow-hidden rounded-[16px]">
          <Image
            src={friend.image}
            alt=""
            fill
            sizes="270px"
            loading="eager"
            className="object-cover"
          />
          {result && (
            <span className="absolute top-[14px] left-[204px] flex size-[50px] items-center justify-center rounded-full bg-[#5cad6b] text-[22px] font-extrabold text-white">
              ✓
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
