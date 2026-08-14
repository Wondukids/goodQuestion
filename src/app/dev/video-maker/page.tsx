"use client";

import Image from "next/image";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CameraPan,
  CameraShake,
  ChromaticAberration,
  DutchAngle,
  Flash,
  Glitch,
  KenBurns,
  Letterbox,
  Orbit,
  Punch,
  PunchZoom,
  RandomBars,
  Reveal,
  SlideIn,
  Vignette,
  ZoomIn,
  ZoomOut,
} from "@/frontendlib";
import {
  assetUrl,
  CAMERA_EFFECT_LABELS,
  ENTER_EFFECT_LABELS,
  OVERLAY_EFFECT_LABELS,
  VIDEO_PLAN,
  type CameraEffect,
  type EnterEffect,
  type OverlayEffect,
  type PlanCut,
  type PlanLine,
} from "@/stories/fart-bride/video-plan";

/**
 * 영상 제작 도우미 — 컷 이미지 + 녹음 음성으로 이야기를 미리 보고(애니매틱),
 * 컷 구성을 그 자리에서 편집해 본다:
 *  - 이미지 교체 (소스 폴더의 이미지 중에서 선택)
 *  - 대사 연결·순서 변경 (사운드 파일이 실제로 있는 대사만)
 *  - 컷 연출 (등장 전환 + 카메라, frontendlib 효과 재사용)
 * "저장"을 누르면 video-plan.json 에 그대로 기록된다.
 */

const AFTER_LABELS: Record<NonNullable<PlanCut["after"]>, string> = {
  stt: "아이 답변(STT) 대기",
  "stt-minigame": "아이 답변(STT) → 미니게임",
};

/* 원본 플랜에서 오디오 파일명 → 대사 정보 — "대사 추가" 선택지에 쓴다 */
const LINE_INFO = new Map<string, PlanLine>();
for (const c of VIDEO_PLAN.cuts) {
  for (const l of c.lines) {
    if (!LINE_INFO.has(l.audio)) LINE_INFO.set(l.audio, l);
  }
}

