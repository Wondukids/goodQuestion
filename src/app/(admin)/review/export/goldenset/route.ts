// 분석 정답지 내보내기 — `GET /review/export/goldenset`.
//
// 파이썬 `routes/review.py` 의 `골든셋_내보내기()` 자리다 (FR-048 · 049 · SC-021).
//
// 🔴 **사람이 확정한 분석 검수만 담긴다.** 자동 채점도 보류도 안 담긴다 —
//    정답지는 사람이 눈으로 본 것만이어야 하고, 그게 이 화면의 산출물이다.
//
// ⭐ 첫 줄이 `// exported_at: …` 인 것은 파이썬 그대로다. `goldenset.읽기()` 가 `//` 줄을
//    건너뛰므로 **내려받은 파일을 엔진이 그대로 다시 읽는다.**
//
// ⚠️ 주소가 파이썬(`/export/goldenset`)과 갈렸다 — 검수 폴더 아래로 모았다.
// ⚠️ 파일을 **쓰지 않는다.** 정본은 `goldenset/*.jsonl` 이고 사람이 옮긴다 (경계 6).

import { exportGoldenset } from '@/llm/service/review'

export async function GET(): Promise<Response> {
  const { body, exported_at } = await exportGoldenset()
  return new Response(body, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Content-Disposition': 'attachment; filename="goodquestion-goldenset.jsonl"',
      'X-Exported-At': exported_at.toISOString(),
    },
  })
}
