/**
 * 미션 API 목 어댑터 (이슈 #20) — 서버(#19)가 아직 없어, `docs/미션_명세.md` 7절
 * 계약 모양의 응답을 고정 지연으로 돌려준다. 이 어댑터는 /dev/minigame 전용 — 아이 앱
 * (play.tsx)은 실구현(REAL_MISSION_API)을 주입하므로, 서버가 착지하면 이 파일은
 * 그대로 두고 목→실 전환만 확인하면 된다.
 *
 * 받아쓰기(STT)만 진짜 라우트를 태운다 — 마이크→미션 턴 배선까지 개발 화면에서
 * 눈으로 보기 위해서다. 판정은 명세의 근사다:
 * - 6자 미만 첫 시도 → 되묻기 (M9 의 SHORT 근사 — 실판정은 발화분석 몫.
 *   옛 프론트 「6자 미만」 규칙이 서버 판정으로 옮겨 온 자리다)
 * - 모든 스텝을 말로 채웠으면 complete 가 장면끝(닫는 말 포함), 무음으로 건너뛴
 *   스텝이 있으면 발화받기(부족 요소 유도) — 두 분기 다 개발 화면에서 재현된다.
 */

import { transcribeAudio } from "@/stt/client";
import { PROPS } from "@/stories/fart-bride/minigame/mission1-script";
import { FRIENDS, LINES as M2_LINES } from "@/stories/fart-bride/minigame/mission2-script";
import type {
  MissionApi,
  MissionCompleteResult,
  MissionConfig,
  MissionEventResult,
  MissionEventType,
  MissionTurnResult,
} from "@/stories/fart-bride/session-api";

/** 명세 4절의 「LLM 직렬 2회 ≈ 20초」 대신 개발 화면용 짧은 고정 지연 */
const DELAY_MS = 600;
const delay = () => new Promise((resolve) => setTimeout(resolve, DELAY_MS));

/** M9 SHORT 근사 — 프론트의 옛 「6자 미만」 규칙을 목 서버 판정으로 옮겨 왔다 */
const SHORT_CHARS = 6;

type MockSession = {
  mission: 1 | 2;
  config: MissionConfig;
  /** 미션1: 'use'|'request' · 미션2: 고른 친구 id */
  step: string | null;
  /** 스텝당 되묻기 1회 (M9) */
  reasked: Set<string>;
  /** 무음으로 건너뛴 스텝 — complete 의 발화받기 분기 재료 */
  skipped: string[];
  /** 미션2 에서 도운 친구 id */
  helped: string[];
  completed: MissionCompleteResult | null;
};

const sessions = new Map<string, MockSession>();
let seq = 0;

/* config 는 명세 6절 jsonc 모양 그대로 — 문구도 명세 원문이다 (프론트 대본은 폴백 사본) */
function mission1Config(): MissionConfig {
  return {
    trigger: { any_elements: ["SOLUTION"], min_turns: 2 },
    items: PROPS.map((p) => ({ id: p.id, name: p.name, desc: p.desc.join(" ") })),
    steps: [
      {
        key: "use",
        expect: "speech",
        ask: "{item} 말인가? {item}(으)로 어떻게 해야 배를 안전하게 딸 수 있겠는가?",
      },
      {
        key: "request",
        expect: "speech",
        ask: "그것 좋은 생각이군. 그런데 며느리가 부끄럽다고 안 해 주면 어쩌나… 뭐라고 부탁을 해야 할까?",
      },
    ],
    reask: "조금만 더 자세히 말해 줄 수 있겠는가?",
    closing: "그래! 그렇게 말하면 되겠구려.",
  };
}

function mission2Config(): MissionConfig {
  return {
    trigger: { any_elements: ["PERSPECTIVE"], min_turns: 2 },
    intro: M2_LINES.intro.text,
    cards: FRIENDS.map((f) => ({
      id: f.id,
      name: f.name,
      trouble: f.trouble,
      reask: f.reask,
    })),
    /* 명세 6절의 공용 질문 — 실제 노출은 친구별 질문(카드 선택 응답)이 대신한다 */
    ask: "이 고민이 있는 친구한테는 내가 어떻게 이야기해 주면 좋을까?",
    more: M2_LINES.react.text,
    more_pick: M2_LINES.more.text,
    closing: M2_LINES.done.text,
  };
}

