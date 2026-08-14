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
import {
  resumeSessionTurn,
  SessionApiError,
  submitSessionTurn,
  type TurnNext,
  type TurnResult,
} from "./session-api";

/**
 * 인터랙티브 씬 하나 (이슈 #8 — `docs/이야기_세션_명세.md` 5절):
 * 질문(녹음 음성) → 아이 답변 녹음 → 턴 API(서버가 STT→분석→판단→대사) →
 * 캐릭터 대사 TTS 재생 → next.kind 분기(발화받기 → 다시 마이크 · 장면끝/회차끝 → 다음 스텝).
 *
 * 세션이 없거나(401·열기 실패) 이 씬에 서버 장면이 없으면(sceneCode 없음), 그리고
 * 턴 API 가 죽으면(502) **기존 고정 문구 흐름**으로 떨어진다 — 진행은 멈추지 않는다.
 */

type Phase =
  | "resume" // 복귀 진입 — 서버의 마지막 캐릭터 대사 재생 중 (결정 ⑦ 꼬리)
  | "question" // 질문 음성 재생 중
  | "listening" // 마이크 녹음 중
  | "transcribing" // 턴 처리 중 (서버 STT→분석→판단→대사, 폴백이면 STT 만)
  | "responding" // TTS 반응 재생 중
  | "choice" // 다시 말하기 / 계속하기 — 폴백·비서버 흐름에서만
  | "answer" // 정해진 답변 재생 중 — 폴백·비서버 흐름에서만
  | "error";

/* 고정 문구 폴백 — 세션이 없거나 턴 API 가 죽었을 때(502)만 쓴다 (이슈 #8).
   LLM 대사는 이제 서버 턴 API(POST /api/sessions/{id}/turns)가 만든다. */
function buildReaction(transcript: string) {
  return `"${transcript}"라고 말해 주었구나! 이야기해 줘서 정말 고마워.`;
}

/* 서버 턴이 죽으면 아이 발화 원문도 없다(STT 가 서버 안이다) — 발화 없이 되받는 폴백 문구 */
const FALLBACK_REACTION = "그렇구나, 이야기해 줘서 정말 고마워!";

