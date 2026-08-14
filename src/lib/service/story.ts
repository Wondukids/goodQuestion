// 장면 1→9 — 전개는 지문 재생, 대화는 멀티턴 (이슈 #26 조립-2).
//
// 파이썬 `runner.장면_시작()`·`이야기_돌기()` + `회차.장면들을_진행()` 을 옮긴 것이다.
//
// ⛔ **판정은 여기서 만들지 않는다.** 다음에 무엇을 할지는 `domain/progress.nextStep()` 이
//    정하고(순수 함수), 모드와 장면 종료는 `decide()` 가 정한다. 이 파일은 그 답대로
//    장면을 열고 턴을 부를 뿐이다.
//
// ## 장면을 끝내는 것은 「계속하기」 버튼이 아니다
//
// `decide()` 가 `CLOSING` 을 내면 `story_sessions.scene_end_reason` 이 차고,
// 그러면 `nextStep()` 이 다음 장면의 `장면시작` 을 낸다. 그래서 이 파일에는 장면을 끝내는
// 조건이 한 줄도 없다 — 있으면 규칙이 두 곳에 살게 된다.
//
// ## 전개 장면과 대화 장면
//
// | | 무엇을 하나 | `messages` |
// |---|---|---|
// | 전개 (`character_id` 가 null) | 지문 한 줄 찍고 지나간다 | **안 남긴다** (결정 22) |
// | 대화 | 상태 9칸을 비우고 **고정 첫 대사**를 재생한다 | 캐릭터 한 행 |
//
// 「방귀 뀌는 며느리」는 전개 다섯(1·2·4·6·8) · 대화 넷(3·5·7·9)이다.

import type { Settings } from '@/lib/config'
import {
  isDialogueScene,
  nextStep,
  precedingNarration,
  ValueError,
  type Step,
} from '@/lib/domain/progress'
import { dialogueLine, narrationLine, printLine, sceneLine } from '@/lib/log'
import type { SceneRow } from '@/lib/repo/content'
import { scenesOfStory } from '@/lib/repo/content'
import type { Conn } from '@/lib/repo/db'
import { latestSeedRevision } from '@/lib/repo/seed'
import {
  completeSession,
  enterScene,
  insertMessage,
  readSession,
  readSessionWithStory,
} from '@/lib/repo/sessions'

import { isUsableUtterance, runTurn, TurnFailed, type Notify, type TurnResult } from './turn'

/** 회차의 범위. `scene` 이면 그 대화 장면 하나만 돈다 (시연용). */
export type Scope = 'scene' | 'story'

/**
 * 장면 하나를 연다 (파이썬 `runner.장면_시작()` · 결정 21 · 22).
 *
 * 🔴 **`character_opening` 은 `story_scenes` 의 고정 텍스트다. 생성하지 않는다**
 * (`CLAUDE.md` 경계 4). 여기서 LLM 을 부르지 않는 것이 그 규칙이 지켜지는 자리다.
 */
export async function startScene(
  conn: Conn,
  { session_id, scene }: { session_id: string; scene: SceneRow },
): Promise<void> {
  // 장면 상태 9칸을 비운다. 안 비우면 앞 장면의 누적 요소를 물려받아 첫 턴에 GOAL_MET 이 뜬다.
  await enterScene(conn, session_id, scene.scene_id)

  if (!isDialogueScene(scene)) {
    printLine(narrationLine(scene))
    return
  }

  if (scene.character_opening === null) {
    // 대화 장면이면 CHECK 가 보장한다. 여기 오면 데이터가 깨진 것이다.
    throw new ValueError(`${scene.code}: 대화 장면인데 character_opening 이 없다`)
  }

  await insertMessage(conn, {
    session_id,
    scene_id: scene.scene_id,
    speaker_type: 'character',
    text: scene.character_opening,
  })

  printLine(sceneLine(scene))
  printLine(dialogueLine(scene.character_name ?? '', scene.character_opening, { 고정: true }))
}

