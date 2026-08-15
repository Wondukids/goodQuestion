"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from "react";
import { SlideTransition } from "@/components/ui/slide-transition";
import { transcribeAudio } from "@/stt/client";
import { startRecording, type Recording } from "@/stt/record";
import { requestSpeech } from "@/tts/client";
import { STT_DEFAULTS, type InteractiveStep, type SpeechLine } from "./data";
import { fillChildName, vocative } from "./name";
import {
  openSession,
  resumeSessionTurn,
  SessionApiError,
  skipSessionSceneWithResume,
  submitSessionTurn,
  type MissionCompleteResult,
  type MissionStart,
  type TurnNext,
  type TurnResult,
} from "./session-api";

/**
 * 인터랙티브 씬 하나 (이슈 #8 — `docs/이야기_세션_명세.md` 5절):
 * 질문(녹음 음성) → 아이 답변 녹음 → 턴 API(서버가 STT→분석→판단→대사) →
 * 캐릭터 대사 TTS 재생 → next.kind 분기(발화받기 → 다시 마이크 · 장면끝/회차끝 → 다음 스텝
 * · 미션시작 → 팝업 열기).
 *
 * 미션(이슈 #20 · `docs/미션_명세.md`): 트리거 턴의 dialogue 는 다리 대사다 — 패널
 * 재생이 끝난 뒤에야 onMissionStart 로 팝업을 연다 (M8). 팝업이 닫히면 재생 화면이
 * complete 결과를 missionResult 로 내려 주고, 여기서 종료 요약·닫는 말을 패널에서
 * 재생한 뒤 next 로 분기한다 — 장면끝이면 답변 컷을 건너뛴다 (M6).
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
  | "mission" // 미션 팝업이 열려 있는 동안 — 결과(missionResult)를 기다린다
  | "choice" // 다시 말하기 / 계속하기 — 폴백·비서버 흐름에서만
  | "silent" // 무음 한도 초과 — 다시 말하기 / 넘어가기 선택 대기 (서버·비서버 공통)
  | "answer" // 정해진 답변 재생 중 — 폴백·비서버 흐름에서만
  | "error";

/* 고정 문구 폴백 — 세션이 없거나 턴 API 가 죽었을 때(502)만 쓴다 (이슈 #8).
   LLM 대사는 이제 서버 턴 API(POST /api/sessions/{id}/turns)가 만든다. */
function buildReaction(transcript: string) {
  return `"${transcript}"라고 말해 주었구나! 이야기해 줘서 정말 고마워.`;
}

/**
 * `?debug=scene` 일 때만 진단 배지를 켠다.
 *
 * 🔴 **배포에서 지울 것이 없다.** 아이 앱이 여는 URL 에는 이 쿼리가 없어 아이 화면에는
 * 절대 안 뜨고, 꺼져 있으면 DOM 이 아예 안 생긴다. 지우는 방식은 지울 것을 기억해야 하고
 * 급할 때 잊는다 — 무엇보다 **배포된 실기기에서 켤 수 없다.**
 *
 * ⚠️ 첫 렌더에서 `window` 를 읽어도 안전하다 — 이 씬은 「이야기 시작」을 누른 **뒤에만**
 *    붙으므로(`play.tsx` 의 `started`) 서버 렌더에 한 번도 안 들어간다. 그래서 수화 어긋남이
 *    생길 자리가 없고, 효과에서 setState 하는 모양(층 규칙상 lint 오류)을 피할 수 있다.
 */
function useSceneDebug(): boolean {
  const [on] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("debug") === "scene",
  );
  return on;
}

/* TTS 한 번 더 — 씬 진입 준비와 대사 합성이 몰리면 일시 오류(502)가 잦다. 짧게 쉬고
   한 번 재시도하면 대부분 살아나, 멀쩡한 LLM 대답이 고정 문구로 떨어지는 일을 줄인다. */
async function requestSpeechWithRetry(request: Parameters<typeof requestSpeech>[0]) {
  try {
    return await requestSpeech(request);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return requestSpeech(request);
  }
}

/** 재생 화면(play.tsx)이 미션 팝업이 닫힐 때 부르는 핸들 (cuts-player 와 같은 결) */
export type InteractiveSceneHandle = {
  /** complete 결과로 종료 요약·닫는 말을 패널에서 재생하고 next 로 분기한다 (M8 꼬리).
      result 가 null 이면 이탈(abandoned)·complete 실패 — 대화로 복귀한다 */
  missionClosed: (result: MissionCompleteResult | null) => void;
};

