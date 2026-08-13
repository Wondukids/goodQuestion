// 대사 검수 내보내기 — `GET /review/export/utterances`.
//
// 파이썬 `routes/review.py` 의 `대사_내보내기()` 자리다.
//
// 🔴 여기도 **사람이 확정한 것만**이다 (보류 제외 · `graded_by <> 'auto'`).
// ⚠️ 행을 **그대로** 싣는다 — 칸 이름이 DB 컬럼 이름이다 (`CLAUDE.md` 로그 절과 같은 잣대).
// ⚠️ 주소가 파이썬(`/export/utterances`)과 갈렸다 — 검수 폴더 아래로 모았다.

import { exportUtterances } from '@/lib/service/review'

export async function GET(): Promise<Response> {
  const { body, exported_at } = await exportUtterances()
  return new Response(body, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Content-Disposition': 'attachment; filename="goodquestion-utterances.jsonl"',
      'X-Exported-At': exported_at.toISOString(),
    },
  })
}
