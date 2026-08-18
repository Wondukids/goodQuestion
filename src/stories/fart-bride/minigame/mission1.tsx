"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { startRecording, type Recording } from "@/stt/record";
import { STT_DEFAULTS } from "../data";
import type {
  MissionApi,
  MissionCompleteResult,
  MissionConfig,
  MissionTurnResult,
} from "../session-api";
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
 *   09 마무리    이장님 마지막 대사 — 음성이 끝나고 3초 뒤 저절로 닫힌다.
 *
 * 이장님 목소리는 두 갈래다: 고정 대사는 사전 녹음(mission1-script.ts 의 audio)을
 * 그대로 틀고, 서버가 만들어 주는 대사(아이대답요약처럼 녹음이 있을 수 없는 문장)는
 * TTS 로 합성한다. 서버 문구가 녹음과 같은 문장이면(공백·문장부호 차이 무시) 녹음이
 * 이긴다 — withRecording().
 *
 * 대사·판정은 미션 API(주입받은 missionApi — 명세 7절 계약)가 정한다 (이슈 #20):
 * 소품 선택은 events, 아이 발화는 turns(아이대답요약·되묻기 M9), 마지막 스텝 뒤
 * complete 를 병렬로 부르며 config.closing 을 재생한다. 호출이 죽으면 기존 로컬
 * 대본(mission1-script)으로 떨어진다 — 미션이 서버 때문에 멈추는 일은 없다.
 *
 * 정답을 가리지 않는다 — 어떤 소품을 골라도 그 소품이 빛나고 이야기가 이어진다.
 * 아이에게 묻는 건 "무엇이 맞느냐" 가 아니라 "왜 그렇게 생각했느냐" 라서다.
 *
 * 좌표·크기는 전부 시안 캔버스(1092×820) 기준 값을 그대로 쓴다.
 * 화면이 좁으면 캔버스째로 축소된다 (useFitScale).
 */

/* 시안 좌표계 — 아래 값들이 사는 자리다 */
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

/** 결론 음성이 끝나고 팝업이 닫히기까지의 틈 (ms) */
const FINISH_CLOSE_MS = 3000;

type Phase = "explore" | "inspect" | "reveal" | "talk" | "finish";

/** 화면에 뜨는 대사 한 줄 — audio 가 있으면 사전 녹음, 없으면 TTS 로 합성한다 */
type SpokenLine = { text: string; audio?: string };

/* 사전 녹음이 있는 고정 대사 전부 — 서버 문구와 대조할 목록 */
const RECORDED: SpokenLine[] = [LINES.explore, LINES.talk, LINES.finish, ...PROPS.map((p) => p.ask)];

/** 문장 대조용 — 공백과 문장부호 차이는 같은 문장으로 본다 ("되겠구려." = "되겠구려!") */
const norm = (s: string) => s.replace(/\s+/g, "").replace(/[.,!?…~'"“”]/g, "");

/** 서버(또는 폴백) 문구에 같은 문장의 녹음이 있으면 붙인다 */
function withRecording(raw: string): SpokenLine {
  const rec = RECORDED.find((r) => norm(r.text) === norm(raw));
  return rec ? { text: raw, audio: rec.audio } : { text: raw };
}

/**
 * 아이 쪽 차례. 이장님이 말하는 중인지는 따로 보지 않고
 * "지금 대사의 재생이 끝났는가"(spokenLine)로 판단한다.
 */
type ChildTurn = "idle" | "listening" | "thinking" | "heard" | "failed";

export function Mission1({
  sessionId,
  missionSessionId,
  config,
  missionApi,
  onComplete,
}: {
  sessionId: string;
  missionSessionId: string;
  /** 서버가 준 미션 정의 — 고정 대사의 정본 (명세 6절). 로컬 대본은 폴백 사본 */
  config: MissionConfig;
  /** 실구현 또는 목 — submitMissionEvent · submitMissionTurn · completeMission */
  missionApi: MissionApi;
  onComplete: (result: MissionCompleteResult | null) => void;
}) {
  const [phase, setPhase] = useState<Phase>("explore");
  /* inspect 에서는 설명을 열어 본 소품, 그 뒤로는 아이가 고른 소품 */
  const [prop, setProp] = useState<MissionProp | null>(null);
  /* 이장님 대사 한 줄 — 탐색·설명은 로컬 대본(사전 녹음), 그 뒤는 미션 API 응답이
     채운다. 요약+다음 질문처럼 두 마디가 이어질 때는 "\n" 으로 묶어 한 번에 합성·표시
     한다 (패널이 whitespace-pre-line 이라 줄로 갈라진다). */
  const [line, setLine] = useState<SpokenLine>(LINES.explore);
  /* 재생이 끝난 이장님 대사 — 지금 대사와 같아야 아이 차례가 된다.
     단계가 넘어가 대사가 바뀌면 저절로 어긋나므로 따로 되돌릴 필요가 없다. */
  const [spokenLine, setSpokenLine] = useState("");
  /* 녹음 파일을 못 불러온 대사 — spokenLine 과 같은 요령으로 지금 대사와 비교한다 */
  const [failedLine, setFailedLine] = useState("");
  const [childTurn, setChildTurn] = useState<ChildTurn>("idle");
  const [heard, setHeard] = useState("");
  const [micError, setMicError] = useState("");
  const [replayCount, setReplayCount] = useState(0);
  /* 미션 API 응답을 기다리는 중 — 그동안 마이크를 잠가 순서가 꼬이지 않게 한다 */
  const [waiting, setWaiting] = useState(false);
  const [finishing, setFinishing] = useState(false);

  /* 녹음이 없는 대사(서버 생성)만 TTS 로 합성한다 — 빈 문장이면 훅이 쉰다 */
  const voice = useNpcVoice(line.audio ? "" : line.text, CHIEF);

  /* 대사가 끝났거나, 녹음·합성이 실패해 기다릴 음성이 아예 없거나 —
     둘 다 아이에게 차례를 넘겨도 되는 상태다 (실패해도 대사는 글로 남는다) */
  const npcDone =
    spokenLine === line.text || failedLine === line.text || (!line.audio && voice.failed);

  /* 종료 요약(complete)은 마지막 대사를 재생하는 동안 병렬로 돈다 (명세 7절 D).
     진행 중인 호출을 state 로 들고 있어 마무리 버튼이 결과를 기다린다. */
  const [completing, setCompleting] =
    useState<Promise<MissionCompleteResult | null> | null>(null);
  const startComplete = useCallback(() => {
    const pending = missionApi
      .completeMission(sessionId, missionSessionId)
      .catch((error: unknown) => {
        console.warn("[미션1] complete 실패 — 서버 결과 없이 마친다", error);
        return null;
      });
    setCompleting(pending);
    return pending;
  }, [missionApi, sessionId, missionSessionId]);

  /* 로컬 폴백 진행 — 미션 API 가 죽었을 때만. 문구는 기존 대본 그대로다 */
  const advance = useCallback(() => {
    setHeard("");
    setMicError("");
    setChildTurn("idle");
    if (phase === "reveal") {
      setLine(LINES.talk);
      setPhase("talk");
    } else {
      setLine(LINES.finish);
      setPhase("finish");
    }
  }, [phase]);

  /* 턴 응답 적용 — 알아들은 말을 잠깐 보여 준 뒤에 부른다 */
  const applyTurn = useCallback(
    (result: Exclude<MissionTurnResult, { empty: true }>) => {
      setHeard("");
      setMicError("");
      setChildTurn("idle");
      if (result.dialogue === null) {
        /* 되묻기(M9) — 같은 스텝, 같은 화면. 문구만 서버(config.reask)가 준다 */
        setLine({
          text:
            result.next.fixed_line?.text ??
            config.reask ??
            "조금만 더 자세히 말해 줄 수 있겠는가?",
        });
        return;
      }
      if (result.next.kind === "미션끝") {
        startComplete();
        /* 요약(서버 생성)이 섞인 문장이라 녹음이 있을 수 없다 — TTS 로 간다 */
        setLine({ text: `${result.dialogue.text}\n${config.closing}` });
        setPhase("finish");
        return;
      }
      /* 미션계속 — 요약 + 다음 스텝(부탁) 질문. MVP 스텝은 use→request 뿐이다 */
      setLine({
        text: `${result.dialogue.text}\n${result.next.fixed_line?.text ?? LINES.talk.text}`,
      });
      setPhase("talk");
    },
    [config, startComplete],
  );

  /* heard 연출이 끝나면 실행할 다음 손 — applyTurn 을 담아 둔다 */
  const afterHeardRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (childTurn !== "heard") return;
    const timer = setTimeout(() => {
      const run = afterHeardRef.current;
      afterHeardRef.current = null;
      if (run) run();
      else advance();
    }, HEARD_LINGER_MS);
    return () => clearTimeout(timer);
  }, [childTurn, advance]);

  /* ── 아이 목소리 받기 ─────────────────────────────────────────── */

  const recordingRef = useRef<Recording | null>(null);
  const retriesRef = useRef(0);

  useEffect(() => {
    return () => recordingRef.current?.dispose();
  }, []);

  /* 무음 재시도 소진 — 서버에 건너뜀을 알리고 다음 스텝 대사를 받는다 (명세 7절 B) */
  const skipStep = useCallback(async () => {
    setWaiting(true);
    try {
      const res = await missionApi.submitMissionEvent(sessionId, missionSessionId, {
        type: "skip",
      });
      setHeard("");
      setMicError("");
      setChildTurn("idle");
      if (res.done) {
        startComplete();
        setLine(withRecording(config.closing));
        setPhase("finish");
      } else {
        setLine(res.line ? withRecording(res.line.text) : LINES.talk);
        setPhase("talk");
      }
    } catch (error) {
      console.warn("[미션1] 건너뜀 알림 실패 — 로컬 대본으로 진행한다", error);
      advance();
    } finally {
      setWaiting(false);
    }
  }, [missionApi, sessionId, missionSessionId, config, startComplete, advance]);

  const handleRecorded = useCallback(
    async (audio: Blob, channelCount: number) => {
      setChildTurn("thinking");
      try {
        const result = await missionApi.submitMissionTurn(
          sessionId,
          missionSessionId,
          audio,
          channelCount,
        );
        if (result.empty) {
          /* 무음 — 한 번 더 기다려 보고, 그래도 조용하면 건너뜀으로 기록한다 */
          if (retriesRef.current < STT_DEFAULTS.retryCount) {
            retriesRef.current += 1;
            setChildTurn("listening");
          } else {
            retriesRef.current = 0;
            await skipStep();
          }
          return;
        }
        retriesRef.current = 0;
        setHeard(result.child.text);
        afterHeardRef.current = () => applyTurn(result);
        setChildTurn("heard");
      } catch (error) {
        console.warn("[미션1] 미션 턴 실패 — 로컬 대본 폴백", error);
        setMicError("목소리를 알아듣지 못했어요.");
        setChildTurn("failed");
      }
    },
    [missionApi, sessionId, missionSessionId, skipStep, applyTurn],
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

  /* ── 소품 선택 → 서버 알림 ───────────────────────────────────── */

  const pickProp = useCallback(
    async (picked: MissionProp) => {
      setPhase("reveal");
      setWaiting(true);
      try {
        const res = await missionApi.submitMissionEvent(sessionId, missionSessionId, {
          type: "prop_select",
          value: picked.id,
        });
        /* 서버가 {item} 을 채운 스텝 질문("소쿠리 말인가? …")을 돌려준다.
           같은 문장이면 이미 흐르는 소품별 녹음(picked.ask)을 끊지 않는다 (시안 02 = 06) */
        if (res.line && norm(res.line.text) !== norm(picked.ask.text)) {
          setLine(withRecording(res.line.text));
        }
      } catch (error) {
        /* line 은 picked.ask 그대로 — 소품별 녹음 질문이 이미 그 스텝의 질문이다 */
        console.warn("[미션1] 소품 선택 알림 실패 — 로컬 대본으로 진행한다", error);
      } finally {
        setWaiting(false);
      }
    },
    [missionApi, sessionId, missionSessionId],
  );

  /* ── 마무리 — 재생과 병렬로 돌던 complete 결과를 걷어 돌려준다 ── */

  const finish = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    /* 로컬 폴백으로 끝까지 왔으면 여기서라도 한 번 시도한다 (반복 안전 · 명세 7절 D) */
    onComplete(await (completing ?? startComplete()));
  }, [finishing, completing, startComplete, onComplete]);

  /* 결론 음성이 끝나고 3초 뒤 저절로 마무리한다 — "다음으로" 를 눌러도 같은 길이다 */
  useEffect(() => {
    if (phase !== "finish" || !npcDone) return;
    const timer = setTimeout(() => void finish(), FINISH_CLOSE_MS);
    return () => clearTimeout(timer);
  }, [phase, npcDone, finish]);

  /* ── 화면 상태 ───────────────────────────────────────────────── */

  /* 아이가 말할 차례가 있는 단계 — 탐색·마무리에서는 마이크가 놀고 있다 */
  const micActive = phase === "reveal" || phase === "talk";
  const micReady = micActive && npcDone && childTurn === "idle" && !waiting;
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
    <MissionCanvas design={CANVAS} className="rounded-3xl bg-story-bg">
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
            /* 무대가 1366 이라 그만큼 늘어나 뜬다 — 원본이 1092 라 더 큰 후보는
               없지만, 브라우저가 작은 후보를 고르지 않게 무대 폭을 적어 둔다 */
            sizes="1366px"
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
                      setLine(item.ask);
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
            onPick={() => pickProp(prop)}
          />
        )}

        {line.audio ? (
          <audio
            key={`${line.audio}|${replayCount}`}
            src={line.audio}
            autoPlay
            onEnded={() => setSpokenLine(line.text)}
            onError={() => setFailedLine(line.text)}
          />
        ) : voice.url ? (
          <audio
            key={`${line.text}|${replayCount}`}
            src={voice.url}
            autoPlay
            onEnded={() => setSpokenLine(line.text)}
          />
        ) : null}

        <DialoguePanel
          speaker={{ name: CHIEF.name, avatar: CHIEF.avatar }}
          line={line.text}
          /* 재생 중에는 겹쳐 들리지 않게 잠근다. 결론에서는 곧 닫히므로 아예 뺀다 */
          onReplay={
            phase !== "finish" && npcDone && (line.audio || voice.url)
              ? () => setReplayCount((n) => n + 1)
              : undefined
          }
          mic={phase === "finish" ? undefined : { state: micState, onToggle: toggleMic }}
          transcript={heard}
          hint={micError}
          next={
            phase === "finish"
              ? { label: finishing ? "정리하는 중…" : "다음으로", onClick: () => void finish() }
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
