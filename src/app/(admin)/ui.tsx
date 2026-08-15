// 관리자 화면 **전부**가 함께 쓰는 조각 (이슈 #27).
//
// ⛔ **여기에 규칙이 없다.** 값을 어떻게 보이느냐만 정한다.
// ⚠️ 라우트 파일(`page.tsx`)에서 이런 것을 export 하지 않는다 — Next 가 그 파일의 export 를
//    규격으로 검사하므로, 화면 조각은 라우트가 **아닌** 파일에 둔다.
//
// ## 왜 `runs/ui.tsx` 가 아니라 여기인가 (2026-08-13)
//
// 화면마다 담당이 갈려 있어 이 셋이 두 벌 있었다 — `runs/ui.tsx` 와 `goldenset/ui.tsx` 에
// **글자까지 같은** `한칸`·`오류띠`·`라벨` 이. 그리고 시드·프롬프트 작업대·검수 화면은
// `../runs/ui` 를 가져다 썼는데, 그러면 「시드 화면이 회차 화면에 딸려 있다」로 읽힌다.
//
// 두 `ui.tsx` 는 그대로 두고 여기서 다시 내보내게 했다 — 화면 파일들의 import 줄을
// 건드리지 않으려는 것이다. **합치면서 보이는 것을 바꾸지 않는다.**
//
// ## 2026-08-14 — 생김새를 `docs/관리자_디자인_규칙.md` 에 맞춘다 (#27)
//
// 🔴 **읽는 사람이 바뀌었다.** 이 화면은 이제 해커톤 운영자(AI 비전공자)가 직접 클릭한다.
//    그래서 여기 조각들은 「개발자가 값을 확인하는 표시」가 아니라 **사람이 읽는 화면**이다.
//
// ⚠️ **이 파일은 규칙을 「고를 수 있게」만 해 둔다.** 화면마다 글자를 사람 말로 바꾸는 일은
//    #28 이 한다. 여기서는 그 조각을 만들어 두고, 기존 셋(`한칸`·`오류띠`·`라벨`)은
//    **부르는 쪽을 안 건드리도록 신호(prop)를 그대로 둔 채** 생김새만 바꾼다.

import Link from 'next/link'

export { 보내기, 눌린_단추_칸, 도는_단추인가 } from './runs/submit'

// ═══════════════════════════════════════════════════════════════════════════
// 단추 — 규칙 3-6 · 3-7
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 단추 생김새 두 벌. `보내기` 의 `className` 에 넣어 쓴다.
 *
 * 🔴 **`AI단추` 는 색만으로 구분하지 않는다** (규칙 3-6). 색각 이상이 있거나 화면 낭독기를
 *    쓰는 사람에게 색은 전달되지 않으므로, 부르는 쪽이 **단추 글자에도** 무슨 일이
 *    일어나는지 적어야 한다 — 「시작」이 아니라 「회차 시작 (AI 호출)」.
 *
 * ⛔ **확인창은 없다** (규칙 3-5 · 2026-08-14 결정). 잃는 것이 회차 하나·채점 한 판이고,
 *    되풀이해 돌리는 것이 이 도구의 정상 사용이라 매번 묻으면 본래 용도를 방해한다.
 *    그래서 예고는 **단추 글자 하나뿐이고**, 중복 클릭은 `보내기` 의 잠금이 막는다.
 */
export const 단추 = {
  /** 되돌릴 수 있는 저장 — 시드 칸·기준·프롬프트 실험. */
  보통:
    'rounded-xl border border-divider bg-surface px-5 py-2.5 text-[15px] font-bold text-ink hover:border-primary',
  /** AI 를 부르는 단추 — 돈과 시간이 나간다. */
  AI: 'rounded-xl bg-danger px-6 py-2.5 text-[15px] font-extrabold text-white hover:opacity-90',
  /** 화면의 주된 동작이지만 AI 를 안 부르는 것 — 내보내기 따위. */
  주된:
    'rounded-xl bg-primary px-6 py-2.5 text-[15px] font-extrabold text-white hover:bg-primary-strong',
} as const

// ═══════════════════════════════════════════════════════════════════════════
// 화면 뼈대 — 규칙 1-2 · 2-1
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 화면 맨 위의 「여기는 무엇을 하는 곳인가」 배너 (규칙 2-1).
 *
 * 🔴 **새 용어 0개로 쓴다.** 이 배너 하나만 읽고 무엇을 하는 자리인지 말할 수 있어야 하고,
 *    그게 부모 이슈 #25 의 완료 기준이다.
 */
export function 화면머리말({
  제목,
  설명,
  곁들이기,
}: {
  제목: string
  /** 2~3문장. 일반 성인 누구나 읽을 수 있게. */
  설명: string
  /** 제목 줄 오른쪽에 놓을 것 — 내보내기 링크 따위. */
  곁들이기?: React.ReactNode
}) {
  return (
    <header className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-[28px] font-extrabold text-ink">{제목}</h1>
        {곁들이기}
      </div>
      <p className="max-w-3xl text-[15px] leading-relaxed text-ink-muted">{설명}</p>
    </header>
  )
}

