// 화면 2 — 진행 (`/runs/{run_id}`). 발화를 넣으면 ①②③ 이 **한 번에** 돌고,
// 원하면 「① 분석만」으로 **한 단계씩** 들여다본다.
//
// 🔴 **기본은 한 번에, 원하면 단계별** — 파이썬은 발화를 넣으면 `회차.py:444 턴_뒤에서()` 가
//    `턴_돌리기()` 를 불러 ①②③ 을 끝까지 돌렸고, 사람은 단추를 **한 번만** 눌렀다.
//    이식본은 한동안 단추가 셋뿐이라 세 번 눌러야 했고 그 사이마다 「끝나지 않은 턴이 있다」
//    띠가 떴다. 그래서 발화 폼의 기본 단추를 `turnAction`(=`submitTurn()`)으로 되돌렸다.
//
// ⚠️ **`CLAUDE.md` 의 「분석·판단·대사를 한 호출로 묶지 말 것」을 어긴 것이 아니다.**
//    그 금지는 **서비스 함수와 라우트**에 대한 것이고 근거가 「관리자 화면이 단계별로
//    들여다보고 따로 다시 돌려야 하니까」다. `analysisStep`·`decisionStep`·`dialogueStep` 도
//    `app/api/**` 의 라우트 셋도 그대로 있고, 아래 둘째 단추가 그 길을 계속 쓴다.
//    **화면이 셋을 이어 부르는 것은 파이썬이 하던 그 일이다.**
//
// ⛔ **이 화면은 모드도 장면 종료도 계산하지 않는다** (경계 6).
//    - 다음에 무엇을 할지 → `nextStep()` 이 정한 `next_action.kind` 를 읽을 뿐이다
//    - 모드·반응 키 → ② 가 낸 값을 그대로 폼에 채운다. 사람이 고쳐 ③ 만 다시 돌릴 수 있다
//    - `decide()` 를 여기서 다시 구현하지 않는다
//
// ⚠️ 단계 사이의 값을 **화면이 들고 있지 않는다.** 새로고침해도 같은 자리가 나온다 —
//    `service/view.pendingDraft()` 가 저장된 사실(`utterance_analyses`·`turn_conditions`)에서
//    「어디까지 갔나」를 다시 세우기 때문이다 (FR-040).

import { connection } from 'next/server'

import { elementName } from '@/llm/elements'
import { runDetail, type RunDetail } from '@/llm/service/view'

import {
  advanceAction,
  analysisAction,
  decisionAction,
  dialogueAction,
  resumeAction,
  turnAction,
} from '../actions'
import { 보내기 } from '../submit'
import { 개발자용, 곁링크, 화면머리말 } from '../../ui'
import { 대화줄, 라벨, 시도링크, 어느_패널, 오류띠, 칸들, 표기, 한칸 } from '../ui'

export const metadata = { title: '회차 진행 — 굿퀘스천 관리자' }

