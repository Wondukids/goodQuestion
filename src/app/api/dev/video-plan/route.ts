import { writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";

/**
 * /dev/video-maker 의 "저장" — 편집한 플랜을 video-plan.json 에 그대로 쓴다.
 * 포맷(2칸 들여쓰기 + 개행)은 build_video_plan.mjs 출력과 동일하게 맞춰
 * 저장·재생성이 섞여도 diff 가 깨끗하다.
 */
const PLAN_PATH = path.join(
  process.cwd(),
  "src",
  "stories",
  "fart-bride",
  "video-plan.json",
);

export async function POST(request: NextRequest) {
  const plan = (await request.json()) as {
    story?: string;
    cuts?: unknown[];
  };
  /* 다른 데이터를 통째로 덮어쓰는 사고를 막는 최소한의 모양 검증 */
  if (plan?.story !== "fart-bride" || !Array.isArray(plan.cuts) || plan.cuts.length === 0) {
    return NextResponse.json(
      { error: "video-plan 형식이 아닙니다 — 저장하지 않았습니다." },
      { status: 400 },
    );
  }

  await writeFile(PLAN_PATH, JSON.stringify(plan, null, 2) + "\n", "utf8");
  return NextResponse.json({ ok: true, cuts: plan.cuts.length });
}
