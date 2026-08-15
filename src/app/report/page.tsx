import { ReportView } from "@/components/report/report-view";
import { buildReport } from "@/lib/report";
import { requireSelectedChild } from "@/lib/selected-child";

/**
 * 보호자 리포트 — 마이페이지의 보호자 카드가 이리로 연결된다.
 * 보호자용 화면이라 상단·하단 네비 없이 (main) 레이아웃 밖에 둔다.
 *
 * 화면에 실리는 분석 값은 아직 목업이다 — lib/report.ts 참고.
 */
export default async function ReportPage() {
  const child = await requireSelectedChild();

  return (
    <ReportView
      report={buildReport(child.name)}
      characterId={child.character_id}
    />
  );
}
