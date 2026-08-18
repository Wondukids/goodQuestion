"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { startRecording, type Recording } from "@/stt/record";
import { fillChildName } from "../name";
import type { PostActivityWiring } from "../session-api";
import { MissionCanvas } from "./canvas";
import { resumeFrom, toScenes, toTrayOrder } from "./finale-config";
import {
  MAX_TELL_SEC,
  SCENE,
  TEXT,
  TRAY_TILT,
  type StoryScene,
} from "./finale-script";

/**
 * 마무리 — 이야기를 다 본 뒤의 「말하기 후 활동」.
 *
 * 미니게임 미션들과는 다른 활동이다 (시안 「마무리」 섹션 41:1481).
 * 두 단계가 한 팝업 안에서 이어진다:
 *   1 순서 맞추기   네 장면 카드를 이야기 순서대로 칸에 놓는다.
 *                   순서가 맞아야 다음으로 넘어간다.
 *   2 줄거리 말하기 맞춘 카드와 핵심 단어를 보면서 아이가 이야기를
 *                   처음부터 끝까지 들려주고, 그 목소리를 받아 적는다.
 *
 * 좌표·크기는 전부 시안 캔버스(1366×1024) 기준 값을 그대로 쓴다.
 *
 * ## 서버와 이어진 자리 넷 (이슈 #46 · `docs/말하기후활동_명세.md` 8절 ③)
 *
 * 1. **카드 제목·핵심 단어는 서버 `post_activity_config` 가 정본이다** (F1 · 수용 2).
 *    상수(`finale-script.ts`)는 서버가 안 열렸을 때의 비상용으로 남아 있고, 둘을 잇는
 *    자리는 `finale-config.ts` 하나다.
 * 2. **「다 놓았어요!」마다 `order` 를 부른다 — 답을 기다리지 않는다.** 순서 판정과
 *    「맞은 카드는 남기고 나머지만 트레이로」는 지금까지 하던 그대로 화면이 한다.
 *    아이 화면이 네트워크를 기다리면 안 된다.
 * 3. **받아쓰기는 이제 앱이 안 한다** (F6). 녹음을 통째로 `retelling` 에 보내면 서버가
 *    받아쓰고 단어를 판정한다. 🔴 판정 실패(`analyzed: false`)는 **오류가 아니다** —
 *    아이 말은 이미 저장됐고 화면은 끝까지 진행된다 (F4·F8 · 수용 10).
 * 4. **「마치기」가 보호자 리포트를 띄우는 신호다** (F11). 실패해도 팝업은 닫힌다.
 *
 * ⛔ 문구·색·좌표는 하나도 바꾸지 않았다. 「/ 4장」처럼 카드 수가 박혀 있던 자리만
 *    서버 값에서 세도록 옮겼다 — 카드 넉 장이면 글자가 똑같다.
 */

const CANVAS = { w: 1366, h: 1024 };

/** 카드 한 장 (시안 01 트레이·슬롯 공통) */
const CARD = { w: 270, h: 210, art: 158 };