/** 개발 화면이 팝업을 열 때 부른다 — 서버의 `mission_sessions` 생성(명세 7절 A) 자리 */
export function openMockMission(mission: 1 | 2): {
  missionSessionId: string;
  config: MissionConfig;
} {
  const config = mission === 1 ? mission1Config() : mission2Config();
  const missionSessionId = `dev-mock-${mission}-${++seq}`;
  sessions.set(missionSessionId, {
    mission,
    config,
    step: null,
    reasked: new Set(),
    skipped: [],
    helped: [],
    completed: null,
  });
  return { missionSessionId, config };
}

function must(missionSessionId: string): MockSession {
  const state = sessions.get(missionSessionId);
  /* 실서버의 409 MISSION_NOT_ACTIVE 자리 — 목에서는 열지 않은 id 뿐이다 */
  if (!state) throw new Error(`목 미션 세션이 없다: ${missionSessionId}`);
  return state;
}

/* "{item}(으)로" 조사 처리 — 실서버는 렌더된 문장을 보낸다 (명세 7절 B 응답 예시) */
function renderAsk(ask: string, itemName: string) {
  const code = itemName.charCodeAt(itemName.length - 1);
  const hasBatchim =
    code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
  return ask
    .replaceAll("{item}(으)로", `${itemName}${hasBatchim ? "으로" : "로"}`)
    .replaceAll("{item}", itemName);
}

const fixedLine = (
  text: string,
  step: string | null,
  mic: boolean,
): MissionEventResult => ({ line: { text, source: "fixed" }, step, mic, done: false });

const DONE: MissionEventResult = { line: null, step: null, mic: false, done: true };

async function submitMissionEvent(
  _sessionId: string,
  missionSessionId: string,
  event: { type: MissionEventType; value?: string },
): Promise<MissionEventResult> {
  await delay();
  const s = must(missionSessionId);

  if (s.mission === 1) {
    if (event.type === "prop_select") {
      s.step = "use";
      const item = s.config.items?.find((i) => i.id === event.value);
      return fixedLine(renderAsk(s.config.steps![0].ask, item?.name ?? "그것"), "use", true);
    }
    if (event.type === "skip") {
      s.skipped.push(s.step ?? "use");
      if (s.step === "use") {
        s.step = "request";
        return fixedLine(s.config.steps![1].ask, "request", true);
      }
      return DONE; // 마지막 스텝을 건너뛰었다 — 앱은 complete 를 부른다
    }
  } else {
    if (event.type === "friend_select") {
      s.step = event.value ?? null;
      /* 친구별 질문(녹음이 따로 있는 문장)을 돌려준다 — 실서버도 카드별 문구가 목표 */
      const card = FRIENDS.find((f) => f.id === event.value);
      return fixedLine(card?.ask.text ?? s.config.ask!, s.step, true);
    }
    if (event.type === "skip") {
      if (s.step) {
        s.helped.push(s.step);
        s.skipped.push(s.step);
      }
      return fixedLine(s.config.more!, null, false);
    }
    if (event.type === "more") {
      if (event.value !== "yes" || s.helped.length >= (s.config.cards?.length ?? 4)) {
        return DONE; // more=no 또는 4명 모두 도움 (명세 7절 B)
      }
      return fixedLine(s.config.more_pick!, null, false);
    }
  }
  throw new Error(`목 미션 API — 지원하지 않는 이벤트: ${event.type}`);
}

