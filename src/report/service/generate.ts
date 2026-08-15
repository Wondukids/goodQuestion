// 리포트 한 장을 만든다 — 생성 흐름 ①~⑤ (명세 8절 · `src/report/README.md`).
//
// ```
// 활동 종료 (status → completed)
//   ├─① 지표 집계        aggregateMetrics(재료).  순수 함수, LLM 0회
//   │                    ↳ 실패하면 여기서 끝. 행을 만들지 않는다
//   ├─②③ generateNarrative({metrics, child})   ← 안에서 두 LLM 을 동시에 부른다
//   │                    ↳ 둘 다 실패하면 narrative=null → status='metrics_only' (R18)
//   ├─④ 저장             parent_reports upsert (session_id 로)
//   └─⑤ 낱말 누적        child_words 에 새 낱말 넣기
// ```
//
// 🔴 **순서를 아는 것은 이 층뿐이다.** 특히 ⑤가 ④ 뒤인 것이 중요하다 — 먼저 넣으면
//    「다시 만들기」를 눌렀을 때 그 낱말들이 이미 있어서 **새 낱말이 0개**가 된다 (명세 4.3).
//
// ## 실패와 버린 것을 어디에 남기나 (미정 M8 — 2026-08-15 이 갈래가 정했다)
//
// **콘솔 로그 두 줄** — `[리포트]`(한 장의 결과)와 `[리포트-버림]`(대조에서 버린 것). 표도
// 칸도 늘리지 않았다: 미정이던 자리라 **가장 되돌리기 쉬운 쪽**을 골랐고(킥오프 ⑩), 나중에
// `runs` 에 붙이든 새 표를 세우든 이 두 줄을 그 자리로 옮기면 된다. 마이그레이션이 없으므로
// 되돌릴 때 지울 것도 없다.
//
// 줄의 모양은 이 레포의 로그 규칙을 따른다 (`src/llm/log.ts` — 없는 값도 자리를 비우지 않고
// `null` 로 찍는다). 🔴 **아이 이름을 찍지 않는다** (결정 R12).

import path from 'node:path'

import type { Settings } from '@/llm/config'
import { printLine } from '@/llm/log'
import { promptsDir, 보낼것 } from '@/llm/prompts'
import { getDb, type Conn } from '@/llm/repo/db'
import { fileDigest } from '@/llm/service/goldenset'
import { aggregateMetrics, applyExtractedWords, type 집계재료 } from '@/report/domain/metrics'
import {
  generateNarrative,
  가정연계_프롬프트,
  말하기분석_프롬프트,
  type ChildInfo,
  type ReportCall,
} from '@/report/engine'
import {
  readChildInfo,
  readChildWords,
  readReportMaterial,
  readSessionIdentity,
} from '@/report/repo/materials'
import {
  insertChildWords,
  readReport,
  upsertReport,
  type ReportRow,
  type 넣을_낱말,
} from '@/report/repo/reports'
import type { ReportMetrics } from '@/report/types'

export interface GenerateReportArgs {
  session_id: string
  /** 안 주면 `getDb()`. 검사는 트랜잭션을 넘겨 끝나면 되돌린다. */
  conn?: Conn
  settings?: Settings
  /** 검사가 LLM 자리에 꽂는 가짜 (`ReportCall` — `src/report/engine/narrative.ts`). */
  call?: ReportCall
  /** 「다시 만들기」인가. `true` 면 `regenerated` 가 1 오른다 (R19). 자동 생성은 안 올린다. */
  regenerate?: boolean
}

/**
 * 이름이 없을 때 프롬프트에 실을 말.
 *
 * `children` 을 못 읽는 판(로컬 도커 DB 처럼 그 표가 아예 없는 곳)에서도 리포트는 나와야 한다.
 * ⛔ 이름을 **지어내지 않는다** — 프롬프트가 「준 이름으로 부르고 별명을 만들지 마라」
 * (`[A-NAME]`)이므로, 모를 때는 아무나의 이름이 아니라 **누구도 아닌 말**을 준다.
 */
export const 이름을_모를_때 = '아이'

/** 출생연도로 나이를 센다. 모르면 `null` — 프롬프트가 나이 없이 쓴다. */
function 나이(birth_year: number | null): number | null {
  if (birth_year === null || !Number.isFinite(birth_year)) return null
  const 값 = new Date().getFullYear() - birth_year
  return 값 >= 0 && 값 < 130 ? 값 : null
}

