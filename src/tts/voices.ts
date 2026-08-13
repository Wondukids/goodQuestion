/**
 * story_database.json 의 성우 매핑 — 내레이션=Despina, 며느리=Leda,
 * 시아버지=Schedar, 이장님=Sadachbia. Gemini-TTS 와 Chirp3-HD 가
 * 같은 보이스 페르소나를 공유한다.
 *
 * 서버·클라이언트 어디서든 import 해도 되는 순수 데이터 모듈.
 */

export const TTS_VOICES = ["Despina", "Leda", "Schedar", "Sadachbia"] as const;

export type TtsVoice = (typeof TTS_VOICES)[number];

/** 내레이션 보이스 — 허용 밖 이름이 오면 여기로 되돌린다 */
export const DEFAULT_VOICE: TtsVoice = "Despina";

export function resolveVoice(voice: string | undefined): TtsVoice {
  return (TTS_VOICES as readonly string[]).includes(voice ?? "")
    ? (voice as TtsVoice)
    : DEFAULT_VOICE;
}
