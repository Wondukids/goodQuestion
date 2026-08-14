import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { SOURCE_ROOT } from "../source-root";

/**
 * content/stories/fart-bride/source 의 원본 에셋(한글 파일명 이미지·음성)을
 * 서빙하는 개발용 라우트 — /dev/video-maker 가 쓴다.
 *
 * public 으로 복사하지 않는 이유: 원본이 수십 MB 인 데다 파일 교체가 잦은
 * 제작 단계라, 복사본이 생기면 어느 쪽이 최신인지 헷갈린다. 여기서는 항상
 * content 의 파일을 그대로 읽는다.
 */

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/dev/story-assets/[...file]">,
) {
  const { file } = await ctx.params;
  const [kind, ...rest] = file;
  if ((kind !== "image" && kind !== "sound") || rest.length === 0) {
    return NextResponse.json({ error: "잘못된 경로입니다." }, { status: 400 });
  }

  /* ".." 세그먼트로 소스 폴더 밖을 읽지 못하게 막는다 */
  const resolved = path.resolve(SOURCE_ROOT, kind, ...rest);
  if (!resolved.startsWith(SOURCE_ROOT + path.sep)) {
    return NextResponse.json({ error: "잘못된 경로입니다." }, { status: 400 });
  }

  const contentType = CONTENT_TYPES[path.extname(resolved).toLowerCase()];
  if (!contentType) {
    return NextResponse.json({ error: "지원하지 않는 형식입니다." }, { status: 415 });
  }

  try {
    const data = await readFile(resolved);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        /* 제작 중 파일이 교체되므로 브라우저에 오래 캐시하지 않는다 */
        "Cache-Control": "no-cache",
      },
    });
  } catch {
    return NextResponse.json(
      { error: `파일이 없습니다: ${path.relative(SOURCE_ROOT, resolved)}` },
      { status: 404 },
    );
  }
}
