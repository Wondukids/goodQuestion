"use client";

import { useEffect, useState } from "react";
import { requestSpeech } from "@/tts/client";
import type { TtsVoice } from "@/tts/voices";

/**
 * 캐릭터 대사 한 줄을 TTS 로 합성한다.
 *
 * 같은 문장은 서버가 캐시하므로 되돌아와도 구글을 다시 부르지 않는다.
 * 실패하면(분당 한도 등) failed 로 알리고 끝 — 대사는 패널에 글로 남아 있어
 * 흐름은 이어진다. 미션 화면이 음성 때문에 멈추는 일은 없어야 한다.
 */
export function useNpcVoice(
  text: string,
  speaker: { voice: TtsVoice; stylePrompt: string },
) {
  /* 어느 문장의 결과인지 함께 들고 있어야, 대사가 바뀐 순간
     이전 문장의 음성을 잘못 물려주지 않는다 (url === null 이면 합성 실패) */
  const [result, setResult] = useState<{ text: string; url: string | null } | null>(null);

  const { voice, stylePrompt } = speaker;

  useEffect(() => {
    /* 빈 문장 = 이번 대사는 합성이 필요 없다(사전 녹음이 맡는다) — 호출을 건너뛴다.
       아래 current 가 문장 불일치로 걸러 주므로 지난 결과를 지울 필요도 없다 */
    if (!text) return;
    let cancelled = false;
    let objectUrl: string | null = null;

    (async () => {
      try {
        const speech = await requestSpeech({ text, voice, stylePrompt, geminiOnly: true });
        if (cancelled) return;
        objectUrl = URL.createObjectURL(speech);
        setResult({ text, url: objectUrl });
      } catch {
        if (!cancelled) setResult({ text, url: null });
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [text, voice, stylePrompt]);

  const current = result?.text === text ? result : null;
  return { url: current?.url ?? null, failed: current !== null && current.url === null };
}
