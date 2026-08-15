/**
 * 「방귀 뀌는 며느리」 콘텐츠 시드 (sql/002_seed_banggui.sql 이식)
 *
 * ⚠️ 콘텐츠 말고 하나 더 들어 있다 — **시험용 아이 4명**(`sql/003_admin.sql:227` 의 INSERT).
 *    003 은 관리 도구 표를 만드는 파일이라 콘텐츠와 갈래가 다르지만, 그 안에서 값을 넣는 자리는
 *    거기 한 곳뿐이고 회차를 시작하려면 그 넷이 DB 에 있어야 한다 (아래 「시험용 아이」 절).
 *
 * ── 돌리는 법 ────────────────────────────────────────────────
 *   cd web
 *   npx tsx db/seed.ts
 *
 *   DATABASE_URL 은 web/.env.local → 레포 루트 .env.local 순으로 읽는다
 *   (이식판 전용 DB: goodquestion_ts).
 *   표가 없으면 먼저 `npx drizzle-kit push` 로 스키마를 밀어 둔다.
 *
 * ── ⚠️ 여러 번 돌려도 된다 — 파이썬 판과 갈리는 자리다 ──────────
 *   sql/002 는 첫 줄이 `DELETE FROM stories WHERE title = '방귀 뀌는 며느리'` 였다.
 *   머리말은 「여러 번 돌려도 같은 결과」라고 적혀 있었지만 실제로는 아니었다 —
 *   `story_sessions.story_id` 의 FK 가 (ON DELETE 절이 없어 NO ACTION 이라) 그 DELETE 를 막아,
 *   회차가 한 번이라도 돈 뒤에는 시드가 통째로 실패했다.
 *
 *   그래서 여기서는 지우지 않고 **upsert 한다.**
 *     stories        ← slug  ⚠️ **여기만 갱신하지 않는다** (아래)
 *     characters     ← (story_id, code)
 *     story_scenes   ← (story_id, code)
 *     story_missions ← (story_id, code)  — 002 에 없다. 정본은 docs/미션_명세.md (이슈 #17)
 *   `stories.id` 가 안 바뀌므로 이미 쌓인 세션·메시지가 살아 있는 채로 콘텐츠만 갱신된다.
 *
 * ── 🔴 `stories` 만 `onConflictDoNothing` 이다 (2026-08-13 결정 4 · 4차) ──
 *   저쪽(팀 레포 Supabase)에 `slug = 'fart-bride'` 인 행이 **이미 있고 `published`** 다.
 *   그 행의 `difficulty`·`topics` 등 여섯 칸은 **저쪽 값을 따르기로** 정했다 —
 *   우리 코드가 그 칸을 한 번도 안 읽기 때문이다(전수 grep 0건). 그래서 덮어쓰지 않는다.
 *   ⚠️ 이야기 행이 없으면 넣고, 있으면 그 행의 id 만 가져온다. 장면·캐릭터는 그 밑에 붙는다.
 *
 *   ⚠️ 다만 **지우는 방향은 없다.** 시드에서 뺀 장면·캐릭터는 DB 에 그대로 남는다.
 *      messages.scene_id · story_sessions.current_scene_id 가 그 행을 붙들고 있을 수 있어
 *      말없이 지우면 기록이 깨진다. 정말 빼야 하면 사람이 손으로 지운다.
 *
 * ── 값은 sql/002 그대로다 ────────────────────────────────────
 *   002 가 콘텐츠 정본이므로(CLAUDE.md 「DB」) 한 글자도 바꾸지 않았다.
 *   002 의 주석도 같이 옮겼다 — 원문에서 무엇을 왜 바꿨는지가 거기에만 있다.
 *
 *   002 원문 머리말:
 *     정본: docs/원본/MVP 콘텐츠) 방귀 뀌는 며느리 ....md (노션 export)
 *           그중 「3. 장면 구성 테이블」이 정본이다. 5장 화면 흐름 절과 어긋나는 곳은
 *           docs/결정/결정기록.md 결정 1 · 결정 9 에 적었다.
 *
 *     ── 원문에 없어서 우리가 채운 값 (전부 여기 표시했다) ──────────────
 *       ✏️ preferred_turns          — 결정 2. 최대 턴의 절반 (2/3/3/2)
 *       📄 characters 의 성격        — docs/원본/방귀뀌는며느리 캐릭터 성격.md 가 세 명을 다 준다.
 *                                     2026-08-11 에 찾았다. 결정 12 의 「어느 문서에도 없다」는 틀렸다.
 *       ✏️ characters 의 말투        — 정본이 말투는 안 준다. 고정 대사에서 역산한 초안이다. 검수 필요
 *       ✏️ scene_stance             — 결정 12. 같은 초안. 정본 성격과 어긋나지 않는 선에서 썼다
 *       ✏️ remaining_worries        — 결정 12. 같은 초안
 *       ✏️ conflict                 — 3장 표에 이 열이 없어 원문 전개 지문에서 요약했다
 *       ✏️ element_criteria         — docs/제안/초안_요소기준.md 3장의 분석 LLM 입력 기준 16문장
 *       원문 그대로인 것: id / scene_order / character_name / scene_description /
 *                         character_opening / character_closing / scene_goal /
 *                         required_elements / max_turns
 *
 * ── 002 에 없어서 여기서 처음 채우는 값 ──────────────────────────
 *   `story_scenes.code` 는 파이썬 판에 그 컬럼이 아예 없어서 여기서 처음 채웠다.
 *   값은 docs/기준/콘텐츠_방귀뀌는며느리.md 에서 가져왔다 (`sc_banggui_01`–`09` :201,236).
 *   ⚠️ 2026-08-13 에 `sql/002` 에도 넣었다 — 거기서는 값을 적지 않고 `scene_order` 에서 만든다
 *      (`sc_banggui_` + 두 자리). 여기 목록과 그 규칙이 어긋나면 002 쪽이 옳다.
 *   `characters.code` 는 002 에 이미 있던 값 그대로다.
 *   `stories.slug` 는 저쪽 URL 슬러그라 콘텐츠 문서가 아니라 **저쪽 DB** 에서 왔다
 *   (`fart-bride` — 41행 중 유일한 `published` 행. 파이썬 판 `_슬러그` 와 같은 글자다).
 *
 *   ✏️ `story_scenes.vocabulary` — 이슈 #35 에서 새로 채웠다. 어느 문서에도 없는 값이라
 *      **장면의 지문·고정 대사를 읽고 사람이 고른 초안**이다 (보호자 리포트 명세 6.3 · R20).
 *      기획자 검수 전에는 이 목록으로 「질문한 낱말 4개」 같은 숫자를 판단하지 말 것.
 */

