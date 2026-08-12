"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { SEQUENCE, type VideoStep } from "./data";
import { InteractiveScene } from "./interactive-scene";
import { VIDEO_SUBTITLES } from "./subtitles";

/**
 * 방귀 뀌는 며느리 — 재생 화면.
 *
 * 영상 5파트 사이에 인터랙티브 4씬(STT→TTS)이 끼어드는 시퀀서.
 * 순서 정의는 data.ts, 대화 씬 동작은 interactive-scene.tsx 에 있다.
 *
 * 시안 8~17 디자인은 추후 제공 예정이라 지금은 기능 테스트용 최소 UI 다.
 * 첫 화면의 "이야기 시작" 버튼은 소리 있는 자동재생을 허용받기 위한
 * 사용자 제스처이기도 하다 — 빼면 브라우저가 영상 소리를 막는다.
 */
export default function FartBridePlay() {
  const [started, setStarted] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  const finished = stepIndex >= SEQUENCE.length;
  const step = finished ? null : SEQUENCE[stepIndex];
  const next = () => setStepIndex((index) => index + 1);

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
            onClick={() => setStarted(true)}
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
              onClick={() => setStepIndex(0)}
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
          {/* key 로 스텝마다 래퍼를 새로 마운트해 책 넘김이 매번 재생된다 */}
          <div key={step.id} className="page-turn relative h-full w-full">
            {step.kind === "video" ? (
              <PartVideo step={step} onEnded={next} />
            ) : (
              <InteractiveScene step={step} onComplete={next} />
            )}
            <div className="page-turn-shade pointer-events-none absolute inset-0 bg-gradient-to-r from-black/60 via-black/20 to-transparent" />
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
              {SEQUENCE.map((s, index) => (
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
              onClick={next}
              className="rounded-lg bg-white/20 px-4 py-2 text-[15px] font-bold text-white"
            >
              건너뛰기
            </button>
          </div>
        </div>
      )}
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
