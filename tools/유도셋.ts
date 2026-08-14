/**
 * 유도 골든셋 하네스의 **입구** — 판을 돌리고, 대조를 내고, 재심을 돈다.
 *
 * 파이썬 `src/goodquestion/goldenset_유도.py` 의 `main()` (argparse) 을 옮긴 것이다
 * (이슈 #26 · char 트랙 #22). 셈은 전부 `tools/유도셋-판.ts` 와 `tools/유도셋-기록.ts` 에 있고
 * 이 파일은 **인자를 읽고 찍기만** 한다.
 *
 * ── 돌리는 법 ────────────────────────────────────────────────
 *   cd web
 *   npx tsx tools/유도셋.ts --help
 *   npx tsx tools/유도셋.ts 대조
 *   npx tsx tools/유도셋.ts 돌리기 --과녁 PERSPECTIVE --적기 2026-08-14
 *   npx tsx tools/유도셋.ts 재심 --날짜 2026-08-14 --반복 3
 *
 * ── 파이썬과 갈라 둔 자리 ────────────────────────────────────
 *   1. 파이썬은 **깃발 하나로** 갈래를 갈랐다 (`--대조` · `--재심 날짜`). 여기서는
 *      **하위명령**이다 — 사람이 정한 실행 모양이 `유도셋.ts <하위명령>` 이고,
 *      깃발로 갈래를 가르면 `--대조 --재심` 을 같이 줬을 때 무엇이 도는지가 코드를 봐야 안다.
 *      갈래마다 받는 깃발도 갈라 뒀다 (`대조` 에 `--분당` 을 주면 오늘은 터진다).
 *      **깃발 이름과 기본값은 파이썬 그대로다.** `--재심 <날짜>` 만 `재심 --날짜 <날짜>` 가 됐다.
 *   2. 파이썬은 `--분당` 을 `os.environ["GQ_LLM_RPM"]` 에 밀어 넣었다. 여기서는
 *      `loadSettings({ llm_rpm })` 로 준다 — `lib/config.ts` 머리말이 못박은 길이고,
 *      환경을 고쳐 놓으면 같은 프로세스의 다른 호출까지 조용히 딸려간다.
 *   3. **파일을 고치는 하위명령은 무엇을 몇 줄 고쳤는지 찍는다.** 파이썬도 줄 수는 찍었지만
 *      여기서는 **경로 통째**를 함께 찍는다 — 정답지는 되살릴 데가 없는 파일이라
 *      「어느 파일이 바뀌었나」가 줄 수만큼 중요하다.
 *   4. **LLM 이 나가는 하위명령은 시작 전에 그 사실과 예상 호출 수를 찍는다** (`호출_알림()`).
 *
 * ── ⚠️ 이 숫자를 어떻게 읽나 ─────────────────────────────────
 *   `[유도셋 합계]` 는 **심판을 믿는다는 전제 위에 있다.** 심판이 사람과 얼마나 맞는지는
 *   `대조` 가 따로 낸다. 그 대조를 하기 전에는 **판 사이 비교로만** 쓸 것.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

import { loadSettings, type Settings } from '@/llm/config'
import { accuracy, judgeAgreement, type GuidanceItem } from '@/llm/goldenset-guidance'
import { printLine } from '@/llm/log'
import {
  GUIDANCE_GOLDENSET_PATH,
  readGuidanceGoldensetFile,
} from '@/llm/service/goldenset-guidance'
import { characterPromptDigest, engineLineMaker, recordLines } from './유도셋-기록'
import {
  recordRejudge,
  runRejudge,
  runRound,
  targetHitRate,
  targetJudgeDigest,
  type RoundTotals,
} from './유도셋-판'

// ═══════════════════════════════════════════════════════════════════════════
// 인자
// ═══════════════════════════════════════════════════════════════════════════

const 하위명령들 = ['돌리기', '대조', '재심'] as const
type 하위명령 = (typeof 하위명령들)[number]

const 도움말 = `
유도 골든셋 하네스 — 캐릭터가 **과녁을 향해 유도하는가**를 잰다.

  npx tsx tools/유도셋.ts <하위명령> [옵션]

하위명령
  돌리기   대사를 새로 내고 심판 둘을 태워 판을 한 번 돌린다        💸 LLM 을 부른다
  대조     돌리지 않고 사람↔심판 대조만 낸다                        LLM 을 안 부른다
  재심     대사는 그대로 두고 **심판만** 다시 돌려 판정을 갈아 끼운다 💸 LLM 을 부른다
           (심판 프롬프트를 고쳤을 때. 옛 판정은 옛심판으로 남는다)

공통 옵션
  --파일 <경로>     정답지 파일 (기본: goldenset/유도/검수전.jsonl)
  --검수완료만      검수된 항목만 돌린다
  --과녁 <이름>     이 과녁의 항목만 (예: PERSPECTIVE)

돌리기
  --프롬프트 <경로> 이 파일을 캐릭터 프롬프트로 쓴다. 판 A/B 를 견줄 때 쓴다
  --분당 <수>       분당 LLM 호출 상한 (기본: GQ_LLM_RPM)
  --적기 <날짜>     🔴 나온 대사를 판정대기로 **파일에 적는다.** 사람이 판정할 재료다
                    (예: --적기 2026-08-14). 안 주면 파일을 안 건드린다

재심
  --날짜 <날짜>     🔴 필수. 이 날짜로 판정을 갈아 끼운다 (파이썬 \`--재심 <날짜>\` 자리)
  --반복 <수>       대사 하나를 몇 번 판정하고 다수결을 취할까 (기본 3).
                    1 회는 심판의 흔들림과 프롬프트의 효과를 못 가른다 — 2026-08-13 에 데었다
  --분당 <수>       분당 LLM 호출 상한

⚠️ 판 합계는 **심판을 믿는다는 전제** 위에 있다. 사람 대조 전에는 판 사이 비교로만 쓸 것.
`.trimStart()

interface 인자들 {
  하위: 하위명령
  파일: string
  검수완료만: boolean
  과녁: string | null
  프롬프트: string | null
  분당: number | null
  적기: string | null
  날짜: string | null
  반복: number
}

/** 깃발마다 값을 받나. 여기 없는 것은 값 없는 깃발이다. */
const 값_깃발 = new Set(['--파일', '--과녁', '--프롬프트', '--분당', '--적기', '--날짜', '--반복'])

