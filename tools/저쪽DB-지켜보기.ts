/**
 * `DATABASE_URL` 이 가리키는 DB 의 표들을 주기적으로 세어 **변한 줄만** 짚어 준다.
 *
 * ── 돌리는 법 ────────────────────────────────────────────────
 *   cd web && npx tsx tools/저쪽DB-지켜보기.ts          # 3초마다
 *   cd web && npx tsx tools/저쪽DB-지켜보기.ts 10       # 10초마다
 *
 *   Ctrl-C 로 끝낸다.
 *
 * ── 무엇을 보나 ──────────────────────────────────────────────
 *   세 갈래를 갈라 둔다. 어느 갈래가 움직였는지가 곧 무슨 일이 났는지다.
 *     우리   — 회차가 돌면 늘어난다 (`gq_admin` + 우리 세션에 딸린 것)
 *     콘텐츠 — 시드를 넣거나 관리 화면에서 고치면 움직인다
 *     저쪽   — ⚠️ **우리가 안 건드리는 것들.** 여기가 움직이면 남이 무언가 한 것이다
 *
 * ⛔ SELECT 만 한다. 아무것도 안 바꾼다.
 */

import { sql } from 'drizzle-orm'

import { loadSettings } from '@/lib/config'
import { closeDb, getDb } from '@/lib/repo/db'

/** [갈래, 보여줄 이름, 세는 SQL] */
const 볼_것: readonly [string, string, string][] = [
  ['우리', 'story_sessions(우리)', `select count(*) from public.story_sessions where child_id = $아이$`],
  ['우리', 'messages', `select count(*) from public.messages`],
  ['우리', 'utterance_analyses', `select count(*) from public.utterance_analyses`],
  ['우리', 'gq_admin.runs', `select count(*) from gq_admin.runs`],
  ['우리', 'gq_admin.llm_calls', `select count(*) from gq_admin.llm_calls`],
  ['우리', 'gq_admin.turn_conditions', `select count(*) from gq_admin.turn_conditions`],
  ['우리', 'gq_admin.scores', `select count(*) from gq_admin.scores`],
  ['우리', 'gq_admin.seed_revisions', `select count(*) from gq_admin.seed_revisions`],
  ['콘텐츠', 'story_scenes', `select count(*) from public.story_scenes`],
  ['콘텐츠', 'story_characters', `select count(*) from public.story_characters`],
  ['저쪽', 'stories', `select count(*) from public.stories`],
  ['저쪽', 'children', `select count(*) from public.children`],
  ['저쪽', 'story_sessions(남의 것)', `select count(*) from public.story_sessions where child_id <> $아이$`],
]

function 시각(): string {
  // 스크립트라 `new Date()` 를 써도 된다 (워크플로우 스크립트가 아니다).
  return new Date().toTimeString().slice(0, 8)
}

async function 한번(conn: ReturnType<typeof getDb>, 아이: string): Promise<Map<string, number>> {
  const 값 = new Map<string, number>()
  for (const [, 이름, 문장] of 볼_것) {
    const 행들 = (await conn.execute(
      sql.raw(문장.replaceAll('$아이$', `'${아이}'`)),
    )) as unknown as { count: string }[]
    값.set(이름, Number(행들[0].count))
  }
  return 값
}

async function main(): Promise<void> {
  const 초 = Number(process.argv[2] ?? 3)
  const s = loadSettings()
  const 아이 = s.child_id ?? '00000000-0000-0000-0000-000000000000'
  const u = new URL(s.database_url!)

  console.log(`\n지켜본다: ${u.username} @ ${u.hostname}:${u.port}/${u.pathname.slice(1)}`)
  console.log(`우리 아이: ${아이}`)
  console.log(`${초}초마다. Ctrl-C 로 끝낸다.\n`)

  const conn = getDb()
  let 지난: Map<string, number> | null = null

  for (;;) {
    const 이번 = await 한번(conn, 아이)

    if (지난 === null) {
      // 첫 판은 기준선이라 전부 찍는다.
      let 갈래 = ''
      for (const [g, 이름] of 볼_것) {
        if (g !== 갈래) {
          console.log(`── ${g} ${'─'.repeat(40 - g.length)}`)
          갈래 = g
        }
        console.log(`   ${이름.padEnd(26)} ${String(이번.get(이름)).padStart(5)}`)
      }
      console.log(`\n[${시각()}] 기준선을 잡았다. 이제 **변한 줄만** 찍는다.\n`)
    } else {
      const 변한 = 볼_것.filter(([, 이름]) => 이번.get(이름) !== 지난!.get(이름))
      for (const [g, 이름] of 변한) {
        const 전 = 지난.get(이름)!
        const 후 = 이번.get(이름)!
        const 표 = g === '저쪽' ? '⚠️ 저쪽' : g === '콘텐츠' ? '콘텐츠' : '우리  '
        console.log(
          `[${시각()}] ${표} ${이름.padEnd(26)} ${전} → ${후}  (${후 - 전 > 0 ? '+' : ''}${후 - 전})`,
        )
      }
    }

    지난 = 이번
    await new Promise((풀기) => setTimeout(풀기, 초 * 1000))
  }
}

main()
  .catch((오류: unknown) => {
    process.exitCode = 1
    console.error(오류)
  })
  .finally(() => closeDb())
