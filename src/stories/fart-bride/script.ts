/**
 * script.md 전체 대사를 TTS 가 연기할 수 있는 형태로 정리한 대본 데이터.
 *
 * 원본(content/stories/fart-bride/source/script.md)에는 화자 표기만 있고
 * 말투 지시가 없다 — 장면의 감정 흐름에 맞춰 대사마다 Gemini-TTS 말투
 * 지시(stylePrompt)를 붙였다. 인터랙티브 4씬(4·7·10·16)의 말투는
 * data.ts 의 speaker.stylePrompt 와 같게 맞춰 재생 화면과 어긋나지 않는다.
 *
 * 원본 오타는 바로잡았다: 훨신→훨씬, 함게→함께.
 */

import type { TtsVoice } from "@/tts/voices";

export type ScriptSpeaker = "내레이션" | "며느리" | "시아버지" | "이장님";

/** story_database.json 의 성우 매핑과 동일 */
export const SPEAKER_VOICES: Record<ScriptSpeaker, TtsVoice> = {
  내레이션: "Despina",
  며느리: "Leda",
  시아버지: "Schedar",
  이장님: "Sadachbia",
};

export type ScriptLine = {
  speaker: ScriptSpeaker;
  text: string;
  /** Gemini-TTS 말투 연기 지시 */
  stylePrompt: string;
};

export type ScriptSection = {
  /** script.md 의 이미지 블록 번호 (1~18, 대화 씬은 "4-1" 식) */
  id: string;
  title: string;
  lines: ScriptLine[];
};

/* 내레이션(Despina)의 장면별 말투 — 이야기 흐름의 감정 곡선을 따라간다 */
const NARR = {
  base: "옛날이야기를 들려주는 다정한 이야기꾼처럼, 차분하고 따뜻하게 말해 주세요.",
  worried:
    "걱정스러운 장면을 전하듯, 목소리를 낮추고 안타까운 마음을 담아 천천히 말해 주세요.",
  tense:
    "무슨 일이 벌어질 것 같은 장면처럼, 살짝 긴장감을 담아 점점 고조되게 말해 주세요.",
  excited:
    "큰 소동이 벌어진 장면을 중계하듯, 놀라움을 담아 빠르고 생생하게 말해 주세요.",
  sad: "슬픈 장면을 전하듯, 조용하고 먹먹한 목소리로 천천히 말해 주세요.",
  hint: "다음 이야기를 살짝 귀띔하듯, 뜸을 들이며 기대감을 담아 말해 주세요.",
  curious:
    "새로운 것을 발견한 장면처럼, 호기심을 담아 살짝 들뜬 목소리로 말해 주세요.",
  joyful: "잔치가 벌어진 듯, 밝고 신나는 목소리로 말해 주세요.",
  warm: "이야기를 따뜻하게 마무리하듯, 흐뭇하고 편안한 목소리로 천천히 말해 주세요.",
};

/* 화자별 한 줄 생성 헬퍼 — 대본을 읽기 좋게 유지한다 */
const narr = (text: string, stylePrompt: string): ScriptLine => ({
  speaker: "내레이션",
  text,
  stylePrompt,
});
const bride = (text: string, stylePrompt: string): ScriptLine => ({
  speaker: "며느리",
  text,
  stylePrompt,
});
const father = (text: string, stylePrompt: string): ScriptLine => ({
  speaker: "시아버지",
  text,
  stylePrompt,
});
const chief = (text: string, stylePrompt: string): ScriptLine => ({
  speaker: "이장님",
  text,
  stylePrompt,
});