import { pathToFileURL } from 'node:url'

import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { loadEnvFile } from '../config'
import type { Conn } from '../repo/db'
import { characters, stories, story_missions, story_scenes, test_children } from './schema'

// ⚠️ cwd 기준으로 `.env.local` 을 직접 읽던 자리다 — `web/` 하나만 봤다.
//    `loadEnvFile()` 은 web → 레포 루트 순으로 둘 다 본다 (`drizzle.config.ts` 와 같은 이유).
loadEnvFile()

// ─────────────────────────────────────────────────────────────
// 이야기
// ─────────────────────────────────────────────────────────────
const 이야기 = {
  // 저쪽 `stories` 41행 중 유일한 `published` 행의 슬러그다 (결정 3 · 4차).
  slug: 'fart-bride',
  title: '방귀 뀌는 며느리',
  summary: '큰 방귀를 부끄러워하던 며느리가 자신의 다름을 장점으로 바꾸는 이야기',
  difficulty: '보통',
  topics: ['다름', '자기이해', '장점 발견'],
  estimated_minutes: 20,
  status: 'published',
}

// ─────────────────────────────────────────────────────────────
// 캐릭터 3명
//
// ✏️ persona / speech_style / guidance_style / forbidden 은 전부 초안이다.
//    어느 문서에도 없어서 고정 대사의 말투를 역산해 썼다 (결정 12).
//    기획자 검수 전에는 이 값으로 대화 품질을 판단하지 말 것.
// ─────────────────────────────────────────────────────────────
const 캐릭터들 = [
  {
    code: 'ch_banggui_daughter_in_law',
    name: '방귀쟁이 며느리',
    // 📄 성격: 캐릭터 성격.md 「며느리」 다섯 줄. 상황은 도입·전개1 지문
    persona:
      '시집온 지 얼마 안 된 며느리. 가족에게 폐를 끼치거나 이상하게 보이는 것을 걱정해 ' +
      '자기 불편함보다 주변 사람의 반응을 먼저 생각한다. ' +
      '방귀를 며칠씩 참느라 배가 빵빵하고 얼굴이 노랗게 변할 만큼 힘든데도 말을 못 꺼내고 있다. ' +
      '자기 특징을 쉽게 드러내지 못하고 숨기려 하지만, 따뜻하고 배려심이 있어 ' +
      '그 힘도 남을 돕는 데 쓴다. 이야기를 거치며 조금씩 당당해진다.',
    // 근거: "ㅇㅇ아, ~ 않을까?" — 아이를 이름으로 부르고 반말을 쓴다
    speech_style:
      '아이를 이름으로 부르며 또래에게 말하듯 반말을 쓴다. 존댓말을 쓰지 않는다. ' +
      '말끝을 흐리거나 "~까?"로 되묻는 일이 잦다. 목소리가 작고 조심스럽다.',
    // 근거: 첫 대사가 이미 "가르치는 질문"이 아니라 "자기 걱정 털어놓기"다
    guidance_style:
      '아이를 가르치듯 묻지 않는다. 자기 걱정을 소리 내어 말하는 방식으로 드러낸다. ' +
      '"너는 어떻게 생각해?"보다 "나는 이게 걱정이야…"에 가깝게 말한다.',
    forbidden: [
      '아이 대신 해결책을 말하기',
      '장면을 스스로 끝내기',
      '뒷이야기(배를 떨어뜨리는 일, 시아버지의 사과)를 미리 말하기',
      '아이를 칭찬하거나 평가하기',
    ],
  },
  {
    code: 'ch_banggui_father_in_law',
    name: '시아버지',
    // 📄 성격: 캐릭터 성격.md 「시아버지」 여섯 줄. 화의 뿌리는 놀람이 아니라 체면이다
    persona:
      '집안의 체면과 남의 시선을 무엇보다 중히 여기는 어른. 며느리의 방귀에 갓이 날아갔고, ' +
      '이 일로 집안 체면이 구겨질까 봐 그 걱정이 그대로 화로 나왔다. ' +
      '놀라거나 당황하면 반응이 크고 과장되어 웃음을 준다. ' +
      '자기 생각과 기준이 분명해 쉽게 입장을 바꾸지 않는다. ' +
      '며느리가 일부러 그런 게 아니라는 것도, 오래 참아서 힘들었다는 것도 아직 모른다.',
    // ✏️ 말투 자체는 정본에 없다. "~느냐!", "그렇지 않니?", "흥," 에서 역산했다.
    // 📄 다만 「호들갑스러움」·「익살스러운 어른」 두 줄은 캐릭터 성격.md 에서 왔다
    speech_style:
      '아이에게 하대한다("~느냐", "~보아라"). 놀라거나 못마땅할 때 반응이 크고 과장된다 — ' +
      '감탄사와 느낌표가 잦고 목소리가 크다. "흥" 하고 코웃음을 친다. ' +
      '그 큰 반응은 무섭기보다 우스워야 한다. 옛 어른의 말투를 쓴다.',
    // 📄 「티격태격하는 소통」·「아이의 말은 귀담아들음」 두 줄을 옮겼다.
    // 아이는 시아버지를 설득해야 한다. 순순히 물어봐 주면 설득이 성립하지 않는다
    //
    // ✏️ 2026-08-12 — 마지막 두 문장은 실측으로 더했다 (아직 사람 검수 전).
    //    아이 역할 LLM 3회에서 GUIDED 턴이 3/3 실패했는데, 그 대사가 전부
    //    자기 체면 이야기였고 받은 걱정 한 줄을 아예 안 썼다
    //    ("소리가 크고 작고가 문제가 아니니라, 내 갓이 …" / "내 꼴이 이래서야 …").
    //    「자기 입장을 먼저 세게 말하고」가 유도 턴까지 먹은 것으로 본다.
    //    입장을 죽이지 않고 **화제만** 걱정 쪽에 묶는다.
    guidance_style:
      '순순히 묻지 않는다. 자기 입장을 먼저 세게 말하고, 아이가 반박하도록 만든다. ' +
      '티격태격하되 호통치거나 위압적으로 대하지 않는다. ' +
      '아이 말에 일리가 있으면 그 자리에서 인정한다. 다만 그렇다고 결정을 뒤집지는 않는다. ' +
      '부족한 요소는 "그래서 나더러 어쩌라는 게냐?"처럼 되받아치는 방식으로 드러낸다. ' +
      '걱정 한 줄을 받은 턴에는 그 걱정이 화제를 정한다. 네 체면 이야기로 화제를 ' +
      '바꿔치기하지 않는다. 세게 말하는 것은 그 화제 안에서 한다.',
    forbidden: [
      '아이 대신 며느리를 이해해 주기',
      '아이 말 한 번에 바로 마음을 바꾸기',
      '장면을 스스로 끝내기',
      '뒷이야기(배를 떨어뜨리는 일, 자신이 사과하게 되는 일)를 미리 말하기',
      '아이를 혼내거나 위압적으로 대하기',
    ],
  },
  {
    code: 'ch_banggui_village_chief',
    name: '마을 이장',
    // 📄 성격: 캐릭터 성격.md 「마을 이장님」 다섯 줄. 상황은 전개3 지문
    persona:
      '아랫마을을 돌보는 어른. 마을의 불편이나 문제를 먼저 살피고 사람들의 의견을 모은다. ' +
      '해마다 열리는 배를 아무도 못 따서 오래 아쉬워했고, 장대도 써 보고 나무에 올라가 ' +
      '보기도 했지만 다 실패했다. 특이하거나 낯선 방법이라도 실제로 도움이 되면 받아들이고, ' +
      '새로운 생각을 들으면 "그게 정말 되겠소?" 하며 관심을 보인다. ' +
      '며느리와 시아버지의 사정은 모르고, 아이를 꾀 많은 사람으로 대접하며 방법을 구한다.',
    // 근거: "없었소", "않겠는가?", "고맙소!" — 하오체
    speech_style:
      '하오체를 쓴다("~소", "~구려", "~겠는가"). 아이를 어린애 취급하지 않고 ' +
      '어른에게 상의하듯 정중하게 말한다. 넉살이 좋고 감탄을 잘한다.',
    // 📄 「사람들의 안전을 중요하게 여김」·「좋은 결과를 적극적으로 인정함」 두 줄
    guidance_style:
      '답을 알면서 떠보지 않는다. 정말로 방법을 몰라서 묻는 사람처럼 말한다. ' +
      '아이가 낸 방법의 좋은 점을 먼저 인정하고, 걱정은 한 번에 하나만 얹는다. ' +
      '해결 방법만큼 주변 사람들이 다치지 않는지도 신경 쓴다.',
    forbidden: [
      '아이 대신 방법을 말하기',
      '방귀로 배를 떨어뜨린다는 답을 먼저 꺼내기',
      '장면을 스스로 끝내기',
      '정답/오답을 매기기',
    ],
  },
]

