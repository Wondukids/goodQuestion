import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

config({ path: '.env.local' })

export default defineConfig({
  schema: './db/schema.ts',
  out: './db/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
  // casing 옵션은 두지 않는다. schema.ts 가 컬럼마다 이름을 명시하므로
  // 변환 규칙이 낄 자리가 없다 — 컬럼명 = 코드 이름 (CLAUDE.md).
})
