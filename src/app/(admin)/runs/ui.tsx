// 회차 화면 셋이 함께 쓰는 조각 (이슈 #26 화면-3).
//
// ⛔ **여기에 규칙이 없다.** 값을 어떻게 보이느냐만 정한다.
// ⚠️ 라우트 파일(`page.tsx`)에서 이런 것을 export 하지 않는다 — Next 가 그 파일의 export 를
//    규격으로 검사하므로, 화면 조각은 라우트가 **아닌** 파일에 둔다.
//
// ⭐ `한칸`·`오류띠`·`라벨` 은 화면 전부가 쓰므로 `app/(admin)/ui.tsx` 로 올렸다
//    (2026-08-13). 여기서 다시 내보내는 것은 **가져다 쓰는 화면들의 import 줄을
//    안 건드리려는 것**이다.

import Link from 'next/link'

import type { TurnRow } from '@/llm/service/view'

import { 라벨 } from '../ui'

export { 한칸, 오류띠, 라벨 } from '../ui'

/**
 * 회차 시작 폼의 LLM 칸 한 벌 — 모델 `<select>` 와 추론 강도 라디오.
 *
 * 파이썬 `templates/run_new.html` 의 `LLM칸` 매크로를 그대로 옮긴 것이다 (분석·캐릭터 ×2).
 *
 * 🔴 **자유 입력칸이었다** (2026-08-11). 오타가 그대로 `runs` 에 저장돼서 그 회차가 **첫
 *    호출에 통째로 실패했다.** 그래서 모델은 목록, 강도는 라디오다. 이 성질이 이식에서
 *    빠져 있었고, 그동안 네 칸이 전부 NULL 로 남아 「무엇으로 돌렸나」가 기록에 없었다.
 *
 * ⛔ **여기에 규칙이 없다.** 고를 수 있는 값이 무엇인지는 `lib/config.ts` 가 정하고
 *    (`모델_목록()` · `고를_수_있는_강도`), 이 조각은 받아서 그릴 뿐이다.
 *
 * ⚠️ `gpt-5-nano` 는 여기 안 온다 — `모델_목록()` 이 제미나이 목록에 **설정이 가리키는
 *    모델**만 더해 주기 때문이다.
 *    ⛔ **「폼에 놓으면 돈이 나간다」는 지금 코드에서 성립하지 않는다.** 회차에 박힌 모델은
 *    `runSettings()` 가 `gemini_model` 자리에 넣으므로, 골라도 제미나이 SDK 에 `gpt-5-nano`
 *    를 보내 **그 회차가 통째로 실패**할 뿐이다. OpenAI 공급자는 `line: 'openai'` 로만 닿고
 *    (`lib/llm/index.ts` — 「예산 검증 줄이라 체인에 안 섞인다」) 회차 시작 경로는 아무도 그
 *    값을 주지 않는다. 그래서 목록에서 뺀 까닭은 「돈」이 아니라 **닿지도 않는 값을 고르게
 *    하면 안 된다**는 것이다. 셋째 공급자를 실제로 붙일 때가 오면 그때는 돈 이야기가 맞다
 *    (`CLAUDE.md` — 되풀이는 무료로, 검수할 때만).
 */
export function LLM칸({
  제목,
  이름,
  모델들,
  기본_모델,
  강도들,
  기본_강도,
}: {
  제목: string
  /** 폼 칸 이름의 앞머리. `analysis` 면 `analysis_model` · `analysis_effort` 다. */
  이름: 'analysis' | 'character'
  모델들: readonly string[]
  /** 지금 설정값. 이 항목이 처음부터 골라져 있고 「· 지금 기본값」이 붙는다. */
  기본_모델: string
  강도들: readonly string[]
  기본_강도: string
}) {
  return (
    <fieldset className="flex flex-col gap-2 border border-zinc-300 px-3 py-2 dark:border-zinc-700">
      <legend className="px-1 text-xs font-semibold">{제목}</legend>
      <라벨 이름={`${이름}_model`}>
        <select name={`${이름}_model`} className="border px-2 py-1" defaultValue={기본_모델}>
          {모델들.map((모델) => (
            <option key={모델} value={모델}>
              {모델}
              {모델 === 기본_모델 ? ' · 지금 기본값' : ''}
            </option>
          ))}
        </select>
      </라벨>
      <div className="flex flex-col gap-1">
        <span className="font-mono text-xs text-zinc-500">{이름}_effort</span>
        <div className="flex flex-wrap items-center gap-3">
          {강도들.map((강도) => (
            <label key={강도} className="flex items-center gap-1 font-mono text-xs">
              <input
                type="radio"
                name={`${이름}_effort`}
                value={강도}
                defaultChecked={강도 === 기본_강도}
              />
              {강도}
            </label>
          ))}
        </div>
      </div>
    </fieldset>
  )
}