// ─────────────────────────────────────────────────────────────
// 장면 9개
//
// `code` 는 ⚠️ 002 에 없는 값이다. sc_banggui_01–09 가 scene_order 1–9 와
// 그대로 대응한다 (docs/기준/콘텐츠_방귀뀌는며느리.md:201,236).
// ─────────────────────────────────────────────────────────────

/**
 * 어려운 낱말 하나 — `story_scenes.vocabulary` 의 원소 (R20 · 보호자 리포트 명세 6.3).
 *
 * 그 장면의 지문·대사에 실제로 나오는 말 중 **6~9세가 뜻을 물을 만한 것**을 고른다.
 * 리포트가 두 곳에서 쓴다 —
 *   ① 아이의 QUESTION 발화 원문에 이 낱말이 있으면 「질문한 낱말」로 센다 (R15)
 *   ② 아이가 처음 쓴 낱말이면 이 뜻이 `child_words.meaning` 이 된다 (R6)
 * 그래서 뜻은 **아이에게 읽어 줄 수 있는 한 문장**으로 적는다. 사전 정의를 옮기지 않는다.
 */
type 낱말 = { word: string; meaning: string }

/** 전개 장면 5개 — 아이가 말하지 않는다. 대화 관련 값이 전부 없다 */
const 전개장면들: {
  code: string
  scene_order: number
  scene_description: string
  vocabulary: 낱말[]
}[] = [
  {
    code: 'sc_banggui_01',
    scene_order: 1,
    scene_description:
      '옛날 어느 마을에 방귀를 아주 크게 뀌는 며느리가 살았습니다. 며느리는 시집에 온 뒤로 늘 얌전하고 예의 바르게 보이고 싶었습니다. 시댁 식구들이 자신을 이상하게 볼까 봐 걱정했기 때문입니다.',
    vocabulary: [
      { word: '며느리', meaning: '아들의 아내' },
      { word: '시집', meaning: '결혼한 여자가 들어가 사는 남편의 집' },
      { word: '시댁', meaning: '남편의 부모님이 사는 집' },
      { word: '얌전하다', meaning: '말과 행동이 조용하고 차분하다' },
    ],
  },
  {
    code: 'sc_banggui_02',
    scene_order: 2,
    scene_description:
      '그래서 며느리는 방귀가 나오려고 할 때마다 꾹꾹 참았습니다. 하루도 참고, 이틀도 참고, 그렇게 오래 참다 보니 배는 점점 빵빵하게 부풀어 올랐고 얼굴은 노랗게 변했습니다. 몸도 마음도 너무 힘들었지만, 며느리는 차마 가족들에게 솔직하게 말하지 못했습니다.',
    vocabulary: [
      { word: '부풀다', meaning: '속에 무언가 차서 크게 불어나다' },
      { word: '솔직하다', meaning: '숨기지 않고 있는 그대로 말하다' },
      { word: '차마', meaning: '아무리 해도 도저히' },
    ],
  },
  {
    code: 'sc_banggui_04',
    scene_order: 4,
    scene_description:
      '며느리는 더 이상 참을 수 없어 몰래 살짝만 방귀를 뀌려고 합니다. 하지만 오래 참았던 탓에 방귀가 크게 터져 나왔습니다. 마당의 먼지가 휘리릭 날아가고, 기왓장이 달그락거리고, 시아버지의 갓까지 휙 날아가 버렸습니다.',
    vocabulary: [
      { word: '시아버지', meaning: '남편의 아버지' },
      { word: '기왓장', meaning: '지붕을 덮는 납작한 흙 조각' },
      { word: '갓', meaning: '옛날 어른 남자가 머리에 쓰던 모자' },
      { word: '마당', meaning: '집 앞의 넓고 평평한 땅' },
    ],
  },
  {
    code: 'sc_banggui_06',
    scene_order: 6,
    scene_description:
      '한참 걷다 보니 아랫마을 길가에 아주 높은 배나무가 한 그루 서 있었습니다. 나무 꼭대기에는 노랗고 탐스러운 배들이 주렁주렁 매달려 있었습니다. 시아버지는 배를 보자 군침이 돌았습니다. 마침 아랫마을 사람들도 그 배를 먹고 싶어 했지만, 나무가 너무 높아 아무도 딸 수 없었습니다.',
    vocabulary: [
      { word: '배나무', meaning: '배가 열리는 나무' },
      { word: '탐스럽다', meaning: '보기에 먹음직스럽고 갖고 싶다' },
      { word: '주렁주렁', meaning: '열매가 많이 매달려 있는 모습' },
      { word: '군침', meaning: '먹고 싶을 때 입안에 고이는 침' },
    ],
  },
  {
    code: 'sc_banggui_08',
    scene_order: 8,
    scene_description:
      '시아버지는 며느리의 방귀가 시끄럽고 별난 것이 아니라, 모두를 도울 수 있는 특별한 힘이라는 것을 깨닫습니다. 자신이 며느리를 구박했던 일을 후회하고 사과합니다.',
    vocabulary: [
      { word: '별나다', meaning: '보통과 달리 유난히 다르다' },
      { word: '깨닫다', meaning: '몰랐던 것을 알게 되다' },
      { word: '구박', meaning: '남을 못살게 굴며 괴롭히는 일' },
      { word: '후회', meaning: '지난 일을 뉘우치며 아쉬워하는 마음' },
    ],
  },
]

