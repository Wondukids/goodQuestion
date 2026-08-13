// 시드 작업대 (이슈 #26 화면-2) — 파이썬 `goodquestion_admin/routes/seed.py`(605줄) 자리다.
//
// 하는 일 넷.
//   1. 작업대에 그릴 것을 모은다 (`seedWorkbench`)
//   2. 사람이 친 글자를 칸 모양대로 읽어 저장한다 (`saveSeedCell`)
//   3. 개정 하나를 직전 값으로 되돌린다 (`undoSeedCell`)
//   4. 지금 작업값을 옮겨 붙일 SQL 로 내보낸다 (`seedExportSql`)
//
// ## ⭐ 시드 파일은 **읽기만** 한다 (2026-08-10 결정 8)
//
// `sql/002_seed_banggui.sql` 은 이 화면이 **절대 쓰지 않는다.** 화면에서 손보고
// `/seed/export` 로 내려받아 **사람이** 002 로 옮긴다 (`CLAUDE.md` 「DB」 절).
// 그 왕복이 콘텐츠 정본 관리의 전부라, 내보내기가 죽으면 정본이 죽는다.
//
// ⚠️ 「정본」은 이야기 원문에서 온 값을 가리키는 말이지 그 SQL 파일이 아니다 (결정 7).
//    그래서 파일 쪽은 **「시드 파일」**이라고만 부른다.
//
// ## ⛔ 여기서 엔진을 부르지 않는다 (`CLAUDE.md` 경계 6)
//
// 이 화면은 도구다. 모드도 장면 종료도 계산하지 않고 LLM 도 안 부른다.
// 고친 값은 **다음 호출부터 바로** 엔진에 반영된다 — 콘텐츠를 DB 에서 읽기 때문이고,
// 그래서 배포·동기화 경로가 없다.

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { PROJECT_ROOT } from '@/lib/config'
import { ValueError } from '@/lib/domain/progress'
import { elementName, elementNames, 요소 } from '@/lib/elements'
import { getDb, type Conn } from '@/lib/repo/db'
import {
  listSeed,
  readSeedRevision,
  seedExportData,
  seedFileDiffers,
  undoSeedRevision,
  updateSeedCell,
  대화_장면_입장_경고,
  고칠_수_있는_칸,
  type SeedCharacterRow,
  type SeedRevisionRow,
  type SeedSceneRow,
  type SeedValue,
} from '@/lib/repo/seed'

import { 고를_수_있는_출처, 출처_이름 } from './origin'

// ═══════════════════════════════════════════════════════════════════════════
// 화면 말 — 파이썬 `goodquestion_admin/출처.py` 에서 이 화면이 쓰는 만큼만
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 출처 이름표 (2026-08-10 결정 2). **정의는 `service/origin.ts` 한 곳이다** —
 * 파이썬 `출처.py` 한 벌을 두 화면이 같이 쓰던 것을 되살린 자리다.
 *
 * 여기서 다시 내보내는 이유는 화면(`app/(admin)/seed/`)이 「시드 화면이 쓰는 말」을
 * 이 모듈에서 찾기 때문이다. 값은 한 벌이고 이름만 두 자리에서 보인다.
 */
export { 고를_수_있는_출처, 출처_이름 }

/**
 * 칸 이름표. 화면의 라벨과 개정 이력·경고가 **같은 표**를 본다.
 *
 * ⚠️ 파이썬은 이 이름을 세 곳(템플릿·`routes/seed.py` 의 이력 사전·`출처.py`)에 따로 적어
 *    `required_elements` 만 「요구 요소」와 「요구 사고 요소」로 갈려 있었다. 여기서는 하나로 둔다.
 */
const 칸_이름표: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  characters: {
    persona: '성격·처지',
    speech_style: '말투',
    guidance_style: '드러내는 방식',
    forbidden: '하지 않는 것',
  },
  story_scenes: {
    scene_stance: '이 장면에서의 입장',
    remaining_worries: '요소별 걱정 문장',
    required_elements: '요구 요소',
    preferred_turns: '선호 턴',
    max_turns: '최대 턴',
  },
}

/** 화면에 쓸 칸 이름. **모르는 칸이면 열 이름이 그대로 돌아온다** (파이썬 `출처.칸()` 과 같다). */
export function 칸_이름(table_name: string, column_name: string): string {
  return 칸_이름표[table_name]?.[column_name] ?? column_name
}

