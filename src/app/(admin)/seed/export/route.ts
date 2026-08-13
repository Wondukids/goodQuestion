// ⭐ `GET /seed/export` — 지금 작업값을 **옮겨 붙일 SQL** 로 내려준다.
//
// 파이썬 `routes/seed.py` 의 `시드_내보내기()` 자리다.
//
// 🔴 **이 왕복이 끊기면 콘텐츠 정본 관리가 죽는다.** `CLAUDE.md` 「DB」 절이 못박아 둔
//    경로가 이것이다 — 「관리자 페이지에서 손보고 `/seed/export` 로 내려받아 사람이
//    `sql/002_seed_banggui.sql` 에 옮긴다」. 화면이 시드 파일을 직접 쓰는 길은 없다.
//
// ⚠️ `(admin)` 은 경로에 안 들어가는 묶음 폴더라 주소는 `/seed/export` 다
//    (Next `route-groups.md`).
// ⚠️ 라우트 핸들러는 기본으로 **캐시되지 않는다** (Next 16 `15-route-handlers.md`).
//    작업값은 매번 다시 읽혀야 하므로 그 기본값이 우리가 원하는 것이다.

import { seedExportSql } from '@/lib/service/seed'

export async function GET(): Promise<Response> {
  const 본문 = await seedExportSql()
  return new Response(본문, {
    headers: {
      // `text/plain` 이라 브라우저에서 열어 훑을 수도 있다. 파이썬과 같은 파일 이름이다.
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Disposition': 'attachment; filename=seed_admin_export.sql',
    },
  })
}
