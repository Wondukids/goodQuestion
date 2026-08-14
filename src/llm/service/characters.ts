// 캐릭터 보기 화면이 그릴 것을 조립한다 (이슈 #26 화면-6).
//
// 파이썬 `src/goodquestion_admin/routes/characters.py` 의 조립 부분(`_칸들`·`_센다`)과
// `src/goodquestion_admin/출처.py` 를 **한 파일로** 옮긴 것이다.
//
// ## 이 화면의 존재 이유 하나 — 원문과 우리가 지어낸 값을 눈으로 가른다
//
// 기획자가 캐릭터 값을 검수하려면 먼저 **무엇을 검수해야 하는지**를 알아야 한다.
// 「방귀 뀌는 며느리」 원문에 있던 문장은 검수 대상이 아니고, 우리가 고정 대사에서
// 말투를 역산해 지어낸 문장(결정 12)이 검수 대상이다.
//
// ## `/seed`(시드 편집) 와 무엇이 다른가 — 중복이 아니다
//
// | | 시드 편집 | `/characters` (여기) |
// |---|---|---|
// | 하는 일 | DB 작업값을 **고친다** | **본다.** 고치는 주소가 없다 |
// | 보이는 칸 | 고칠 수 있는 9칸만 | 고정 대사·장면 목표·갈등까지 **전부** |
// | 출처 표시 | `seed_revisions` 에 **사람이 고른** 출처 | `sql/002_seed_banggui.sql` **머리말이 적어 둔** 출처 |
//
// ## 출처 표의 정본은 `sql/002_seed_banggui.sql` 머리말이다
//
// 이 파일의 `캐릭터_칸`·`장면_칸` 은 그 머리말을 코드로 옮겨 적은 **사본**이고,
// `tests/characters-admin.test.ts` 가 시드 파일을 다시 읽어 두 쪽이 어긋나면 빨개진다.
// 머리말을 **실행 중에 파싱하지 않는** 이유는 머리말이 사람이 쓴 산문이라서다 —
// 문장 하나 다듬었다고 화면이 깨지면 안 된다.
//
// 🔴 **시드 편집 화면 트랙과 겹치는 자리다** — 저쪽도 출처 이름표(`정본`/`초안`)를 쓴다
//    (파이썬은 `출처.py` 한 벌을 두 화면이 같이 썼다). 보고에 적어 뒀다.

import {
  listSeedCharacters,
  listSeedScenes,
  seedFileDiffers,
  type SeedCharacterRow,
  type SeedSceneRow,
} from '@/llm/repo/characters-admin'
import { getDb, type Conn } from '@/llm/repo/db'

import { 원문, 지어낸_값, 표시_없음, 출처_설명, 출처_이름, type Origin } from './origin'

// ═══════════════════════════════════════════════════════════════════════════
// 출처 — 파이썬 `출처.py`
// ═══════════════════════════════════════════════════════════════════════════
//
// ⭐ **이름표 한 벌은 `service/origin.ts` 로 옮겼다** (2026-08-13). 파이썬이 `출처.py`
//    한 벌을 두 화면에 같이 쓰던 모양으로 되돌린 것이다. 여기 남은 것은 이 화면만 아는
//    **칸별 출처 표**(`캐릭터_칸`·`장면_칸`)이고, 그 정본은 `sql/002` 머리말이다.

export { 원문, 지어낸_값, 표시_없음, 출처_설명, 출처_이름, type Origin }

/** 칸 하나에 적어 둔 것 — (출처, 화면에 쓸 이름, 그렇게 읽은 근거). */
interface 칸_정의 {
  origin: Origin
  label: string
  /** 근거는 화면에 그대로 뜬다. 「누가 그렇게 정했나」를 화면에서 되짚을 수 있어야 한다. */
  source: string
}

