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
//
// ## 2026-08-15 — 글자를 사람 말로 (규칙 1-1)
//
// 🔴 **이 화면이 규칙 1-1 을 가장 크게 어기고 있었다.** 단추가 「한 턴 돌리기 (①②③)」,
//    입력칸 라벨이 `child_utterance`, 대화 줄 머리가 `turn_order=10 speaker_type=character`,
//    그 아래가 `[분석] child_intent=OFF_TOPIC …` 세 줄이었다. AI 도 우리 DB 도 모르는
//    운영자가 직접 클릭하는 화면인데 **읽을 수 있는 글자가 거의 없었다.**
//
// 🔴 **폼 칸 이름(`name`)은 하나도 안 바꿨다.** 바꾸면 서버 액션이 값을 못 찾는다
//    (`actions.ts` 의 zod 스키마들). 바뀐 것은 **사람이 읽는 글자뿐**이고, 영문 원래 이름은
//    「개발자용」 안과 `title=` 툴팁에 남는다 (규칙 1-4).
//
// ⛔ **확인창을 달지 않는다** (규칙 3-5). AI 를 부르는 단추의 예고는 **단추 글자와 색**이고
//    (규칙 3-6), 두 번 눌리는 것은 `보내기` 의 즉시 잠금이 막는다 (규칙 3-7).

import { connection } from 'next/server'

import { elementMeaning, elementName } from '@/llm/elements'
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
import { 값, 개발자용, 곁링크, 단추, 빈자리, 입력칸, 카드, 화면머리말 } from '../../ui'
import { 대화줄, 라벨, 시도링크, 어느_패널, 오류띠, 칸들, 한칸 } from '../ui'
import {
  다음할일이름,
  단계이름,
  모드이름,
  반응이름,
  요소_코드들,
  요소칩들,
  이름표,
  작은묶음,
  장면끝이름,
  정한것,
  진행상태이름,
  풀이표,
  말읽기,
} from '../wording'

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
  const 할일 = 이름표(다음할일이름, next_action.kind) ?? next_action.kind
  const 까닭 = 이름표(장면끝이름, next_action.reason)
  return (
    <section className="flex flex-col gap-4">
      <화면머리말
        제목={session.story_title}
        설명="이 회차에서 아이와 AI 가 주고받은 말과, 무엇으로 돌렸는지를 봅니다. 아래에서 아이가 할 말을 직접 넣어 다음 차례를 진행해 볼 수도 있습니다."
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
            ['지금 상태', 이름표(진행상태이름, session.status) ?? session.status],
            ['아이 말을 알아듣는 AI', `${run.analysis_model ?? '기록 없음'} · 생각 깊이 ${run.analysis_effort ?? '기록 없음'}`],
            // ⭐ 강도도 함께 적는다 — 모델만으로는 「무엇으로 돌렸나」가 반쪽이다.
            //    `runSettings()` 가 이 한 값을 **두 공급자에 다** 흘린다 (2026-08-11).
            ['캐릭터가 되어 말하는 AI', `${run.character_model ?? '기록 없음'} · 생각 깊이 ${run.character_effort ?? '기록 없음'}`],
            ['지시문 판 번호', run.prompt_version],
            ['다음 할 일', 까닭 === null ? 할일 : `${할일} — ${까닭}`],
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
            ['next_action.kind', next_action.kind],
            ['next_action.reason', next_action.reason],
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
  const 이름 = 이름표(단계이름, 실패.stage) ?? 실패.stage
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-warn bg-warn-soft px-5 py-4">
      {실패.failed ? (
        <p className="text-[15px] font-bold text-warn">
          이 차례는 「{이름}」에서 멈췄습니다. 예비 AI 까지 물어봤지만 둘 다 답하지 못했습니다.
        </p>
      ) : (
        <>
          <p className="text-[15px] font-bold text-warn">
            이 차례는 「{이름}」에서 멈춘 채 남아 있습니다.
          </p>
          {/* ⚠️ 실패라고 단정하지 않는다. 사유가 없다는 것은 「안 났다」가 아니라 「기록될
              틈이 없었다」일 수 있다 (파이썬 `turn.html` 의 같은 문장). */}
          <p className="text-[14px] text-ink">
            남은 실패 기록이 하나도 없어서 실패라고 단정하지 않습니다. 서버가 도중에 꺼졌거나,
            기록이 남기 전에 끊긴 오래된 차례일 수 있습니다.
          </p>
        </>
      )}
      <p className="text-[14px] text-ink">
        아래 단추를 누르면 <b>멈춘 곳부터</b> 이어서 돕니다. 아이가 한 말을 다시 넣지 않아도 되고,
        말한 횟수도 늘지 않습니다.
      </p>
      <form action={resumeAction}>
        <input type="hidden" name="run_id" value={상세.run.id} />
        <input type="hidden" name="child_message_id" value={실패.message_id} />
        {/* 규칙 3-6 — AI 를 부르는 단추는 색과 글자 둘 다로 알린다. */}
        <보내기 className={단추.AI} 도는중="이어 돌리는 중…">
          멈춘 곳부터 이어 돌리기 (AI 호출)
        </보내기>
      </form>
      {/* ⭐ 「왜 죽었나」의 원문이 저기 있다 — 사유 한 줄만으로는 보낸 프롬프트를 못 본다. */}
      <p>
        <시도링크 run_id={상세.run.id} message_id={실패.message_id} />
      </p>
      <개발자용 제목="멈춘 자리와 실패 사유 원문">
        <칸들
          값들={[
            ['stage', 실패.stage],
            ['message_id', 실패.message_id],
          ]}
        />
        {실패.reasons.length === 0 ? (
          <p className="mt-2 font-mono text-xs text-ink-muted">기록된 실패 사유 없음</p>
        ) : (
          실패.reasons.map((사유) => (
            <p key={사유.id} className="mt-2 font-mono text-xs break-all text-ink-muted">
              {사유.purpose} #{사유.attempt_no} {사유.provider}/{사유.model}: {사유.error}
            </p>
          ))
        )}
      </개발자용>
    </div>
  )
}