async function submitMissionTurn(
  _sessionId: string,
  missionSessionId: string,
  audio: Blob,
  channelCount: number,
): Promise<MissionTurnResult> {
  const s = must(missionSessionId);
  /* 받아쓰기만 진짜 — 무음이면 "" 가 와서 명세대로 { empty: true } + 상태 불변 */
  const text = await transcribeAudio(audio, channelCount);
  await delay();
  if (!text) return { empty: true };

  const step = s.step ?? (s.mission === 1 ? "use" : null);
  const stepKey = step ?? "?";
  if (text.length < SHORT_CHARS && !s.reasked.has(stepKey)) {
    /* 되묻기(M9) — dialogue 없이 같은 스텝의 되묻기 문구만 싣는다 (명세 7절 C) */
    s.reasked.add(stepKey);
    const reask =
      s.mission === 1
        ? s.config.reask!
        : (s.config.cards?.find((c) => c.id === step)?.reask ?? s.config.ask!);
    return {
      child: { text },
      dialogue: null,
      elements: { gained: [], missing: [] },
      next: { kind: "미션계속", step, fixed_line: { text: reask } },
    };
  }

  if (s.mission === 1) {
    if (step === "use") {
      s.step = "request";
      return {
        child: { text },
        dialogue: {
          text: `"${text}" — 그렇게 하자는 거구나! 그거 좋은 방법이군.`,
          source: "generated",
        },
        elements: { gained: ["SOLUTION", "RESULT"], missing: ["REQUEST"] },
        next: {
          kind: "미션계속",
          step: "request",
          fixed_line: { text: s.config.steps![1].ask },
        },
      };
    }
    return {
      child: { text },
      dialogue: {
        text: `"${text}" — 그렇게 부탁하면 며느리도 기꺼이 도와주겠구려!`,
        source: "generated",
      },
      elements: { gained: ["REQUEST"], missing: [] },
      next: { kind: "미션끝" },
    };
  }

  /* 미션2 — 감탄(아이대답요약) + 반복 질문. 미션끝은 events(more)의 done 이 낸다 */
  if (step) s.helped.push(step);
  return {
    child: { text },
    dialogue: {
      text: `정말? "${text}"라니, 그렇게 생각해 본 적 없었는데!`,
      source: "generated",
    },
    elements: { gained: ["PERSPECTIVE", "EMPATHY"], missing: [] },
    next: { kind: "미션계속", step: null, fixed_line: { text: s.config.more! } },
  };
}

async function completeMission(
  _sessionId: string,
  missionSessionId: string,
): Promise<MissionCompleteResult> {
  const s = must(missionSessionId);
  if (s.completed) return s.completed; // 반복 안전 — 이미 완료면 같은 요약 (명세 7절 D)
  await delay();

  /* 무음으로 건너뛴 스텝이 있으면 요소가 남았다고 근사 → 발화받기(유도 대화) 분기 */
  const missing = s.skipped.length > 0;
  const result: MissionCompleteResult =
    s.mission === 1
      ? {
          summary: {
            message_id: `dev-sum-${missionSessionId}`,
            text: missing
              ? "네 덕분에 배를 어떻게 딸지 정했어! 그런데 배가 떨어져서 다 깨지면 어쩌나… 좋은 방법이 있을까?"
              : "네 덕분에 정했어! 그렇게 배를 안전하게 받아서, 며느리에게도 그렇게 부탁해 보겠네.",
          },
          closing_line: missing
            ? null
            : {
                /* 씬 닫는 말의 정본은 서버 story_scenes.character_closing — 문구는
                   컷 플랜(답변 컷 n19-2)과 같다. 그래서 답변 컷을 건너뛴다 (M6) */
                text: "아이고, 방귀 뀌는 며느리 덕분에 온 마을이 배 잔치를 할 수 있겠구려, 고맙소!",
              },
          elements: missing
            ? { accumulated: ["SOLUTION", "RESULT"], missing: ["REQUEST"] }
            : {
                accumulated: ["SOLUTION", "REASON", "REQUEST", "RESULT"],
                missing: [],
              },
          next: missing
            ? { kind: "발화받기" }
            : {
                kind: "장면끝",
                next_scene: { scene_id: "dev-mock-next", code: "sc_banggui_09" },
              },
        }
      : {
          summary: {
            message_id: `dev-sum-${missionSessionId}`,
            text: missing
              ? `${s.helped.length}명의 친구를 만나 줬구나. 그런데 아직 뭐라고 말해 줄지 못 정한 친구가 있어… 어떻게 말해 주면 좋을까?`
              : `네 덕분에 친구 ${s.helped.length}명이 자기의 멋진 점을 알게 됐어. 정말 고마워!`,
          },
          closing_line: missing
            ? null
            : {
                /* 목 자리 문구 — 실서버는 story_scenes.character_closing 을 돌려준다 */
                text: "이제 내 방귀쯤은 하나도 부끄럽지 않아. 다 네 덕분이야!",
              },
          elements: missing
            ? { accumulated: ["PERSPECTIVE", "EMPATHY"], missing: ["SOLUTION"] }
            : {
                accumulated: ["EMPATHY", "PERSPECTIVE", "RESULT", "SOLUTION"],
                missing: [],
              },
          /* 대화4(sc_banggui_09)는 마지막 대화 씬 — 닫히면 회차끝이다 */
          next: missing ? { kind: "발화받기" } : { kind: "회차끝" },
        };
  s.completed = result;
  return result;
}

export const MOCK_MISSION_API: MissionApi = {
  submitMissionEvent,
  submitMissionTurn,
  completeMission,
};
