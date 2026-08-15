// 보호자 리포트 엔진 — 리포트의 **문장**을 만드는 층 (이슈 #37).
//
// 부르는 쪽(이슈 #38 의 service 층)은 여기만 보면 된다.
//
// ```
// const 결과 = await generateNarrative({ metrics, child })
// 결과.narrative   // 화면이 받을 서술. 둘 다 실패했으면 null
// 결과.words       // child_words 와 대조할 낱말 목록 (명세 4.3)
// 결과.dropped     // 대조에서 버린 것 — 로그로 남길 것
// ```
//
// ⛔ 저장도, 지표 집계도, 낱말 누적도 여기 없다 (`src/report/README.md` 의 층 표).

export {
  buildReportAnalysisMaterial,
  buildReportGuideMaterial,
  모자란_요소,
  모자란_요소_최대,
  축이_세는_요소,
  type ChildInfo,
  type ReportMaterialArgs,
} from './material'

export {
  generateNarrative,
  parseAnalysisResponse,
  parseGuideResponse,
  reportAnalysis,
  reportGuide,
  ReportNarrativeError,
  가정연계_용도,
  가정연계_출력_스키마,
  가정연계_프롬프트,
  걸러낸_가정연계,
  걸러낸_말하기분석,
  말하기분석_용도,
  말하기분석_출력_스키마,
  말하기분석_프롬프트,
  type ExtractedWords,
  type GenerateNarrativeArgs,
  type ReportCall,
  type ReportCallOptions,
  type ReportNarrativeResult,
  type 가정연계_몫,
  type 가정연계_응답,
  type 말하기분석_몫,
  type 말하기분석_응답,
} from './narrative'

export {
  낱말_거르기,
  낱말_후보들,
  낱말이_발화에_있나,
  대표발화_거르기,
  발화_뼈대,
  빈_장부,
  요소_코드,
  이야기질문_거르기,
  인용_id_집합,
  인용_찾기,
  최소_어간_길이,
  카드_거르기,
  카드_순서,
  type DroppedRecord,
} from './verify'