/**
 * 한 칸의 폼을 가리키는 이름. 화면과 경고가 **같은 함수**로 만든다.
 *
 * 걱정 문장은 한 장면에 여러 칸이 같은 열 이름(`remaining_worries`)을 쓰므로
 * 요소 이름까지 붙여야 한 자리를 가리킨다.
 */
export function 칸_id(
  table_name: string,
  row_id: string,
  column_name: string,
  json_key?: string | null,
): string {
  const 조각 = ['칸', table_name, row_id, column_name]
  if (json_key) 조각.push(json_key)
  return 조각.join('-')
}

// ═══════════════════════════════════════════════════════════════════════════
// 시드 파일 읽기 — **대조용으로만** (2026-08-10 결정 8)
// ═══════════════════════════════════════════════════════════════════════════

/** 시드 파일 이름. 이 파일이 있어야 우리 `sql/` 이다. */
const 시드_파일_이름 = '002_seed_banggui.sql'

/**
 * `sql/002_seed_banggui.sql` 자리.
 *
 * ⚠️ `lib/prompts/render.ts` 의 `promptsDir()` 과 **같은 방식**이다 — Next 는 코드를
 *    `.next/` 아래로 옮기므로 `import.meta.dirname` 을 믿을 수 없고, `process.cwd()` 는
 *    검사를 어디서 돌리느냐에 따라 갈린다. 그래서 둘 다 시작점으로 삼아 거슬러 올라가며
 *    **있는지 확인해서** 고른다.
 */
export function 시드_파일_경로(): string {
  const 본것: string[] = []
  for (const 시작 of [process.cwd(), PROJECT_ROOT]) {
    let 여기 = path.resolve(시작)
    for (;;) {
      const 후보 = path.join(여기, 'sql', 시드_파일_이름)
      if (!본것.includes(후보)) {
        본것.push(후보)
        if (existsSync(후보)) return 후보
      }
      const 위 = path.dirname(여기)
      if (위 === 여기) break
      여기 = 위
    }
  }
  throw new Error(`시드 파일을 못 찾았다. 본 자리:\n  ${본것.join('\n  ')}`)
}

/** SQL 문자열 **밖**의 한 줄 주석만 지운다. 값 안의 `--` 는 값이다. */
export function 주석_제거(원문: string): string {
  const 결과: string[] = []
  let i = 0
  let 문자열_안 = false
  while (i < 원문.length) {
    if (문자열_안) {
      if (원문[i] === "'") {
        if (원문[i + 1] === "'") {
          결과.push("'", "'")
          i += 2
          continue
        }
        문자열_안 = false
      }
      결과.push(원문[i])
      i += 1
      continue
    }
    if (원문[i] === "'") {
      문자열_안 = true
      결과.push(원문[i])
      i += 1
      continue
    }
    if (원문.startsWith('--', i)) {
      const 다음줄 = 원문.indexOf('\n', i)
      i = 다음줄 === -1 ? 원문.length : 다음줄
      continue
    }
    결과.push(원문[i])
    i += 1
  }
  return 결과.join('')
}

/** 괄호·대괄호·문자열 안을 건너뛰고 **맨 바깥** 쉼표로만 자른다. */
export function 최상위_쉼표로_나누기(원문: string): string[] {
  const 항목들: string[] = []
  let 시작 = 0
  let 깊이 = 0
  let 문자열_안 = false
  let i = 0
  while (i < 원문.length) {
    const 글자 = 원문[i]
    if (문자열_안) {
      if (글자 === "'") {
        if (원문[i + 1] === "'") {
          i += 2
          continue
        }
        문자열_안 = false
      }
    } else if (글자 === "'") {
      문자열_안 = true
    } else if (글자 === '(' || 글자 === '[') {
      깊이 += 1
    } else if (글자 === ')' || 글자 === ']') {
      깊이 -= 1
    } else if (글자 === ',' && 깊이 === 0) {
      항목들.push(원문.slice(시작, i).trim())
      시작 = i + 1
    }
    i += 1
  }
  항목들.push(원문.slice(시작).trim())
  return 항목들
}

