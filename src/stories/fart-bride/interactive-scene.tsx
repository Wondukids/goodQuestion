"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { STT_DEFAULTS, type InteractiveStep, type SpeechLine } from "./data";
import { fillChildName, vocative } from "./name";

/**
 * 인터랙티브 씬 하나: 질문(녹음 음성) → 아이 답변 녹음 → STT → TTS 반응
 * → [다시 말하기 순환 | 계속하기] → 정해진 답변(녹음 음성) → 다음 파트.
 *
 * STT-TTS 순환 구조가 아직 미정이라, 지금은 "다시 말하기" 버튼으로
 * 원하는 만큼 반복할 수 있게만 해 뒀다 (기능 테스트용).
 */

type Phase =
  | "question" // 질문 음성 재생 중
  | "listening" // 마이크 녹음 중
  | "transcribing" // STT 호출 중
  | "responding" // TTS 반응 재생 중
  | "choice" // 다시 말하기 / 계속하기
  | "answer" // 정해진 답변 재생 중
  | "error";

/* LLM 연결 지점 — 순환 구조가 정해지면 여기를 LLM 호출로 바꾼다.
   지금은 화자별 말투로 아이 답변을 되받아 주는 고정 문구다. */
const REACTIONS: Record<string, (transcript: string) => string> = {
  /* 며느리 — 다정하고 조심스러운 말투 */
  Leda: (t) =>
    `"${t}"라고 말해 줬구나. 네 생각을 들으니 마음이 한결 가벼워졌어. 정말 고마워!`,
  /* 시아버지 — 근엄한 하게체 */
  Schedar: (t) =>
    `"${t}"라... 흠, 그렇게 생각하느냐. 네 이야기를 들으니 나도 생각이 많아지는구나.`,
  /* 이장님 — 너털웃음 섞인 하오체 */
  Sadachbia: (t) => `"${t}"라고 했구나? 허허, 그것 참 기특한 생각이구려!`,
};

function buildReaction(transcript: string, voice: string) {
  const build = REACTIONS[voice];
  if (build) return build(transcript);
  return `"${transcript}"라고 말해 주었구나! 이야기해 줘서 정말 고마워.`;
}

