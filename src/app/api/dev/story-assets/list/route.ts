import { readdir } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { SOURCE_ROOT } from "../source-root";

/**
 * 소스 폴더의 에셋 파일명 목록 — /dev/video-maker 의 이미지 교체·대사 연결
 * 선택지가 된다. 실제 존재하는 파일만 내려가므로 "사운드 있는 대사만 연결"
 * 이 자연히 보장된다.
 */
export async function GET() {
  const [image, sound] = await Promise.all([
    readdir(path.join(SOURCE_ROOT, "image")),
    readdir(path.join(SOURCE_ROOT, "sound")),
  ]);
  return NextResponse.json({
    image: image.filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort(),
    sound: sound.filter((f) => /\.(wav|mp3)$/i.test(f)).sort(),
  });
}