/**
 * **다음 대화 장면에 닿을 때까지** 전개를 재생한다 (파이썬 `회차.장면들을_진행()`).
 *
 * 돌려주는 것은 멈춘 자리의 할 일이다 — `발화받기`(아이를 기다린다) · `장면끝` · `회차끝`.
 * 화면은 이것을 부른 뒤 아이 입력을 받는다. **회차를 끝내는 것은 부르는 쪽이다**
 * (`service/run.ts` — 세션과 회차를 함께 닫아야 하기 때문이다).
 */
export async function advanceScenes(
  conn: Conn,
  {
    session_id,
    scenes,
    scope,
    scene_order = null,
  }: {
    session_id: string
    scenes: readonly SceneRow[]
    scope: Scope
    scene_order?: number | null
  },
): Promise<Step> {
  for (;;) {
    const 세션 = await readSession(conn, session_id)
    const 할_일 = nextStep(scenes, 세션, { scope, scene_order })
    if (할_일.kind !== '장면시작') return 할_일

    const 장면 = scenes.find((행) => 행.scene_id === 할_일.scene_id)
    if (장면 === undefined) {
      // `nextStep()` 이 이 목록에서 고른 값이라 있을 수 없다. 조용히 넘기지 않는다.
      throw new ValueError(`장면 목록에 없는 scene_id 다: ${할_일.scene_id}`)
    }
    await startScene(conn, { session_id, scene: 장면 })
  }
}

/** 이 장면보다 앞선 **전개** 장면들 (결정 25 — 뒷이야기 스포일러 금지). */
export function narrationsBefore(
  scenes: readonly SceneRow[],
  scene: SceneRow,
): readonly SceneRow[] {
  return precedingNarration(scenes, scene) as readonly SceneRow[]
}

/** 아이 발화를 내주는 자리. `null` 이면 **그만둔다** (파이썬 터미널의 `/그만`). */
export type UtteranceSource = (
  scene: SceneRow,
  preceding: readonly SceneRow[],
) => Promise<string | null> | string | null

export interface RunStoryArgs {
  conn: Conn
  run_id: string
  session_id: string
  /** `stories.code`. 매 턴 여기서 장면을 **다시 읽는다** — 아래 「시드 편집」 절. */
  story_code: string
  scope?: Scope
  scene_order?: number | null
  prompt_version: string
  input: UtteranceSource
  utterance_source?: string | null
  analysis_settings?: Settings
  character_settings?: Settings
  analysis_prompt?: string | null
  character_prompt?: string | null
  notify?: Notify
  /** 회차 시작·턴 완료 같은 사건을 받는 콜백 (파이썬 `기록`). 엔진은 무엇이 저장되는지 모른다. */
  onEvent?: (사건: StoryEvent) => Promise<void> | void
}

/** `runStory()` 가 알리는 사건. 값 이름은 파이썬 `기록()` 의 것을 그대로 썼다. */
export type StoryEvent =
  | { kind: '장면시작'; scene: SceneRow }
  | { kind: '턴_시작'; scene: SceneRow; child_utterance: string }
  | { kind: '턴_완료'; scene: SceneRow; result: TurnResult }
  | { kind: '턴_실패'; scene: SceneRow; error: TurnFailed }
  | { kind: '회차_완료'; step: Step }

export interface StoryResult {
  turns: TurnResult[]
  /** 멈춘 자리 — `회차끝`·`장면끝`, 또는 입력이 `null` 을 내서 그만뒀으면 `null`. */
  step: Step | null
  /** 세션을 `completed` 로 닫았나. 그만뒀으면 닫지 않는다. */
  completed: boolean
}

/**
 * 장면을 `scene_order` 순으로 돈다 (파이썬 `runner.이야기_돌기()` · 결정 22).
 *
 * 아이 발화가 어디서 오는지는 `input` 이 정한다 — 화면이든 대본이든 이 함수는 모른다.
 * ⛔ **아이 역할 LLM 은 옮기지 않았다** (측정 전용 장비 · `이식_전수목록.md` 2절).
 *
 * ## 시드 편집은 다음 턴부터 반영된다
 *
 * 매 턴 장면을 **다시 읽는다.** 관리자 페이지에서 시드를 고치면 고친 다음 호출부터
 * 바로 반영된다는 성질이 여기서 나온다 (`CLAUDE.md` — 배포·동기화 경로가 없다).
 *
 * ⭐ 그래서 **판 번호도 장면과 같은 시점에 붙잡는다** (루프 맨 앞). 이 길은 장면을 읽은 뒤
 * `input()` 이 **사람이 타이핑하는 동안** 열려 있어, 다섯 호출 경로 중 창이 가장 넓다.
 * 파이썬 `터미널.py` 는 `턴_시작` 사건에서 — 그러니까 **사람이 다 친 뒤에** — 붙잡았고
 * (`self.seed_revision = 저장.최신_시드_개정(conn)`), 그동안 시드가 바뀌면 **쓴 장면은 N 판인데
 * 박히는 것은 N+1** 이었다. 파이썬 `회차.턴_돌리기()` 가 T083 으로 못박은 규칙을 그쪽만
 * 안 지킨 것이라, 여기서는 규칙 쪽을 따른다 (2026-08-13 결함 6).
 */