/** 하위명령마다 받는 깃발. 여기 없는 깃발을 주면 터진다 — 조용히 무시하면 안 먹은 줄 모른다. */
const 받는_깃발: Readonly<Record<하위명령, readonly string[]>> = {
  돌리기: ['--파일', '--검수완료만', '--과녁', '--프롬프트', '--분당', '--적기'],
  대조: ['--파일', '--검수완료만', '--과녁'],
  재심: ['--파일', '--검수완료만', '--과녁', '--분당', '--날짜', '--반복'],
}

/** 사람이 인자를 잘못 줬다. 도움말과 함께 `exit 1`. */
export class 사용법오류 extends Error {}
/** 사람이 도움말을 달라고 했다. `exit 0` 이다 — 오류가 아니다. */
export class 도움말요청 extends Error {}

function 숫자로(이름: string, 값: string): number {
  const 수 = Number(값)
  if (!Number.isFinite(수)) throw new 사용법오류(`${이름} 는 수여야 한다: ${값}`)
  return 수
}

export function 인자_읽기(argv: readonly string[]): 인자들 {
  const [하위, ...나머지] = argv
  if (하위 === undefined || 하위 === '--help' || 하위 === '-h' || 하위 === 'help') {
    throw new 도움말요청('')
  }
  if (!(하위명령들 as readonly string[]).includes(하위)) {
    throw new 사용법오류(`모르는 하위명령이다: ${하위}`)
  }
  const 갈래 = 하위 as 하위명령

  const 인자: 인자들 = {
    하위: 갈래,
    파일: GUIDANCE_GOLDENSET_PATH,
    검수완료만: false,
    과녁: null,
    프롬프트: null,
    분당: null,
    적기: null,
    날짜: null,
    반복: 3, // 파이썬 argparse 기본값 그대로
  }

  for (let 자리 = 0; 자리 < 나머지.length; 자리 += 1) {
    const 깃발 = 나머지[자리]
    if (깃발 === '--help' || 깃발 === '-h') throw new 도움말요청('')
    if (!깃발.startsWith('--')) throw new 사용법오류(`옵션이 아니다: ${깃발}`)
    if (!받는_깃발[갈래].includes(깃발)) {
      throw new 사용법오류(`「${갈래}」 가 안 받는 옵션이다: ${깃발}`)
    }

    let 값: string | null = null
    if (값_깃발.has(깃발)) {
      값 = 나머지[자리 + 1] ?? null
      if (값 === null || 값.startsWith('--')) throw new 사용법오류(`${깃발} 에 값이 없다`)
      자리 += 1
    }

    switch (깃발) {
      case '--파일':
        인자.파일 = path.resolve(값!)
        break
      case '--검수완료만':
        인자.검수완료만 = true
        break
      case '--과녁':
        인자.과녁 = 값
        break
      case '--프롬프트':
        인자.프롬프트 = path.resolve(값!)
        break
      case '--분당':
        인자.분당 = 숫자로('--분당', 값!)
        break
      case '--적기':
        인자.적기 = 값
        break
      case '--날짜':
        인자.날짜 = 값
        break
      case '--반복':
        인자.반복 = 숫자로('--반복', 값!)
        break
    }
  }

  if (갈래 === '재심' && 인자.날짜 === null) {
    throw new 사용법오류('재심 에는 --날짜 <날짜> 가 필요하다 (파이썬 `--재심 <날짜>` 자리)')
  }
  return 인자
}