export function InteractiveScene({
  step,
  childName,
  sessionId,
  serverScene,
  onServerScene,
  resumeLine,
  onMissionStart,
  onComplete,
  ref,
}: {
  step: InteractiveStep;
  /** 선택된 아이 이름 — 있으면 질문할 때 이름을 부른다 */
  childName: string | null;
  /** 세션 열기(POST /api/sessions)의 id — null 이면 서버 없이 고정 문구 흐름 */
  sessionId: string | null;
  /** 서버가 지금 기다리는 대화 장면 code — 이 씬과 다르면(건너뛰기로 어긋남) 서버 턴을 안 보낸다 */
  serverScene: string | null;
  /** 턴 응답이 장면을 옮기면(장면끝·회차끝) 추적을 갱신한다 — play.tsx 의 state 다 */
  onServerScene: (code: string | null) => void;
  /** 복귀 진입이면 서버의 마지막 캐릭터 대사 — 여는 말 연출 대신 이 한 줄을 튼다 */
  resumeLine: string | null;
  /** 턴 응답 `미션시작` — 다리 대사 재생이 **끝난 뒤** 부른다(M8). 재생 화면이 팝업을 연다 */
  onMissionStart: (mission: MissionStart) => void;
  onComplete: () => void;
  /** 미션 팝업이 닫힐 때 재생 화면이 결과를 넣어 주는 핸들 */
  ref?: Ref<InteractiveSceneHandle>;
}) {
  /* 고정 문구로 떨어지는 사유 — **셋뿐이다.** 서버 대화가 도는 조건은 이 셋이 다 아닌
     것이고, 그래서 `serverMode` 도 여기서 나온다 (조건을 두 번 적으면 갈라진다).

     🔴 화면 결과는 셋 다 똑같이 「고정 문구」라, 사유를 안 남기면 사람이 「LLM 이 이상하다」로만
     본다 — 원인은 서버 로그로만 갈렸다. 그래서 아래 배지·로그가 이 값을 그대로 쓴다. */
  const fallbackReason =
    sessionId === null
      ? "세션없음 (아이 미선택·열기 실패)"
      : step.sceneCode === ""
        ? "이 씬에 서버 장면이 없다"
        : step.sceneCode !== serverScene
          ? `장면어긋남 — 서버 대기 ${serverScene ?? "없음"}`
          : null;

  /* 서버 대화 모드 — 세션이 열려 있고 이 씬이 **서버가 기다리는 바로 그 장면**일 때만
     (명세 3절 매핑 + 어긋남 가드). 다르면 잘못된 캐릭터가 대답하게 되므로 고정 문구로
     돌리고, 서버 기록은 그대로 둔다 — 건너뛰기는 스킵 API 가 서버도 같이 넘긴다. */
  const serverMode = fallbackReason === null;
  const resumeMode = serverMode && resumeLine !== null;
  /* 진입 시점의 모드 — TTS 준비량을 정하는 데만 쓴다. 장면 도중 추적 갱신(장면끝)으로
     serverMode 가 변해도 준비를 다시 돌리지 않기 위해 처음 값을 붙잡아 둔다.
     진단 로그도 이 값을 쓴다 — 알고 싶은 것은 **진입 시점**의 모드다. */
  const [entryMode] = useState(() => ({
    server: serverMode,
    resume: resumeMode,
    reason: fallbackReason,
  }));
  const debug = useSceneDebug();

  /* 씬마다 한 줄 — 늘 켜 둔다. 폴백이 조용히 일어나는 것이 이 레포의 오랜 사각이었다. */
  useEffect(() => {
    console.info(
      entryMode.server
        ? `[장면] ${step.id} · 서버 대화 ${step.sceneCode}`
        : `[장면] ${step.id} · 고정 문구 — ${entryMode.reason}`,
    );
  }, [entryMode, step.id, step.sceneCode]);

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
     이름이 없으면 원본 녹음을 그대로 쓴다. 복귀 진입도 원본 그대로다 — 질문 연출을
     건너뛰므로 준비 TTS 를 아예 안 부른다 (진입 때 호출이 몰리면 정작 대사 TTS 가
     502 로 튕겨 고정 문구로 떨어진다). 폴백으로 정해진 답변을 틀게 되면 원본 녹음이
     나간다 — 이름만 못 부를 뿐이다. */
  const [preparedLines, setPreparedLines] = useState<{
    question: SpeechLine[];
    answer: SpeechLine[];
  } | null>(
    childName && !entryMode.resume
      ? null
      : { question: step.question.lines, answer: step.answer.lines },
  );

  /* "ㅇㅇ" 자리 표시자가 있는 대사는 이름을 넣어 캐릭터 목소리로 TTS 하고,
     질문에 자리 표시자가 없으면 짧은 호명("지훈아!")을 앞에 붙인다.
     TTS 실패 시 원본 녹음으로 폴백 — 이름만 못 부를 뿐 진행은 된다. */
  useEffect(() => {
    /* 복귀 진입은 초기 상태가 이미 원본으로 차 있다 (위 preparedLines 주석) */
    if (!childName || entryMode.resume) return;
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
        const greetingAudio = needsGreeting
          ? await tts(
              greetingText,
              `${step.speaker.stylePrompt} 지금은 아이에게 말을 걸려고 이름을 부르는 짧은 첫마디입니다 — 이름을 반갑고 다정하게, 자연스럽게 불러 주세요.`,
            )
          : null;
        const question = await substitute(step.question.lines);
        /* 서버 모드에선 정해진 답변이 재생되지 않는다(502 폴백 전용) — 준비 TTS 절약.
           순차 합성이라 부르는 개수가 곧 진입 대기 시간이다 — 이 절약을 빼면 씬 진입이 느려진다. */
        const answer = entryMode.server
          ? step.answer.lines
          : await substitute(step.answer.lines);
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
  }, [childName, step, entryMode]);

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
        const speech = await requestSpeechWithRetry({
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

  /* 화면이 대화를 떠나며 서버도 같이 넘긴다 — 상단 건너뛰기(play.tsx skip)와 같은 스킵
     통보다. 무음 「넘어가기」·폴백 「계속하기」·오류 「건너뛰고 계속」이 부른다.
     서버가 지금 이 장면을 기다릴 때(serverMode)만 보낸다 — 이미 어긋난 씬(고정 문구)에서
     보내면 엉뚱한 대기 장면을 넘기게 된다. fire-and-forget: 화면 진행은 응답을 기다리지
     않고, 장면 추적(onServerScene)만 응답이 오면 갱신한다. */
  const notifySkip = useCallback(() => {
    if (!serverMode) return;
    /* 응답이 오기 전에 이 씬으로 턴이 나가지 않게 추적을 먼저 끊는다 (play.tsx 와 동일) */
    onServerScene(null);
    skipSessionSceneWithResume(sessionId!, step.sceneCode, "fart-bride")
      .then((code) => onServerScene(code))
      .catch((error: unknown) => {
        /* 실패해도 이야기는 멈추지 않는다 — 서버 기록은 그대로라 다음 진입 때 복귀한다 */
        console.info("[장면] 건너뛰기 알림 실패 — 서버는 그 장면에 남는다", error);
      });
  }, [serverMode, sessionId, step.sceneCode, onServerScene]);

  /* 무음 — sttDefaults 대로 1회 재시도 후 선택지(다시 말하기/넘어가기)로 (서버 흐름도 같은
     연출 — 명세 4.3절). 예전엔 여기서 바로 정해진 답변으로 넘겼는데, 아이 입장에선 아무
     안내 없이 "내 말을 씹고 지나간" 것으로 보였다 (실사용 신고). */
  const handleSilence = useCallback(() => {
    if (retriesRef.current < STT_DEFAULTS.retryCount) {
      retriesRef.current += 1;
      setPhase("listening");
    } else {
      setPhase("silent");
    }
  }, []);

  /* 캐릭터 반응 하나를 TTS 로 준비해 재생 단계로 — 서버 대사와 폴백 문구가 같이 쓴다.
     gemini-2.5 고정 — 실패는 error 단계(다시 시도·건너뛰기)로 드러난다 */
  const speakReaction = useCallback(
    async (text: string) => {
      const speech = await requestSpeechWithRetry({
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

  /* ── 미션 (이슈 #20) ─────────────────────────────────────────── */

  /* 다리 대사가 끝나 팝업을 연다 (M8) — 씬은 mission 단계로 결과를 기다린다 */
  const startMission = useCallback(
    (mission: MissionStart) => {
      setPhase("mission");
      onMissionStart(mission);
    },
    [onMissionStart],
  );

  /* complete 응답의 summary·closing_line 재생 대기열 — responding onEnded 가
     이 ref 를 먼저 본다. 비면 next 로 분기한다 (명세 8절 · M6). */
  const missionPlaybackRef = useRef<{
    lines: string[];
    next: MissionCompleteResult["next"];
  } | null>(null);

  const runMissionNext = useCallback(
    (next: MissionCompleteResult["next"]) => {
      missionPlaybackRef.current = null;
      if (next.kind === "발화받기") {
        /* 요소가 남았다 — 요약 대사가 유도 질문으로 끝났으니 바로 아이 차례다 */
        setPhase("listening");
        return;
      }
      /* 장면끝·회차끝 — 닫는 말은 방금 재생했다. **답변 컷은 건너뛴다** (M6):
         answer 단계로 가지 않고 다음 스텝으로. 대화 턴 경유 닫힘(위 onEnded 의
         onComplete 직행)과 같은 결이다 — 닫는 말이 두 번 들리지 않는다. */
      onServerScene(next.kind === "장면끝" ? (next.next_scene?.code ?? null) : null);
      onComplete();
    },
    [onServerScene, onComplete],
  );

  const playNextMissionLine = useCallback(() => {
    const playback = missionPlaybackRef.current;
    if (!playback) return;
    const text = playback.lines.shift();
    if (text === undefined) {
      runMissionNext(playback.next);
      return;
    }
    setHistory((h) => [...h, { from: "character", text }]);
    speakReaction(text).catch(() => {
      /* TTS 실패 — 대사는 말풍선에 있다. 남은 줄도 글로만 쌓고 분기한다
         (턴 TTS 실패와 같은 결 — 미션 요약이 음성 때문에 멈추지 않는다) */
      const rest = missionPlaybackRef.current;
      if (!rest) return;
      if (rest.lines.length > 0) {
        const texts = rest.lines.splice(0);
        setHistory((h) => [
          ...h,
          ...texts.map((t) => ({ from: "character" as const, text: t })),
        ]);
      }
      runMissionNext(rest.next);
    });
  }, [speakReaction, runMissionNext]);

  /* 팝업이 닫혔다 — 재생 화면이 이벤트로 넣어 주는 complete 결과.
     여기서 종료 요약·닫는 말을 패널에서 재생하고 next 로 분기한다 (M8 꼬리). */
  useImperativeHandle(
    ref,
    () => ({
      missionClosed: (result) => {
        if (result === null) {
          /* 이탈(abandoned)·complete 실패 — 대화로 복귀. 트리거 조건이 남아 있으면
             다음 턴에 다시 발동될 수 있다 (명세 8절). */
          setPhase("listening");
          return;
        }
        const { summary, closing_line, next } = result;
        missionPlaybackRef.current = {
          lines: [summary.text, ...(closing_line ? [closing_line.text] : [])],
          next,
        };
        playNextMissionLine();
      },
    }),
    [playNextMissionLine],
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
            /* 이어 돌린 턴이 장면을 끝냈으면 서버는 아직 그 장면에 서 있다(전진은 열기 몫).
               다시 열어 따라잡고(명세 4.3절) 장면 추적을 그 결과로 갱신한다. */
            if (resumed.next.kind === "장면끝") {
              try {
                const reopened = await openSession("fart-bride");
                onServerScene(
                  reopened.status === "in_progress" ? (reopened.scene?.code ?? null) : null,
                );
              } catch {
                onServerScene(null); // 따라잡기 실패 — 남은 씬은 고정 문구로, 다음 진입 때 복귀
              }
            }
            return {
              child: resumed.child,
              dialogue: resumed.dialogue,
              next: resumed.next,
            } satisfies TurnResult;
          }
          throw error;
        });

        if (result.empty) return handleSilence();

        /* 장면 추적 갱신 — 턴 API 의 장면끝은 next_scene 을 항상 싣는다 (없으면 회차끝이다).
           next_scene 없는 장면끝은 위 resume 경로뿐이고, 그쪽은 재열기가 이미 갱신했다. */
        if (result.next.kind === "회차끝") onServerScene(null);
        else if (result.next.kind === "장면끝" && result.next.next_scene) {
          onServerScene(result.next.next_scene.code);
        }

        nextRef.current = result.next;
        fallbackRef.current = false;
        retriesRef.current = 0;
        setHistory((h) => [
          ...h,
          { from: "child", text: result.child.text },
          { from: "character", text: result.dialogue.text },
        ]);
        try {
          await speakReaction(result.dialogue.text);
        } catch {
          /* TTS 만 죽었다(429 몰림 등) — 턴은 이미 성공해 대사가 말풍선에 있다. 여기서
             고정 문구를 틀면 아이에게는 「내 말이 씹혔다」로 보인다(2026-08-14 실사용).
             음성 없이 responding 종료와 같은 갈림길로 바로 간다. */
          if (result.next.kind === "발화받기") setPhase("listening");
          else if (result.next.kind === "미션시작" && result.next.mission) {
            startMission(result.next.mission);
          } else onComplete();
        }
      } catch (error) {
        /* 턴 자체가 죽었다(STT 502·서버 오류) — 저장된 것이 없어 같은 녹음을 다시 보내면
           된다. 고정 문구 대신 오류 선택지(다시 시도·건너뛰고 계속)로 드러낸다. */
        fail(error instanceof Error ? error.message : "음성 처리에 실패했습니다.");
      }
    },
    [
      serverMode,
      sessionId,
      onServerScene,
      handleSilence,
      speakReaction,
      startMission,
      fail,
      onComplete,
    ],
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
  /* 다시 듣기는 아이 차례(듣는 중·선택·무음 안내)일 때만 — 음성이 겹쳐 나오지 않게 */
  const canReplay = phase === "listening" || phase === "choice" || phase === "silent";

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
            /* 미션 종료 요약 재생 중 — 대기열이 다음 줄·분기를 안다 (이슈 #20) */
            if (missionPlaybackRef.current) {
              playNextMissionLine();
              return;
            }
            /* 폴백·비서버 흐름은 기존 선택 버튼으로, 서버 턴은 next.kind 가 정한다 (명세 5절).
               ⚠️ 여기서 serverMode 를 다시 보면 안 된다 — 장면끝이면 추적(onServerScene)이
               이미 다음 장면을 가리켜 false 가 된 뒤다. 이 턴이 서버 턴이었다는 사실은
               nextRef 가 안다 (폴백·비서버 턴은 nextRef 를 채우지 않는다). */
            if (fallbackRef.current || nextRef.current === null) {
              setPhase("choice");
              return;
            }
            if (nextRef.current?.kind === "발화받기") {
              setPhase("listening");
              return;
            }
            if (nextRef.current?.kind === "미션시작") {
              /* 다리 대사 재생이 끝났다 — 이제야 팝업을 연다 (M8) */
              if (nextRef.current.mission) startMission(nextRef.current.mission);
              else setPhase("listening"); // mission 페이로드 누락 — 계약 위반, 대화로 계속
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

      {/* 진단 배지 — `?debug=scene` 에서만. 아이 화면에는 뜨지 않는다 */}
      {debug && (
        <div className="pointer-events-none absolute left-4 top-24 rounded-lg bg-black/70 px-3 py-2 font-mono text-[12px] leading-[1.6] text-emerald-200">
          <div>
            서버모드 <b className="text-amber-300">{serverMode ? "ON" : "OFF"}</b> ·{" "}
            {step.sceneCode || "장면없음"}
          </div>
          {!serverMode && <div className="text-amber-300">사유: {fallbackReason}</div>}
          <div>
            서버 대기 {serverScene ?? "없음"} · 세션 {sessionId?.slice(0, 8) ?? "없음"}
          </div>
          <div>
            단계 {phase} · 턴 {Math.floor(history.length / 2)}
          </div>
        </div>
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

          {phase === "mission" && (
            <p className="text-[14px] font-bold text-ink-muted">
              미션을 하고 있어요…
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
                  notifySkip(); // 폴백 뒤 진행 — 서버가 이 장면을 기다리고 있으면 같이 넘긴다
                  setLineIndex(0);
                  setPhase("answer");
                }}
                className="rounded-xl bg-primary px-6 py-3 text-[16px] font-extrabold text-white"
              >
                계속하기
              </button>
            </div>
          )}

          {phase === "silent" && (
            <>
              <p className="text-center text-[14px] font-bold text-point-strong">
                목소리가 잘 안 들렸어요. 한 번 더 말해 볼까?
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    retriesRef.current = 0;
                    setPhase("listening");
                  }}
                  className="rounded-xl bg-chip px-6 py-3 text-[16px] font-extrabold text-ink"
                >
                  다시 말하기
                </button>
                <button
                  type="button"
                  onClick={() => {
                    notifySkip(); // 무음으로 지나감 — 서버도 이 장면을 넘긴다 (안 넘기면 계속 대기)
                    setLineIndex(0);
                    setPhase("answer");
                  }}
                  className="rounded-xl bg-primary px-6 py-3 text-[16px] font-extrabold text-white"
                >
                  넘어가기
                </button>
              </div>
            </>
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
                    /* 장면끝 뒤의 오류(닫는 말 TTS 실패)면 추적이 이미 다음 장면이라
                       serverMode 가 꺼져 있어 통보가 안 나간다 — 의도된 동작이다 */
                    notifySkip();
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