/** `VALUES … ) AS v` 사이의 행들과 그 끝 자리. */
export function values_행들(원문: string, 시작_위치: number): { 행들: string[]; 끝: number } {
  const values = 원문.indexOf('VALUES', 시작_위치) + 'VALUES'.length
  const 끝 = 원문.indexOf(') AS v', values)
  const 행들: string[] = []
  let i = values
  while (i < 끝) {
    if (!/\s/.test(원문[i]) && 원문[i] !== ',') {
      if (원문[i] !== '(') throw new Error('시드 파일 VALUES 행을 읽을 수 없다')
      const 시작 = i + 1
      let 깊이 = 1
      let 문자열_안 = false
      i += 1
      while (i < 끝 && 깊이 > 0) {
        const 글자 = 원문[i]
        if (문자열_안) {
          if (글자 === "'") {
            if (i + 1 < 끝 && 원문[i + 1] === "'") {
              i += 2
              continue
            }
            문자열_안 = false
          }
        } else if (글자 === "'") {
          문자열_안 = true
        } else if (글자 === '(' || 글자 === '[') {
          깊이 += 1
        } else if (글자 === ')' || 글자 === ']') {
          깊이 -= 1
        }
        i += 1
      }
      if (깊이 > 0) throw new Error('시드 파일 VALUES 행이 닫히지 않았다')
      행들.push(원문.slice(시작, i - 1))
      continue
    }
    i += 1
  }
  return { 행들, 끝 }
}

/** 연달아 쓴 PostgreSQL 문자열 리터럴을 한 값으로 읽는다 (`'가' '나'` → `가나`). */
export function sql_문자열_값(원문: string): string {
  const 값들: string[] = []
  let i = 0
  while (i < 원문.length) {
    if (원문[i] !== "'") {
      i += 1
      continue
    }
    i += 1
    const 값: string[] = []
    while (i < 원문.length) {
      if (원문[i] === "'") {
        if (원문[i + 1] === "'") {
          값.push("'")
          i += 2
          continue
        }
        i += 1
        break
      }
      값.push(원문[i])
      i += 1
    }
    값들.push(값.join(''))
  }
  return 값들.join('')
}

/** 시드 파일에서 읽은 캐릭터 한 벌. 화면 오른쪽 「시드 파일 값 보기」가 이것을 편다. */
export interface 파일_캐릭터 {
  persona: string
  speech_style: string
  guidance_style: string
  forbidden: string[]
}

/** 시드 파일에서 읽은 대화 장면 한 벌. */
export interface 파일_장면 {
  scene_stance: string
  remaining_worries: Record<string, string>
  required_elements: string[]
  preferred_turns: number
  max_turns: number
}

export interface 파일_값들 {
  characters: Record<string, 파일_캐릭터>
  scenes: Record<number, 파일_장면>
}

/** `ARRAY['가', '나']::text[]` 안의 값들. */
function 배열_값(원문: string): string[] {
  const 여는 = 원문.indexOf('[')
  const 닫는 = 원문.lastIndexOf(']')
  return 최상위_쉼표로_나누기(원문.slice(여는 + 1, 닫는)).map(sql_문자열_값)
}

/**
 * 시드 SQL 의 캐릭터 코드·장면 순서별 값 (파이썬 `_시드_파일_값들()`).
 *
 * ⚠️ 캐릭터 6칸 · 장면 13칸이라는 **자리 수**에 기대어 읽는다. 시드에 열이 하나 늘면
 *    여기서 던지고, 화면은 그것을 「시드 파일을 못 읽었다」 띠로 보여 준다 (500 이 아니다).
 */