/**
 * 진행 화면이 지금 어느 패널을 낼 차례인가.
 *
 * 🔴 **파이썬 `run_body.html` 의 갈래 순서를 그대로 옮긴 것이다** — `progress` → `failure`
 * → `발화받기`. 이식본은 이 순서를 잃어버려 `pending` 을 맨 앞에 두고 `progress` 를 아예
 * 보지 않았고, 그래서 2026-08-13 에 이렇게 됐다:
 *
 * - ① 이 도는 중에는 아이 `messages` 행만 있고 `utterance_analyses` 행이 아직 없다.
 *   그러면 `pendingTurn()` 이 **`analysis`(끊긴 턴)** 를 낸다 — 도는 중인 턴과 죽은 턴이
 *   저장된 사실로는 똑같이 생겼기 때문이다 (`service/run.turnFailureState()` 머리말).
 * - 화면은 그것을 읽고 「이 턴은 분석 단계에서 끊겼다 · 위의 「이어 돌리기」로 잇는다」를
 *   띄웠다. 그런데 그 「이어 돌리기」 단추는 `turnFailureState()` 가 **도는 중이면 `null`**
 *   을 주므로 화면에 없다. **없는 단추를 가리키는 막다른 길이었다.**
 *
 * ⛔ 여기에 규칙이 없다 — 어느 것을 보여줄지만 고른다. 무엇을 부를 차례인지는
 *    `nextStep()`·`pendingTurn()` 이 이미 정했고 이 함수는 그 답을 받아 쓴다 (경계 6).
 *
 * ⚠️ 한 턴을 한 번에 도는 길(`turnAction`)이 생겨도 이 순서는 그대로다 — `turnAction` 이 도는
 *    동안에도 `pendingTurn()` 은 `analysis` 를 내고 `progress` 가 그것을 덮는다.
 */
export type 패널 =
  | '도는중'
  | '분석에서끊김'
  | '판단'
  | '대사'
  | '분석'
  | '장면시작'
  | '더할것없음'

export function 어느_패널({
  progress,
  pending_stage,
  next_action_kind,
}: {
  /** 이 회차에서 지금 도는 호출의 표시용 단계. 안 돌면 `null`. */
  progress: string | null
  /** 끝나지 않은 턴이 죽은(또는 아직 안 간) 자리. 없으면 `null`. */
  pending_stage: 'analysis' | 'decision' | 'character' | null
  next_action_kind: string
}): 패널 {
  // 🔴 **`progress` 가 맨 앞이다.** 도는 중인 턴을 「끊겼다」로 그리면 안 되고,
  //    도는 중에 새 폼을 내주면 사람이 두 번 눌러 409 를 만든다.
  if (progress !== null) return '도는중'
  if (pending_stage === 'analysis') return '분석에서끊김'
  if (pending_stage === 'decision') return '판단'
  if (pending_stage === 'character') return '대사'
  if (next_action_kind === '발화받기') return '분석'
  if (next_action_kind === '장면시작') return '장면시작'
  return '더할것없음'
}

/**
 * 값 하나를 화면 표기로.
 *
 * ⚠️ `lib/log.ts` 의 `값()` 과 같은 규칙이다 — 없으면 `null`, 배열은 `[A, B]`.
 *    `-` 를 쓰지 않는 이유는 값이 `-` 인 것과 구별이 안 되기 때문이다.
 *    ⛔ 로그 세 줄 자체는 여기서 다시 만들지 않는다. `service/view.ts` 가 준 문자열을 그대로 쓴다.
 */
