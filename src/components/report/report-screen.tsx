"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ReportView } from "@/components/report/report-view";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import {
  toActivityChoices,
  toReportView,
  type ActivityChoice,
  type Report,
} from "@/lib/report";
import {
  fetchReport,
  fetchReportList,
  markReportRead,
  regenerateReport,
  ReportRequestError,
} from "@/lib/report-api";

/**
 * 리포트 화면의 조회·상태를 들고 있는 껍데기. 그림은 전부 `ReportView` 가 그린다.
 *
 * ## 왜 서버 컴포넌트가 아니라 여기서 부르나
 *
 * 네 API 가운데 셋이 **보호자가 손을 대야 도는 것**이다 — 활동을 바꿔 고르고,
 * 열었다고 알리고(`read`), 문장을 다시 만든다(`regenerate`). 서버에서 한 번 그려 두면
 * 셋 다 화면을 새로 고쳐야 하고, 서버에서 자기 라우트를 부르려면 절대 주소와 쿠키를
 * 손으로 실어야 한다. 이 레포가 자기 API 를 부르는 방식(상대 경로 · 브라우저)을 따른다.
 *
 * 로그인·아이 선택은 페이지(서버)가 `requireSelectedChild()` 로 이미 막았다.
 */
export function ReportScreen({
  childId,
  childName,
  characterId,
}: {
  childId: string;
  childName: string;
  characterId: string;
}) {
  const [activities, setActivities] = useState<ActivityChoice[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "none" | "error">(
    "loading",
  );
  const [regenerating, setRegenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  /* 활동을 빠르게 갈아 고르면 앞선 응답이 뒤에 도착할 수 있다 — 마지막 표만 받는다 */
  const ticket = useRef(0);
  /* 「열었다」는 회차마다 한 번만 알린다 (계약 2절 ⑤) */
  const marked = useRef(new Set<string>());

  const open = useCallback(
    async (sessionId: string) => {
      const mine = ++ticket.current;
      setPhase("loading");
      setMessage(null);
      try {
        const raw = await fetchReport(sessionId);
        if (mine !== ticket.current) return;
        if (!raw) {
          setReport(null);
          setPhase("none");
          return;
        }
        setReport(toReportView(sessionId, raw, childName));
        setPhase("ready");

        if (raw.read_at === null && !marked.current.has(sessionId)) {
          marked.current.add(sessionId);
          void markReportRead(sessionId);
          setActivities((was) =>
            was.map((activity) =>
              activity.sessionId === sessionId
                ? { ...activity, unread: false }
                : activity,
            ),
          );
        }
      } catch {
        if (mine === ticket.current) setPhase("error");
      }
    },
    [childName],
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const list = toActivityChoices(await fetchReportList(childId));
        if (cancelled) return;
        setActivities(list);
        /* 활동을 한 번도 안 한 아이는 실제로 생기는 상태다 — 빈 판이 아니라 안내를 낸다 */
        if (list.length === 0) {
          setPhase("none");
          return;
        }
        await open(list[0].sessionId);
      } catch {
        if (!cancelled) setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [childId, open]);

  const regenerate = useCallback(async () => {
    if (!report || regenerating) return;
    const sessionId = report.sessionId;
    setRegenerating(true);
    setMessage(null);
    try {
      const raw = await regenerateReport(sessionId);
      if (raw) setReport(toReportView(sessionId, raw, childName));
    } catch (error) {
      setMessage(
        error instanceof ReportRequestError && error.tooMany
          ? "다시 만들기는 세 번까지예요. 잠시 뒤에 다시 열어 주세요."
          : "문장을 다시 만들지 못했어요. 잠시 뒤에 다시 눌러 주세요.",
      );
    } finally {
      setRegenerating(false);
    }
  }, [report, regenerating, childName]);

  if (phase === "ready" && report) {
    return (
      <ReportView
        key={report.sessionId}
        report={report}
        characterId={characterId}
        activities={activities}
        onSelectActivity={open}
        onRegenerate={regenerate}
        regenerating={regenerating}
        message={message}
      />
    );
  }

  if (phase === "loading") {
    return (
      <Placeholder
        icon="description"
        title="리포트를 불러오고 있어요"
        description="잠시만 기다려 주세요."
      />
    );
  }

  if (phase === "none") {
    return (
      <Placeholder
        icon="description"
        title={`${childName}의 리포트가 아직 없어요`}
        description="이야기 활동을 한 번 마치면 리포트가 만들어져요."
      />
    );
  }

  return (
    <Placeholder
      icon="help"
      title="리포트를 불러오지 못했어요"
      description="잠시 뒤에 다시 열어 주세요."
    />
  );
}

/** 그릴 리포트가 없을 때의 한 판. 헤더의 돌아가는 문은 남겨 둔다. */
function Placeholder({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <main className="flex h-full flex-col bg-story-bg break-keep">
      <header className="flex h-[104px] shrink-0 items-center gap-4 px-12">
        <Link
          href="/mypage"
          aria-label="마이페이지로"
          className="flex size-12 items-center justify-center rounded-3xl border-2 border-surface-muted bg-story-bg text-ink-strong"
        >
          <MaterialSymbol name="chevron_left" size={20} />
        </Link>
        <h1 className="text-[26px] font-extrabold text-ink-strong">
          보호자 리포트
        </h1>
      </header>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3.5">
        <span className="flex size-16 items-center justify-center rounded-full bg-surface-muted text-[#8a8a8a]">
          <MaterialSymbol name={icon} size={30} />
        </span>
        <p className="text-[22px] font-extrabold text-ink-strong">{title}</p>
        <p className="text-[16px] font-bold text-ink-mid">{description}</p>
      </div>
    </main>
  );
}
