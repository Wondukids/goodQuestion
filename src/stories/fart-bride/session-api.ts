/**
 * 브라우저 → 세션 API(/api/sessions/*) 호출 헬퍼 (이슈 #8 · `docs/이야기_세션_명세.md` 4절).
 *
 * 봉투는 성공 `{ ok: true, data }` / 실패 `{ ok: false, error }` — 실패는
 * `SessionApiError` 로 던져 부르는 쪽이 code(409 TURN_INCOMPLETE · 502 LLM_UNAVAILABLE)로
 * 가른다. 아이 확인은 selected_child 쿠키라 브라우저가 알아서 붙인다.
 */

/** 서버 장면 참조 — 앱은 `code` 를 `sceneCode` 매핑으로 스텝에 잇는다 (명세 3절). */
export type SessionSceneRef = { scene_id: string; code: string };

export type PendingTurn = { message_id: string; stage: string };

/** `POST /api/sessions` 의 data (명세 4.1절 + 미션 명세 7절 E). */
export type OpenedSession = {
  session_id: string;
  resumed: boolean;
  scene: SessionSceneRef | null;
  last_character_line: { message_id: string; text: string } | null;
  pending_turn: PendingTurn | null;
  status: string;
  /** 미션 명세 7절 E — 현재 씬에 진행 중이던 미션이 있었으면 새 시도(M4 처음부터).
      아직 앱은 안 쓴다 — 열기 직후 팝업 복원은 서버(#19) 착지와 함께 잇는다 */
  mission?: MissionStart | null;
};

export type TurnNext = {
  kind: "발화받기" | "장면끝" | "회차끝" | "미션시작";
  scene_id: string;
  /** `장면끝` 에만 실린다 — 여는 말까지 저장된 다음 대화 장면 (명세 4.3절). */
  next_scene?: SessionSceneRef;
  /** `미션시작` 에만 실린다 — 트리거 턴에서 서버가 만든 미션 세션 (미션 명세 7절 A). */
  mission?: MissionStart;
};

export type TurnDialogue = {
  message_id: string;
  text: string;
  source: "generated" | "fixed";
};

/** `POST /api/sessions/{id}/turns` 의 data — 무음이면 `{ empty: true }` 뿐이다. */
export type TurnResult =
  | { empty: true }
  | {
      empty?: undefined;
      child: { message_id: string; text: string };
      dialogue: TurnDialogue;
      next: TurnNext;
    };

/** `POST /api/sessions/{id}/turns/resume` 의 data (대화턴 명세 4.2절).
    다리 대사가 끊겼던 턴이면 `미션시작` 이 실린다 (미션 명세 7절 A). */
export type ResumeResult = {
  resumed_from: string;
  child: { message_id: string; text: string };
  dialogue: TurnDialogue;
  next: { kind: "발화받기" | "장면끝" | "미션시작"; scene_id: string; mission?: MissionStart };
};

/** `GET /api/sessions/{id}` 의 data (명세 4.2절) — 홈 이어보기 카드가 쓴다. */
export type SessionView = {
  session_id: string;
  status: string;
  scene: SessionSceneRef | null;
  last_character_line: { message_id: string; text: string } | null;
  pending_turn: PendingTurn | null;
  progress: { scene_order: number; total: number };
};

/** 봉투의 실패 쪽 — status(HTTP)와 code 로 분기한다. */
export class SessionApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly pending?: PendingTurn,
  ) {
    super(message);
    this.name = "SessionApiError";
  }
}

type Envelope<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: { code: string; message: string; retryable: boolean; pending?: PendingTurn };
    };

async function unwrap<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as Envelope<T> | null;
  if (body?.ok) return body.data;
  const error = body && !body.ok ? body.error : null;
  throw new SessionApiError(
    res.status,
    error?.code ?? "INTERNAL",
    error?.message ?? `세션 API 실패 (${res.status})`,
    error?.retryable ?? false,
    error?.pending,
  );
}

