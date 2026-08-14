/**
 * 브라우저 → TTS 라우트(/api/fart-bride/tts) 호출 헬퍼.
 * 합성 자체는 서버(src/tts/server.ts)가 한다 — 키를 클라이언트에 노출하지 않기 위해서다.
 */

export type SpeechRequest = {
  text: string;
  /** Gemini TTS 보이스 이름 (data.ts 의 speaker.voice) */
  voice: string;
  /** 말투 연기 지시 (Gemini 경로만 반영) */
  stylePrompt?: string;
  /** true 면 폴백 없이 gemini-api-2.5-flash-tts 로 고정 — 실패는 에러로 드러난다 */
  geminiOnly?: boolean;
};

export type SpeechResult = {
  audio: Blob;
  /** 어느 모델 경로로 합성했는지 (응답 헤더 X-TTS-Model, 없으면 null) */
  model: string | null;
};

/** requestSpeech 에 더해 어느 모델 경로였는지도 받는다 — 테스트·디버깅용. */
export async function requestSpeechDetailed(
  request: SpeechRequest,
): Promise<SpeechResult> {
  const res = await fetch("/api/fart-bride/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `TTS 실패 (${res.status})`);
  }
  return { audio: await res.blob(), model: res.headers.get("X-TTS-Model") };
}

/** 캐릭터 음성을 합성해 오디오 Blob 으로 받는다. 실패하면 서버가 준 메시지로 throw. */
export async function requestSpeech(request: SpeechRequest): Promise<Blob> {
  return (await requestSpeechDetailed(request)).audio;
}