/**
 * 할 일 하나 = 카드 하나 (규칙 1-2).
 *
 * ⚠️ 견본(`/dev/voice-test`)은 `p-8` 인데 여기는 `p-6` 이다 — 관리자는 한 화면에 담는 것이
 *    많아 같은 여백을 쓰면 스크롤이 길어진다. 나머지(둥근 모서리·바탕·그림자)는 견본과 같다.
 */
export function 카드({
  제목,
  설명,
  곁들이기,
  children,
}: {
  제목: string
  /** 이 카드가 무엇을 하는 곳인지 한 줄. */
  설명?: string
  /** 제목 줄 오른쪽 — 건수 배지나 링크. */
  곁들이기?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-4 rounded-3xl bg-surface p-6 shadow-panel">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-[20px] font-extrabold text-ink">{제목}</h2>
          {곁들이기}
        </div>
        {설명 !== undefined && <p className="text-[14px] text-ink-muted">{설명}</p>}
      </div>
      {children}
    </section>
  )
}

/**
 * 개발자만 보는 것을 접어 두는 자리 (규칙 1-4).
 *
 * 🔴 **원문을 지우는 것이 아니라 접는 것이다.** 컬럼명·JSON·로그 원문은 화면에서
 *    사람 말로 옮기되(규칙 1-1), 개발자가 오류를 쫓을 때 대조할 원문은 여기 남는다.
 */