/** 세션 열기 = 시작 + 이어하기 + 따라잡기 (반복 안전 — 명세 4.1절). */
export async function openSession(story: string): Promise<OpenedSession> {
  const res = await fetch("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ story }),
  });
  return unwrap<OpenedSession>(res);
}

/** 읽기 전용 조회 — 상태를 바꾸지 않는다 (명세 4.2절). */
export async function fetchSession(sessionId: string): Promise<SessionView> {
  const res = await fetch(`/api/sessions/${sessionId}`);
  return unwrap<SessionView>(res);
}

/**
 * 녹음 한 건 = 턴 한 개 (명세 4.3절). 서버가 STT→분석→판단→대사를 다 돌린다.
 * 채널 수 헤더는 기존 STT 라우트와 같은 이유다 (`src/stt/client.ts`).
 */
export async function submitSessionTurn(
  sessionId: string,
  audio: Blob,
  channelCount: number,
): Promise<TurnResult> {
  const res = await fetch(`/api/sessions/${sessionId}/turns`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Audio-Channels": String(channelCount),
    },
    body: audio,
  });
  return unwrap<TurnResult>(res);
}

/** `POST /api/sessions/{id}/scenes/{code}/skip` 의 data. */
export type SkipResult = {
  /** 실제로 건너뛴 장면. null 이면 서버는 원래 그 장면을 기다리고 있지 않았다 (반복 안전). */
  skipped: SessionSceneRef | null;
  /** 이제 서버가 기다리는 대화 장면. null 이면 서버 대화가 남지 않았다. */
  scene: SessionSceneRef | null;
};

/**
 * 대화 씬을 건너뛴다 — 서버도 같이 넘긴다.
 *
 * 영상 구간 건너뛰기는 부르지 않는다 (진행 지휘권은 대화 장면만 서버 · 확정 결정 ⑧).
 * **도착 장면은 서버가 정해 응답으로 준다** — 앱이 계산하면 장면 순서가 두 벌이 된다.
 */
export async function skipSessionScene(
  sessionId: string,
  sceneCode: string,
): Promise<SkipResult> {
  const res = await fetch(
    `/api/sessions/${sessionId}/scenes/${encodeURIComponent(sceneCode)}/skip`,
    { method: "POST" },
  );
  return unwrap<SkipResult>(res);
}

/** 끊긴 턴 이어 돌리기 — body 없음 (대화턴 명세 4.2절). */
export async function resumeSessionTurn(sessionId: string): Promise<ResumeResult> {
  const res = await fetch(`/api/sessions/${sessionId}/turns/resume`, {
    method: "POST",
  });
  return unwrap<ResumeResult>(res);
}

/* 회차 잠금(409 TURN_IN_PROGRESS)이 풀릴 때까지 기다리는 한도. 턴 한 번이 실측 ~20초라
   (LLM 을 분석·대사 두 번 부른다) 그보다 넉넉히 잡는다. 넘기면 포기하고 던진다 — 그래도
   어긋남 가드가 남은 대화를 고정 문구로 돌리고 다음 진입 때 건너뛴 대화로 복귀한다. */
const RUN_LOCK_WAIT_MS = 30_000;
const RUN_LOCK_POLL_MS = 1_500;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 스킵 한 번 + 미완 턴 복구 — 회차 잠금 재시도는 감싸는 쪽이 한다. */
async function skipOnce(
  sessionId: string,
  sceneCode: string,
  story: string,
): Promise<string | null> {
  try {
    return (await skipSessionScene(sessionId, sceneCode)).scene?.code ?? null;
  } catch (error) {
    if (!(error instanceof SessionApiError) || error.code !== "TURN_INCOMPLETE") {
      throw error;
    }
    const resumed = await resumeSessionTurn(sessionId);
    if (resumed.next.kind === "장면끝") {
      /* 이어 돌린 턴이 장면을 끝냈다 — 스킵할 것이 없다. 열기 따라잡기로 대기 장면만 얻는다 */
      const reopened = await openSession(story);
      return reopened.status === "in_progress" ? (reopened.scene?.code ?? null) : null;
    }
    return (await skipSessionScene(sessionId, sceneCode)).scene?.code ?? null;
  }
}