export function InteractiveScene({
  step,
  childName,
  onComplete,
}: {
  step: InteractiveStep;
  /** 선택된 아이 이름 — 있으면 질문할 때 이름을 부른다 */
  childName: string | null;
  onComplete: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("question");
  const [lineIndex, setLineIndex] = useState(0);
  const [transcript, setTranscript] = useState("");
  const [responseUrl, setResponseUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [remainingSec, setRemainingSec] = useState(STT_DEFAULTS.maxListenSec);

  /* 이름이 들어간 대사 준비 — 채워지기 전에는 음성을 재생하지 않는다.
     이름이 없으면 원본 녹음을 그대로 쓴다. */
  const [preparedLines, setPreparedLines] = useState<{
    question: SpeechLine[];
    answer: SpeechLine[];
  } | null>(
    childName ? null : { question: step.question.lines, answer: step.answer.lines },
  );

  /* "ㅇㅇ" 자리 표시자가 있는 대사는 이름을 넣어 캐릭터 목소리로 TTS 하고,
     질문에 자리 표시자가 없으면 짧은 호명("지훈아!")을 앞에 붙인다.
     TTS 실패 시 원본 녹음으로 폴백 — 이름만 못 부를 뿐 진행은 된다. */
  useEffect(() => {
    if (!childName) return;
    let cancelled = false;
    const blobUrls: string[] = [];

    const tts = async (text: string) => {
      const res = await fetch("/api/fart-bride/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voice: step.speaker.voice,
          stylePrompt: step.speaker.stylePrompt,
        }),
      });
      if (!res.ok) throw new Error(`TTS 실패 (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      blobUrls.push(url);
      return url;
    };

    const substitute = (lines: SpeechLine[]) =>
      Promise.all(
        lines.map(async (line) => {
          if (!line.text.includes("ㅇㅇ")) return line;
          const text = fillChildName(line.text, childName);
          return { text, audio: await tts(text) };
        }),
      );

    (async () => {
      try {
        const greetingText = `${childName}${vocative(childName)}!`;
        const needsGreeting = !step.question.lines.some((line) =>
          line.text.includes("ㅇㅇ"),
        );
        const [greetingAudio, question, answer] = await Promise.all([
          needsGreeting ? tts(greetingText) : Promise.resolve(null),
          substitute(step.question.lines),
          substitute(step.answer.lines),
        ]);
        if (cancelled) return;
        setPreparedLines({
          question: greetingAudio
            ? [{ text: greetingText, audio: greetingAudio }, ...question]
            : question,
          answer,
        });
      } catch {
        if (!cancelled) {
          setPreparedLines({
            question: step.question.lines,
            answer: step.answer.lines,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
      for (const url of blobUrls) URL.revokeObjectURL(url);
    };
  }, [childName, step]);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const retriesRef = useRef(0);

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  /* 언마운트 시 마이크·blob URL 정리 */
  useEffect(() => {
    return () => {
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      stopStream();
    };
  }, [stopStream]);
  useEffect(() => {
    return () => {
      if (responseUrl) URL.revokeObjectURL(responseUrl);
    };
  }, [responseUrl]);

  const fail = useCallback((message: string) => {
    setErrorMessage(message);
    setPhase("error");
  }, []);

  const sendToStt = useCallback(
    async (blob: Blob, channelCount: number) => {
      setPhase("transcribing");
      try {
        const res = await fetch("/api/fart-bride/stt", {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Audio-Channels": String(channelCount),
          },
          body: blob,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `STT 실패 (${res.status})`);

        const text: string = (data.transcript ?? "").trim();
        if (!text) {
          /* 무음 — sttDefaults 대로 1회 재시도 후 그냥 진행 */
          if (retriesRef.current < STT_DEFAULTS.retryCount) {
            retriesRef.current += 1;
            setPhase("listening");
          } else {
            setLineIndex(0);
            setPhase("answer");
          }
          return;
        }

        setTranscript(text);

        /* TTS 반응 생성 */
        const ttsRes = await fetch("/api/fart-bride/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: buildReaction(text, step.speaker.voice),
            voice: step.speaker.voice,
            stylePrompt: step.speaker.stylePrompt,
          }),
        });
        if (!ttsRes.ok) {
          const detail = await ttsRes.json().catch(() => null);
          throw new Error(detail?.error ?? `TTS 실패 (${ttsRes.status})`);
        }
        const url = URL.createObjectURL(await ttsRes.blob());
        setResponseUrl(url);
        setPhase("responding");
      } catch (error) {
        fail(error instanceof Error ? error.message : "음성 처리에 실패했습니다.");
      }
    },
    [fail, step.speaker.voice],
  );

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  /* listening 진입 시 녹음 시작 + 최대 청취 시간 카운트다운 */
  useEffect(() => {
    if (phase !== "listening") return;

    let cancelled = false;
    setRemainingSec(STT_DEFAULTS.maxListenSec);

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;

        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm";
        const recorder = new MediaRecorder(stream, { mimeType });
        recorderRef.current = recorder;
        chunksRef.current = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunksRef.current.push(event.data);
        };
        const channelCount =
          stream.getAudioTracks()[0]?.getSettings().channelCount ?? 1;
        recorder.onstop = () => {
          stopStream();
          sendToStt(new Blob(chunksRef.current, { type: mimeType }), channelCount);
        };
        recorder.start();
      } catch {
        fail("마이크를 사용할 수 없습니다. 브라우저의 마이크 권한을 확인해 주세요.");
      }
    })();

    const interval = setInterval(() => {
      setRemainingSec((sec) => {
        if (sec <= 1) {
          stopRecording();
          return 0;
        }
        return sec - 1;
      });
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [phase, fail, sendToStt, stopRecording, stopStream]);

  const isQuestion = phase !== "answer";
  const stage = isQuestion ? step.question : step.answer;
  const activeLines = preparedLines
    ? isQuestion
      ? preparedLines.question
      : preparedLines.answer
    : null;
  const playingLines = phase === "question" || phase === "answer";
  const currentLine = playingLines && activeLines ? activeLines[lineIndex] : null;

  function handleLineEnded() {
    if (activeLines && lineIndex + 1 < activeLines.length) {
      setLineIndex(lineIndex + 1);
      return;
    }
    if (phase === "question") {
      setLineIndex(0);
      setPhase("listening");
    } else {
      onComplete();
    }
  }

  return (
    <div className="relative h-full w-full">
      <Image
        src={stage.image}
        alt=""
        fill
        sizes="100vw"
        priority
        className="object-cover"
      />

      {currentLine && (
        <audio key={`${phase}-${lineIndex}`} src={currentLine.audio} autoPlay onEnded={handleLineEnded} />
      )}
      {phase === "responding" && responseUrl && (
        <audio src={responseUrl} autoPlay onEnded={() => setPhase("choice")} />
      )}

      {/* 하단 대사·상태 바 */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 bg-gradient-to-t from-black/70 to-transparent px-10 pt-16 pb-8">
        {currentLine && (
          <p className="max-w-[900px] rounded-2xl bg-black/55 px-6 py-4 text-center text-[22px] font-bold leading-[1.5] text-white">
            <span className="mr-2 text-[18px] text-amber-300">{step.speaker.label}</span>
            {currentLine.text}
          </p>
        )}

        {phase === "listening" && (
          <div className="flex flex-col items-center gap-3">
            <p className="flex items-center gap-2 text-[22px] font-bold text-white">
              <span className="inline-block size-3 animate-pulse rounded-full bg-red-500" />
              듣고 있어요… ({remainingSec}초)
            </p>
            {retriesRef.current > 0 && (
              <p className="text-[16px] font-bold text-amber-200">
                잘 안 들렸어요. 한 번 더 크게 말해 볼까?
              </p>
            )}
            <button
              type="button"
              onClick={stopRecording}
              className="rounded-xl bg-primary px-8 py-3 text-[18px] font-extrabold text-white"
            >
              다 말했어요
            </button>
          </div>
        )}

        {phase === "transcribing" && (
          <p className="text-[22px] font-bold text-white">듣고 생각하는 중…</p>
        )}

        {phase === "responding" && (
          <p className="max-w-[900px] rounded-2xl bg-black/55 px-6 py-4 text-center text-[20px] font-bold text-white">
            내 답변: “{transcript}”
          </p>
        )}

        {phase === "choice" && (
          <div className="flex flex-col items-center gap-3">
            <p className="max-w-[900px] rounded-2xl bg-black/55 px-6 py-3 text-center text-[18px] font-bold text-white">
              “{transcript}”
            </p>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setPhase("listening")}
                className="rounded-xl bg-white/90 px-8 py-3 text-[18px] font-extrabold text-ink"
              >
                다시 말하기
              </button>
              <button
                type="button"
                onClick={() => {
                  setLineIndex(0);
                  setPhase("answer");
                }}
                className="rounded-xl bg-primary px-8 py-3 text-[18px] font-extrabold text-white"
              >
                계속하기
              </button>
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="flex flex-col items-center gap-3">
            <p className="max-w-[900px] rounded-2xl bg-red-900/80 px-6 py-3 text-center text-[17px] font-bold text-white">
              {errorMessage}
            </p>
            <div className="flex gap-4">
              <button
                type="button"
                onClick={() => setPhase("listening")}
                className="rounded-xl bg-white/90 px-8 py-3 text-[18px] font-extrabold text-ink"
              >
                다시 시도
              </button>
              <button
                type="button"
                onClick={() => {
                  setLineIndex(0);
                  setPhase("answer");
                }}
                className="rounded-xl bg-primary px-8 py-3 text-[18px] font-extrabold text-white"
              >
                건너뛰고 계속
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
