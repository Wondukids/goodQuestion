"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { SlideTransition } from "@/components/ui/slide-transition";
import { transcribeAudio } from "@/stt/client";
import { startRecording, type Recording } from "@/stt/record";
import { requestSpeech } from "@/tts/client";
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
  //const build = REACTIONS[voice];
  //if (build) return build(transcript);
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
  /* 채팅 패널에 보여 줄 TTS 반응 문구 — 재생되는 음성과 같은 내용 */
  const [reactionText, setReactionText] = useState("");
  /* "다시 듣기" — 마지막 질문 음성 재생. n 을 올려 누를 때마다 처음부터 튼다 */
  const [replay, setReplay] = useState<{ src: string; n: number } | null>(null);
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

    /* geminiOnly: 말투 지시를 무시하는 Chirp3-HD 로 조용히 떨어지지 않게
       gemini-2.5-flash-tts 로 고정한다. 실패하면 아래 catch 가 원본 녹음으로 폴백.
       목소리는 항상 이 씬의 화자(step.speaker.voice) — 호명도 캐릭터가 부른다. */
    const tts = async (text: string, stylePrompt = step.speaker.stylePrompt) => {
      const speech = await requestSpeech({
        text,
        voice: step.speaker.voice,
        stylePrompt,
        geminiOnly: true,
      });
      const url = URL.createObjectURL(speech);
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
        /* 이름만 부르는 한마디는 연기가 붕 뜨기 쉬워 호명 전용 지시를 덧붙인다 */
        const [greetingAudio, question, answer] = await Promise.all([
          needsGreeting
            ? tts(
                greetingText,
                `${step.speaker.stylePrompt} 지금은 아이에게 말을 걸려고 이름을 부르는 짧은 첫마디입니다 — 이름을 반갑고 다정하게, 자연스럽게 불러 주세요.`,
              )
            : Promise.resolve(null),
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

  const recordingRef = useRef<Recording | null>(null);
  const retriesRef = useRef(0);
  /* 채팅 패널 스크롤 — 말풍선이 늘어나면 맨 아래로 내린다 */
  const chatRef = useRef<HTMLDivElement | null>(null);

  /* 언마운트 시 마이크·blob URL 정리 */
  useEffect(() => {
    return () => {
      recordingRef.current?.dispose();
    };
  }, []);
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
        const text = await transcribeAudio(blob, channelCount);
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

        /* TTS 반응 생성 — 채팅 패널에도 같은 문구를 말풍선으로 보여 준다 */
        const reaction = buildReaction(text, step.speaker.voice);
        setReactionText(reaction);
        /* 반응도 gemini-2.5 고정 — 실패는 error 단계(다시 시도·건너뛰기)로 드러난다 */
        const speech = await requestSpeech({
          text: reaction,
          voice: step.speaker.voice,
          stylePrompt: step.speaker.stylePrompt,
          geminiOnly: true,
        });
        setResponseUrl(URL.createObjectURL(speech));
        setPhase("responding");
      } catch (error) {
        fail(error instanceof Error ? error.message : "음성 처리에 실패했습니다.");
      }
    },
    [fail, step.speaker.voice, step.speaker.stylePrompt],
  );

  const stopRecording = useCallback(() => {
    recordingRef.current?.stop();
  }, []);

  /* listening 진입 시 녹음 시작 + 최대 청취 시간 카운트다운 */
  useEffect(() => {
    if (phase !== "listening") return;

    let cancelled = false;
    setRemainingSec(STT_DEFAULTS.maxListenSec);

    (async () => {
      try {
        const recording = await startRecording(sendToStt);
        /* 녹음 준비 중에 씬을 떠났으면 결과 없이 바로 정리 */
        if (cancelled) {
          recording.dispose();
          return;
        }
        recordingRef.current = recording;
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
  }, [phase, fail, sendToStt, stopRecording]);

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

  /* 채팅 패널 말풍선 — 자막 대신 재생 진행에 맞춰 대화가 하나씩 쌓인다.
     캐릭터 질문 → (아이 답변 → TTS 반응) → 캐릭터 답변 순서다. */
  const bubbles: { from: "character" | "child"; text: string }[] = [];
  if (preparedLines) {
    const shownQuestions =
      phase === "question"
        ? preparedLines.question.slice(0, lineIndex + 1)
        : preparedLines.question;
    for (const l of shownQuestions)
      if (l.text) bubbles.push({ from: "character", text: l.text });
    const answered = phase === "responding" || phase === "choice" || phase === "answer";
    if (answered && transcript) bubbles.push({ from: "child", text: transcript });
    if (answered && reactionText) bubbles.push({ from: "character", text: reactionText });
    if (phase === "answer")
      for (const l of preparedLines.answer.slice(0, lineIndex + 1))
        if (l.text) bubbles.push({ from: "character", text: l.text });
  }
  const questionBubbleCount = preparedLines
    ? (phase === "question"
        ? preparedLines.question.slice(0, lineIndex + 1)
        : preparedLines.question
      ).filter((l) => l.text).length
    : 0;
  const lastQuestionAudio =
    preparedLines?.question[preparedLines.question.length - 1]?.audio ?? null;
  /* 다시 듣기는 아이 차례(듣는 중·선택)일 때만 — 질문 음성이 겹쳐 나오지 않게 */
  const canReplay = phase === "listening" || phase === "choice";

  const bubbleCount = bubbles.length;
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [bubbleCount]);

  return (
    <div className="relative h-full w-full">
      {/* 대화 씬은 책 넘김 없이 진입하는 흐름이라 배경도 은은한 페이드로만 바꾼다 */}
      <SlideTransition
        effect="fade"
        transitionKey={isQuestion ? "question" : "answer"}
        className="absolute inset-0"
      >
        {/* video-plan 기반 씬은 dev 에셋 라우트(한글 파일명·no-cache)에서 오므로
            최적화 프록시를 거치지 않는다 */}
        <Image
          src={stage.image}
          alt=""
          fill
          sizes="100vw"
          priority
          unoptimized
          className="object-cover"
        />
      </SlideTransition>

      {currentLine && (
        <audio key={`${phase}-${lineIndex}`} src={currentLine.audio} autoPlay onEnded={handleLineEnded} />
      )}
      {phase === "responding" && responseUrl && (
        <audio src={responseUrl} autoPlay onEnded={() => setPhase("choice")} />
      )}
      {replay && (
        <audio key={replay.n} src={replay.src} autoPlay onEnded={() => setReplay(null)} />
      )}

      {/* 오른쪽 채팅 패널 — 자막 대신 대화 내용을 말풍선으로 쌓는다 (시안 106) */}
      <aside className="absolute bottom-6 right-6 top-24 flex w-[440px] max-w-[45%] flex-col overflow-hidden rounded-3xl bg-white shadow-panel">
        <div className="flex items-center justify-between border-b border-divider px-6 py-4">
          <div className="flex flex-col">
            <span className="text-[18px] font-extrabold text-ink">{step.speaker.label}</span>
            <span className="text-[12px] font-bold text-ink-muted">오늘의 이야기 친구</span>
          </div>
          <Link
            href="/stories/fart-bride"
            className="rounded-full border border-divider px-4 py-1.5 text-[13px] font-bold text-ink-soft"
          >
            나가기
          </Link>
        </div>

        <div ref={chatRef} className="flex flex-1 flex-col gap-3 overflow-y-auto bg-chip/40 px-5 py-5">
          {bubbles.map((bubble, i) =>
            bubble.from === "character" ? (
              <div key={i} className="flex max-w-[85%] flex-col gap-1">
                <div className="flex items-start gap-2.5">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-primary-line bg-primary-pale text-[15px] font-extrabold text-primary-strong">
                    {step.speaker.label.slice(0, 1)}
                  </span>
                  <p className="rounded-2xl rounded-tl-md bg-white px-4 py-3 text-[16px] font-bold leading-[1.55] text-ink shadow-panel">
                    {bubble.text}
                  </p>
                </div>
                {canReplay && lastQuestionAudio && i === questionBubbleCount - 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setReplay((r) => ({ src: lastQuestionAudio, n: (r?.n ?? 0) + 1 }))
                    }
                    className="self-end text-[13px] font-bold text-ink-muted"
                  >
                    🔊 다시 듣기
                  </button>
                )}
              </div>
            ) : (
              <p
                key={i}
                className="max-w-[85%] self-end rounded-2xl rounded-tr-md bg-primary px-4 py-3 text-[16px] font-bold leading-[1.55] text-white"
              >
                {bubble.text}
              </p>
            ),
          )}
          {bubbles.length === 0 && (
            <p className="py-4 text-center text-[14px] font-bold text-ink-muted">
              이야기 친구가 말을 걸 준비를 하고 있어요…
            </p>
          )}
        </div>

        {/* 하단 상태 영역 — 단계별 안내와 마이크 */}
        <div className="flex flex-col items-center gap-2 border-t border-divider bg-white px-6 py-5">
          {phase === "question" && (
            <p className="text-[14px] font-bold text-ink-muted">이야기 친구가 말하고 있어요…</p>
          )}

          {phase === "listening" && (
            <>
              <p className="text-[18px] font-extrabold text-ink">네 차례야!</p>
              <p className="text-[13px] font-bold text-ink-muted">
                생각이 떠오르면 이야기하고, 다 말했으면 아래 마이크를 눌러줘
              </p>
              {retriesRef.current > 0 && (
                <p className="text-[13px] font-bold text-point-strong">
                  잘 안 들렸어요. 한 번 더 크게 말해 볼까?
                </p>
              )}
              <button
                type="button"
                onClick={stopRecording}
                aria-label="다 말했어요"
                className="mt-1 flex size-16 items-center justify-center rounded-full bg-primary text-white shadow-panel"
              >
                <MicIcon />
              </button>
              <p className="flex items-center gap-1.5 text-[13px] font-bold text-ink-muted">
                <span className="inline-block size-2 animate-pulse rounded-full bg-red-500" />
                듣고 있어요 · {remainingSec}초
              </p>
            </>
          )}

          {phase === "transcribing" && (
            <p className="text-[15px] font-bold text-ink">듣고 생각하는 중…</p>
          )}

          {phase === "responding" && (
            <p className="text-[14px] font-bold text-ink-muted">
              이야기 친구가 대답하고 있어요…
            </p>
          )}

          {phase === "choice" && (
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setPhase("listening")}
                className="rounded-xl bg-chip px-6 py-3 text-[16px] font-extrabold text-ink"
              >
                다시 말하기
              </button>
              <button
                type="button"
                onClick={() => {
                  setLineIndex(0);
                  setPhase("answer");
                }}
                className="rounded-xl bg-primary px-6 py-3 text-[16px] font-extrabold text-white"
              >
                계속하기
              </button>
            </div>
          )}

          {phase === "answer" && (
            <p className="text-[14px] font-bold text-ink-muted">이야기가 이어져요…</p>
          )}

          {phase === "error" && (
            <>
              <p className="text-center text-[14px] font-bold text-point-strong">
                {errorMessage}
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setPhase("listening")}
                  className="rounded-xl bg-chip px-6 py-3 text-[16px] font-extrabold text-ink"
                >
                  다시 시도
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLineIndex(0);
                    setPhase("answer");
                  }}
                  className="rounded-xl bg-primary px-6 py-3 text-[16px] font-extrabold text-white"
                >
                  건너뛰고 계속
                </button>
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

/** 마이크 아이콘 — 에셋 폴더에 없어 인라인 SVG 로 그린다 */
function MicIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-7"
      aria-hidden
    >
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <path d="M12 18v4" />
    </svg>
  );
}
