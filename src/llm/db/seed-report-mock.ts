/**
 * 보호자 리포트 목데이터 — **심고 · 분석하고 · 지우는 실행기** (이슈 #40).
 *
 * 대본은 옆 파일(`seed-report-mock-script.ts`)에 있다. 이 파일은 그 값을 DB 에 넣고, 실제
 * 분석 파이프라인을 돌리고, 지우는 일만 한다.
 *
 * ⛔ **콘텐츠 시드(`seed.ts`)와 섞지 않는다.** 그쪽은 이야기·장면·캐릭터를 넣는 자리이고
 *    여기는 아이·세션·발화를 넣는 자리다. 한 파일이 되면 「콘텐츠를 고치려다 목데이터가
 *    딸려 오는」 일이 생긴다.
 *
 * ── 돌리는 법 ──────────────────────────────────────────────────────────────
 *
 *   tsx src/llm/db/seed-report-mock.ts --seed-only
 *   tsx src/llm/db/seed-report-mock.ts --analyze --key 1 --shard 0/3
 *   tsx src/llm/db/seed-report-mock.ts --metrics
 *   tsx src/llm/db/seed-report-mock.ts --purge
 *
 * | 옵션 | 어디까지 | LLM |
 * |---|---|---|
 * | `--seed-only` | 아이·세션·발화 대본 (+ 회차 행) | 0회 |
 * | `--analyze`   | + 발화분석 · 턴 판정(`decide()`) | 아이 발화당 1회 |
 * | `--metrics`   | 집계기를 돌려 숫자만 찍는다. **저장하지 않는다** | 0회 |
 * | `--report`    | + 리포트 생성 | ⏳ #38 대기 (아래 「리포트」 절) |
 * | `--purge`     | 목데이터만 지운다 | 0회 |
 *
 * 그 밖에: `--key <1|2|3>` · `--shard <i>/<n>` · `--dry-run`(purge 용) · `--out <경로>`(metrics 용).
 *
 * ── 🔴 반복 안전 (여러 번 돌려도 아이가 20명이 되지 않는다) ─────────────────
 *
 * 이 스크립트가 넣는 행은 **id 를 전부 계산해서 만든다** (`목_id()`). 아이 번호·활동 차례·
 * 순번에서 나오는 값이라 같은 대본이면 언제나 같은 id 가 나오고, 그래서 전부 upsert 로
 * 쓴다. `children` 에 UNIQUE 가 `id` 뿐이라(이름은 중복이 허용된다) 이 방법 말고는 「이미
 * 있나」를 물을 열쇠가 없다.
 *
 * ── 🔴 진짜 계정과 섞이지 않는다 ───────────────────────────────────────────
 *
 * `children` 에는 **진짜 아이 계정 14행**이 있다. 두 겹으로 가른다 —
 *   ① 이름 앞에 `[리포트목]` 표식을 붙인다.
 *   ② 지우기는 **우리가 계산한 id 목록 안에서만** 돈다. 이름 표식은 그 위에 한 겹 더 건다.
 * 그래서 표식을 지운 사람이 있어도, id 가 겹치는 진짜 계정이 있어도 서로를 못 지운다.
 *
 * ⛔ `drizzle-kit push` 는 어떤 이유로도 치지 않는다. 선언에 없는 표를 지운다.
 * ⛔ `children` 은 **우리 선언에 넣지 않는다.** 넣는 순간 push 가 보는 표 목록에 들어간다
 *    (`db/push-guard.ts` 머리말). 그래서 이 파일은 그 표만 **날 SQL** 로 다룬다.
 */

import { pathToFileURL } from 'node:url'