/**
 * 스킵 + 복구 체인 (명세 4.5절) — 화면이 대화 씬을 혼자 떠나는 모든 지점
 * (상단 건너뛰기 · 무음 「넘어가기」 · 폴백 「계속하기」 · 오류 「건너뛰고 계속」)이 같이 쓴다.
 *
 * 서버가 스킵을 막는 이유는 둘이고, 둘 다 여기서 끝까지 따라간다.
 *
 * 1. **409 TURN_INCOMPLETE — 미완 턴이 걸려 있다.** resume 으로 이어 돌린 뒤 한 번만
 *    재시도한다. resume 이 이미 장면을 끝냈으면(장면끝) 재스킵 없이 다시 열어 따라잡는다
 *    — 장면 전진은 열기 몫이라 서버는 아직 그 장면에 서 있다 (명세 4.3절).
 * 2. **409 TURN_IN_PROGRESS — 턴이 지금 돌고 있다.** 거절이 옳다(도는 중 전진하면 그 턴
 *    대사가 지나간 장면에 쓰인다). 다만 아이는 이미 다음 장면으로 넘어갔으므로 여기서
 *    포기하면 **앱만 전진하고 서버는 남아 갈린다** — 실기 확인 2026-08-14. 그래서 턴이
 *    끝날 때까지 짧게 기다렸다가 다시 보낸다. 그 사이 턴이 스스로 장면을 끝냈으면
 *    스킵은 반복 안전이라 아무것도 안 하고 대기 자리만 돌려준다.
 *
 * 반환: 이제 서버가 기다리는 대화 장면 code — null 이면 서버 대화가 남지 않았다.
 * 실패는 그대로 던진다 — 부르는 쪽이 로그만 남기고 이야기는 계속 진행한다.
 */
export async function skipSessionSceneWithResume(
  sessionId: string,
  sceneCode: string,
  story: string,
): Promise<string | null> {
  const deadline = Date.now() + RUN_LOCK_WAIT_MS;
  for (;;) {
    try {
      return await skipOnce(sessionId, sceneCode, story);
    } catch (error) {
      const runLocked =
        error instanceof SessionApiError && error.code === "TURN_IN_PROGRESS";
      if (!runLocked || Date.now() >= deadline) throw error;
      await sleep(RUN_LOCK_POLL_MS);
    }
  }
}

/* ── 미션 API (이슈 #20 · `docs/미션_명세.md` 7절) ──────────────────────────
   봉투·오디오 방식은 위 세션 계약 그대로다. 실패는 똑같이 SessionApiError 로
   던진다 — 미션 전용 코드는 409 MISSION_IN_PROGRESS(미션 중 일반 턴 거절) ·
   409 MISSION_NOT_ACTIVE(그 시도가 in_progress 가 아님)다 (명세 7절 E). */

/**
 * 미션 정의 config — **명세 6절 jsonc 가 정본**이라 칸을 임의로 바꾸지 않는다.
 * 미션1(prop_choice)은 items·steps·reask, 미션2(card_help)는 intro·cards·ask·
 * more·more_pick 을 쓴다. closing 은 미션 자체의 짧은 닫는 말이고, 씬 닫는 말
 * (배 잔치 문장)은 여기 없다 — complete 응답의 closing_line 으로 온다.
 */
export type MissionConfig = {
  trigger: { any_elements: string[]; min_turns: number };
  items?: { id: string; name: string; desc: string }[];
  steps?: { key: string; expect: string; ask: string }[];
  /** M9 — 미션1 되묻기 공통 문구 (미션2 는 카드별 reask) */
  reask?: string;
  intro?: string;
  cards?: { id: string; name: string; trouble: string; reask: string }[];
  ask?: string;
  more?: string;
  more_pick?: string;
  closing: string;
};

