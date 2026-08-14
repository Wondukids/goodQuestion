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

/** `POST /api/sessions` 의 data (명세 4.1절). */
export type OpenedSession = {
  session_id: string;
  resumed: boolean;
  scene: SessionSceneRef | null;
  last_character_line: { message_id: string; text: string } | null;
  pending_turn: PendingTurn | null;
  status: string;
};

export type TurnNext = {
  kind: "발화받기" | "장면끝" | "회차끝";
  scene_id: string;
  /** `장면끝` 에만 실린다 — 여는 말까지 저장된 다음 대화 장면 (명세 4.3절). */
  next_scene?: SessionSceneRef;
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

/** `POST /api/sessions/{id}/turns/resume` 의 data (대화턴 명세 4.2절). */
export type ResumeResult = {
  resumed_from: string;
  child: { message_id: string; text: string };
  dialogue: TurnDialogue;
  next: { kind: "발화받기" | "장면끝"; scene_id: string };
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

/**
 * 스킵 + 미완 턴 복구 체인 (명세 4.5절) — 화면이 대화 씬을 혼자 떠나는 모든 지점
 * (상단 건너뛰기 · 무음 「넘어가기」 · 폴백 「계속하기」 · 오류 「건너뛰고 계속」)이 같이 쓴다.
 *
 * 스킵이 409 TURN_INCOMPLETE(미완 턴이 걸려 있음)로 막히면 resume 으로 이어 돌린 뒤
 * **한 번만** 재시도한다. resume 이 이미 장면을 끝냈으면(장면끝) 재스킵 없이 다시 열어
 * 따라잡는다 — 장면 전진은 열기 몫이라 서버는 아직 그 장면에 서 있다 (명세 4.3절).
 *
 * 반환: 이제 서버가 기다리는 대화 장면 code — null 이면 서버 대화가 남지 않았다.
 * 실패(409 외·체인 도중 사망)는 그대로 던진다 — 부르는 쪽이 로그만 남기고 진행한다.
 */
export async function skipSessionSceneWithResume(
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