export function Finale({
  childName,
  postActivity,
  onComplete,
  onQuit,
}: {
  /** 선택된 아이 이름 — 녹음 중 안내에 쓴다 */
  childName: string | null;
  /** 후활동 API 배선 — 카드의 정본과 호출 4벌 (명세 8절 ②). 미션 배선과는 남남이다 */
  postActivity: PostActivityWiring;
  onComplete: () => void;
  /** 오른쪽 위 닫기 */
  onQuit: () => void;
}) {
  /* 서버 config 가 정본, 없으면 화면 상수 — 가르는 자리는 finale-config.ts 하나다 */
  const scenes = useMemo(() => toScenes(postActivity.config), [postActivity.config]);
  const trayOrder = useMemo(
    () => toTrayOrder(postActivity.config, scenes),
    [postActivity.config, scenes],
  );
  /* 중간에 나갔다 돌아온 자리 — 팝업이 열릴 때 한 번만 본다 (명세에 없는 판단) */
  const [resume] = useState(() => resumeFrom(postActivity.result));

  const [step, setStep] = useState<"order" | "tell">(resume.step);
  /* 칸마다 놓인 카드 id (아직 비었으면 null) — 칸 수는 서버 카드 수를 따른다 */
  const [slots, setSlots] = useState<(string | null)[]>(() => scenes.map(() => null));
  /* 트레이에서 눌러 든 카드 — 칸을 누르면 거기 놓인다 */
  const [held, setHeld] = useState<string | null>(null);
  /* 틀렸을 때 안내를 나눠 준다 — 하나도 못 맞혔으면 문구가 달라진다 */
  const [wrong, setWrong] = useState<"none" | "some" | null>(null);

  const byId = (id: string) => scenes.find((s) => s.id === id);
  const tray = trayOrder.filter((id) => !slots.includes(id));
  const placed = slots.filter(Boolean).length;
  const total = scenes.length;

  const place = (index: number, id: string) => {
    setWrong(null);
    setHeld(null);
    setSlots((current) => {
      const next = [...current];
      /* 다른 칸에 있던 카드를 옮기는 경우 원래 자리를 비운다 */
      const from = next.indexOf(id);
      if (from >= 0) next[from] = null;
      /* 이미 차 있던 칸이면 그 카드는 트레이로 돌아간다 */
      next[index] = id;
      return next;
    });
  };

  const takeBack = (index: number) => {
    setWrong(null);
    setSlots((current) => current.map((id, i) => (i === index ? null : id)));
  };

  /* 순서가 맞아야 다음 단계로 간다. 틀리면 자리가 맞는 카드는 그대로 두고
     나머지만 트레이로 돌려보낸다 — 처음부터 다시 놓게 하지 않는다. */
  const submitOrder = () => {
    /* 🔴 기록용 호출 — 답을 **기다리지 않는다** (명세 8절 ③). 아래 화면 판정이 정본이고,
       서버는 받은 순서를 스스로 다시 대조해 「첫 제출」과 횟수를 남긴다 (F7·F18).
       실패해도 아이는 모른다 — 활동을 멈출 이유가 없다. */
    const submitted = slots.filter((id): id is string => id !== null);
    if (submitted.length === total) {
      postActivity.api
        .submitPostActivityOrder(postActivity.sessionId, submitted)
        .catch((error: unknown) => {
          console.info("[후활동] 순서 기록 실패 — 활동은 그대로 진행한다", error);
        });
    }

    const right = slots.filter((id, i) => id === scenes[i].id).length;
    if (right === total) {
      setStep("tell");
      return;
    }
    setWrong(right === 0 ? "none" : "some");
    setSlots((current) => current.map((id, i) => (id === scenes[i].id ? id : null)));
  };

  return (
    <MissionCanvas design={CANVAS} className="rounded-3xl bg-story-bg">
      <>
        <Header step={step} onQuit={onQuit} />

        {step === "order" ? (
          <>
            {/* 안내 행 — 왼쪽 안내, 오른쪽 진행률 */}
            <div className="absolute top-[130px] left-[48px] flex w-[1235px] items-center justify-between">
              <div className="flex items-center gap-4">
                <GuideIcon />
                <p className="text-[24px] leading-[1.35] font-extrabold text-ink-strong">
                  {TEXT.orderGuide}
                </p>
              </div>
              <div className="flex flex-col items-end gap-[7px]">
                <p className="flex items-end gap-[5px] whitespace-nowrap">
                  <span className="text-[26px] leading-none text-primary-strong">
                    {placed}
                  </span>
                  <span className="text-[15px] leading-[1.5] font-extrabold text-[#8a8a8a]">
                    / {total}장 놓았어요
                  </span>
                </p>
                <div className="h-[10px] w-[200px] overflow-hidden rounded-full bg-surface-muted">
                  <div
                    className="h-full rounded-full bg-primary-strong transition-[width] duration-300"
                    style={{ width: placed === 0 ? 6 : (placed / total) * 200 }}
                  />
                </div>
              </div>
            </div>

            {/* 슬롯 넷 */}
            <div className="absolute top-[225px] left-1/2 flex h-[261px] w-[1270px] -translate-x-1/2 justify-center gap-10">
              {slots.map((id, index) => {
                const scene = id ? byId(id) : undefined;
                return (
                  <div key={index} className="flex h-full flex-col items-center gap-3">
                    <span className="flex size-10 items-center justify-center rounded-full bg-primary-strong text-[19px] font-bold text-[#fcfcfc]">
                      {index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => (held ? place(index, held) : scene && takeBack(index))}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        const dropped = event.dataTransfer.getData("text/plain");
                        if (dropped) place(index, dropped);
                      }}
                      aria-label={
                        scene ? `${index + 1}번 칸 — ${scene.title}, 눌러서 빼기` : `${index + 1}번 칸에 놓기`
                      }
                      className="block"
                      style={{ width: CARD.w, height: CARD.h }}
                    >
                      {scene ? (
                        <SceneCard scene={scene} />
                      ) : (
                        <span
                          className={`flex size-full flex-col items-center justify-center gap-4 rounded-[18px] border-2 border-primary-line bg-primary-pale/50 ${
                            held ? "border-primary-strong bg-primary-pale" : ""
                          }`}
                        >
                          <Image src={SCENE.tap} alt="" width={30} height={30} className="size-[30px]" />
                          <span className="text-[15px] font-extrabold text-primary-line">
                            {TEXT.slotEmpty}
                          </span>
                        </span>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* 남은 카드 트레이 */}
            <div className="absolute top-[522px] left-[48px] flex h-[313px] w-[1270px] flex-col items-center gap-5 rounded-3xl bg-surface-muted px-10 pt-5 pb-10">
              <div className="flex h-[26px] w-full items-center gap-3 whitespace-nowrap">
                <p className="text-[16px] font-extrabold text-[#575757]">
                  남은 카드 {tray.length}장
                </p>
                <p className="text-[14px] font-extrabold text-[#8a8a8a]">{TEXT.trayHint}</p>
              </div>
              {/* 시안은 네 장이 꽉 차 justify-between 이지만, 카드가 빠질수록
                  양끝으로 벌어져 보여 간격을 그때의 값(36px)으로 고정한다 */}
              <div className="flex w-full items-start gap-9">
                {tray.map((id, index) => {
                  const scene = byId(id);
                  if (!scene) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      draggable
                      onDragStart={(event) => event.dataTransfer.setData("text/plain", id)}
                      onClick={() => setHeld((current) => (current === id ? null : id))}
                      aria-label={`${scene.title} 카드 집기`}
                      className={`transition-transform ${
                        held === id ? "-translate-y-2 scale-[1.03]" : ""
                      }`}
                      style={{ rotate: `${TRAY_TILT[index] ?? 0}deg` }}
                    >
                      <SceneCard scene={scene} handle picked={held === id} />
                    </button>
                  );
                })}
                {/* 카드가 빠져도 트레이 높이가 흔들리지 않게 자리를 채운다 */}
                {tray.length === 0 && <div style={{ height: CARD.h }} />}
              </div>
            </div>

            {/* 하단 안내 바 */}
            <div className="absolute top-[861px] left-[48px] flex w-[1270px] items-center justify-between rounded-2xl bg-[#fff0eb] px-6 py-3">
              <p className="text-[16px] font-extrabold text-brand-900">
                {wrong === "none"
                  ? TEXT.orderWrongNone
                  : wrong === "some"
                    ? TEXT.orderWrong
                    : TEXT.orderHint}
              </p>
              <button
                type="button"
                onClick={submitOrder}
                disabled={placed < total}
                className={`flex h-[54px] w-[179px] items-center justify-center rounded-lg px-6 py-3 text-[20px] leading-[1.5] font-extrabold text-[#fcfcfc] ${
                  placed < total ? "bg-brand-900/40" : "bg-brand-900"
                }`}
              >
                {TEXT.orderSubmit}
              </button>
            </div>
          </>
        ) : (
          <TellStep
            childName={childName}
            scenes={scenes}
            postActivity={postActivity}
            savedRetelling={resume.retelling}
            onComplete={onComplete}
          />
        )}
      </>
    </MissionCanvas>
  );
}

/** 두 단계가 함께 쓰는 머리말 — 진행 단계를 함께 보여 준다 */
function Header({ step, onQuit }: { step: "order" | "tell"; onQuit: () => void }) {
  return (
    <div className="absolute top-0 left-0 flex h-[100px] w-[1366px] items-center justify-between overflow-hidden px-12 pt-[18px] pb-[10px]">
      <div className="flex items-center gap-3.5">
        <span className="rounded-full bg-[#3d3d3d] px-4 py-3.5 text-[14px] font-extrabold text-[#fcfcfc]">
          {TEXT.badge}
        </span>
        <p className="text-[28px] font-extrabold text-ink-strong">{TEXT.title}</p>
      </div>

      <div className="flex items-center gap-2">
        {TEXT.steps.map((label, index) => {
          const done = index === 0 || step === "tell";
          return (
            <div key={label} className="flex items-center gap-2">
              {index > 0 && (
                <Image
                  src={SCENE.chevron}
                  alt=""
                  width={16}
                  height={16}
                  className="size-4 opacity-30"
                />
              )}
              <div
                className={`flex items-center gap-2 rounded-full py-2 pr-4 pl-2.5 ${
                  done ? "bg-surface-muted" : ""
                }`}
              >
                <span
                  className={`flex size-6 items-center justify-center rounded-full font-jua text-[14px] ${
                    done
                      ? "bg-[#575757] text-[#fcfcfc]"
                      : "bg-surface-muted text-[#8a8a8a]"
                  }`}
                >
                  {index + 1}
                </span>
                <span
                  className={`text-[15px] font-extrabold ${
                    done ? "text-ink-strong" : "text-[#8a8a8a]"
                  }`}
                >
                  {label}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onQuit}
        aria-label="활동 닫기"
        className="flex size-12 items-center justify-center rounded-3xl border-2 border-surface-muted bg-story-bg"
      >
        <Image src={SCENE.close} alt="" width={22} height={22} className="size-[22px]" />
      </button>
    </div>
  );
}

/** 안내 문구 앞의 동그란 아이콘 (시안 안내 행) */
function GuideIcon() {
  return (
    <span className="flex size-16 shrink-0 items-center justify-center rounded-full bg-primary-pale">
      {/* 내려받은 머티리얼 심볼은 검정이라, 모양만 떼어 시안 색으로 칠한다 */}
      <span
        aria-hidden
        className="size-8 bg-primary-strong"
        style={{
          maskImage: `url(${SCENE.swap})`,
          WebkitMaskImage: `url(${SCENE.swap})`,
          maskSize: "contain",
          WebkitMaskSize: "contain",
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
        }}
      />
    </span>
  );
}

/** 장면 카드 — 트레이와 슬롯에서 같은 모습으로 쓴다 (시안 01) */
function SceneCard({
  scene,
  handle = false,
  picked = false,
}: {
  scene: StoryScene;
  /** 트레이에서는 왼쪽에 끌기 손잡이가 붙는다 */
  handle?: boolean;
  picked?: boolean;
}) {
  return (
    <span
      className={`flex flex-col overflow-hidden rounded-[18px] bg-story-bg shadow-[0px_5px_10.5px_0px_rgba(59,47,36,0.12)] ${
        picked ? "ring-2 ring-primary-strong" : ""
      }`}
      style={{ width: CARD.w, height: CARD.h }}
    >
      <span className="relative block w-full shrink-0" style={{ height: CARD.art }}>
        <Image src={scene.image} alt="" fill sizes="270px" loading="eager" className="object-cover" />
      </span>
      <span className="flex h-[51px] w-full items-center gap-2 px-3.5">
        {handle && (
          <Image src={SCENE.drag} alt="" width={16} height={16} className="size-4 opacity-45" />
        )}
        <span className="flex-1 text-left text-[18px] leading-[1.3] font-extrabold text-ink-strong">
          {scene.title}
        </span>
      </span>
    </span>
  );
}

/* 시안 2단계 파형 — 마이크 양옆에 여섯 줄씩 (오른쪽은 좌우 대칭) */
const WAVE = [26, 48, 70, 96, 60, 34];

/** 아이 목소리를 받는 단계에서의 상태 */
type TellPhase = "ready" | "recording" | "recorded" | "sending" | "done";

/** 2단계 — 맞춘 카드와 핵심 단어를 보며 줄거리를 들려준다 (시안 41:1571) */
function TellStep({
  childName,
  scenes,
  postActivity,
  savedRetelling,
  onComplete,
}: {
  childName: string | null;
  /** 순서대로 선 장면 — 서버 config 가 정본이다 (F1) */
  scenes: StoryScene[];
  postActivity: PostActivityWiring;
  /** 지난번에 이미 들려준 줄거리. 있으면 「다 말한 뒤」 자리에서 연다 */
  savedRetelling: string | null;
  onComplete: () => void;
}) {
  const [phase, setPhase] = useState<TellPhase>(savedRetelling === null ? "ready" : "done");
  const [seconds, setSeconds] = useState(0);
  const [retelling, setRetelling] = useState(savedRetelling ?? "");
  const [error, setError] = useState("");

  const recordingRef = useRef<Recording | null>(null);
  const clipRef = useRef<{ audio: Blob; channels: number } | null>(null);

  useEffect(() => {
    return () => recordingRef.current?.dispose();
  }, []);

  /* 녹음이 끝나면(직접 멈췄든 시간이 다 됐든) 소리만 들고 있다가 보내기에서 쓴다 */
  const handleRecorded = useCallback((audio: Blob, channels: number) => {
    clipRef.current = { audio, channels };
    setPhase("recorded");
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;

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
        setError("마이크를 쓸 수 없어요. 브라우저 마이크 권한을 확인해 주세요.");
        setPhase("ready");
      }
    })();

    const tick = setInterval(() => {
      setSeconds((s) => {
        /* 동기 STT 한도가 1분이라 넘기기 전에 알아서 멈춘다 */
        if (s + 1 >= MAX_TELL_SEC) recordingRef.current?.stop();
        return s + 1;
      });
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(tick);
    };
  }, [phase, handleRecorded]);

  /**
   * 녹음을 통째로 서버에 보낸다 (F6). 받아쓰기도 단어 판정도 서버가 한다 —
   * 앱은 이제 `transcribeAudio()` 를 부르지 않는다 (명세 8절 ③).
   *
   * 🔴 **판정 실패는 오류가 아니다.** `{ text, analyzed: false, keywords: null }` 이
   *    200 으로 오고, 그때도 아이 말은 이미 저장돼 있다. 화면은 그대로 끝까지 간다
   *    (F4·F8 · 수용 기준 10). 빨간 화면을 띄우지 않는다.
   */
  const send = async () => {
    const clip = clipRef.current;
    if (!clip) return;
    setPhase("sending");
    try {
      const result = await postActivity.api.submitPostActivityRetelling(
        postActivity.sessionId,
        clip.audio,
        clip.channels,
      );
      /* 무음이면 다시 말할 기회를 준다 — 빈 이야기를 담아 두지 않는다 (서버도 안 저장한다) */
      if (result.empty) {
        setError("목소리가 담기지 않았어요. 한 번 더 들려줄래?");
        setPhase("ready");
        return;
      }
      setRetelling(result.text);
      setPhase("done");
    } catch {
      /* 여기까지 오는 것은 받아쓰기 자체가 실패한 것뿐이다 (502 STT_FAILED — 재시도 가능) */
      setError("이야기를 담지 못했어요. 한 번 더 해볼까?");
      setPhase("recorded");
    }
  };

  /**
   * 「마치기」 — ⭐ **보호자 리포트를 띄우는 신호다** (F11 · 명세 5.D).
   *
   * 답을 기다리지 않고 팝업을 닫는다. 실패해도 아이를 붙잡지 않는다 (F4) — 그때는
   * 보호자가 리포트를 열 때 만들어진다 (F12).
   */
  const finish = () => {
    postActivity.api
      .completePostActivity(postActivity.sessionId, "finished")
      .catch((error: unknown) => {
        console.info("[후활동] 마치기 알림 실패 — 리포트는 보호자 열람 때 만들어진다", error);
      });
    onComplete();
  };

  const recording = phase === "recording";
  const status = error
    ? error
    : phase === "recording"
      ? fillChildName(TEXT.tellRecording, childName ?? "네")
      : phase === "recorded"
        ? TEXT.tellRecorded
        : phase === "sending"
          ? TEXT.tellSending
          : phase === "done"
            ? TEXT.tellDone
            : TEXT.tellReady;

  const finished = phase === "done";
  const submitLabel = finished ? TEXT.tellFinish : TEXT.tellSubmit;
  const submitActive = finished || phase === "recorded";

  return (
    <div className="absolute top-[calc(50%+37px)] left-1/2 flex w-[1270px] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-10">
      <div className="flex w-full items-center gap-4">
        <GuideIcon />
        <p className="text-[24px] leading-[1.35] font-extrabold text-ink-strong">
          {TEXT.tellGuide}
        </p>
      </div>

      {/* 맞춘 순서 그대로 — 장면마다 핵심 단어를 붙여 준다 */}
      <div className="flex w-full items-start gap-6">
        {scenes.map((scene, index) => (
          <div
            key={scene.id}
            className="flex flex-1 flex-col self-stretch overflow-hidden rounded-[18px] border border-[#bdbdbd] bg-story-bg"
          >
            <div className="relative h-[132px] w-full shrink-0">
              <Image src={scene.image} alt="" fill sizes="300px" loading="eager" className="object-cover" />
              <span className="absolute top-3.5 left-3.5 flex size-[38px] items-center justify-center rounded-full bg-primary text-[19px] font-bold text-[#fcfcfc]">
                {index + 1}
              </span>
            </div>
            <div className="flex flex-col gap-5 px-4 py-5">
              <p className="text-[18px] font-extrabold text-ink-strong">{scene.title}</p>
              <div className="flex flex-col gap-2.5">
                <p className="px-1.5 text-[13px] font-extrabold text-primary-strong">
                  {TEXT.keywordLabel}
                </p>
                <div className="flex flex-wrap gap-2">
                  {scene.keywords.map((word) => (
                    <span
                      key={word}
                      className={`rounded px-3.5 py-[9px] text-[16px] font-extrabold ${scene.chip}`}
                    >
                      {word}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 녹음 패널 */}
      <div className="flex h-[322px] w-full flex-col items-center justify-center gap-5 rounded-3xl border-2 border-primary-line bg-story-bg px-10 pt-[26px] pb-8 drop-shadow-[2px_4px_8px_rgba(82,82,82,0.08)]">
        <div className="flex w-full items-center gap-2.5">
          <span
            className={`size-3 rounded-full ${recording ? "animate-pulse bg-[#e05b5b]" : "bg-[#d6d6d6]"}`}
          />
          <p className="text-[19px] font-extrabold text-ink-strong">{status}</p>
          {(recording || phase === "recorded") && (
            <p className="font-gothic text-[19px] text-[#575757]">{formatClock(seconds)}</p>
          )}
        </div>

        {phase === "done" ? (
          /* 받아 적은 이야기 — 서버가 이미 저장했고 단어 판정까지 끝냈다 (명세 5.C) */
          <p className="flex h-[210px] w-full items-center justify-center overflow-y-auto px-8 text-center text-[20px] leading-[1.6] font-bold text-ink-strong">
            “{retelling}”
          </p>
        ) : (
          <div className="flex h-[210px] w-full items-center justify-center gap-[26px]">
            <Waveform bars={WAVE} active={recording} />
            <button
              type="button"
              onClick={() => {
                setError("");
                if (recording) {
                  recordingRef.current?.stop();
                } else if (phase !== "sending") {
                  setSeconds(0);
                  setPhase("recording");
                }
              }}
              disabled={phase === "sending"}
              aria-label={recording ? "다 말했어요" : "이야기 들려주기"}
              className="relative flex size-[104px] items-center justify-center rounded-full bg-primary-line"
            >
              <span className="flex size-20 items-center justify-center rounded-full bg-primary shadow-[0px_4px_10.5px_0px_rgba(111,188,221,0.4)]">
                <Image
                  src={SCENE.mic}
                  alt=""
                  width={25}
                  height={42}
                  className="h-[42px] w-[25px] brightness-0 invert"
                />
              </span>
            </button>
            <Waveform bars={[...WAVE].reverse()} active={recording} />
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={finished ? finish : send}
        disabled={!submitActive}
        className={`flex h-[61px] w-[300px] items-center justify-center rounded-lg px-6 py-3.5 text-[22px] leading-[1.5] font-extrabold text-[#fcfcfc] ${
          submitActive ? "bg-primary-strong" : "bg-primary-line"
        }`}
      >
        {submitLabel}
      </button>
    </div>
  );
}

/** 마이크 옆 파형 — 말하는 동안에만 움직인다 */
function Waveform({ bars, active }: { bars: number[]; active: boolean }) {
  return (
    <div className="flex h-[110px] items-center gap-[9px]">
      {bars.map((height, i) => (
        <span
          key={i}
          className={`w-[9px] rounded-full bg-primary-line ${active ? "voice-wave" : ""}`}
          style={{ height, animationDelay: `${i * 0.1}s` }}
        />
      ))}
    </div>
  );
}

/** 00:24 꼴로 */
function formatClock(seconds: number) {
  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}
