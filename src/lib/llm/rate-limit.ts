// 분당 문지기 — 공급자 한도를 넘지 않게 호출 직전에 막는다.
//
// 미끄럼창(최근 60초 안의 호출 시각)이다. 「1분마다 N개」가 아니라
// 「어느 60초를 떼어 봐도 N개 이하」라야 공급자 계산과 맞는다.
// 파이썬 `llm._분당_기다리기()` 를 그대로 옮긴 것이다.

const WINDOW_MS = 60_000

const realSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))
const realNow = () => performance.now()

// ⚠️ 모듈 전역이다. 검사 사이에 창이 새면 앞 검사가 채워 놓은 만큼 뒷 검사가 잔다.
// 파이썬은 이걸 안 비워서 **검사 순서를 바꾸면 시간이 달라졌다** (244초 중 228초).
const recentCalls: number[] = []

let enabled = true
let sleep = realSleep
let now = realNow

/**
 * 분당 `rpm` 번을 넘으려 하면 넘지 않을 때까지 잔다. `rpm <= 0` 이면 안 막는다.
 *
 * 쉬는 것을 **반드시 찍는다.** 조용히 자면 「왜 이렇게 느리지」의 답이 어디에도 없다.
 */
export async function waitForRateLimit(rpm: number, label = ''): Promise<void> {
  if (!enabled || rpm <= 0) return

  for (;;) {
    const at = now()
    while (recentCalls.length > 0 && at - recentCalls[0] >= WINDOW_MS) recentCalls.shift()

    if (recentCalls.length < rpm) {
      recentCalls.push(at)
      return
    }

    const waitMs = WINDOW_MS - (at - recentCalls[0]) + 50
    console.log(`[LLM] ${label}분당 ${rpm}회 한도 — ${(waitMs / 1000).toFixed(1)}초 쉰다`)
    await sleep(waitMs)
  }
}

/**
 * F-2 「분당 문지기」가 잡는 손잡이. **검사 장비 전용이다.**
 *
 * ⛔ 제품 코드에서 부르지 마라. 파이썬은 이 자리를 monkeypatch 로 했고,
 *    ESM 에서는 그게 안 되므로 손잡이를 밖으로 낸다.
 *
 * ⚠️ 잠만 끄면 안 된다 — 창이 찬 채로 잠이 없으면 루프가 영원히 돈다.
 *    그래서 파이썬도 함수 **전체**를 no-op 으로 바꿨다. `disable()` 이 그것이다.
 */
export const __testing = {
  /** 창을 비운다. 검사 격리의 절반이 이것이다. */
  reset(): void {
    recentCalls.length = 0
  },
  /** 문지기 자체를 끈다 (파이썬의 `_분당_기다리기` → no-op). */
  disable(): void {
    enabled = false
  },
  /** 문지기를 재는 검사만 켠다 (파이썬 `@pytest.mark.분당`). 가짜 시계를 같이 끼워라. */
  enable(): void {
    enabled = true
  },
  setSleep(fn: (ms: number) => Promise<void>): void {
    sleep = fn
  },
  setClock(fn: () => number): void {
    now = fn
  },
  restoreRealTime(): void {
    sleep = realSleep
    now = realNow
  },
  snapshot(): number[] {
    return [...recentCalls]
  },
}