export function InteractiveScene({
  step,
  childName,
  sessionId,
  resumeLine,
  onComplete,
}: {
  step: InteractiveStep;
  /** 선택된 아이 이름 — 있으면 질문할 때 이름을 부른다 */
  childName: string | null;
  /** 세션 열기(POST /api/sessions)의 id — null 이면 서버 없이 고정 문구 흐름 */
  sessionId: string | null;
  /** 복귀 진입이면 서버의 마지막 캐릭터 대사 — 여는 말 연출 대신 이 한 줄을 튼다 */
  resumeLine: string | null;
  onComplete: () => void;
}) {
  /* 서버 대화 모드 — 세션이 열려 있고 이 씬이 서버 장면에 매핑될 때만 (명세 3절 매핑) */
  const serverMode = sessionId !== null && step.sceneCode !== "";
  const resumeMode = serverMode && resumeLine !== null;

  const [phase, setPhase] = useState<Phase>(resumeMode ? "resume" : "question");
  const [lineIndex, setLineIndex] = useState(0);
  /* 채팅 패널 말풍선 이력 — 턴마다 아이 발화·캐릭터 대사가 쌓인다 (멀티턴) */
  const [history, setHistory] = useState<{ from: "character" | "child"; text: string }[]>([]);
  const [responseUrl, setResponseUrl] = useState<string | null>(null);
  /* 복귀 한 줄의 TTS — 준비되면 resume 단계에서 재생한다 */
  const [resumeUrl, setResumeUrl] = useState<string | null>(null);
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
  /* 방금 턴의 next — 대사 재생이 끝난 뒤 분기한다 (발화받기 / 장면끝 / 회차끝) */
  const nextRef = useRef<TurnNext | null>(null);
  /* 이번 응답이 폴백(고정 문구)이었나 — 폴백이면 기존 선택 버튼 흐름으로 간다 */
  const fallbackRef = useRef(false);
  /* 채팅 패널 스크롤 — 말풍선이 늘어나면 맨 아래로 내린다 */
  const chatRef = useRef<HTMLDivElement | null>(null);

  /* 복귀 한 줄 TTS 준비 — 실패해도 말풍선은 보이니 바로 아이 차례로 넘어간다 */
  useEffect(() => {
    if (!resumeMode || resumeLine === null) return;
    let cancelled = false;
    let url: string | null = null;
    (async () => {
      try {
        const speech = await requestSpeech({
          text: resumeLine,
          voice: step.speaker.voice,
          stylePrompt: step.speaker.stylePrompt,
          geminiOnly: true,
        });
        if (cancelled) return;
        url = URL.createObjectURL(speech);
        setResumeUrl(url);
      } catch {
        if (!cancelled) setPhase("listening");
      }
    })();
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [resumeMode, resumeLine, step]);

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

  /* 무음 — sttDefaults 대로 1회 재시도 후 그냥 진행 (서버 흐름도 같은 연출 — 명세 4.3절) */
  const handleSilence = useCallback(() => {
    if (retriesRef.current < STT_DEFAULTS.retryCount) {
      retriesRef.current += 1;
      setPhase("listening");
    } else {
      setLineIndex(0);
      setPhase("answer");
    }
  }, []);

  /* 캐릭터 반응 하나를 TTS 로 준비해 재생 단계로 — 서버 대사와 폴백 문구가 같이 쓴다.
     gemini-2.5 고정 — 실패는 error 단계(다시 시도·건너뛰기)로 드러난다 */
  const speakReaction = useCallback(
    async (text: string) => {
      const speech = await requestSpeech({
        text,
        voice: step.speaker.voice,
        stylePrompt: step.speaker.stylePrompt,
        geminiOnly: true,
      });
      setResponseUrl(URL.createObjectURL(speech));
      setPhase("responding");
    },
    [step.speaker.voice, step.speaker.stylePrompt],
  );

  const handleUtterance = useCallback(
    async (blob: Blob, channelCount: number) => {
      setPhase("transcribing");

      /* ── 비서버 흐름 (세션 없음·서버 장면 없음) — 기존 고정 문구 그대로 ── */
      if (!serverMode) {
        try {
          const text = await transcribeAudio(blob, channelCount);
          if (!text) return handleSilence();
          const reaction = buildReaction(text);
          fallbackRef.current = true;
          setHistory((h) => [
            ...h,
            { from: "child", text },
            { from: "character", text: reaction },
          ]);
          await speakReaction(reaction);
        } catch (error) {
          fail(error instanceof Error ? error.message : "음성 처리에 실패했습니다.");
        }
        return;
      }

      /* ── 서버 턴 — 녹음 하나로 STT→분석→판단→대사 (명세 4.3절) ── */
      try {
        const result: TurnResult = await submitSessionTurn(
          sessionId!,
          blob,
          channelCount,
        ).catch(async (error: unknown) => {
          /* 미완 턴(409 TURN_INCOMPLETE) — 걸려 있던 턴을 이어 돌려 그 결과를 쓴다 */
          if (error instanceof SessionApiError && error.code === "TURN_INCOMPLETE") {
            const resumed = await resumeSessionTurn(sessionId!);
            return {
              child: resumed.child,
              dialogue: resumed.dialogue,
              next: resumed.next,
            } satisfies TurnResult;
          }
          throw error;
        });

        if (result.empty) return handleSilence();

        nextRef.current = result.next;
        fallbackRef.current = false;
        retriesRef.current = 0;
        setHistory((h) => [
          ...h,
          { from: "child", text: result.child.text },
          { from: "character", text: result.dialogue.text },
        ]);
        await speakReaction(result.dialogue.text);
      } catch (error) {
        /* 폴백 (이슈 #8 — 502 등) — 서버가 죽어도 고정 문구로 진행은 멈추지 않는다 */
        try {
          fallbackRef.current = true;
          setHistory((h) => [...h, { from: "character", text: FALLBACK_REACTION }]);
          await speakReaction(FALLBACK_REACTION);
        } catch {
          fail(error instanceof Error ? error.message : "음성 처리에 실패했습니다.");
        }
      }
    },
    [serverMode, sessionId, handleSilence, speakReaction, fail],
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
        const recording = await startRecording(handleUtterance);
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
  }, [phase, fail, handleUtterance, stopRecording]);

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

  /* 채팅 패널 말풍선 — 여는 말(복귀 한 줄 또는 질문 연출) → 턴 이력 → 정해진 답변 순.
     턴 이력은 서버 대화의 멀티턴이 그대로 쌓인 것이다 (이슈 #8). */
  const bubbles: { from: "character" | "child"; text: string }[] = [];
  if (resumeMode && resumeLine !== null) {
    bubbles.push({ from: "character", text: resumeLine });
  } else if (preparedLines) {
    const shownQuestions =
      phase === "question"
        ? preparedLines.question.slice(0, lineIndex + 1)
        : preparedLines.question;
    for (const l of shownQuestions)
      if (l.text) bubbles.push({ from: "character", text: l.text });
  }
  bubbles.push(...history);
  if (phase === "answer" && preparedLines)
    for (const l of preparedLines.answer.slice(0, lineIndex + 1))
      if (l.text) bubbles.push({ from: "character", text: l.text });

  /* 다시 듣기 — 마지막 캐릭터 말풍선 밑에. 턴이 쌓이면 마지막 대사 TTS 를 다시 튼다 */
  let lastCharacterIndex = -1;
  bubbles.forEach((b, i) => {
    if (b.from === "character") lastCharacterIndex = i;
  });
  const lastQuestionAudio =
    preparedLines?.question[preparedLines.question.length - 1]?.audio ?? null;
  const replaySrc =
    history.length > 0 ? responseUrl : resumeMode ? resumeUrl : lastQuestionAudio;
  /* 다시 듣기는 아이 차례(듣는 중·선택)일 때만 — 음성이 겹쳐 나오지 않게 */
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
      {phase === "resume" && resumeUrl && (
        <audio src={resumeUrl} autoPlay onEnded={() => setPhase("listening")} />
      )}
      {phase === "responding" && responseUrl && (
        <audio
          src={responseUrl}
          autoPlay
          onEnded={() => {
            /* 폴백·비서버 흐름은 기존 선택 버튼으로, 서버 턴은 next.kind 가 정한다 (명세 5절) */
            if (fallbackRef.current || !serverMode) {
              setPhase("choice");
              return;
            }
            if (nextRef.current?.kind === "발화받기") {
              setPhase("listening");
              return;
            }
            /* 장면끝·회차끝 — 닫는 말은 방금 재생했다. 다음 스텝(영상·엔딩)으로 */
            onComplete();
          }}
        />
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
                {canReplay && replaySrc && i === lastCharacterIndex && (
                  <button
                    type="button"
                    onClick={() =>
                      setReplay((r) => ({ src: replaySrc, n: (r?.n ?? 0) + 1 }))
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
          {(phase === "question" || phase === "resume") && (
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
