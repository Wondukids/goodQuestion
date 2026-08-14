"use client";

import { useEffect, useRef, useState } from "react";
import {
  SCRIPT,
  SPEAKER_VOICES,
  type ScriptLine,
} from "@/stories/fart-bride/script";
import { transcribeAudio } from "@/stt/client";
import { startRecording, type Recording } from "@/stt/record";
import { requestSpeechDetailed } from "@/tts/client";
import { TTS_VOICES, type TtsVoice } from "@/tts/voices";

/**
 * STT·TTS 개인 테스트 페이지 — 로그인 없이 /dev/voice-test 로 바로 연다.
 *
 * 실제 재생 흐름과 같은 헬퍼(src/stt, src/tts)를 그대로 호출하므로
 * 키 설정·모델 폴백(X-TTS-Model)·마이크 녹음을 이야기 화면 밖에서
 * 따로따로 확인할 수 있다. 배포 화면과 무관한 개발 도구라 (main)
 * 레이아웃 밖 /dev 아래에 둔다.
 */

const VOICE_LABELS: Record<TtsVoice, string> = {
  Despina: "Despina — 내레이션",
  Leda: "Leda — 며느리",
  Schedar: "Schedar — 시아버지",
  Sadachbia: "Sadachbia — 이장님",
};

type TtsResult = {
  url: string;
  model: string | null;
  ms: number;
  kb: number;
  /** 다운로드 파일 확장자 — Gemini API 경로는 wav, Cloud TTS 경로는 mp3 */
  ext: string;
};

type SttResult = {
  /** STT 가 실패해도 녹음 재생은 되도록 transcript 만 null 로 둔다 */
  transcript: string | null;
  url: string;
  ms: number;
  channels: number;
};

