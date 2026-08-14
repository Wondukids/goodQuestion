/**
 * story_database.json → src/stories/fart-bride/video-plan.json
 *
 * 영상 제작 도우미(/dev/video-maker)가 읽는 컷 시퀀스를 생성한다.
 * 씬을 컷 단위로 평탄화한다: linear 씬 = 컷 1개, interactive 씬 = 질문/답변
 * 컷 2개 (사이의 STT·미니게임 대기는 질문 컷의 after 로 표기).
 * 오디오 길이·이미지 교체 필요 여부는 assets 섹션에서 가져온다.
 *
 * 실행: node content/stories/fart-bride/database/build_video_plan.mjs
 * (story_database.json 을 고친 뒤 다시 실행하면 된다. assets 섹션이 낡았으면
 *  build_assets.ps1 을 먼저 실행할 것.)
 *
 * 기존 video-plan.json 의 컷별 effect(연출)는 재생성 때 유지된다.
 * 단, 도우미 페이지에서 바꾼 이미지·대사 연결은 DB 기준으로 되돌아가므로
 * 확정된 변경은 story_database.json 에 반영해 둘 것.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..", "..");
const db = JSON.parse(readFileSync(path.join(here, "story_database.json"), "utf8"));
const outPath = path.join(repoRoot, "src", "stories", "fart-bride", "video-plan.json");

/* 이전 플랜의 컷별 연출 설정 — 재생성해도 잃지 않는다 */
let prevEffects = {};
try {
  const prev = JSON.parse(readFileSync(outPath, "utf8"));
  prevEffects = Object.fromEntries(
    prev.cuts.filter((c) => c.effect).map((c) => [c.id, c.effect]),
  );
} catch {
  /* 첫 생성이면 없음 */
}

const effectFor = (id, { screenTransition = false } = {}) =>
  prevEffects[id] ?? { camera: "none", enter: screenTransition ? "fade" : "none" };

const speakerName = Object.fromEntries(db.characters.map((c) => [c.id, c.name]));
const audioMeta = db.assets?.audio ?? {};
const imageMeta = db.assets?.images ?? {};

const mapLines = (lines) =>
  lines.map((l) => ({
    speaker: speakerName[l.speaker] ?? l.speaker,
    text: l.text,
    audio: l.audio,
    durationSec: audioMeta[l.audio]?.durationSec ?? null,
  }));

const sumDuration = (lines) =>
  Math.round(lines.reduce((s, l) => s + (l.durationSec ?? 0), 0) * 10) / 10;

const cuts = [];
for (const scene of db.scenes) {
  if (scene.type === "linear") {
    const lines = mapLines(scene.lines);
    cuts.push({
      id: String(scene.id),
      scene: scene.id,
      chapter: scene.chapter,
      title: scene.title,
      kind: "linear",
      image: scene.image,
      needsNewImage: imageMeta[scene.image]?.needsReplacement ?? false,
      screenTransition: scene.screenTransition ?? false,
      after: null,
      effect: effectFor(String(scene.id), scene),
      lines,
      durationSec: sumDuration(lines),
    });
    continue;
  }

  const question = scene.phases.find((p) => p.phase === "question");
  const answer = scene.phases.find((p) => p.phase === "answer");
  const hasMinigame = scene.phases.some((p) => p.phase === "minigame");
  const qLines = mapLines(question.lines);
  const aLines = mapLines(answer.lines);
  cuts.push({
    id: `${scene.id}-1`,
    scene: scene.id,
    chapter: scene.chapter,
    title: `${scene.title} · 질문`,
    kind: "question",
    image: question.image,
    needsNewImage: imageMeta[question.image]?.needsReplacement ?? false,
    screenTransition: false,
    after: hasMinigame ? "stt-minigame" : "stt",
    effect: effectFor(`${scene.id}-1`),
    lines: qLines,
    durationSec: sumDuration(qLines),
  });
  cuts.push({
    id: `${scene.id}-2`,
    scene: scene.id,
    chapter: scene.chapter,
    title: `${scene.title} · 답변`,
    kind: "answer",
    image: answer.image,
    needsNewImage: imageMeta[answer.image]?.needsReplacement ?? false,
    screenTransition: false,
    after: null,
    effect: effectFor(`${scene.id}-2`),
    lines: aLines,
    durationSec: sumDuration(aLines),
  });
}

const plan = {
  story: "fart-bride",
  title: db.meta.title,
  generatedFrom: "content/stories/fart-bride/database/story_database.json",
  regenerate: "node content/stories/fart-bride/database/build_video_plan.mjs",
  assetBase: "/api/dev/story-assets",
  cuts,
};

writeFileSync(outPath, JSON.stringify(plan, null, 2) + "\n");
console.log(
  `video-plan.json: cuts ${cuts.length}, total ${Math.round(
    cuts.reduce((s, c) => s + c.durationSec, 0),
  )}s → ${path.relative(repoRoot, outPath)}`,
);
