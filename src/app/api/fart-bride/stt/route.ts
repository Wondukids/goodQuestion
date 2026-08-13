import { NextResponse } from "next/server";
import { recognizeSpeech, SttError } from "@/stt/server";

/**
 * 아이 음성 → 텍스트. Google STT 호출은 src/stt/server.ts 에 있다.
 * 브라우저 MediaRecorder 가 만든 webm/opus 녹음을 body 로 그대로 받는다.
 */
export async function POST(request: Request) {
  const audio = Buffer.from(await request.arrayBuffer());
  if (audio.length === 0) {
    return NextResponse.json({ error: "녹음 데이터가 비어 있습니다." }, { status: 400 });
  }

  /* 마이크가 스테레오면 opus 헤더와 config 채널 수가 어긋나 400 이 난다.
     클라이언트가 트랙 설정에서 읽은 채널 수를 헤더로 보내 준다. */
  const channels = Number(request.headers.get("x-audio-channels")) || 1;

  try {
    /* 무음이면 transcript: "" — 클라이언트가 재시도를 판단한다. */
    return NextResponse.json({ transcript: await recognizeSpeech(audio, channels) });
  } catch (error) {
    if (error instanceof SttError) {
      return NextResponse.json(
        { error: error.message, detail: error.detail },
        { status: error.status },
      );
    }
    throw error;
  }
}
