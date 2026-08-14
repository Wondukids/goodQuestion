// 골든셋 채점기 — **점수를 내는 자리는 여기 하나다** (이슈 #26 말-8).
//
// 파이썬 `src/goodquestion/goldenset.py` 의 세 갈래를 옮긴 것이다.
//
// | 파이썬 | 여기 |
// |---|---|
// | `읽기()` · `_항목_만들기()` · `_목록으로()` | `parseGoldenset()` |
// | `검수완료만()` | `reviewedOnly()` — CLI `--검수완료만` 이 부르던 그 함수다 |
// | `채점()` · `_나눗셈()` | `score()` |
// | `응답을_라벨로()` · `_코드블록_벗기기()` | `responseToLabel()` |
// | `채점표.믿을_수_있나` | `trustworthy()` |
// | `채점.항목결과.맞음` | `isCorrect()` |
//
// ## ⛔ 이 파일은 DB 도 화면도 LLM 도 모른다
//
// import 가 하나도 없다. 파일조차 읽지 않는다 — `parseGoldenset()` 은 **글자**를 받는다.
// 그래야 파이썬과 같은 입력을 넣어 같은 숫자가 나오는지 기계로 대조할 수 있고
// (`web/tests/scoring.test.ts`), 그 대조가 이 이식에서 유일하게 확실한 자리다.
// 파일을 읽고 LLM 을 부르는 일은 `lib/service/goldenset.ts` 가 한다.
//
// ## 왜 「판정 불가」가 여기 없나
//
// 답이 안 온 항목은 **애초에 `score()` 에 넣지 않는다** (FR-026 · 결정 29).
// 그래서 `표.건수` 가 곧 판정한 수가 되고 분모가 저절로 맞는다. 세는 쪽이 아니라
// 넣는 쪽에서 빼는 것이고, 넣고 빼는 판단은 서비스 층이 한다.
//
// ⚠️ **라벨이 왔는데 정답과 다른 것은 「틀림」이지 판정 불가가 아니다.** 이걸 섞으면
//    분석 LLM 이 틀릴수록 점수가 올라간다.

// ── 라벨로 쓸 수 있는 값 (`prompts/analysis.md` 가 정본이다) ────────────────
//
// ⚠️ `lib/engine/analyze.ts` 의 `의도_값`·`사고_요소`·`유효성_값` 과 **같은 목록**이지만
//    일부러 다시 적었다. 저쪽은 LLM 에 보내는 스키마이고 이쪽은 **정답지를 검증하는
//    잣대**다. 그리고 이 파일은 아무것도 import 하지 않는 것이 규칙이다(위 머리말).
//    두 목록이 어긋나면 `tests/scoring.test.ts` 가 빨개진다.

/** `prompts/analysis.md:69-81` */
export const CHILD_INTENT_값: ReadonlySet<string> = new Set([
  'QUESTION',
  'OPINION',
  'REASONING',
  'SOLUTION',
  'DECISION',
  'PERSPECTIVE',
  'EMOTION',
  'REQUEST',
  'CHALLENGE',
  'PLAYFUL',
  'OFF_TOPIC',
  'SHORT_RESPONSE',
  'UNCLEAR',
])

/** `prompts/analysis.md:96-103` */
export const ELEMENT_값: ReadonlySet<string> = new Set([
  'DECISION',
  'REASON',
  'PERSPECTIVE',
  'SOLUTION',
  'RESULT',
  'EMOTION',
  'EMPATHY',
  'REQUEST',
])

/** `prompts/analysis.md:117-121` */
export const VALIDITY_값: ReadonlySet<string> = new Set([
  'VALID',
  'SHORT',
  'UNCLEAR',
  'OFF_TOPIC',
  'PLAYFUL',
])

/** 검수 상태는 이 둘뿐이다. 세 번째 값을 만들지 마라 — `--검수완료만` 이 이 값으로 가른다. */
export const 검수_값 = ['초안', '검수완료'] as const