/** 턴 응답 `next.kind === "미션시작"` 에 실리는 미션 세션 참조 (명세 7절 A). */
export type MissionStart = {
  mission_session_id: string;
  code: string;
  mission_type: "prop_choice" | "card_help";
  config: MissionConfig;
};

/** 말이 아닌 입력 — 소품·친구 카드 탭, 계속/그만, 무음 건너뜀 (명세 2절). */
export type MissionEventType = "prop_select" | "friend_select" | "more" | "skip";

/** `POST …/missions/{msid}/events` 의 data (명세 7절 B). */
export type MissionEventResult = {
  /** 그 스텝의 고정 대사 — done 이면 null 이고 앱은 complete 를 부른다 */
  line: { text: string; source: "fixed" } | null;
  step: string | null;
  mic: boolean;
  done: boolean;
};

/** `POST …/missions/{msid}/turns` 의 data — 무음이면 `{ empty: true }` 뿐 (명세 7절 C). */
export type MissionTurnResult =
  | { empty: true }
  | {
      empty?: undefined;
      child: { text: string };
      /** 아이대답요약 — 되묻기(M9)면 null 이고 fixed_line 이 되묻기 문구다 */
      dialogue: { text: string; source: "generated" } | null;
      elements: { gained: string[]; missing: string[] };
      next: {
        kind: "미션계속" | "미션끝";
        /** 미션계속의 다음(되묻기면 같은) 스텝 */
        step?: string | null;
        fixed_line?: { text: string } | null;
      };
    };

/** `POST …/missions/{msid}/complete` 의 data (명세 7절 D). */
export type MissionCompleteResult = {
  summary: { message_id: string; text: string };
  /** 씬이 닫혔을 때만 — 닫는 말. 앱이 재생하고 답변 컷을 건너뛴다 (M6) */
  closing_line: { text: string } | null;
  elements: { accumulated: string[]; missing: string[] };
  next: { kind: "발화받기" | "장면끝" | "회차끝"; next_scene?: SessionSceneRef };
};

/** 선택·건너뜀을 기록하고 그 스텝의 고정 대사를 받는다 (명세 7절 B). TTS 는 앱 몫. */
export async function submitMissionEvent(
  sessionId: string,
  missionSessionId: string,
  event: { type: MissionEventType; value?: string },
): Promise<MissionEventResult> {
  const res = await fetch(
    `/api/sessions/${sessionId}/missions/${missionSessionId}/events`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
    },
  );
  return unwrap<MissionEventResult>(res);
}

/**
 * 미션 턴 — 녹음 하나로 STT→분석→판정→아이대답요약 (명세 4절 파이프라인).
 * 요청 모양은 submitSessionTurn 과 같다 (octet-stream + 채널 수 헤더).
 * 502 면 미션 상태가 안 변한다 — 부르는 쪽이 재녹음을 유도한다 (이어 돌리기 없음, M4).
 */
export async function submitMissionTurn(
  sessionId: string,
  missionSessionId: string,
  audio: Blob,
  channelCount: number,
): Promise<MissionTurnResult> {
  const res = await fetch(
    `/api/sessions/${sessionId}/missions/${missionSessionId}/turns`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Audio-Channels": String(channelCount),
      },
      body: audio,
    },
  );
  return unwrap<MissionTurnResult>(res);
}

/** 종료 요약 — body 없음, 반복 안전(이미 완료면 저장된 요약 재반환 · 명세 7절 D). */
export async function completeMission(
  sessionId: string,
  missionSessionId: string,
): Promise<MissionCompleteResult> {
  const res = await fetch(
    `/api/sessions/${sessionId}/missions/${missionSessionId}/complete`,
    { method: "POST" },
  );
  return unwrap<MissionCompleteResult>(res);
}