export async function runStory(args: RunStoryArgs): Promise<StoryResult> {
  const {
    conn,
    run_id,
    session_id,
    story_code,
    scope = 'story',
    scene_order = null,
    prompt_version,
    input,
    utterance_source = null,
    analysis_settings,
    character_settings,
    analysis_prompt = null,
    character_prompt = null,
    notify,
    onEvent,
  } = args

  const 알린다 = async (사건: StoryEvent) => {
    if (onEvent !== undefined) await onEvent(사건)
  }

  const turns: TurnResult[] = []

  for (;;) {
    // 매 턴 다시 읽는다 (위 「시드 편집」 절). 판 번호가 **장면 행보다 먼저**다.
    const seed_revision = await latestSeedRevision(conn)
    const 장면_전부 = await scenesOfStory(conn, story_code)
    const 세션 = await readSession(conn, session_id)
    const 할_일 = nextStep(장면_전부, 세션, { scope, scene_order })

    if (할_일.kind === '장면끝' || 할_일.kind === '회차끝') {
      // 마지막 장면이 끝났다 (결정 22). `scene` 범위면 그 장면이 끝난 자리다.
      await completeSession(conn, session_id)
      await 알린다({ kind: '회차_완료', step: 할_일 })
      printLine('[세션] status=completed')
      return { turns, step: 할_일, completed: true }
    }

    const 장면 = 장면_전부.find((행) => 행.scene_id === 할_일.scene_id)
    if (장면 === undefined) {
      throw new ValueError(`장면 목록에 없는 scene_id 다: ${할_일.scene_id}`)
    }

    if (할_일.kind === '장면시작') {
      await startScene(conn, { session_id, scene: 장면 })
      await 알린다({ kind: '장면시작', scene: 장면 })
      continue
    }

    // 발화받기 — 아이를 기다린다.
    const 앞선 = narrationsBefore(장면_전부, 장면)
    const 발화 = await input(장면, 앞선)
    if (발화 === null) {
      printLine('[세션] 중단')
      return { turns, step: null, completed: false }
    }
    if (!isUsableUtterance(발화)) {
      // 확정 텍스트가 없으면 메시지를 만들지 않는다. 턴 카운트도 안 올린다.
      continue
    }

    await 알린다({ kind: '턴_시작', scene: 장면, child_utterance: 발화 })
    try {
      const 결과 = await runTurn({
        conn,
        run_id,
        prompt_version,
        session_id,
        scene: 장면,
        precedingNarrations: 앞선,
        child_utterance: 발화,
        seed_revision,
        utterance_source,
        analysis_settings,
        character_settings,
        analysis_prompt,
        character_prompt,
        notify,
      })
      turns.push(결과)
      await 알린다({ kind: '턴_완료', scene: 장면, result: 결과 })
    } catch (오류) {
      if (오류 instanceof TurnFailed) {
        // 실패도 기록이다 (FR-002). 무엇을 할지는 콜백이 정한다 — 여기서는 알리고 그대로 올린다.
        await 알린다({ kind: '턴_실패', scene: 장면, error: 오류 })
      }
      throw 오류
    }
  }
}

/** 세션이 어느 이야기의 것인지. `runStory()` 를 부르기 전 `story_code` 를 찾는 자리다. */
export async function storyCodeOfSession(conn: Conn, session_id: string): Promise<string> {
  return (await readSessionWithStory(conn, session_id)).story_code
}
