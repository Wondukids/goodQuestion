import { CharacterChangeForm } from "@/components/mypage/character-change-form";
import { ParentReportCard } from "@/components/mypage/parent-report-card";
import { ShelfCard } from "@/components/mypage/shelf-card";
import { requireSelectedChild } from "@/lib/selected-child";
import { listStories } from "@/lib/stories";

/* 리텔링 저장(story_sessions)이 붙기 전까지 책장은 시안 17 의 결과물을 목업으로 보여 준다.
   문구는 시안 17 의 저장된 리텔링 예시 그대로다. */
const SHELF_MOCK = [
  {
    slug: "fart-bride",
    retelling:
      "옛날에 방귀를 꾹 참던 며느리가 있었는데, 시아버지가 뀌어도 된다고 해서 엄청 큰 방귀를 뀌었어. 그래서 다 같이 웃었어!",
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
          <div className="flex flex-wrap content-start items-start gap-[30px] px-12">
            {shelf.map((entry) => (
              <ShelfCard key={entry.story.id} entry={entry} />
            ))}
          </div>
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
