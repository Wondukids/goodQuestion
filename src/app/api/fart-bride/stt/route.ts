import { NextResponse } from "next/server";

/**
 * 아이 음성 → 텍스트 (Google Cloud Speech-to-Text v1).
 *
 * 브라우저 MediaRecorder 가 만든 webm/opus 녹음을 body 로 그대로 받는다.
 * 키는 서버 env(GOOGLE_CLOUD_API_KEY)에만 두고 클라이언트에 노출하지 않는다.
 */
export async function POST(request: Request) {
  const key = process.env.GOOGLE_CLOUD_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "GOOGLE_CLOUD_API_KEY 가 없습니다. .env.local 에 추가하고 서버를 재시작하세요." },
      { status: 500 },
    );
  }

  const audio = Buffer.from(await request.arrayBuffer());
  if (audio.length === 0) {
    return NextResponse.json({ error: "녹음 데이터가 비어 있습니다." }, { status: 400 });
  }

  /* 마이크가 스테레오면 opus 헤더와 config 채널 수가 어긋나 400 이 난다.
     클라이언트가 트랙 설정에서 읽은 채널 수를 헤더로 보내 준다. */
  const channels = Number(request.headers.get("x-audio-channels")) || 1;

  const res = await fetch(
    `https://speech.googleapis.com/v1/speech:recognize?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          /* Chrome MediaRecorder 기본값. opus 헤더에 샘플레이트가 있어 명시하지 않는다. */
          encoding: "WEBM_OPUS",
          audioChannelCount: channels,
          languageCode: "ko-KR",
          /* 아이 발화라 문장이 짧다 — 대안 없이 최상위 후보만 받는다. */
          maxAlternatives: 1,
        },
        audio: { content: audio.toString("base64") },
      }),
    },
  );

  if (!res.ok) {
    const detail = await res.text();
    return NextResponse.json(
      { error: `Google STT 호출 실패 (${res.status})`, detail },
      { status: 502 },
    );
  }

  const data = (await res.json()) as {
    results?: { alternatives?: { transcript?: string }[] }[];
  };
  const transcript = (data.results ?? [])
    .map((r) => r.alternatives?.[0]?.transcript ?? "")
    .join(" ")
    .trim();

  /* 무음이면 results 가 아예 없다 — transcript: "" 로 내려서 클라이언트가 재시도 판단. */
  return NextResponse.json({ transcript });
}
