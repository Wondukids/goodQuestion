// 리포트 설정 — 지금은 「다시 만들기」 한도 하나뿐이다 (명세 7절 · 결정 R19).
//
// `src/llm/config.ts` 와 같은 결로 둔다: **환경에서 읽는 길 하나**(`loadReportSettings()`)만
// 두고, 부분값이 필요하면 인자로 넘긴다. 코드 안에 숫자를 박지 않는 이유는 명세 7절이
// 「숫자는 설정값으로 두고 코드에 박지 않는다」로 못박았기 때문이다 — 리포트 한 장에
// LLM 2회가 나가고 그 비용이 보호자 손에 달려 있어서, 운영 중에 조일 수 있어야 한다.
//
// ⛔ `Settings`(`@/llm/config`)에 칸을 더하지 않았다. 저쪽은 **LLM 공급자 설정**이고 회차마다
//    통째로 덮어쓰이는 값이라(`loadSettings(overrides)`), API 한도가 거기 섞이면 회차 설정을
//    바꾸는 화면이 한도까지 같이 흔든다.

import { loadEnvFile } from '@/llm/config'

/** 「다시 만들기」를 몇 번까지 허용하나. 이 수에 닿으면 `429` 다 (명세 7절). */
export const 재생성_한도_기본값 = 3

export interface ReportSettings {
  /**
   * `parent_reports.regenerated` 가 이 수 **이상**이면 더 안 만든다.
   *
   * 기본 3 은 명세 7절의 「3회 넘으면 429」를 그대로 옮긴 것이다.
   * `0` 이면 「다시 만들기」가 아예 막힌다 — 끄는 손잡이로도 쓸 수 있다.
   */
  regenerate_limit: number
}

/** 환경변수 이름. 값이 없거나 숫자가 아니면 기본값이다. */
export const 재생성_한도_변수 = 'GQ_REPORT_REGENERATE_LIMIT'

/**
 * 환경에서 리포트 설정을 읽는다. **이것이 유일한 길이다** (`loadSettings()` 와 같은 규칙).
 *
 * `overrides` 는 검사가 쓴다. 준 칸만 갈리고 나머지는 언제나 환경에서 온다.
 */
export function loadReportSettings(overrides: Partial<ReportSettings> = {}): ReportSettings {
  loadEnvFile()

  // ⚠️ 빈칸을 `Number()` 에 그냥 넣으면 **0** 이 나온다 — 그러면 변수를 안 쓴 사람에게서
  //    「다시 만들기」가 통째로 막힌다(한도 0). 그래서 빈칸을 먼저 걸러 낸다.
  const 원본 = (process.env[재생성_한도_변수] ?? '').trim()
  const 읽은값 = 원본 === '' ? Number.NaN : Number(원본)
  const regenerate_limit =
    Number.isFinite(읽은값) && 읽은값 >= 0 ? Math.floor(읽은값) : 재생성_한도_기본값

  return { regenerate_limit, ...overrides }
}