/** 프롬프트 두 편의 지문 — 골든셋과 **같은 함수**로 찍는다 (명세 6.1). 못 읽으면 `null`. */
export function reportPromptDigests(): Record<string, string> | null {
  try {
    return {
      [말하기분석_프롬프트]: fileDigest(path.join(promptsDir(), 말하기분석_프롬프트, 보낼것)),
      [가정연계_프롬프트]: fileDigest(path.join(promptsDir(), 가정연계_프롬프트, 보낼것)),
    }
  } catch {
    // 프롬프트 파일을 못 읽는 것은 리포트를 못 만들 이유가 아니다 — 지문만 비운다.
    return null
  }
}

/** 이야기 전체의 장면 낱말 목록 → 뜻 (`child_words.meaning` 이 여기서 온다 · 명세 6.3). */
function 낱말뜻_표(재료: 집계재료): Map<string, string> {
  const 뜻 = new Map<string, string>()
  for (const 장면 of 재료.scenes) {
    for (const 것 of 장면.vocabulary ?? []) {
      if (!뜻.has(것.word)) 뜻.set(것.word, 것.meaning)
    }
  }
  return 뜻
}

/**
 * 활동 한 건의 리포트를 만들어 저장한다. 세션이 없거나 ①이 실패하면 `null`.
 *
 * ⚠️ **던지지 않는다.** 부르는 자리가 아이의 활동 종료 응답 옆이라(아래 `queueReport()`),
 *    여기서 던지면 그 응답이 흔들린다. 실패는 로그 한 줄로 남고 `null` 로 나온다.
 */
export async function generateReport(args: GenerateReportArgs): Promise<ReportRow | null> {
  const conn = args.conn ?? getDb()
  const { session_id } = args

  const 재료 = await readReportMaterial(conn, session_id)
  if (재료 === null) {
    실패줄(session_id, '재료', `그 활동이 없다: ${session_id}`)
    return null
  }

  // ① 지표 집계 — 순수 함수. 여기서 터지면 **행을 만들지 않는다** (명세 8절).
  let 지표: ReportMetrics
  try {
    지표 = aggregateMetrics(재료)
  } catch (오류) {
    실패줄(session_id, '집계', 사유(오류))
    return null
  }

  const 아이 = await readChildInfo(conn, 재료.child_id)
  const child: ChildInfo = { name: 아이.name ?? 이름을_모를_때, age: 나이(아이.birth_year) }

  // ②③ 두 편을 **동시에** 부른다. 한쪽만 실패하면 그 칸이 빈 채로 오고, 둘 다 실패해야 null 이다.
  const 서술 = await generateNarrative({
    metrics: 지표,
    child,
    settings: args.settings,
    call: args.call,
  })

  // 낱말은 규칙이 판정한다 (명세 4.3 ②③). LLM 이 뽑아 준 것이 있을 때만 얹는다.
  let 새낱말_지표 = 지표
  if (서술.words !== null) {
    // 🔴 **이 활동이 처음 넣은 낱말은 잣대에서 뺀다.** 안 빼면 「다시 만들기」의 새 낱말이
    //    0개가 된다 — ⑤가 첫 판에서 이미 넣어 뒀기 때문이다 (`readChildWords()` 머리말).
    const 누적 = await readChildWords(conn, 재료.child_id, session_id)
    새낱말_지표 = applyExtractedWords(지표, 재료, {
      extracted: 서술.words.extracted,
      repeated: 서술.words.repeated,
      child_words: 누적,
    })
  }

  const model = 서술.llm.report_analysis?.model ?? 서술.llm.report_guide?.model ?? null

  // ④ 저장 — `session_id` 로 덮어쓴다. 활동을 두 번 끝내도 행이 하나다 (R1).
  const 저장된 = await upsertReport(conn, {
    session_id,
    child_id: 재료.child_id,
    status: 서술.narrative === null ? 'metrics_only' : 'complete',
    metrics: 새낱말_지표,
    narrative: 서술.narrative,
    model,
    prompt_digest: reportPromptDigests(),
    bump_regenerated: args.regenerate === true,
  })

  // ⑤ 낱말 누적 — 🔴 ④가 성공한 **뒤에** (명세 4.3 ⑤ · 8절).
  const 뜻 = 낱말뜻_표(재료)
  const 넣을것: 넣을_낱말[] = 새낱말_지표.words.new.map((것) => ({
    word: 것.word,
    meaning: 뜻.get(것.word) ?? null,
    first_session_id: session_id,
    first_scene_code: 것.first_scene_code === '' ? null : 것.first_scene_code,
  }))
  const 넣은수 = await insertChildWords(conn, 재료.child_id, 넣을것)

  결과줄(session_id, 저장된, 서술, 넣은수)
  return 저장된
}

