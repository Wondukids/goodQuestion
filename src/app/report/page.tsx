import { ReportScreen } from "@/components/report/report-screen";
import { requireSelectedChild } from "@/lib/selected-child";

/**
 * 보호자 리포트 — 마이페이지의 보호자 카드가 이리로 연결된다.
 * 보호자용 화면이라 상단·하단 네비 없이 (main) 레이아웃 밖에 둔다.
 *
 * 이 서버 컴포넌트가 하는 일은 **누구의 리포트인가를 정하는 것**뿐이다.
 * 값은 `ReportScreen` 이 리포트 API 에서 받아 온다 (`lib/report-api.ts`).
 */
export default async function ReportPage() {
  const child = await requireSelectedChild();

  return (
    <ReportScreen
      childId={child.id}
      childName={child.name}
      characterId={child.character_id}
    />
  );
}
