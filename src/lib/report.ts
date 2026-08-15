/**
 * 보호자 리포트(시안 47-1865 · 47-2045)가 그리는 값.
 *
 * 서버가 주는 `ParentReport`(`src/report/types.ts` · 계약 문서 1절)를 화면이 바로 쓸 수
 * 있는 모양으로 옮기는 **어댑터 한 겹**이다. 화면은 이 모양만 보고, 서버 모양은 모른다.
 *
 * 여기 남은 하드코딩은 **화면 상수뿐**이다 — 색 · 이름표 좌표 · 아이콘 · 고정 문구.
 * 숫자와 문장은 전부 서버에서 온다.
 *
 * ## 왜 어댑터가 필요한가 (계약과 어긋나는 자리 넷 · 이슈 #39)
 *
 * 1. 오각형은 0~100 을 원하는데 `axes[*].score` 는 **감지된 발화 수**다 (결정 R17).
 *    그 활동 안에서 `max` 를 100% 로 잡아 정규화한다. `max === 0` 이면 안내 문구.
 * 2. 축 **이름**(「관점과 공감」 ↔ `'관점과공감'`)과 **순서**(시계방향 좌표 순서 ↔
 *    `AxisName` 선언 순서)가 다르다. 이름으로 찾아 좌표 순서를 지킨다.
 * 3. 인용은 글자가 아니라 `quote_message_id` 로 온다 — `metrics.quotes` 에서 찾는다.
 *    LLM 이 없는 발화를 지어내는 것을 막는 설계가 여기 걸려 있다.
 * 4. 값이 없는 칸은 **빈 칸이 아니라 안내 문구**다 (계약 2절 ②·④).
 *
 * ⛔ `toReportView` 는 **순수 함수**다. 계약 문서 4절의 샘플 응답 둘을 그대로 넣어
 *    `tests/report-screen.test.ts` 가 잰다. 여기에 fetch 를 들이지 마라.
 */

import { elementName } from "@/llm/elements";
import type {
  AxisName,
  ParentReport,
  ReportListItem,
  SkillCard,
} from "@/report/types";

/** 레이더 한 축. label 은 시안이 찍어 둔 이름표 좌표(차트 382×264 기준). */
export type RadarAxis = {
  name: string;
  /** 0~100. 축 길이의 비율로 쓴다 */
  value: number;
  color: string;
  label: { x: number; y: number };
};

/** 역량별 분석 카드 한 장. tint 는 근거 발화 박스 바탕. */
export type SkillDetail = {
  name: string;
  color: string;
  tint: string;
  summary: string;
  /** 🔴 `null` 이면 인용 없이 그린다 — LLM 이 인용을 못 고른 경우다 (계약 1절) */
  quote: string | null;
  good: string;
  improve: string;
};

/** 어휘 자세히 보기 3단 중 한 칸. */
export type WordGroup = {
  title: string;
  icon: string;
  color: string;
  /** 칩 바탕 — 질문한 어휘만 회색이라 따로 받는다 */
  chipBg: string;
  words: string[];
  /** 접힌 개수 표시("외 3개") — 없으면 표시하지 않는다 */
  more?: string;
  /** words 가 비었을 때 대신 낼 한 줄 (계약 2절 ④) */
  empty: string;
};

/** 이야기 주제 이어가기(탭2 왼쪽)의 질문 한 장. */
export type StoryQuestion = {
  type: string;
  /** 인용을 못 찾으면 `null` — 장면 이름표를 감춘다 */
  scene: string | null;
  quote: string | null;
  question: string;
  followUp: string;
};

/** 일상생활로 연결하기(탭2 오른쪽)의 질문 한 장. */
export type DailyQuestion = {
  type: string;
  question: string;
  intent: string;
};

/** 상단 활동 드롭다운의 한 줄. */
export type ActivityChoice = {
  sessionId: string;
  /** 「방귀 뀌는 며느리」 */
  story: string;
  /** 8월 3일 */
  date: string;
  /** 아직 안 읽은 리포트 — 목록에 점을 찍는다 (계약 2절 ⑤) */
  unread: boolean;
};