export function 개발자용({ 제목, children }: { 제목: string; children: React.ReactNode }) {
  return (
    <details className="rounded-xl border border-divider">
      <summary className="cursor-pointer px-4 py-2 text-[13px] text-ink-faint">
        개발자용 · {제목}
      </summary>
      <div className="border-t border-divider p-4">{children}</div>
    </details>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 값 표기 — 규칙 2-5
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 값 하나를 **사람이 읽는 글자**로 (규칙 2-5).
 *
 * 🔴 **`null` 을 화면에 찍지 않는다.** 지금 회차 목록은 시작한 사람이 없으면 글자
 *    `null` 을 그대로 보여 준다(`runs/page.tsx`). 운영자에게 그건 오류로 읽힌다.
 *
 * ⛔ **`lib/log.ts` 의 `값()` 과 다른 규칙이다.** 저쪽은 터미널 로그라 `null` 을 그대로
 *    찍어야 하고(그게 로그의 약속이다), 이쪽은 화면이라 「없음」이라고 쓴다. 두 규칙이
 *    갈리는 것이 맞고, 로그 파일은 건드리지 않는다.
 */
export function 값({ 것, 없을때 = '없음' }: { 것: unknown; 없을때?: string }) {
  if (것 === null || 것 === undefined || 것 === '') {
    return <span className="text-ink-faint">{없을때}</span>
  }
  if (typeof 것 === 'boolean') return <>{것 ? '예' : '아니오'}</>
  return <>{String(것)}</>
}

/**
 * 결과에 딸리는 수치 줄 (규칙 3-1) — 「1,240ms · 3.2KB · gemini-2.5-flash」.
 *
 * 🔴 **AI 를 부른 결과에는 늘 붙는다.** 수치가 없으면 왜 느린지 왜 비싼지를 화면 밖에서
 *    알아내야 한다. 견본(`/dev/voice-test`)이 합성 결과에 `ms`·`KB`·모델명을 붙이는 것과 같다.
 */
export function 수치들({ 항목 }: { 항목: readonly (string | null)[] }) {
  const 볼것 = 항목.filter((하나): 하나 is string => 하나 !== null)
  if (볼것.length === 0) return null
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-ink-muted">
      {볼것.map((하나) => (
        <span key={하나}>{하나}</span>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 상태 · 빈자리 · 오류 — 규칙 3-2 · 3-3 · 3-4
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 상태 배지 넷 (규칙 3-2).
 *
 * 🔴 **「도는 중」과 「실패」를 절대 같게 그리지 않는다.** 2026-08-13 에 도는 중인 턴을
 *    「분석 단계에서 끊겼다」로 그렸고, 그 안내가 가리킨 단추는 화면에 없었다
 *    (`runs/ui.tsx` 의 `어느_패널` 머리말). **없는 단추를 가리키는 막다른 길**이었다.
 *
 * ⛔ 여기에 규칙이 없다 — 어느 갈래인지는 부르는 쪽이 이미 정했다.
 */
export function 상태배지({
  갈래,
  글,
}: {
  갈래: '아직' | '도는중' | '됨' | '안됨'
  /** 안 주면 갈래의 기본 글자. */
  글?: string
}) {
  const 꼴 = {
    아직: { 바탕: 'bg-chip text-ink-mid', 기본: '아직 안 함' },
    도는중: { 바탕: 'bg-primary-soft text-primary-strong', 기본: '도는 중' },
    됨: { 바탕: 'bg-ok-soft text-ok', 기본: '끝남' },
    안됨: { 바탕: 'bg-danger-soft text-danger', 기본: '실패' },
  }[갈래]
  return (
    <span className={`rounded-lg px-2.5 py-1 text-[13px] font-bold ${꼴.바탕}`}>
      {갈래 === '도는중' && <span className="mr-1 animate-pulse">●</span>}
      {글 ?? 꼴.기본}
    </span>
  )
}

/**
 * 아무것도 없을 때 (규칙 3-3).
 *
 * 🔴 **「아직 없다」로 끝내지 않는다.** 무엇을 하면 되는지까지 적어야 운영자가 막히지 않는다.
 */
export function 빈자리({ 무엇, 다음 }: { 무엇: string; 다음?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-divider px-5 py-8 text-center">
      <p className="text-[15px] text-ink-muted">{무엇}</p>
      {다음 !== undefined && <p className="mt-1 text-[14px] text-ink-faint">{다음}</p>}
    </div>
  )
}

/**
 * 오류 3단 — 무엇이 · 왜 · 무엇을 하면 되는지 (규칙 3-4).
 *
 * 🔴 **읽는 사람이 할 수 있는 조치를 적는다.** 지금 회차 화면은 「`npx tsx db/seed.ts` 로
 *    시드를 넣어라」라고 하는데, 운영자는 그 명령을 칠 수 없다. 개발자용 원문은 접어 둔다.
 */
export function 오류상자({
  무엇,
  왜,
  어떻게,
  원문,
}: {
  무엇: string
  왜?: string
  어떻게?: string
  /** 개발자가 볼 원문 — 예외 메시지 따위. */
  원문?: string | null
}) {
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-2xl border border-danger bg-danger-soft px-5 py-4"
    >
      <p className="text-[15px] font-bold text-danger">{무엇}</p>
      {왜 !== undefined && <p className="text-[14px] text-ink">{왜}</p>}
      {어떻게 !== undefined && <p className="text-[14px] text-ink">{어떻게}</p>}
      {원문 !== undefined && 원문 !== null && (
        <개발자용 제목="오류 원문">
          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono text-[12px] text-ink">
            {원문}
          </pre>
        </개발자용>
      )}
    </div>
  )
}

/** 값이 어긋났다 — 오류는 아니고 알아 두라는 것 (시드 파일과 화면 값이 다를 때 따위). */
export function 경고상자({ children }: { children: React.ReactNode }) {
  return (
    <p
      role="status"
      className="rounded-2xl border border-warn bg-warn-soft px-5 py-3 text-[14px] text-warn"
    >
      {children}
    </p>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// 기존 셋 — 부르는 쪽을 안 건드리려고 신호(prop)를 그대로 둔다
// ═══════════════════════════════════════════════════════════════════════════

/** `?error=` · `?file=` 는 배열로도 올 수 있다. 첫 값만 본다. */
export function 한칸(값: string | string[] | undefined): string | null {
  if (값 === undefined) return null
  return Array.isArray(값) ? (값[0] ?? null) : 값
}

/**
 * 주소줄로 실려 온 오류 한 줄.
 *
 * ⚠️ **`오류상자` 를 쓰는 쪽이 낫다.** 이것은 「무엇이 잘못됐나」 한 줄뿐이라 규칙 3-4 의
 *    3단을 못 채운다. 화면들이 아직 이걸 부르고 있어 남겨 두었고, #28 에서 하나씩 옮긴다.
 */
export function 오류띠({ 문구 }: { 문구: string }) {
  return <오류상자 무엇={문구} />
}

/**
 * 입력칸 한 줄.
 *
 * 🔴 **`이름` 에 DB 컬럼명을 넣지 않는다** (규칙 1-1). 지금 화면들은 `story_code`·`scope`
 *    같은 것을 그대로 넘기고 있고, 그 글자를 사람 말로 바꾸는 것이 #28 의 일이다.
 *    그래서 여기서 고정폭 글꼴을 걷었다 — 컬럼명이 코드처럼 보이던 것을 없애야
 *    「아직 안 바꾼 자리」가 눈에 띈다.
 */
export function 라벨({
  이름,
  도움말,
  children,
}: {
  이름: string
  /** 이 칸이 무엇인지 한 줄 — 규칙 2-4 처럼 행동으로 적는다. */
  도움말?: string
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[14px] font-bold text-ink-soft">{이름}</span>
      {도움말 !== undefined && <span className="text-[13px] text-ink-faint">{도움말}</span>}
      {children}
    </label>
  )
}

/** 입력칸 생김새 — `<input>`·`<select>`·`<textarea>` 가 함께 쓴다. 16px 이라야 모바일에서 안 확대된다. */
export const 입력칸 =
  'rounded-xl border border-divider bg-surface px-4 py-2.5 text-[16px] text-ink outline-none focus:border-primary'

/** 화면 안에서 다른 화면으로 가는 잔 링크. */
export function 곁링크({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-[14px] font-bold text-primary-strong underline">
      {children}
    </Link>
  )
}