/**
 * 미션 컴포넌트가 주입받는 호출 3벌 (이슈 #20). 아이 앱(play.tsx)은 아래 실구현을,
 * /dev/minigame 은 목 어댑터를 주입한다 — 서버(#19)가 없어도 개발 화면에서
 * 전 흐름이 돈다. 서버가 오면 목만 걷어내면 된다.
 */
export type MissionApi = {
  submitMissionEvent: typeof submitMissionEvent;
  submitMissionTurn: typeof submitMissionTurn;
  completeMission: typeof completeMission;
};

export const REAL_MISSION_API: MissionApi = {
  submitMissionEvent,
  submitMissionTurn,
  completeMission,
};

/* ── 말하기 후 활동 API (이슈 #46 · `docs/말하기후활동_명세.md` 5절 A~D) ────────
   봉투·오디오 방식은 위 세션 계약 그대로다. ⛔ 미션 API 와 이름만 이웃일 뿐 남남이다 —
   후활동은 **미션 세션 배선 넷을 안 쓰고** 자기 API 만 쓴다 (명세 3절 · 8절 ②).
   전용 오류 코드는 404 POST_ACTIVITY_NOT_CONFIGURED(이 이야기엔 후활동이 없다) ·
   409 POST_ACTIVITY_NOT_ALLOWED(이야기가 아직 안 끝났다) · 502 STT_FAILED 다. */

/** `stories.post_activity_config.cards[]` 한 장 (명세 4.1). 그림·칩 색은 없다 — 앱이 id 로 잇는다. */
export type PostActivityCard = { id: string; title: string; keywords: string[] };

/** 카드·정답 순서의 **정본** (F1). 화면 상수(finale-script.ts)는 이제 비상용 사본이다. */
export type PostActivityConfig = {
  cards: PostActivityCard[];
  /** 이야기 순서 = 정답 */
  answer_order: string[];
  /** 트레이에 처음 깔리는 (섞인) 순서 */
  tray_order: string[];
};

/** 지금까지 저장된 것 — 중간에 나갔다 돌아온 아이의 자리를 되살리는 재료다 (명세 5.A). */
export type PostActivityResult = {
  /** 아이의 **첫 제출** 순서 (F7). 아직 한 번도 안 냈으면 null */
  submitted_order: string[] | null;
  /** 「끝내 맞췄나」 — 첫 제출이 정답이었나가 아니다 (F18) */
  is_order_correct: boolean | null;
  attempt_count: number;
  retelling_text: string | null;
  /** 「마치기」를 누른 시각. 중간에 나갔으면 null */
  completed_at: string | null;
};

/** `GET …/post-activity` 의 data (명세 5.A). */
export type PostActivityOpen = { config: PostActivityConfig; result: PostActivityResult };

/** `POST …/post-activity/order` 의 data — `is_correct` 는 **서버가 계산한 값**이다 (명세 5.B). */
export type PostActivityOrderResult = { is_correct: boolean; attempt_count: number };

/** 단어 하나의 판정 (명세 4.3). 앱은 지금 쓰지 않는다 — 보호자 리포트(#47) 몫이다. */
export type PostActivityKeyword = {
  card_id: string;
  word: string;
  status: "used" | "similar" | "missing";
  evidence: string | null;
  decided_by: "rule" | "llm";
};

/**
 * `POST …/post-activity/retelling` 의 data — 무음이면 `{ empty: true }` 뿐이다 (명세 5.C).
 *
 * 🔴 `analyzed: false` 는 **오류가 아니다.** 판정 LLM 이 죽어도 아이 말은 이미 저장됐고
 *    화면은 끝까지 진행된다 (F4·F8 · 수용 기준 10).
 */
export type PostActivityRetellingResult =
  | { empty: true }
  | {
      empty?: undefined;
      text: string;
      analyzed: boolean;
      keywords: PostActivityKeyword[] | null;
    };