export function 시드_파일_값들(경로?: string): 파일_값들 {
  const 원문 = 주석_제거(readFileSync(경로 ?? 시드_파일_경로(), 'utf-8'))
  // ⚠️ 표 이름이 `story_characters` 다 (2026-08-13 결정 70). 코드 쪽 심볼만 `characters` 로 남았다.
  const 캐릭터_시작 = 원문.indexOf('INSERT INTO story_characters')
  const { 행들: 캐릭터_행들, 끝: 다음_위치 } = values_행들(원문, 캐릭터_시작)
  // 장면 VALUES 가 둘이다 — 앞이 전개 장면, **뒤가 대화 장면**이다. 화면이 쓰는 것은 뒤쪽이다.
  const 첫_장면_values = 원문.indexOf('FROM 이야기, (VALUES', 다음_위치)
  const 장면_시작 = 원문.indexOf('FROM 이야기, (VALUES', 첫_장면_values + 1)
  const { 행들: 장면_행들 } = values_행들(원문, 장면_시작)

  const 캐릭터들: Record<string, 파일_캐릭터> = {}
  for (const 행 of 캐릭터_행들) {
    const 값 = 최상위_쉼표로_나누기(행)
    if (값.length !== 6) throw new Error('시드 파일 캐릭터 칸 수가 달라졌다')
    캐릭터들[sql_문자열_값(값[0])] = {
      persona: sql_문자열_값(값[2]),
      speech_style: sql_문자열_값(값[3]),
      guidance_style: sql_문자열_값(값[4]),
      forbidden: 배열_값(값[5]),
    }
  }

  const 장면들: Record<number, 파일_장면> = {}
  for (const 행 of 장면_행들) {
    const 값 = 최상위_쉼표로_나누기(행)
    if (값.length !== 13) throw new Error('시드 파일 장면 칸 수가 달라졌다')
    장면들[Number.parseInt(값[0].split('::', 1)[0], 10)] = {
      scene_stance: sql_문자열_값(값[4]),
      remaining_worries: JSON.parse(sql_문자열_값(값[5])) as Record<string, string>,
      required_elements: 배열_값(값[9]),
      preferred_turns: Number.parseInt(값[11].split('::', 1)[0], 10),
      max_turns: Number.parseInt(값[12].split('::', 1)[0], 10),
    }
  }
  return { characters: 캐릭터들, scenes: 장면들 }
}

// ═══════════════════════════════════════════════════════════════════════════
// 작업대 그리기
// ═══════════════════════════════════════════════════════════════════════════

export type SeedCharacterView = SeedCharacterRow & { file_values: 파일_캐릭터 | null }
export type SeedSceneView = SeedSceneRow & {
  file_values: 파일_장면 | null
  /** 요구 요소를 화면 이름으로. 폼에 그대로 실리는 값이라 저장할 때 코드로 되돌린다. */
  required_element_names: string[]
}
export type SeedRevisionView = SeedRevisionRow & { display_name: string }

export interface SeedWorkbench {
  characters: SeedCharacterView[]
  scenes: SeedSceneView[]
  revisions: SeedRevisionView[]
  /** 화면 값이 시드 파일과 갈렸나. 갈렸으면 내보내기로 옮겨야 한다는 뜻이다. */
  file_differs: boolean
  /** 시드 파일을 못 읽었으면 그 까닭. 작업대 자체는 그래도 뜬다. */
  file_read_error: string | null
}

