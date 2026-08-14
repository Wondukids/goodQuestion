import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// ── 굿퀘스천 대화 엔진의 층 경계 (이슈 #26 이식) ─────────────────────────────
// 층 사이의 의존 방향을 여기서 막는다 (파이썬 레포 docs/설계/코드구조.md 4절).
// 말로만 두면 안 지켜진다 — 파이썬이 tests/test_boundary.py 로 막던 자리다.
//
// 아래로만 흐른다:
//   domain  ←  아무것도 import 하지 않는다. 그래서 황금표로 기계 대조가 된다
//   repo    ←  Drizzle 스키마만
//   engine  ←  llm · prompts
//   service ←  위를 조립한다
//   app     ←  service 만
// ⚠️ 패턴을 두 형태로 넣는다. `**/llm/**` 는 `@/lib/llm` 을 **안 잡는다** —
//    뒤에 경로가 더 붙어야 매치되기 때문이다. 폴더를 통째로 막으려면 둘 다 필요하다.
const 갈래 = (무엇) => [`**/${무엇}`, `**/${무엇}/**`];

const 층경계 = (이름, 금지) => ({
  files: [`src/lib/${이름}/**/*.ts`],
  rules: {
    "no-restricted-imports": [
      "error",
      { patterns: 금지.map((p) => ({ group: 갈래(p.무엇), message: p.왜 })) },
    ],
  },
});

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  // domain — 순수 규칙. 같은 입력이면 항상 같은 답이 나와야 한다.
  층경계("domain", [
    { 무엇: "llm", 왜: "domain 은 LLM 을 부르지 않는다 (CLAUDE.md 경계 2)" },
    { 무엇: "repo", 왜: "domain 은 DB 를 모른다. 값은 인자로 받아라" },
    { 무엇: "engine", 왜: "domain 은 최하층이다" },
    { 무엇: "service", 왜: "domain 은 최하층이다" },
    { 무엇: "db", 왜: "domain 은 DB 를 모른다" },
  ]),

  // repo — SQL 이 사는 유일한 곳.
  층경계("repo", [
    { 무엇: "engine", 왜: "repo 는 위층을 모른다" },
    { 무엇: "service", 왜: "repo 는 위층을 모른다" },
    { 무엇: "llm", 왜: "저장 계층에서 LLM 을 부르지 않는다" },
  ]),

  // engine — 어댑터. 재료를 만들어 llm 에 보내고 zod 로 읽는다.
  층경계("engine", [
    { 무엇: "service", 왜: "engine 은 조립층을 모른다" },
    { 무엇: "repo", 왜: "재료는 인자로 받는다 — 코어는 값이 어디서 왔는지 모른다" },
  ]),

  // app — 화면과 라우트. service 만 부른다.
  // ⚠️ 저쪽 제품 화면(`src/app/(main)` · `children` · `stories` …)도 이 글롭에 든다.
  //    그쪽은 Supabase 를 쓰고 `@/lib/repo`·`@/lib/llm` 을 안 부르므로 걸리지 않는다.
  {
    files: ["src/app/**/*.ts", "src/app/**/*.tsx"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["**/lib/repo", "**/lib/repo/**"], message: "화면·라우트는 service 를 거친다" },
            { group: ["**/lib/llm", "**/lib/llm/**"], message: "화면·라우트는 LLM 을 직접 부르지 않는다" },
          ],
        },
      ],
    },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