/** `finished` 「마치기」를 눌렀다 · `left` 끝 화면을 떠났다 (명세 5.D). */
export type PostActivityCompleteReason = "finished" | "left";

/** `exists` 면 리포트가 이미 있어 안 만들었다 — 아이 화면은 어느 쪽이든 그대로 넘어간다. */
export type PostActivityCompleteResult = { report: "queued" | "exists" };

/**
 * 활동 열기 — 카드·정답 순서와 지금까지의 결과 (명세 5.A).
 *
 * 404 `POST_ACTIVITY_NOT_CONFIGURED` 면 이 이야기엔 후활동이 없다 — 부르는 쪽은 활동
 * 버튼을 **아예 그리지 않는다**. 그 이야기의 리포트는 세션이 끝나는 자리에서 이미
 * 만들어졌다 (F13).
 */
export async function fetchPostActivity(sessionId: string): Promise<PostActivityOpen> {
  const res = await fetch(`/api/sessions/${sessionId}/post-activity`);
  return unwrap<PostActivityOpen>(res);
}

/* 서버가 세션을 닫을 때까지 기다리는 한도. 남은 것은 건너뛰기 요청 한 번의 왕복이라
   회차 잠금(30초)만큼 길 이유가 없다 — 넘기면 조용히 포기한다 (아래 머리말). */
const POST_ACTIVITY_WAIT_MS = 10_000;
const POST_ACTIVITY_POLL_MS = 600;

/**
 * **서버가 이 세션을 닫을 때까지 기다렸다가** 활동을 연다 — 이야기가 끝나는 자리 전용.
 *
 * ## 🔴 왜 한 번 물어서는 안 되나
 *
 * 앱이 말하는 「끝」과 서버가 말하는 「끝」이 다르다. 앱의 끝은 화면 조각을 다 넘겼다는
 * 뜻이고(`sequencer.ts` 의 `finished`), 서버의 끝은 자기 장면 차례가 `회차끝` 에 닿아
 * 세션이 `completed` 로 닫힌 것이다(`llm/service/run.ts` 의 `completeRun()`).
 * 후활동 API 는 **닫힌 세션에만** 열어 준다 (명세 5.E · F10).
 *
 * 아이가 마지막 대화를 건너뛰면 앱은 건너뛰기를 보내 놓고 **답을 안 기다리고** 다음
 * 화면으로 넘어간다 (`play.tsx` 의 `skip()` — 아이를 기다리게 하지 않으려고 일부러 그렇다).
 * 그 요청이 서버에 닿기 전에 아이가 끝 화면에 도착하면 409 가 오고, 한 번 묻고 마는
 * 코드는 **활동을 영영 못 연다.** 늦게 도착하면 열린다 — 그래서 들쭉날쭉했다.
 *
 * ⚠️ **404 는 기다리지 않는다.** 「이 이야기엔 후활동이 없다」는 시간이 지나도 안 바뀐다
 *    (F13). 되물으면 그런 이야기마다 10초씩 헛되이 기다린다.
 *
 * ⚠️ 그래도 안 열리는 경우가 남는다 — 앱의 장면 추적이 어긋나 건너뛰기를 **아예 안 보낸**
 *    판이다. 서버는 그 장면에 그대로 서 있어 세션이 안 닫힌다. 그때는 포기하고, 리포트는
 *    보호자가 열 때 만들어진다 (F12).
 *
 * @param 기다림 검사가 짧게 돌리려고 연 손잡이 — 안 주면 위 상수다.
 */
export async function fetchPostActivityWhenReady(
  sessionId: string,
  기다림?: { waitMs?: number; pollMs?: number },
): Promise<PostActivityOpen> {
  const pollMs = 기다림?.pollMs ?? POST_ACTIVITY_POLL_MS;
  const deadline = Date.now() + (기다림?.waitMs ?? POST_ACTIVITY_WAIT_MS);
  for (;;) {
    try {
      return await fetchPostActivity(sessionId);
    } catch (error) {
      /* 404(후활동 없음)는 기다려도 안 바뀐다. 나머지(409 아직 안 닫힘·네트워크)는 되묻는다 */
      const 기다릴만한가 =
        !(error instanceof SessionApiError) ||
        error.code !== "POST_ACTIVITY_NOT_CONFIGURED";
      if (!기다릴만한가 || Date.now() >= deadline) throw error;
      await sleep(pollMs);
    }
  }
}