// ═══════════════════════════════════════════════════════════════════════════
// 찍기
// ═══════════════════════════════════════════════════════════════════════════

/** 파이썬 `f'{값:.0%}'`. 못 잰 것은 `--` 다 — **0% 가 아니다** (결정 29). */
function 퍼센트(값: number | null): string {
  return 값 === null ? '--' : `${(값 * 100).toFixed(0)}%`
}

/**
 * 🔴 **LLM 이 나가기 전에** 무엇이 얼마나 나가는지 보여 준다.
 *
 * `CLAUDE.md` LLM 절 — 되풀이는 무료(`flash-lite`)로, 검수할 때만 유료다.
 * 그 규칙을 지키려면 **어느 모델로 도는지가 실행 전에 눈에 보여야** 한다.
 * ⛔ 여기서 공급자를 고르지 않는다. 설정이 정한 것을 읽어 찍기만 한다.
 */
function 호출_알림(무엇: string, 예상: number, 설정: Settings): void {
  printLine('')
  printLine(`[유도셋] ⚠️ ${무엇} 는 **진짜 LLM 을 부른다** — 예상 ${예상}회 (분당 상한 ${설정.llm_rpm})`)
  printLine(`[유도셋]    1순위 ${설정.gemini_model} — 되풀이용 무료 등급이다 (CLAUDE.md LLM 절)`)
  printLine(
    `[유도셋]    💸 그 줄이 API 오류·타임아웃으로 죽으면 fallback ${설정.anthropic_model} 로 넘어가고,` +
      ' **거기서는 키에 돈이 나간다.**',
  )
  printLine('[유도셋]    모델을 바꾸려면 .env.local 의 GQ_GEMINI_MODEL 을 고쳐라. 이 도구가 안 고른다.')
  printLine('')
}

/** 🔴 정답지를 고쳤으면 **무엇을 몇 줄** 고쳤는지 반드시 남긴다. 조용히 덮어쓰지 않는다. */
function 고침_알림(경로: string, 줄수: number, 무엇: string): void {
  if (줄수 === 0) {
    printLine(`[유도셋] 📄 고친 줄 없다 (${무엇}) — ${경로}`)
    return
  }
  printLine(`[유도셋] 📝 ${경로} — ${줄수}줄 고쳤다 (${무엇})`)
}

/** 파이썬 `대조_찍기()`. 두 축을 다 낸다 — 한 축만 보면 깔때기를 못 본다. */
function 대조_찍기(볼것: readonly GuidanceItem[]): void {
  for (const 축 of ['과녁', '답누출'] as const) {
    const 결 = judgeAgreement(볼것, { 축 })
    printLine(
      `[대조·${축}] 맞음=${결.맞음} 틀림=${결.틀림} 못셈=${결.못셈} ` +
        `정확도=${퍼센트(accuracy(결))}`,
    )
    for (const 줄 of 결.어긋난것) printLine(`  ✗ ${줄}`)
  }
  printLine('[대조] ⚠️ 이것은 **심판을 재는 숫자**다. 캐릭터를 재는 숫자와 섞지 말 것.')
}

function 합계_찍기(합계: RoundTotals): void {
  printLine(
    `\n[유도셋 합계] 돌린수=${합계.돌린수} ` +
      `과녁: 적중=${합계.과녁_성공} 빗나감=${합계.과녁_실패} 판정불가=${합계.과녁_못셈} ` +
      `적중률=${퍼센트(targetHitRate(합계))}`,
  )
  printLine(
    `[유도셋 합계] 답누출 위반=${합계.누출_위반} · ⚠️깔때기=${합계.깔때기} ` +
      `· 대사실패=${합계.대사실패}`,
  )
  printLine('[유도셋] ⚠️ 이 숫자는 심판을 믿는다는 전제 위에 있다. 사람 대조 전에는 판 사이 비교로만.')
}

// ═══════════════════════════════════════════════════════════════════════════
// 갈래
// ═══════════════════════════════════════════════════════════════════════════

function 항목_읽기(인자: 인자들): GuidanceItem[] {
  const 항목들 = readGuidanceGoldensetFile(인자.파일, { 검수완료만: 인자.검수완료만 })
  return 인자.과녁 === null ? 항목들 : 항목들.filter((하나) => 하나.guidance_target === 인자.과녁)
}

