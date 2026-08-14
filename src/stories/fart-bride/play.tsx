"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { type VideoStep } from "./data";
import { CutsPlayer, type CutsPlayerHandle } from "./cuts-player";
import { InteractiveScene } from "./interactive-scene";
import { MinigamePopup } from "./minigame-popup";
import { buildPlanSequence } from "./plan-sequence";
import { useStorySequencer } from "./sequencer";
import { VIDEO_SUBTITLES } from "./subtitles";

/**
 * 방귀 뀌는 며느리 — 재생 화면.
 *
 * 재생 순서는 /dev/video-maker 에서 편집·저장한 video-plan.json 을 따른다
 * (plan-sequence.ts 가 변환): linear 컷 묶음은 cuts-player 가 이미지+음성+
 * 저장된 연출로 재생하고, 질문·답변 컷 짝은 대화 씬(STT→TTS)이 된다.
 * 진행 제어(시작·다음·점프·책 넘김 판단)는 sequencer.ts,
 * 대화 씬 동작은 interactive-scene.tsx 에 있다 — 이 파일은 그리기만 한다.
 * mp4 파트 방식 순서(data.ts 의 SEQUENCE)는 남아 있다 — 되돌리려면
 * useStorySequencer() 를 인자 없이 부르면 된다.
 *
 * 시안 8~17 디자인은 추후 제공 예정이라 지금은 기능 테스트용 최소 UI 다.
 * 첫 화면의 "이야기 시작" 버튼은 소리 있는 자동재생을 허용받기 위한
 * 사용자 제스처이기도 하다 — 빼면 브라우저가 영상 소리를 막는다.
 */

/* 플랜은 빌드에 포함된 정적 데이터라 모듈에서 한 번만 변환한다 */
const PLAN_STEPS = buildPlanSequence();

export default function FartBridePlay({
  childName,
}: {
  /** 선택된 아이 이름 — 대화 씬이 아이를 부를 때 쓴다 (라우트가 채워 준다) */
  childName: string | null;
}) {
  const { steps, started, stepIndex, step, finished, turning, start, next, restart } =
    useStorySequencer(PLAN_STEPS);

  /* 건너뛰기 — 컷 묶음 재생 중에는 스텝째가 아니라 한 컷씩 넘긴다.
     마지막 컷에서는 cuts-player 가 onEnded 로 다음 스텝을 부른다. */
  const cutsRef = useRef<CutsPlayerHandle | null>(null);
  const skip = () => {
    if (step?.kind === "cuts" && cutsRef.current) cutsRef.current.skipCut();
    else next();
  };

  /* 미니게임 팝업 테스트 (개발용) — 재생 중 SPACE 로 열고 닫는다.
     아직 빈 껍데기라 이야기 진행과는 연결하지 않는다 (뒤에서 소리는 계속 난다). */
  const [minigameOpen, setMinigameOpen] = useState(false);
  useEffect(() => {
    if (!started || finished) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      /* 스크롤·포커스된 버튼의 스페이스 동작을 막고 팝업 토글로만 쓴다 */
      event.preventDefault();
      setMinigameOpen((open) => !open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [started, finished]);

  return (
    <main className="relative h-[1024px] w-full overflow-hidden bg-story-bg">
      {!started && (
        <div className="flex h-full flex-col items-center justify-center gap-8">
          <h1 className="text-[40px] font-extrabold text-ink">방귀 뀌는 며느리</h1>
          <p className="text-[18px] font-bold text-ink-mid">
            이야기 중간중간 등장인물이 말을 걸어요. 마이크를 준비해 주세요!
          </p>
          <button
            type="button"
            onClick={start}
            className="rounded-2xl bg-primary px-14 py-5 text-[26px] font-extrabold text-white"
          >
            이야기 시작
          </button>
        </div>
      )}

      {started && finished && (
        <div className="flex h-full flex-col items-center justify-center gap-8">
          <h1 className="text-[40px] font-extrabold text-ink">이야기 끝!</h1>
          <p className="text-[18px] font-bold text-ink-mid">
            며느리와 이야기 나눠 줘서 고마워요.
          </p>
          <div className="flex gap-4">
            <button
              type="button"
              onClick={restart}
              className="rounded-2xl bg-white px-10 py-4 text-[20px] font-extrabold text-ink"
            >
              다시 보기
            </button>
            <Link
              href="/stories/fart-bride"
              className="rounded-2xl bg-primary px-10 py-4 text-[20px] font-extrabold text-white"
            >
              이야기 소개로
            </Link>
          </div>
        </div>
      )}

      {started && step && (
        <div className="h-full w-full bg-black [perspective:2000px]">
          <div
            key={step.id}
            className={`relative h-full w-full ${turning ? "page-turn" : ""}`}
          >
            {step.kind === "video" ? (
              <PartVideo step={step} onEnded={next} />
            ) : step.kind === "cuts" ? (
              <CutsPlayer step={step} onEnded={next} ref={cutsRef} />
            ) : (
              <InteractiveScene step={step} childName={childName} onComplete={next} />
            )}
            {turning && (
              <div className="page-turn-shade pointer-events-none absolute inset-0 bg-gradient-to-r from-black/60 via-black/20 to-transparent" />
            )}
          </div>

          {/* 상단 바 — 뒤로가기, 진행 점, 건너뛰기(테스트용) */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-6 pt-5 pb-10">
            <Link href="/stories/fart-bride" aria-label="뒤로가기">
              <Image
                src="/figma/icons/arrow-left.svg"
                alt=""
                width={36}
                height={36}
                className="brightness-0 invert"
              />
            </Link>

            <div className="flex items-center gap-2">
              {steps.map((s, index) => (
                <span
                  key={s.id}
                  className={`rounded-full ${
                    s.kind === "interactive" ? "size-3" : "size-2.5"
                  } ${index <= stepIndex ? "bg-white" : "bg-white/30"}`}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={skip}
              className="rounded-lg bg-white/20 px-4 py-2 text-[15px] font-bold text-white"
            >
              건너뛰기
            </button>
          </div>
        </div>
      )}

      <MinigamePopup
        open={minigameOpen}
        onClose={() => setMinigameOpen(false)}
        onComplete={() => setMinigameOpen(false)}
      />
    </main>
  );
}

/**
 * 파트 영상 + 자막. 타이밍은 subtitles.ts (story_database.json 의 음성
 * 길이로 자동 생성 — 영상이 음성을 그대로 이어붙인 것이라 오차 0.05초 이내).
 */
function PartVideo({ step, onEnded }: { step: VideoStep; onEnded: () => void }) {
  const [time, setTime] = useState(0);
  const cue = (VIDEO_SUBTITLES[step.id] ?? []).find(
    (c) => time >= c.start && time < c.end,
  );

  return (
    <div className="relative h-full w-full">
      <video
        src={step.src}
        autoPlay
        playsInline
        onEnded={onEnded}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        className="h-full w-full object-contain"
      />
      {cue && (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center px-10">
          <p className="max-w-[900px] rounded-2xl bg-black/55 px-6 py-4 text-center text-[22px] font-bold leading-[1.5] text-white">
            {cue.speaker && (
              <span className="mr-2 text-[18px] text-amber-300">{cue.speaker}</span>
            )}
            {cue.text}
          </p>
        </div>
      )}
    </div>
  );
}