/**
 * **아이가 「할래」를 눌렀다** — 서버가 아직 이야기를 안 닫았으면 밀어 닫고 활동을 연다.
 *
 * ## 🔴 왜 밀어 닫나
 *
 * 서버는 **마지막 대화 장면이 끝나야** 세션을 닫는다. 아이가 그 장면에서 말을 안 하고
 * 지나가면 서버는 거기 그대로 선다 — 실측(팀 DB)으로 끝까지 본 판의 셋 중 하나가 그랬다.
 * 그런 판은 기다려도 **영영** 안 닫혀서, 되묻기만으로는 활동을 못 연다.
 *
 * 그래서 아이가 활동을 하겠다고 **직접 누른 그 자리에서** 남은 장면을 건너뛰기로 밀어
 * 닫는다 (2026-08-15 결정). 이미 있는 건너뛰기 길을 그대로 쓴다 — 새 서버 코드가 없다.
 *
 * ⚠️ 그 장면들은 **건너뛴 것으로 기록**되고 리포트의 「끝까지 봤나」가 참이 된다.
 *    아이가 실제로 이야기를 끝까지 본 것은 맞으므로 그 편이 사실에 가깝다.
 * ⚠️ `serverScene` 이 `null` 이면 밀 곳을 모른다 — 그때는 되묻기만 하고 만다.
 *
 * @param serverScene 서버가 지금 서 있다고 앱이 아는 장면 code (`play.tsx` 의 추적값)
 * @param 기다림 검사가 짧게 돌리려고 연 손잡이 — `fetchPostActivityWhenReady()` 로 흘린다
 */
export async function openPostActivityClosingStory(
  sessionId: string,
  story: string,
  serverScene: string | null,
  기다림?: { waitMs?: number; pollMs?: number },
): Promise<PostActivityOpen> {
  try {
    return await fetchPostActivity(sessionId);
  } catch (error) {
    const 안닫혔다 =
      error instanceof SessionApiError && error.code === "POST_ACTIVITY_NOT_ALLOWED";
    if (!안닫혔다) throw error;
  }
  /* 서버가 선 장면부터 끝까지. 이야기의 대화 장면은 아홉이라 열두 번이면 넉넉하다 */
  let 장면 = serverScene;
  for (let i = 0; 장면 !== null && i < 12; i += 1) {
    장면 = await skipSessionSceneWithResume(sessionId, 장면, story);
  }
  /* 닫히는 것은 건너뛰기 응답 **뒤에** 커밋되므로 여기서도 조금 기다려 준다 */
  return fetchPostActivityWhenReady(sessionId, 기다림);
}

/**
 * 순서 제출 — 「다 놓았어요!」를 누를 때마다 (명세 5.B).
 *
 * 🔴 **판정은 앱이 하고, 이 호출은 기록용이다** (명세 8절 ③). 화면은 응답을 기다리지
 * 않는다 — 아이 화면이 네트워크를 기다리면 안 된다. 앱이 보낸 판정은 서버가 받지도 않는다.
 */
