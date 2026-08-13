// 프롬프트 작업대 검사 — 파이썬 `tests/test_admin_prompts.py` 의 **화면 쪽 길**을 옮긴 것 (화면-6).
//
// 🔴 **이 파일의 첫째 임무는 경계 6 을 물게 만드는 것이다** (`CLAUDE.md`):
//
// > 「프롬프트 정본은 `prompts/*.md` 다. 페이지에서 고친 것은 실험용이며,
// >  확정본은 사람이 파일에 옮긴다.」
//
// 두 가지로 지킨다. 하나만으로는 새는 자리가 있다.
//
// | | 어떻게 | 무엇을 잡나 |
// |---|---|---|
// | ① 돌려 보고 해시 | 저장·조회 길을 다 지난 뒤 `prompts/*.md` 전부의 sha256 + mtime 이 그대로인가 | **실제로** 파일에 손대는 코드 |
// | ② 소스 훑기 | 작업대의 세 자리(화면·service·repo)에 파일 쓰기 API 가 들어왔나 | 아직 안 불리는 길 · 앞으로 들어올 길 |
//
// ①만 두면 「그 검사가 안 지나는 분기에서만 쓰는」 코드를 못 잡고, ②만 두면 `fs` 를 안 거치는
// 다른 길(자식 프로세스 등)을 못 잡는다.
//
// ## 옮기면서 모양이 달라진 것 — 「깨졌다」로 세지 말 것
//
// - 파이썬은 회차를 **끝까지 돌려**(가짜 LLM) 실험 본문이 system 으로 나가는 것까지 봤다.
//   그 배선(`analysis_prompt` 인자에 실험 본문을 싣는 자리)은 타입스크립트 판에 **아직 없다** —
//   `service/step.ts` 가 인자로 받게 뚫려만 있고 채우는 곳이 없다. 여기서는 화면이 저장하는
//   길과 `experimentPrompts()` 가 그 값을 꺼내 주는 데까지 본다 (보고에 적었다).
// - 주소가 `/prompts` → `/prompt-lab` 이다.

import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { sql } from 'drizzle-orm'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { characters, experiment_prompts, stories, story_scenes } from '@/db/schema'

// ⚠️ 팩토리 안에서 바깥 변수를 참조하면 hoisting 에 걸린다 (`tests/admin.test.ts` 와 같은 상자).
const 상자 = vi.hoisted(() => ({ tx: null as unknown }))

vi.mock('@/lib/repo/db', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/repo/db')>()
  return { ...real, getDb: () => 상자.tx ?? real.getDb() }
})

import { saveExperimentPromptAction } from '@/app/(admin)/prompt-lab/actions'
import { WEB_ROOT } from '@/lib/config'
import { promptsDir } from '@/lib/prompts'
import { closeDb, getDb, type Conn } from '@/lib/repo/db'
import { readExperimentPrompts, saveExperimentPrompt } from '@/lib/repo/prompt-lab'
import { createRun, readRun } from '@/lib/repo/runs'
import { createSession } from '@/lib/repo/sessions'
import {
  experimentPrompts,
  listPromptNames,
  promptLabView,
  saveExperimentPromptStep,
} from '@/lib/service/prompt-lab'

// 실험용 본문. 「받는 것」 블록을 일부러 **한 칸만** 두었다 —
// 재료 틀까지 준 정본에서 나온 것인지 이걸로 구분한다.
const 실험_분석_프롬프트 = `# 실험용 분석 프롬프트 (SENTINEL-분석-화면)

## 받는 것

\`\`\`
아이 발화: {child_utterance}
\`\`\`
`

const 실험_캐릭터_프롬프트 = `# 실험용 캐릭터 프롬프트 (SENTINEL-캐릭터-화면)

## 받는 것

\`\`\`
아이 발화: {child_utterance}
\`\`\`
`

// ═══════════════════════════════════════════════════════════════════════════
// ⭐ 경계 6 ① — `prompts/*.md` 가 한 글자도 안 바뀐다
// ═══════════════════════════════════════════════════════════════════════════

