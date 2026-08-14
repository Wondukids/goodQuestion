import { NextResponse } from "next/server";
import { synthesizeSpeech, TtsError } from "@/tts/server";

/**
 * 텍스트 → 캐릭터 음성. 합성 로직(모델 폴백 순서 포함)은 src/tts/server.ts 에 있다.
 * 어느 모델 경로였는지는 응답 헤더 X-TTS-Model 로 확인한다.
 */
export async function POST(request: Request) {
  const { text, voice, stylePrompt, geminiOnly } = (await request.json()) as {
    text?: string;
    voice?: string;
    stylePrompt?: string;
    geminiOnly?: boolean;
  };
  if (!text?.trim()) {
    return NextResponse.json({ error: "text 가 비어 있습니다." }, { status: 400 });
  }

  try {
    const { audio, contentType, model } = await synthesizeSpeech(text, voice, stylePrompt, {
      geminiOnly: geminiOnly === true,
    });
    return new NextResponse(audio, {
      headers: { "Content-Type": contentType, "X-TTS-Model": model },
    });
  } catch (error) {
    if (error instanceof TtsError) {
      return NextResponse.json(
        { error: error.message, detail: error.detail },
        { status: error.status },
      );
    }
    throw error;
  }
}
