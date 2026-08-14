import { defineConfig } from 'drizzle-kit'

import { 우리_스키마들, 우리_표_이름들, 푸시_가드 } from './src/llm/db/push-guard'
import { loadEnvFile } from './src/llm/config'

// ⚠️ `config({ path: '.env.local' })` 를 직접 부르지 않는다 — 그건 **cwd 기준**이라
//    한 곳만 봤다. `loadEnvFile()` 은 정해진 자리들을 순서대로 보고 `override: false` 라
//    먼저 읽은 쪽이 이긴다. (이 레포에는 `web/` 이 없어 루트 `.env.local` 이 유일한 자리다.)
loadEnvFile()

// 🔴 저쪽 DB 를 가리킨 채 `push` 를 돌리면 진짜 아이 계정이 든 표 일곱이 사라진다.
// 왜 여기서 터뜨리는지는 `src/db/push-guard.ts` 머리말에 있다 (이슈 #26 · 「다음 할 일」 0).
푸시_가드(process.argv, process.env.DATABASE_URL)

export default defineConfig({
  schema: './src/llm/db/schema.ts',
  out: './src/llm/db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
  // 둘째 담 — 명령줄과 상관없이 **우리가 선언한 18표 밖을 아예 안 본다.**
  // 위 가드가 argv 를 못 보게 되는 날(드리즐이 설정을 딴 프로세스에서 읽는 등)에도 남는다.
  tablesFilter: 우리_표_이름들(),
  // 🔴 이 줄이 없으면 드리즐킷은 `['public']` 만 본다 — 기본값이다.
  // 관리 도구 11표가 `gq_admin` 으로 옮겨갔으므로(결정 5), 빼 두면 그 11표가
  // `generate` · `push` 에서 **통째로 빠지고 아무 소리도 안 난다.**
  // `tablesFilter` 가 「너무 많이 보는 것」을 막는다면 이건 「너무 적게 보는 것」을 막는다.
  schemaFilter: 우리_스키마들(),
  // casing 옵션은 두지 않는다. schema.ts 가 컬럼마다 이름을 명시하므로
  // 변환 규칙이 낄 자리가 없다 — 컬럼명 = 코드 이름 (CLAUDE.md).
})