/** `queueReport()` 의 곁다리 하나. 안 주면 「지금 만든다」다. */
export interface QueueReportOptions {
  /**
   * **이 이야기에 말하기 후 활동이 있으면 여기서 만들지 않는다** (F10·F13 · 후활동 명세 7.1).
   *
   * 세션이 끝나는 두 자리(`completeRun()` · `story.ts` 재생 꼬리)만 `true` 로 넘긴다.
   * 후활동이 있는 이야기는 이야기가 끝난 **뒤에** 아이가 활동을 하나 더 하므로, 거기서
   * 만들면 그 결과가 리포트에 못 들어간다. 대신 셋 중 하나가 만든다 —
   * 후활동 종료 API(`complete` · #45) · 활동을 건너뛰고 떠난 길 · 보호자 열람 시 받침(F12).
   *
   * ⛔ 그 세 자리는 이 값을 넘기지 마라. 넘기면 후활동이 있는 이야기의 리포트가 **영영**
   *    안 만들어진다 — 「기다린다」의 상대가 바로 그들이다.
   */
  후활동을_기다린다?: boolean
}

/**
 * 활동이 끝난 자리에서 부르는 문 — **기다리지 않는다** (명세 7절 「만드는 자리」 · R2).
 *
 * 🔴 아이 화면이 리포트를 기다리면 안 된다. 리포트 한 장에 LLM 2회가 나가고, 그게 느리거나
 *    죽어도 아이는 「참 잘했어요」 화면으로 넘어가야 한다. 그래서 `await` 하지 않고 띄우고,
 *    실패는 로그로만 남긴다.
 *
 * ## 이 문이 열리는 자리 (후활동 명세 7.1 — 이슈 #43 이 곁다리와 받침을 더했다)
 *
 * | 자리 | `후활동을_기다린다` |
 * |---|---|
 * | 세션 닫기 — `completeRun()` · `story.ts` 재생 꼬리 | **`true`** (F13 의 길) |
 * | 후활동 종료 — `complete(reason=finished\|left)` (#45) | 안 넘긴다 (F11) |
 * | 보호자 열람 시 받침 — `service/reports.ts` (F12) | 안 넘긴다 |
 *
 * ## 이미 있으면 다시 안 만든다
 *
 * 위 넷 가운데 둘 이상이 겹쳐 들어올 수 있다 — 아이가 활동을 마치고 끝 화면을 떠나면
 * `complete` 가 두 번 불린다. 저장은 덮어쓰기라 행은 안 늘지만 **LLM 2회가 또 나간다.**
 * 그래서 행이 이미 있으면 그냥 돌아간다 — 다시 만드는 길은 보호자가 누르는
 * 「다시 만들기」뿐이다 (R19).
 *
 * ⛔ 여기에 `conn` 을 넘기지 마라. 검사 트랜잭션을 넘기면 요청이 끝난 뒤에 그 트랜잭션이
 *    되돌려져 저장이 사라진다. 검사는 `generateReport()` 를 직접 부른다.
 */
export function queueReport(session_id: string, options: QueueReportOptions = {}): void {
  __testing.마지막작업 = (async () => {
    try {
      const conn = getDb()
      const 이미 = await readReport(conn, session_id)
      if (이미 !== null) return

      // 아직 안 끝난 활동에는 리포트를 만들지 않는다. 닫는 자리에서 불렀는데 안 닫혀 있으면
      // 다른 갈래가 먼저 왔다는 뜻이고, 그 갈래가 자기 자리에서 다시 부른다.
      //
      // ⚠️ 후활동은 **이미 `completed` 인 세션**에 붙는 활동이라 이 문지기와 어긋나지 않는다
      //    (F10 — 세션 상태는 안 건드린다. `post_activity` 상태는 F5 로 접었다).
      const 신원 = await readSessionIdentity(conn, session_id)
      if (신원 === null || 신원.status !== 'completed') return

      // 후활동이 남았다 — 그 결과까지 담아 **한 번에** 만들려고 여기서는 안 만든다 (F10).
      if (options.후활동을_기다린다 === true && 신원.has_post_activity) return

      await generateReport({ session_id })
    } catch (오류) {
      실패줄(session_id, '뒤에서', 사유(오류))
    }
  })()
}

