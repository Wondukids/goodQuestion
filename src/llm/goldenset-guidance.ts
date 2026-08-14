// 유도 골든셋 — **캐릭터가 과녁을 향해 유도하는가**를 재는 정답지 (이슈 #26 · #22).
//
// 파이썬 `src/goodquestion/goldenset_유도.py` 의 **읽는 쪽과 대조하는 쪽만** 옮긴 것이다.
//
// | 파이썬 | 여기 |
// |---|---|
// | `항목오류` | `GuidanceGoldensetError` |
// | `과녁_값` · `답누출_값` | `과녁_값` · `답누출_값` |
// | `사람판정` (dataclass) | `HumanVerdict` |
// | `사람판정.과녁_점수` · `.답누출_점수` | `targetScore()` · `giveawayScore()` |
// | `판정대기` (dataclass) | `PendingVerdict` |
// | `유도항목` (dataclass) | `GuidanceItem` |
// | `유도항목.검수완료인가` | `isGuidanceReviewed()` |
// | `유도항목.안_매긴_대사들` | `unjudgedLines()` |
// | `유도항목.remaining_worry` · `.child_utterance` · `.response_mode` | `remainingWorry()` · `childUtterance()` · `responseMode()` |
// | `_요구()` | `요구()` (안 내보낸다) |
// | `항목_만들기()` | `makeGuidanceItem()` |
// | `읽기()` | `parseGuidanceGoldenset()` |
// | `대조` (dataclass) · `.정확도` | `Agreement` · `accuracy()` |
// | `대조_내기()` | `judgeAgreement()` |
//
// ⛔ **여기 없는 것들 — 다 옮겼고, 층이 달라서 다른 파일에 있다.**
//    | 파이썬 | 어디로 |
//    |---|---|
//    | `채점재료`·`두_심판`·`깔때기인가` | `lib/service/goldenset-guidance.ts` (LLM 을 탄다) |
//    | `항목_뽑기`·`대사_적기`·`사람판정_적기`·`고쳐쓰기`·`붙여쓰기`·프롬프트 짓기 | `tools/유도셋-기록.ts` |
//    | `판_돌리기`·`재심_돌리기`·`_다수결` | `tools/유도셋-판.ts` |
//    | CLI `main()` | `tools/유도셋.ts` |
//
// ## ⛔ 이 파일은 DB 도 화면도 LLM 도 모른다
//
// `lib/scoring.ts` 와 같은 규약이다 — import 가 하나도 없고 **파일조차 읽지 않는다.**
// `parseGuidanceGoldenset()` 은 경로가 아니라 **글자**를 받는다. 그래야 파이썬과 같은
// 입력을 넣어 같은 값이 나오는지 기계로 대조할 수 있다. 파일을 읽는 일은 서비스 층이 한다.
//
// ## ⛔ 채점 재료는 캐릭터에게 안 간다
//
// `채점` 블록(`guidance_target`·`element_criterion`)은 **캐릭터 LLM 이 절대 못 본다.**
// 규칙 층은 요소 **이름**을 고르고 걱정 문장 한 줄만 넘긴다(기준 문서 13절). 여기서
// 그 선을 넘으면 **엔진보다 쉬운 문제를 풀리고 재는 것**이 된다. 이 파일은 그 두 칸을
// `GuidanceItem` 에 담기만 하고, 프롬프트를 짓는 자리가 `재료` 만 쓰는 것으로 선을 지킨다.
//
// ## 본 골든셋과 **스키마가 다르다**
//
// `lib/scoring.ts` 의 `parseGoldenset()` 으로는 못 읽는다. 겹치는 칸이 `id`·`검수` 뿐이고
// 나머지는 전부 다르다 — 저쪽은 **분석 LLM 의 라벨**을 재고 이쪽은 **캐릭터 LLM 의 유도**를 잰다.
// 그래서 전용 파서다.