export const 캐릭터_칸: Readonly<Record<string, 칸_정의>> = {
  persona: {
    origin: 지어낸_값,
    label: '성격·처지',
    source: 'sql/002_seed_banggui.sql:41 ✏️ · 결정 12',
  },
  speech_style: {
    origin: 지어낸_값,
    label: '말투',
    source: 'sql/002_seed_banggui.sql:41 ✏️ · 결정 12',
  },
  guidance_style: {
    origin: 지어낸_값,
    label: '드러내는 방식',
    source: 'sql/002_seed_banggui.sql:41 ✏️ · 결정 12',
  },
  forbidden: {
    origin: 지어낸_값,
    label: '하지 않는 것',
    source: 'sql/002_seed_banggui.sql:41 ✏️ · 결정 12',
  },
}

export const 장면_칸: Readonly<Record<string, 칸_정의>> = {
  scene_description: {
    origin: 원문,
    label: '장면 지문',
    source: 'sql/002_seed_banggui.sql:12-14 원문 목록',
  },
  conflict: {
    origin: 지어낸_값,
    label: '장면의 갈등',
    source:
      'sql/002_seed_banggui.sql:152 ✏️ — 3장 표에 이 열이 없어 지문에서 요약했다. ' +
      '⚠️ 머리말 ✏️ 목록에는 빠져 있다',
  },
  character_opening: {
    origin: 원문,
    label: '고정 첫 대사',
    source: 'sql/002_seed_banggui.sql:12-14 원문 목록',
  },
  character_closing: {
    origin: 원문,
    label: '고정 마지막 대사',
    source: 'sql/002_seed_banggui.sql:12-14 원문 목록',
  },
  scene_goal: {
    origin: 원문,
    label: '장면 목표',
    source: 'sql/002_seed_banggui.sql:12-14 원문 목록',
  },
  required_elements: {
    origin: 원문,
    label: '요구 사고 요소',
    source: 'sql/002_seed_banggui.sql:12-14 원문 목록',
  },
  max_turns: {
    origin: 원문,
    label: '최대 턴',
    source: 'sql/002_seed_banggui.sql:12-14 원문 목록',
  },
  scene_stance: {
    origin: 지어낸_값,
    label: '이 장면에서의 입장',
    source: 'sql/002_seed_banggui.sql:10 ✏️ · 결정 12',
  },
  remaining_worries: {
    origin: 지어낸_값,
    label: '요소별 걱정 문장',
    source: 'sql/002_seed_banggui.sql:11 ✏️ · 결정 12',
  },
  preferred_turns: {
    origin: 지어낸_값,
    label: '선호 턴',
    source: 'sql/002_seed_banggui.sql:8 ✏️ · 결정 2',
  },
}

/** 화면이 한 칸 옆에 붙일 표시. 파이썬 `출처.칸()`. */
export interface OriginField {
  column: string
  origin: Origin
  origin_label: string
  origin_help: string
  label: string
  source: string
}

/** 한 칸의 표시를 준다. **모르는 칸이면 `표시_없음` 이다** — 원문으로 채우지 않는다. */
export function originField(표_이름: string, 칸_이름: string): OriginField {
  const 표 = 표_이름 === 'characters' ? 캐릭터_칸 : 장면_칸
  const 적힌것 = 표[칸_이름] ?? {
    origin: 표시_없음 as Origin,
    label: 칸_이름,
    source: '시드 파일에서 못 찾았다',
  }
  return {
    column: 칸_이름,
    origin: 적힌것.origin,
    origin_label: 출처_이름[적힌것.origin],
    origin_help: 출처_설명[적힌것.origin],
    label: 적힌것.label,
    source: 적힌것.source,
  }
}

/** 원문 그대로인 값은 검수 대상이 아니다. 지어낸 값과 표시 없는 값만 사람이 봐야 한다. */
export function needsReview(표_이름: string, 칸_이름: string): boolean {
  return originField(표_이름, 칸_이름).origin !== 원문
}

// ═══════════════════════════════════════════════════════════════════════════
// 화면이 그릴 것
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 화면에 그릴 순서. **지어낸 값을 앞에 두지 않는다** —
 * 원문을 먼저 읽어야 그 다음 칸이 왜 그렇게 지어졌는지 판단이 선다.
 */
export const 캐릭터_순서 = ['persona', 'speech_style', 'guidance_style', 'forbidden'] as const