export default async function RunPage({
  params,
  searchParams,
}: {
  // ⚠️ Next 16 에서 `params`·`searchParams` 는 둘 다 **프라미스**다.
  params: Promise<{ run_id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await connection()
  const { run_id } = await params
  const 오류 = 한칸((await searchParams).error)
  const 상세 = await runDetail(run_id)

  return (
    <main className="flex flex-col gap-6">
      {오류 !== null && <오류띠 문구={오류} />}
      <머리 상세={상세} />
      <현재장면 상세={상세} />
      <단계패널 상세={상세} />
      <이장면_대화 상세={상세} />
    </main>
  )
}

// ═══════════════════════════════════════════════════════════════════════════

function 머리({ 상세 }: { 상세: RunDetail }) {
  const { run, session, next_action } = 상세
  return (
    <section className="flex flex-col gap-4">
      <화면머리말
        제목={session.story_title}
        설명="이 회차에서 아이와 AI 가 주고받은 말과, 무엇으로 돌렸는지를 봅니다."
        곁들이기={
          <span className="flex flex-wrap items-baseline gap-4">
            <곁링크 href="/runs">← 회차 목록</곁링크>
            <곁링크 href={`/runs/${run.id}/log`}>차례별 기록 →</곁링크>
            {/* ⚠️ 이게 없으면 회차에서 검수로 갈 방법이 없다. */}
            <곁링크 href={`/review/runs/${run.id}`}>검수 →</곁링크>
          </span>
        }
      />

      {/* 🔴 목록에서 뺀 넷(어디까지·지시문 판·시작한 사람·끝난 시각)이 여기 있다 (규칙 1-5).
          보이는 이름은 사람 말이고, DB 컬럼명은 아래 「개발자용」에 그대로 남는다 (규칙 1-1). */}
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-[14px]">
        {(
          [
            ['어디까지 진행', run.scope === 'scene' ? `${run.scene_order}번째 장면만` : '이야기 전체'],
            ['지금 상태', session.status],
            ['아이 말을 알아듣는 AI', `${run.analysis_model ?? '기록 없음'} · 생각 깊이 ${run.analysis_effort ?? '기록 없음'}`],
            // ⭐ 강도도 함께 적는다 — 모델만으로는 「무엇으로 돌렸나」가 반쪽이다.
            //    `runSettings()` 가 이 한 값을 **두 공급자에 다** 흘린다 (2026-08-11).
            ['캐릭터가 되어 말하는 AI', `${run.character_model ?? '기록 없음'} · 생각 깊이 ${run.character_effort ?? '기록 없음'}`],
            ['지시문 판 번호', run.prompt_version],
            ['다음 할 일', `${next_action.kind}${next_action.reason ? ` (${next_action.reason})` : ''}`],
          ] as const
        ).map(([이름, 값]) => (
          <div key={이름} className="contents">
            <dt className="whitespace-nowrap font-bold text-ink-soft">{이름}</dt>
            <dd className="break-all text-ink">{값}</dd>
          </div>
        ))}
      </dl>

      <개발자용 제목="이 회차의 원래 값">
        <칸들
          값들={[
            ['run_id', run.id],
            ['session_id', session.id],
            ['status', session.status],
            ['scope', run.scope],
            ['scene_order', run.scene_order],
            ['prompt_version', run.prompt_version],
            ['analysis_model', run.analysis_model],
            ['analysis_effort', run.analysis_effort],
            ['character_model', run.character_model],
            ['character_effort', run.character_effort],
          ]}
        />
      </개발자용>

      {상세.progress !== null && (
        <p className="rounded-2xl border border-primary bg-primary-soft px-5 py-3 text-[15px] text-primary-strong">
          <span className="mr-1.5 animate-pulse">●</span>
          지금 도는 중입니다 — {상세.progress}
        </p>
      )}
      {상세.failure !== null && <실패띠 상세={상세} />}
    </section>
  )
}

/** 띠에 적을 단계 이름. 파이썬 `turn.html` 의 `"분석" if … else "캐릭터 대사"` 자리다. */
const 단계이름: Record<string, string> = {
  analysis: '분석',
  decision: '판단',
  character: '캐릭터 대사',
}

/**
 * 끝나지 않은 턴.
 *
 * ⚠️ **「실패했다」의 근거는 `llm_calls` 의 실패 행이다.** 미완 조건만 보면 실패한 턴과
 *    아직 도는 중인 턴이 똑같이 만족한다 (`service/run.turnFailureState()` 머리말).
 *
 * 🔴 **정상 대기에는 이 띠가 아예 안 온다** (2026-08-13). ②직후·③직후의 대기까지 「죽은
 *    단계」로 그려서 사람이 「왜 자꾸 죽었다고 하냐」고 물었다. 무엇을 낼지는
 *    `turnFailureState()` 가 정하고 여기서는 온 것을 그릴 뿐이다.
 *
 * ⭐ 갈래 둘의 **설명 문장을 파이썬 `templates/turn.html` 에서 되살렸다.** `stage=…` 한 줄만
 *    있으면 무슨 일이 난 것인지, 다시 눌러도 되는지가 화면에 없다.
 */
function 실패띠({ 상세 }: { 상세: RunDetail }) {
  const 실패 = 상세.failure
  if (실패 === null) return null
  const 이름 = 단계이름[실패.stage] ?? 실패.stage
  return (
    <div className="flex flex-col gap-1 border border-warn px-3 py-2 text-xs">
      {실패.failed ? (
        <p>
          <strong>두 공급자가 다 실패했다</strong> — {이름} 단계에서 끊겼다.
        </p>
      ) : (
        <>
          <p>
            <strong>끝나지 않은 턴</strong> — {이름} 단계에서 멈췄다.
          </p>
          {/* ⚠️ 실패라고 단정하지 않는다. 사유가 없다는 것은 「안 났다」가 아니라 「기록될
              틈이 없었다」일 수 있다 (파이썬 `turn.html` 의 같은 문장). */}
          <p className="text-ink-muted">
            기록된 실패 사유가 하나도 없다. 실패라고 단정하지 않는다 — 서버가 도중에
            내려갔거나, 시도 기록이 남기 전에 끊긴 옛 턴이다.
          </p>
        </>
      )}
      <p className="font-mono text-ink-muted">
        stage={실패.stage} · message_id={실패.message_id}{' '}
        {/* ⭐ 「왜 죽었나」의 원문이 저기 있다 — 사유 한 줄만으로는 보낸 프롬프트를 못 본다. */}
        <시도링크 run_id={상세.run.id} message_id={실패.message_id} />
      </p>
      {실패.reasons.map((사유) => (
        <p key={사유.id} className="font-mono text-ink-muted">
          {사유.purpose} #{사유.attempt_no} {사유.provider}/{사유.model}: {사유.error}
        </p>
      ))}
      <form action={resumeAction} className="mt-1">
        <input type="hidden" name="run_id" value={상세.run.id} />
        <input type="hidden" name="child_message_id" value={실패.message_id} />
        <보내기 className="border border-divider px-2 py-1" 도는중="이어 돌리는 중…">
          죽은 단계부터 이어 돌리기
        </보내기>
      </form>
    </div>
  )
}

function 현재장면({ 상세 }: { 상세: RunDetail }) {
  const 장면 = 상세.current_scene
  if (장면 === null) {
    return <p className="text-xs text-ink-muted">아직 어느 장면에도 들어가지 않았다.</p>
  }
  const { session } = 상세
  return (
    <section className="flex flex-col gap-3 border border-divider p-3">
      <h3 className="font-semibold">
        장면 {장면.scene_order} · {장면.character_name ?? '(전개)'}{' '}
        <span className="font-mono text-xs text-ink-muted">{장면.code}</span>
      </h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <칸들
          값들={[
            ['required_elements', 장면.required_elements],
            ['preferred_turns', 장면.preferred_turns],
            ['max_turns', 장면.max_turns],
          ]}
        />
        <칸들
          값들={[
            ['current_child_turn_count', session.current_child_turn_count],
            ['accumulated_elements', session.accumulated_elements],
            // ⚠️ 저장하지 않는다. `required − accumulated` 로 매번 뺀다 (경계 5).
            ['missing_elements', 상세.current_missing_elements],
            ['last_response_mode', session.last_response_mode],
            ['last_guidance_target', session.last_guidance_target],
            ['turns_without_new_element', session.turns_without_new_element],
            ['consecutive_low_information_turns', session.consecutive_low_information_turns],
            ['scene_goal_met', session.scene_goal_met],
            ['scene_end_reason', session.scene_end_reason],
          ]}
        />
      </div>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 단계 패널 — 지금 부를 차례인 것 하나만 보인다
// ═══════════════════════════════════════════════════════════════════════════

function 단계패널({ 상세 }: { 상세: RunDetail }) {
  const { next_action, pending, run, session } = 상세
  const 패널 = 어느_패널({
    progress: 상세.progress,
    pending_stage: pending?.stage ?? null,
    next_action_kind: next_action.kind,
  })

  // 🔴 이 회차가 **지금 돌고 있다.** 폼을 하나도 내지 않는다 — 도는 동안 다시 누르면
  //    회차 잠금에 걸려 409 `TURN_IN_PROGRESS` 가 나고, 그 턴은 반쯤 간 채로 남는다.
  //    파이썬도 도는 동안에는 발화 폼을 안 냈다 (`run_body.html` 의 `{% elif progress %}`).
  if (패널 === '도는중') {
    return (
      <p className="border border-blue-500 px-3 py-2 text-xs">
        이 회차는 지금 돌고 있다 — {상세.progress}. 끝나면 이 쪽을 새로고침해라.
        <br />
        ⛔ 다시 누르지 마라. 같은 회차에 두 번 보내면 뒤엣것이 409 `TURN_IN_PROGRESS` 로
        튕긴다.
      </p>
    )
  }

  // 끝나지 않은 턴이 있으면 그 턴을 이어 돌리는 것이 유일하게 할 수 있는 일이다.
  // 새 발화를 받으면 `messages` 행이 하나 더 생겨 턴 수가 어긋난다 (FR-035).
  if (패널 === '판단' && pending !== null) return <판단폼 상세={상세} pending={pending} />
  if (패널 === '대사' && pending !== null) return <대사폼 상세={상세} pending={pending} />
  if (패널 === '분석에서끊김' && pending !== null) {
    // ① 이 죽었다. 실패띠의 「이어 돌리기」가 그 자리다 — 도는 중이 아니므로 그 띠가 있다.
    return (
      <p className="text-xs text-ink-muted">
        이 턴은 분석 단계에서 끊겼다 (message_id={pending.message_id}). 위의 「이어 돌리기」로
        잇는다.
      </p>
    )
  }

  if (패널 === '분석') {
    return (
      <section className="flex flex-col gap-2">
        <h3 className="font-semibold">아이 발화를 넣는다 — 한 턴이 끝까지 돈다 (①②③)</h3>
        <form action={turnAction} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="run_id" value={run.id} />
          {/* ⚠️ `turnAction` 은 이 값을 안 쓴다 (열쇠가 `run_id` 다). 둘째 단추의
              `analysisAction` 이 쓰므로 폼에 남는다 — 스키마가 하나여야 단추 둘이 같은 폼을 쏜다. */}
          <input type="hidden" name="session_id" value={session.id} />
          <라벨 이름="child_utterance">
            <input
              name="child_utterance"
              className="w-[32rem] max-w-full border px-2 py-1"
              autoComplete="off"
            />
          </라벨>
          {/* 🔴 **순서가 중요하다.** 입력칸에서 엔터를 치면 브라우저가 **첫 제출 단추**를 누른다.
              뒤집으면 엔터가 「① 분석만」이 되어 파이썬과 다른 손버릇이 된다. */}
          {/* ⭐ 눌린 뒤 스스로 잠긴다 — LLM 이 6초씩 걸려 사람이 다시 누른 것이 2026-08-13 버그다.
              🔴 `표식` 이 없으면 **안 눌린 단추까지 제 글자를 바꾼다.** 「① 분석만」을 눌렀는데
                 옆 단추가 「한 턴 도는 중… (LLM 2회)」라고 말하던 자리다 — 그때 나가는 LLM 은
                 1회다. 잠기는 것은 그대로 둔다(둘 다 누르면 409). 글자만 눌린 쪽에 붙는다. */}
          {/* ⚠️ 둘째 단추에는 `표식` 이 없다 — `formAction` 이 붙은 단추의 `name` 은 React 가
              액션 id 로 덮어쓴다. 그쪽은 `status.action` 으로 가른다 (`submit.tsx`). */}
          <보내기 표식="turn" 도는중="한 턴 도는 중… (LLM 2회)">한 턴 돌리기 (①②③)</보내기>
          <보내기
            formAction={analysisAction}
            className="border border-divider px-3 py-1"
            도는중="분석 중… (LLM)"
          >
            ① 분석만 (검수)
          </보내기>
        </form>
        <p className="text-xs text-ink-muted">
          ⚠️ 진짜 LLM 이 나간다. 기본은 무료 `flash-lite` 지만 실제 호출이다.
          <br />
          「① 분석만」을 누르면 ②③ 패널이 차례로 뜬다. 중간에 그만두면 위의 「이어 돌리기」가 남은
          단계를 끝낸다.
        </p>
      </section>
    )
  }

  if (next_action.kind === '장면시작') {
    return (
      <form action={advanceAction}>
        <input type="hidden" name="run_id" value={run.id} />
        <보내기>다음 장면으로 (전개 재생 · LLM 0회)</보내기>
      </form>
    )
  }

  return (
    <p className="font-mono text-xs">
      {next_action.kind}
      {next_action.reason === null ? '' : ` (${next_action.reason})`} — 더 넣을 발화가 없다.
    </p>
  )
}

/** ② 판단. ① 이 낸 값을 **그대로** 돌려보낸다 (계약 4절의 메아리). */
function 판단폼({
  상세,
  pending,
}: {
  상세: RunDetail
  pending: NonNullable<RunDetail['pending']>
}) {
  const 분석 = pending.analysis
  if (분석 === null) return null
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold">② 판단 — `decide()` 순수 함수 한 번 (LLM 아님)</h3>
      <p className="font-mono text-xs">
        turn_order={pending.turn_order} · child_utterance={표기(pending.child_utterance)}
      </p>
      <칸들
        값들={[
          ['child_intent', 분석.child_intent],
          ['main_point', 분석.main_point],
          ['utterance_validity', 분석.utterance_validity],
          ['detected_elements', 분석.detected_elements.map((요소) => 요소.type)],
          ['버림', 분석.dropped],
        ]}
      />
      <form action={decisionAction} className="flex flex-col gap-2">
        <input type="hidden" name="run_id" value={상세.run.id} />
        <input type="hidden" name="session_id" value={상세.session.id} />
        <input type="hidden" name="message_id" value={pending.message_id} />
        <input type="hidden" name="child_intent" value={분석.child_intent} />
        <input type="hidden" name="utterance_validity" value={분석.utterance_validity} />
        <fieldset className="flex flex-wrap items-center gap-3 border border-divider p-2">
          <legend className="font-mono text-xs text-ink-muted">detected_elements (후처리 뒤)</legend>
          {분석.detected_elements_kept.length === 0 && (
            <span className="font-mono text-xs">[] — 남은 요소가 없다</span>
          )}
          {분석.detected_elements_kept.map((코드) => (
            <label key={코드} className="flex items-center gap-1 font-mono text-xs">
              <input type="checkbox" name="detected_elements" value={코드} defaultChecked />
              {코드} ({elementName(코드)})
            </label>
          ))}
        </fieldset>
        <보내기 className="w-fit border border-divider px-3 py-1 font-semibold">판단</보내기>
      </form>
    </section>
  )
}

/**
 * ③ 대사.
 *
 * 🔴 모드·반응 키가 **고칠 수 있는 칸**인 것이 이 레포의 존재 이유다 (계약 1절).
 * ⛔ CLOSING 이면 캐릭터 LLM 을 아예 안 부른다 — 그 갈림은 `characterTurn()` 안에 있고
 *    이 화면은 값을 넘길 뿐이다 (경계 4).
 */
function 대사폼({
  상세,
  pending,
}: {
  상세: RunDetail
  pending: NonNullable<RunDetail['pending']>
}) {
  const 판정 = pending.decision
  if (판정 === null) return null
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold">③ 대사</h3>
      <칸들
        값들={[
          ['response_mode', 판정.response_mode],
          ['guidance_target', 판정.guidance_target],
          ['soft_cue', 판정.soft_cue],
          ['reaction_key', 판정.reaction_key],
          ['scene_goal_met', 판정.scene_goal_met],
          ['scene_end_reason', 판정.scene_end_reason],
        ]}
      />
      <form action={dialogueAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="run_id" value={상세.run.id} />
        <input type="hidden" name="session_id" value={상세.session.id} />
        <input type="hidden" name="message_id" value={pending.message_id} />
        <라벨 이름="response_mode">
          <select
            name="response_mode"
            className="border px-2 py-1 font-mono"
            defaultValue={판정.response_mode}
          >
            {['NORMAL', 'GUIDED', 'CLOSING'].map((모드) => (
              <option key={모드} value={모드}>
                {모드}
              </option>
            ))}
          </select>
        </라벨>
        <라벨 이름="reaction_key">
          <input
            name="reaction_key"
            defaultValue={판정.reaction_key}
            className="w-48 border px-2 py-1 font-mono"
          />
        </라벨>
        <라벨 이름="guidance_target">
          <input
            name="guidance_target"
            defaultValue={판정.guidance_target ?? ''}
            className="w-36 border px-2 py-1 font-mono"
          />
        </라벨>
        <라벨 이름="main_point">
          <input
            name="main_point"
            defaultValue={pending.analysis?.main_point ?? ''}
            className="w-72 border px-2 py-1"
          />
        </라벨>
        <보내기 도는중="대사 만드는 중… (LLM)">대사</보내기>
      </form>
      <p className="text-xs text-ink-muted">
        ⭐ 같은 message_id 로 다시 눌러도 된다 — 캐릭터 `messages` 행을 덮어쓴다 (계약 8절).
      </p>
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════════════════

/** 지금 장면의 대화만. 회차 전체는 턴 로그 화면이 그린다. */
function 이장면_대화({ 상세 }: { 상세: RunDetail }) {
  const scene_id = 상세.current_scene?.scene_id
  if (scene_id === undefined) return null
  const 줄들 = 상세.messages.filter((행) => 행.scene_id === scene_id)
  if (줄들.length === 0) return null

  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-semibold">이 장면의 대화 {줄들.length}줄</h3>
      <ol className="flex flex-col gap-2">
        {줄들.map((행) => (
          <대화줄 key={행.id} run_id={상세.run.id} 행={행} />
        ))}
      </ol>
    </section>
  )
}
