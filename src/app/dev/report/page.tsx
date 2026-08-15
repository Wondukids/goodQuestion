"use client";

import { useState } from "react";
import { ReportView } from "@/components/report/report-view";
import { toReportView } from "@/lib/report";
import type { ParentReport } from "@/report/types";
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
 *
 * 배포 화면과 무관한 개발 도구라 (main) 레이아웃 밖 /dev 아래 둔다.
 */

/** 축을 전부 0 으로 눌러 오각형이 안 그려지는 판을 만든다 */
function 축이_전부_0(): ParentReport {
  const report = 사본(짧게_답한_아이);
  for (const axis of Object.values(report.metrics.axes)) axis.score = 0;
  return report;
}

const 판 = [
  { key: "4.1", label: "4.1 말을 잘한 아이", report: () => 잘한_아이 },
  { key: "4.2", label: "4.2 짧게만 답한 아이 · 첫 활동", report: () => 짧게_답한_아이 },
  { key: "zero", label: "축이 전부 0", report: 축이_전부_0 },
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
