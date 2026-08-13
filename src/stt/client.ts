/**
 * 브라우저 → STT 라우트(/api/fart-bride/stt) 호출 헬퍼.
 * 인식 자체는 서버(src/stt/server.ts)가 한다 — 키를 클라이언트에 노출하지 않기 위해서다.
 */

/** 녹음 Blob 을 텍스트로 바꾼다. 무음이면 "" 를 돌려준다. 실패하면 서버 메시지로 throw. */
export async function transcribeAudio(
  audio: Blob,
  channelCount: number,
): Promise<string> {
  const res = await fetch("/api/fart-bride/stt", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      /* 마이크가 스테레오면 opus 헤더와 STT config 채널 수가 어긋난다 —
         녹음 때 읽어 둔 채널 수를 서버에 알려 준다. */
      "X-Audio-Channels": String(channelCount),
    },
    body: audio,
  });
  const data = (await res.json()) as { transcript?: string; error?: string };
  if (!res.ok) throw new Error(data.error ?? `STT 실패 (${res.status})`);
  return (data.transcript ?? "").trim();
}