import { and, asc, eq, inArray, lt, notInArray, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { loadEnvFile, loadSettings, type Settings } from '@/llm/config'
import { decide } from '@/llm/domain/decide'
import { precedingNarration, ValueError } from '@/llm/domain/progress'
import { 분석_스키마, parseResponse, postProcess, type AnalysisPayload } from '@/llm/engine/analyze'
import { buildAnalysisMaterial } from '@/llm/engine/material'
import { chooseBody } from '@/llm/prompts'
import { buildChain, complete } from '@/llm/provider'
import type { Conn } from '@/llm/repo/db'
import { aggregateMetrics, type 집계재료 } from '@/report/domain/metrics'

import {
  child_words,
  messages,
  mission_messages,
  mission_sessions,
  parent_reports,
  runs,
  stories,
  story_missions,
  story_scenes,
  story_sessions,
  turn_conditions,
  utterance_analyses,
} from './schema'
import {
  아이들,
  아이발화_수,
  이름_표식,
  이야기_슬러그,
  활동_수,
  type 아이대본,
  type 활동대본,
} from './seed-report-mock-script'

loadEnvFile()

// ═══════════════════════════════════════════════════════════════════════════
// 1. 계산해서 만드는 id
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 목데이터 행의 uuid 를 **계산해서** 만든다. 난수를 쓰지 않는다.
 *
 * 모양은 `00000000-0000-4000-8000-4d{갈래}{일련번호 8자리}` 다. `4d` 는 mock 의 자리표이고
 * 십진 숫자만 쓰므로 16진수로도 성립한다. 갈래를 나눠 두면 **지울 때 무엇을 지우는지가
 * id 만 봐도 보인다.**
 *
 * ⚠️ 이 함수의 출력이 바뀌면 이미 심은 목데이터가 **고아가 된다** (지우기가 못 찾는다).
 *    바꿔야 하면 먼저 `--purge` 로 지우고 바꿔라.
 */
function 목_id(갈래: number, 일련: number): string {
  const 앞 = String(갈래).padStart(2, '0')
  const 뒤 = String(일련).padStart(8, '0')
  return `00000000-0000-4000-8000-4d${앞}${뒤}`
}

/** 갈래 번호. 이름을 붙여 세워 둔다 — 숫자만 흩어 두면 지우는 쪽에서 하나를 빠뜨린다. */
const 갈래 = {
  아이: 1,
  세션: 2,
  발화: 3,
  회차: 4,
  미션시도: 5,
  미션발화: 6,
} as const

/** 아이 `번호`(1~10)의 `children.id`. */
function 아이_id(번호: number): string {
  return 목_id(갈래.아이, 번호)
}

/** 아이 `번호`의 `차례` 번째 활동. 한 아이가 활동 99건을 넘지 않는다는 전제다. */
function 세션_일련(아이번호: number, 차례: number): number {
  return 아이번호 * 100 + 차례
}

function 세션_id(아이번호: number, 차례: number): string {
  return 목_id(갈래.세션, 세션_일련(아이번호, 차례))
}

function 회차_id(아이번호: number, 차례: number): string {
  return 목_id(갈래.회차, 세션_일련(아이번호, 차례))
}

function 미션시도_id(아이번호: number, 차례: number): string {
  return 목_id(갈래.미션시도, 세션_일련(아이번호, 차례))
}

/**
 * `messages.id` — 세션 일련번호와 `turn_order` 에서 나온다.
 *
 * 🔴 **id 와 `turn_order` 가 일대일이라야 한다.** `messages` 에는
 *    `unique(session_id, turn_order)` 가 걸려 있어서, id 는 같은데 순번이 다르면
 *    upsert 가 유니크 위반으로 죽는다. 순번에서 id 를 만들면 그 일이 생기지 않는다.
 */
function 발화_id(아이번호: number, 차례: number, turn_order: number): string {
  return 목_id(갈래.발화, 세션_일련(아이번호, 차례) * 1000 + turn_order)
}

function 미션발화_id(아이번호: number, 차례: number, turn_order: number): string {
  return 목_id(갈래.미션발화, 세션_일련(아이번호, 차례) * 1000 + turn_order)
}

/** 심는 아이 10명의 id 전부. 지우기가 이 목록 밖으로 나가지 않는다. */
function 모든_아이_id(): string[] {
  return 아이들.map((아이) => 아이_id(아이.번호))
}

/** 심는 활동 전부의 id. */
function 모든_세션_id(): string[] {
  return 아이들.flatMap((아이) => 아이.활동들.map((활동) => 세션_id(아이.번호, 활동.차례)))
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. 보호자 — 새로 만들지 않고 있는 것을 쓴다
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 목데이터 아이들이 매달릴 `parents.id`.
 *
 * 🔴 **새 보호자를 만들 수 없다.** `parents.id` 는 `auth.users(id)` 를 참조하므로
 *    (2026-08-15 실측) 인증 사용자를 먼저 만들지 않으면 행이 안 들어간다. 인증 영역은
 *    이 레포 범위 밖이다 (`db/schema.ts:14`).
 *
 * 그래서 **이미 서 있는 합성 보호자**를 쓴다. `[실험용] 엔진 검증` 아이가 매달린 그 행이고,
 * 값이 `…e001` 이라 진짜 사용자와 눈으로도 갈린다. 다른 값을 쓰려면
 * `GQ_REPORT_MOCK_PARENT_ID` 로 넘겨라.
 *
 * ⚠️ 이 보호자 행 자체는 **우리가 만들지도 지우지도 않는다.** 지우기는 아이부터 시작한다.
 */
const 기본_보호자_id = '00000000-0000-4000-8000-00000000e001'

function 보호자_id(): string {
  const 값 = (process.env.GQ_REPORT_MOCK_PARENT_ID ?? '').trim()
  return 값 === '' ? 기본_보호자_id : 값
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. 옵션
// ═══════════════════════════════════════════════════════════════════════════

/** 어디까지 돌릴지 (명세 10절 · 킥오프 ⑤ — 비용을 옵션으로 가른다). */
export type 단계 = 'seed-only' | 'analyze' | 'report' | 'metrics' | 'purge'

export interface 옵션 {
  단계: 단계
  /** 그 프로세스가 쓸 제미나이 키 번호. `--analyze`·`--report` 에만 뜻이 있다. */
  키: number
  /** 일감을 겹치지 않게 가르는 몫. `{ i, n }`. 안 주면 전부 돈다. */
  샤드: { i: number; n: number } | null
  /** `--purge` 에서 무엇을 지울지만 찍고 끝낸다. */
  마른_실행: boolean
  /** `--metrics` 결과 JSON 을 적을 자리. 안 주면 화면에만 찍는다. */
  출력경로: string | null
}

/** ⛔ 단계를 안 주면 **아무것도 하지 않는다.** 기본값으로 돈을 쓰지 않는다. */
export function 옵션_읽기(argv: readonly string[]): 옵션 {
  let 단계: 단계 | null = null
  let 키 = 1
  let 샤드: 옵션['샤드'] = null
  let 마른_실행 = false
  let 출력경로: string | null = null

  for (let i = 0; i < argv.length; i += 1) {
    const 것 = argv[i]
    const 다음 = () => {
      const 값 = argv[i + 1]
      if (값 === undefined) throw new ValueError(`${것} 뒤에 값이 있어야 한다`)
      i += 1
      return 값
    }

    switch (것) {
      case '--seed-only':
        단계 = 'seed-only'
        break
      case '--analyze':
        단계 = 'analyze'
        break
      case '--report':
        단계 = 'report'
        break
      case '--metrics':
        단계 = 'metrics'
        break
      case '--purge':
        단계 = 'purge'
        break
      case '--dry-run':
        마른_실행 = true
        break
      case '--key':
        키 = Number(다음())
        break
      case '--out':
        출력경로 = 다음()
        break
      case '--shard': {
        const 값 = 다음()
        const 짝 = /^(\d+)\/(\d+)$/.exec(값.trim())
        if (짝 === null) throw new ValueError(`--shard 는 <i>/<n> 꼴이어야 한다 (받은 것: ${값})`)
        샤드 = { i: Number(짝[1]), n: Number(짝[2]) }
        if (샤드.n < 1) throw new ValueError('--shard 의 n 은 1 이상이어야 한다')
        if (샤드.i < 0 || 샤드.i >= 샤드.n) {
          throw new ValueError(`--shard 의 i 는 0 이상 ${샤드.n} 미만이어야 한다`)
        }
        break
      }
      default:
        throw new ValueError(`모르는 옵션이다: ${것}`)
    }
  }

  if (단계 === null) {
    throw new ValueError(
      '무엇까지 할지를 골라라 — --seed-only · --analyze · --metrics · --report · --purge',
    )
  }
  return { 단계, 키, 샤드, 마른_실행, 출력경로 }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. 🔴 키 하나만 보이게 만든다 (킥오프 ④ · 2026-08-15 본선 정정)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 이 프로세스가 **제미나이 키 하나만** 쓰게 환경을 좁힌다.
 *
 * ## 왜 `preferred_gemini_key` 를 안 쓰나
 *
 * 킥오프는 `--key` 를 `preferred_gemini_key`(`provider/index.ts:311`)로 넘기라고 했는데
 * 그 길은 두 군데서 샌다 —
 *
 * 1. **닿지 않는다.** `analyze()` 의 옵션은 `prompt`·`settings`·`notify` 셋뿐이라
 *    (`engine/analyze.ts:221`) 그 값을 실을 자리가 없다. 골든셋이 `analyze()` 를 안 부르고
 *    `complete()` 를 직접 부르는 이유가 이것이다.
 * 2. **넘겨도 새어 나간다.** `buildChain` 은 고른 키를 맨 앞에 둘 뿐 **나머지 두 키를 뒤에
 *    그대로 붙이고**(`:359`) 앤트로픽 칸까지 붙인다(`:377`). 그래서 한 샤드가 삐끗하면
 *    다른 샤드가 쓰는 키의 분당 예산을 빌려 쓰고, 제미나이가 다 막히면 **값이 다른 모델로
 *    조용히 넘어가 돈을 쓴다.**
 *
 * ## 그래서 환경변수로 좁힌다 — 공유 코드를 한 줄도 안 고친다
 *
 * `loadSettings()` 는 빈 값을 걸러 배열을 **당겨 붙이므로**(`config.ts:156`) 슬롯 1 에 넣은
 * 값이 곧 「키1」이 되고, `buildChain` 은 값이 없는 칸을 **아예 만들지 않는다**(`:358`).
 * 결과가 **한 칸짜리 체인**이다. 키가 막히면 그 샤드는 그냥 멈춘다 — 돈이 새는 대신
 * 실패가 보이는 쪽이고, 사람이 원한 쪽이다.
 *
 * ⚠️ `loadSettings()` 는 부를 때마다 `process.env` 를 새로 읽는다. 그래서 **첫 호출 전에**
 *    이 함수가 돌기만 하면 된다.
 */
export function 키_하나만_보이게(키: number): void {
  if (!Number.isInteger(키) || 키 < 1 || 키 > 3) {
    throw new ValueError(`--key 는 1 · 2 · 3 중 하나여야 한다 (받은 것: ${키})`)
  }
  loadEnvFile()

  const 이름 = 키 === 1 ? 'GQ_GEMINI_API_KEY' : `GQ_GEMINI_API_KEY_${키}`
  const 값 = (process.env[이름] ?? '').trim()
  if (값 === '') {
    throw new ValueError(`${이름} 이 설정돼 있지 않다 — 키 ${키} 로는 못 돈다`)
  }

  process.env.GQ_GEMINI_API_KEY = 값
  process.env.GQ_GEMINI_API_KEY_2 = ''
  process.env.GQ_GEMINI_API_KEY_3 = ''
  // 제미나이가 막혔을 때 다른 회사 모델로 조용히 넘어가지 않게 같이 닫는다.
  process.env.ANTHROPIC_API_KEY = ''
  process.env.OPENAI_API_KEY = ''
}

/**
 * **한 건이라도 부르기 전에** 체인이 한 칸인지 본다 (골든셋 `제미나이_키_확인()` 과 같은 자리).
 *
 * 두 칸 이상이면 위 좁히기가 안 먹은 것이고, 그대로 두면 수백 회를 엉뚱한 키로 태운다.
 * 돌려주는 값은 그 한 칸의 라벨이라 로그에 그대로 찍는다.
 */
export function 체인이_한_칸인가(settings: Settings): string {
  const 칸들 = buildChain(settings).map((칸) => 칸.label)
  if (칸들.length !== 1) {
    throw new ValueError(
      `체인이 ${칸들.length} 칸이다 (${칸들.join(' → ')}). 키 하나만 보이게 좁히지 못했다 — ` +
        '멈춘다. 이대로 돌면 샤드끼리 같은 키의 분당 예산을 나눠 쓰거나 다른 모델로 넘어간다.',
    )
  }
  return 칸들[0]
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. 일감 — 활동(세션) 하나가 최소 단위다
// ═══════════════════════════════════════════════════════════════════════════

/** 샤드가 가르는 최소 단위. **활동 하나**다 (킥오프 ④ — 발화 단위로 가르지 않는다). */
export interface 일감 {
  아이: 아이대본
  활동: 활동대본
  session_id: string
  /** 정렬 열쇠. `아이번호 * 100 + 차례` 라 순서가 언제나 같다. */
  순번: number
}

/** 대본 전체를 **정해진 순서로** 편다. 난수도 시각도 안 쓴다. */
export function 일감들(): 일감[] {
  const 목록: 일감[] = []
  for (const 아이 of 아이들) {
    for (const 활동 of 아이.활동들) {
      목록.push({
        아이,
        활동,
        session_id: 세션_id(아이.번호, 활동.차례),
        순번: 세션_일련(아이.번호, 활동.차례),
      })
    }
  }
  return 목록.sort((가, 나) => 가.순번 - 나.순번)
}

/**
 * 이 프로세스가 맡을 몫만 남긴다.
 *
 * 🔴 **정렬한 뒤 `index % n === i`** 다. 난수로 가르면 다시 돌릴 때 다른 것이 걸려서
 *    「무엇이 빠졌나」를 볼 수 없다 (킥오프 ④).
 */
export function 샤드_고르기(전부: readonly 일감[], 샤드: 옵션['샤드']): 일감[] {
  if (샤드 === null) return [...전부]
  return 전부.filter((_, 자리) => 자리 % 샤드.n === 샤드.i)
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. 콘텐츠를 읽어 온다 — 대본이 코드로만 가리키는 것들
// ═══════════════════════════════════════════════════════════════════════════

/** 콘텐츠 표에서 이 파일이 보는 장면 칸. **검사가 가짜를 만들어 넣으려고** 밖으로 낸다. */
export interface 장면행 {
  scene_id: string
  code: string
  scene_order: number
  character_id: string | null
  scene_description: string | null
  conflict: string | null
  scene_goal: string | null
  required_elements: readonly string[] | null
  element_criteria: Record<string, string> | null
  character_opening: string | null
  character_closing: string | null
  preferred_turns: number | null
  max_turns: number | null
  vocabulary: { word: string; meaning: string }[] | null
}

/** 대본이 코드로만 가리키던 것들을 실제 행으로 바꾼 묶음. 위와 같은 이유로 밖으로 낸다. */
export interface 콘텐츠 {
  story_id: string
  slug: string
  title: string
  장면들: 장면행[]
  장면_code로: Map<string, 장면행>
  미션_code로: Map<string, { id: string; scene_id: string; title: string }>
}

async function 콘텐츠를_읽는다(db: Conn): Promise<콘텐츠> {
  const [이야기] = await db
    .select({ id: stories.id, slug: stories.slug, title: stories.title })
    .from(stories)
    .where(eq(stories.slug, 이야기_슬러그))
    .limit(1)

  if (이야기 === undefined) {
    throw new ValueError(
      `이야기 '${이야기_슬러그}' 가 DB 에 없다. 콘텐츠 시드를 먼저 돌려라: pnpm db:seed`,
    )
  }

  const 장면들 = (await db
    .select({
      scene_id: story_scenes.id,
      code: story_scenes.code,
      scene_order: story_scenes.scene_order,
      character_id: story_scenes.character_id,
      scene_description: story_scenes.scene_description,
      conflict: story_scenes.conflict,
      scene_goal: story_scenes.scene_goal,
      required_elements: story_scenes.required_elements,
      element_criteria: story_scenes.element_criteria,
      character_opening: story_scenes.character_opening,
      character_closing: story_scenes.character_closing,
      preferred_turns: story_scenes.preferred_turns,
      max_turns: story_scenes.max_turns,
      vocabulary: story_scenes.vocabulary,
    })
    .from(story_scenes)
    .where(eq(story_scenes.story_id, 이야기.id))
    .orderBy(asc(story_scenes.scene_order))) as unknown as 장면행[]

  const 미션들 = await db
    .select({ id: story_missions.id, code: story_missions.code, scene_id: story_missions.scene_id, title: story_missions.title })
    .from(story_missions)
    .where(eq(story_missions.story_id, 이야기.id))

  return {
    story_id: 이야기.id,
    slug: 이야기.slug,
    title: 이야기.title,
    장면들,
    장면_code로: new Map(장면들.map((장) => [장.code, 장])),
    미션_code로: new Map(
      미션들.map((미) => [미.code, { id:미.id, scene_id: 미.scene_id, title: 미.title }]),
    ),
  }
}

/** 대본이 가리키는 장면. 없으면 **조용히 넘어가지 않고 터진다** — 대본이 콘텐츠와 갈린 것이다. */
function 장면을_찾는다(콘: 콘텐츠, code: string): 장면행 {
  const 장면 = 콘.장면_code로.get(code)
  if (장면 === undefined) {
    throw new ValueError(`대본이 가리키는 장면이 DB 에 없다: ${code}`)
  }
  return 장면
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. 심기 — 아이 · 세션 · 발화 대본까지 (LLM 0회)
// ═══════════════════════════════════════════════════════════════════════════

/** 한 활동을 펼친 **한 줄씩의 발화**. 심는 쪽과 분석하는 쪽이 같은 순서를 봐야 한다. */
interface 펼친발화 {
  message_id: string
  turn_order: number
  scene_code: string
  scene_id: string
  speaker_type: 'child' | 'character'
  text: string
}

/**
 * 활동 하나의 발화를 **정해진 순서로** 편다.
 *
 * 장면마다 「고정 첫 대사 → (아이 → 캐릭터 생성 대사) 되풀이 → 고정 마지막 대사」다.
 * `turn_order` 는 **세션 전체를 통틀어** 세고 캐릭터 대사도 한 칸씩 먹는다
 * (`repo/sessions.ts:356` 의 `insertMessage` 와 같은 셈법).
 */
export function 발화를_편다(콘: 콘텐츠, 일: 일감): 펼친발화[] {
  const 펼친: 펼친발화[] = []
  let turn = 0

  const 넣기 = (장면: 장면행, speaker_type: 'child' | 'character', text: string) => {
    turn += 1
    펼친.push({
      message_id: 발화_id(일.아이.번호, 일.활동.차례, turn),
      turn_order: turn,
      scene_code: 장면.code,
      scene_id: 장면.scene_id,
      speaker_type,
      text,
    })
  }

  for (const 장면대본 of 일.활동.장면들) {
    const 장면 = 장면을_찾는다(콘, 장면대본.scene_code)
    if (장면.character_opening) 넣기(장면, 'character', 장면.character_opening)

    for (const 턴 of 장면대본.턴들) {
      넣기(장면, 'child', 턴.아이)
      if (턴.캐릭터) 넣기(장면, 'character', 턴.캐릭터)
    }

    // 중단한 활동에는 마지막 고정 대사가 붙지 않는다. 거기서 그냥 끊긴 것이다.
    if (!장면대본.닫지_않음 && 장면.character_closing) {
      넣기(장면, 'character', 장면.character_closing)
    }
  }
  return 펼친
}

/** 미션 발화를 편다. 표가 달라 `turn_order` 도 **미션 안 순번**이다. */
export function 미션발화를_편다(일: 일감): {
  message_id: string
  turn_order: number
  speaker_type: 'child' | 'character'
  step: string | null
  text: string
  line_source: 'fixed' | null
}[] {
  const 미션 = 일.활동.미션
  if (미션 === undefined) return []

  const 펼친: ReturnType<typeof 미션발화를_편다> = []
  let turn = 0
  const 넣기 = (
    speaker_type: 'child' | 'character',
    step: string | null,
    text: string,
    line_source: 'fixed' | null,
  ) => {
    turn += 1
    펼친.push({
      message_id: 미션발화_id(일.아이.번호, 일.활동.차례, turn),
      turn_order: turn,
      speaker_type,
      step,
      text,
      line_source,
    })
  }

  for (const 단계 of 미션.단계들) {
    넣기('character', 단계.step, 단계.물음, 'fixed')
    넣기('child', 단계.step, 단계.아이, null)
  }
  넣기('character', null, 미션.마무리, 'fixed')
  return 펼친
}

/** 시각 한 칸을 `Date` 로. 대본은 `+09:00` 이 붙은 ISO 글자다. */
function 때(값: string): Date {
  const 것 = new Date(값)
  if (Number.isNaN(것.getTime())) throw new ValueError(`시각을 읽을 수 없다: ${값}`)
  return 것
}

function 더한_때(값: string, 분: number): Date {
  return new Date(때(값).getTime() + 분 * 60_000)
}

async function 아이들을_넣는다(db: Conn): Promise<number> {
  const parent_id = 보호자_id()

  const [있나] = (await db.execute(
    sql`select count(*)::int as n from parents where id = ${parent_id}`,
  )) as unknown as { n: number }[]

  if (!있나 || 있나.n === 0) {
    throw new ValueError(
      `보호자 행이 없다: ${parent_id}\n` +
        '  `parents.id` 는 `auth.users(id)` 를 참조해서 여기서 만들 수 없다.\n' +
        '  이미 있는 합성 보호자 id 를 `GQ_REPORT_MOCK_PARENT_ID` 로 넘겨라.',
    )
  }

  let 넣은수 = 0
  for (const 아이 of 아이들) {
    // ⚠️ `children` 은 우리 선언에 없는 저쪽 표라 날 SQL 로 쓴다 (머리말 참고).
    await db.execute(sql`
      insert into children (id, parent_id, name, birth_year, character_id)
      values (
        ${아이_id(아이.번호)}, ${parent_id},
        ${`${이름_표식} ${아이.이름}`}, ${아이.출생연도}, ${아이.캐릭터}
      )
      on conflict (id) do update
        set name = excluded.name,
            birth_year = excluded.birth_year,
            character_id = excluded.character_id
    `)
    넣은수 += 1
  }
  return 넣은수
}

/**
 * 활동 하나를 통째로 심는다 — 세션 · 회차 · 발화 · 미션.
 *
 * ⛔ 분석은 넣지 않는다. 그건 `--analyze` 가 **실제 파이프라인으로** 만든다 (결정 R13).
 */
async function 활동을_심는다(db: Conn, 콘: 콘텐츠, 일: 일감): Promise<number> {
  const { 아이, 활동 } = 일
  const 마지막_장면 = 장면을_찾는다(콘, 활동.장면들[활동.장면들.length - 1].scene_code)
  const 끝난_때 = 더한_때(활동.시작, 활동.걸린_분)

  const 세션값 = {
    id: 일.session_id,
    child_id: 아이_id(아이.번호),
    story_id: 콘.story_id,
    current_scene_id: 마지막_장면.scene_id,
    status: 활동.status,
    started_at: 때(활동.시작),
    // 중단한 활동은 끝난 시각이 없다. 그때 길이는 `last_activity_at` 으로 잰다
    // (`src/report/domain/metrics.ts:529`).
    completed_at: 활동.status === 'completed' ? 끝난_때 : null,
    last_activity_at: 끝난_때,
  }
  await db
    .insert(story_sessions)
    .values(세션값)
    .onConflictDoUpdate({ target: story_sessions.id, set: 세션값 })

  // 회차 행 — `turn_conditions.run_id` 가 NOT NULL 이라 판정을 박제하려면 있어야 한다.
  const 회차값 = {
    id: 회차_id(아이.번호, 활동.차례),
    session_id: 일.session_id,
    scope: 'story',
    scene_order: null,
    started_by: 'seed-report-mock',
    default_utterance_source: 발화_출처,
    prompt_version: 프롬프트_버전,
    experiment_note: `#40 리포트 목데이터 — 아이${아이.번호} ${아이.이름} ${활동.차례}회차`,
    started_at: 때(활동.시작),
    ended_at: 활동.status === 'completed' ? 끝난_때 : null,
  }
  await db
    .insert(runs)
    .values(회차값)
    .onConflictDoUpdate({ target: runs.session_id, set: 회차값 })

  const 펼친 = 발화를_편다(콘, 일)

  // 🔴 **대본이 바뀐 발화의 묵은 분석을 버린다.**
  //
  // `message_id` 는 `turn_order` 에서 나오므로(위 `발화_id()`) 대사만 고친 발화는 **id 가
  // 그대로다.** 그래서 그냥 두면 `--analyze` 가 「이미 분석돼 있다」고 건너뛰고, 새 대사에
  // 옛 분석이 붙은 채로 리포트가 나간다. 조용히 틀린 숫자가 되는 자리라 여기서 끊는다.
  // (`turn_conditions` 는 `message_id` FK 가 cascade 라 분석과 함께 딸려 나가지 않으므로
  //  같이 지운다 — 그 판정도 옛 분석에서 나온 값이다.)
  await 바뀐_발화의_분석을_버린다(db, 일.session_id, 펼친)

  for (const 줄 of 펼친) {
    const 값 = {
      id: 줄.message_id,
      session_id: 일.session_id,
      scene_id: 줄.scene_id,
      speaker_type: 줄.speaker_type,
      turn_order: 줄.turn_order,
      text: 줄.text,
      // 🔴 합성 발화라고 값에 적는다 (헌법 원칙 IV — 값에는 출처가 붙는다).
      utterance_source: 줄.speaker_type === 'child' ? 발화_출처 : null,
      stt_raw_text: null,
    }
    await db.insert(messages).values(값).onConflictDoUpdate({ target: messages.id, set: 값 })
  }

  // 대본이 짧아졌을 때 지난 판의 꼬리가 남지 않게 한다. **이 세션 안에서만** 지운다.
  const 살릴_id = 펼친.map((줄) => 줄.message_id)
  await db
    .delete(messages)
    .where(and(eq(messages.session_id, 일.session_id), notInArray(messages.id, 살릴_id)))

  await 미션을_심는다(db, 콘, 일)
  return 펼친.length
}

/**
 * 대사가 바뀐 아이 발화의 분석·판정을 지운다. **DB 에 있던 글자와 대본의 글자를 견준다.**
 *
 * 지운 자리는 다음 `--analyze` 가 다시 채운다. 안 지우면 새 대사에 옛 분석이 붙는다.
 */
async function 바뀐_발화의_분석을_버린다(
  db: Conn,
  session_id: string,
  펼친: readonly 펼친발화[],
): Promise<void> {
  const 대본_글자 = new Map(
    펼친.filter((줄) => 줄.speaker_type === 'child').map((줄) => [줄.message_id, 줄.text]),
  )
  if (대본_글자.size === 0) return

  const 있던 = await db
    .select({ id: messages.id, text: messages.text })
    .from(messages)
    .where(eq(messages.session_id, session_id))

  const 버릴 = 있던
    .filter((행) => 대본_글자.has(행.id) && 대본_글자.get(행.id) !== 행.text)
    .map((행) => 행.id)

  if (버릴.length === 0) return
  찍기(`[심기] 대사가 바뀐 발화 ${버릴.length}건의 묵은 분석을 버린다 — 다시 분석해야 한다`)
  await db.delete(turn_conditions).where(inArray(turn_conditions.message_id, 버릴))
  await db.delete(utterance_analyses).where(inArray(utterance_analyses.message_id, 버릴))
}

async function 미션을_심는다(db: Conn, 콘: 콘텐츠, 일: 일감): Promise<void> {
  const 미션 = 일.활동.미션
  if (미션 === undefined) return

  const 콘미션 = 콘.미션_code로.get(미션.mission_code)
  if (콘미션 === undefined) {
    throw new ValueError(`대본이 가리키는 미션이 DB 에 없다: ${미션.mission_code}`)
  }

  const 시도_id = 미션시도_id(일.아이.번호, 일.활동.차례)
  const 시작 = 더한_때(일.활동.시작, Math.max(1, Math.floor(일.활동.걸린_분 / 2)))
  const 시도값 = {
    id: 시도_id,
    session_id: 일.session_id,
    mission_id: 콘미션.id,
    status: 'completed',
    current_step: 미션.단계들[미션.단계들.length - 1]?.step ?? null,
    // 말이 아닌 입력(소품 탭)의 기록. 실제 미션 엔진이 남기는 모양 그대로다.
    selections: [
      { step: 'prop', kind: 'tap', value: 미션.소품, at: 시작.toISOString() },
    ],
    summary_text: null,
    started_at: 시작,
    completed_at: 더한_때(일.활동.시작, Math.max(2, Math.floor(일.활동.걸린_분 / 2) + 3)),
  }
  await db
    .insert(mission_sessions)
    .values(시도값)
    .onConflictDoUpdate({ target: mission_sessions.id, set: 시도값 })

  for (const 줄 of 미션발화를_편다(일)) {
    const 값 = {
      id: 줄.message_id,
      mission_session_id: 시도_id,
      turn_order: 줄.turn_order,
      speaker_type: 줄.speaker_type,
      step: 줄.step,
      text: 줄.text,
      stt_raw_text: null,
      line_source: 줄.line_source,
    }
    // ⚠️ `analysis` 는 **set 에 넣지 않는다.** 다시 심어도 이미 돌린 분석이 날아가지 않게.
    await db
      .insert(mission_messages)
      .values(값)
      .onConflictDoUpdate({ target: mission_messages.id, set: 값 })
  }
}

/** 회차와 아이 발화에 붙는 출처. 합성이라는 표시다 (`service/run.ts:72` 와 같은 값). */
const 발화_출처 = 'synthetic_adult'
/** `turn_conditions` 에 박제되는 프롬프트 판 (`service/run.ts:74`). */
const 프롬프트_버전 = 'mvp_v1'

export async function 심기(db: Conn, 고른것: readonly 일감[]): Promise<void> {
  const 콘 = await 콘텐츠를_읽는다(db)
  const 아이수 = await 아이들을_넣는다(db)
  찍기(`[심기] 아이 ${아이수}명 (${이름_표식}) — 보호자 ${보호자_id()}`)

  let 발화합 = 0
  for (const 일 of 고른것) {
    const 수 = await 활동을_심는다(db, 콘, 일)
    발화합 += 수
    찍기(
      `[심기] 아이${일.아이.번호} ${일.아이.이름} ${일.활동.차례}회차 (${일.활동.status}) — 발화 ${수}줄`,
    )
  }
  찍기(`[심기] 끝. 활동 ${고른것.length}건 · 발화 ${발화합}줄`)
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. 분석 — 실제 파이프라인을 돌린다 (아이 발화 한 건당 LLM 1회)
// ═══════════════════════════════════════════════════════════════════════════

/** 연속으로 이만큼 실패하면 멈춘다 (골든셋과 같은 값 · 킥오프 ④). */
export const 연속실패_한계 = 3

/**
 * 아이 발화 한 건을 분석한다. **`analyze()` 가 아니라 `complete()` 를 직접 부른다** —
 * 골든셋(`service/goldenset.ts:277`)과 같은 자리다.
 *
 * 재료를 만드는 것도 `previous_character_message` 를 넣는 것도 실제 턴 서비스와 같다
 * (`service/turn.ts:222`). 다른 것은 발화가 그때 만들어지지 않고 대본에서 온다는 것뿐이다.
 */
async function 발화를_분석한다(
  콘: 콘텐츠,
  장면: 장면행,
  child_utterance: string,
  previous_character_message: string | null,
  settings: Settings,
): Promise<AnalysisPayload> {
  const 재료 = buildAnalysisMaterial({
    scene: {
      scene_description: 장면.scene_description,
      conflict: 장면.conflict,
      required_elements: 장면.required_elements,
      element_criteria: 장면.element_criteria,
      scene_goal: 장면.scene_goal,
    },
    precedingNarrations: precedingNarration(
      콘.장면들.map((장) => ({
        scene_id: 장.scene_id,
        scene_order: 장.scene_order,
        character_id: 장.character_id,
      })),
      { scene_id: 장면.scene_id, scene_order: 장면.scene_order, character_id: 장면.character_id },
    ).map((앞) => ({
      scene_description: 콘.장면들.find((장) => 장.scene_id === 앞.scene_id)?.scene_description ?? null,
    })),
    child_utterance,
    previous_character_message,
  })

  const 결과 = await complete(chooseBody('analysis', null), 재료, {
    json_schema: 분석_스키마,
    settings,
    purpose: 'analysis',
  })
  return parseResponse(결과.text)
}

/** 한 활동을 분석한 결과 요약. */
interface 분석결과 {
  부른수: number
  건너뛴수: number
}

async function 활동을_분석한다(
  db: Conn,
  콘: 콘텐츠,
  일: 일감,
  settings: Settings,
  실패: { 연속: number },
): Promise<분석결과> {
  const 펼친 = 발화를_편다(콘, 일)
  const 이미 = new Set(
    (
      await db
        .select({ message_id: utterance_analyses.message_id })
        .from(utterance_analyses)
        .where(
          inArray(
            utterance_analyses.message_id,
            펼친.filter((줄) => 줄.speaker_type === 'child').map((줄) => 줄.message_id),
          ),
        )
    ).map((행) => 행.message_id),
  )

  let 부른수 = 0
  let 건너뛴수 = 0

  // 판정(`decide()`)에 쓸 장면별 상태. 장면이 바뀌면 초기화된다 (`repo/sessions.ts:327`).
  let 현재_장면코드: string | null = null
  let 상태 = 새_장면_상태()
  let 직전_캐릭터_대사: string | null = null
  const 판정들: { message_id: string; 판정: ReturnType<typeof decide>; 턴수: number; 앞모드: string | null }[] = []

  for (const 줄 of 펼친) {
    if (줄.scene_code !== 현재_장면코드) {
      현재_장면코드 = 줄.scene_code
      상태 = 새_장면_상태()
      직전_캐릭터_대사 = null
    }

    if (줄.speaker_type === 'character') {
      직전_캐릭터_대사 = 줄.text
      continue
    }

    const 장면 = 장면을_찾는다(콘, 줄.scene_code)

    let 분석: AnalysisPayload
    if (이미.has(줄.message_id)) {
      // 이미 분석된 발화는 **다시 부르지 않는다.** 저장된 것을 읽어 판정만 다시 잇는다.
      const [행] = await db
        .select({
          child_intent: utterance_analyses.child_intent,
          main_point: utterance_analyses.main_point,
          detected_elements: utterance_analyses.detected_elements,
          utterance_validity: utterance_analyses.utterance_validity,
        })
        .from(utterance_analyses)
        .where(eq(utterance_analyses.message_id, 줄.message_id))
        .limit(1)
      분석 = 행 as AnalysisPayload
      건너뛴수 += 1
    } else {
      try {
        분석 = await 발화를_분석한다(콘, 장면, 줄.text, 직전_캐릭터_대사, settings)
        실패.연속 = 0
      } catch (오류) {
        실패.연속 += 1
        const 사유 = 오류 instanceof Error ? `${오류.name}: ${오류.message}` : String(오류)
        찍기(`[분석] ✗ ${줄.message_id} — ${사유} (연속 ${실패.연속}/${연속실패_한계})`)
        if (실패.연속 >= 연속실패_한계) {
          throw new Error(
            `연속 ${연속실패_한계}건 실패해서 멈춘다. 키가 통째로 막혔을 수 있다 — ` +
              '남은 건을 계속 던지면 시간만 태운다.',
          )
        }
        // 이 발화는 건너뛰고 다음으로. 다시 돌리면 이 자리부터 이어진다.
        continue
      }

      const 값 = {
        message_id: 줄.message_id,
        child_intent: 분석.child_intent,
        main_point: 분석.main_point,
        // 🔴 **후처리 전 원본**을 저장한다 (결정 26 · `repo/sessions.ts:412`).
        detected_elements: [...분석.detected_elements],
        utterance_validity: 분석.utterance_validity,
        analysis_version: 분석_규격,
      }
      await db
        .insert(utterance_analyses)
        .values(값)
        .onConflictDoUpdate({ target: utterance_analyses.message_id, set: 값 })
      부른수 += 1
    }

    // 판정 — 후처리로 요소를 거른 뒤 순수 함수 한 번 (`service/turn.ts:255`·`:374`).
    const { kept } = postProcess(분석.detected_elements, 줄.text)
    const 앞모드 = 상태.last_response_mode
    const 턴수 = 상태.current_child_turn_count + 1
    const 판정 = decide(
      { ...상태, current_child_turn_count: 턴수 },
      {
        required_elements: 장면.required_elements ?? [],
        preferred_turns: 장면.preferred_turns ?? 0,
        max_turns: 장면.max_turns ?? 0,
      },
      {
        child_intent: 분석.child_intent,
        detected_elements: kept,
        utterance_validity: 분석.utterance_validity,
      },
    )
    판정들.push({ message_id: 줄.message_id, 판정, 턴수, 앞모드 })

    상태 = {
      current_child_turn_count: 턴수,
      accumulated_elements: 판정.accumulated_elements,
      last_response_mode: 판정.response_mode,
      last_guidance_target: 판정.last_guidance_target,
      turns_without_new_element: 판정.turns_without_new_element,
      consecutive_low_information_turns: 판정.consecutive_low_information_turns,
    }
  }

  await 판정을_박제한다(db, 일, 판정들)
  await 미션을_분석한다(db, 콘, 일, settings, 실패, (더) => {
    부른수 += 더.부른수
    건너뛴수 += 더.건너뛴수
  })

  return { 부른수, 건너뛴수 }
}

/** `decide()` 에 넣을 장면 시작 상태. `enterScene()` 이 지우는 아홉 칸과 같다. */
function 새_장면_상태() {
  return {
    current_child_turn_count: 0,
    accumulated_elements: [] as readonly string[],
    last_response_mode: null as string | null,
    last_guidance_target: null as string | null,
    turns_without_new_element: 0,
    consecutive_low_information_turns: 0,
  }
}

/** `mvp_v1` — 저장 계층이 값을 직접 적어 보내는 것과 같은 이유다 (`repo/sessions.ts:405`). */
const 분석_규격 = 'mvp_v1'

/**
 * 턴별 판정을 `gq_admin.turn_conditions` 에 박제한다.
 *
 * 🔴 **리포트의 `reprompt_recovered` 가 이 표를 읽는다** (`report/domain/metrics.ts:358` —
 *    「GUIDED 턴 다음 아이 발화가 VALID 인 횟수」). 여기 안 남기면 상호작용 축의 절반이
 *    영영 0 이 된다.
 */
async function 판정을_박제한다(
  db: Conn,
  일: 일감,
  판정들: readonly {
    message_id: string
    판정: ReturnType<typeof decide>
    턴수: number
    앞모드: string | null
  }[],
): Promise<void> {
  if (판정들.length === 0) return
  const run_id = 회차_id(일.아이.번호, 일.활동.차례)

  for (const 것 of 판정들) {
    const 값 = {
      message_id: 것.message_id,
      run_id,
      // 시드 개정 번호. 목데이터는 개정을 만들지 않으므로 0 이다 (그 값이 유효하다 —
      // `db/schema.ts:820` 이 FK 를 안 거는 이유가 그것이다).
      seed_revision: 0,
      prompt_version: 프롬프트_버전,
      current_child_turn_count: 것.턴수,
      accumulated_elements: [...것.판정.accumulated_elements],
      last_response_mode: 것.앞모드,
      turns_without_new_element: 것.판정.turns_without_new_element,
      consecutive_low_information_turns: 것.판정.consecutive_low_information_turns,
      response_mode: 것.판정.response_mode,
      guidance_target: 것.판정.guidance_target,
      soft_cue: 것.판정.soft_cue,
      reaction_key: 것.판정.reaction_key,
      scene_goal_met: 것.판정.scene_goal_met,
      scene_end_reason: 것.판정.scene_end_reason,
    }
    await db
      .insert(turn_conditions)
      .values(값)
      .onConflictDoUpdate({ target: turn_conditions.message_id, set: 값 })
  }
}

/**
 * 미션 발화도 분석한다 (결정 R23 — 「말한 문장 수」에 미션이 들어간다).
 *
 * ⚠️ 미션 분석은 `utterance_analyses` 로 가지 않고 **행 안의 jsonb 사본**으로 남는다
 *    (`db/schema.ts:553`). 표가 달라서 저장 자리도 다르다.
 * ⚠️ 미션 턴은 유도하지 않으므로(`domain/mission.ts`) `turn_conditions` 를 만들지 않는다.
 */
async function 미션을_분석한다(
  db: Conn,
  콘: 콘텐츠,
  일: 일감,
  settings: Settings,
  실패: { 연속: number },
  더하기: (것: 분석결과) => void,
): Promise<void> {
  const 미션 = 일.활동.미션
  if (미션 === undefined) return

  const 장면 = 장면을_찾는다(콘, 미션.scene_code)
  const 펼친 = 미션발화를_편다(일)
  let 부른수 = 0
  let 건너뛴수 = 0
  let 직전_캐릭터_대사: string | null = null

  for (const 줄 of 펼친) {
    if (줄.speaker_type === 'character') {
      직전_캐릭터_대사 = 줄.text
      continue
    }

    const [있던] = await db
      .select({ analysis: mission_messages.analysis })
      .from(mission_messages)
      .where(eq(mission_messages.id, 줄.message_id))
      .limit(1)

    if (있던?.analysis) {
      건너뛴수 += 1
      continue
    }

    let 분석: AnalysisPayload
    try {
      분석 = await 발화를_분석한다(콘, 장면, 줄.text, 직전_캐릭터_대사, settings)
      실패.연속 = 0
    } catch (오류) {
      실패.연속 += 1
      const 사유 = 오류 instanceof Error ? `${오류.name}: ${오류.message}` : String(오류)
      찍기(`[분석·미션] ✗ ${줄.message_id} — ${사유} (연속 ${실패.연속}/${연속실패_한계})`)
      if (실패.연속 >= 연속실패_한계) {
        throw new Error(`연속 ${연속실패_한계}건 실패해서 멈춘다.`)
      }
      continue
    }

    await db
      .update(mission_messages)
      .set({
        analysis: {
          child_intent: 분석.child_intent,
          main_point: 분석.main_point,
          detected_elements: [...분석.detected_elements],
          utterance_validity: 분석.utterance_validity,
        },
      })
      .where(eq(mission_messages.id, 줄.message_id))
    부른수 += 1
  }

  더하기({ 부른수, 건너뛴수 })
}

export async function 분석하기(db: Conn, 고른것: readonly 일감[], settings: Settings): Promise<void> {
  const 콘 = await 콘텐츠를_읽는다(db)
  const 실패 = { 연속: 0 }
  const 시작 = Date.now()
  let 부른합 = 0
  let 건너뛴합 = 0

  for (const [자리, 일] of 고른것.entries()) {
    const 활동시작 = Date.now()
    const 결과 = await 활동을_분석한다(db, 콘, 일, settings, 실패)
    부른합 += 결과.부른수
    건너뛴합 += 결과.건너뛴수
    const 초 = ((Date.now() - 활동시작) / 1000).toFixed(1)
    찍기(
      `[분석] (${자리 + 1}/${고른것.length}) 아이${일.아이.번호} ${일.아이.이름} ` +
        `${일.활동.차례}회차 — 부른 ${결과.부른수}회 · 건너뛴 ${결과.건너뛴수}건 · ${초}초`,
    )
  }

  const 총초 = (Date.now() - 시작) / 1000
  찍기(
    `[분석] 끝. 활동 ${고른것.length}건 · LLM ${부른합}회 · 이미 있던 ${건너뛴합}건 · ` +
      `${총초.toFixed(1)}초` +
      (부른합 > 0 ? ` (건당 ${(총초 / 부른합).toFixed(2)}초 · 분당 ${((부른합 / 총초) * 60).toFixed(1)}회)` : ''),
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 9. 지표 — 집계기(#36)를 실제로 돌려 숫자를 본다. 저장하지 않는다
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 활동 하나의 집계 재료를 DB 에서 모은다.
 *
 * ⛔ **저장하지 않는다.** `parent_reports` 에 쓰는 것은 #38 의 자리다. 여기서는 집계기가
 *    실제 행을 먹고 숫자를 내는지만 본다 — 목데이터를 심은 목적의 절반이 이 숫자다.
 */
async function 집계재료를_모은다(db: Conn, 콘: 콘텐츠, 일: 일감): Promise<집계재료 | null> {
  const [세션] = await db
    .select({
      status: story_sessions.status,
      started_at: story_sessions.started_at,
      completed_at: story_sessions.completed_at,
      last_activity_at: story_sessions.last_activity_at,
      child_id: story_sessions.child_id,
    })
    .from(story_sessions)
    .where(eq(story_sessions.id, 일.session_id))
    .limit(1)

  if (세션 === undefined) return null

  const 발화들 = await db
    .select({
      id: messages.id,
      scene_id: messages.scene_id,
      speaker_type: messages.speaker_type,
      turn_order: messages.turn_order,
      text: messages.text,
    })
    .from(messages)
    .where(eq(messages.session_id, 일.session_id))
    .orderBy(asc(messages.turn_order))

  const 아이_발화_id = 발화들.filter((행) => 행.speaker_type === 'child').map((행) => 행.id)

  const 분석들 =
    아이_발화_id.length === 0
      ? []
      : await db
          .select({
            message_id: utterance_analyses.message_id,
            child_intent: utterance_analyses.child_intent,
            detected_elements: utterance_analyses.detected_elements,
            utterance_validity: utterance_analyses.utterance_validity,
          })
          .from(utterance_analyses)
          .where(inArray(utterance_analyses.message_id, 아이_발화_id))

  const 판정들 =
    아이_발화_id.length === 0
      ? []
      : await db
          .select({
            message_id: turn_conditions.message_id,
            response_mode: turn_conditions.response_mode,
            // 상호작용 축의 셋째 항(`soft_cue_answered`)이 이 둘을 본다 (명세 4.2 · #36).
            // 안 뽑으면 `--metrics` 가 그 항을 **조용히 0으로** 보여 준다 — 실서비스 읽기
            // (`src/report/repo/materials.ts`)는 주는데 여기만 안 주면 두 길이 갈린다.
            guidance_target: turn_conditions.guidance_target,
            soft_cue: turn_conditions.soft_cue,
          })
          .from(turn_conditions)
          .where(inArray(turn_conditions.message_id, 아이_발화_id))

  const 미션시도들 = await db
    .select({
      id: mission_sessions.id,
      scene_id: story_missions.scene_id,
      title: story_missions.title,
    })
    .from(mission_sessions)
    .innerJoin(story_missions, eq(mission_sessions.mission_id, story_missions.id))
    .where(eq(mission_sessions.session_id, 일.session_id))

  const 미션발화들 =
    미션시도들.length === 0
      ? []
      : await db
          .select({
            id: mission_messages.id,
            mission_session_id: mission_messages.mission_session_id,
            turn_order: mission_messages.turn_order,
            speaker_type: mission_messages.speaker_type,
            text: mission_messages.text,
            analysis: mission_messages.analysis,
          })
          .from(mission_messages)
          .where(
            inArray(
              mission_messages.mission_session_id,
              미션시도들.map((것) => 것.id),
            ),
          )

  // 이 아이의 **이전 완료 활동 수** (명세 4.3 · 계약 2절 ③). 첫 활동이면 0 이다.
  // ⚠️ 날 SQL 이 아니라 드리즐로 묻는다 — `db.execute(sql\`…\`)` 에 `Date` 를 실으면
  //    드라이버가 그 자리를 못 채우고 질의가 통째로 죽는다 (2026-08-15 실측).
  const 앞선 = await db
    .select({ id: story_sessions.id })
    .from(story_sessions)
    .where(
      and(
        eq(story_sessions.child_id, 세션.child_id),
        eq(story_sessions.status, 'completed'),
        lt(story_sessions.started_at, 세션.started_at),
      ),
    )

  return {
    session: {
      status: 세션.status,
      started_at: 세션.started_at,
      completed_at: 세션.completed_at,
      last_activity_at: 세션.last_activity_at,
    },
    story: { slug: 콘.slug, title: 콘.title },
    scenes: 콘.장면들.map((장) => ({
      id: 장.scene_id,
      code: 장.code,
      scene_order: 장.scene_order,
      vocabulary: 장.vocabulary,
    })),
    messages: 발화들,
    analyses: 분석들,
    turn_conditions: 판정들,
    mission_sessions: 미션시도들,
    mission_messages: 미션발화들,
    prior_activities: 앞선.length,
  }
}

export async function 지표보기(
  db: Conn,
  고른것: readonly 일감[],
  출력경로: string | null,
): Promise<void> {
  const 콘 = await 콘텐츠를_읽는다(db)
  const 모은것: Record<string, unknown>[] = []

  찍기(
    '아이  이름    나이 회차 상태       발화 관점 감정 이유 결과 상호 (질문/회복/턴) 물은낱말 이전활동',
  )
  찍기('─'.repeat(96))

  for (const 일 of 고른것) {
    const 재료 = await 집계재료를_모은다(db, 콘, 일)
    if (재료 === null) {
      찍기(`아이${일.아이.번호} — 세션이 없다. 먼저 --seed-only 를 돌려라`)
      continue
    }
    const 지표 = aggregateMetrics(재료)
    const 축 = 지표.axes
    const 상호 = 축.상호작용

    찍기(
      [
        String(일.아이.번호).padStart(2, ' ') + '  ',
        일.아이.이름.padEnd(6, ' '),
        `${2026 - 일.아이.출생연도}세`.padStart(4, ' '),
        String(일.활동.차례).padStart(3, ' '),
        지표.activity.completed ? ' 완주      ' : ' 중단      ',
        String(지표.counts.child_utterances).padStart(3, ' '),
        String(축.관점과공감.score).padStart(4, ' '),
        String(축.감정표현.score).padStart(4, ' '),
        String(축.생각과이유.score).padStart(4, ' '),
        String(축.결과와해결.score).padStart(4, ' '),
        String(상호.score).padStart(4, ' '),
        `  (${상호.parts.child_questions}/${상호.parts.reprompt_recovered}/${상호.context?.child_turns ?? 0})`.padEnd(
          12,
          ' ',
        ),
        String(지표.counts.asked_words).padStart(7, ' '),
        String(지표.activity.prior_activities).padStart(8, ' '),
      ].join(''),
    )

    모은것.push({
      아이: 일.아이.번호,
      이름: 일.아이.이름,
      나이: 2026 - 일.아이.출생연도,
      회차: 일.활동.차례,
      session_id: 일.session_id,
      메모: 일.아이.메모,
      metrics: 지표,
    })
  }

  if (출력경로 !== null) {
    const { writeFileSync } = await import('node:fs')
    writeFileSync(출력경로, JSON.stringify(모은것, null, 2), 'utf8')
    찍기(`[지표] JSON 을 적었다: ${출력경로}`)
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 10. 리포트 — ⏳ #38 이 합쳐진 뒤에 잇는다
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ⏳ **아직 부를 함수가 없다.**
 *
 * 리포트를 실제로 만드는 `generateReport(session_id)` 와 API 넷은 **#38(P-4)** 이 짜는
 * 중이고 이 브랜치에는 없다(전수 grep 0건 · 2026-08-15). 여기 있는 것은 재료
 * (`src/report/engine/` 의 프롬프트 두 편과 인용 대조 — #37)까지다.
 *
 * ⛔ **`generateReport()` 를 여기서 만들지 않는다.** #38 의 자리이고, 두 벌이 생기면
 *    나중에 어느 쪽이 정본인지 아무도 모른다. 자리만 비워 둔다.
 *
 * #38 이 합쳐지면 이 함수 안이 이렇게 된다 —
 *   1. 샤드가 맡은 활동마다 `generateReport(session_id)` 를 부른다 (활동당 LLM 2회)
 *   2. 그 함수가 `parent_reports` upsert 와 `child_words` 누적까지 한다 (명세 8절 ④⑤)
 * 그때까지 숫자만 보려면 `--metrics` 를 쓴다. 집계기(#36)는 이미 있어서 그건 지금도 된다.
 */
export function 리포트하기(고른것: readonly 일감[]): never {
  throw new ValueError(
    '리포트 생성은 아직 못 돈다 — `generateReport()` 가 이 브랜치에 없다 (#38 P-4 가 짜는 중).\n' +
      `  맡은 활동 ${고른것.length}건은 이미 심겨 있고 분석도 끝나 있을 수 있다.\n` +
      '  숫자만 보려면: tsx src/llm/db/seed-report-mock.ts --metrics\n' +
      '  #38 이 api_team 에 합쳐진 뒤 이 자리에 generateReport(session_id) 를 잇는다.',
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 11. 지우기 — 목데이터만. 진짜 계정 14행은 그대로다
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 목데이터를 지운다. **두 겹으로 가른다** (머리말 참고) —
 * ① 우리가 계산한 id 목록 안에서만 돌고, ② `children` 은 이름 표식까지 맞아야 지운다.
 *
 * FK 가 대부분 `on delete cascade` 라 아이만 지워도 딸려 오지만, **딸려 오는 것에 기대지
 * 않는다.** `child_words` 처럼 FK 가 없는 표가 있고(명세 6.2 — 저쪽 `children` 에 FK 를 걸지
 * 않기로 했다), 기댄 자리는 스키마가 바뀌는 날 조용히 남는다.
 */
export async function 지우기(db: Conn, 마른_실행: boolean): Promise<void> {
  const 아이_id들 = 모든_아이_id()
  const 세션_id들 = 모든_세션_id()
  const 표식패턴 = `${이름_표식}%`

  찍기(`[지우기] 대상 — 아이 ${아이_id들.length}명 · 활동 ${세션_id들.length}건`)

  // ⚠️ 날 SQL 에 배열을 실으면 드리즐이 `($1, $2, …)` 로 편다. `= any(…)` 는 그 모양을
  //    못 받으므로 `in` 을 쓴다 (2026-08-15 실측). 우리 선언에 있는 표는 아예 질의
  //    빌더로 물어 이 함정을 피한다.
  const [아이수] = (await db.execute(
    sql`select count(*)::int as n from children where id in ${아이_id들} and name like ${표식패턴}`,
  )) as unknown as { n: number }[]
  찍기(`  children: ${아이수?.n ?? 0}행`)

  const 셈 = async (무엇: string, 행들: readonly unknown[]) => 찍기(`  ${무엇}: ${행들.length}행`)
  await 셈(
    'story_sessions',
    await db.select({ id: story_sessions.id }).from(story_sessions).where(inArray(story_sessions.id, 세션_id들)),
  )
  await 셈(
    'messages',
    await db.select({ id: messages.id }).from(messages).where(inArray(messages.session_id, 세션_id들)),
  )
  await 셈(
    'child_words',
    await db.select({ id: child_words.id }).from(child_words).where(inArray(child_words.child_id, 아이_id들)),
  )
  await 셈(
    'parent_reports',
    await db.select({ id: parent_reports.id }).from(parent_reports).where(inArray(parent_reports.child_id, 아이_id들)),
  )

  if (마른_실행) {
    찍기('[지우기] --dry-run 이라 여기서 멈춘다. 실제로 지우려면 --dry-run 을 빼라.')
    return
  }

  // 위에서 아래로 — 자식부터 지운다. cascade 가 있어도 순서를 적어 둔다.
  await db.delete(child_words).where(inArray(child_words.child_id, 아이_id들))
  await db.delete(parent_reports).where(inArray(parent_reports.child_id, 아이_id들))
  await db.delete(story_sessions).where(inArray(story_sessions.id, 세션_id들))
  // 🔴 이름 표식이 맞을 때만 지운다. id 가 겹치는 진짜 계정이 있어도 살아남는다.
  await db.execute(
    sql`delete from children where id in ${아이_id들} and name like ${표식패턴}`,
  )

  찍기('[지우기] 끝. 목데이터만 사라졌고 진짜 계정은 그대로다.')
}

// ═══════════════════════════════════════════════════════════════════════════
// 12. 직접 실행
// ═══════════════════════════════════════════════════════════════════════════

function 찍기(글: string): void {
  console.log(글)
}

async function main(): Promise<void> {
  const 옵 = 옵션_읽기(process.argv.slice(2))

  const url = process.env.DATABASE_URL
  if (!url) {
    throw new ValueError('DATABASE_URL 이 없다. 레포 루트 `.env.local` 을 확인해라.')
  }

  const 전부 = 일감들()
  const 고른것 = 샤드_고르기(전부, 옵.샤드)
  const 샤드표시 = 옵.샤드 === null ? '전부' : `${옵.샤드.i}/${옵.샤드.n}`

  찍기(
    `[#40 목데이터] ${옵.단계} · 샤드 ${샤드표시} — 활동 ${고른것.length}/${활동_수()}건 ` +
      `(대본 전체 아이 발화 ${아이발화_수()}건)`,
  )

  // ⭐ **한 건이라도 부르기 전에** 키를 좁히고 체인을 단언한다 (④ · 본선 정정 ⑷).
  let settings: Settings | null = null
  if (옵.단계 === 'analyze' || 옵.단계 === 'report') {
    키_하나만_보이게(옵.키)
    settings = loadSettings()
    찍기(`[키] --key ${옵.키} → 체인 한 칸: ${체인이_한_칸인가(settings)}`)
  }

  if (옵.단계 === 'report') 리포트하기(고른것)

  // max: 1 — 한 연결로 순서대로 돈다. 세 프로세스가 나란히 돌아도 샤드가 갈려 있어
  //          같은 행을 두 프로세스가 건드리지 않는다 (킥오프 ④).
  const sql연결 = postgres(url, { max: 1 })
  const db = drizzle(sql연결) as unknown as Conn
  try {
    switch (옵.단계) {
      case 'purge':
        await 지우기(db, 옵.마른_실행)
        break
      case 'seed-only':
        await 심기(db, 고른것)
        break
      case 'analyze':
        // 분석 전에 항상 심는다 — 대본이 바뀌었는데 옛 발화를 분석하는 일이 없게.
        await 심기(db, 고른것)
        await 분석하기(db, 고른것, settings!)
        break
      case 'metrics':
        await 지표보기(db, 고른것, 옵.출력경로)
        break
      default:
        break
    }
  } finally {
    await sql연결.end()
  }
}

// 직접 돌렸을 때만 main 을 부른다.
// ⚠️ `pathToFileURL` 이어야 한다 — 윈도우에서 argv[1] 은 백슬래시 경로라 글자 잇기로는
//    영원히 안 같다 (`seed.ts:814` 가 같은 함정을 이미 밟았다).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((오류) => {
    console.error(오류 instanceof Error ? `${오류.name}: ${오류.message}` : 오류)
    process.exit(1)
  })
}
