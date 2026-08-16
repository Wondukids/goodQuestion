"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { type VideoStep } from "./data";
import { CutsPlayer, type CutsPlayerHandle } from "./cuts-player";
import { InteractiveScene, type InteractiveSceneHandle } from "./interactive-scene";
import { MinigamePopup } from "./minigame-popup";
import { buildPlanSequence } from "./plan-sequence";
import { useStorySequencer } from "./sequencer";
import {
  beaconPostActivityComplete,
  completePostActivity,
  fetchPostActivity,
  openPostActivityClosingStory,
  openSession,
  REAL_MISSION_API,
  REAL_POST_ACTIVITY_API,
  resumeSessionTurn,
  SessionApiError,
  skipSessionSceneWithResume,
  type MissionCompleteResult,
  type MissionStart,
  type OpenedSession,
  type PostActivityOpen,
} from "./session-api";
import { VIDEO_SUBTITLES } from "./subtitles";

/**
 * 방귀 뀌는 며느리 — 재생 화면.
 *
 * 재생 순서는 /dev/video-maker 에서 편집·저장한 video-plan.json 을 따른다
 * (plan-sequence.ts 가 변환): linear 컷 묶음은 cuts-player 가 이미지+음성+
 * 저장된 연출로 재생하고, 질문·답변 컷 짝은 대화 씬(STT→TTS)이 된다.
 * 진행 제어(시작·다음·점프·책 넘김 판단)는 sequencer.ts,
 * 대화 씬 동작은 interactive-scene.tsx 에 있다 — 이 파일은 그리기만 한다.
 * mp4 파트 방식 순서(data.ts 의 SEQUENCE)는 남아 있다 — 되돌리려면
 * useStorySequencer() 를 인자 없이 부르면 된다.
 *
 * 시안 8~17 디자인은 추후 제공 예정이라 지금은 기능 테스트용 최소 UI 다.
 * 첫 화면의 "이야기 시작" 버튼은 소리 있는 자동재생을 허용받기 위한
 * 사용자 제스처이기도 하다 — 빼면 브라우저가 영상 소리를 막는다.
 */

/* 플랜은 빌드에 포함된 정적 데이터라 모듈에서 한 번만 변환한다 */
const PLAN_STEPS = buildPlanSequence();