/** `prompts/*.md` 전부의 내용 해시 + 고쳐진 시각. 한 글자만 달라도 값이 달라진다. */
function 프롬프트_지문(): Record<string, string> {
  const 자리 = promptsDir()
  const 모은것: Record<string, string> = {}
  for (const 이름 of readdirSync(자리).filter((하나) => hasMd(하나))) {
    const 경로 = path.join(자리, 이름)
    const 해시 = createHash('sha256').update(readFileSync(경로)).digest('hex')
    모은것[이름] = `${해시}:${statSync(경로).mtimeMs}`
  }
  return 모은것
}

function hasMd(이름: string): boolean {
  return 이름.endsWith('.md')
}

// ═══════════════════════════════════════════════════════════════════════════
// ⭐ 경계 6 ② — 작업대 세 자리에 파일 쓰기 API 가 없다
// ═══════════════════════════════════════════════════════════════════════════

/** 이 이름이 하나라도 소스에 있으면 빨간불이다. 파일을 바꾸는 길 전부. */
const 쓰는_API = [
  'writeFile',
  'writeFileSync',
  'appendFile',
  'appendFileSync',
  'createWriteStream',
  'truncate',
  'unlink',
  'rmSync',
  'renameSync',
  'copyFile',
  'openSync',
  'mkdirSync',
  'child_process',
]

const 작업대_소스 = [
  path.join(WEB_ROOT, 'app', '(admin)', 'prompt-lab', 'page.tsx'),
  path.join(WEB_ROOT, 'app', '(admin)', 'prompt-lab', 'actions.ts'),
  path.join(WEB_ROOT, 'lib', 'service', 'prompt-lab.ts'),
  path.join(WEB_ROOT, 'lib', 'repo', 'prompt-lab.ts'),
]

