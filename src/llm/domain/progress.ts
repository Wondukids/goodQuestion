// 세션 기록만 보고 다음 실행 단계를 고르는 순수 진행 함수.
//
// 모드·종료 사유는 여기서 판정하지 않는다. `decide.ts` 가 저장해 둔 `scene_end_reason` 과
// 세션 상태를 읽어 **다음 동작만** 고른다.
//
// ⛔ 아무것도 import 하지 않는다 (`docs/설계/코드구조.md` 1절). eslint 가 막아 뒀다.
//    DB 도 LLM 도 모른다 — 장면 목록과 세션 한 행을 **값으로** 받는다.
//
// ⚠️ 파이썬 `src/goodquestion/진행.py` 를 **있는 그대로** 옮긴 것이다 (이슈 #26 규칙-4).
//    `web/tests/progress.test.ts` 가 파이썬에서 뽑은 황금표 618건과 대조한다.
//
// ## 이름에 대해
//
// 함수 이름은 영어다(`코드구조.md` 3절 대응표 — `다음_할_일`→`nextStep` ·
// `대화_장면인가`→`isDialogueScene` · `앞선_전개`→`precedingNarration`).
// **DB 컬럼(`scene_id`·`scene_order`·`character_id`·`status`·`scene_end_reason`)과
// 도메인 값(`장면시작`·`발화받기`·`장면끝`·`회차끝`·`GOAL_MET`)은 그대로다.**
// 그래서 한 객체 안에 영어와 snake_case 가 섞인다 — 그게 맞다.

/**
 * 파이썬 `ValueError` 자리. 부르는 쪽이 잘못된 인자를 줬다는 뜻이다.
 *
 * 자바스크립트에는 두 갈래가 없어 클래스를 세운다. 갈래를 뭉개면 「인자가 틀렸다」와
 * 「데이터에 없다」가 한 덩이가 되고, 화면이 그 둘을 다르게 다뤄야 할 때 갈라낼 수 없다.
 */
export class ValueError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValueError'
  }
}

/** 파이썬 `LookupError` 자리. 찾는 것이 목록에 없다는 뜻이다. */
export class LookupError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LookupError'
  }
}

/**
 * `story_scenes` 한 행 중 진행 판단에 쓰이는 세 칸.
 *
 * 이름은 DB 컬럼명 그대로다(`CLAUDE.md` DB 절 — 변환하지 않는다).
 * 실제로 넘어오는 행에는 칸이 더 많지만, 이 층은 이 셋 말고 아무것도 보지 않는다.
 */
export interface SceneRow {
  scene_id: string
  scene_order: number
  character_id: string | null
}

/** `story_sessions` 한 행 중 진행 판단에 쓰이는 세 칸. */
export interface SessionRow {
  status: string
  current_scene_id: string | null
  scene_end_reason: string | null
}

/** 다음에 할 일 하나. 파이썬 `할일` 데이터클래스 자리다. */
export interface Step {
  kind: string // 장면시작 / 발화받기 / 장면끝 / 회차끝
  scene_id: string | null
  reason: string | null // `장면끝` 일 때의 scene_end_reason
}

/** 대화/전개 구분은 장면 데이터의 `character_id` 만 따른다 (결정 11). */
export function isDialogueScene(scene: SceneRow): boolean {
  return scene.character_id !== null
}

/**
 * 현재 장면보다 앞선 전개 장면을 원래 순서대로 돌려준다 (결정 25).
 *
 * 「앞선」까지만인 이유는 뒷이야기 스포일러를 막기 위해서다.
 * ⚠️ 받은 배열을 정렬하지 않는다 — `nextStep` 과 다른 자리다.
 */
export function precedingNarration(
  scenes: readonly SceneRow[],
  scene: SceneRow,
): readonly SceneRow[] {
  return scenes.filter(
    (앞) => 앞.scene_order < scene.scene_order && !isDialogueScene(앞),
  )
}

/** 세션 한 행과 장면 목록만 보고 다음에 할 일을 하나로 정한다. */
export function nextStep(
  scenes: readonly SceneRow[],
  session: SessionRow,
  { scope, scene_order }: { scope: string; scene_order?: number | null },
): Step {
  if (scope !== 'scene' && scope !== 'story') {
    throw new ValueError(`알 수 없는 범위: ${scope}`)
  }
  if (scope === 'scene' && (scene_order === null || scene_order === undefined)) {
    throw new ValueError('scene 범위에는 장면_번호가 필요하다')
  }
  if (session.status !== 'in_progress') {
    return { kind: '회차끝', scene_id: null, reason: null }
  }

  // 받은 배열을 건드리지 않으려고 복사해서 정렬한다. 목록이 `scene_order` 순이라는 보장이 없다.
  const 순서대로 = [...scenes].sort((가, 나) => 가.scene_order - 나.scene_order)

  let 대상들: readonly SceneRow[]
  if (scope === 'scene') {
    const 후보 = 순서대로.filter((장면) => 장면.scene_order === scene_order)
    if (후보.length === 0) {
      throw new LookupError(`장면이 없다: scene_order=${scene_order}`)
    }
    대상들 = 후보
  } else {
    대상들 = 순서대로
  }

  const 현재_id = session.current_scene_id
  if (현재_id === null) {
    if (대상들.length === 0) return { kind: '회차끝', scene_id: null, reason: null }
    return { kind: '장면시작', scene_id: 대상들[0].scene_id, reason: null }
  }

  const 현재_위치 = 대상들.findIndex((장면) => 장면.scene_id === 현재_id)
  if (현재_위치 === -1) {
    // scene 범위는 한 장면만 보므로, 세션이 딴 장면에 있어도 이 장면을 시작하면 된다.
    // story 범위에서는 그럴 수 없다 — 목록에 없는 곳에 세션이 가 있다는 뜻이다.
    if (scope === 'scene') {
      return { kind: '장면시작', scene_id: 대상들[0].scene_id, reason: null }
    }
    throw new LookupError(`세션의 현재 장면이 목록에 없다: ${현재_id}`)
  }

  const 현재 = 대상들[현재_위치]
  if (isDialogueScene(현재) && session.scene_end_reason === null) {
    return { kind: '발화받기', scene_id: 현재.scene_id, reason: null }
  }

  if (scope === 'scene' && session.scene_end_reason !== null) {
    return { kind: '장면끝', scene_id: 현재.scene_id, reason: session.scene_end_reason }
  }

  const 다음_위치 = 현재_위치 + 1
  if (다음_위치 < 대상들.length) {
    return { kind: '장면시작', scene_id: 대상들[다음_위치].scene_id, reason: null }
  }
  return { kind: '회차끝', scene_id: null, reason: null }
}
