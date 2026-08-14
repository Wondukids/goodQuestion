import path from "node:path";

/** dev 에셋 라우트들이 읽는 원본 소스 폴더 (한글 파일명 이미지·음성) */
export const SOURCE_ROOT = path.join(
  process.cwd(),
  "content",
  "stories",
  "fart-bride",
  "source",
);
