// 검사 공용 준비물 — 파이썬 `tests/conftest.py` 의 autouse 픽스처 둘에 대응한다.
//
// ⛔ 이 파일이 이식에서 가장 위험한 자리다. 한 줄만 빠뜨리면
//    **검사는 통과하고 돈만 나간다.** 손대기 전에 왜 있는지 읽어라.

import { beforeEach, vi } from 'vitest'

// ── F-1 진짜 LLM 금지 ─────────────────────────────────────────────────────
//
// 공급자 SDK 의 **클라이언트를 만드는 순간** 터뜨린다. 셋 다 막는다.
//
// ⭐ 왜 필요한가 — 가정이 아니다. 2026-08-12 에 파이썬 `test_admin_goldenset.py` 의
//    픽스처가 **진짜 분석기**를 기본값으로 꽂고 있는 것을 찾았다. 그 라우트를 두드리는
//    검사 스무 개가 전부 앞에서 가짜로 덮어써서 안 터졌을 뿐이고, 그건 규칙이 아니라
//    우연히 다 지켜진 상태였다. 새 검사에서 한 줄을 빠뜨리면 진짜 호출이 나간다.
//
// ⚠️ `importOriginal` 로 나머지 export(타입·enum)는 그대로 흘린다. 생성자만 바꾼다.
// ⚠️ 팩토리 안에서 `await import` 로 가져온다 — 바깥 변수를 참조하면
//    모듈 초기화 순서에 걸린다.

vi.mock('@google/genai', async (importOriginal) => {
  const real = await importOriginal<typeof import('@google/genai')>()
  const { sdkGate } = await import('./support/sdk-gate')
  return { ...real, GoogleGenAI: sdkGate('gemini') }
})

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const real = await importOriginal<typeof import('@anthropic-ai/sdk')>()
  const { sdkGate } = await import('./support/sdk-gate')
  const Gated = sdkGate('anthropic')
  return { ...real, default: Gated, Anthropic: Gated }
})

vi.mock('openai', async (importOriginal) => {
  const real = await importOriginal<typeof import('openai')>()
  const { sdkGate } = await import('./support/sdk-gate')
  const Gated = sdkGate('openai')
  return { ...real, default: Gated, OpenAI: Gated }
})

// ── F-2 분당 문지기 ───────────────────────────────────────────────────────
//
// 검사는 **벽시계로 자지 않는다.** 파이썬 실측(2026-08-12)으로 검사 일곱이
// 244초 중 228초를 먹었고, 전부 체인을 여러 번 도는 fallback 검사였다.
//
// ⚠️ 잠만 끄면 안 된다 — 창이 찬 채로 잠이 없으면 루프가 영원히 돈다.
//    문지기 **전체**를 끈다.
// ⚠️ 창을 비우는 것이 나머지 절반이다. 모듈 전역이라 검사 사이에 샌다.
//    파이썬은 안 비워서 같은 검사가 52초와 8초로 갈렸고 **순서를 바꾸면 시간이 달라졌다.**
//
// 문지기 자체를 재려면 그 검사에서 `__testing.enable()` 을 부르고 가짜 시계를 끼워라
// (파이썬 `@pytest.mark.분당` 에 해당한다).

// ── F-3 회차를 시작할 아이 ────────────────────────────────────────────────
//
// `startRun()` 은 아이 id 가 없으면 **터진다** (결정 71). 그전에는 `gen_random_uuid()` 로
// 없는 아이를 회차마다 지어냈는데, 저쪽(팀 레포)에는 `children` FK 가 있어 그 값이 100% 튕긴다.
//
// ⚠️ 그래서 검사에도 값이 있어야 한다. **`.env.local` 에 기대지 않는다** — 그 파일은
//    gitignore 라 새로 클론한 사람에게는 없고, 없으면 검사 예순둘이 한꺼번에 빨개져서
//    「이식이 깨졌나」로 읽힌다. 값의 출처는 여기다.
// ⚠️ 이미 환경에 있으면 안 덮는다. 저쪽 DB 를 물고 돌릴 때는 진짜 `children.id` 가 와야 한다.
//
// 🔴 이 줄이 「없으면 터진다」를 못 재게 만든다. 그건 `tests/service.test.ts` 가
//    이 변수를 잠깐 비워서 따로 잰다.

process.env.GQ_EXPERIMENT_CHILD_ID ||= '00000000-0000-4000-8000-0000000c8171'

// ── F-4 남의 DB 금지 ──────────────────────────────────────────────────────
//
// 🔴 검사는 진짜 DB 에 **행을 넣고 지운다.** 그래서 `DATABASE_URL` 이 어디를 가리키는지가
//    F-1(진짜 LLM 금지)과 같은 급의 문제다. F-1 이 돈을 지킨다면 이건 **남의 데이터**를 지킨다.
//
// ⚠️ 여기서 읽으려면 `.env.local` 이 먼저 `process.env` 에 올라와 있어야 한다.
//    vitest 는 그 파일을 안 읽으므로 우리가 부른다(`override: false` 라 셸 값이 이긴다 —
//    `DATABASE_URL=… npx vitest run` 으로 덮어쓰는 길이 그대로 산다).
//
// 담은 `drizzle-kit push` 가 쓰는 것과 **같은 화이트리스트**다. 목록이 둘이면 한쪽만 낡는다.

import { 검사_대상_가드 } from '@/db/push-guard'
import { loadEnvFile } from '@/lib/config'

loadEnvFile()
검사_대상_가드(process.env.DATABASE_URL)

import { __testing as rateLimit } from '@/lib/llm/rate-limit'
import { clearFakeSdks } from './support/sdk-gate'

beforeEach(() => {
  clearFakeSdks()
  rateLimit.reset()
  rateLimit.restoreRealTime()
  rateLimit.disable()
})