export const SCRIPT: ScriptSection[] = [
  {
    id: "1",
    title: "도입",
    lines: [
      narr("옛날 어느 마을에 방귀를 아주 크게 뀌는 며느리가 살았습니다.", NARR.base),
      narr("며느리는 시집에 온 뒤로 늘 얌전하고 예의 바르게 보이고 싶었습니다.", NARR.base),
      narr("시댁 식구들이 자신을 이상하게 볼까 봐 걱정했기 때문입니다.", NARR.base),
    ],
  },
  {
    id: "2",
    title: "전개 1 · 참는 며느리",
    lines: [
      narr("그래서 며느리는 방귀가 나오려고 할 때마다 꾹꾹 참았습니다.", NARR.worried),
      narr(
        "하루도 참고, 이틀도 참고, 그렇게 오래 참다 보니 배는 점점 빵빵하게 부풀어 올랐고 얼굴은 노랗게 변했습니다.",
        NARR.worried,
      ),
      narr(
        "몸도 마음도 너무 힘들었지만, 며느리는 차마 가족들에게 솔직하게 말하지 못했습니다.",
        NARR.worried,
      ),
    ],
  },
  {
    id: "3",
    title: "대화 1 · 며느리의 걱정",
    lines: [
      narr("며느리는 걱정이 많았습니다.", NARR.worried),
      narr(
        "사실 방귀는 누구에게나 나오는 자연스러운 일이지만, 며느리에게는 그것이 큰 비밀처럼 느껴졌습니다.",
        NARR.worried,
      ),
      narr(
        "특히 자신의 방귀는 한 번 나오면 지붕이 흔들릴 만큼 우렁찼기 때문에 더욱 부끄러웠습니다.",
        NARR.worried,
      ),
    ],
  },
  {
    id: "4-1",
    title: "며느리의 질문 (인터랙티브)",
    lines: [
      /* data.ts scene4 의 stylePrompt 와 동일 */
      bride(
        "ㅇㅇ아, 내 방귀가 너무 크다는 걸 알면 가족들이 나를 이상하게 생각하지 않을까?",
        "다정하고 조심스러운 젊은 여성이 아이에게 속마음을 털어놓듯, 부드럽고 따뜻하게 말해 주세요.",
      ),
    ],
  },
  {
    id: "4-2",
    title: "며느리의 답변 (인터랙티브)",
    lines: [
      bride(
        "그렇구나. 그래도 아직은 못 말하겠어, 조금만 더 참아 볼게.",
        "아직 용기가 나지 않아 머뭇거리듯, 조심스럽고 잔잔한 목소리로 말해 주세요.",
      ),
    ],
  },
  {
    id: "5",
    title: "전개 2 · 솔직한 고백",
    lines: [
      narr("그러던 어느 날, 며느리는 더 이상 참을 수 없었습니다.", NARR.tense),
      narr("배가 너무 아프고 숨 쉬기도 힘들었습니다.", NARR.tense),
      narr("며느리는 조심스럽게 가족들에게 말했습니다.", NARR.tense),
      bride(
        "저... 사실은 방귀를 너무 오래 참아서 배가 아파요. 조금만 뀌어도 될까요?",
        "오래 참아 온 말을 어렵게 꺼내듯, 미안하고 조심스러운 목소리로 작게 말해 주세요.",
      ),
    ],
  },
  {
    id: "6",
    title: "방귀 폭발",
    lines: [
      narr("며느리는 아주 살짝만 뀌려고 했습니다.", NARR.tense),
      narr(
        "하지만 그동안 너무 오래 참았던 탓에 방귀는 생각보다 훨씬 크게 터져 나왔습니다.",
        NARR.excited,
      ),
      narr(
        "마당의 먼지가 휘리릭 날아가고, 기왓장이 달그락거리고, 시아버지의 갓까지 휙 날아가 버렸습니다.",
        NARR.excited,
      ),
      narr("시아버지는 깜짝 놀라 화를 냈습니다.", NARR.excited),
    ],
  },
  {
    id: "7-1",
    title: "시아버지의 질문 (인터랙티브)",
    lines: [
      /* data.ts scene7 의 stylePrompt 와 동일 */
      father(
        "아이고, 이게 무슨 일이냐! 우리 집안이 다 흔들리는구나! 이렇게 창피한 며느리랑 함께 못 살겠다! 그렇지 않니?",
        "근엄하지만 속정 있는 할아버지가 못마땅한 듯하면서도 아이에게는 낮고 부드러운 목소리로 말해 주세요.",
      ),
    ],
  },
  {
    id: "7-2",
    title: "시아버지의 답변 (인터랙티브)",
    lines: [
      father(
        "흥, 그래도 도저히 이런 며느리와는 함께 살 수 없으니 친정으로 데려다줘야겠다.",
        "여전히 못마땅한 할아버지가 단호하게 선을 긋듯, 낮고 무뚝뚝한 목소리로 말해 주세요.",
      ),
    ],
  },
  {
    id: "8",
    title: "대화 2 · 슬픈 며느리",
    lines: [
      narr("며느리는 고개를 푹 숙였습니다.", NARR.sad),
      narr(
        "일부러 그런 것이 아니었지만, 모두가 놀란 모습을 보니 마음이 더 작아졌습니다.",
        NARR.sad,
      ),
      narr(
        "시아버지는 며느리의 방귀가 너무 별나다며, 이런 며느리와는 함께 살 수 없다고 말했습니다.",
        NARR.sad,
      ),
      narr("며느리는 슬펐습니다.", NARR.sad),
      narr("자신이 가족에게 피해만 주는 사람처럼 느껴졌기 때문입니다.", NARR.sad),
      narr(
        "하지만 며느리의 방귀가 정말 쓸모없는 것인지는 아직 아무도 알지 못했습니다.",
        NARR.hint,
      ),
      narr(
        "결국 시아버지는 방귀 뀌는 며느리를 데리고 친정에 데려다주러 길을 나섰습니다.",
        NARR.sad,
      ),
    ],
  },
  {
    id: "9",
    title: "전개 3 · 높은 배나무",
    lines: [
      narr(
        "그런데 한참 걷다 보니 길가에 아주 높은 배나무가 한 그루 서 있었습니다.",
        NARR.curious,
      ),
      narr(
        "나무 꼭대기에는 노랗고 탐스러운 배들이 주렁주렁 매달려 있었습니다.",
        NARR.curious,
      ),
      narr("시아버지는 배를 보자 군침이 돌았습니다.", NARR.curious),
      father(
        "참 맛있어 보이는 배로구나, 그런데 너무 높아서 딸 수가 없겠네.",
        "탐스러운 배를 보고 군침을 삼키듯, 감탄하면서도 아쉬운 목소리로 말해 주세요.",
      ),
      narr(
        "마을 사람들도 그 배를 먹고 싶어 했지만, 나무가 너무 높아 아무도 딸 수 없었습니다.",
        NARR.curious,
      ),
      narr(
        "긴 장대를 가져와도 닿지 않았고, 나무에 올라가려 해도 가지가 너무 높았습니다.",
        NARR.curious,
      ),
    ],
  },
  {
    id: "10-1",
    title: "이장님의 설명 (인터랙티브)",
    lines: [
      chief(
        "이 배나무는 해마다 탐스러운 배가 열리지만, 너무 높아서 아무도 딸 수가 없었단다.",
        "마을 어른이 아이에게 마을 이야기를 들려주듯, 정겹지만 아쉬움을 섞어 말해 주세요.",
      ),
    ],
  },
  {
    id: "10-2",
    title: "이장님의 감탄 (인터랙티브)",
    lines: [
      /* data.ts scene10 의 stylePrompt 와 동일 */
      chief(
        "아이고, 방귀 뀌는 며느리 덕분에 온 마을이 배 잔치를 할 수 있겠구려, 고맙소!",
        "쾌활한 마을 어른이 너털웃음을 섞어 감탄하듯, 활기차고 정겹게 말해 주세요.",
      ),
    ],
  },
  {
    id: "11",
    title: "며느리의 깨달음",
    lines: [
      narr("그때 며느리는 문득 생각했습니다.", NARR.curious),
      bride(
        "내 방귀가 지붕도 흔들 만큼 힘이 세다면, 저 높은 배를 떨어뜨릴 수도 있지 않을까?",
        "좋은 생각이 번뜩 떠오른 듯, 혼잣말처럼 시작해 점점 설레는 목소리로 말해 주세요.",
      ),
      narr("며느리는 조심스럽게 시아버지에게 말했습니다.", NARR.tense),
      bride(
        "아버님, 제가 한번 해 볼게요. 대신 사람들이 다치지 않도록 모두 조금 떨어져 주세요.",
        "용기를 내어 나서듯, 조심스럽지만 단단한 목소리로 또박또박 말해 주세요.",
      ),
    ],
  },
  {
    id: "12",
    title: "자리를 잡는 며느리",
    lines: [
      narr("마을 사람들은 처음에는 어리둥절했습니다.", NARR.tense),
      narr(
        "하지만 며느리는 나무를 향해 자리를 잡고, 배가 떨어질 곳을 살폈습니다.",
        NARR.tense,
      ),
      narr(
        "사람들이 없는 쪽으로 몸을 돌리고, 배나무 위쪽을 향해 힘을 모았습니다.",
        NARR.tense,
      ),
      narr("그리고 크게 외쳤습니다.", NARR.tense),
    ],
  },
  {
    id: "13",
    title: "방귀 나갑니다!",
    lines: [
      bride("방귀 나갑니다!", "온 마을에 들리도록 우렁차게, 힘차게 외쳐 주세요."),
      narr("곧이어 천둥 같은 방귀 소리가 울려 퍼졌습니다.", NARR.excited),
      narr(
        "바람이 세차게 불더니 높은 나무에 매달려 있던 배들이 우수수 떨어졌습니다.",
        NARR.excited,
      ),
      narr("사람들은 깜짝 놀라면서도 곧 기뻐했습니다.", NARR.joyful),
      narr("아무도 따지 못했던 배가 마당 가득 떨어졌기 때문입니다.", NARR.joyful),
    ],
  },
  {
    id: "14",
    title: "배 잔치",
    lines: [
      narr("시아버지도 떨어진 배를 하나 먹어보았습니다.", NARR.joyful),
      narr("배는 달고 시원했습니다.", NARR.joyful),
      narr("마을 사람들도 배를 나누어 먹으며 즐거워했습니다.", NARR.joyful),
      narr(
        "모두가 배불리 먹고 나자, 시아버지는 며느리를 다시 바라보았습니다.",
        NARR.warm,
      ),
      narr(
        "처음에는 시끄럽고 별나다고만 생각했던 며느리의 방귀가, 알고 보니 모두를 도울 수 있는 특별한 힘이었던 것입니다.",
        NARR.warm,
      ),
    ],
  },
  {
    id: "15",
    title: "시아버지의 사과",
    lines: [
      narr("시아버지는 며느리에게 미안한 마음이 들었습니다.", NARR.warm),
      father(
        "내가 네 모습을 제대로 보지 못했구나. 남들과 다르다고 해서 부끄러운 것이 아닌데, 내가 너무 성급하게 생각했다.",
        "미안한 마음을 담아 진심으로 사과하듯, 낮고 따뜻한 목소리로 천천히 말해 주세요.",
      ),
    ],
  },
  {
    id: "16-1",
    title: "며느리의 질문 (인터랙티브)",
    lines: [
      /* data.ts scene16 의 stylePrompt 와 동일 */
      bride(
        "ㅇㅇ이 덕분에 내 방귀가 누군가에게 도움이 될 수 있다는 걸 처음 알았어.",
        "홀가분해진 젊은 여성이 아이에게 고마움을 전하듯, 밝고 따뜻하게 말해 주세요.",
      ),
      bride(
        "이제는 방귀 소리가 큰 걸 부끄러워하지 않아도 될까?",
        "홀가분해진 젊은 여성이 아이에게 고마움을 전하듯, 밝고 따뜻하게 말해 주세요.",
      ),
    ],
  },
  {
    id: "16-2",
    title: "며느리의 다짐 (인터랙티브)",
    lines: [
      bride(
        "이제는 부끄러워하며 숨기지 않고, 조심해서 좋은 일에 써 볼게.",
        "마음을 정한 듯 후련하게, 밝고 다짐하는 목소리로 말해 주세요.",
      ),
    ],
  },
  {
    id: "17",
    title: "편안해진 며느리",
    lines: [
      narr("며느리는 그 말을 듣고 마음이 조금씩 편안해졌습니다.", NARR.warm),
      narr(
        "자신이 숨기고 싶어 했던 특징이 누군가에게 도움이 될 수도 있다는 것을 알게 되었기 때문입니다.",
        NARR.warm,
      ),
      narr("그 뒤로 며느리는 더 이상 방귀를 무조건 참지 않았습니다.", NARR.warm),
      narr("물론 아무 때나 함부로 뀌지는 않았습니다.", NARR.warm),
      narr("대신 몸이 힘들 때는 솔직하게 말하고", NARR.warm),
      narr("사람들이 놀라지 않도록 미리 알려 주었습니다.", NARR.warm),
    ],
  },
  {
    id: "18",
    title: "함께하는 마을",
    lines: [
      narr("마을 사람들도 며느리를 놀리지 않았습니다.", NARR.warm),
      narr(
        "오히려 높은 나무의 열매를 딸 때나, 큰 바람이 필요할 때 며느리에게 도움을 부탁했습니다.",
        NARR.warm,
      ),
      narr("며느리는 자신의 방귀를 부끄러운 비밀이 아니라,", NARR.warm),
      narr("잘 쓰면 모두에게 도움이 되는 특별한 힘으로 여기게 되었습니다.", NARR.warm),
    ],
  },
];