/** 시드 작업대에 그릴 것 전부 (파이썬 `_화면_그리기()`). */
export async function seedWorkbench(conn?: Conn): Promise<SeedWorkbench> {
  const 연결 = conn ?? getDb()
  const 자료 = await listSeed(연결)
  const file_differs = await seedFileDiffers(연결)

  // 시드 파일을 못 읽어도 작업대는 떠야 한다. 칸이 하나 늘기만 해도 파서가 던지는데,
  // 그때 500 이 나면 그 자체가 회귀다 (전에는 이 화면이 파일을 아예 안 읽었다).
  let 파일_값: 파일_값들 = { characters: {}, scenes: {} }
  let file_read_error: string | null = null
  try {
    파일_값 = 시드_파일_값들()
  } catch (그것) {
    file_read_error = 그것 instanceof Error ? 그것.message : String(그것)
  }

  const 행_이름 = new Map<string, string>()
  for (const 행 of 자료.characters) 행_이름.set(`characters ${행.id}`, 행.name)
  for (const 행 of 자료.scenes) 행_이름.set(`story_scenes ${행.id}`, `장면 ${행.scene_order}`)

  return {
    characters: 자료.characters.map((행) => ({
      ...행,
      file_values: 파일_값.characters[행.code] ?? null,
    })),
    scenes: 자료.scenes.map((행) => ({
      ...행,
      file_values: 파일_값.scenes[행.scene_order] ?? null,
      required_element_names: elementNames(행.required_elements),
    })),
    revisions: 자료.revisions.map((개정) => ({
      ...개정,
      display_name: [
        행_이름.get(`${개정.table_name} ${개정.row_id}`) ?? '알 수 없는 칸',
        칸_이름표[개정.table_name]?.[개정.column_name ?? ''] ?? '알 수 없는 칸',
      ].join(' · '),
    })),
    file_differs,
    file_read_error,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 한 칸 저장
// ═══════════════════════════════════════════════════════════════════════════

/** 요소 화면 이름 → 코드. 사람은 「공감」이라 치고 DB 에는 `EMPATHY` 가 들어간다. */
const 이름에서_코드 = new Map(Object.entries(요소).map(([코드, 값]) => [값.이름, 코드]))

/**
 * 사람이 친 글자를 칸 모양대로 읽는다 (파이썬 `_값_읽기()`).
 *
 * ⛔ 여기서 값을 다듬지 않는다 — 줄바꿈·따옴표는 그대로 저장된다.
 *    목록 칸에서만 빈 줄을 떨어낸다 (한 줄에 하나로 적는 칸이라서다).
 */
export function 값_읽기(원문: string, column_name: string): SeedValue {
  if (column_name === 'preferred_turns' || column_name === 'max_turns') {
    const 글자 = 원문.trim()
    // 파이썬 `int()` 와 같은 잣대다 — `1.5`·`한글`·빈 칸은 거절한다.
    if (!/^[+-]?\d+$/.test(글자)) throw new ValueError('턴 수는 정수여야 한다')
    const 값 = Number.parseInt(글자, 10)
    // 🔴 하한이 있어야 **화면에서** 막힌다. 저쪽 `story_scenes` 에는 `preferred_turns > 0`
    //    CHECK 가 이미 걸려 있어(우리 DB 에는 없다), 0 이나 음수를 그냥 흘리면 저쪽에 얹은 뒤
    //    사람이 「저장」을 누르는 순간 사람 말이 아니라 DB 오류가 뜬다.
    //    0턴 대화는 뜻도 없다 — 아이가 한 번도 말하지 않는 대화 장면이다.
    if (값 < 1) throw new ValueError('턴 수는 1 이상이어야 한다')
    return 값
  }
  if (column_name === 'forbidden' || column_name === 'required_elements') {
    const 값들 = 원문
      .replace(/,/g, '\n')
      .split('\n')
      .map((항목) => 항목.trim())
      .filter((항목) => 항목 !== '')
    if (column_name === 'required_elements') {
      return 값들.map((값) => 이름에서_코드.get(값) ?? 값)
    }
    return 값들
  }
  if (column_name === 'remaining_worries') {
    let 값: unknown
    try {
      값 = JSON.parse(원문)
    } catch {
      throw new ValueError('걱정 문장은 JSON 객체여야 한다')
    }
    if (
      typeof 값 !== 'object' ||
      값 === null ||
      Array.isArray(값) ||
      !Object.values(값 as Record<string, unknown>).every((문장) => typeof 문장 === 'string')
    ) {
      throw new ValueError('걱정 문장은 요소 이름과 문장으로 된 JSON 객체여야 한다')
    }
    return 값 as Record<string, string>
  }
  return 원문
}

/**
 * DB 가 거절한 것을 화면 말로 옮긴다 (파이썬 `_DB가_거절한_이유()`).
 *
 * 저장 계층이 먼저 막으므로 여기까지 오는 것은 화면이 아직 모르는 조건이다.
 * 그래도 500 이 뜨면 안 된다 — 제약 이름과 SQL 원문은 사람이 읽을 말이 아니다.
 */
export function DB가_거절한_이유(제약: string | null): string {
  if (제약 === 'dialogue_scene_needs_all_parts') return 대화_장면_입장_경고
  if (제약 === 'preferred_turns_not_over_max') return '선호 턴은 최대 턴보다 클 수 없습니다.'
  return '이 값은 저장할 수 없습니다. 값을 다시 확인해 주세요.'
}

/**
 * CHECK 제약 위반이면 그 제약 이름을, 아니면 `null` (파이썬 `_CHECK_위반()`).
 *
 * ⚠️ **벗겨 봐야 한다.** 드리즐은 진짜 오류를 `cause` 에 담아 `DrizzleQueryError` 로 싼다.
 *    벗기지 않으면 여기서 조용히 안 잡혀, 기획자가 잘못된 값을 저장할 때
 *    사람 말 경고 대신 500 이 뜬다 (파이썬에서 `sqlalchemy.exc` 로 겪은 것과 같은 자리다).
 */
export function CHECK_위반(오류: unknown): string | null {
  let 후보: unknown = 오류
  for (let 깊이 = 0; 깊이 < 5 && 후보 !== null && 후보 !== undefined; 깊이 += 1) {
    const 그것 = 후보 as { code?: unknown; constraint_name?: unknown; cause?: unknown }
    // 23514 = check_violation (PostgreSQL 오류 코드표).
    if (그것.code === '23514') {
      return typeof 그것.constraint_name === 'string' ? 그것.constraint_name : ''
    }
    후보 = 그것.cause
  }
  return null
}

export interface SeedCellInput {
  table_name: string
  row_id: string
  column_name: string
  /** 폼에서 온 글자 그대로. 다듬지 않는다. */
  value: string
  origin: string
  /** 걱정 문장처럼 한 열 안의 한 열쇠만 고치는 칸. */
  json_key?: string | null
  changed_by?: string | null
}

/**
 * 시드 한 칸을 저장한다 (파이썬 `시드_한칸_수정()` 의 몸통).
 *
 * ⚠️ **빈 칸이 「칸이 아예 없다」가 되면 안 된다.** 파이썬에서는 그 자리에서 폼 검증기가
 *    `{"type":"missing"}` 을 사람에게 뱉었다. 빈 값을 그대로 받아, 비울 수 있는 칸인지는
 *    여기서 사람 말로 답한다.
 */
export async function saveSeedCell(입력: SeedCellInput, conn?: Conn): Promise<void> {
  const 연결 = conn ?? getDb()
  const { table_name, row_id, column_name, value, origin } = 입력
  const json_key = 입력.json_key ?? null

  // 비워도 되는 칸인지는 칸마다 다르다. 지금 정해진 것은 「이 장면에서의 입장」뿐이라
  // (2026-08-11) 나머지는 거절하되, 기계 말 대신 사람 말로 답한다.
  if (value.trim() === '' && column_name !== 'scene_stance') {
    throw new ValueError('이 칸은 비워 둘 수 없습니다.')
  }

  // 🔴 **순서가 파이썬 그대로다** — `값_읽기()` 가 `json_key` 갈림보다 먼저 돈다. 그래서
  //    걱정 문장 한 칸을 사람 말로 저장하면 「JSON 객체여야 한다」로 거절당한다 (파이썬도
  //    똑같고, 그쪽에도 이 경로를 재는 검사가 없었다). 이식은 그대로 옮기는 일이라 안 고쳤다 —
  //    고치려면 이 두 줄의 순서를 바꾸고 `tests/seed-admin.test.ts` 의 짝을 뒤집으면 된다.
  let 새값 = 값_읽기(value, column_name)
  if (column_name === 'remaining_worries' && json_key) {
    // 걱정 문장 한 칸만 고친다. 나머지 요소의 문장은 그대로 둔 채 사전을 통째로 다시 쓴다.
    const 자료 = await listSeed(연결)
    const 장면 = 자료.scenes.find((행) => 행.id === row_id)
    if (장면 === undefined) throw new ValueError(`장면이 없다: ${row_id}`)
    새값 = { ...장면.remaining_worries, [json_key]: value }
  }

  try {
    await updateSeedCell(연결, {
      table_name,
      row_id,
      column_name,
      new_value: 새값,
      origin,
      changed_by: 입력.changed_by ?? null,
    })
  } catch (그것) {
    const 제약 = CHECK_위반(그것)
    if (제약 === null) throw 그것
    throw new ValueError(DB가_거절한_이유(제약))
  }
}

/** 개정 하나를 직전 값으로 되돌린다 (파이썬 `시드_되돌리기()` 라우트). */
export async function undoSeedCell(
  { revision_id, changed_by }: { revision_id: number; changed_by?: string | null },
  conn?: Conn,
): Promise<void> {
  const 연결 = conn ?? getDb()
  try {
    await undoSeedRevision(연결, { revision_id, changed_by: changed_by ?? null })
  } catch (그것) {
    const 제약 = CHECK_위반(그것)
    if (제약 === null) throw 그것
    throw new ValueError(DB가_거절한_이유(제약))
  }
}

/**
 * 경고를 어느 칸에 붙일지. **이름을 아는 칸일 때만** 자리를 준다.
 *
 * 화면에 칸이 40개라 어느 칸에서 났는지도 함께 알려야 한다 (파이썬 `_경고_화면()`).
 */
export function 경고_칸자리(
  table_name: string,
  row_id: string,
  column_name: string,
  json_key?: string | null,
): string | null {
  if (!고칠_수_있는_칸[table_name]?.includes(column_name)) return null
  return 칸_id(table_name, row_id, column_name, json_key)
}

/**
 * 칸 자리 이름(`칸-story_scenes-<uuid>-remaining_worries-SOLUTION`)에서 사람이 읽을 이름으로.
 *
 * ⚠️ `split('-')` 로 세지 않는다 — uuid 안에도 `-` 가 넷 있다. 표 이름과 uuid 길이(36)로
 *    앞을 떼어 내고 남은 것을 읽는다. 모르는 모양이면 `null` 이라 화면에 안 나간다.
 */
export function 칸자리_이름(칸자리: string): string | null {
  for (const 표 of Object.keys(칸_이름표)) {
    const 머리 = `칸-${표}-`
    if (!칸자리.startsWith(머리)) continue
    const 나머지 = 칸자리.slice(머리.length + 36) // uuid 36 글자를 건너뛴다
    if (!나머지.startsWith('-')) return null
    const [칸, ...열쇠] = 나머지.slice(1).split('-')
    const 이름 = 칸_이름표[표][칸]
    if (이름 === undefined) return null
    return 열쇠.length === 0 ? 이름 : `${이름}(${elementName(열쇠.join('-'))})`
  }
  return null
}

// ═══════════════════════════════════════════════════════════════════════════
// 내보내기 — ⭐ 이 왕복이 끊기면 콘텐츠 정본 관리가 죽는다
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 빈 칸은 `NULL` 로 적는다.
 *
 * 전에는 여기서 터져 **내보내기 전체가 500** 이 됐다. 한 칸이 비었다고 옮겨 붙일 SQL 을
 * 통째로 못 받는 쪽이 더 나쁘다.
 */
export function sql_문자열(값: string | null): string {
  if (값 === null) return 'NULL'
  return "'" + 값.replace(/'/g, "''") + "'"
}

export function sql_숫자(값: number | null): string {
  return 값 === null ? 'NULL' : String(값)
}

export function sql_배열(값들: readonly string[] | null): string {
  if (값들 === null) return 'NULL'
  if (값들.length === 0) return 'ARRAY[]::text[]'
  return 'ARRAY[' + 값들.map((값) => sql_문자열(값)).join(', ') + ']::text[]'
}

/**
 * 비어 있는 칸을 SQL 안에서 눈에 띄게 남긴다.
 *
 * `NULL` 만 적어 두면 옮겨 붙이는 사람이 그냥 지나친다. 대화 장면이면 그 SQL 을 붓는
 * 순간 DB 가 거절한다 (`dialogue_scene_needs_all_parts`).
 */
export function 빈_칸_경고(
  table_name: string,
  행: Record<string, unknown>,
  칸들: readonly string[],
): string[] {
  const 빈_칸 = 칸들.filter((열) => 행[열] === null || 행[열] === undefined)
  if (빈_칸.length === 0) return []
  const 이름들 = 빈_칸.map((열) => 칸_이름(table_name, 열)).join(', ')
  return [`-- ⚠️ 비어서 NULL 로 적었다: ${이름들}. 이대로 부으면 DB 가 거절할 수 있다.`]
}

/** `열=출처이름` 목록 한 줄. 어느 값이 아직 검수 대상인지가 SQL 에도 남아야 한다. */
function 출처_줄(origins: Record<string, string>): string {
  return Object.entries(origins)
    .map(([열, 값]) => `${열}=${출처_이름[값] ?? 값}`)
    .join(', ')
}

/** 걱정 문장 사전을 jsonb 리터럴로. 열쇠를 정렬해 **같은 값이면 같은 글자**가 나오게 한다. */
function 걱정_리터럴(값: Record<string, string> | null): string {
  if (값 === null) return 'NULL'
  const 정렬됨 = Object.fromEntries(Object.entries(값).sort(([가], [나]) => (가 < 나 ? -1 : 1)))
  // ⚠️ 파이썬 `json.dumps(..., ensure_ascii=False)` 와 한 자리 갈린다 — 파이썬은 `", "`·`": "`
  //    로 띄어 쓰고 여기는 안 띄운다. jsonb 로 들어가면 어느 쪽이든 같은 값이다.
  return sql_문자열(JSON.stringify(정렬됨)) + '::jsonb'
}

/**
 * 지금 작업값을 **옮겨 붙일 SQL** 로 (파이썬 `시드_내보내기()`).
 *
 * ⛔ 이 함수는 파일을 쓰지 않는다. 사람이 받아 검토해 `sql/002_seed_banggui.sql` 로 옮긴다.
 *
 * 🔴 **`stories.slug` 로 조인한다** (2026-08-13 · 2-d 의 H). 파이썬 그대로 `s.title` 이었는데
 *    `title` 에는 UNIQUE 가 없다 — 화면에서 제목을 고치면 이 SQL 이 **0행을 갱신하고 조용히
 *    성공한다.** 아무도 안 아프고 값만 안 옮겨진다. `slug` 는 NOT NULL·UNIQUE 라 그 구멍이 없다.
 */
export async function seedExportSql(conn?: Conn): Promise<string> {
  const 자료 = await seedExportData(conn ?? getDb())

  const 줄들: string[] = [
    '-- 관리자 화면에서 내보낸 시드 작업값',
    '-- 시드 파일은 이 화면이 쓰지 않는다. 사람이 검토해 sql/002_seed_banggui.sql 로 옮긴다.',
    'BEGIN;',
    '',
  ]

  for (const 캐릭터 of 자료.characters) {
    줄들.push(`-- ${캐릭터.name} 출처: ${출처_줄(캐릭터.origins)}`)
    줄들.push(
      ...빈_칸_경고('characters', 캐릭터 as unknown as Record<string, unknown>, [
        'persona',
        'speech_style',
        'guidance_style',
        'forbidden',
      ]),
    )
    줄들.push(
      'UPDATE story_characters c',
      '   SET persona = ' + sql_문자열(캐릭터.persona) + ',',
      '       speech_style = ' + sql_문자열(캐릭터.speech_style) + ',',
      '       guidance_style = ' + sql_문자열(캐릭터.guidance_style) + ',',
      '       forbidden = ' + sql_배열(캐릭터.forbidden),
      '  FROM stories s',
      ' WHERE c.story_id = s.id',
      '   AND s.slug = ' + sql_문자열(캐릭터.story_slug),
      '   AND c.code = ' + sql_문자열(캐릭터.code) + ';',
      '',
    )
  }

  for (const 장면 of 자료.scenes) {
    줄들.push(`-- 장면 ${장면.scene_order} 출처: ${출처_줄(장면.origins)}`)
    줄들.push(
      ...빈_칸_경고('story_scenes', 장면 as unknown as Record<string, unknown>, [
        'scene_stance',
        'remaining_worries',
        'required_elements',
        'preferred_turns',
        'max_turns',
      ]),
    )
    줄들.push(
      'UPDATE story_scenes sc',
      '   SET scene_stance = ' + sql_문자열(장면.scene_stance) + ',',
      '       remaining_worries = ' + 걱정_리터럴(장면.remaining_worries) + ',',
      '       required_elements = ' + sql_배열(장면.required_elements) + ',',
      '       preferred_turns = ' + sql_숫자(장면.preferred_turns) + ',',
      '       max_turns = ' + sql_숫자(장면.max_turns),
      '  FROM stories s',
      ' WHERE sc.story_id = s.id',
      '   AND s.slug = ' + sql_문자열(장면.story_slug),
      `   AND sc.scene_order = ${장면.scene_order};`,
      '',
    )
  }
  줄들.push('COMMIT;')
  return 줄들.join('\n') + '\n'
}

/** 개정 한 줄을 읽는다. 되돌리기 전에 무엇을 되돌리는지 보여 줄 때 쓴다. */
export async function readRevision(revision_id: number, conn?: Conn): Promise<SeedRevisionRow> {
  return readSeedRevision(conn ?? getDb(), revision_id)
}