/** 판을 한 번 돌린다. 💸 항목마다 캐릭터 1 + 심판 2 번이 나간다. */
async function 돌리기(인자: 인자들, 항목들: readonly GuidanceItem[]): Promise<void> {
  const 본문 = 인자.프롬프트 === null ? null : readFileSync(인자.프롬프트, 'utf-8')
  const 설정 = loadSettings(인자.분당 === null ? {} : { llm_rpm: 인자.분당 })

  호출_알림('돌리기', 항목들.length * 3, 설정)
  printLine(
    `[유도셋] 항목 ${항목들.length}개 · 프롬프트=${인자.프롬프트 ?? 'prompts/character.md'} ` +
      `· 지문=${본문 === null ? characterPromptDigest().slice(0, 12) : '(실험본)'}`,
  )

  const { 결과들, 합계 } = await runRound(항목들, {
    대사_내기: engineLineMaker({ prompt: 본문, settings: 설정 }),
    settings: 설정,
    찍기: printLine,
  })

  if (인자.적기 !== null) {
    const 넣은수 = recordLines(인자.파일, 결과들, {
      돌린날: 인자.적기,
      프롬프트_지문: 본문 === null ? characterPromptDigest().slice(0, 12) : '(실험본)',
    })
    고침_알림(인자.파일, 넣은수, `대사를 판정대기로 남겼다 · 돌린날=${인자.적기}`)
  } else {
    printLine('[유도셋] 📄 파일은 안 건드렸다 — 남기려면 --적기 <날짜> 를 줘라')
  }

  합계_찍기(합계)
}

/** 대사는 그대로 두고 심판만 다시 돌린다. 💸 대사 한 줄마다 심판 2 × 반복 번이 나간다. */
async function 재심(인자: 인자들, 항목들: readonly GuidanceItem[]): Promise<void> {
  const 설정 = loadSettings(인자.분당 === null ? {} : { llm_rpm: 인자.분당 })
  const 지문 = targetJudgeDigest().slice(0, 12)
  const 대사수 = 항목들.reduce(
    (셈, 항목) => 셈 + 항목.대기들.filter((대기) => 대기.대사 !== '').length,
    0,
  )

  호출_알림('재심', 대사수 * Math.max(1, 인자.반복) * 2, 설정)
  printLine(`[재심] 항목 ${항목들.length}개 · 반복 ${인자.반복}회 · 과녁 심판 지문=${지문}`)
  printLine('[대조] ── 고치기 전 ──')
  대조_찍기(항목들)

  const 결과들 = await runRejudge(항목들, { 반복: 인자.반복, settings: 설정, 찍기: printLine })
  const 바뀐 = recordRejudge(인자.파일, 결과들, { 돌린날: 인자.날짜!, 심판_지문: 지문 })
  const 뒤집힌 = 결과들.filter((한) => 한.뒤집힘).length
  const 흔들린 = 결과들.filter((한) => 한.흔들렸나).length

  고침_알림(인자.파일, 바뀐, `대사 ${결과들.length}줄 다시 판정 · 돌린날=${인자.날짜}`)
  printLine(`[재심] 대사 ${결과들.length}줄 다시 판정 · 뒤집힘 ${뒤집힌} · 〰흔들림 ${흔들린}`)
  if (흔들린 > 0) {
    printLine(
      '[재심] ⚠️ 같은 대사에 답이 갈린 것이 있다. **심판 자체가 흔들리는 폭**이고, ' +
        '프롬프트를 고친 효과는 그 폭보다 커야 말할 수 있다.',
    )
  }

  printLine('[대조] ── 고친 뒤 ──')
  대조_찍기(항목_읽기(인자))
}

async function main(): Promise<void> {
  const 인자 = 인자_읽기(process.argv.slice(2))

  const 항목들 = 항목_읽기(인자)
  if (항목들.length === 0) {
    printLine('[유도셋] 돌릴 항목이 없다')
    return
  }

  if (인자.하위 === '대조') {
    대조_찍기(항목들)
    return
  }
  if (인자.하위 === '재심') {
    await 재심(인자, 항목들)
    return
  }
  await 돌리기(인자, 항목들)
}

// ⚠️ 최상위 `await` 를 쓰지 않는다 — `tsx` 가 이 파일을 cjs 로 옮겨 담아 터진다
//    (`package.json` 에 `"type": "module"` 이 없다). `tools/start-run.ts` 와 같은 모양이다.
// ⛔ DB 를 안 쓰므로 닫을 연결이 없다. 이 하네스는 파일과 LLM 만 본다.
main().catch((오류: unknown) => {
  if (오류 instanceof 도움말요청) {
    process.stdout.write(`\n${도움말}`)
    return
  }
  process.exitCode = 1
  if (오류 instanceof 사용법오류) {
    process.stderr.write(`\n${오류.message}\n\n${도움말}`)
    return
  }
  process.stderr.write(`\n${오류 instanceof Error ? 오류.stack ?? 오류.message : String(오류)}\n\n`)
})