/** 화면 하나가 그리는 값 전부. 컴포넌트는 이 모양만 안다. */
export type Report = {
  sessionId: string;
  /** 헤더 드롭다운에 찍히는 지금 보고 있는 활동 */
  activity: { story: string; date: string };
  /** 아직 안 읽었다 — 탭 옆 점과 `POST .../read` 를 부르는 조건 (계약 2절 ⑤) */
  unread: boolean;
  /** 문장이 아직 없는 리포트 — 「다시 만들기」를 눈에 띄게 낸다 (계약 2절 ②) */
  needsNarrative: boolean;
  /** 지금까지 다시 만든 횟수. 3회를 넘기면 서버가 429 로 막는다 */
  regenerated: number;
  toast: string;

  summary: {
    title: string;
    caption: string;
    stats: { label: string; value: string }[];
  };

  radar: {
    axes: RadarAxis[];
    /** 축이 전부 0 — 오각형 대신 이 문구를 낸다 (계약 2절 ①) */
    notice: string | null;
    comment: string;
  };

  skills: SkillDetail[];
  /** 카드가 없을 때 대신 낼 한 줄 */
  skillsNotice: string | null;
  quoteLabel: string;

  highlight: {
    scene: string | null;
    quote: string | null;
    comment: string;
  } | null;
  highlightNotice: string | null;

  words: {
    caption: string;
    groups: WordGroup[];
    /** 피드백 문장 가운데 한 낱말만 파랗게 강조한다 */
    feedback: { before: string; accent: string; after: string };
  };

  guide: {
    reason: string;
    story: { caption: string; questions: StoryQuestion[] };
    daily: { caption: string; questions: DailyQuestion[] };
    steps: typeof FOLLOW_UP_STEPS;
    /** 질문이 하나도 없을 때 두 기둥 대신 낼 한 줄 */
    notice: string | null;
  };
};

/**
 * 오각형 다섯 꼭짓점 — 시안(47-1889)이 찍어 둔 색과 이름표 좌표.
 *
 * 🔴 이 배열의 순서가 곧 **시계방향 좌표 순서**이고, 서버 `AxisName` 선언 순서와 **다르다.**
 *    `Object.values(axes)` 를 그대로 쓰면 오각형이 엉뚱하게 돈다 — 이름으로 찾아 이 순서를 지킨다.
 * ⚠️ 화면 이름에는 공백이 있고(「관점과 공감」) 서버 이름에는 없다(`'관점과공감'`).
 */
const RADAR_AXES: {
  axis: AxisName;
  name: string;
  color: string;
  label: { x: number; y: number };
}[] = [
  { axis: "관점과공감", name: "관점과 공감", color: "#6fbcdd", label: { x: 191, y: 12 } },
  { axis: "감정표현", name: "감정 표현", color: "#fd7c51", label: { x: 310.5, y: 89 } },
  { axis: "상호작용", name: "상호작용", color: "#a78bfa", label: { x: 252.5, y: 206 } },
  { axis: "생각과이유", name: "생각과 이유", color: "#7bc47f", label: { x: 128, y: 206 } },
  { axis: "결과와해결", name: "결과와 해결", color: "#ea63d4", label: { x: 65, y: 89 } },
];

/** 역량 카드 셋의 색. 이름과 순서는 서버가 고정해 준다(어휘 · 표현 · 논리). */
const SKILL_STYLE: Record<SkillCard["axis"], { color: string; tint: string }> = {
  어휘: { color: "#45a9d3", tint: "#eaf6fb" },
  표현: { color: "#fd7649", tint: "#fff3ec" },
  논리: { color: "#5aa860", tint: "#f0f8f1" },
};

/** 어휘 3단의 이름표·아이콘·색. 값(낱말)은 서버가 준다. */
const WORD_STYLE = {
  main: { title: "주요 어휘", icon: "record_voice_over", color: "#45a9d3", chipBg: "#eaf6fb" },
  asked: { title: "질문한 어휘", icon: "help", color: "#a78bfa", chipBg: "#efefef" },
  repeated: { title: "반복해서 쓴 표현", icon: "repeat", color: "#5aa860", chipBg: "#f0f8f1" },
} as const;

/**
 * 한 칸에 놓을 칩 수. 넘으면 「외 N개」로 접는다.
 *
 * 카드 높이가 시안에 고정돼 있어(`h-[304px]`) 칩이 늘면 글자가 카드 밖으로 넘친다.
 * 시안이 주요 어휘 4개 + 「외 3개」를 그리고 있어 그 수를 그대로 쓴다.
 */
