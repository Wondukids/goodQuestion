/**
 * 영상 자막 타이밍 생성기.
 *
 * story_database.json 의 씬 대사·음성 길이(durationSec)를 파트별로 누적해
 * src/stories/fart-bride/subtitles.ts 를 만든다.
 *
 * 영상 길이가 음성 합보다 긴 만큼(편집 여백·전환 연출)은 "앞·사이·뒤"에
 * 균등한 무음 간격이 있다고 가정하고 분배한다. 실제로 보면서 어긋나는
 * 파트가 있으면 VIDEO_DURATIONS 옆에 파트별 보정값을 추가할 것.
 *
 * 실행: node build_subtitles.mjs   (영상을 다시 편집했으면 ffprobe 로
 * VIDEO_DURATIONS 를 갱신한 뒤 재실행)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = JSON.parse(
  fs.readFileSync(path.join(here, "story_database.json"), "utf8"),
);

/* 파트 ↔ 씬 매핑 (video/ 폴더의 파일명과 동일한 구분) */
const PARTS = [
  { id: "part1", scenes: [1, 2, 3] },
  { id: "part2", scenes: [5, 6] },
  { id: "part3", scenes: [8, 9] },
  { id: "part4", scenes: [11, 12, 13, 14, 15] },
  { id: "part5", scenes: [17, 18] },
];

/* ffprobe 로 잰 실제 영상 길이(초) */
const VIDEO_DURATIONS = {
  part1: 73.94,
  part2: 53.8,
  part3: 91.97,
  part4: 130.97,
  part5: 64.79,
};

const nameById = Object.fromEntries(db.characters.map((c) => [c.id, c.name]));
const sceneById = Object.fromEntries(db.scenes.map((s) => [s.id, s]));
const round = (n) => Math.round(n * 100) / 100;

const result = {};
for (const part of PARTS) {
  const lines = part.scenes.flatMap((sceneId) => sceneById[sceneId].lines);
  const audioSum = lines.reduce(
    (sum, line) => sum + db.assets.audio[line.audio].durationSec,
    0,
  );
  const videoDur = VIDEO_DURATIONS[part.id];
  /* 앞 + 줄 사이 + 뒤 = lines.length + 1 개의 균등 간격 */
  const gap = Math.max(0, (videoDur - audioSum) / (lines.length + 1));

  let t = gap;
  const cues = [];
  for (const line of lines) {
    const dur = db.assets.audio[line.audio].durationSec;
    cues.push({
      start: round(t),
      end: round(t + dur),
      /* 내레이션은 화자 표기를 생략한다 */
      speaker: line.speaker === "narrator" ? "" : nameById[line.speaker],
      text: line.text,
    });
    t += dur + gap;
  }
  result[part.id] = cues;
  console.log(
    `${part.id}: lines=${lines.length} audio=${round(audioSum)}s video=${videoDur}s gap=${round(gap)}s`,
  );
}

const out = `/* 자동 생성 파일 — 직접 수정하지 말 것.
 * content/stories/fart-bride/database/build_subtitles.mjs 가
 * story_database.json 의 음성 길이로 타이밍을 계산해 생성한다.
 * 재생성: node content/stories/fart-bride/database/build_subtitles.mjs
 */

export type SubtitleCue = {
  start: number;
  end: number;
  /** 빈 문자열이면 내레이션 */
  speaker: string;
  text: string;
};

export const VIDEO_SUBTITLES: Record<string, SubtitleCue[]> = ${JSON.stringify(result, null, 2)};
`;

const target = path.join(
  here,
  "../../../../src/stories/fart-bride/subtitles.ts",
);
fs.writeFileSync(target, out);
console.log(`written: ${path.resolve(target)}`);
