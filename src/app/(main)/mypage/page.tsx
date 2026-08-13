import { Bookshelf } from "@/components/mypage/bookshelf";
import { CharacterChangeForm } from "@/components/mypage/character-change-form";
import { ParentReportCard } from "@/components/mypage/parent-report-card";
import { requireSelectedChild } from "@/lib/selected-child";
import { listStories } from "@/lib/stories";

/* 리텔링 저장(story_sessions)이 붙기 전까지 책장은 시안 17 의 결과물을 목업으로 보여 준다.
   첫 항목 문구는 시안 17 의 저장된 리텔링 예시 그대로고,
   나머지는 책장이 차 보이도록 같은 말투로 지어 넣은 목업이다. */
const SHELF_MOCK = [
  {
    slug: "fart-bride",
    retelling:
      "옛날에 방귀를 꾹 참던 며느리가 있었는데, 시아버지가 뀌어도 된다고 해서 엄청 큰 방귀를 뀌었어. 그래서 다 같이 웃었어!",
  },
  {
    slug: "gold-axe",
    retelling:
      "나무꾼이 연못에 도끼를 빠뜨렸는데, 정직하게 말해서 산신령님이 금도끼 은도끼를 전부 줬어!",
  },
  {
    slug: "tortoise-and-hare",
    retelling:
      "토끼가 낮잠 자는 동안 거북이가 쉬지 않고 걸어서 이겼어. 느려도 포기 안 하면 되는 거야!",
  },
  {
    slug: "boy-who-cried-wolf",
    retelling:
      "거짓말을 자꾸 하니까 진짜 늑대가 왔을 때 아무도 안 믿어 줬어. 그러니까 거짓말은 하면 안 돼.",
  },
  {
    slug: "ugly-duckling",
    retelling:
      "미운 오리가 사실은 백조였어! 다르게 생겼다고 놀리면 안 되는 거야.",
  },
  {
    slug: "heungbu",
    retelling:
      "흥부가 제비 다리를 고쳐 줬더니 박에서 보물이 나왔어. 놀부는 욕심부리다가 혼났어!",
  },
];

export default async function MyPage() {
  const child = await requireSelectedChild();
  const stories = await listStories();

  const shelf = SHELF_MOCK.flatMap((entry) => {
    const story = stories.find((candidate) => candidate.id === entry.slug);
    return story ? [{ story, retelling: entry.retelling }] : [];
  });

  return (
    <main className="flex flex-col gap-[60px] pt-2 pb-12">
      <section className="flex flex-col gap-5">
        <h2 className="px-[60px] text-[28px] font-extrabold text-ink">
          다른 모습으로 변신해 볼까요?
        </h2>
        <CharacterChangeForm
          name={child.name}
          characterId={child.character_id}
        />
      </section>

      <section className="flex flex-col gap-5">
        <h2 className="px-[60px] text-[28px] font-extrabold text-ink">
          내가 만든 이야기
        </h2>
        {shelf.length ? (
          <Bookshelf entries={shelf} />
        ) : (
          <p className="px-[60px] text-[18px] font-bold text-ink-soft">
            아직 책장이 비어 있어요. 이야기를 끝까지 완성하면 여기에 한 권씩
            꽂혀요!
          </p>
        )}
      </section>

      {/* 보호자 전용 입구 — 카드가 스스로 제목을 달고 있어 섹션 제목은 두지 않는다. */}
      <section className="px-[60px]">
        <ParentReportCard />
      </section>
    </main>
  );
}