/**
 * 대화 장면 4개 — 아이가 말한다.
 *
 * ⚠️ 타입을 붙여 두는 이유: 안 붙이면 remaining_worries 의 키가 장면마다 달라
 * TS 가 네 장면의 리터럴 타입을 유니온으로 좁힌다(`REQUEST?: undefined` 따위가 붙는다).
 * 그러면 컬럼 타입인 Record<string, string> 에 안 들어간다.
 */
type 대화장면 = {
  code: string
  scene_order: number
  character_code: string
  character_name: string
  conflict: string
  scene_stance: string
  remaining_worries: Record<string, string>
  character_opening: string
  character_closing: string
  scene_goal: string
  required_elements: string[]
  element_criteria: Record<string, string>
  preferred_turns: number
  max_turns: number
  /**
   * 🔴 **대화 장면 넷은 전부 한 개 이상이어야 한다** (이슈 #35).
   * 아이가 말하는 곳이 여기뿐이라, 여기가 비면 「질문한 낱말」이 영영 0이 된다 (R15).
   * 대화 장면은 `scene_description` 이 없으므로 `conflict`·고정 대사·`scene_goal` 에서 고른다.
   */
  vocabulary: 낱말[]
}

const 대화장면들: 대화장면[] = [
  // 대화1 · sc_banggui_03 -----------------------------------------------------
  // 목표 요소 두 번째 칸: EMOTION → EMPATHY. 2026-08-11 기획자 인터뷰 3회차 Q1 로 확정.
  // 아이 자기 감정만 EMOTION 이고, 다른 인물의 마음을 헤아린 것은 EMPATHY 다(prompts/analysis.md:131).
  // 이 자리의 걱정 문장은 처음부터 며느리 마음을 묻고 있었다 — 어긋났던 건 자리 이름이다(이슈 #5).
  {
    code: 'sc_banggui_03',
    scene_order: 3,
    character_code: 'ch_banggui_daughter_in_law',
    character_name: '방귀쟁이 며느리',
    // conflict ✏️ (3장 표에 이 열이 없어 도입·전개1 지문에서 요약했다)
    conflict: '방귀를 참느라 몸이 상해 가는데도, 가족이 이상하게 볼까 봐 솔직하게 말하지 못하고 있다.',
    // scene_stance ✏️
    scene_stance:
      '아이에게 도움을 구하는 편이다. 자기 힘으로는 결정을 못 내려 아이의 말에 기대고 있다. ' +
      '아이 말을 반가워하되, 이 장면에서는 아직 용기를 내지 못한다(고정 마지막 대사가 그렇게 끝난다).',
    // remaining_worries ✏️
    remaining_worries: {
      PERSPECTIVE: '가족들은 나를 어떻게 볼까? 생각만 해도 무서워…',
      EMPATHY: '나도 내 마음이 어떤 건지 잘 모르겠어…',
      REASON: '근데 어째서 그렇게 하면 되는 걸까? 난 잘 모르겠어.',
      SOLUTION: '그럼 난 어떻게 하면 좋을까…',
    },
    character_opening: 'ㅇㅇ아, 내 방귀가 너무 크다는 걸 알면 가족들이 나를 이상하게 생각하지 않을까?',
    character_closing: '그래도 아직은 못 말하겠어. 조금만 더 참아 볼게.',
    scene_goal:
      '방귀를 숨기고 싶어하는 며느리의 입장을 이해하고, 공감해주며 문제를 숨기지 않고 솔직하게 말할 수 있는 용기를 준다',
    required_elements: ['PERSPECTIVE', 'EMPATHY', 'REASON', 'SOLUTION'],
    // 🔴 16문장은 2026-08-13 에 통째로 다시 썼다 (이슈 #21·#6 · corpus 트랙).
    //    「이 장면에서 아이가 어떤 말을 하면 이 요소를 충족하는가」만 적는다 —
    //    일반 정의는 `prompts/analysis.md` 가 지고 여기엔 장면 특화만 남긴다.
    //    ⚠️ 옛 문장은 아무도 검수한 적이 없었다(`docs/제안/초안_요소기준.md` 가 스스로
    //    「검수받을 초안」이라 적어 둔 것이 그대로 시드에 들어가 있었다).
    element_criteria: {
      PERSPECTIVE:
        '며느리가 지금 처한 사정을 말한다. 참고 있는 몸 상태든, 말하지 못하는 까닭이든, 둘레 사람이 며느리에게 한 일이든 된다.',
      EMPATHY: '아직 말하지 못하고 참고 있는 며느리의 마음을 읽어 말한다.',
      REASON:
        '며느리의 일에 대해 까닭을 댄다. 왜 그런 일이 생겼는지든, 왜 그렇게 해야 하는지든 된다.',
      SOLUTION:
        '며느리가 지금 해 볼 수 있는 행동을 말한다. 방귀를 뀌는 일이든 가족에게 말하는 일이든 된다.',
    },
    preferred_turns: 2,
    max_turns: 4,
    // 며느리가 처음 말을 거는 장면이다. 관계를 가리키는 말(며느리·시댁)이 여기서 처음 나온다.
    vocabulary: [
      { word: '며느리', meaning: '아들의 아내' },
      { word: '시댁', meaning: '남편의 부모님이 사는 집' },
      { word: '용기', meaning: '무섭고 두려워도 마음을 굳게 먹고 해내는 힘' },
    ],
  },

  // 대화2 · sc_banggui_05 -----------------------------------------------------
  // required_elements: 결정 9 로 확정. 3장 표는 EMOTION/SOLUTION 이지만
  // 같은 행의 scene_goal 문장과 진행 흐름이 둘 다 EMPATHY/REQUEST 를 가리킨다.
  {
    code: 'sc_banggui_05',
    scene_order: 5,
    character_code: 'ch_banggui_father_in_law',
    character_name: '시아버지',
    conflict: '며느리의 방귀에 갓까지 날아가 체면이 상했다. 놀란 마음이 화로 나와 며느리와 못 살겠다고 한다.',
    scene_stance:
      '아이와 대립하는 편이다. 아이가 설득해야 하는 상대다. ' +
      '아이 말에 일리가 있으면 그 자리에서 인정하지만, 그렇다고 결정을 뒤집지는 않는다(📄 캐릭터 성격.md). ' +
      '아이 말을 한 번에 받아들이면 이 장면이 성립하지 않는다(고정 마지막 대사가 그렇다).',
    // 📄 2026-08-11 다시 씀. 정본 캐릭터 성격(체면·호들갑·티격태격)을 따라 「놀람」을 뺐다.
    // 넷 다 질문이 아니라 억울함이다 — 아이가 반박하며 요소를 낸다(guidance_style 과 같은 결).
    // 예/아니오로 닫히지 않게, 그리고 아이 몫의 답을 먼저 말해 주지 않게 골랐다.
    // 🧑 PERSPECTIVE 는 2026-08-11 인터뷰로 사람이 확정했다 (결정 60).
    //    옛 줄("남들이 우리 집안을 어찌 보겠느냐")은 시아버지 자기 체면만 가리켜
    //    아이가 낼 「며느리 쪽」으로 가는 길이 없었다. 좁힐 아래 칸이 남지 않아
    //    캐릭터가 세 번을 다 되풀이했다(3/3 실측). 사람이 아니라 사람 수를 물어
    //    「누구인지」를 아이가 고르게 한다.
    remaining_worries: {
      PERSPECTIVE: '흥, 이 일로 낯을 못 들게 된 사람이 나 하나뿐이지 무어냐!',
      EMPATHY: '흥, 며느리는 속이 다 시원하겠구나. 창피한 것은 나 혼자로구나!',
      REASON: '사람이 어찌 그런 방귀를 뀐단 말이냐! 나는 도무지 영문을 모르겠구나.',
      REQUEST: '그래서 나더러 어쩌라는 게냐?',
    },
    character_opening:
      '아이고 이게 무슨 일이냐! 우리 집안이 다 흔들리는구나! 이렇게 창피한 며느리와 함께 못살겠다! 그렇지 않니?',
    character_closing: '흥, 그래도 도저히 이런 며느리와는 함께 살 수 없으니 친정으로 데려다줘야겠다.',
    scene_goal:
      '시아버지가 놀란 마음을 이해하면서도, 며느리가 일부러 그런 것이 아니라 오래 참아서 힘들었던 것임을 말하고, 며느리를 따뜻하게 이해해 달라고 설득한다.',
    required_elements: ['PERSPECTIVE', 'EMPATHY', 'REASON', 'REQUEST'],
    // 🧑 PERSPECTIVE 는 2026-08-11 인터뷰로 사람이 확정했다 (결정 60).
    //    옛 기준은 시아버지 쪽도 인정했는데, 그러면 시아버지가 걱정으로 이미 말한 것을
    //    아이가 되받기만 해도 요소가 차서 장면이 일찍 끝난다.
    // ⭐ REQUEST 에서 「대상이 시아버지여야 하고 바꿀 행동이 있어야 한다」를 뺐다 —
    //    프롬프트의 `[E-REQUEST]` 가 이미 그것을 지고 있다. 이슈 #29 가 이 자리다.
    element_criteria: {
      PERSPECTIVE:
        '며느리가 그때 어떤 처지였는지를 말한다. 시아버지 자신의 놀람이나 체면은 시아버지가 이미 스스로 말하는 것이라 이 자리가 아니다.',
      EMPATHY: '며느리의 마음을 읽어 말한다. 시아버지 자신의 마음은 이 자리가 아니다.',
      REASON: '며느리의 일이나 시아버지의 판단에 대해 까닭을 댄다.',
      REQUEST: '시아버지에게 무엇을 해 달라고, 또는 하지 말아 달라고 말한다.',
    },
    preferred_turns: 3,
    max_turns: 5,
    // 시아버지가 화내는 까닭이 「체면」이라, 그 말을 모르면 장면이 안 풀린다.
    vocabulary: [
      { word: '시아버지', meaning: '남편의 아버지' },
      { word: '체면', meaning: '남에게 떳떳하고 부끄럽지 않게 보이고 싶은 마음' },
      { word: '친정', meaning: '결혼한 여자의 부모님이 사는 집' },
      { word: '집안', meaning: '한집에서 함께 사는 가족 모두' },
    ],
  },

  // 대화3 · sc_banggui_07 -----------------------------------------------------
  {
    code: 'sc_banggui_07',
    scene_order: 7,
    character_code: 'ch_banggui_village_chief',
    character_name: '마을 이장',
    conflict: '해마다 배가 열리는데 배나무가 너무 높아 장대로도 나무를 타고도 아무도 따지 못한다.',
    scene_stance:
      '아이에게 방법을 구하는 편이다. 정말로 답을 모른다. 며느리의 방귀 이야기는 아이가 먼저 꺼내야 한다. ' +
      '이장이 먼저 방귀를 언급하면 미션의 의미가 사라진다.',
    remaining_worries: {
      SOLUTION: '그래서 어떻게 하면 좋겠소? 나는 도무지 모르겠구려.',
      REASON: '어째서 그 방법이면 되겠소? 나는 잘 모르겠소.',
      REQUEST: '며느리한테는 뭐라고 부탁하면 좋겠소?',
      RESULT: '그렇게 하면 무슨 일이 생기겠소?',
    },
    character_opening:
      '이 배나무는 해마다 탐스러운 배가 열리지만, 너무 높아서 아무도 딸 수가 없었소. 무슨 뾰족한 방법이 없겠는가?',
    character_closing: '아이고, 방귀 뀌는 며느리 덕분에 온 마을이 배 잔치를 할 수 있겠구려, 고맙소!',
    scene_goal:
      '높은 배나무의 배를 떨어뜨릴 방법을 생각하고, 며느리의 큰 방귀를 안전하게 사용할 수 있는 해결책을 제안한다.',
    required_elements: ['SOLUTION', 'REASON', 'REQUEST', 'RESULT'],
    element_criteria: {
      SOLUTION: '배를 떨어뜨릴 방법을 말한다. 무엇을 써서 떨어뜨릴지가 말에 있어야 한다.',
      REASON: '배를 떨어뜨리는 일이나 며느리에게 부탁하는 일에 대해 까닭을 댄다.',
      REQUEST:
        '며느리에게 무엇을 해 달라고 할지 말한다. 며느리가 이 자리에 없으므로 이장에게 「며느리한테 …라고 해 주세요」라고 전하는 꼴도 된다.',
      RESULT: '그 방법을 쓰면 배나무나 마을에 무슨 일이 생길지를 말한다.',
    },
    preferred_turns: 3,
    max_turns: 5,
    // 소쿠리·보자기·볏짚은 미션1(`ms_banggui_pear`)이 이 장면 안에서 고르게 하는 소품이다.
    // 미션 config 의 `desc` 와 같은 뜻을 적는다 — 아이가 화면에서 그 문장을 보기 때문이다.
    vocabulary: [
      { word: '이장', meaning: '마을 일을 맡아서 돌보는 어른' },
      { word: '배나무', meaning: '배가 열리는 나무' },
      { word: '장대', meaning: '높은 곳에 닿게 쓰는 아주 긴 막대기' },
      { word: '소쿠리', meaning: '물건을 담는 대나무 바구니' },
      { word: '볏짚', meaning: '벼를 베고 남은 마른 줄기' },
    ],
  },

  // 대화4 · sc_banggui_09 -----------------------------------------------------
  // 목표 요소 첫 칸: EMOTION → EMPATHY. 대화1 과 같은 자리, 같은 근거다.
  // 2026-08-11 기획자 인터뷰 3회차 Q1 · 이슈 #5. scene_goal 도 며느리를 이해하는 쪽을 가리킨다.
  {
    code: 'sc_banggui_09',
    scene_order: 9,
    character_code: 'ch_banggui_daughter_in_law',
    character_name: '방귀쟁이 며느리',
    conflict: '숨기고 싶던 특징이 남을 도왔다는 걸 알게 됐지만, 아직 부끄러워하지 않아도 되는지 확신이 없다.',
    scene_stance:
      '대화1 때와 입장이 정반대다. 이미 방귀로 마을을 도운 뒤다. 더는 숨기려 하지 않고, ' +
      '다만 앞으로 어떻게 받아들여야 할지를 아이에게 묻는다. 대화1의 위축된 톤을 그대로 쓰지 말 것.',
    remaining_worries: {
      EMPATHY: '…나도 내 마음을 아직 잘 모르겠어.',
      PERSPECTIVE: '다른 사람들도 나처럼 숨기고 싶은 게 있을까?',
      RESULT: '내가 이제 안 숨기면 어떻게 될까?',
      SOLUTION: '그럼 앞으로 난 어떻게 하면 좋을까?',
    },
    character_opening:
      'ㅇㅇ이 덕분에 내 방귀가 누군가에게 도움이 될 수 있다는 걸 처음 알았어. 이제는 방귀 소리가 큰 걸 부끄러워하지 않아도 될까?',
    character_closing: '이제는 부끄러워하며 숨기지 않고, 조심해서 좋은 일에 써 볼게',
    scene_goal: '다름을 인정하고, 자신의 특징을 긍정적으로 받아들이는 태도를 말한다.',
    required_elements: ['EMPATHY', 'PERSPECTIVE', 'RESULT', 'SOLUTION'],
    element_criteria: {
      EMPATHY: '아직 부끄러움이 남은 며느리의 마음을 읽어 말한다.',
      PERSPECTIVE:
        '며느리가 지금 어떤 처지인지, 또는 다른 사람도 숨기고 싶은 것이 있다는 것을 말한다.',
      RESULT: '며느리에게 앞으로 무슨 일이 생길지를 말한다.',
      SOLUTION: '며느리가 앞으로 무엇을 할지 말한다.',
    },
    preferred_turns: 2,
    max_turns: 4,
    // 이 장면의 주제어들이다. 「부끄럽다 → 당당하다」가 며느리가 건너온 거리 그 자체다.
    vocabulary: [
      { word: '부끄럽다', meaning: '남 앞에서 얼굴이 화끈거리고 숨고 싶은 마음이 들다' },
      { word: '당당하다', meaning: '부끄러워하지 않고 떳떳하다' },
      { word: '인정하다', meaning: '그렇다고 받아들이다' },
    ],
  },
]