export default function VoiceTestPage() {
  /* ---------- TTS ---------- */
  const [text, setText] = useState(
    "옛날 어느 마을에 방귀를 아주 잘 뀌는 며느리가 살았어요.",
  );
  const [voice, setVoice] = useState<TtsVoice>("Despina");
  const [stylePrompt, setStylePrompt] = useState("");
  const [geminiOnly, setGeminiOnly] = useState(true);
  const [ttsBusy, setTtsBusy] = useState(false);
  const [ttsResult, setTtsResult] = useState<TtsResult | null>(null);
  const [ttsError, setTtsError] = useState("");

  /* ---------- 대본 불러오기 ---------- */
  const [sectionIndex, setSectionIndex] = useState(0);
  const section = SCRIPT[sectionIndex];

  /** 대본 한 줄을 TTS 입력(텍스트·보이스·말투 지시)으로 채운다 */
  function applyScriptLine(line: ScriptLine) {
    setText(line.text);
    setVoice(SPEAKER_VOICES[line.speaker]);
    setStylePrompt(line.stylePrompt);
  }

  /* ---------- STT ---------- */
  const recordingRef = useRef<Recording | null>(null);
  const [sttPhase, setSttPhase] = useState<"idle" | "recording" | "transcribing">(
    "idle",
  );
  const [recordSec, setRecordSec] = useState(0);
  const [sttResult, setSttResult] = useState<SttResult | null>(null);
  const [sttError, setSttError] = useState("");

  /* 결과가 바뀌거나 페이지를 떠날 때 이전 오디오 URL 을 회수한다 */
  useEffect(() => {
    return () => {
      if (ttsResult) URL.revokeObjectURL(ttsResult.url);
    };
  }, [ttsResult]);
  useEffect(() => {
    return () => {
      if (sttResult) URL.revokeObjectURL(sttResult.url);
    };
  }, [sttResult]);

  /* 페이지 이탈 시 진행 중인 녹음·마이크 정리 */
  useEffect(() => {
    return () => recordingRef.current?.dispose();
  }, []);

  /* 녹음 경과 시간 표시 — 카운터 리셋은 녹음을 시작하는 쪽에서 한다 */
  useEffect(() => {
    if (sttPhase !== "recording") return;
    const timer = setInterval(() => setRecordSec((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [sttPhase]);

  async function handleSynthesize() {
    if (!text.trim() || ttsBusy) return;
    setTtsBusy(true);
    setTtsError("");
    const started = performance.now();
    try {
      const { audio, model } = await requestSpeechDetailed({
        text,
        voice,
        stylePrompt: stylePrompt.trim() || undefined,
        geminiOnly,
      });
      setTtsResult({
        url: URL.createObjectURL(audio),
        model,
        ms: Math.round(performance.now() - started),
        kb: Math.round(audio.size / 1024),
        ext: audio.type.includes("wav") ? "wav" : "mp3",
      });
    } catch (error) {
      setTtsError(error instanceof Error ? error.message : String(error));
    } finally {
      setTtsBusy(false);
    }
  }

  async function handleRecordToggle() {
    if (sttPhase === "recording") {
      recordingRef.current?.stop();
      return;
    }
    if (sttPhase === "transcribing") return;

    setSttError("");
    try {
      recordingRef.current = await startRecording(async (audio, channelCount) => {
        recordingRef.current = null;
        setSttPhase("transcribing");
        const url = URL.createObjectURL(audio);
        const started = performance.now();
        try {
          const transcript = await transcribeAudio(audio, channelCount);
          setSttResult({
            transcript,
            url,
            ms: Math.round(performance.now() - started),
            channels: channelCount,
          });
        } catch (error) {
          /* 실패해도 녹음 자체는 들어볼 수 있게 남긴다 */
          setSttResult({ transcript: null, url, ms: 0, channels: channelCount });
          setSttError(error instanceof Error ? error.message : String(error));
        }
        setSttPhase("idle");
      });
      setRecordSec(0);
      setSttPhase("recording");
    } catch {
      setSttError("마이크를 열지 못했습니다. 브라우저의 마이크 권한을 확인하세요.");
    }
  }

  const recordLabel =
    sttPhase === "recording"
      ? `녹음 중지 (${recordSec}초)`
      : sttPhase === "transcribing"
        ? "인식 중..."
        : "녹음 시작";

  return (
    <main className="min-h-screen bg-app-bg px-6 py-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-[28px] font-extrabold text-ink">
            STT · TTS 테스트
          </h1>
          <p className="text-[14px] text-ink-muted">
            개인 개발용 페이지 — 실제 재생 흐름과 같은 API(/api/fart-bride/*)를
            호출합니다.
          </p>
        </header>

        {/* ---------- 대본 불러오기 ---------- */}
        <section className="flex flex-col gap-5 rounded-3xl bg-surface p-8 shadow-panel">
          <h2 className="text-[20px] font-extrabold text-ink">
            대본 불러오기 — script.md
          </h2>
          <p className="text-[14px] text-ink-muted">
            대사를 누르면 아래 TTS 입력에 텍스트·보이스·말투 지시가 채워집니다.
          </p>

          <select
            value={sectionIndex}
            onChange={(e) => setSectionIndex(Number(e.target.value))}
            className="self-start rounded-xl border border-divider bg-white px-4 py-3 text-[16px] text-ink outline-none focus:border-primary"
          >
            {SCRIPT.map((s, i) => (
              <option key={s.id} value={i}>
                {s.id} · {s.title}
              </option>
            ))}
          </select>

          <div className="flex flex-col gap-2">
            {section.lines.map((line, i) => (
              <button
                key={`${section.id}-${i}`}
                type="button"
                onClick={() => applyScriptLine(line)}
                className="flex items-start gap-3 rounded-xl border border-divider bg-white px-4 py-3 text-left hover:border-primary"
              >
                <span className="shrink-0 rounded-lg bg-chip px-2 py-1 text-[12px] font-bold text-ink-mid">
                  {line.speaker}
                </span>
                <span className="flex flex-col gap-1">
                  <span className="text-[15px] text-ink">{line.text}</span>
                  <span className="text-[12px] text-ink-faint">
                    {line.stylePrompt}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* ---------- TTS ---------- */}
        <section className="flex flex-col gap-5 rounded-3xl bg-surface p-8 shadow-panel">
          <h2 className="text-[20px] font-extrabold text-ink">
            TTS — 텍스트를 음성으로
          </h2>

          <label className="flex flex-col gap-2">
            <span className="text-[14px] font-bold text-ink-soft">텍스트</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              className="resize-y rounded-xl border border-divider bg-white px-4 py-3 text-[16px] text-ink outline-none focus:border-primary"
            />
          </label>

          <div className="flex flex-wrap gap-4">
            <label className="flex min-w-[240px] flex-1 flex-col gap-2">
              <span className="text-[14px] font-bold text-ink-soft">보이스</span>
              <select
                value={voice}
                onChange={(e) => setVoice(e.target.value as TtsVoice)}
                className="rounded-xl border border-divider bg-white px-4 py-3 text-[16px] text-ink outline-none focus:border-primary"
              >
                {TTS_VOICES.map((v) => (
                  <option key={v} value={v}>
                    {VOICE_LABELS[v]}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex min-w-[240px] flex-[2] flex-col gap-2">
              <span className="text-[14px] font-bold text-ink-soft">
                말투 지시 (선택, Gemini 경로만 반영)
              </span>
              <input
                value={stylePrompt}
                onChange={(e) => setStylePrompt(e.target.value)}
                placeholder="예: 다정하게 속삭이듯 말해 줘"
                className="rounded-xl border border-divider bg-white px-4 py-3 text-[16px] text-ink outline-none focus:border-primary"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-[14px] font-bold text-ink-soft">
            <input
              type="checkbox"
              checked={geminiOnly}
              onChange={(e) => setGeminiOnly(e.target.checked)}
              className="h-4 w-4 accent-primary"
            />
            gemini-api-2.5-flash-tts 로 고정 (끄면 Cloud Gemini-TTS → Chirp3-HD
            폴백 허용)
          </label>

          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={handleSynthesize}
              disabled={ttsBusy || !text.trim()}
              className="rounded-xl bg-primary px-8 py-3 text-[18px] font-extrabold text-white disabled:opacity-50"
            >
              {ttsBusy ? "합성 중..." : "합성하기"}
            </button>
            {ttsResult && !ttsBusy && (
              <span className="text-[13px] text-ink-muted">
                모델:{" "}
                <b className="text-ink">{ttsResult.model ?? "알 수 없음"}</b>
              </span>
            )}
          </div>

          {ttsError && (
            <p className="text-[14px] font-bold text-red-600">{ttsError}</p>
          )}

          {ttsResult && (
            <div className="flex flex-col gap-3 rounded-xl bg-primary-soft/50 p-4">
              <audio controls autoPlay src={ttsResult.url} className="w-full" />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-muted">
                <span>{ttsResult.ms.toLocaleString()}ms</span>
                <span>{ttsResult.kb}KB</span>
                <a
                  href={ttsResult.url}
                  download={`tts-test.${ttsResult.ext}`}
                  className="font-bold text-primary-strong underline"
                >
                  다운로드
                </a>
              </div>
            </div>
          )}
        </section>

        {/* ---------- STT ---------- */}
        <section className="flex flex-col gap-5 rounded-3xl bg-surface p-8 shadow-panel">
          <h2 className="text-[20px] font-extrabold text-ink">
            STT — 음성을 텍스트로
          </h2>
          <p className="text-[14px] text-ink-muted">
            녹음 시작 → 말하기 → 녹음 중지를 누르면 인식 결과가 나옵니다. 처음
            사용할 때 브라우저가 마이크 권한을 물어봅니다.
          </p>

          <button
            type="button"
            onClick={handleRecordToggle}
            disabled={sttPhase === "transcribing"}
            className={`self-start rounded-xl px-8 py-3 text-[18px] font-extrabold text-white disabled:opacity-50 ${
              sttPhase === "recording" ? "bg-point-strong" : "bg-primary"
            }`}
          >
            {recordLabel}
          </button>

          {sttError && (
            <p className="text-[14px] font-bold text-red-600">{sttError}</p>
          )}

          {sttResult && (
            <div className="flex flex-col gap-3 rounded-xl bg-primary-soft/50 p-4">
              {sttResult.transcript !== null && (
                <p className="text-[18px] font-bold text-ink">
                  {sttResult.transcript || (
                    <span className="font-normal text-ink-muted">
                      (무음 — 인식된 말이 없습니다)
                    </span>
                  )}
                </p>
              )}
              <audio controls src={sttResult.url} className="w-full" />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-muted">
                {sttResult.transcript !== null && (
                  <span>인식 {sttResult.ms.toLocaleString()}ms</span>
                )}
                <span>채널 {sttResult.channels}</span>
                {sttResult.transcript && (
                  <button
                    type="button"
                    onClick={() => setText(sttResult.transcript ?? "")}
                    className="font-bold text-primary-strong underline"
                  >
                    이 텍스트로 TTS 합성
                  </button>
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
