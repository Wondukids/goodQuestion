// 말하기 후 활동 도메인 — **아이가 말한 줄거리에서 핵심 단어 12개를 가린다** (이슈 #44).
//
// 부르는 쪽(이슈 #45 의 `src/session/controller/post-activity.ts`)은 여기만 보면 된다.
//
// ```
// const 결과 = await judgeRetellingKeywords({ story, cards, retelling })
// 결과.analyzed  // false 면 판정을 못 했다 — analyzed_at 을 NULL 로 둔다 (200 은 그대로 나간다)
// 결과.words     // post_activity_keywords 에 넣을 12행. 판정을 못 했으면 null
// 결과.version   // post_activity_results.analysis_version 에 넣을 값
// 결과.dropped   // 대조에서 버린 것 — 로그로 남길 것
// ```
//
// ⛔ 저장은 여기 없다 (`README.md` 의 층 표). 표 둘에 넣는 것은 #45 다.

export {
  근거가_원문에_있나,
  규칙이_찾았나,
  규칙_단계,
  단어_세기,
  단어_열쇠,
  버린_수,
  빈_장부,
  줄거리_뼈대,
  후활동_낱말_후보들,
  후활동_조각_바닥,
  type 규칙_판정,
} from './domain/keywords'

export {
  buildRetellingKeywordsMaterial,
  type RetellingMaterialArgs,
} from './engine/material'

export {
  judgeRetellingKeywords,
  parseRetellingKeywordsResponse,
  RetellingKeywordsError,
  걸러낸_단어판정,
  단어판정_용도,
  단어판정_응답_스키마,
  단어판정_출력_스키마,
  단어판정_프롬프트,
  판정_버전,
  type JudgeRetellingArgs,
  type RetellingCall,
  type 단어판정_응답,
  type 응답단어,
} from './engine/judge'

export type {
  단어판정,
  버린것,
  판정결과,
  판정상태,
  판정자,
  판정할_단어,
  후활동이야기,
  후활동카드,
} from './types'