export const 장면_순서 = [
  'scene_description',
  'conflict',
  'character_opening',
  'character_closing',
  'scene_goal',
  'required_elements',
  'max_turns',
  'scene_stance',
  'preferred_turns',
  'remaining_worries',
] as const

/** 값 하나에 출처 표시를 붙인 것. */
export interface FieldView extends OriginField {
  value: unknown
  review_needed: boolean
}

export interface CharacterCard {
  id: string
  code: string
  name: string
  story_title: string
  fields: FieldView[]
}

export interface SceneCard {
  id: string
  scene_order: number
  character_name: string | null
  character_code: string
  fields: FieldView[]
  /**
   * 걱정 문장은 **요소별로 갈라** 보여야 검수가 된다. 통째 JSON 으로 뭉쳐 있으면
   * 어느 요소의 문장이 이상한지 짚을 수 없다.
   */
  worries: Record<string, string>
}

export interface OriginCounts {
  canon: number
  draft: number
  unmarked: number
}

export interface CharactersView {
  characters: CharacterCard[]
  scenes: SceneCard[]
  counts: OriginCounts
  /** 지금 DB 값이 시드 파일과 다른가. 다르면 화면 맨 위에 띠가 붙는다. */
  file_differs: boolean
  /** 걱정 문장 표에 붙일 출처 표시 (`remaining_worries`). */
  worry_origin: OriginField
}

/** 파이썬 `_칸들()` — 행에서 정해진 순서대로 칸을 뽑아 출처를 붙인다. */
function 칸들(
  행: Readonly<Record<string, unknown>>,
  표_이름: string,
  이름들: readonly string[],
): FieldView[] {
  const 모은것: FieldView[] = []
  for (const 이름 of 이름들) {
    if (!(이름 in 행)) continue
    모은것.push({
      ...originField(표_이름, 이름),
      value: 행[이름],
      review_needed: needsReview(표_이름, 이름),
    })
  }
  return 모은것
}

/** 파이썬 `_센다()` — 화면 맨 위의 「정본 N칸 · 초안 M칸」. */
function 센다(칸들: readonly FieldView[]): OriginCounts {
  const 세기 = (무엇: Origin) => 칸들.filter((칸) => 칸.origin === 무엇).length
  return { canon: 세기(원문), draft: 세기(지어낸_값), unmarked: 세기(표시_없음) }
}

/** 파이썬 `_칸들()` 이 `dict` 를 받던 자리. 드리즐 행은 이미 그 모양이다. */
function 행으로(행: SeedCharacterRow | SeedSceneRow): Readonly<Record<string, unknown>> {
  return 행 as unknown as Record<string, unknown>
}

/**
 * 캐릭터 보기 화면 하나를 그리는 데 필요한 것 전부 (파이썬 `캐릭터_화면()`).
 *
 * ⛔ **여기서 아무것도 판정하지 않는다.** DB 값에 「어디서 온 값인가」 표시를 붙일 뿐이다.
 */
export async function charactersView(conn?: Conn): Promise<CharactersView> {
  const 연결 = conn ?? getDb()
  const 캐릭터_행들 = await listSeedCharacters(연결)
  const 장면_행들 = await listSeedScenes(연결)
  const file_differs = await seedFileDiffers(연결)

  const characters: CharacterCard[] = 캐릭터_행들.map((행) => ({
    id: 행.id,
    code: 행.code,
    name: 행.name,
    story_title: 행.story_title,
    fields: 칸들(행으로(행), 'characters', 캐릭터_순서),
  }))

  const 모든_칸: FieldView[] = characters.flatMap((캐릭터) => 캐릭터.fields)
  const scenes: SceneCard[] = 장면_행들.map((행) => {
    const 칸 = 칸들(행으로(행), 'story_scenes', 장면_순서)
    모든_칸.push(...칸)
    return {
      id: 행.id,
      scene_order: 행.scene_order,
      character_name: 행.character_name,
      character_code: 행.character_code,
      fields: 칸,
      worries: { ...(행.remaining_worries ?? {}) },
    }
  })

  return {
    characters,
    scenes,
    counts: 센다(모든_칸),
    file_differs,
    worry_origin: originField('story_scenes', 'remaining_worries'),
  }
}