// ─────────────────────────────────────────────────────────────
// 미션(미니게임) 2개 — story_missions (sql/005_missions.sql · 이슈 #17)
//
// config 의 **모양** 정본은 docs/미션_명세.md 6절 config 예시다. 임의 키를 더하거나
// 빼지 말 것 — #18(도메인·엔진)·#20(프론트)이 같은 모양을 본다.
//
// 문구의 출처 (프론트 원문은 한 글자도 다듬지 않았다):
//   📄 소품 3개 이름·설명 — src/stories/fart-bride/minigame/mission1-script.ts 의 PROPS.
//      desc 는 프론트가 말풍선 두 줄로 나눠 둔 것을 한 문장으로 이었다
//      (명세 6절 예시와 같은 글자가 된다).
//   📄 미션1 closing — 같은 파일 LINES.finish 의 **첫 문장만**이다. 뒤의 배 잔치 문장은
//      config 에 넣지 않는다 — 그 정본은 story_scenes.character_closing 이다
//      (명세 6절 「대사 정본 주의」 · 확정 결정 M6. 명세 예시는 끝이 마침표인데
//       프론트 원문이 느낌표라 원문을 따랐다).
//   📄 미션2 intro·cards(4명 trouble/reask)·ask·more_pick·closing — mission2-script.ts 의
//      FRIENDS·LINES (intro↔intro · ask↔ask · more_pick↔more · closing↔done).
//      more 는 프론트 react 문장의 꼬리 질문만이다 — 앞의 감탄 자리는 미션 턴의
//      생성 대사(아이대답요약)가 대신한다 (명세 6절).
//   ✏️ 미션1 steps 의 ask 둘과 reask — 프론트에 없는 문구라 명세 6절 예시 그대로다
//      (되묻기 M9 와 {item} 치환 질문은 이 명세에서 처음 생겼다).
//   mission_goal — 명세 3절 대응 씬의 scene_goal 문장 (미션 목적 한 문장).
// ─────────────────────────────────────────────────────────────
const 미션들 = [
  {
    // 미션1 배 따기 — 대화3(마을 이장). SOLUTION 감지 즉시 또는 아이 턴 2회면 발동 (명세 5절)
    scene_code: 'sc_banggui_07',
    code: 'ms_banggui_pear',
    title: '배 따기',
    mission_type: 'prop_choice',
    mission_goal:
      '높은 배나무의 배를 떨어뜨릴 방법을 생각하고, 며느리의 큰 방귀를 안전하게 사용할 수 있는 해결책을 제안한다.',
    config: {
      trigger: { any_elements: ['SOLUTION'], min_turns: 2 },
      items: [
        { id: 'sokuri', name: '소쿠리', desc: '물건을 담는 대나무 바구니예요.' },
        { id: 'bojagi', name: '보자기', desc: '물건을 감쌀 수 있어요.' },
        { id: 'byeotjip', name: '볏짚', desc: '바닥에 깔아 둘 수 있어요.' },
      ],
      steps: [
        {
          key: 'use',
          expect: 'speech',
          ask: '{item} 말인가? {item}(으)로 어떻게 해야 배를 안전하게 딸 수 있겠는가?',
        },
        {
          key: 'request',
          expect: 'speech',
          ask: '그것 좋은 생각이군. 그런데 며느리가 부끄럽다고 안 해 주면 어쩌나… 뭐라고 부탁을 해야 할까?',
        },
      ],
      // M9 — 미션1 되묻기 공통 문구
      reask: '조금만 더 자세히 말해 줄 수 있겠는가?',
      closing: '그래! 그렇게 말하면 되겠구려!',
    },
  },
  {
    // 미션2 친구 돕기 — 대화4(며느리). PERSPECTIVE 감지 즉발 허용 (M7)
    scene_code: 'sc_banggui_09',
    code: 'ms_banggui_friend',
    title: '친구 돕기',
    mission_type: 'card_help',
    mission_goal: '다름을 인정하고, 자신의 특징을 긍정적으로 받아들이는 태도를 말한다.',
    config: {
      trigger: { any_elements: ['PERSPECTIVE'], min_turns: 2 },
      /* 문구는 사전 녹음(content/stories/mission2/*.wav)이 정본이다 — 프론트가
         「같은 문장이면 녹음, 아니면 TTS」로 고르므로, 여기 문구가 녹음과 어긋나면
         실서버 모드에서 녹음이 조용히 버려진다. 바꾸려면 녹음부터. */
      intro:
        '나한테 용기를 줘서 고마워. 내 주위에도 나처럼 고민이 있는 친구들이 있는데 너가 도와줄 수 있어?',
      cards: [
        {
          id: 'scared',
          name: '겁이 많은 친구',
          trouble: '겁이 많아서 겁쟁이라는 말을 들어요.',
          reask: '정말? 겁쟁이라고 놀림받았는데도 괜찮을까?',
        },
        {
          id: 'loud',
          name: '목소리가 큰 친구',
          trouble: '목소리가 커서 시끄럽다는 말을 들어요.',
          reask: '정말? 시끄럽다고 놀림받았는데도 괜찮을까?',
        },
        {
          id: 'talkative',
          name: '말이 많은 친구',
          trouble: '말이 많아서 그만하라는 말을 들어요.',
          reask: '정말? 그만하라는 말을 들었는데도 괜찮을까?',
        },
        {
          // 녹음이 「장난을 많이 치는 친구」로 나와 힘이 센 친구를 대신한다
          // (프론트 mission2-script.ts 와 같은 결정 — id 가 갈리면 카드 선택이 깨진다)
          id: 'playful',
          name: '장난을 많이 치는 친구',
          trouble: '장난을 많이 쳐서 짓궂다는 말을 들어요.',
          reask: '정말? 짓궂다고 놀림받았는데도 괜찮을까?',
        },
      ],
      ask: '이 고민이 있는 친구한테는 내가 어떻게 이야기해 주면 좋을까?',
      more: '좋은 생각이다. 혹시, 다른 친구 고민도 도와줄 수 있어?',
      more_pick: '또 도와주고 싶은 친구는 누구야?',
      closing: '도와줘서 고마워! 덕분에 내 친구들도 나처럼 용기를 얻었을 것 같아.',
    },
  },
]

