// F-1 「진짜 LLM 금지」의 알맹이 — 공급자 SDK 클라이언트를 만드는 순간 터뜨린다.
//
// ⚠️ 막는 자리를 **한 겹 위로 올리지 마라.** 파이썬에서 `_call_gemini` 자체를 막았다가
//    「SDK 만 가짜로 바꿔 놓고 그 함수를 일부러 부르는」 검사를 오탐으로 잡았다.
//    그래서 여기서도 **클라이언트 생성자**만 막고, 가짜를 꽂을 구멍을 같이 낸다.

export type Provider = 'gemini' | 'anthropic' | 'openai'

/** 공급자별 SDK 클래스 이름. 파이썬과 다르므로 대조할 때 여기를 본다. */
export const SDK_CLASS: Record<Provider, string> = {
  gemini: 'GoogleGenAI', // 파이썬은 `genai.Client` 였다 — JS SDK 는 이름이 다르다
  anthropic: 'Anthropic',
  openai: 'OpenAI',
}

type Fake = (...args: unknown[]) => unknown

const fakes = new Map<Provider, Fake>()

function refuse(provider: Provider): never {
  throw new Error(
    `검사가 진짜 LLM 공급자에 붙으려 했다 (${SDK_CLASS[provider]}). 돈이 나가고 느려진다.\n` +
      '  · 가짜로 바꿔라 — 게이트웨이(`lib/llm`)를 vi.mock 하거나 함수를 갈아끼워라\n' +
      `  · SDK 가 받는 본문만 보고 싶으면 installFakeSdk('${provider}', …) 로 꽂아라\n` +
      '  · 진짜로 부르는 것이 목적이면 파일 이름을 `*.real.test.ts` 로 하고\n' +
      '    `pnpm test:real` 로 돌려라 (기본 실행에서는 빠진다)',
  )
}

/**
 * 그 공급자의 SDK 자리에 들어갈 생성자를 만든다.
 *
 * 가짜가 꽂혀 있으면 그 결과를 돌려주고, 아니면 그 자리에서 터진다.
 * 생성자 함수가 객체를 돌려주면 `new` 의 결과가 그 객체가 된다.
 */
export function sdkGate(provider: Provider): new (...args: unknown[]) => unknown {
  function GatedSdkClient(this: unknown, ...args: unknown[]) {
    const fake = fakes.get(provider)
    if (!fake) refuse(provider)
    return fake(...args)
  }
  Object.defineProperty(GatedSdkClient, 'name', { value: SDK_CLASS[provider] })
  return GatedSdkClient as unknown as new (...args: unknown[]) => unknown
}

/** SDK 가 받는 본문만 보고 싶은 검사가 쓴다. 검사마다 자동으로 비워진다. */
export function installFakeSdk(provider: Provider, fake: Fake): void {
  fakes.set(provider, fake)
}

export function clearFakeSdks(): void {
  fakes.clear()
}

/** 그물이 정말 비워졌는지 검사가 확인할 때 쓴다. */
export function activeFakes(): Provider[] {
  return [...fakes.keys()]
}
