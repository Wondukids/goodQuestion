/**
 * 마이크 녹음 (브라우저 전용) — STT 로 보낼 webm/opus Blob 을 만든다.
 * MediaRecorder·MediaStream 수명 관리를 여기서 다 맡는다.
 */

/** 진행 중인 녹음 핸들 */
export type Recording = {
  /** 녹음을 끝낸다 — 결과가 onComplete 로 전달된다 */
  stop(): void;
  /** 결과 없이 녹음·마이크를 정리한다 (씬 이탈용). onComplete 는 불리지 않는다. */
  dispose(): void;
};

/**
 * 마이크 녹음을 시작한다. 끝나면(핸들 stop 호출) onComplete 가
 * 녹음 Blob 과 채널 수(STT config 용)를 받는다.
 * 마이크 권한이 없으면 getUserMedia 단계에서 throw 된다.
 */
export async function startRecording(
  onComplete: (audio: Blob, channelCount: number) => void,
): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

  const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  const channelCount = stream.getAudioTracks()[0]?.getSettings().channelCount ?? 1;
  const stopStream = () => stream.getTracks().forEach((track) => track.stop());

  let disposed = false;
  recorder.onstop = () => {
    stopStream();
    if (!disposed) onComplete(new Blob(chunks, { type: mimeType }), channelCount);
  };
  recorder.start();

  return {
    stop() {
      if (recorder.state === "recording") recorder.stop();
    },
    dispose() {
      disposed = true;
      if (recorder.state === "recording") recorder.stop();
      else stopStream();
    },
  };
}