// ─────────────────────────────────────────────────────────────
// 시험용 아이 4명 — sql/003_admin.sql:227 의 INSERT 를 그대로 옮겼다
//
// ✏️ 전부 합성이다 (헌법 원칙 IV). 실제 아이 정보가 아니다.
//    대상 나이는 만 6~9세이고(인터뷰 Q19 · 🕓 잠정) 2026년 기준 연도 연령이라
//    birth_year 는 2017~2020 이다.
//    ⭐ 이름을 고른 기준이 하나 더 있다 — **받침 있는 이름과 없는 이름을 섞었다.**
//    Q12(아이 이름 `ㅇㅇ` 치환)의 딸린 질문이 「받침 규칙(`ㅇㅇ아`/`ㅇㅇ이`)」인데
//    아직 미답이다. 답이 오면 두 경우를 다 시험할 수 있게 미리 갈라 두었다.
//
// ⚠️ **여기만 upsert 를 못 쓴다.** `test_children` 에는 `id` 말고 UNIQUE 가 없어서
//    (`sql/003_admin.sql:213` — 003 이 그렇게 정해 뒀다) `onConflictDoUpdate` 가 걸 열쇠가 없다.
//    UNIQUE 를 새로 거는 것은 답이 아니다 — 스키마의 정의는 sql 파일 하나이고 여기는 사본이다.
//    그래서 **이름으로 있나 보고, 있으면 고치고 없으면 넣는다.** 여러 번 돌려도 4명 그대로다.
// ─────────────────────────────────────────────────────────────
const 시험아이들 = [
  { name: '민준', birth_year: 2020, note: '✏️ 시험용. 만 6세 — 대상 나이의 아래 끝. 받침 있는 이름(준)' },
  { name: '지우', birth_year: 2019, note: '✏️ 시험용. 만 7세. 받침 없는 이름(우)' },
  { name: '서아', birth_year: 2018, note: '✏️ 시험용. 만 8세. 받침 없는 이름(아)' },
  { name: '하준', birth_year: 2017, note: '✏️ 시험용. 만 9세 — 대상 나이의 위 끝. 받침 있는 이름(준)' },
]

