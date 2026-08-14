// 플랜 → 재생 스텝 변환의 서버 장면 매핑 — **질문 컷 등장 순서** 기준을 잰다.
//
// 왜 순서인가: 2026-08-14 컷 플랜 재넘버링에서 scene 번호와 컷 id 가 **둘 다** 바뀌어,
// scene 번호를 열쇠로 쓰던 매핑이 소리 없이 전부 빗나갔다(대화 씬이 서버 세션 없이
// 고정 문구로만 돌았다). 이야기 속 대화 순서만이 서버 `story_scenes.scene_order` 와
// 같은 불변량이라, n번째 질문 컷 → n번째 code 로 잇는다.
//
// ⚠️ 이 표가 깨지면 에러가 아니라 "로컬 전용 폴백"이라 눈에 안 띈다 — 그래서 테스트다.

import { describe, expect, it } from 'vitest'

import { SCENE_CODES_IN_ORDER } from '@/stories/fart-bride/data'
import { buildPlanSequence } from '@/stories/fart-bride/plan-sequence'
import { VIDEO_PLAN, type PlanCut } from '@/stories/fart-bride/video-plan'

/** 인터랙티브 스텝만 골라 sceneCode 를 순서대로 뽑는다 */
const sceneCodes = (cuts: PlanCut[]) =>
  buildPlanSequence(cuts)
    .filter((s) => s.kind === 'interactive')
    .map((s) => (s.kind === 'interactive' ? s.sceneCode : ''))

const makeCut = (over: Partial<PlanCut>): PlanCut => ({
  id: '1',
  scene: 0,
  chapter: '',
  title: '',
  kind: 'linear',
  image: 'x.png',
  needsNewImage: false,
  screenTransition: false,
  after: null,
  effect: VIDEO_PLAN.cuts[0].effect,
  /* 줄 모양이 플랜 버전마다 달라(durationSec 유무) 실제 줄을 바탕으로 만든다 */
  lines: [{ ...VIDEO_PLAN.cuts[0].lines[0], speaker: '내레이션', text: '말', audio: 'x.wav' }],
  durationSec: 1,
  ...over,
})

/** 질문·답변 짝 — scene·id 는 부르는 쪽이 마음대로 준다(재넘버링 흉내) */
const pair = (id: string, scene: number, over: Partial<PlanCut> = {}): PlanCut[] => [
  makeCut({ id: `${id}-1`, scene, kind: 'question', ...over }),
  makeCut({ id: `${id}-2`, scene: scene + 1, kind: 'answer' }),
]

describe('buildPlanSequence 서버 장면 매핑', () => {
  it('실제 플랜: 대화 4씬이 진행 순서대로 sc_banggui_03·05·07·09 를 받는다', () => {
    expect(sceneCodes(VIDEO_PLAN.cuts)).toEqual([...SCENE_CODES_IN_ORDER])
  })

  it('scene 번호·컷 id 를 재넘버링해도 매핑은 그대로다', () => {
    const cuts = [
      makeCut({ id: 'z9', scene: 100 }),
      ...pair('q7', 500),
      makeCut({ id: 'z8', scene: 3 }),
      ...pair('아무거나', 42),
      ...pair('x', 7),
      ...pair('y', 0),
    ]
    expect(sceneCodes(cuts)).toEqual([...SCENE_CODES_IN_ORDER])
  })

  it('미완성 짝은 순번만 소모한다 — 뒤 대화가 앞 code 로 밀리지 않는다', () => {
    const cuts = [
      ...pair('a', 1),
      ...pair('b', 3, { image: '' }), // 이미지 없음 → 대화 씬이 못 된다
      ...pair('c', 5),
      ...pair('d', 7),
    ]
    // 2번째(b)가 빠져도 c 는 3번째 code, d 는 4번째 code 그대로다
    expect(sceneCodes(cuts)).toEqual([
      SCENE_CODES_IN_ORDER[0],
      SCENE_CODES_IN_ORDER[2],
      SCENE_CODES_IN_ORDER[3],
    ])
  })
})