export default function FartBridePlay({
  childName,
}: {
  /** 선택된 아이 이름 — 대화 씬이 아이를 부를 때 쓴다 (라우트가 채워 준다) */
  childName: string | null;
}) {
  const { steps, started, stepIndex, step, finished, turning, start, next, goTo, restart } =
    useStorySequencer(PLAN_STEPS);

  /* 서버 세션 (이슈 #8) — 열기 실패·아이 미선택이면 null 로 두고 고정 문구 흐름으로 돈다 */
  const [session, setSession] = useState<OpenedSession | null>(null);
  /* 복귀 진입 한 줄 — 재개 대화 씬에서 서버의 마지막 캐릭터 대사를 튼다 (결정 ⑦ 꼬리) */
  const [resumeLine, setResumeLine] = useState<{ stepId: string; text: string } | null>(null);
  /* 재개 진입 시작 컷 — 직전 컷 묶음을 통째로 다시 틀지 않고 마지막 컷만 틀기 위한
     1회용 지시 (결정 ⑦). 그 스텝이 끝나면 소거되어, 다시 보기·정상 진행으로 같은
     스텝에 들어올 땐 처음 컷부터 나온다. */
  const [resumeCutStart, setResumeCutStart] = useState<{
    stepId: string;
    cutIndex: number;
  } | null>(null);
  /* 서버가 지금 기다리는 대화 장면 code — 어긋남 가드의 기준이다. 대화 씬은 자기
     sceneCode 가 이 값과 같을 때만 서버 턴을 보낸다 (건너뛰기로 어긋나면 그 씬은
     고정 문구로 돌고, 서버 기록은 그대로라 다음 진입 때 건너뛴 대화로 복귀한다). */
  const [serverScene, setServerScene] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  /**
   * 이어하기: 세션 열기가 실어 준 미션 (명세 7절 E · M4).
   *
   * 그 씬에 진행 중인 시도가 남아 있으면 — 미션 도중 앱을 껐거나 팝업만 닫고 나갔거나 —
   * 서버가 그것을 접고 **새 시도**를 만들어 준다. 앱이 할 일은 그 씬에 닿았을 때 팝업을
   * 처음부터 여는 것이다. 이 칸을 버리면 아무도 마치지 않을 시도가 서버에 남아 남은 대화가
   * 전부 409 `MISSION_IN_PROGRESS` 로 막힌다 (2026-08-15 실사용 신고).
   *
   * 씬 code 를 함께 들고 있는 것은 `resumeLine` 과 같은 이유다 — 그 씬에 닿았을 때만 연다.
   */
  const [resumeMission, setResumeMission] = useState<{
    sceneCode: string;
    mission: MissionStart;
  } | null>(null);

  /**
   * 이야기 시작 = 세션 열기 (명세 5절). 반복 안전이라 몇 번 눌러도 같은 세션이다.
   * - resumed=false → part1 부터 (지금과 같음)
   * - resumed=true → pending_turn 있으면 resume 먼저 → 직전 컷 묶음의 **마지막 컷**부터 (결정 ⑦)
   * - 열기 실패 → 세션 없이 기존 고정 문구 재생 — 이야기는 멈추지 않는다
   */
  const beginStory = async () => {
    if (opening) return;
    setOpening(true);
    try {
      let opened = await openSession("fart-bride");
      if (opened.pending_turn) {
        try {
          const resumed = await resumeSessionTurn(opened.session_id);
          /* 이어 돌린 턴이 장면을 끝냈으면 다시 열어 따라잡는다 (명세 4.3절) */
          if (resumed.next.kind === "장면끝") opened = await openSession("fart-bride");
        } catch {
          /* resume 실패 — 세션은 그대로 진행하고, 다음 턴의 409 처리에 맡긴다 */
        }
      }
      setSession(opened);
      setServerScene(opened.status === "in_progress" ? (opened.scene?.code ?? null) : null);
      /* 서버가 새로 열어 준 미션 — 그 씬에 닿으면 팝업을 처음부터 연다 (M4) */
      if (opened.mission && opened.scene) {
        setResumeMission({ sceneCode: opened.scene.code, mission: opened.mission });
      }
      if (opened.resumed && opened.status === "in_progress" && opened.scene) {
        const scene = opened.scene;
        const target = steps.findIndex(
          (s) => s.kind === "interactive" && s.sceneCode === scene.code,
        );
        if (target >= 0) {
          if (opened.last_character_line) {
            setResumeLine({ stepId: steps[target].id, text: opened.last_character_line.text });
          }
          /* 결정 ⑦: 직전 영상으로 아이가 맥락을 되찾는다 — 다만 직전이 컷 묶음이면
             통째(사실상 처음부터)가 아니라 **마지막 컷 하나만** 틀고 대화로 들어간다.
             직전이 컷 묶음이 아니거나 대화가 첫 스텝이면 대화로 바로 간다. */
          const prev = target > 0 ? steps[target - 1] : null;
          if (prev?.kind === "cuts") {
            setResumeCutStart({ stepId: prev.id, cutIndex: prev.cuts.length - 1 });
            goTo(target - 1);
          } else {
            goTo(target);
          }
        } else {
          /* 서버가 기다리는 장면이 앱에 아직 없다(대화 10·16 미연결 — 컷 플랜이 채워지면
             생긴다). 처음부터 다시 틀면 이어하기가 아닌 것처럼 보인다(2026-08-14 실사용) —
             이미 지나온 **마지막 대화의 다음 스텝**부터 이어 튼다. 장면 code 는 사전순 =
             진행순(sc_banggui_03 < 05 < 07)이라 문자열 비교로 충분하다. */
          let passed = -1;
          steps.forEach((s, i) => {
            if (s.kind === "interactive" && s.sceneCode !== "" && s.sceneCode < scene.code) {
              passed = i;
            }
          });
          if (passed >= 0 && passed + 1 < steps.length) goTo(passed + 1);
        }
      }
    } catch (error) {
      console.warn("세션 열기 실패 — 서버 없이 재생한다", error);
    } finally {
      setOpening(false);
      start();
    }
  };

  /* 건너뛰기 — 컷 묶음 재생 중에는 스텝째가 아니라 한 컷씩 넘긴다.
     마지막 컷에서는 cuts-player 가 onEnded 로 다음 스텝을 부른다.

     ⭐ 대화 씬을 넘길 때는 **서버도 같이 넘긴다.** 영상 구간은 앱 혼자 하는 일이라 보고가
     없지만(결정 ⑧), 대화 장면은 서버가 거기서 아이를 계속 기다리고 그 어긋남은 스스로
     풀리지 않는다 — 남은 대화가 전부 어긋남 가드에 걸려 고정 문구로 떨어진다. */
  const cutsRef = useRef<CutsPlayerHandle | null>(null);
  const skip = () => {
    if (step?.kind === "cuts" && cutsRef.current) {
      cutsRef.current.skipCut();
      return;
    }
    if (step?.kind === "interactive") {
      setResumeLine(null);
      if (session && step.sceneCode !== "" && step.sceneCode === serverScene) {
        /* 응답이 오기 전에 이 씬으로 턴이 나가지 않게 추적을 먼저 끊는다 */
        setServerScene(null);
        skipSessionSceneWithResume(session.session_id, step.sceneCode, "fart-bride")
          .then((code) => setServerScene(code))
          .catch((error: unknown) => {
            /* 실패해도 이야기는 멈추지 않는다 — 남은 대화는 고정 문구로 돌고,
               서버 기록은 그대로라 다음 진입 때 건너뛴 대화로 복귀한다. */
            console.info("[장면] 건너뛰기 알림 실패 — 서버는 그 장면에 남는다", error);
          });
      }
    }
    next();
  };

  /* ── 말하기 후 활동 (이슈 #46 · `docs/말하기후활동_명세.md` 8절 ①) ──────────
     끝 화면에 **늘 버튼이 선다.** 할지 말지는 아이가 고른다 (2026-08-15 결정 — 그전에는
     서버가 열어 준다고 답했을 때만 버튼을 그려서, 아이 눈에는 될 때도 있고 안 될 때도
     있는 것으로 보였다). 카드·핵심 단어는 서버 config 가 정본이라 팝업까지 그대로
     흘려보낸다 (F1 · 수용 기준 2). */
  const [postActivity, setPostActivity] = useState<PostActivityOpen | null>(null);
  const [finaleOpen, setFinaleOpen] = useState(false);
  /* 이 이야기엔 활동이 **아예 없다**(404) — 그때만 버튼을 감춘다 (F13) */
  const [활동없음, set활동없음] = useState(false);
  /* 눌러서 여는 중 — 서버를 닫아야 하는 판이면 몇 초 걸린다 */
  const [활동여는중, set활동여는중] = useState(false);
  const [활동못열림, set활동못열림] = useState(false);
  const sessionId = session?.session_id ?? null;

  /** 이 판에서 이미 닫기를 시도했나 — 끝 화면에 닿을 때 **한 번만** 한다 */
  const 닫기_시도했나 = useRef(false);

  /**
   * ⭐ **끝 화면에 닿으면 서버의 이야기를 닫고 활동을 미리 받아 둔다.**
   *
   * 🔴 닫는 것이 절반이다. 리포트를 만드는 길 셋(이야기 끝 · 활동 종료 · 보호자 열람 받침)이
   * **전부 `completed` 인 세션만** 본다. 아이가 마지막 대화에서 말을 안 하고 지나가면 서버는
   * 그 장면에 그대로 서고, 그 판은 활동을 하든 안 하든 **리포트가 영영 안 만들어진다.**
   * 활동이 선택이 되면서(2026-08-15) 이 구멍이 커졌다 — 안 누르는 아이가 그대로 빠진다.
   * 그래서 누를 때가 아니라 **끝 화면에 닿을 때** 닫는다.
   *
   * ⛔ 아이를 기다리게 하지 않는다 — 배경에서 돌고, 실패해도 화면은 그대로다.
   * ⚠️ 미리 받아 두는 덕에 버튼이 기다림 없이 열린다. 여기서 실패해도 버튼은 남고,
   *    누를 때 같은 함수로 한 번 더 푼다 (`활동을_연다`).
   */
  useEffect(() => {
    if (!finished || sessionId === null || 닫기_시도했나.current) return;
    닫기_시도했나.current = true;
    let alive = true;
    openPostActivityClosingStory(sessionId, "fart-bride", serverScene)
      .then((opened) => {
        if (!alive) return;
        setServerScene(null);
        setPostActivity(opened);
      })
      .catch((error: unknown) => {
        if (
          alive &&
          error instanceof SessionApiError &&
          error.code === "POST_ACTIVITY_NOT_CONFIGURED"
        ) {
          /* 이 이야기엔 활동이 없다 — 기다린다고 생기지 않는다 (F13) */
          set활동없음(true);
        }
        console.info("[후활동] 미리 열기 실패 — 버튼을 누를 때 다시 푼다", error);
      });
    return () => {
      alive = false;
    };
  }, [finished, sessionId, serverScene]);

  /**
   * 「이야기 순서 맞추기」를 눌렀다 — 미리 받아 뒀으면 곧바로, 아니면 풀어서 연다.
   *
   * 🔴 푸는 자리가 `openPostActivityClosingStory()` 다 (그 머리말) — 서버가 아직 이야기를
   * 안 닫았으면 **남은 장면을 밀어 닫고** 연다. 아이가 마지막 대화에서 말을 안 하고
   * 지나간 판이 그렇고, 그런 판은 기다려도 영영 안 닫힌다.
   *
   * ⚠️ 건너뛰기는 미완 턴 복구를 안고 있어 몇 초 걸릴 수 있다 — 그동안 버튼이
   *    「여는 중…」으로 서 있는다.
   */
  const 활동을_연다 = () => {
    set활동못열림(false);
    if (postActivity !== null) {
      setFinaleOpen(true);
      return;
    }
    if (sessionId === null || 활동여는중) return;
    set활동여는중(true);
    openPostActivityClosingStory(sessionId, "fart-bride", serverScene)
      .then((열림) => {
        /* 밀어 닫았으면 서버는 더 기다리는 장면이 없다 */
        setServerScene(null);
        setPostActivity(열림);
        setFinaleOpen(true);
      })
      .catch((error: unknown) => {
        set활동못열림(true);
        console.info("[후활동] 끝내 열지 못했다", error);
      })
      .finally(() => set활동여는중(false));
  };

  /**
   * 활동 팝업을 닫는다 — 마쳤든 그냥 닫았든 같은 길이다.
   *
   * 닫는 김에 결과를 다시 읽어 둔다. 아이가 순서만 맞추고 닫았다가 다시 열면 그 자리에서
   * 이어져야 하는데, 팝업은 열릴 때 받은 `result` 만 보기 때문이다. **여는 자리가 아니라
   * 닫는 자리에서** 받는 것은 아이를 기다리게 하지 않으려는 것이다.
   */
  const closeFinale = () => {
    setFinaleOpen(false);
    if (sessionId === null) return;
    fetchPostActivity(sessionId)
      .then(setPostActivity)
      .catch((error: unknown) => {
        /* 실패하면 방금까지 쓰던 값을 그대로 둔다 — 버튼이 사라지면 안 된다 */
        console.info("[후활동] 결과 다시 읽기 실패 — 지난 값을 그대로 쓴다", error);
      });
  };

  /**
   * 끝 화면을 떠난다 — ⭐ **리포트를 만드는 신호다** (F11 · 명세 5.D).
   *
   * 다시 보기 · 이야기 소개로가 이 길을 탄다. 「마치기」를 이미 눌렀어도 한 번 더
   * 가는데, 서버가 삼킨다 — **「이미 불렀나」를 앱이 관리하지 않는다.**
   */
  const leaveFinish = () => {
    if (sessionId === null) return;
    /* 🔴 「활동을 미리 받아 왔을 때만」이라는 문지기가 여기 있었는데 걷어냈다 (2026-08-15).
       못 받은 판이 바로 서버가 안 닫힌 판이고, **그때야말로 보내야 하는 신호**다.
       활동이 없는 이야기면 서버가 404 로 삼킨다 — 그 리포트는 이미 만들어져 있다 (F13). */
    completePostActivity(sessionId, "left").catch((error: unknown) => {
      console.info("[후활동] 종료 알림 실패 — 리포트는 보호자 열람 때 만들어진다 (F12)", error);
    });
  };

  /* 브라우저 뒤로가기·탭 닫기 — 그 순간의 fetch 는 취소돼서 sendBeacon 으로 보낸다.
     🟡 명세에 없는 보탬이라 되돌려도 된다 (F12 가 받아 준다) */
  useEffect(() => {
    if (!finished || sessionId === null) return;
    const onHide = () => beaconPostActivityComplete(sessionId, "left");
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [finished, sessionId]);

  /* 미니게임 팝업 (이슈 #20) — 열기 신호는 대화 씬의 턴 응답 next.kind === "미션시작"
     뿐이다 (다리 대사 재생이 끝난 뒤 — M8). 개발용 SPACE 순환은 /dev/minigame 으로
     격리했다 — 아이 앱 재생 화면에서 SPACE 는 아무 일도 하지 않는다. */
  const [mission, setMission] = useState<MissionStart | null>(null);
  /* 팝업을 연 대화 씬의 핸들 — 닫힌 결과를 넣어 주면 씬이 종료 요약을 재생하고
     분기한다 (M8·M6). 팝업은 대화 씬 위에서만 열리므로 그 씬이 아직 붙어 있다. */
  const sceneRef = useRef<InteractiveSceneHandle | null>(null);

  const closeMission = (result: MissionCompleteResult | null) => {
    setMission(null);
    sceneRef.current?.missionClosed(result);
  };

  /* 지금 컷 묶음 바로 다음 스텝 — 대화 씬이면 컷 재생기가 끝에서 「대화 시작」 버튼을 세운다 */
  const afterStep = steps[stepIndex + 1] ?? null;

  /* M8 — 팝업이 열린 동안 배경·대화 오디오 일시정지. 재생 중이던 미디어만 멈췄다가
     닫히면 그 목록만 되살린다 (미션 뒤 이야기 진행은 씬 콜백이 잇는다). */
  const stageRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (mission === null) return;
    const paused = Array.from(
      stageRef.current?.querySelectorAll<HTMLMediaElement>("audio, video") ?? [],
    ).filter((media) => !media.paused);
    for (const media of paused) media.pause();
    return () => {
      for (const media of paused) void media.play().catch(() => {});
    };
  }, [mission]);

  return (
    <main className="relative h-[1024px] w-full overflow-hidden bg-story-bg">
      {!started && (
        <div className="flex h-full flex-col items-center justify-center gap-8">
          <h1 className="text-[40px] font-extrabold text-ink">방귀 뀌는 며느리</h1>
          <p className="text-[18px] font-bold text-ink-mid">
            이야기 중간중간 등장인물이 말을 걸어요. 마이크를 준비해 주세요!
          </p>
          <button
            type="button"
            onClick={beginStory}
            disabled={opening}
            className="rounded-2xl bg-primary px-14 py-5 text-[26px] font-extrabold text-white disabled:opacity-60"
          >
            {opening ? "이야기 여는 중…" : "이야기 시작"}
          </button>
        </div>
      )}

      {started && finished && (
        <div className="flex h-full flex-col items-center justify-center gap-8">
          <h1 className="text-[40px] font-extrabold text-ink">이야기 끝!</h1>
          <p className="text-[18px] font-bold text-ink-mid">
            며느리와 이야기 나눠 줘서 고마워요.
          </p>
          <div className="flex gap-4">
            {/* 🔴 서버가 뭐라 답하든 **늘 선다.** 할지 말지는 아이가 고른다
                (2026-08-15 결정 · 수용 기준 1). 이 이야기에 활동이 아예 없을 때만 뺀다 */}
            {!활동없음 && (
              <button
                type="button"
                onClick={활동을_연다}
                disabled={활동여는중}
                className="rounded-2xl bg-brand-900 px-10 py-4 text-[20px] font-extrabold text-white disabled:opacity-60"
              >
                {활동여는중 ? "여는 중…" : "이야기 순서 맞추기"}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                /* 끝 화면을 떠난다 — 활동을 안 했어도 리포트가 만들어진다 (F11) */
                leaveFinish();
                /* 다시 보기는 완전한 처음부터 — 남아 있을 수 있는 재개 지시를 소거한다 */
                setResumeLine(null);
                setResumeCutStart(null);
                setPostActivity(null);
                set활동못열림(false);
                /* 다음 판도 끝나면 다시 닫아야 한다 */
                닫기_시도했나.current = false;
                restart();
              }}
              className="rounded-2xl bg-white px-10 py-4 text-[20px] font-extrabold text-ink"
            >
              다시 보기
            </button>
            <Link
              href="/stories/fart-bride"
              onClick={leaveFinish}
              className="rounded-2xl bg-primary px-10 py-4 text-[20px] font-extrabold text-white"
            >
              이야기 소개로
            </Link>
          </div>
          {/* 끝내 못 열었다 — 버튼이 아무 일도 안 하는 것처럼 보이지 않게 한 줄 남긴다 */}
          {활동못열림 && (
            <p className="text-[15px] font-bold text-point-strong">
              지금은 열 수 없어요. 잠시 뒤에 다시 눌러 주세요.
            </p>
          )}
        </div>
      )}

      {started && step && (
        <div ref={stageRef} className="h-full w-full bg-black [perspective:2000px]">
          <div
            key={step.id}
            className={`relative h-full w-full ${turning ? "page-turn" : ""}`}
          >
            {step.kind === "video" ? (
              <PartVideo step={step} onEnded={next} />
            ) : step.kind === "cuts" ? (
              <CutsPlayer
                step={step}
                startCut={
                  resumeCutStart?.stepId === step.id ? resumeCutStart.cutIndex : undefined
                }
                /* 다음 스텝이 대화 씬이면 — 컷이 끝나도 자동으로 안 넘어가고,
                   화자 이름을 단 「대화 시작」 버튼을 아이가 누른다 */
                nextDialogue={
                  afterStep?.kind === "interactive"
                    ? { speaker: afterStep.speaker.label }
                    : null
                }
                onEnded={() => {
                  /* 재개 시작 컷은 한 번만 — 이 스텝을 떠나면 소거해 다음 진입은 처음 컷부터 */
                  if (resumeCutStart?.stepId === step.id) setResumeCutStart(null);
                  next();
                }}
                ref={cutsRef}
              />
            ) : (
              <InteractiveScene
                step={step}
                childName={childName}
                sessionId={session?.session_id ?? null}
                serverScene={serverScene}
                onServerScene={setServerScene}
                resumeLine={resumeLine?.stepId === step.id ? resumeLine.text : null}
                resumeMission={
                  resumeMission?.sceneCode === step.sceneCode ? resumeMission.mission : null
                }
                onMissionStart={(m) => {
                  /* 이어하기로 열렸으면 여기서 소진한다 — 닫고 대화로 돌아온 뒤
                     이 씬이 다시 마운트돼도 팝업이 또 뜨면 안 된다 */
                  setResumeMission(null);
                  setMission(m);
                }}
                ref={sceneRef}
                onComplete={() => {
                  setResumeLine(null); // 복귀 한 줄은 한 번만 — 다음 진입은 정상 흐름
                  next();
                }}
              />
            )}
            {turning && (
              <div className="page-turn-shade pointer-events-none absolute inset-0 bg-gradient-to-r from-black/60 via-black/20 to-transparent" />
            )}
          </div>

          {/* 상단 바 — 뒤로가기, 진행 점, 건너뛰기(테스트용) */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent px-6 pt-5 pb-10">
            <Link href="/stories/fart-bride" aria-label="뒤로가기">
              <Image
                src="/figma/icons/arrow-left.svg"
                alt=""
                width={36}
                height={36}
                className="brightness-0 invert"
              />
            </Link>

            <div className="flex items-center gap-2">
              {steps.map((s, index) => (
                <span
                  key={s.id}
                  className={`rounded-full ${
                    s.kind === "interactive" ? "size-3" : "size-2.5"
                  } ${index <= stepIndex ? "bg-white" : "bg-white/30"}`}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={skip}
              className="rounded-lg bg-white/20 px-4 py-2 text-[15px] font-bold text-white"
            >
              건너뛰기
            </button>
          </div>
        </div>
      )}

      {/* 미션 코드 → 화면 번호 (명세 3절 — ms_banggui_pear=미션1 · ms_banggui_friend=미션2).
          마무리(3)는 이야기가 끝난 뒤에만 열리므로 미션 팝업과 겹칠 일이 없다 (이슈 #46) */}
      <MinigamePopup
        open={mission !== null || finaleOpen}
        mission={finaleOpen ? 3 : mission?.code === "ms_banggui_friend" ? 2 : 1}
        childName={childName}
        sessionId={sessionId}
        missionSessionId={mission?.mission_session_id ?? null}
        config={mission?.config ?? null}
        missionApi={REAL_MISSION_API}
        postActivity={
          finaleOpen && sessionId !== null && postActivity !== null
            ? {
                sessionId,
                config: postActivity.config,
                result: postActivity.result,
                api: REAL_POST_ACTIVITY_API,
              }
            : null
        }
        onClose={() => (finaleOpen ? closeFinale() : closeMission(null))}
        onComplete={(result) => (finaleOpen ? closeFinale() : closeMission(result))}
      />
    </main>
  );
}

/**
 * 파트 영상 + 자막. 타이밍은 subtitles.ts (story_database.json 의 음성
 * 길이로 자동 생성 — 영상이 음성을 그대로 이어붙인 것이라 오차 0.05초 이내).
 */
function PartVideo({ step, onEnded }: { step: VideoStep; onEnded: () => void }) {
  const [time, setTime] = useState(0);
  const cue = (VIDEO_SUBTITLES[step.id] ?? []).find(
    (c) => time >= c.start && time < c.end,
  );

  return (
    <div className="relative h-full w-full">
      <video
        src={step.src}
        autoPlay
        playsInline
        onEnded={onEnded}
        onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
        className="h-full w-full object-contain"
      />
      {cue && (
        <div className="pointer-events-none absolute inset-x-0 bottom-8 flex justify-center px-10">
          <p className="max-w-[900px] rounded-2xl bg-black/55 px-6 py-4 text-center text-[22px] font-bold leading-[1.5] text-white">
            {cue.speaker && (
              <span className="mr-2 text-[18px] text-amber-300">{cue.speaker}</span>
            )}
            {cue.text}
          </p>
        </div>
      )}
    </div>
  );
}