const MAX_CHIPS = 4;

/**
 * 대답이 짧을 때 순서대로 던지는 세 마디. 번호 원의 색이 단계마다 진해진다.
 * ⛔ 서버에서 오지 않는다 — 활동과 무관한 보호자 안내라 화면 상수로 둔다.
 */
const FOLLOW_UP_STEPS = [
  {
    title: "다시 말해보기",
    example: "“방금 그 말 한 번만 더 해줄래?”",
    color: "#c9bcec",
  },
  {
    title: "이유 물어보기",
    example: "“왜 그렇게 생각했어?”",
    color: "#a78bfa",
  },
  {
    title: "상상 넓히기",
    example: "“만약에 반대였다면 어땠을까?”",
    color: "#7c5cd6",
  },
] as const;

/**
 * 값이 없는 칸에 대신 넣는 한 줄 (계약 2절 ②·④).
 *
 * ⛔ 목소리·톤·크기를 말하지 않는다 — 음성을 저장하지 않으므로 들은 척하는 문장은 금지다
 *    (결정 R22).
 */
const NOTICE = {
  /** `status === 'metrics_only'` — 숫자는 다 있고 문장만 없다 */
  noNarrative: "아직 문장이 만들어지지 않았어요.",
  /**
   * 크게 비는 칸(역량별 분석 · 가정 연계 탭)에만 붙이는 긴 판.
   * 한 화면에서 같은 문장을 네 번 읽게 하지 않으려고 짧은 판과 나눠 둔다.
   */
  noNarrativeAction:
    "아직 문장이 만들어지지 않았어요. 위쪽 「다시 만들기」를 눌러 주세요.",
  /** 중단한 활동이거나 그 칸에 담을 말이 안 모였다 */
  fewWords: "이번엔 모인 말이 적어요.",
  /** 축이 전부 0 — 그릴 오각형이 없다 */
  noAxes: "이번엔 모인 말이 적어 그래프를 그리지 못했어요.",
  /** 점수가 선 축이 하나뿐 — 오각형이 아니라 바늘이 된다 (D1 · 명세 4.2) */
  oneAxis: "이번엔 한 갈래에서만 나타나 그래프로 그리기 어려웠어요.",
} as const;

const KST = "Asia/Seoul";

/** ISO 시각을 「8월 3일」로. 서버(UTC)에서 그냥 자르면 저녁 활동이 전날로 밀린다. */
function formatDay(iso: string): string {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: KST,
    month: "long",
    day: "numeric",
  }).format(new Date(iso));
}

/**
 * 보호자가 소리 내어 읽는 줄이라 시안이 따옴표를 씌워 둔다. 서버 문장에는 없다.
 * 이미 따옴표로 시작하면 그대로 둔다 — 겹따옴표를 만들지 않는다.
 */