/** 골든셋 파일이 형식에 안 맞다. 메시지 앞에 항상 `파일:줄번호` 가 붙는다. */
export class GoldensetError extends Error {
  constructor(메시지: string) {
    super(메시지)
    this.name = 'GoldensetError'
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 형식
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 분석 LLM 이 내야 하는 4개 중 자동 채점하는 것들 (파이썬 `정답라벨`).
 *
 * 이름은 `prompts/analysis.md` 의 출력 필드명 그대로다 (변환하지 않는다).
 * `main_point` 는 **자동 채점하지 않는다** — 자유 서술이라 사람 몫이고, 화면에만 쓴다.
 */
export interface GoldenLabel {
  child_intent: string
  detected_elements: readonly string[]
  utterance_validity: string
  main_point: string | null
}

/**
 * 골든셋 한 줄 (파이썬 `골든항목`).
 *
 * 맥락 필드 이름은 `prompts/analysis.md:19-25` 「받는 것」과 **글자 그대로** 같다.
 * 그래야 골든셋 한 줄이 곧 분석 프롬프트 입력이 되어, 옮겨 담다 어긋나는 일이 없다.
 */
export interface GoldenItem {
  id: string
  /** `'초안'` 또는 `'검수완료'`. */
  검수: string
  scene_order: number
  장면_이름: string
  previous_character_message: string
  child_utterance: string
  target_elements: readonly string[]
  정답: GoldenLabel
  scene_description: string | null
  conflict: string | null
  메모: string
  utterance_source: string | null
  /**
   * 장면별 요소 판정 기준 (`story_scenes.element_criteria`).
   *
   * ⚠️ 기본은 **안 보낸다.** 엔진은 DB 에서 꺼내 보내지만 골든셋은 2026-08-12 까지
   *    안 보내고 있었고, 그 조건으로 기준선을 재 왔다. 서비스의 `기준_포함` 이 켜야 나간다.
   */
  element_criteria: Readonly<Record<string, string>>
}

/** 사람이 검수를 끝낸 항목인가 (파이썬 `골든항목.검수완료`). */
export function isReviewed(항목: { 검수: string }): boolean {
  return 항목.검수 === '검수완료'
}

/**
 * 검수 끝난 것만 (파이썬 `검수완료만()` · CLI `--검수완료만`).
 *
 * 🔴 **이걸 빠뜨리면 73건이 통째로 돈다.** 30건이 아니라 73건이라 호출이 2.4배 나가고,
 *    무엇보다 **옛 기준으로 매긴 초안 43건이 점수에 섞인다** — 프롬프트가 나쁜 건지
 *    정답지가 낡은 건지 구분이 안 된다 (`goldenset/README.md` 머리말).
 */
export function reviewedOnly<T extends { 검수: string }>(항목들: readonly T[]): T[] {
  return 항목들.filter(isReviewed)
}

// ═══════════════════════════════════════════════════════════════════════════
// 읽기 — 사람이 손으로 고치는 파일이라 오류에 줄번호를 반드시 붙인다
// ═══════════════════════════════════════════════════════════════════════════

type 자료 = Record<string, unknown>

/** 파이썬 `_요구()`. **칸이 있기만 하면 통과다** — 값이 `null` 인 것은 여기서 안 잡는다. */
function 요구(자료: 자료, 열쇠: string, 위치: string): unknown {
  if (!(열쇠 in 자료)) throw new GoldensetError(`${위치} — '${열쇠}' 가 없다`)
  return 자료[열쇠]
}

/** 파이썬 `_목록으로()`. 배열인가 · 목록 밖 값은 없나 · 같은 값이 두 번 있나. */
function 목록으로(
  값: unknown,
   열쇠: string,
   위치: string,
   허용: ReadonlySet<string>,
): string[] {
  if (!Array.isArray(값)) {
    throw new GoldensetError(`${위치} — '${열쇠}' 는 배열이어야 한다`)
  }
  const 벗어난_것 = 값.filter((항) => typeof 항 !== 'string' || !허용.has(항))
  if (벗어난_것.length > 0) {
    throw new GoldensetError(`${위치} — '${열쇠}' 에 목록 밖 값: ${JSON.stringify(벗어난_것)}`)
  }
  if (new Set(값).size !== 값.length) {
    throw new GoldensetError(
      `${위치} — '${열쇠}' 에 같은 값이 두 번 있다: ${JSON.stringify(값)}`,
    )
  }
  return 값 as string[]
}

function 글자(값: unknown, 기본값 = ''): string {
  return typeof 값 === 'string' ? 값 : 기본값
}

/** 파이썬 `_항목_만들기()`. */
function 항목_만들기(자료: 자료, 위치: string): GoldenItem {
  const 검수 = 요구(자료, '검수', 위치)
  if (typeof 검수 !== 'string' || !(검수_값 as readonly string[]).includes(검수)) {
    throw new GoldensetError(
      `${위치} — '검수' 는 ${JSON.stringify([...검수_값])} 중 하나여야 한다 (받은 값: ${JSON.stringify(검수)})`,
    )
  }

  const 정답_자료 = 요구(자료, '정답', 위치)
  if (typeof 정답_자료 !== 'object' || 정답_자료 === null || Array.isArray(정답_자료)) {
    throw new GoldensetError(`${위치} — '정답' 은 객체여야 한다`)
  }
  const 정답 = 정답_자료 as 자료

  const 의도 = 요구(정답, 'child_intent', 위치)
  if (typeof 의도 !== 'string' || !CHILD_INTENT_값.has(의도)) {
    throw new GoldensetError(`${위치} — child_intent 가 13개 목록 밖이다: ${JSON.stringify(의도)}`)
  }

  const 유효성 = 요구(정답, 'utterance_validity', 위치)
  if (typeof 유효성 !== 'string' || !VALIDITY_값.has(유효성)) {
    throw new GoldensetError(
      `${위치} — utterance_validity 가 5개 목록 밖이다: ${JSON.stringify(유효성)}`,
    )
  }

  const 기준 = 자료.element_criteria
  const main_point = 정답.main_point

  return {
    id: 글자(요구(자료, 'id', 위치)),
    검수,
    // 파이썬 `int(...)`. 정수가 아니면 여기서 터진다 — 조용히 NaN 을 들고 가지 않는다.
    scene_order: 정수(요구(자료, 'scene_order', 위치), 'scene_order', 위치),
    장면_이름: 글자(자료.장면_이름),
    previous_character_message: 글자(요구(자료, 'previous_character_message', 위치)),
    child_utterance: 글자(요구(자료, 'child_utterance', 위치)),
    target_elements: 목록으로(
      요구(자료, 'target_elements', 위치),
      'target_elements',
      위치,
      ELEMENT_값,
    ),
    정답: {
      child_intent: 의도,
      detected_elements: 목록으로(
        요구(정답, 'detected_elements', 위치),
        'detected_elements',
        위치,
        ELEMENT_값,
      ),
      utterance_validity: 유효성,
      main_point: typeof main_point === 'string' ? main_point : null,
    },
    scene_description: typeof 자료.scene_description === 'string' ? 자료.scene_description : null,
    conflict: typeof 자료.conflict === 'string' ? 자료.conflict : null,
    메모: 글자(자료.메모),
    utterance_source: typeof 자료.utterance_source === 'string' ? 자료.utterance_source : null,
    element_criteria:
      typeof 기준 === 'object' && 기준 !== null && !Array.isArray(기준)
        ? { ...(기준 as Record<string, string>) }
        : {},
  }
}

function 정수(값: unknown, 이름: string, 위치: string): number {
  const 수 = typeof 값 === 'number' ? 값 : Number(값)
  if (!Number.isInteger(수)) {
    throw new GoldensetError(`${위치} — '${이름}' 은 정수여야 한다 (받은 값: ${JSON.stringify(값)})`)
  }
  return 수
}

/**
 * JSONL 글자를 항목들로 (파이썬 `읽기()`).
 *
 * `출처` 는 오류 메시지 앞에 붙는 이름이다 — 어느 파일 몇 번째 줄이 깨졌는지가
 * 안 보이면 73줄짜리 파일에서 사람이 못 고친다.
 *
 * - 빈 줄과 `//` 로 시작하는 줄은 건너뛴다 (정답지 머리말이 그 모양이다)
 * - 줄 번호는 **건너뛴 줄까지 세는 원래 줄 번호**다
 * - `id` 가 겹치면 앞 줄 번호와 함께 터뜨린다
 */
export function parseGoldenset(원문: string, 출처: string): GoldenItem[] {
  const 항목들: GoldenItem[] = []
  const 본_id = new Map<string, number>()

  const 줄들 = 원문.split('\n')
  // 파이썬 `splitlines()` 는 끝의 개행 뒤 빈 줄을 만들지 않는다. 여기서도 맞춘다.
  if (줄들.length > 0 && 줄들[줄들.length - 1] === '') 줄들.pop()

  줄들.forEach((원문줄, 자리) => {
    const 줄번호 = 자리 + 1
    const 줄 = 원문줄.trim()
    if (줄 === '' || 줄.startsWith('//')) return
    const 위치 = `${출처}:${줄번호}`

    let 읽은것: unknown
    try {
      읽은것 = JSON.parse(줄)
    } catch (오류) {
      const 사유 = 오류 instanceof Error ? 오류.message : String(오류)
      throw new GoldensetError(`${위치} — JSON 이 깨졌다: ${사유}`)
    }
    if (typeof 읽은것 !== 'object' || 읽은것 === null || Array.isArray(읽은것)) {
      throw new GoldensetError(`${위치} — 한 줄은 객체 하나여야 한다`)
    }

    const 항목 = 항목_만들기(읽은것 as 자료, 위치)
    const 앞선_줄 = 본_id.get(항목.id)
    if (앞선_줄 !== undefined) {
      throw new GoldensetError(`${위치} — id 가 ${앞선_줄}번 줄과 겹친다: ${JSON.stringify(항목.id)}`)
    }
    본_id.set(항목.id, 줄번호)
    항목들.push(항목)
  })

  return 항목들
}

// ═══════════════════════════════════════════════════════════════════════════
// 채점
// ═══════════════════════════════════════════════════════════════════════════

/** 항목 하나의 채점 결과 (파이썬 `항목채점`). */
export interface ItemScore {
  id: string
  검수: string
  child_intent_맞음: boolean
  utterance_validity_맞음: boolean
  맞힌_요소: readonly string[]
  /** 정답엔 있는데 못 낸 것 */
  놓친_요소: readonly string[]
  /** 냈는데 정답엔 없는 것 */
  지어낸_요소: readonly string[]
}

/** 판 하나의 점수표 (파이썬 `채점표`). */
export interface ScoreTable {
  건수: number
  초안_건수: number
  child_intent_정확도: number
  utterance_validity_정확도: number
  요소_정밀도: number
  요소_재현율: number
  요소_F1: number
  항목별: readonly ItemScore[]
}

/**
 * `score()` 가 항목에서 실제로 보는 것. **이것뿐이다.**
 *
 * `GoldenItem` 이 그대로 들어맞고, DB 에 저장된 `goldenset_results` 한 행도
 * 이 모양으로 세우면 들어맞는다 — 그래서 돌린 직후든 나중에 다시 읽든 **같은 채점기**를 지난다.
 */
export interface ScoreItem {
  id: string
  검수: string
  정답: {
    child_intent: string
    detected_elements: readonly string[]
    utterance_validity: string
  }
}

/** 채점할 짝 하나 — (정답지 항목, 분석기가 낸 라벨). */
export interface ScorePair {
  항목: ScoreItem
  라벨: {
    child_intent: string
    detected_elements: readonly string[]
    utterance_validity: string
  }
}

/** 파이썬 `_나눗셈()`. 분모가 0 이면 0.0 — 낼 것도 맞힐 것도 없는 상태를 만점으로 쳐 주지 않는다. */
function 나눗셈(분자: number, 분모: number): number {
  return 분모 === 0 ? 0 : 분자 / 분모
}

/**
 * 짝들을 받아 점수를 낸다 (파이썬 `채점()`).
 *
 * 요소 점수는 **micro 평균**이다 — 항목별 비율을 평균하지 않고 전체 맞힘/전체 예측으로 나눈다.
 * 항목마다 요소 개수가 달라서, 요소 1개짜리 항목이 4개짜리와 같은 무게를 갖지 않게 한다.
 *
 * ⚠️ **분모는 집합의 크기다.** 같은 요소가 두 번 온 라벨이 있어도 한 번으로 센다
 *    (파이썬이 `set()` 으로 받아 `len()` 을 세던 자리다). 여기서 어긋나면 정밀도가 조용히 낮아진다.
 */
export function score(쌍들: readonly ScorePair[]): ScoreTable {
  const 항목별: ItemScore[] = []
  let 의도_맞음 = 0
  let 유효성_맞음 = 0
  let 맞힘_합 = 0
  let 예측_합 = 0
  let 정답_합 = 0

  for (const { 항목, 라벨 } of 쌍들) {
    const 정답_요소 = new Set(항목.정답.detected_elements)
    const 받은_요소 = new Set(라벨.detected_elements)
    const 맞힘 = new Set([...정답_요소].filter((요소) => 받은_요소.has(요소)))

    const 의도가_맞나 = 항목.정답.child_intent === 라벨.child_intent
    const 유효성이_맞나 = 항목.정답.utterance_validity === 라벨.utterance_validity

    if (의도가_맞나) 의도_맞음 += 1
    if (유효성이_맞나) 유효성_맞음 += 1
    맞힘_합 += 맞힘.size
    예측_합 += 받은_요소.size
    정답_합 += 정답_요소.size

    항목별.push({
      id: 항목.id,
      검수: 항목.검수,
      child_intent_맞음: 의도가_맞나,
      utterance_validity_맞음: 유효성이_맞나,
      // 로그로 눈으로 볼 것이라 순서를 흔들지 않는다 — 정답지에 적힌 차례 그대로다.
      맞힌_요소: 항목.정답.detected_elements.filter((요소) => 맞힘.has(요소)),
      놓친_요소: 항목.정답.detected_elements.filter((요소) => !받은_요소.has(요소)),
      지어낸_요소: 라벨.detected_elements.filter((요소) => !정답_요소.has(요소)),
    })
  }

  const 건수 = 항목별.length
  const 정밀도 = 나눗셈(맞힘_합, 예측_합)
  const 재현율 = 나눗셈(맞힘_합, 정답_합)
  // F1 = 정밀도와 재현율의 조화평균. 한쪽만 높은 것을 봐주지 않는다.
  const F1 = 정밀도 + 재현율 === 0 ? 0 : (2 * 정밀도 * 재현율) / (정밀도 + 재현율)

  return {
    건수,
    초안_건수: 쌍들.filter(({ 항목 }) => !isReviewed(항목)).length,
    child_intent_정확도: 나눗셈(의도_맞음, 건수),
    utterance_validity_정확도: 나눗셈(유효성_맞음, 건수),
    요소_정밀도: 정밀도,
    요소_재현율: 재현율,
    요소_F1: F1,
    항목별,
  }
}

/**
 * 이 숫자를 품질 판단에 써도 되나 (파이썬 `채점표.믿을_수_있나`).
 *
 * 초안이 하나라도 섞였으면 **정답지가 아니라 우리 초안을 잰 것**이다.
 */
export function trustworthy(표: Pick<ScoreTable, '건수' | '초안_건수'>): boolean {
  return 표.건수 > 0 && 표.초안_건수 === 0
}

/**
 * 네 칸이 전부 맞아야 「맞음」이다 (파이썬 `채점.항목결과.맞음`).
 *
 * `goldenset.main()` 이 「틀린 항목」 표에서 거르는 조건과 **글자 그대로 같다**
 * (`goldenset.py:727-733`). 화면과 터미널이 다른 잣대를 쓰면 안 된다.
 */
export function isCorrect(채점: ItemScore | null | undefined): boolean {
  return Boolean(
    채점 &&
      채점.child_intent_맞음 &&
      채점.utterance_validity_맞음 &&
      채점.놓친_요소.length === 0 &&
      채점.지어낸_요소.length === 0,
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 응답 읽기 — ⛔ 여기서 검증하지 않는다
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 프롬프트가 ``` 를 붙이지 말라고 했지만 fallback 공급자가 붙일 때가 있다
 * (파이썬 `_코드블록_벗기기()`).
 */
function 코드블록_벗기기(원문: string): string {
  const 벗김 = 원문.trim()
  if (!벗김.startsWith('```')) return 벗김
  const 줄들 = 벗김.split('\n').slice(1)
  if (줄들.length > 0 && 줄들[줄들.length - 1].trim().startsWith('```')) 줄들.pop()
  return 줄들.join('\n').trim()
}

/**
 * 분석 LLM 응답(JSON)을 채점할 수 있는 라벨로 바꾼다 (파이썬 `응답을_라벨로()`).
 *
 * 🔴 **받은 값을 검증하지 않는다.** 목록 밖 값을 냈다는 것 자체가 측정 대상이라,
 *    여기서 막으면 그 사실이 사라진다. 채점에서 「지어낸 요소」로 잡힌다.
 *    그래서 `lib/engine/analyze.ts` 의 `parseResponse()`(zod `strictObject`)를 쓰지 않는다 —
 *    저쪽은 **경계 1 을 지키는 자리**이고 여기는 **재는 자리**다. 섞으면
 *    「틀림」이 예외가 되어 「판정 불가」로 바뀌고, 분석 LLM 이 틀릴수록 점수가 오른다 (결정 29).
 *
 * ⚠️ **파이썬과 한 자리가 갈린다.** 파이썬은 칸이 `null` 이면 `None` 을 그대로 들고 가
 *    `goldenset_results.got_child_intent` 에 `NULL` 을 넣으려다 CHECK 에 걸렸다
 *    (판정 불가가 아닌데 판정 불가 모양이 된다). 여기서는 **빈 글자**로 굳힌다 —
 *    정답과 안 맞으니 「틀림」으로 세어지고, 그것이 실제로 일어난 일이다.
 */
export function responseToLabel(원문: string): GoldenLabel {
  const 자료 = JSON.parse(코드블록_벗기기(원문)) as 자료

  const 요소: string[] = []
  const 받은_요소들 = Array.isArray(자료.detected_elements) ? 자료.detected_elements : []
  for (const 항 of 받은_요소들) {
    const 값 = typeof 항 === 'object' && 항 !== null ? (항 as 자료).type : 항
    // 같은 type 은 한 번만 (`prompts/analysis.md:109`)
    if (값 !== null && 값 !== undefined && !요소.includes(String(값))) 요소.push(String(값))
  }

  const main_point = 자료.main_point

  return {
    child_intent: 글자(자료.child_intent),
    detected_elements: 요소,
    utterance_validity: 글자(자료.utterance_validity),
    main_point: typeof main_point === 'string' ? main_point : null,
  }
}
