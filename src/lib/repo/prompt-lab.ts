// 회차에만 걸리는 실험용 프롬프트 (이슈 #26 화면-6 · FR-057).
//
// 파이썬 `src/goodquestion_admin/저장.py` 의 `실험_프롬프트_저장()`·`실험_프롬프트_읽기()` 자리다.
//
// ## 🔴 정본은 `prompts/*.md` 다 (`CLAUDE.md` 경계 6)
//
// 이 표에 사는 것은 **실험용**이고, 확정본은 사람이 파일로 옮긴다.
// **여기서 md 로 돌아가는 화살표는 없다** — 이 파일에 파일을 쓰는 코드가 한 줄도 없는 것이
// 그 경계다. `tests/prompt-lab.test.ts` 가 그것을 훑어 지킨다.
//
// ## 표 이름을 아는 것은 이 층뿐이다
//
// 엔진은 문자열만 받는다 (`prompts.chooseBody()` 가 「안 주면 파일」 규칙을 갖고 있다).
// 그래서 실험 본문이 **어디에 저장돼 있는지**는 부르는 쪽만 안다.

import { and, asc, eq } from 'drizzle-orm'

import { experiment_prompts, runs } from '@/db/schema'
import { ValueError } from '@/lib/domain/progress'

import type { Conn } from './db'

/** 실험할 수 있는 프롬프트. `experiment_prompts_name_check` 가 DB 에서도 같은 값을 막는다. */
export const 실험할_수_있는_이름 = ['analysis', 'character'] as const

export type ExperimentPromptRow = typeof experiment_prompts.$inferSelect

/**
 * 이 회차에 저장된 실험 본문 전부 (`이름 → 본문`).
 *
 * ⭐ `run_id` 로만 읽으므로 **다른 회차에는 새지 않는다** — 그게 FR-057 이다.
 */
export async function readExperimentPrompts(
  conn: Conn,
  run_id: string,
): Promise<Record<string, string>> {
  const 행들 = await conn
    .select({ name: experiment_prompts.name, body: experiment_prompts.body })
    .from(experiment_prompts)
    .where(eq(experiment_prompts.run_id, run_id))
    .orderBy(asc(experiment_prompts.name))
  return Object.fromEntries(행들.map((행) => [행.name, 행.body]))
}

/**
 * 실험 본문 하나를 회차에 매단다. 같은 (회차, 이름)이 이미 있으면 덮어쓴다.
 *
 * `runs.experiment_note` 도 함께 고친다 — **회차 목록이 「무엇이 달랐는지」를 말할 수 있어야
 * 한다** (FR-059). 저장한 뒤 이름 목록을 다시 읽어 적으므로 두 번째 저장에서도 맞다.
 *
 * ⚠️ **커밋은 부르는 쪽이 한다** (결정 18). 여기서 트랜잭션을 여닫지 않는다.
 */
export async function saveExperimentPrompt(
  conn: Conn,
  { run_id, name, body }: { run_id: string; name: string; body: string },
): Promise<ExperimentPromptRow> {
  if (!(실험할_수_있는_이름 as readonly string[]).includes(name)) {
    throw new ValueError(`실험할 수 없는 프롬프트: ${name}`)
  }

  const 넣은것 = await conn
    .insert(experiment_prompts)
    .values({ run_id, name, body })
    .onConflictDoUpdate({
      target: [experiment_prompts.run_id, experiment_prompts.name],
      set: { body },
    })
    .returning()

  const 이름들 = await conn
    .select({ name: experiment_prompts.name })
    .from(experiment_prompts)
    .where(eq(experiment_prompts.run_id, run_id))
    .orderBy(asc(experiment_prompts.name))

  await conn
    .update(runs)
    .set({ experiment_note: `실험용 프롬프트: ${이름들.map((행) => 행.name).join(', ')}` })
    .where(eq(runs.id, run_id))

  return 넣은것[0]
}

/** 회차 하나에서 실험 본문 하나만. 화면이 「이 회차에 이 프롬프트가 있나」를 볼 때 쓴다. */
export async function readExperimentPrompt(
  conn: Conn,
  { run_id, name }: { run_id: string; name: string },
): Promise<ExperimentPromptRow | null> {
  const 행들 = await conn
    .select()
    .from(experiment_prompts)
    .where(and(eq(experiment_prompts.run_id, run_id), eq(experiment_prompts.name, name)))
    .limit(1)
  return 행들.length === 0 ? null : 행들[0]
}