function quoted(text: string): string {
  return /^["'“‘]/.test(text) ? text : `“${text}”`;
}

/**
 * 어휘 피드백 한 줄을 「앞 · 강조할 낱말 · 뒤」로 가른다.
 *
 * 시안은 문장 가운데 낱말 하나만 파랗게 칠한다. 서버는 문장 하나로 주므로 **처음 나오는
 * 작은따옴표 묶음**을 강조 자리로 본다 (`… '신기하다' 대신 …`). 못 찾으면 통째로 앞에 둔다.
 */
function splitAccent(text: string): {
  before: string;
  accent: string;
  after: string;
} {
  const match = text.match(/(['‘])([^'’]+)(['’])/);
  if (!match || match.index === undefined) {
    return { before: text, accent: "", after: "" };
  }
  return {
    before: text.slice(0, match.index) + match[1],
    accent: match[2],
    after: match[3] + text.slice(match.index + match[0].length),
  };
}

/** 낱말 목록 하나를 칩 카드로. 넘치는 만큼 「외 N개」로 접는다. */
function toWordGroup(
  style: (typeof WORD_STYLE)[keyof typeof WORD_STYLE],
  words: string[],
  empty: string,
): WordGroup {
  const shown = words.slice(0, MAX_CHIPS);
  const rest = words.length - shown.length;
  return {
    ...style,
    words: shown,
    more: rest > 0 ? `외 ${rest}개` : undefined,
    empty,
  };
}

/**
 * 서버 리포트 한 장 → 화면이 그리는 값. **순수 함수**다.
 *
 * `childName` 은 선택된 아이 쿠키에서 온다 (`requireSelectedChild()`). 서버 리포트에는
 * 아이 이름이 없다 — 리포트는 회차에 매달려 있고 이름은 화면이 이미 알고 있기 때문이다.
 */
export function toReportView(
  sessionId: string,
  report: ParentReport,
  childName: string,
): Report {
  const { metrics, narrative } = report;
  const { activity, counts } = metrics;

  const story = `「${activity.story_title}」`;
  const date = formatDay(activity.played_at);

  /* 비어 있는 칸에 넣을 말. 왜 비었는지에 따라 다르다 — 문장이 통째로 없으면 그렇게 말하고,
     그 밖에는 말이 적었다고 말한다 (계약 2절 ②·④). 크게 비는 칸만 「다시 만들기」까지 안내한다. */
  const empty = narrative ? NOTICE.fewWords : NOTICE.noNarrative;
  const emptyBig = narrative ? NOTICE.fewWords : NOTICE.noNarrativeAction;

  /* 🔴 빈 글자도 「없음」으로 친다. `??` 로는 못 잡는다.
     문장을 만드는 LLM 호출이 **두 편**(말하기 분석 · 가정 연계)인데, 한 편만 실패하면
     `narrative` 가 `null` 이 되는 게 아니라 **실패한 편의 칸만 빈 글자로 채워져** 온다
     (`src/report/engine/narrative.ts` 의 실패 처리 — 검사도 그 값이 `''` 임을 단언한다).
     `??` 는 `null`·`undefined` 만 걸러 빈 글자를 그대로 통과시키므로, 안내 문구가 아니라
     **빈 줄**이 그려진다. 배열 칸들은 `length === 0` 을 따로 봐서 안 걸리고, 여기 걸리는
     것은 글자 칸 셋(`overall` · `word_tip` · `reason`)뿐이다. */
  const textOr = (text: string | null | undefined) => (text?.trim() ? text : empty);

  /* 인용은 글자가 아니라 id 로 온다. 서버가 목록 밖 id 를 이미 버렸으므로 찾으면 반드시
     있지만, `null` 이거나 못 찾으면 인용 없이 그린다 (계약 1절). */
  const quoteOf = (id: string | null) =>
    id ? (metrics.quotes.find((quote) => quote.message_id === id) ?? null) : null;

  /* 오각형은 그 활동 안에서만 정규화한다 — 축 점수는 감지된 발화 수라
     활동마다 최댓값이 다르다 (계약 2절 ①). */
  const scores = RADAR_AXES.map((style) => metrics.axes[style.axis]?.score ?? 0);
  const maxScore = Math.max(...scores);

  /* 🔴 **점수가 선 축이 하나뿐이면 그리지 않는다** (D1 · 명세 4.2).
     활동 안에서 정규화하므로 그 축 혼자 100% 가 되어 오각형이 아니라 **바늘 하나**가 선다.
     거의 말 없이 중단한 활동(발화 3건에 「되묻기 회복」 한 점만 있는 판)이 그 꼴이었다.

     경계를 발화 수가 아니라 **선 축의 개수**로 잡은 이유: 문제는 말이 적은 것 자체가 아니라
     **그래프의 모양**이다. 말이 많아도 한 갈래에서만 나타나면 똑같이 바늘이 된다.
     ⛔ 지표는 손대지 않는다 — 축 점수는 사실 그대로 세어 두고(R17), 그릴지 말지만 여기서 정한다. */
  const 선축수 = scores.filter((score) => score > 0).length;

  const skills = (narrative?.cards ?? [])
    .filter((card) => card.axis in SKILL_STYLE)
    .map((card) => {
      const quote = quoteOf(card.quote_message_id);
      return {
        name: card.axis,
        ...SKILL_STYLE[card.axis],
        summary: card.summary,
        quote: quote ? `“${quote.text}”` : null,
        good: card.did_well,
        improve: card.to_improve,
      };
    });

  const highlightQuote = narrative?.highlight
    ? quoteOf(narrative.highlight.quote_message_id)
    : null;
  const highlight = narrative?.highlight
    ? {
        scene: highlightQuote?.scene_label ?? null,
        quote: highlightQuote ? `“${highlightQuote.text}”` : null,
        comment: narrative.highlight.why,
      }
    : null;

  const storyQuestions = (narrative?.story_questions ?? []).map((question) => {
    const quote = quoteOf(question.quote_message_id);
    return {
      type: elementName(question.element),
      /* 「장면 3 · …」 과 「미션 · 배 따기」 두 꼴이 온다. 그대로 찍는다 (M7) */
      scene: quote?.scene_label ?? null,
      quote: quote ? `${childName}: “${quote.text}”` : null,
      question: quoted(question.question),
      followUp: question.fallback,
    };
  });

  const dailyQuestions = (narrative?.daily_questions ?? []).map((question) => ({
    type: question.label,
    question: quoted(question.question),
    intent: question.goal,
  }));

  return {
    sessionId,
    activity: { story, date },
    unread: report.read_at === null,
    needsNarrative: report.status === "metrics_only",
    regenerated: report.regenerated,
    toast: `${childName}의 눈높이에 맞춘 대화를 확인해보세요!`,

    summary: {
      title: `${childName}의 말하기 리포트`,
      caption: `${story} 활동 · ${date} · ${activity.duration_minutes}분 대화`,
      stats: [
        { label: "말한 문장", value: `${counts.child_utterances}개` },
        {
          /* 첫 활동이면 비교할 지난 활동이 없다 — 숫자는 그대로 두고 이름만 바꾼다 (계약 2절 ③) */
          label: activity.prior_activities === 0 ? "처음 만난 낱말" : "새로 쓴 낱말",
          value: `${counts.new_words}개`,
        },
        { label: "질문한 낱말", value: `${counts.asked_words}개` },
      ],
    },

    radar: {
      axes: RADAR_AXES.map((style, index) => ({
        name: style.name,
        value: maxScore === 0 ? 0 : Math.round((scores[index] / maxScore) * 100),
        color: style.color,
        label: style.label,
      })),
      notice:
        선축수 === 0 ? NOTICE.noAxes : 선축수 === 1 ? NOTICE.oneAxis : null,
      comment: textOr(narrative?.overall),
    },

    skills,
    skillsNotice: skills.length > 0 ? null : emptyBig,
    quoteLabel: `${childName}의 말`,

    highlight,
    /* 대표 발화 자리가 빌 때 — 뽑힌 발화가 없거나, 뽑혔는데 인용을 못 찾은 때다 */
    highlightNotice: highlight?.quote ? null : empty,

    words: {
      caption: `이번 활동에서 ${childName}가 쓴 말`,
      /* 낱말은 숫자 쪽이라 문장이 없는 것과 상관이 없다 — 비었으면 말이 적었을 뿐이고,
         「다시 만들기」로 채워지지 않는다. 그래서 여기만 `empty` 를 안 쓴다. */
      groups: [
        toWordGroup(
          WORD_STYLE.main,
          metrics.words.main.map((word) => word.word),
          NOTICE.fewWords,
        ),
        toWordGroup(
          WORD_STYLE.asked,
          metrics.words.asked.map((word) => word.word),
          NOTICE.fewWords,
        ),
        toWordGroup(
          WORD_STYLE.repeated,
          metrics.words.repeated.map((word) => `“${word.phrase}”`),
          NOTICE.fewWords,
        ),
      ],
      feedback: splitAccent(textOr(narrative?.word_tip)),
    },

    guide: {
      reason: textOr(narrative?.reason),
      story: { caption: `${story} 속으로`, questions: storyQuestions },
      daily: { caption: "오늘 저녁 식탁에서", questions: dailyQuestions },
      steps: FOLLOW_UP_STEPS,
      notice:
        storyQuestions.length > 0 || dailyQuestions.length > 0 ? null : emptyBig,
    },
  };
}

/** 활동 목록 응답 → 상단 드롭다운. 서버가 최근 순으로 준 순서를 그대로 쓴다. */
export function toActivityChoices(items: ReportListItem[]): ActivityChoice[] {
  return items.map((item) => ({
    sessionId: item.session_id,
    story: `「${item.story_title}」`,
    date: formatDay(item.played_at),
    unread: item.unread,
  }));
}