/** 사람이 매길 수 있는 값. 셋째 칸이 있는 것이 일부러다 — 선에 걸친 대사를 억지로
 *  한쪽에 밀어 넣으면 그 판정이 나중에 분쟁거리가 된다 (2026-08-12 사람 결정). */
export const 과녁_값 = ['성공', '실패', '애매'] as const
export const 답누출_값 = ['지킴', '위반', '애매'] as const

/** 심판이 쓰는 말. 사람 쪽과 낱말이 다르다 (`judgeAgreement()` 의 `같은_뜻` 참고). */
export const 심판_과녁_값 = ['적중', '빗나감', '판정불가'] as const
export const 심판_답누출_값 = ['지킴', '위반', '판정불가'] as const

/** 사람 판정 → 점수. `애매` 는 `null` 이다 — 통과가 아니라 **판정하지 않았다**는 뜻이고
 *  평균에서 빠진다 (결정 29). 파이썬 `_과녁_점수`. */
const 과녁_점수표: Readonly<Record<string, number | null>> = { 성공: 1, 실패: 0, 애매: null }
/** 파이썬 `_답누출_점수`. */
const 답누출_점수표: Readonly<Record<string, number | null>> = { 지킴: 1, 위반: 0, 애매: null }

/** 정답지 한 줄이 형식에 안 맞다 (파이썬 `항목오류`). 메시지 앞에 항상 `출처:줄번호` 가 붙는다. */
export class GuidanceGoldensetError extends Error {
  constructor(메시지: string) {
    super(메시지)
    this.name = 'GuidanceGoldensetError'
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 형식
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 대사 한 줄에 사람이 매긴 판정 (파이썬 `사람판정`).
 *
 * 항목이 아니라 **대사**에 붙는다. 같은 항목을 여러 번 돌리면 매번 다른 대사가 나오므로
 * 한 항목에 여러 개가 쌓인다. 이 더미가 곧 **심판을 재는 정답지**다.
 */
export interface HumanVerdict {
  대사: string
  /** `과녁_값` 중 하나. 목록 밖이면 읽는 자리에서 터진다. */
  과녁: string
  /** `답누출_값` 중 하나. */
  답누출: string
  근거: string
  매긴날: string
}

/**
 * 판을 돌려 나온 대사. **아직 사람이 안 본 것**이다 (파이썬 `판정대기`).
 *
 * 심판이 뭐라 했는지도 같이 적어 둔다 — 나중에 다시 돌리면 LLM 이라 답이 달라져
 * **그 대사에 대한 그때 판정**을 되살릴 수 없기 때문이다.
 *
 * ⛔ **인터뷰에서 사람에게 보여주지 않는다.** 심판 답을 먼저 보면 사람 판정이 끌려간다.
 */
export interface PendingVerdict {
  대사: string
  /** 적중 / 빗나감 / 판정불가 */
  심판_과녁: string
  /** 지킴 / 위반 / 판정불가 */
  심판_답누출: string
  돌린날: string
  /** 이 대사를 낸 **캐릭터 프롬프트**의 지문. */
  프롬프트_지문: string
  /** 심판 프롬프트를 고쳐 **같은 대사를 다시 판정한** 기록. 새 판정이 위 칸을 덮고
   *  옛 판정이 이리로 내려온다. 심판을 고친 효과는 이 줄들의 차이다. */
  옛심판: readonly string[]
  /** 위 판정을 낸 **과녁 심판 프롬프트**의 지문 (`프롬프트_지문` 은 캐릭터 쪽이다). */
  심판_지문: string
  /** 반복해 판정했을 때 각 답이 몇 번 나왔나 (`과녁 적중×4 빗나감×1 · …`).
   *  위 두 칸은 그 다수결이다. **표가 갈리면 그 판정을 세게 읽지 말 것.** */
  심판_표: string
}

/**
 * 정답지 한 줄 (파이썬 `유도항목`). 캐릭터 LLM 입력 한 벌 + 채점 재료 + 사람 판정.
 *
 * `재료` 는 `runner.캐릭터_재료()` 가 만드는 6묶음 **그대로**이고 키 이름도 그대로다 —
 * 그래야 골든셋 한 줄이 곧 캐릭터 프롬프트 입력이 되어, 옮겨 담다 어긋나지 않는다.
 * 그래서 여기서 속을 뜯어 타입을 세우지 않는다. 묶음이 있는지만 보고 통째로 들고 간다.
 */
export interface GuidanceItem {
  id: string
  /** `'초안'` 또는 `'검수완료'`. ⚠️ 본 골든셋과 달리 **읽는 자리에서 검사하지 않는다** —
   *  파이썬이 `자료.get("검수", "초안")` 로 받기만 한다. 이식은 지금 모양 그대로다. */
  검수: string
  scene_order: number
  장면_이름: string
  재료: Readonly<Record<string, unknown>>
  /** ⛔ 캐릭터에게 안 간다. 파일에서는 `채점` 블록 안에 있다. */
  guidance_target: string
  /** ⛔ 캐릭터에게 안 간다. 그 요소가 무엇으로 쳐지는지의 기준 문장. */
  element_criterion: string
  사람판정들: readonly HumanVerdict[]
  대기들: readonly PendingVerdict[]
  메모: string
}

/** 파이썬 `사람판정.과녁_점수`. `애매` 는 `null` — 분모에서 빠진다. */
export function targetScore(판정: Pick<HumanVerdict, '과녁'>): number | null {
  return 과녁_점수표[판정.과녁] ?? null
}

/** 파이썬 `사람판정.답누출_점수`. */
export function giveawayScore(판정: Pick<HumanVerdict, '답누출'>): number | null {
  return 답누출_점수표[판정.답누출] ?? null
}

/** 파이썬 `유도항목.검수완료인가`. (`lib/scoring.ts` 의 `isReviewed()` 와 같은 뜻이지만
 *  이 파일은 아무것도 import 하지 않는 것이 규칙이라 따로 둔다.) */
export function isGuidanceReviewed(항목: Pick<GuidanceItem, '검수'>): boolean {
  return 항목.검수 === '검수완료'
}

/** 사람이 아직 판정 안 한 대사 (파이썬 `유도항목.안_매긴_대사들`). 인터뷰가 물을 것들이다. */
export function unjudgedLines(항목: Pick<GuidanceItem, '사람판정들' | '대기들'>): string[] {
  const 매긴 = new Set(항목.사람판정들.map((판정) => 판정.대사))
  return 항목.대기들.filter((대기) => !매긴.has(대기.대사)).map((대기) => 대기.대사)
}

/** 파이썬 `유도항목.remaining_worry`. 캐릭터가 실제로 받은 걱정 한 줄이다. */
export function remainingWorry(항목: Pick<GuidanceItem, '재료'>): string {
  return 묶음_글자(항목.재료, 'direction', 'remaining_worry')
}

/** 파이썬 `유도항목.child_utterance`. */
export function childUtterance(항목: Pick<GuidanceItem, '재료'>): string {
  return 묶음_글자(항목.재료, 'latest', 'child_utterance')
}

/** 파이썬 `유도항목.response_mode`. */
export function responseMode(항목: Pick<GuidanceItem, '재료'>): string {
  return 묶음_글자(항목.재료, 'direction', 'response_mode')
}

/** 파이썬의 `(재료.get(묶음) or {}).get(열쇠, "")` 와 같은 자리. 없으면 빈 글자다. */
function 묶음_글자(재료: Readonly<Record<string, unknown>>, 묶음: string, 열쇠: string): string {
  const 속 = 재료[묶음]
  if (typeof 속 !== 'object' || 속 === null || Array.isArray(속)) return ''
  return 글자((속 as Record<string, unknown>)[열쇠])
}

// ═══════════════════════════════════════════════════════════════════════════
// 읽기 — 사람이 손으로 고치는 파일이라 오류에 줄번호를 반드시 붙인다
// ═══════════════════════════════════════════════════════════════════════════

type 자료 = Record<string, unknown>

/** 캐릭터 LLM 이 받는 묶음. 파이썬 `_필수_묶음`. 하나라도 빠지면 읽는 자리에서 터진다. */
const 필수_묶음 = ['character', 'story_so_far', 'scene', 'said_so_far', 'latest', 'direction']

/** 파이썬 `_요구()`. **칸이 있기만 하면 통과다** — 값이 `null` 인 것은 여기서 안 잡는다. */
function 요구(자료: 자료, 열쇠: string, 위치: string): unknown {
  if (!(열쇠 in 자료)) throw new GuidanceGoldensetError(`${위치} — '${열쇠}' 이 없다`)
  return 자료[열쇠]
}

/**
 * ⚠️ **파이썬 `str()` 과 한 자리가 갈린다.** 파이썬은 `str(None)` 이 `"None"` 이라
 *    칸이 `null` 이면 그 네 글자가 대사로 들어간다. 여기서는 **빈 글자**로 굳힌다
 *    (`lib/scoring.ts` 의 `글자()` 와 같은 판단이다).
 */
function 글자(값: unknown, 기본값 = ''): string {
  return typeof 값 === 'string' ? 값 : 기본값
}

/** 파이썬 `int(...)`. 정수가 아니면 여기서 터진다 — 조용히 `NaN` 을 들고 가지 않는다. */
function 정수(값: unknown, 이름: string, 위치: string): number {
  const 수 = typeof 값 === 'number' ? 값 : Number(값)
  if (!Number.isInteger(수)) {
    throw new GuidanceGoldensetError(
      `${위치} — '${이름}' 은 정수여야 한다 (받은 값: ${JSON.stringify(값)})`,
    )
  }
  return 수
}

function 객체(값: unknown): 자료 | null {
  return typeof 값 === 'object' && 값 !== null && !Array.isArray(값) ? (값 as 자료) : null
}

/** 파이썬의 `for … in 자료.get(이름) or ()`. 배열이 아니면 빈 목록이다. */
function 목록(값: unknown): unknown[] {
  return Array.isArray(값) ? 값 : []
}

/** 정답지 한 줄(파싱된 JSON)을 항목으로 (파이썬 `항목_만들기()`). */
export function makeGuidanceItem(자료: 자료, 위치 = ''): GuidanceItem {
  const 재료_자료 = 요구(자료, '재료', 위치)
  const 재료 = 객체(재료_자료)
  if (재료 === null) throw new GuidanceGoldensetError(`${위치} — '재료' 는 객체여야 한다`)

  const 빠진 = 필수_묶음.filter((이름) => !(이름 in 재료))
  if (빠진.length > 0) {
    throw new GuidanceGoldensetError(
      `${위치} — 재료에 ${JSON.stringify(빠진)} 이 없다 (캐릭터_재료() 묶음과 같아야 한다)`,
    )
  }

  const 채점_자료 = 요구(자료, '채점', 위치)
  const 채점 = 객체(채점_자료)
  if (채점 === null) throw new GuidanceGoldensetError(`${위치} — '채점' 은 객체여야 한다`)
  const 대상 = 요구(채점, 'guidance_target', `${위치} 채점`)
  const 기준 = 요구(채점, 'element_criterion', `${위치} 채점`)

  const 판정들: HumanVerdict[] = []
  목록(자료.사람판정).forEach((값, 자리) => {
    const 번호 = 자리 + 1
    const 판정 = 객체(값)
    if (판정 === null) {
      throw new GuidanceGoldensetError(`${위치} 사람판정 ${번호} — 객체여야 한다`)
    }
    const 과녁 = 판정.과녁
    const 누출 = 판정.답누출
    // 오타를 조용히 통과시키면 그 줄이 어느 쪽으로 세어졌는지 나중에 못 찾는다.
    if (typeof 과녁 !== 'string' || !(과녁_값 as readonly string[]).includes(과녁)) {
      throw new GuidanceGoldensetError(
        `${위치} 사람판정 ${번호} — 과녁 값이 ${JSON.stringify([...과녁_값])} 밖이다 (${JSON.stringify(과녁)})`,
      )
    }
    if (typeof 누출 !== 'string' || !(답누출_값 as readonly string[]).includes(누출)) {
      throw new GuidanceGoldensetError(
        `${위치} 사람판정 ${번호} — 답누출 값이 ${JSON.stringify([...답누출_값])} 밖이다 (${JSON.stringify(누출)})`,
      )
    }
    판정들.push({
      대사: 글자(판정.대사),
      과녁,
      답누출: 누출,
      근거: 글자(판정.근거),
      매긴날: 글자(판정.매긴날),
    })
  })

  const 대기들: PendingVerdict[] = 목록(자료.판정대기).map((값) => {
    const 대기 = 객체(값) ?? {}
    return {
      대사: 글자(대기.대사),
      심판_과녁: 글자(대기.심판_과녁),
      심판_답누출: 글자(대기.심판_답누출),
      돌린날: 글자(대기.돌린날),
      프롬프트_지문: 글자(대기.프롬프트_지문),
      옛심판: 목록(대기.옛심판).map((줄) => 글자(줄)),
      심판_지문: 글자(대기.심판_지문),
      심판_표: 글자(대기.심판_표),
    }
  })

  return {
    id: 글자(요구(자료, 'id', 위치)),
    검수: 글자(자료.검수, '초안'),
    scene_order: 정수(요구(자료, 'scene_order', 위치), 'scene_order', 위치),
    장면_이름: 글자(자료.장면_이름),
    재료,
    guidance_target: 글자(대상),
    element_criterion: 글자(기준),
    사람판정들: 판정들,
    대기들,
    메모: 글자(자료.메모),
  }
}

/**
 * JSONL 글자를 항목들로 (파이썬 `읽기()`).
 *
 * `출처` 는 오류 메시지 앞에 붙는 이름이다 — 어느 파일 몇 번째 줄이 깨졌는지가
 * 안 보이면 사람이 못 고친다.
 *
 * - 빈 줄과 `//` 로 시작하는 줄은 건너뛴다 (정답지 머리말이 그 모양이다)
 * - 줄 번호는 **건너뛴 줄까지 세는 원래 줄 번호**다
 * - ⚠️ `id` 가 겹치는지는 **여기서 안 본다** — 파이썬도 안 본다. 검사가 그 그물이다
 *   (`tests/goldenset-guidance.test.ts`).
 */
export function parseGuidanceGoldenset(
  원문: string,
  출처: string,
  { 검수완료만 = false }: { 검수완료만?: boolean } = {},
): GuidanceItem[] {
  const 항목들: GuidanceItem[] = []

  const 줄들 = 원문.split('\n')
  // 파이썬 `splitlines()` 는 끝의 개행 뒤 빈 줄을 만들지 않는다. 여기서도 맞춘다.
  if (줄들.length > 0 && 줄들[줄들.length - 1] === '') 줄들.pop()

  줄들.forEach((원문줄, 자리) => {
    const 줄 = 원문줄.trim()
    if (줄 === '' || 줄.startsWith('//')) return
    const 위치 = `${출처}:${자리 + 1}`

    let 읽은것: unknown
    try {
      읽은것 = JSON.parse(줄)
    } catch (오류) {
      const 사유 = 오류 instanceof Error ? 오류.message : String(오류)
      throw new GuidanceGoldensetError(`${위치} — JSON 이 아니다: ${사유}`)
    }
    const 자료 = 객체(읽은것)
    if (자료 === null) throw new GuidanceGoldensetError(`${위치} — 한 줄은 객체 하나여야 한다`)

    항목들.push(makeGuidanceItem(자료, 위치))
  })

  return 검수완료만 ? 항목들.filter(isGuidanceReviewed) : 항목들
}

// ═══════════════════════════════════════════════════════════════════════════
// 사람 판정과 심판의 대조
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 사람이 매긴 것과 심판이 매긴 것이 몇 개나 같았나 (파이썬 `대조`).
 *
 * ⚠️ 이것은 **심판을 재는 숫자**다. 캐릭터를 재는 숫자가 아니다. 섞지 말 것.
 */
export interface Agreement {
  맞음: number
  틀림: number
  /** 사람이 「애매」로 뒀거나 심판이 판정을 못 한 것. 분모에서 뺀다. */
  못셈: number
  어긋난것: readonly string[]
}

/** 파이썬 `대조.정확도`. 분모가 0 이면 `null` — 0% 가 아니다. */
export function accuracy(대조: Pick<Agreement, '맞음' | '틀림'>): number | null {
  const 분모 = 대조.맞음 + 대조.틀림
  return 분모 === 0 ? null : 대조.맞음 / 분모
}

/** 대조할 축. 파이썬 `대조_내기(축=…)`. */
export type AgreementAxis = '과녁' | '답누출'

/**
 * 사람이 쓰는 말 ↔ 심판이 쓰는 말 (파이썬 `_같은_뜻`).
 *
 * 축마다 낱말이 달라서 표로 둔다 — 과녁 심판만 「위반」이 「빗나갔다」는 뜻이라
 * 낱말을 갈라 놨다.
 */
const 같은_뜻: Readonly<Record<AgreementAxis, ReadonlySet<string>>> = {
  과녁: new Set(['성공→적중', '실패→빗나감']),
  답누출: new Set(['지킴→지킴', '위반→위반']),
}

/**
 * 사람 판정과 심판 판정이 몇 개나 같았나 (파이썬 `대조_내기()`). **심판을 재는 숫자다.**
 *
 * 캐릭터를 재는 숫자와 섞지 말 것. 이 정확도가 낮으면 판 합계를 아예 못 믿는 것이고,
 * 높아야 비로소 캐릭터 이야기를 할 수 있다.
 *
 * 사람이 「애매」로 뒀거나 심판이 「판정불가」를 낸 것은 **분모에서 뺀다** —
 * 둘 다 「모르겠다」이지 「틀렸다」가 아니다 (결정 29).
 */
export function judgeAgreement(
  항목들: readonly GuidanceItem[],
  { 축 = '과녁' }: { 축?: AgreementAxis } = {},
): Agreement {
  const 같음 = 같은_뜻[축]
  let 맞음 = 0
  let 틀림 = 0
  let 못셈 = 0
  const 어긋난것: string[] = []

  for (const 항목 of 항목들) {
    const 심판_by_대사 = new Map(항목.대기들.map((대기) => [대기.대사, 대기]))
    for (const 판정 of 항목.사람판정들) {
      const 대기 = 심판_by_대사.get(판정.대사)
      if (대기 === undefined) continue // 심판을 안 돌린 대사다
      const 사람 = 축 === '과녁' ? 판정.과녁 : 판정.답누출
      const 심판 = 축 === '과녁' ? 대기.심판_과녁 : 대기.심판_답누출
      if (사람 === '애매' || 심판 === '판정불가') {
        못셈 += 1
      } else if (같음.has(`${사람}→${심판}`)) {
        맞음 += 1
      } else {
        틀림 += 1
        어긋난것.push(`${항목.id} 사람=${사람} 심판=${심판} «${판정.대사.slice(0, 40)}»`)
      }
    }
  }

  return { 맞음, 틀림, 못셈, 어긋난것 }
}