describe('경계 6 — 화면은 prompts/*.md 를 읽기만 한다', () => {
  it('작업대 소스 어디에도 파일을 쓰는 API 가 없다', () => {
    for (const 경로 of 작업대_소스) {
      // ⚠️ 주석에도 이름이 안 나오게 두었다 — 「없다」를 글자로 세는 검사라
      //    설명하려고 이름을 적으면 그 순간 빨개진다.
      const 글 = readFileSync(경로, 'utf-8')
      for (const 이름 of 쓰는_API) {
        expect(글, `${path.basename(경로)} 에 ${이름} 이 들어왔다`).not.toContain(이름)
      }
    }
  })

  it('작업대 소스가 정말 읽히고 있다 (빈 목록으로 통과하지 않는다)', () => {
    expect(작업대_소스.length).toBe(4)
    for (const 경로 of 작업대_소스) {
      expect(readFileSync(경로, 'utf-8').length).toBeGreaterThan(500)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// md 를 캐시하지 않는다 — 고치면 다음 호출부터 반영된다
// ═══════════════════════════════════════════════════════════════════════════

describe('정본 읽기', () => {
  it('프롬프트 이름을 파일 이름에서 뽑아 정렬해 준다', () => {
    const 이름들 = listPromptNames()
    expect(이름들).toContain('analysis')
    expect(이름들).toContain('character')
    expect(이름들).toEqual([...이름들].sort())
    expect(이름들.every((이름) => !이름.endsWith('.md'))).toBe(true)
  })

  it('md 를 캐시하지 않는다 — 고친 다음 호출부터 바로 반영된다', async () => {
    const 임시 = mkdtempSync(path.join(tmpdir(), 'prompt-lab-'))
    try {
      writeFileSync(path.join(임시, 'analysis.md'), '처음 내용')
      const 처음 = await promptLabView({ 디렉터리: 임시 })
      expect(처음.prompts[0].canonical_body).toBe('처음 내용')

      writeFileSync(path.join(임시, 'analysis.md'), '고친 내용')
      const 다음 = await promptLabView({ 디렉터리: 임시 })
      expect(다음.prompts[0].canonical_body).toBe('고친 내용')

      // 파일이 늘어난 것도 다음 호출에서 바로 보인다
      writeFileSync(path.join(임시, 'character.md'), '새 파일')
      expect((await promptLabView({ 디렉터리: 임시 })).prompts.map((하나) => 하나.name)).toEqual([
        'analysis',
        'character',
      ])
    } finally {
      rmSync(임시, { recursive: true, force: true })
    }
  })

  it('회차를 안 고르면 정본만 읽기 전용으로 보여 준다', async () => {
    const 본것 = await promptLabView()
    expect(본것.run).toBeNull()
    expect(본것.run_id).toBeNull()
    expect(본것.experiment_names).toEqual([])
    for (const 하나 of 본것.prompts) {
      expect(하나.experiment_body).toBeNull()
      expect(하나.display_body).toBe(하나.canonical_body)
      expect(하나.is_experiment).toBe(false)
    }
  })

  it('실험할 수 있는 것은 analysis · character 둘뿐이다', async () => {
    const 본것 = await promptLabView()
    expect(본것.prompts.filter((하나) => 하나.editable).map((하나) => 하나.name)).toEqual([
      'analysis',
      'character',
    ])
    // 판정 프롬프트(`judge_*`)와 아이 대역은 실험 대상이 아니다
    expect(본것.prompts.some((하나) => 하나.name.startsWith('judge_'))).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// DB 를 타는 자리
// ═══════════════════════════════════════════════════════════════════════════

async function 붙어보기(): Promise<string | null> {
  try {
    await getDb().execute(sql`select 1`)
    return null
  } catch (오류) {
    if (오류 instanceof Error && 오류.cause instanceof Error) {
      return `${오류.cause.name}: ${오류.cause.message}`
    }
    return 오류 instanceof Error ? `${오류.name}: ${오류.message}` : String(오류)
  }
}

const 못붙는_이유 = await 붙어보기()
if (못붙는_이유 !== null) {
  process.stderr.write(
    `\n[prompt-lab.test] Postgres 에 못 붙어 저장 검사를 건너뛴다 (도커가 꺼져 있나?)\n` +
      `            ${못붙는_이유}\n\n`,
  )
}
const DB검사 = 못붙는_이유 === null ? describe : describe.skip

afterAll(async () => {
  await closeDb()
})

class 되돌림 extends Error {}

async function 트랜잭션(본문: (tx: Conn) => Promise<void>): Promise<void> {
  try {
    await getDb().transaction(async (tx) => {
      상자.tx = tx
      await 본문(tx)
      throw new 되돌림('검사가 끝났으니 되돌린다')
    })
  } catch (오류) {
    if (!(오류 instanceof 되돌림)) throw 오류
  } finally {
    상자.tx = null
  }
}

/** 회차 하나. 실험 프롬프트는 `runs.id` 에 매달리므로 이야기부터 세워야 한다. */
async function 회차_열기(tx: Conn): Promise<string> {
  const 꼬리 = Math.random().toString(36).slice(2, 10)
  const [이야기] = await tx
    .insert(stories)
    .values({
      slug: `s-test-${꼬리}`,
      title: `검사용 이야기 ${꼬리}`,
      summary: '검사용',
      difficulty: '보통',
      status: 'draft',
    })
    .returning({ id: stories.id })

  const [캐릭터] = await tx
    .insert(characters)
    .values({
      story_id: 이야기.id,
      code: 'ch_test',
      name: '며느리',
      persona: '성격',
      speech_style: '말투',
      guidance_style: '방식',
      forbidden: [],
    })
    .returning({ id: characters.id })

  await tx.insert(story_scenes).values({
    story_id: 이야기.id,
    code: 'sc_test_01',
    scene_order: 1,
    scene_description: '지문',
    conflict: '갈등',
    character_id: 캐릭터.id,
    character_name: '며느리',
    character_opening: '첫 대사',
    character_closing: '마지막 대사',
    scene_stance: '입장',
    scene_goal: '목표',
    required_elements: ['EMOTION'],
    preferred_turns: 2,
    max_turns: 4,
  })

  const session_id = await createSession(tx, { story_id: 이야기.id, child_id: randomUUID() })
  const 회차 = await createRun(tx, {
    session_id,
    scope: 'story',
    scene_order: null,
    started_by: 'tester',
    analysis_model: 'fake-model',
    analysis_effort: null,
    character_model: 'fake-model',
    character_effort: null,
    default_utterance_source: 'synthetic_adult',
    prompt_version: 'mvp_v1',
  })
  return 회차.id
}

/** 화면의 단추를 그대로 누른다. 돌아간 자리와 실은 오류를 digest 에서 읽는다. */
async function 눌러본다(값들: Record<string, string>): Promise<{
  경로: string
  run_id: string | null
  error: string | null
}> {
  const 폼 = new FormData()
  for (const [이름, 값] of Object.entries(값들)) 폼.append(이름, 값)

  let 잡힘: unknown = null
  try {
    await saveExperimentPromptAction(폼)
  } catch (오류) {
    잡힘 = 오류
  }
  const digest = (잡힘 as { digest?: string } | null)?.digest
  if (typeof digest !== 'string' || !digest.startsWith('NEXT_REDIRECT')) {
    throw 잡힘 ?? new Error('액션이 아무 데도 안 돌아갔다')
  }
  const 주소 = new URL(digest.split(';')[2], 'http://검사')
  return {
    경로: 주소.pathname,
    run_id: 주소.searchParams.get('run_id'),
    error: 주소.searchParams.get('error'),
  }
}

DB검사('회차에 실험 프롬프트를 저장한다', () => {
  it('화면에서 저장한 본문이 그대로 표에 들어가고 회차 메모가 적힌다', async () => {
    await 트랜잭션(async (tx) => {
      const run_id = await 회차_열기(tx)

      for (const [name, body] of [
        ['analysis', 실험_분석_프롬프트],
        ['character', 실험_캐릭터_프롬프트],
      ]) {
        const 답 = await 눌러본다({ run_id, name, body })
        expect(답.error).toBeNull()
        expect(답.경로).toBe('/prompt-lab')
        expect(답.run_id).toBe(run_id)
      }

      expect(await readExperimentPrompts(tx, run_id)).toEqual({
        analysis: 실험_분석_프롬프트,
        character: 실험_캐릭터_프롬프트,
      })
      // 회차 목록이 「무엇이 달랐는지」를 말할 수 있어야 한다 (FR-059)
      expect((await readRun(tx, run_id)).experiment_note).toBe('실험용 프롬프트: analysis, character')
    })
  })

  it('⭐ 저장하고 다시 그려도 prompts/*.md 가 한 글자도 안 바뀐다', async () => {
    const 돌리기_전 = 프롬프트_지문()
    expect(
      Object.keys(돌리기_전).length,
      'prompts/*.md 를 하나도 못 읽었으면 이 검사는 아무것도 안 지킨다',
    ).toBeGreaterThan(0)

    await 트랜잭션(async (tx) => {
      const run_id = await 회차_열기(tx)
      await 눌러본다({ run_id, name: 'analysis', body: 실험_분석_프롬프트 })
      await 눌러본다({ run_id, name: 'character', body: 실험_캐릭터_프롬프트 })
      // 덮어쓰기(같은 회차·같은 이름)까지 지난다 — 파이썬이 폼을 두 번 보내던 자리다
      await 눌러본다({ run_id, name: 'analysis', body: `${실험_분석_프롬프트}\n한 줄 더` })

      const 본것 = await promptLabView({ run_id, conn: tx })
      const 분석 = 본것.prompts.find((하나) => 하나.name === 'analysis')!
      expect(분석.display_body).toContain('SENTINEL-분석-화면')
      // 정본은 그대로 곁에 남는다 — 사람이 옮길 것을 보여 주는 자리다
      expect(분석.canonical_body).not.toContain('SENTINEL')
    })

    expect(프롬프트_지문()).toEqual(돌리기_전)
  })

  it('실험 본문은 그 회차에만 걸린다', async () => {
    await 트랜잭션(async (tx) => {
      const 실험_run = await 회차_열기(tx)
      const 맨_run = await 회차_열기(tx)
      await 눌러본다({ run_id: 실험_run, name: 'analysis', body: 실험_분석_프롬프트 })

      expect(await readExperimentPrompts(tx, 맨_run)).toEqual({})
      expect(await experimentPrompts(실험_run, tx)).toEqual({
        analysis: 실험_분석_프롬프트,
        character: null,
      })
      expect(await experimentPrompts(맨_run, tx)).toEqual({ analysis: null, character: null })

      const 맨_화면 = await promptLabView({ run_id: 맨_run, conn: tx })
      for (const 하나 of 맨_화면.prompts) expect(하나.display_body).toBe(하나.canonical_body)
    })
  })

  it('한 쪽만 저장하면 나머지는 정본으로 남는다', async () => {
    await 트랜잭션(async (tx) => {
      const run_id = await 회차_열기(tx)
      await 눌러본다({ run_id, name: 'analysis', body: 실험_분석_프롬프트 })

      const 본것 = await promptLabView({ run_id, conn: tx })
      expect(본것.experiment_names).toEqual(['analysis'])
      const 분석 = 본것.prompts.find((하나) => 하나.name === 'analysis')!
      const 캐릭터 = 본것.prompts.find((하나) => 하나.name === 'character')!
      expect(분석.is_experiment).toBe(true)
      expect(캐릭터.is_experiment).toBe(false)
      expect(캐릭터.display_body).toBe(캐릭터.canonical_body)
    })
  })

  it('빈 본문은 400 으로 거절한다', async () => {
    await 트랜잭션(async (tx) => {
      const run_id = await 회차_열기(tx)
      const 답 = await 눌러본다({ run_id, name: 'analysis', body: '   \n  ' })

      expect(답.error).toContain('BAD_REQUEST')
      expect(답.run_id).toBe(run_id)
      expect(await readExperimentPrompts(tx, run_id)).toEqual({})

      await expect(
        saveExperimentPromptStep({ run_id, name: 'analysis', body: '', conn: tx }),
      ).rejects.toThrow('빈 프롬프트는 저장할 수 없다')
    })
  })

  it('실험할 수 없는 이름은 화면에서도 저장 층에서도 막힌다', async () => {
    await 트랜잭션(async (tx) => {
      const run_id = await 회차_열기(tx)
      const 답 = await 눌러본다({ run_id, name: 'child', body: '아이 대역을 바꿔 보자' })

      expect(답.error).toContain('BAD_REQUEST')
      expect(await readExperimentPrompts(tx, run_id)).toEqual({})

      // 화면을 건너뛰고 저장 층을 직접 불러도 같다 (`experiment_prompts_name_check` 앞에서 막는다)
      await expect(
        saveExperimentPrompt(tx, { run_id, name: 'child', body: '본문' }),
      ).rejects.toThrow('실험할 수 없는 프롬프트: child')
    })
  })

  it('덮어쓰면 행이 늘지 않고 본문만 바뀐다', async () => {
    await 트랜잭션(async (tx) => {
      const run_id = await 회차_열기(tx)
      await 눌러본다({ run_id, name: 'analysis', body: '첫 번째' })
      await 눌러본다({ run_id, name: 'analysis', body: '두 번째' })

      const 행들 = await tx
        .select()
        .from(experiment_prompts)
        .where(sql`${experiment_prompts.run_id} = ${run_id}`)
      expect(행들.length).toBe(1)
      expect(행들[0].body).toBe('두 번째')
      expect((await readRun(tx, run_id)).experiment_note).toBe('실험용 프롬프트: analysis')
    })
  })
})