export function 표기(것: unknown): string {
  if (것 === null || 것 === undefined) return 'null'
  if (typeof 것 === 'boolean') return 것 ? 'true' : 'false'
  if (Array.isArray(것)) return '[' + 것.map((하나) => 표기(하나)).join(', ') + ']'
  return String(것)
}

/** `컬럼명=값` 한 줄. **DB 컬럼명을 그대로 쓴다** (`CLAUDE.md` 로그 절). */
export function 칸들({ 값들 }: { 값들: readonly [string, unknown][] }) {
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-3 font-mono text-xs">
      {값들.map(([이름, 것]) => (
        <div key={이름} className="contents">
          <dt className="text-zinc-500">{이름}</dt>
          <dd className="break-all">{표기(것)}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * 되살린 콘솔 세 줄.
 *
 * 🔴 **문자열을 새로 만들지 않는다.** `service/view.ts` 의 `turnLogLines()` 가 `lib/log.ts` 를
 * 불러 만든 그 문자열을 그대로 찍는다 (`CLAUDE.md` — 지우거나 요약하지 말 것).
 */
export function 로그세줄({
  줄들,
}: {
  줄들: { 분석: string | null; 상태: string; 판정: string } | null
}) {
  if (줄들 === null) {
    // 스냅샷이 없는 턴이다. **꾸며 내지 않는다.**
    return <p className="font-mono text-xs text-zinc-500">turn_conditions 스냅샷이 없다</p>
  }
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap break-all bg-zinc-100 p-2 font-mono text-xs dark:bg-zinc-900">
      {[줄들.분석 ?? '[분석] (분석 행이 없다)', 줄들.상태, 줄들.판정].join('\n')}
    </pre>
  )
}

/**
 * 이 턴이 쓴 LLM 시도로 가는 길 (`/runs/{run_id}/turns/{message_id}`).
 *
 * 🔴 **이 링크가 없으면 그 화면은 주소를 손으로 쳐야만 닿는다.** 파이썬은 턴 카드 안에
 *    펼치는 `details` 였고(`templates/turn.html:91-97` 의 `hx-get …/turns/{id}/calls`),
 *    이식본은 쪽 하나로 갈렸는데 부르는 자리가 안 따라와 있었다 (2026-08-13 통합).
 *
 * ⚠️ **아이 메시지에만 붙는다.** `llm_calls.message_id` 가 그 턴의 **아이 발화** 행을
 *    가리키므로(`service/run.ts` — 끊긴 턴은 같은 `message_id` 로 이어 돌린다),
 *    캐릭터 행의 id 로 열면 늘 「호출 없음」이 나와 사람을 헷갈리게 한다.
 *
 * ⛔ 여기에 규칙이 없다 — 링크 한 줄이다.
 */
export function 시도링크({ run_id, message_id }: { run_id: string; message_id: string }) {
  return (
    <Link href={`/runs/${run_id}/turns/${message_id}`} className="text-xs underline">
      LLM 시도 · 프롬프트 원문 · 비용 →
    </Link>
  )
}

/**
 * 대화 한 줄 (진행 화면의 「이 장면의 대화」).
 *
 * ⛔ 여기에 규칙이 없다 — `service/view.runDetail()` 이 이미 정해 준 것을 그릴 뿐이다.
 *    「응답 없음」의 판정도 `character_response === null` 로 저쪽이 낸 값이다.
 */
export function 대화줄({ run_id, 행 }: { run_id: string; 행: TurnRow }) {
  const 아이 = 행.speaker_type === 'child'
  return (
    <li className="border-l-2 border-zinc-300 pl-2 dark:border-zinc-700">
      <p className="font-mono text-xs text-zinc-500">
        turn_order={행.turn_order} speaker_type={행.speaker_type}
        {아이 && 행.character_response === null && (
          <span className="ml-2 text-amber-600">응답 없음</span>
        )}
        {아이 && (
          <span className="ml-2">
            <시도링크 run_id={run_id} message_id={행.id} />
          </span>
        )}
      </p>
      <p>{행.text}</p>
      {아이 && <로그세줄 줄들={행.log_lines} />}
    </li>
  )
}
