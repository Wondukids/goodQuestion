/**
 * video-plan.json(/dev/video-maker 에서 편집·저장) → 재생 스텝 변환.
 *
 * 재생 화면(play.tsx)이 mp4 파트 대신 이 변환 결과를 쓴다 — 도우미에서
 * "저장"한 컷 구성이 그대로 실제 이야기 재생이 된다.
 *
 * - 연속된 linear 컷 → CutsStep 하나 (파트처럼 묶어 cuts-player 가 재생)
 * - question 컷 + 바로 뒤 answer 컷 → InteractiveStep (기존 STT→TTS 대화 씬).
 *   서버 장면 code 는 질문 컷의 **등장 순서**로 잇는다 — n번째 질문 컷이
 *   n번째 code (data.ts SCENE_CODES_IN_ORDER). scene 번호·컷 id 는 재넘버링되면
 *   바뀌어서 열쇠로 못 쓴다.
 *   이미지나 대사가 아직 비어 있는 짝은 대화 씬을 만들 수 없으니 linear 로 둔다.
 * - after: "stt-minigame" 표식은 **편집기 전용**이다 — stt 와 같게 동작한다.
 *   미니게임의 런타임 트리거는 서버 턴 응답(next.kind === "미션시작")이 맡으므로
 *   재생 코드에 배선하지 않는다 (이슈 #20 · 미션 명세 10절 ⑨).
 * - 이미지도 대사도 없는 빈 컷은 보여 줄 게 없어 건너뛴다.
 */

import { SCENE_CODES_IN_ORDER, type CutsStep, type InteractiveStep, type SpeechLine, type Step } from "./data";
import { SPEAKER_VOICES, type ScriptSpeaker } from "./script";
import { assetUrl, VIDEO_PLAN, type PlanCut } from "./video-plan";

/* 화자별 기본 말투 — 플랜에는 말투 지시가 없어 대화 씬 TTS(이름 호명·반응)용으로
   여기서 채운다. data.ts 의 씬별 stylePrompt 와 같은 결. */
const SPEAKER_STYLE: Record<ScriptSpeaker, string> = {
  내레이션:
    "옛날이야기를 들려주는 다정한 이야기꾼처럼, 차분하고 따뜻하게 말해 주세요.",
  며느리:
    "다정하고 조심스러운 젊은 여성이 아이에게 말을 걸듯, 부드럽고 따뜻하게 말해 주세요.",
  시아버지:
    "근엄하지만 속정 있는 할아버지가 아이에게는 낮고 부드러운 목소리로 말해 주세요.",
  이장님: "쾌활한 마을 어른이 너털웃음을 섞어 활기차고 정겹게 말해 주세요.",
};

const isKnownSpeaker = (name: string): name is ScriptSpeaker =>
  name in SPEAKER_VOICES;

const toSpeechLines = (cut: PlanCut): SpeechLine[] =>
  cut.lines.map((l) => ({ text: l.text, audio: assetUrl("sound", l.audio) }));

/** 대화 씬의 화자 — 질문 컷에서 내레이션이 아닌 첫 화자, 없으면 내레이션 */
function pickSpeaker(question: PlanCut): InteractiveStep["speaker"] {
  const name =
    question.lines.map((l) => l.speaker).find((s) => s !== "내레이션") ??
    "내레이션";
  const speaker: ScriptSpeaker = isKnownSpeaker(name) ? name : "내레이션";
  return {
    label: name,
    voice: SPEAKER_VOICES[speaker],
    stylePrompt: SPEAKER_STYLE[speaker],
  };
}

/** 대화 씬으로 만들 수 있는 질문·답변 짝인지 — 이미지·대사가 다 있어야 한다 */
function isDialoguePair(
  question: PlanCut,
  answer: PlanCut | undefined,
): answer is PlanCut {
  return (
    question.kind === "question" &&
    answer?.kind === "answer" &&
    question.image !== "" &&
    answer.image !== "" &&
    question.lines.length > 0 &&
    answer.lines.length > 0
  );
}

function toInteractive(
  question: PlanCut,
  answer: PlanCut,
  sceneCode: string,
): InteractiveStep {
  return {
    kind: "interactive",
    id: question.id,
    sceneId: question.scene,
    /* 빈 문자열이면 서버 장면이 없는 씬 — 대화 씬은 기존 고정 문구 흐름으로 돈다 */
    sceneCode,
    speaker: pickSpeaker(question),
    question: {
      image: assetUrl("image", question.image),
      lines: toSpeechLines(question),
    },
    answer: {
      image: assetUrl("image", answer.image),
      lines: toSpeechLines(answer),
    },
  };
}

/** 저장된 컷 플랜을 재생 스텝으로 바꾼다 */
export function buildPlanSequence(cuts: PlanCut[] = VIDEO_PLAN.cuts): Step[] {
  const steps: Step[] = [];
  let run: PlanCut[] = [];
  let partNo = 0;
  /* 질문 컷 순번 — n번째 질문 컷이 n번째 서버 장면 code 다 (data.ts SCENE_CODES_IN_ORDER).
     미완성 짝(대화 씬이 못 되는 것)도 세어, 하나가 비어도 뒤 대화들이 앞 code 로 밀리지 않는다. */
  let questionNo = 0;

  const flush = () => {
    if (run.length === 0) return;
    partNo += 1;
    const label = run[0].chapter || run[0].title || `${partNo}부`;
    steps.push({ kind: "cuts", id: `cuts${partNo}`, label, cuts: run } satisfies CutsStep);
    run = [];
  };

  for (let i = 0; i < cuts.length; i++) {
    const cut = cuts[i];
    if (cut.kind === "question") questionNo += 1;
    if (isDialoguePair(cut, cuts[i + 1])) {
      flush();
      steps.push(
        toInteractive(cut, cuts[i + 1], SCENE_CODES_IN_ORDER[questionNo - 1] ?? ""),
      );
      i += 1;
      continue;
    }
    if (cut.image === "" && cut.lines.length === 0) continue;
    run.push(cut);
  }
  flush();
  if (questionNo !== SCENE_CODES_IN_ORDER.length) {
    console.warn(
      `[플랜] 질문 컷 ${questionNo}개 ≠ 서버 대화 장면 ${SCENE_CODES_IN_ORDER.length}개 — ` +
        "순서 매핑이 어긋난다. 컷 플랜과 data.ts 의 SCENE_CODES_IN_ORDER 를 맞춰야 한다.",
    );
  }
  return steps;
}
