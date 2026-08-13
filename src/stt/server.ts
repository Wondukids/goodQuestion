/**
 * 아이 음성 → 텍스트 (Google Cloud Speech-to-Text v1).
 *
 * 브라우저 MediaRecorder 가 만든 webm/opus 녹음을 그대로 받는다.
 * 키는 서버 env(GOOGLE_CLOUD_API_KEY)에만 두고 클라이언트에 노출하지 않는다 —
 * 서버(라우트 핸들러)에서만 import 한다.
 */

export class SttError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message);
  }
}

/** webm/opus 녹음을 한국어 텍스트로 바꾼다. 무음이면 "" 를 돌려준다. */
export async function recognizeSpeech(
  audio: Buffer,
  channelCount: number,
): Promise<string> {
  const key = process.env.GOOGLE_CLOUD_API_KEY;
  if (!key) {
    throw new SttError(
      "GOOGLE_CLOUD_API_KEY 가 없습니다. .env.local 에 추가하고 서버를 재시작하세요.",
      500,
    );
  }

  const res = await fetch(
    `https://speech.googleapis.com/v1/speech:recognize?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          /* Chrome MediaRecorder 기본값. opus 헤더에 샘플레이트가 있어 명시하지 않는다. */
          encoding: "WEBM_OPUS",
          audioChannelCount: channelCount,
          languageCode: "ko-KR",
          /* 아이 발화라 문장이 짧다 — 대안 없이 최상위 후보만 받는다. */
          maxAlternatives: 1,
        },
        audio: { content: audio.toString("base64") },
      }),
    },
  );

  if (!res.ok) {
    throw new SttError(`Google STT 호출 실패 (${res.status})`, 502, await res.text());
  }

  const data = (await res.json()) as {
    results?: { alternatives?: { transcript?: string }[] }[];
  };
  /* 무음이면 results 가 아예 없다 — "" 로 돌려서 호출자가 재시도를 판단한다. */
  return (data.results ?? [])
    .map((r) => r.alternatives?.[0]?.transcript ?? "")
    .join(" ")
    .trim();
}
