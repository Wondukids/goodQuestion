import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// 이 파일은 **레포 루트**에 있다. 코드는 `src/` 아래이므로 `@` 는 한 칸 내려야 한다
// (저쪽 `tsconfig.json` 의 `"@/*": ["./src/*"]` 과 같은 뜻).
const here = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // ⛔ `*.real.test.ts` 는 **진짜 공급자를 부르는 검사**라 기본 실행에서 뺀다.
    //    파이썬 `addopts = -m 'not llm'` 에 해당한다.
    //    ⚠️ 파이썬은 그 표시가 붙은 검사가 0 개라 아무것도 안 막고 있었다.
    //       여기서는 F-1 그물이 표시와 무관하게 먹으므로 이 줄에 기대지 않는다.
    exclude: ['**/node_modules/**', '**/*.real.test.ts'],
    setupFiles: ['./tests/setup.ts'],
  },
  resolve: {
    alias: { '@': path.join(here, 'src') },
  },
})