export async function submitPostActivityOrder(
  sessionId: string,
  submittedOrder: readonly string[],
): Promise<PostActivityOrderResult> {
  const res = await fetch(`/api/sessions/${sessionId}/post-activity/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ submitted_order: submittedOrder }),
  });
  return unwrap<PostActivityOrderResult>(res);
}

/**
 * 줄거리 녹음 보내기 — **받아쓰기는 서버가 한다** (F6).
 *
 * ⚠️ 명세 5.C 는 `multipart/form-data` 라고 적었지만 **실제 서버는 그렇게 안 받는다.**
 *    턴·미션 API 와 똑같이 녹음을 본문에 그대로 싣고 채널 수를 헤더로 보낸다
 *    (`src/session/controller/post-activity.ts` 의 `POST_retelling` 이 정본).
 */
export async function submitPostActivityRetelling(
  sessionId: string,
  audio: Blob,
  channelCount: number,
): Promise<PostActivityRetellingResult> {
  const res = await fetch(`/api/sessions/${sessionId}/post-activity/retelling`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-Audio-Channels": String(channelCount),
    },
    body: audio,
  });
  return unwrap<PostActivityRetellingResult>(res);
}

/**
 * 활동 종료 — ⭐ **보호자 리포트를 띄우는 신호다** (F11 · 명세 5.D).
 *
 * 「마치기」는 `finished`, 끝 화면을 떠나는 모든 길은 `left` 다. **반복 호출이 안전하므로**
 * 앱은 「이미 불렀나」를 관리하지 않는다 — 마치고 나서 떠나면 두 번 가고 서버가 삼킨다.
 */
export async function completePostActivity(
  sessionId: string,
  reason: PostActivityCompleteReason,
): Promise<PostActivityCompleteResult> {
  const res = await fetch(`/api/sessions/${sessionId}/post-activity/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
  return unwrap<PostActivityCompleteResult>(res);
}

/**
 * 페이지를 떠나는 순간의 종료 알림 — 브라우저 뒤로가기·탭 닫기 (F11 의 「뒤로가기」).
 *
 * 그 순간의 `fetch()` 는 브라우저가 취소한다. `sendBeacon` 은 문서가 사라져도 요청을
 * 마저 보내 준다 — 답은 못 받지만 이 호출은 답을 볼 일이 없다.
 *
 * 🟡 **명세에 없는 판단이라 되돌려도 된다.** 없어도 F12(보호자가 리포트를 열 때 만든다)가
 *    받아 주므로 잃는 것은 「리포트가 조금 늦게 생긴다」뿐이다.
 */
export function beaconPostActivityComplete(
  sessionId: string,
  reason: PostActivityCompleteReason,
): boolean {
  if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") {
    return false;
  }
  return navigator.sendBeacon(
    `/api/sessions/${sessionId}/post-activity/complete`,
    new Blob([JSON.stringify({ reason })], { type: "application/json" }),
  );
}

/**
 * 후활동 화면이 주입받는 호출 4벌 — 미션의 `MissionApi` 와 같은 자리다 (이슈 #20).
 * 아이 앱(play.tsx)은 아래 실구현을, /dev/minigame 은 목 어댑터를 주입한다.
 */
export type PostActivityApi = {
  fetchPostActivity: typeof fetchPostActivity;
  submitPostActivityOrder: typeof submitPostActivityOrder;
  submitPostActivityRetelling: typeof submitPostActivityRetelling;
  completePostActivity: typeof completePostActivity;
};

export const REAL_POST_ACTIVITY_API: PostActivityApi = {
  fetchPostActivity,
  submitPostActivityOrder,
  submitPostActivityRetelling,
  completePostActivity,
};

/**
 * 후활동 화면에 흘려보내는 배선 한 덩이 (명세 8절 ②).
 *
 * ⛔ 미션 세션 배선 넷(sessionId·missionSessionId·config·missionApi)과 **다른 것**이다 —
 *    `missionSessionId` 가 없다. 후활동은 세션당 한 건이라 세션 id 하나로 찾힌다.
 */
export type PostActivityWiring = {
  sessionId: string;
  /** 서버가 준 정본. null 이면 화면 상수로 그린다 — 서버가 안 열릴 때의 비상용 (명세 8절 4) */
  config: PostActivityConfig | null;
  /** 중간에 나갔다 돌아온 자리. null 이면 처음부터 */
  result: PostActivityResult | null;
  api: PostActivityApi;
};