function formatTime(sec: number) {
  const whole = Math.round(sec);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** 컷이 떠 있는 동안의 카메라 연출 래퍼 */
function CameraLayer({
  effect,
  durationMs,
  playKey,
  children,
}: {
  effect: CameraEffect;
  durationMs: number;
  playKey: string;
  children: ReactNode;
}) {
  switch (effect) {
    case "zoom-in":
      return (
        <ZoomIn durationMs={durationMs} playKey={playKey} className="h-full w-full">
          {children}
        </ZoomIn>
      );
    case "zoom-out":
      return (
        <ZoomOut durationMs={durationMs} playKey={playKey} className="h-full w-full">
          {children}
        </ZoomOut>
      );
    case "punch-zoom":
      return (
        <PunchZoom playKey={playKey} className="h-full w-full">
          {children}
        </PunchZoom>
      );
    case "ken-burns-left":
    case "ken-burns-right":
      return (
        <KenBurns
          direction={effect === "ken-burns-left" ? "left" : "right"}
          durationMs={durationMs}
          playKey={playKey}
          className="h-full w-full"
        >
          {children}
        </KenBurns>
      );
    case "pan-left":
    case "pan-right":
    case "tilt-up":
    case "tilt-down":
      return (
        <CameraPan
          direction={
            effect === "pan-left"
              ? "left"
              : effect === "pan-right"
                ? "right"
                : effect === "tilt-up"
                  ? "up"
                  : "down"
          }
          durationMs={durationMs}
          playKey={playKey}
          className="h-full w-full"
        >
          {children}
        </CameraPan>
      );
    case "orbit":
      return (
        <Orbit durationMs={durationMs} playKey={playKey} className="h-full w-full">
          {children}
        </Orbit>
      );
    case "dutch":
      return (
        <DutchAngle playKey={playKey} className="h-full w-full">
          {children}
        </DutchAngle>
      );
    case "shake":
      return (
        <CameraShake playKey={playKey} intensity={10} durationMs={600} className="h-full w-full">
          {children}
        </CameraShake>
      );
    case "shake-loop":
      return (
        <CameraShake loop playKey={playKey} intensity={6} durationMs={900} className="h-full w-full">
          {children}
        </CameraShake>
      );
    case "punch":
      return (
        <Punch playKey={playKey} className="h-full w-full">
          {children}
        </Punch>
      );
    case "glitch":
      return (
        <Glitch playKey={playKey} className="h-full w-full">
          {children}
        </Glitch>
      );
    case "chromatic":
      return (
        <ChromaticAberration playKey={playKey} className="h-full w-full">
          {children}
        </ChromaticAberration>
      );
    default:
      return <div className="h-full w-full">{children}</div>;
  }
}

/** 컷 등장 전환 래퍼 — playKey 가 바뀔 때마다 다시 재생 */
function EnterLayer({
  effect,
  playKey,
  children,
}: {
  effect: EnterEffect;
  playKey: string;
  children: ReactNode;
}) {
  switch (effect) {
    case "slide-left":
    case "slide-right":
    case "slide-up":
    case "slide-down":
      return (
        <SlideIn
          from={
            effect === "slide-left"
              ? "left"
              : effect === "slide-right"
                ? "right"
                : effect === "slide-up"
                  ? "up"
                  : "down"
          }
          playKey={playKey}
          className="h-full w-full"
        >
          {children}
        </SlideIn>
      );
    case "wipe-left":
    case "wipe-right":
    case "wipe-up":
    case "wipe-down":
      return (
        <Reveal
          variant="wipe"
          direction={
            effect === "wipe-left"
              ? "left"
              : effect === "wipe-right"
                ? "right"
                : effect === "wipe-up"
                  ? "up"
                  : "down"
          }
          playKey={playKey}
          className="h-full w-full"
        >
          {children}
        </Reveal>
      );
    case "random-bars":
      return (
        <RandomBars playKey={playKey} className="h-full w-full">
          {children}
        </RandomBars>
      );
    case "none":
      return <div className="h-full w-full">{children}</div>;
    default:
      /* 나머지는 이름만 Reveal variant 로 바꿔 그대로 재생한다 */
      return (
        <Reveal
          variant={
            effect === "wipe-diagonal"
              ? "wipe-diagonal"
              : effect === "checkerboard"
                ? "checker"
                : effect === "flip"
                  ? "flip-y"
                  : effect === "flip-vertical"
                    ? "flip-x"
                    : effect
          }
          playKey={playKey}
          className="h-full w-full"
        >
          {children}
        </Reveal>
      );
  }
}

/** 컷 위에 겹치는 화면 오버레이 래퍼 — 카메라·등장과 독립으로 얹는다 */
function OverlayLayer({
  effect,
  playKey,
  children,
}: {
  effect: OverlayEffect;
  playKey: string;
  children: ReactNode;
}) {
  switch (effect) {
    case "letterbox":
      return (
        <Letterbox playKey={playKey} className="h-full w-full">
          {children}
        </Letterbox>
      );
    case "vignette":
      return (
        <Vignette playKey={playKey} className="h-full w-full">
          {children}
        </Vignette>
      );
    case "vignette-red":
      return (
        <Vignette color="rgba(190, 30, 30, 0.5)" playKey={playKey} className="h-full w-full">
          {children}
        </Vignette>
      );
    case "vignette-pulse":
      return (
        <Vignette pulse playKey={playKey} className="h-full w-full">
          {children}
        </Vignette>
      );
    case "flash":
      return (
        <Flash playKey={playKey} className="h-full w-full">
          {children}
        </Flash>
      );
    default:
      return <div className="h-full w-full">{children}</div>;
  }
}

type PlayMode = "line" | "cut" | "all";

export default function VideoMakerPage() {
  /* 플랜은 편집 대상이라 상태로 복사해 둔다 — "저장"이 json 에 기록한다 */
  const [cuts, setCuts] = useState<PlanCut[]>(() =>
    VIDEO_PLAN.cuts.map((c) => ({
      ...c,
      effect: { ...c.effect },
      lines: c.lines.map((l) => ({ ...l })),
    })),
  );
  const [cutIndex, setCutIndex] = useState(0);
  const [playState, setPlayState] = useState<{ line: number; mode: PlayMode } | null>(null);
  const [assets, setAssets] = useState<{ image: string[]; sound: string[] } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [linePickerOpen, setLinePickerOpen] = useState(false);
  const [lineFilter, setLineFilter] = useState("");
  /* 연출 다시 보기 — 증가할 때마다 등장·카메라 연출을 재시작한다 */
  const [replayKey, setReplayKey] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);

  const cut = cuts[cutIndex];

  useEffect(() => {
    let cancelled = false;
    fetch("/api/dev/story-assets/list")
      .then((r) => r.json())
      .then((data: { image: string[]; sound: string[] }) => {
        if (!cancelled) setAssets(data);
      })
      .catch(() => {
        if (!cancelled) setNotice("에셋 목록을 불러오지 못했습니다.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /* 페이지 이탈 시 재생 중인 오디오 정리 */
  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      previewRef.current?.pause();
    };
  }, []);

  /* 컷별 누적 시작 시각 — 편집 타임라인에서 위치 잡을 때 쓴다 */
  const startTimes = useMemo(
    () =>
      cuts.reduce<number[]>(
        (acc, _, i) => [...acc, i === 0 ? 0 : acc[i - 1] + cuts[i - 1].durationSec],
        [],
      ),
    [cuts],
  );
  const totalSec = useMemo(() => cuts.reduce((s, c) => s + c.durationSec, 0), [cuts]);
  const replaceCount = useMemo(() => cuts.filter((c) => c.needsNewImage).length, [cuts]);

  function stopPlayback() {
    audioRef.current?.pause();
    audioRef.current = null;
    setPlayState(null);
  }

  function playLine(targetCut: number, targetLine: number, mode: PlayMode) {
    const c = cuts[targetCut];
    const line = c?.lines[targetLine];
    if (!line) {
      stopPlayback();
      return;
    }

    audioRef.current?.pause();
    setNotice("");
    setCutIndex(targetCut);
    setPlayState({ line: targetLine, mode });

    const audio = new Audio(assetUrl("sound", line.audio));
    audioRef.current = audio;
    audio.onended = () => {
      if (mode === "line") {
        setPlayState(null);
        return;
      }
      if (targetLine + 1 < c.lines.length) {
        playLine(targetCut, targetLine + 1, mode);
      } else if (mode === "all" && targetCut + 1 < cuts.length) {
        playLine(targetCut + 1, 0, mode);
      } else {
        stopPlayback();
      }
    };
    audio.onerror = () => {
      setNotice(`오디오를 불러오지 못했습니다: ${line.audio}`);
      stopPlayback();
    };
    void audio.play().catch(() => {
      setNotice(`오디오를 재생하지 못했습니다: ${line.audio}`);
      stopPlayback();
    });
  }

  function selectCut(index: number) {
    stopPlayback();
    setImagePickerOpen(false);
    setLinePickerOpen(false);
    setCutIndex(index);
  }

  /** 컷 하나를 고치고 durationSec 을 다시 계산한다 */
  function updateCut(index: number, patch: Partial<PlanCut>) {
    setCuts((prev) =>
      prev.map((c, i) => {
        if (i !== index) return c;
        const next = { ...c, ...patch };
        next.durationSec =
          Math.round(next.lines.reduce((s, l) => s + (l.durationSec ?? 0), 0) * 10) / 10;
        return next;
      }),
    );
    setDirty(true);
  }

  function moveLine(i: number, delta: number) {
    const j = i + delta;
    if (j < 0 || j >= cut.lines.length) return;
    stopPlayback();
    const lines = [...cut.lines];
    [lines[i], lines[j]] = [lines[j], lines[i]];
    updateCut(cutIndex, { lines });
  }

  function removeLine(i: number) {
    stopPlayback();
    updateCut(cutIndex, { lines: cut.lines.filter((_, idx) => idx !== i) });
  }

  function addLine(audio: string) {
    stopPlayback();
    const known = LINE_INFO.get(audio);
    const line: PlanLine = known
      ? { ...known }
      : { speaker: "내레이션", text: `(대사 미지정 — ${audio})`, audio, durationSec: null };
    updateCut(cutIndex, { lines: [...cut.lines, line] });
  }

  function changeImage(file: string) {
    updateCut(cutIndex, {
      image: file,
      needsNewImage: file.includes("이미지 교체 필요"),
    });
    setImagePickerOpen(false);
  }

  /** 현재 컷 아래에 빈 컷을 추가한다 — 이미지는 우선 현재 컷 것을 물려받는다 */
  function addCut() {
    stopPlayback();
    let n = 1;
    while (cuts.some((c) => c.id === `n${n}`)) n++;
    const added: PlanCut = {
      id: `n${n}`,
      scene: cut.scene,
      chapter: cut.chapter,
      title: "새 컷",
      kind: "linear",
      image: cut.image || (assets?.image[0] ?? ""),
      needsNewImage: false,
      screenTransition: false,
      after: null,
      effect: { camera: "none", enter: "none" },
      lines: [],
      durationSec: 0,
    };
    setCuts((prev) => [
      ...prev.slice(0, cutIndex + 1),
      added,
      ...prev.slice(cutIndex + 1),
    ]);
    setCutIndex(cutIndex + 1);
    setDirty(true);
  }

  function removeCut() {
    if (cuts.length <= 1) return;
    if (!window.confirm(`"${cut.id}. ${cut.title}" 컷을 삭제할까요?`)) return;
    stopPlayback();
    setCuts((prev) => prev.filter((_, i) => i !== cutIndex));
    setCutIndex(Math.min(cutIndex, cuts.length - 2));
    setDirty(true);
  }

  function moveCut(delta: number) {
    const j = cutIndex + delta;
    if (j < 0 || j >= cuts.length) return;
    stopPlayback();
    setCuts((prev) => {
      const next = [...prev];
      [next[cutIndex], next[j]] = [next[j], next[cutIndex]];
      return next;
    });
    setCutIndex(j);
    setDirty(true);
  }

  /** 대사 추가 목록에서 ▶ — 연결 전에 들어 본다 */
  function auditionSound(file: string) {
    previewRef.current?.pause();
    const audio = new Audio(assetUrl("sound", file));
    previewRef.current = audio;
    void audio.play().catch(() => setNotice(`오디오를 재생하지 못했습니다: ${file}`));
  }

  async function savePlan() {
    setSaving(true);
    setNotice("");
    try {
      const res = await fetch("/api/dev/video-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...VIDEO_PLAN, cuts }),
      });
      if (!res.ok) {
        const detail = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(detail?.error ?? `저장 실패 (${res.status})`);
      }
      setDirty(false);
      setNotice("저장했습니다 — src/stories/fart-bride/video-plan.json");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  const currentLine = playState ? cut.lines[playState.line] : null;
  const playKey = `${cut.id}:${replayKey}`;
  const filteredSounds = (assets?.sound ?? []).filter((f) => {
    if (!lineFilter.trim()) return true;
    const info = LINE_INFO.get(f);
    const keyword = lineFilter.trim();
    return f.includes(keyword) || (info?.text.includes(keyword) ?? false);
  });

  return (
    <main className="min-h-screen bg-app-bg px-6 py-8">
      <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-[26px] font-extrabold text-ink">
              영상 제작 도우미 — {VIDEO_PLAN.title}
            </h1>
            <p className="text-[13px] text-ink-muted">
              컷 구성: src/stories/fart-bride/video-plan.json · 총 {cuts.length}컷 ·{" "}
              {formatTime(totalSec)} (STT·미니게임 대기 제외)
              {replaceCount > 0 && ` · 교체 필요 이미지 ${replaceCount}장`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {dirty && (
              <span className="text-[13px] font-bold text-point-strong">
                저장하지 않은 변경
              </span>
            )}
            <button
              type="button"
              onClick={savePlan}
              disabled={!dirty || saving}
              className="rounded-xl bg-primary px-6 py-2.5 text-[15px] font-extrabold text-white disabled:opacity-40"
            >
              {saving ? "저장 중..." : "저장"}
            </button>
          </div>
        </header>

        {notice && (
          <p className="rounded-xl bg-surface px-4 py-2 text-[13px] font-bold text-ink-soft shadow-panel">
            {notice}
          </p>
        )}

        <div className="flex flex-col gap-6 lg:flex-row">
          {/* ---------- 컷 목록 ---------- */}
          <aside className="flex max-h-[760px] w-full shrink-0 flex-col gap-1 overflow-y-auto rounded-2xl bg-surface p-3 shadow-panel lg:w-[340px]">
            {cuts.map((c, i) => (
              <button
                key={c.id}
                type="button"
                onClick={() => selectCut(i)}
                className={`flex flex-col gap-1 rounded-xl px-3 py-2 text-left ${
                  i === cutIndex ? "bg-primary-soft" : "hover:bg-chip"
                }`}
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-[13px] font-extrabold text-ink">
                    {c.id}. {c.title}
                  </span>
                  <span className="ml-auto shrink-0 text-[12px] text-ink-faint">
                    {formatTime(startTimes[i])} · {c.durationSec.toFixed(1)}s
                  </span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {c.needsNewImage && (
                    <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-bold text-point-strong">
                      이미지 교체 필요
                    </span>
                  )}
                  {c.effect.enter !== "none" && (
                    <span className="rounded bg-chip px-1.5 py-0.5 text-[11px] font-bold text-ink-mid">
                      {ENTER_EFFECT_LABELS[c.effect.enter].split(" — ")[0]}
                    </span>
                  )}
                  {c.effect.camera !== "none" && (
                    <span className="rounded bg-chip px-1.5 py-0.5 text-[11px] font-bold text-ink-mid">
                      {CAMERA_EFFECT_LABELS[c.effect.camera].split(" — ")[0]}
                    </span>
                  )}
                  {(c.effect.overlay ?? "none") !== "none" && (
                    <span className="rounded bg-chip px-1.5 py-0.5 text-[11px] font-bold text-ink-mid">
                      {OVERLAY_EFFECT_LABELS[c.effect.overlay ?? "none"].split(" — ")[0]}
                    </span>
                  )}
                  {c.after && (
                    <span className="rounded bg-primary-pale px-1.5 py-0.5 text-[11px] font-bold text-primary-strong">
                      {AFTER_LABELS[c.after]}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </aside>

          {/* ---------- 미리보기 + 편집 ---------- */}
          <section className="flex min-w-0 flex-1 flex-col gap-4">
            <div className="relative aspect-[1672/941] w-full overflow-hidden rounded-2xl bg-black shadow-panel">
              <div className="absolute inset-0">
                <OverlayLayer effect={cut.effect.overlay ?? "none"} playKey={playKey}>
                  <EnterLayer effect={cut.effect.enter} playKey={playKey}>
                    <CameraLayer
                      effect={cut.effect.camera}
                      durationMs={Math.max(cut.durationSec, 4) * 1000}
                      playKey={playKey}
                    >
                      <div className="relative h-full w-full">
                        <Image
                          key={cut.image}
                          src={assetUrl("image", cut.image)}
                          alt={`${cut.id}. ${cut.title}`}
                          fill
                          unoptimized
                          className="object-contain"
                        />
                      </div>
                    </CameraLayer>
                  </EnterLayer>
                </OverlayLayer>
              </div>
              {currentLine && (
                <p className="absolute inset-x-6 bottom-4 rounded-xl bg-black/60 px-4 py-3 text-center text-[18px] font-bold text-white">
                  {currentLine.speaker !== "내레이션" && (
                    <span className="mr-2 text-primary">{currentLine.speaker}</span>
                  )}
                  {currentLine.text}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => playLine(cutIndex, 0, "cut")}
                className="rounded-xl bg-primary px-5 py-2.5 text-[15px] font-extrabold text-white"
              >
                컷 재생
              </button>
              <button
                type="button"
                onClick={() => playLine(cutIndex, 0, "all")}
                className="rounded-xl bg-primary-strong px-5 py-2.5 text-[15px] font-extrabold text-white"
              >
                여기부터 전체 재생
              </button>
              {playState && (
                <button
                  type="button"
                  onClick={stopPlayback}
                  className="rounded-xl bg-point-strong px-5 py-2.5 text-[15px] font-extrabold text-white"
                >
                  정지
                </button>
              )}
              <button
                type="button"
                onClick={() => setReplayKey((k) => k + 1)}
                className="rounded-xl bg-chip px-4 py-2.5 text-[15px] font-bold text-ink"
              >
                연출 다시 보기
              </button>
              <span className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => selectCut(Math.max(cutIndex - 1, 0))}
                  disabled={cutIndex === 0}
                  className="rounded-xl bg-chip px-4 py-2.5 text-[15px] font-bold text-ink disabled:opacity-40"
                >
                  ← 이전 컷
                </button>
                <button
                  type="button"
                  onClick={() => selectCut(Math.min(cutIndex + 1, cuts.length - 1))}
                  disabled={cutIndex === cuts.length - 1}
                  className="rounded-xl bg-chip px-4 py-2.5 text-[15px] font-bold text-ink disabled:opacity-40"
                >
                  다음 컷 →
                </button>
              </span>
            </div>

            {/* ---------- 컷 편집 (추가·이동·삭제) ---------- */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-bold text-ink-faint">컷 편집:</span>
              <button
                type="button"
                onClick={addCut}
                className="rounded-xl bg-primary px-4 py-2 text-[13px] font-extrabold text-white"
              >
                + 아래에 새 컷
              </button>
              <button
                type="button"
                onClick={() => moveCut(-1)}
                disabled={cutIndex === 0}
                className="rounded-xl bg-chip px-4 py-2 text-[13px] font-bold text-ink disabled:opacity-40"
              >
                ↑ 위로
              </button>
              <button
                type="button"
                onClick={() => moveCut(1)}
                disabled={cutIndex === cuts.length - 1}
                className="rounded-xl bg-chip px-4 py-2 text-[13px] font-bold text-ink disabled:opacity-40"
              >
                ↓ 아래로
              </button>
              <button
                type="button"
                onClick={removeCut}
                disabled={cuts.length <= 1}
                className="rounded-xl bg-chip px-4 py-2 text-[13px] font-bold text-point-strong disabled:opacity-40"
              >
                컷 삭제
              </button>
            </div>

            {cut.after && (
              <p className="rounded-xl bg-primary-pale px-4 py-3 text-[14px] font-bold text-primary-strong">
                이 컷 뒤: {AFTER_LABELS[cut.after]} — 영상 재생에서는 건너뛰고 다음
                컷으로 넘어갑니다.
              </p>
            )}

            {/* ---------- 연출 ---------- */}
            <div className="flex flex-wrap gap-4 rounded-2xl bg-surface p-4 shadow-panel">
              <label className="flex min-w-[220px] flex-1 flex-col gap-1">
                <span className="text-[13px] font-bold text-ink-soft">등장 전환</span>
                <select
                  value={cut.effect.enter}
                  onChange={(e) =>
                    updateCut(cutIndex, {
                      effect: { ...cut.effect, enter: e.target.value as EnterEffect },
                    })
                  }
                  className="rounded-xl border border-divider bg-white px-3 py-2.5 text-[14px] text-ink outline-none focus:border-primary"
                >
                  {(Object.keys(ENTER_EFFECT_LABELS) as EnterEffect[]).map((key) => (
                    <option key={key} value={key}>
                      {ENTER_EFFECT_LABELS[key]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-[220px] flex-1 flex-col gap-1">
                <span className="text-[13px] font-bold text-ink-soft">카메라</span>
                <select
                  value={cut.effect.camera}
                  onChange={(e) =>
                    updateCut(cutIndex, {
                      effect: { ...cut.effect, camera: e.target.value as CameraEffect },
                    })
                  }
                  className="rounded-xl border border-divider bg-white px-3 py-2.5 text-[14px] text-ink outline-none focus:border-primary"
                >
                  {(Object.keys(CAMERA_EFFECT_LABELS) as CameraEffect[]).map((key) => (
                    <option key={key} value={key}>
                      {CAMERA_EFFECT_LABELS[key]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-[220px] flex-1 flex-col gap-1">
                <span className="text-[13px] font-bold text-ink-soft">화면 오버레이</span>
                <select
                  value={cut.effect.overlay ?? "none"}
                  onChange={(e) =>
                    updateCut(cutIndex, {
                      effect: { ...cut.effect, overlay: e.target.value as OverlayEffect },
                    })
                  }
                  className="rounded-xl border border-divider bg-white px-3 py-2.5 text-[14px] text-ink outline-none focus:border-primary"
                >
                  {(Object.keys(OVERLAY_EFFECT_LABELS) as OverlayEffect[]).map((key) => (
                    <option key={key} value={key}>
                      {OVERLAY_EFFECT_LABELS[key]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* ---------- 대사 목록 (연결 편집) ---------- */}
            <div className="flex flex-col gap-1 rounded-2xl bg-surface p-4 shadow-panel">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h2 className="flex min-w-0 flex-1 items-baseline gap-2 text-[16px] font-extrabold text-ink">
                  <span className="shrink-0">{cut.id}.</span>
                  {/* 제목은 바로 고칠 수 있다 — 새로 추가한 컷 이름 짓기용 */}
                  <input
                    value={cut.title}
                    onChange={(e) => updateCut(cutIndex, { title: e.target.value })}
                    className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1 font-extrabold text-ink outline-none hover:border-divider focus:border-primary"
                  />
                  <span className="shrink-0 text-[13px] font-bold text-ink-faint">
                    {cut.chapter}
                  </span>
                </h2>
                <button
                  type="button"
                  onClick={() => setLinePickerOpen((open) => !open)}
                  className="rounded-xl bg-primary px-4 py-2 text-[13px] font-extrabold text-white"
                >
                  {linePickerOpen ? "추가 닫기" : "대사 추가"}
                </button>
              </div>

              {cut.lines.length === 0 && (
                <p className="py-2 text-[14px] text-ink-muted">
                  연결된 대사가 없습니다 — &quot;대사 추가&quot;로 연결하세요.
                </p>
              )}

              {cut.lines.map((line, i) => (
                <div
                  key={`${line.audio}-${i}`}
                  className={`flex items-center gap-2 rounded-xl px-3 py-2 ${
                    playState?.line === i ? "bg-primary-soft" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => playLine(cutIndex, i, "line")}
                    className="shrink-0 rounded-lg bg-primary px-2.5 py-1 text-[13px] font-extrabold text-white"
                  >
                    ▶
                  </button>
                  <span className="shrink-0 rounded-lg bg-chip px-2 py-1 text-[12px] font-bold text-ink-mid">
                    {line.speaker}
                  </span>
                  <span className="min-w-0 flex-1 text-[15px] text-ink">{line.text}</span>
                  <span className="shrink-0 text-[12px] text-ink-faint">
                    {line.durationSec != null ? `${line.durationSec.toFixed(1)}s` : "길이 미상"}
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => moveLine(i, -1)}
                      disabled={i === 0}
                      className="rounded-lg bg-chip px-2 py-1 text-[12px] font-bold text-ink disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveLine(i, 1)}
                      disabled={i === cut.lines.length - 1}
                      className="rounded-lg bg-chip px-2 py-1 text-[12px] font-bold text-ink disabled:opacity-30"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeLine(i)}
                      className="rounded-lg bg-chip px-2 py-1 text-[12px] font-bold text-point-strong"
                    >
                      ✕
                    </button>
                  </span>
                </div>
              ))}

              {linePickerOpen && (
                <div className="mt-2 flex flex-col gap-2 rounded-xl bg-primary-soft/40 p-3">
                  <p className="text-[13px] font-bold text-ink-soft">
                    사운드 파일이 있는 대사만 목록에 나옵니다 (
                    {assets ? `${assets.sound.length}개` : "불러오는 중"}).
                  </p>
                  <input
                    value={lineFilter}
                    onChange={(e) => setLineFilter(e.target.value)}
                    placeholder="파일명·대사 내용으로 찾기"
                    className="rounded-xl border border-divider bg-white px-3 py-2 text-[14px] text-ink outline-none focus:border-primary"
                  />
                  <div className="flex max-h-[280px] flex-col gap-1 overflow-y-auto">
                    {filteredSounds.map((file) => {
                      const info = LINE_INFO.get(file);
                      const connected = cut.lines.some((l) => l.audio === file);
                      return (
                        <div
                          key={file}
                          className="flex items-center gap-2 rounded-lg bg-white px-3 py-2"
                        >
                          <button
                            type="button"
                            onClick={() => auditionSound(file)}
                            className="shrink-0 rounded-lg bg-chip px-2 py-1 text-[12px] font-bold text-ink"
                          >
                            ▶
                          </button>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] text-ink">
                              {info ? info.text : "(대사 미지정)"}
                            </span>
                            <span className="block truncate text-[11px] text-ink-faint">
                              {info ? `${info.speaker} · ` : ""}
                              {file}
                            </span>
                          </span>
                          <button
                            type="button"
                            onClick={() => addLine(file)}
                            className="shrink-0 rounded-lg bg-primary px-3 py-1 text-[12px] font-extrabold text-white"
                          >
                            {connected ? "또 추가" : "추가"}
                          </button>
                        </div>
                      );
                    })}
                    {filteredSounds.length === 0 && (
                      <p className="py-2 text-[13px] text-ink-muted">
                        일치하는 사운드가 없습니다.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ---------- 이미지 ---------- */}
            <div className="flex flex-col gap-2 rounded-2xl bg-surface p-4 shadow-panel">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[16px] font-extrabold text-ink">
                  이미지
                  <span className="ml-2 text-[13px] font-bold text-ink-faint">
                    {cut.image}
                  </span>
                </h2>
                <button
                  type="button"
                  onClick={() => setImagePickerOpen((open) => !open)}
                  className="rounded-xl bg-primary px-4 py-2 text-[13px] font-extrabold text-white"
                >
                  {imagePickerOpen ? "선택 닫기" : "이미지 바꾸기"}
                </button>
              </div>
              {imagePickerOpen && (
                <div className="grid max-h-[420px] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
                  {(assets?.image ?? []).map((file) => (
                    <button
                      key={file}
                      type="button"
                      onClick={() => changeImage(file)}
                      className={`flex flex-col gap-1 rounded-xl border-2 p-1 text-left ${
                        file === cut.image
                          ? "border-primary bg-primary-soft"
                          : "border-transparent hover:border-primary-line"
                      }`}
                    >
                      <span className="relative block aspect-video w-full overflow-hidden rounded-lg bg-black">
                        <Image
                          src={assetUrl("image", file)}
                          alt={file}
                          fill
                          unoptimized
                          className="object-cover"
                        />
                      </span>
                      <span className="truncate text-[11px] text-ink-mid">{file}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
