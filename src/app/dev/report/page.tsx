"use client";

import { useState } from "react";
import { ReportView } from "@/components/report/report-view";
import { toReportView } from "@/lib/report";
import type { ParentReport, PostActivity } from "@/report/types";
import { 사본, 짧게_답한_아이, 잘한_아이 } from "./sample-reports";

/**
 * 보호자 리포트만 따로 띄워 보는 개발용 화면 — 로그인 없이 /dev/report 로 연다.
 *
 * 리포트 API(#38)가 아직 없어 붙일 서버가 없다. 그래서 **계약 문서 4절의 샘플 응답 둘**을
 * 그대로 어댑터에 넣어 그린다 (/dev/minigame 이 목 미션 API 로 미니게임을 띄운 것과 같은 자리).
 * 검사(`tests/report-screen.test.ts`)가 보는 값과 **같은 파일**이라 눈과 검사가 안 갈린다.
 *
 * 재현 손잡이 — 판 셋이 이 화면이 마주칠 양극단이다:
 * - 4.1 두 탭이 다 차는 판
 * - 4.2 문장이 없는 판 (`narrative: null` · 첫 활동 · 「다시 만들기」)
 * - 축 0 판 (오각형 대신 안내 문구)
 * - 후활동 판 셋 (낱말 12개 · 순서만 · 판정 실패 — 이슈 #47)
 *
 * 배포 화면과 무관한 개발 도구라 (main) 레이아웃 밖 /dev 아래 둔다.
 */

/** 축을 전부 0 으로 눌러 오각형이 안 그려지는 판을 만든다 */
function 축이_전부_0(): ParentReport {
  const report = 사본(짧게_답한_아이);
  for (const axis of Object.values(report.metrics.axes)) axis.score = 0;
  return report;
}

/**
 * 말하기 후 활동 카드를 눈으로 보는 판 셋 (이슈 #47 · 후활동 명세 7.3).
 *
 * 계약 4절 샘플 둘에는 후활동이 없다 — 그것 자체가 「카드를 안 그리는 판」이라 그대로 두고,
 * 여기서 사본에 덩이를 얹는다. 🔴 **`null` 이 세 겹이고 셋이 다 다르게 그려진다** —
 * 안 했다(카드 없음) · 순서만 했다 · 판정을 못 했다.
 */
const 후활동_낱말 = [
  { card_id: "endure", word: "시집", status: "used", evidence: null },
  { card_id: "endure", word: "참다", status: "similar", evidence: "꾹 눌렀어요" },
  { card_id: "endure", word: "걱정", status: "missing", evidence: null },
  { card_id: "burst", word: "방귀", status: "used", evidence: null },
  { card_id: "burst", word: "깜짝", status: "missing", evidence: null },
  { card_id: "burst", word: "기둥", status: "missing", evidence: null },
  { card_id: "pear", word: "배나무", status: "used", evidence: null },
  { card_id: "pear", word: "힘껏", status: "missing", evidence: null },
  { card_id: "pear", word: "우수수", status: "missing", evidence: null },
  { card_id: "pride", word: "당당하다", status: "similar", evidence: "어깨를 폈어요" },
  { card_id: "pride", word: "칭찬", status: "missing", evidence: null },
  { card_id: "pride", word: "고마워", status: "missing", evidence: null },
] as const;

function 후활동을_얹은(덩이: PostActivity): ParentReport {
  const report = 사본(잘한_아이);
  report.metrics.post_activity = 덩이;
  return report;
}

const 후활동_순서 = {
  correct: true,
  attempts: 2,
  first_submission: ["burst", "endure", "pear", "pride"],
};

const 판 = [
  { key: "4.1", label: "4.1 말을 잘한 아이", report: () => 잘한_아이 },
  { key: "4.2", label: "4.2 짧게만 답한 아이 · 첫 활동", report: () => 짧게_답한_아이 },
  { key: "zero", label: "축이 전부 0", report: 축이_전부_0 },
  {
    key: "post",
    label: "후활동 — 낱말 12개",
    report: () =>
      후활동을_얹은({
        order: 후활동_순서,
        retelling: {
          analyzed: true,
          text: "며느리가 시집에서 방귀를 꾹 참다가, 배나무 앞에서 방귀를 뀌었어요.",
          used: 3,
          similar: 2,
          missing: 7,
          words: [...후활동_낱말],
        },
      }),
  },
  {
    key: "post-order",
    label: "후활동 — 순서만",
    report: () => 후활동을_얹은({ order: 후활동_순서, retelling: null }),
  },
  {
    key: "post-failed",
    label: "후활동 — 판정 실패",
    report: () =>
      후활동을_얹은({
        order: { correct: false, attempts: 3, first_submission: [] },
        retelling: {
          analyzed: false,
          text: "음… 며느리가 방귀를 뀌었어요.",
          used: 0,
          similar: 0,
          missing: 0,
          words: [],
        },
      }),
  },
] as const;

export default function DevReportPage() {
  const [key, setKey] = useState<(typeof 판)[number]["key"]>("4.1");
  const [message, setMessage] = useState<string | null>(null);

  const 고른 = 판.find((one) => one.key === key) ?? 판[0];
  const report = toReportView("dev-session", 고른.report(), "지우");

  return (
    /* ⚠️ 캔버스(1366×1024) 안이라 `h-screen`(100vh)은 실제 브라우저 높이를 가리킨다 —
       `globals.css` 의 .canvas 주석 참고. 높이는 ReportView 의 `h-full` 에 맡긴다. */
    <>
      <div className="sticky top-0 z-50 flex items-center gap-2 bg-[#3d3d3d] px-4 py-2 font-gothic text-[13px] font-bold text-story-bg">
        <span className="pr-2">/dev/report — 계약 4절 샘플</span>
        {판.map((one) => (
          <button
            key={one.key}
            type="button"
            onClick={() => {
              setKey(one.key);
              setMessage(null);
            }}
            className={`cursor-pointer rounded-full px-3 py-1 ${
              one.key === key ? "bg-story-bg text-[#3d3d3d]" : "bg-white/20"
            }`}
          >
            {one.label}
          </button>
        ))}
      </div>

      <ReportView
        key={key}
        report={report}
        characterId="rabbit"
        activities={[
          {
            sessionId: "dev-session",
            story: report.activity.story,
            date: report.activity.date,
            unread: report.unread,
          },
          {
            sessionId: "dev-older",
            story: "「방귀 뀌는 며느리」",
            date: "7월 29일",
            unread: false,
          },
        ]}
        onSelectActivity={() =>
          setMessage("개발 화면이라 다른 활동은 없어요 — 위쪽 버튼으로 판을 바꿔 보세요.")
        }
        onRegenerate={() =>
          setMessage("개발 화면이라 서버를 부르지 않아요 — 버튼이 보이는지만 봅니다.")
        }
        regenerating={false}
        message={message}
      />
    </>
  );
}