// ─────────────────────────────────────────────────────────────
// 넣기 — 지우지 않고 code 로 upsert 한다
// ─────────────────────────────────────────────────────────────
// 시드는 db 로도 tx 로도 돌 수 있어야 한다 — repo 함수들과 같은 공통 조상(`Conn`)으로 받는다.
// 구체 타입(`ReturnType<typeof drizzle>` 과 그 트랜잭션)으로 받으면 스키마 타입 인자가
// 어긋나서 tests 가 여는 트랜잭션이 안 들어온다 (tests/missions.test.ts 가 tx 로 부른다).
export async function seed(db: Conn) {
  // 이야기 --------------------------------------------------------------
  // ⛔ **덮어쓰지 않는다** (결정 4 · 4차). 저쪽 `fart-bride` 행의 여섯 칸은 저쪽 값이 맞다.
  //    `onConflictDoNothing` 은 충돌하면 아무 행도 안 돌려주므로, 그때는 있던 행을 읽어 온다.
  const [넣은_이야기] = await db
    .insert(stories)
    .values(이야기)
    .onConflictDoNothing({ target: stories.slug })
    .returning({ id: stories.id })

  const story_id =
    넣은_이야기?.id ??
    (
      await db
        .select({ id: stories.id })
        .from(stories)
        .where(eq(stories.slug, 이야기.slug))
        .limit(1)
    )[0]?.id

  if (story_id === undefined) {
    throw new Error(`이야기를 넣지도 찾지도 못했다: stories.slug = ${이야기.slug}`)
  }

  // 캐릭터 --------------------------------------------------------------
  // 장면이 character_id 를 필요로 하므로 code → id 표를 만들어 둔다.
  const 캐릭터_id: Record<string, string> = {}
  for (const 캐 of 캐릭터들) {
    const [행] = await db
      .insert(characters)
      .values({ story_id, ...캐 })
      .onConflictDoUpdate({
        target: [characters.story_id, characters.code],
        set: {
          name: 캐.name,
          persona: 캐.persona,
          speech_style: 캐.speech_style,
          guidance_style: 캐.guidance_style,
          forbidden: 캐.forbidden,
        },
      })
      .returning({ id: characters.id, code: characters.code })
    캐릭터_id[행.code] = 행.id
  }

  // 장면 ----------------------------------------------------------------
  // 전개 장면은 대화 관련 값이 전부 없다. 그래도 set 에 넣어 둔다 —
  // 넣지 않으면 이미 있던 옛 값이 살아남아 「대사 있는 전개 장면」이 된다.
  const 장면들 = [
    ...전개장면들.map((장) => ({
      story_id,
      code: 장.code,
      scene_order: 장.scene_order,
      scene_description: 장.scene_description,
      conflict: null,
      character_name: null,
      character_id: null,
      scene_stance: null,
      remaining_worries: {},
      character_opening: null,
      character_closing: null,
      scene_goal: null,
      required_elements: null,
      element_criteria: {},
      preferred_turns: null,
      max_turns: null,
      vocabulary: 장.vocabulary,
    })),
    ...대화장면들.map(({ character_code, ...장 }) => ({
      story_id,
      code: 장.code,
      scene_order: 장.scene_order,
      scene_description: null,
      conflict: 장.conflict,
      character_name: 장.character_name,
      character_id: 캐릭터_id[character_code],
      scene_stance: 장.scene_stance,
      remaining_worries: 장.remaining_worries,
      character_opening: 장.character_opening,
      character_closing: 장.character_closing,
      scene_goal: 장.scene_goal,
      required_elements: 장.required_elements,
      element_criteria: 장.element_criteria,
      preferred_turns: 장.preferred_turns,
      max_turns: 장.max_turns,
      vocabulary: 장.vocabulary,
    })),
  ].sort((a, b) => a.scene_order - b.scene_order)

  // 미션이 scene_id 를 필요로 하므로 캐릭터처럼 code → id 표를 만들어 둔다.
  const 장면_id: Record<string, string> = {}
  for (const 장 of 장면들) {
    const [행] = await db
      .insert(story_scenes)
      .values(장)
      .onConflictDoUpdate({
        target: [story_scenes.story_id, story_scenes.code],
        // 열쇠인 story_id·code 까지 set 에 들어가지만 값이 같아 아무 일도 하지 않는다.
        set: 장,
      })
      .returning({ id: story_scenes.id, code: story_scenes.code })
    장면_id[행.code] = 행.id
  }

  // 미션 ----------------------------------------------------------------
  // 씬은 code 로 찾아 잇는다 — 장면 upsert 가 방금 만든(또는 이미 있던) 행의 id 다.
  for (const { scene_code, ...미션 } of 미션들) {
    await db
      .insert(story_missions)
      .values({ story_id, scene_id: 장면_id[scene_code], ...미션 })
      .onConflictDoUpdate({
        target: [story_missions.story_id, story_missions.code],
        set: {
          scene_id: 장면_id[scene_code],
          title: 미션.title,
          mission_type: 미션.mission_type,
          mission_goal: 미션.mission_goal,
          config: 미션.config,
        },
      })
  }

  // 시험용 아이 --------------------------------------------------------
  for (const 아이 of 시험아이들) {
    const [있던_행] = await db
      .select({ id: test_children.id })
      .from(test_children)
      .where(eq(test_children.name, 아이.name))
      .limit(1)

    if (있던_행 === undefined) {
      await db.insert(test_children).values(아이)
    } else {
      await db
        .update(test_children)
        .set({ birth_year: 아이.birth_year, note: 아이.note })
        .where(eq(test_children.id, 있던_행.id))
    }
  }

  return {
    stories: 1,
    characters: 캐릭터들.length,
    story_scenes: 장면들.length,
    story_missions: 미션들.length,
    test_children: 시험아이들.length,
  }
}