/**
 * 뒤에서 도는 작업을 **검사가 기다리는 손잡이** (`src/llm/provider/rate-limit.ts` 의
 * `__testing` 과 같은 자리).
 *
 * 🔴 제품 코드에서 쓰지 마라. 이것을 `await` 하는 순간 「기다리지 않는다」가 깨진다.
 *    세션 닫기에 리포트가 정말 걸려 있는지는 이 손잡이 없이는 잴 수가 없다 — 검사가
 *    끝나 버려 저장이 언제 끝났는지 알 방법이 없기 때문이다.
 */
export const __testing = {
  /** 마지막으로 띄운 작업. 한 번도 안 띄웠으면 `null` */
  마지막작업: null as Promise<void> | null,
}

// ── 로그 (미정 M8 — 위 머리말) ─────────────────────────────────────────────

function 사유(오류: unknown): string {
  return 오류 instanceof Error ? `${오류.name}: ${오류.message}` : String(오류)
}

function 실패줄(session_id: string, 단계: string, 사유글: string): void {
  printLine(`[리포트] 실패 session_id=${session_id} 단계=${단계} 사유="${사유글}"`)
}

/**
 * 한 장을 만든 결과 한 줄, 그리고 **버린 것이 있으면 한 줄 더.**
 *
 * 🔴 `dropped` 를 찍는 것이 이 함수의 절반이다. 그것은 **LLM 이 없는 발화를 인용하려 해서
 *    서버가 버린 기록**이고, 이 도메인이 가장 공들인 방어선이 그 대조다 (명세 5.2·5.3).
 *    버린 것을 아무도 안 찍으면 프롬프트가 새고 있어도 알 길이 없다 — 화면에는 「인용 없는
 *    카드」로 조용히 나갈 뿐이다.
 *
 * 버림 줄은 **버린 게 있을 때만** 낸다. 늘 찍으면 정상 회차마다 빈 줄이 하나씩 늘어 눈이
 * 익어 버리고, 그러면 진짜 새는 날에도 안 보인다.
 *
 * ⛔ 아이 이름을 안 찍는다 (결정 R12). 여기 실리는 것은 id·낱말·요소 코드뿐이다.
 */
function 결과줄(
  session_id: string,
  행: ReportRow,
  서술: Awaited<ReturnType<typeof generateNarrative>>,
  넣은_낱말수: number,
): void {
  const 버린것 = 서술.dropped
  const 버린수 =
    버린것.card_quotes.length +
    (버린것.highlight === null ? 0 : 1) +
    버린것.words.length +
    버린것.phrases.length +
    버린것.story_questions.length

  printLine(
    `[리포트] session_id=${session_id} status=${행.status} model=${행.model ?? 'null'} ` +
      // ⚠️ `낱말넣음` 은 **이번에 `child_words` 에 실제로 들어간 행 수**다.
      //    `metrics.counts.new_words`(화면이 보여 주는 「새 낱말」)와 다를 수 있다 —
      //    「다시 만들기」에서는 이 활동이 첫 판에 이미 넣어 둔 낱말이라 새 낱말로는 세지만
      //    표에는 안 들어간다. 두 숫자가 다르면 그건 재생성이라는 뜻이고, 버그가 아니다.
      `regenerated=${행.regenerated} 새낱말=${행.metrics.counts.new_words} ` +
      `낱말넣음=${넣은_낱말수} 버림=${버린수} ` +
      `report_analysis=${서술.failed.report_analysis ?? 'ok'} ` +
      `report_guide=${서술.failed.report_guide ?? 'ok'}`,
  )

  if (버린수 === 0) return
  const 목록 = (것들: readonly string[]) => (것들.length === 0 ? 'null' : `[${것들.join(', ')}]`)
  printLine(
    `[리포트-버림] session_id=${session_id} 카드인용=${목록(버린것.card_quotes)} ` +
      `대표발화=${버린것.highlight ?? 'null'} 낱말=${목록(버린것.words)} ` +
      `반복표현=${목록(버린것.phrases)} 이야기질문=${목록(버린것.story_questions)}`,
  )
}