function 현재장면({ 상세 }: { 상세: RunDetail }) {
  const 장면 = 상세.current_scene
  if (장면 === null) {
    return (
      <카드 제목="지금 장면">
        <빈자리
          무엇="아직 어느 장면에도 들어가지 않았습니다."
          다음="아래 「다음 장면으로」를 눌러 이야기를 진행해 보세요."
        />
      </카드>
    )
  }
  const { session } = 상세
  return (
    <카드
      제목={`지금 장면 · ${장면.scene_order}번째 ${장면.character_name ?? '(대사 없는 전개)'}`}
      설명="이 장면에서 아이에게 끌어내려는 것이 무엇인지, 지금까지 얼마나 채웠는지를 봅니다."
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <작은묶음 제목="이 장면에 미리 정해 둔 것">
          <풀이표
            줄들={[
              {
                이름: '끌어낼 생각 조각',
                원래: 'required_elements',
                값: <요소칩들 코드들={장면.required_elements} />,
              },
              {
                이름: '적어도 몇 번은 주고받기',
                원래: 'preferred_turns',
                값: (
                  <값
                    것={장면.preferred_turns === null ? null : `${장면.preferred_turns}번`}
                    없을때="정해 두지 않음"
                  />
                ),
              },
              {
                이름: '많아야 몇 번까지',
                원래: 'max_turns',
                값: (
                  <값
                    것={장면.max_turns === null ? null : `${장면.max_turns}번`}
                    없을때="정해 두지 않음"
                  />
                ),
              },
            ]}
          />
        </작은묶음>

        {/* ⚠️ `missing_elements` 는 저장하지 않는다. `required − accumulated` 로 매번 뺀다 (경계 5). */}
        <작은묶음 제목="여기까지 온 것">
          <풀이표
            줄들={[
              {
                이름: '아이가 말한 횟수',
                원래: 'current_child_turn_count',
                값: `${session.current_child_turn_count}번`,
              },
              {
                이름: '지금까지 모은 생각 조각',
                원래: 'accumulated_elements',
                값: <요소칩들 코드들={session.accumulated_elements} />,
              },
              {
                이름: '아직 안 나온 생각 조각',
                원래: 'missing_elements',
                값: <요소칩들 코드들={상세.current_missing_elements} />,
              },
              {
                이름: '직전에 캐릭터가 답한 방식',
                원래: 'last_response_mode',
                값: <값 것={이름표(모드이름, session.last_response_mode)} 없을때="아직 없음" />,
              },
              {
                이름: '직전에 끌어내려 한 조각',
                원래: 'last_guidance_target',
                값: (
                  <요소칩들
                    코드들={
                      session.last_guidance_target === null ? [] : [session.last_guidance_target]
                    }
                  />
                ),
              },
              {
                이름: '새 조각이 안 나온 채 이어진 차례',
                원래: 'turns_without_new_element',
                값: `${session.turns_without_new_element}번`,
              },
              {
                이름: '짧거나 딴소리가 이어진 차례',
                원래: 'consecutive_low_information_turns',
                값: `${session.consecutive_low_information_turns}번`,
              },
              {
                이름: '끌어낼 것을 다 채웠나',
                원래: 'scene_goal_met',
                값: <값 것={session.scene_goal_met} />,
              },
              {
                이름: '이 장면이 끝났나',
                원래: 'scene_end_reason',
                값: (
                  <값
                    것={이름표(장면끝이름, session.scene_end_reason)}
                    없을때="아직 진행 중입니다"
                  />
                ),
              },
            ]}
          />
        </작은묶음>
      </div>

      <개발자용 제목="이 장면의 원래 값">
        <칸들
          값들={[
            ['scene_id', 장면.scene_id],
            ['code', 장면.code],
            ['scene_order', 장면.scene_order],
            ['required_elements', 장면.required_elements],
            ['preferred_turns', 장면.preferred_turns],
            ['max_turns', 장면.max_turns],
            ['current_child_turn_count', session.current_child_turn_count],
            ['accumulated_elements', session.accumulated_elements],
            ['missing_elements', 상세.current_missing_elements],
            ['last_response_mode', session.last_response_mode],
            ['last_guidance_target', session.last_guidance_target],
            ['turns_without_new_element', session.turns_without_new_element],
            ['consecutive_low_information_turns', session.consecutive_low_information_turns],
            ['scene_goal_met', session.scene_goal_met],
            ['scene_end_reason', session.scene_end_reason],
          ]}
        />
      </개발자용>
    </카드>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 단계 패널 — 지금 부를 차례인 것 하나만 보인다
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 「턴」이 무엇인지 화면에서 처음 쓰는 자리마다 붙이는 한 줄 (규칙 2-2).
 *
 * ⭐ 용어를 없애지 않고 **처음 나올 때 뜻을 적는다.** 팀은 「턴」이라 부르고 운영자는 모른다.
 */
const 턴_풀이 =
  '한 차례는 아이가 한 번 말하면 AI 가 그 말을 읽고, 다음에 무엇을 할지 정하고, 캐릭터가 대답하기까지의 한 묶음입니다.'

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
      <카드 제목="지금 할 일">
        <p className="rounded-2xl border border-primary bg-primary-soft px-5 py-4 text-[15px] text-primary-strong">
          <span className="mr-1.5 animate-pulse">●</span>
          지금 AI 가 답을 만드는 중입니다 — {상세.progress}. 끝나면 이 화면을 새로고침해 주세요.
          <br />
          같은 회차에 두 번 보내면 뒤엣것은 받아들여지지 않습니다. 기다려 주세요.
        </p>
      </카드>
    )
  }

  // 끝나지 않은 턴이 있으면 그 턴을 이어 돌리는 것이 유일하게 할 수 있는 일이다.
  // 새 발화를 받으면 `messages` 행이 하나 더 생겨 턴 수가 어긋난다 (FR-035).
  if (패널 === '판단' && pending !== null) return <판단폼 상세={상세} pending={pending} />
  if (패널 === '대사' && pending !== null) return <대사폼 상세={상세} pending={pending} />
  if (패널 === '분석에서끊김' && pending !== null) {
    // ① 이 죽었다. 실패띠의 「이어 돌리기」가 그 자리다 — 도는 중이 아니므로 그 띠가 있다.
    return (
      <카드 제목="지금 할 일">
        <p className="text-[15px] text-ink">
          이 차례는 <b>아이 말 읽기</b>에서 멈췄습니다. 위쪽 「멈춘 곳부터 이어 돌리기」를 누르면
          남은 단계를 마저 돕니다.
        </p>
        <개발자용 제목="멈춘 차례의 아이디">
          <칸들 값들={[['message_id', pending.message_id]]} />
        </개발자용>
      </카드>
    )
  }

  if (패널 === '분석') {
    return (
      <카드
        제목="아이가 할 말을 넣어 봅니다"
        설명={`${턴_풀이} 아래에 아이가 할 법한 말을 적고 단추를 누르면 그 한 묶음이 끝까지 돕니다.`}
      >
        <form action={turnAction} className="flex flex-col gap-4">
          <input type="hidden" name="run_id" value={run.id} />
          {/* ⚠️ `turnAction` 은 이 값을 안 쓴다 (열쇠가 `run_id` 다). 둘째 단추의
              `analysisAction` 이 쓰므로 폼에 남는다 — 스키마가 하나여야 단추 둘이 같은 폼을 쏜다. */}
          <input type="hidden" name="session_id" value={session.id} />
          {/* 🔴 라벨이 `child_utterance` 였다 (규칙 1-1). 칸 이름은 그대로, 글자만 바꾼다. */}
          <라벨 이름="아이가 한 말" 도움말="아이가 이 장면에서 할 법한 말을 그대로 적습니다">
            <input
              name="child_utterance"
              className={`w-[34rem] max-w-full ${입력칸}`}
              autoComplete="off"
            />
          </라벨>

          <div className="flex flex-wrap items-center gap-3">
            {/* 🔴 **순서가 중요하다.** 입력칸에서 엔터를 치면 브라우저가 **첫 제출 단추**를 누른다.
                뒤집으면 엔터가 「분석만」이 되어 파이썬과 다른 손버릇이 된다. */}
            {/* ⭐ 눌린 뒤 스스로 잠긴다 — LLM 이 6초씩 걸려 사람이 다시 누른 것이 2026-08-13 버그다.
                🔴 `표식` 이 없으면 **안 눌린 단추까지 제 글자를 바꾼다.** 잠기는 것은 그대로 둔다
                   (둘 다 누르면 409). 글자만 눌린 쪽에 붙는다. */}
            <보내기
              className={단추.AI}
              표식="turn"
              도는중="AI 가 답을 만드는 중… (2번 부릅니다)"
            >
              캐릭터 대답까지 한 번에 (AI 호출)
            </보내기>
            {/* ⚠️ 둘째 단추에는 `표식` 이 없다 — `formAction` 이 붙은 단추의 `name` 은 React 가
                액션 id 로 덮어쓴다. 그쪽은 `status.action` 으로 가른다 (`submit.tsx`). */}
            <보내기
              formAction={analysisAction}
              className={단추.보통}
              도는중="아이 말을 읽는 중…"
            >
              아이 말만 먼저 읽어 보기 (AI 호출)
            </보내기>
          </div>
        </form>

        {/* 규칙 3-5 — 확인창 대신 단추 글자와 이 안내가 예고를 맡는다. */}
        <div className="flex flex-col gap-1 text-[14px] text-ink-muted">
          <p>
            두 단추 모두 <b>진짜 AI 를 부릅니다.</b> 기본으로 쓰는 것은 무료 등급 모델이지만
            실제 호출이고, 몇 초 걸립니다.
          </p>
          <p>
            「아이 말만 먼저 읽어 보기」를 누르면 AI 가 읽은 결과를 사람이 먼저 확인하고, 다음에
            무엇을 할지와 캐릭터 대답을 한 단계씩 눌러 볼 수 있습니다. 중간에 그만두면 위쪽
            「멈춘 곳부터 이어 돌리기」가 남은 단계를 끝냅니다.
          </p>
        </div>
      </카드>
    )
  }

  if (next_action.kind === '장면시작') {
    return (
      <카드
        제목="지금 할 일"
        설명="다음 장면의 전개 지문을 재생합니다. 미리 적어 둔 대사만 나오고 AI 는 부르지 않습니다."
      >
        <form action={advanceAction}>
          <input type="hidden" name="run_id" value={run.id} />
          <보내기 className={단추.주된} 도는중="다음 장면으로 가는 중…">
            다음 장면으로 (AI 안 부름)
          </보내기>
        </form>
      </카드>
    )
  }

  const 할일 = 이름표(다음할일이름, next_action.kind) ?? next_action.kind
  const 까닭 = 이름표(장면끝이름, next_action.reason)
  return (
    <카드 제목="지금 할 일">
      <빈자리
        무엇={까닭 === null ? 할일 : `${할일} — ${까닭}`}
        다음="이 회차에서 더 넣을 말이 없습니다. 위 「차례별 기록」에서 오간 말을 되짚어 보세요."
      />
    </카드>
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
    <카드
      제목="이 말을 받아 다음에 무엇을 할지 정합니다"
      설명="여기서는 AI 를 부르지 않습니다. 정해 둔 규칙으로 계산할 뿐이라 값이 늘 같고, 시간도 돈도 들지 않습니다."
    >
      <p className="text-[15px] text-ink">
        <span className="mr-2 rounded-lg bg-chip px-2.5 py-1 text-[13px] font-bold text-ink-mid">
          {pending.turn_order}번째 차례
        </span>
        아이가 한 말 — 「{pending.child_utterance}」
      </p>

      <말읽기
        분석={{
          child_intent: 분석.child_intent,
          main_point: 분석.main_point,
          detected_elements: 분석.detected_elements,
          utterance_validity: 분석.utterance_validity,
          dropped: 분석.dropped,
        }}
      />

      <form action={decisionAction} className="flex flex-col gap-4">
        <input type="hidden" name="run_id" value={상세.run.id} />
        <input type="hidden" name="session_id" value={상세.session.id} />
        <input type="hidden" name="message_id" value={pending.message_id} />
        <input type="hidden" name="child_intent" value={분석.child_intent} />
        <input type="hidden" name="utterance_validity" value={분석.utterance_validity} />
        <fieldset className="flex flex-col gap-2 rounded-2xl border border-divider px-4 py-3">
          <legend className="px-1 text-[15px] font-extrabold text-ink">
            이번에 인정할 생각 조각
          </legend>
          <p className="text-[13px] text-ink-faint">
            아이 말에 근거가 실제로 있는 것만 남았습니다. 체크를 풀고 다시 정하면 그만큼 빼고
            계산합니다.
          </p>
          {분석.detected_elements_kept.length === 0 && (
            <span className="text-[14px] text-ink-faint">남은 것이 없습니다.</span>
          )}
          <div className="flex flex-wrap items-center gap-4">
            {분석.detected_elements_kept.map((코드) => (
              <label
                key={코드}
                className="flex items-center gap-1.5 text-[15px] text-ink"
                title={`${코드} — ${elementMeaning(코드)}`}
              >
                <input
                  type="checkbox"
                  name="detected_elements"
                  value={코드}
                  defaultChecked
                  className="accent-primary"
                />
                {elementName(코드)}
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <보내기 className={단추.주된} 도는중="정하는 중…">
            이대로 다음 행동 정하기 (AI 안 부름)
          </보내기>
        </div>
      </form>

      <개발자용 제목="이 차례의 원래 값">
        <칸들
          값들={[
            ['message_id', pending.message_id],
            ['turn_order', pending.turn_order],
            ['child_utterance', pending.child_utterance],
            ['child_intent', 분석.child_intent],
            ['main_point', 분석.main_point],
            ['utterance_validity', 분석.utterance_validity],
            ['detected_elements', 분석.detected_elements.map((요소) => 요소.type)],
            ['detected_elements_kept', 분석.detected_elements_kept],
            ['dropped', 분석.dropped],
          ]}
        />
      </개발자용>
    </카드>
  )
}

/**
 * ③ 대사.
 *
 * 🔴 모드·반응 키가 **고칠 수 있는 칸**인 것이 이 레포의 존재 이유다 (계약 1절).
 * ⛔ CLOSING 이면 캐릭터 LLM 을 아예 안 부른다 — 그 갈림은 `characterTurn()` 안에 있고
 *    이 화면은 값을 넘길 뿐이다 (경계 4).
 *
 * ⭐ **자유 입력칸 둘을 고르는 칸으로 바꿨다** (2026-08-15 · 규칙 1-1). `reaction_key` 와
 *    `guidance_target` 은 값 자체가 엔진 코드라 운영자가 손으로 칠 수 있는 것이 아니었다.
 *    ⚠️ **지금 값이 목록에 없으면 그 값을 목록에 넣어 준다** — 새 값이 생겨도 이 화면이
 *       조용히 다른 값으로 바꿔 보내지 않는다.
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

  const 반응_고를것 = 목록에_지금값을(Object.keys(반응이름), 판정.reaction_key)
  const 유도_고를것 = 목록에_지금값을(요소_코드들, 판정.guidance_target)

  return (
    <카드
      제목="캐릭터가 할 말을 만듭니다"
      설명="아래 값을 그대로 두고 눌러도 되고, 고쳐서 다르게 나오는지 견줘 봐도 됩니다. 같은 차례에 여러 번 눌러도 대답만 새로 덮어씁니다."
    >
      <정한것
        판정={{
          response_mode: 판정.response_mode,
          guidance_target: 판정.guidance_target,
          soft_cue: 판정.soft_cue,
          reaction_key: 판정.reaction_key,
          scene_goal_met: 판정.scene_goal_met,
          scene_end_reason: 판정.scene_end_reason,
        }}
      />

      <form action={dialogueAction} className="flex flex-wrap items-end gap-4">
        <input type="hidden" name="run_id" value={상세.run.id} />
        <input type="hidden" name="session_id" value={상세.session.id} />
        <input type="hidden" name="message_id" value={pending.message_id} />
        <라벨 이름="캐릭터가 답할 방식">
          <select name="response_mode" className={입력칸} defaultValue={판정.response_mode}>
            {Object.entries(모드이름).map(([코드, 이름]) => (
              <option key={코드} value={코드}>
                {이름}
              </option>
            ))}
          </select>
        </라벨>
        <라벨 이름="대답의 결">
          <select name="reaction_key" className={입력칸} defaultValue={판정.reaction_key}>
            {반응_고를것.map((코드) => (
              <option key={코드} value={코드}>
                {이름표(반응이름, 코드) ?? 코드}
              </option>
            ))}
          </select>
        </라벨>
        <라벨 이름="이번에 끌어낼 생각 조각">
          <select
            name="guidance_target"
            className={입력칸}
            defaultValue={판정.guidance_target ?? ''}
          >
            <option value="">끌어내지 않음</option>
            {유도_고를것.map((코드) => (
              <option key={코드} value={코드}>
                {elementName(코드)}
              </option>
            ))}
          </select>
        </라벨>
        <라벨 이름="아이 말을 한 줄로 옮기면" 도움말="캐릭터가 이 문장을 보고 대답합니다">
          <input
            name="main_point"
            defaultValue={pending.analysis?.main_point ?? ''}
            className={`w-72 ${입력칸}`}
          />
        </라벨>
        <보내기 className={단추.AI} 도는중="캐릭터 대답을 만드는 중…">
          캐릭터 대답 만들기 (AI 호출)
        </보내기>
      </form>

      <개발자용 제목="이 차례의 원래 값">
        <칸들
          값들={[
            ['message_id', pending.message_id],
            ['response_mode', 판정.response_mode],
            ['guidance_target', 판정.guidance_target],
            ['soft_cue', 판정.soft_cue],
            ['reaction_key', 판정.reaction_key],
            ['scene_goal_met', 판정.scene_goal_met],
            ['scene_end_reason', 판정.scene_end_reason],
          ]}
        />
      </개발자용>
    </카드>
  )
}

/**
 * 고를 목록에 **지금 값이 반드시 들어 있게** 한다.
 *
 * ⛔ 여기에 규칙이 없다 — 무엇을 고를 수 있는지는 이미 정해져 있고, 이 함수는 저장된 값이
 *    목록 밖이어도 **그 값을 잃지 않게** 한 칸 더할 뿐이다.
 */
function 목록에_지금값을(목록: readonly string[], 지금: string | null): string[] {
  if (지금 === null || 지금 === '' || 목록.includes(지금)) return [...목록]
  return [지금, ...목록]
}

// ═══════════════════════════════════════════════════════════════════════════

/** 지금 장면의 대화만. 회차 전체는 턴 로그 화면이 그린다. */
function 이장면_대화({ 상세 }: { 상세: RunDetail }) {
  const scene_id = 상세.current_scene?.scene_id
  if (scene_id === undefined) return null
  const 줄들 = 상세.messages.filter((행) => 행.scene_id === scene_id)
  if (줄들.length === 0) return null

  return (
    <카드
      제목="이 장면에서 오간 말"
      설명={`아이가 말한 차례에는 AI 가 그 말을 어떻게 읽고 무엇을 하기로 정했는지가 함께 붙습니다. ${턴_풀이}`}
      곁들이기={<span className="text-[15px] font-bold text-ink-muted">{줄들.length}줄</span>}
    >
      <ol className="flex flex-col gap-3">
        {줄들.map((행) => (
          <대화줄 key={행.id} run_id={상세.run.id} 행={행} />
        ))}
      </ol>
    </카드>
  )
}