// ─────────────────────────────────────────────────────────────
// 직접 실행: npx tsx db/seed.ts
// ─────────────────────────────────────────────────────────────
async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL 이 없다. web/.env.local 이나 레포 루트 .env.local 을 확인해라.')

  // max: 1 — 시드는 한 연결로 순서대로 돈다. 트랜잭션 하나로 묶기 위해서다.
  const sql = postgres(url, { max: 1 })
  try {
    const 결과 = await drizzle(sql).transaction((tx) => seed(tx))
    console.log(
      `[시드] ${이야기.title} — stories ${결과.stories} · characters ${결과.characters} · story_scenes ${결과.story_scenes}` +
        ` · story_missions ${결과.story_missions} · test_children ${결과.test_children}`,
    )
  } finally {
    await sql.end()
  }
}

// 이 파일을 직접 돌렸을 때만 main 을 부른다 (import 만 하면 안 돈다).
// ⚠️ `file://${process.argv[1]}` 글자 잇기가 아니라 `pathToFileURL` 이어야 한다 —
//    윈도우에서는 argv[1] 이 백슬래시 경로(`C:\…`)라 글자 잇기로는 **영원히 안 같아서**
//    시드가 조용히 아무것도 안 하고 0 으로 끝났다 (2026-08-14 실측).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
