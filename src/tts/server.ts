/**
 * 텍스트 → 캐릭터 음성 (Gemini 2.5 Flash TTS, 폴백 Chirp3-HD).
 *
 * 시도 순서 — 결과의 model(라우트가 X-TTS-Model 헤더로 내린다)로 어느 경로였는지 확인:
 *  1. GEMINI_API_KEY 가 있으면 Gemini API (AI Studio 키, Vertex 권한 불필요)
 *  2. Cloud TTS 의 Gemini-TTS (프로젝트에 Vertex AI 권한이 잡히면 동작)
 *  3. Chirp3-HD (항상 동작하는 안전망)
 *
 * 키는 서버 env 에만 두고 클라이언트에 노출하지 않는다 — 서버에서만 import 한다.
 */
import { resolveVoice } from "./voices";

export class TtsError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message);
  }
}

export type SynthesizedSpeech = {
  /* Buffer<ArrayBuffer> 로 좁혀야 NextResponse body(BodyInit)로 바로 쓸 수 있다 */
  audio: Buffer<ArrayBuffer>;
  contentType: string;
  /** 어느 모델 경로로 합성했는지 */
  model: string;
};

/** Gemini API 는 원시 PCM(16bit mono)을 주므로 WAV 헤더를 씌워 반환한다. */
function pcmToWav(pcm: Buffer, sampleRate: number) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function tryGeminiApi(
  geminiKey: string,
  text: string,
  voiceName: string,
  stylePrompt?: string,
): Promise<SynthesizedSpeech | null> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              /* TTS 전용 모델은 앞머리의 자연어 지시를 말투로 해석한다 */
              { text: stylePrompt ? `${stylePrompt}\n\n${text}` : text },
            ],
          },
        ],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          },
        },
      }),
    },
  );
  if (!res.ok) return null;

  const data = (await res.json()) as {
    candidates?: {
      content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] };
    }[];
  };
  const inline = data.candidates?.[0]?.content?.parts?.find(
    (part) => part.inlineData?.data,
  )?.inlineData;
  if (!inline?.data) return null;

  const rate = Number(/rate=(\d+)/.exec(inline.mimeType ?? "")?.[1] ?? 24000);
  return {
    audio: pcmToWav(Buffer.from(inline.data, "base64"), rate),
    contentType: "audio/wav",
    model: "gemini-api-2.5-flash-tts",
  };
}

/** stylePrompt 로 말투 연기를 지시할 수 있다 (Gemini 경로만 반영). */
export async function synthesizeSpeech(
  text: string,
  voice?: string,
  stylePrompt?: string,
): Promise<SynthesizedSpeech> {
  const key = process.env.GOOGLE_CLOUD_API_KEY;
  if (!key) {
    throw new TtsError(
      "GOOGLE_CLOUD_API_KEY 가 없습니다. .env.local 에 추가하고 서버를 재시작하세요.",
      500,
    );
  }

  const voiceName = resolveVoice(voice);

  /* 1차: Gemini API (키가 설정된 경우에만) */
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    const result = await tryGeminiApi(geminiKey, text, voiceName, stylePrompt);
    if (result) return result;
  }

  const synthesize = (body: object) =>
    fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  /* 2차: Cloud TTS 의 Gemini-TTS — API 키 호출에 Vertex AI 권한이 없으면 403 */
  let model = "gemini-2.5-flash-tts";
  let res = await synthesize({
    input: stylePrompt ? { text, prompt: stylePrompt } : { text },
    voice: { languageCode: "ko-KR", name: voiceName, modelName: model },
    audioConfig: { audioEncoding: "MP3" },
  });

  /* 3차: Chirp3-HD — 항상 동작하는 안전망 */
  if (!res.ok) {
    model = "chirp3-hd-fallback";
    res = await synthesize({
      input: { text },
      voice: { languageCode: "ko-KR", name: `ko-KR-Chirp3-HD-${voiceName}` },
      audioConfig: { audioEncoding: "MP3" },
    });
  }

  if (!res.ok) {
    throw new TtsError(`Google TTS 호출 실패 (${res.status})`, 502, await res.text());
  }

  const { audioContent } = (await res.json()) as { audioContent?: string };
  if (!audioContent) {
    throw new TtsError("TTS 응답에 오디오가 없습니다.", 502);
  }

  return {
    audio: Buffer.from(audioContent, "base64"),
    contentType: "audio/mpeg",
    model,
  };
}
