import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CharacterAvatar } from "@/components/child/character-avatar";
import { requireSelectedChild } from "@/lib/selected-child";
import { getStory } from "@/lib/stories";
import { startStory } from "./actions";

const OPENING_LABEL = "이야기의 시작";

/** 아이가 맡을 역할 — 모든 이야기에서 같은 안내라 DB 에 두지 않는다. */
const ROLE_LINES = [
  "이야기 속 친구가 되어줘! ",
  "주인공의 고민을 잘 듣고, 네 생각을 목소리로 말해주면 돼!",
];

/**
 * 시안 7 — 동화 시작. 이야기 데이터는 stories 테이블에서 slug 로 찾는다.
 *
 * 전면(히어로)·초상 이미지는 아직 방귀 뀌는 며느리 것만 있어서 일단 쓰지 않는다 —
 * 왼쪽 그림은 목록과 같은 썸네일로 채우고, 상황 카드는 주인공 이름 첫 글자로 대신한다.
 *
 * 상단·하단 네비가 없는 전체 화면이라 (main) 레이아웃 밖에 둔다.
 * 시안이 1366×1024 한 장으로 꽉 차게 그려져 있고 루트 레이아웃이 뷰포트를
 * 1366 으로 고정하므로, 세로로 흐르지 않는 조각(제목·카드·버튼)은 시안 좌표에
 * 그대로 앉힌다.
 */
export default async function StoryIntroPage(
  props: PageProps<"/stories/[id]">,
) {
  const { id } = await props.params;
  const story = await getStory(id);
  if (!story) notFound();

  const chips = [
    story.topic,
    story.minutes ? `약 ${story.minutes}분` : "",
    `난이도 ${story.difficulty}`,
  ].filter(Boolean);

  const opening = story.intro?.opening ?? [story.summary];
  const situation = story.intro?.situation ?? null;

  /* 역할 카드의 이름과 얼굴 — 아이 선택(32)에서 고른 아이 */
  const child = await requireSelectedChild();

  return (
    <main className="relative flex h-[1024px] w-full overflow-hidden bg-story-bg">
      {/* ── 왼쪽 절반: 장면 그림 위에 뒤로가기와 도입 텍스트가 얹힌다 */}
      <section className="relative h-full w-[683px] shrink-0">
        {story.hero ? (
          /* 썸네일을 2:3 으로 아웃페인팅한 전면 컷 — 683×1024 창에 꽉 채운다. */
          <Image
            src={story.hero}
            alt=""
            fill
            sizes="683px"
            priority
            className="object-cover"
          />
        ) : (
          /* 히어로가 없으면: 1024×768 가로 썸네일을 그대로 cover 하면 좌우 절반이
             잘리므로, 같은 그림을 블러로 확대해 빈 위아래를 채우고 원본을 얹는다. */
          <>
            <Image
              src={story.thumbnail}
              alt=""
              fill
              sizes="683px"
              aria-hidden
              className="scale-110 object-cover blur-xl brightness-95"
            />
            <Image
              src={story.thumbnail}
              alt=""
              fill
              sizes="683px"
              priority
              className="object-contain"
            />
          </>
        )}

        <Link
          href="/home"
          aria-label="홈으로"
          className="absolute top-8 left-12 flex size-16 items-center justify-center rounded-full bg-story-bg/70 shadow-card"
        >
          <Image
            src="/figma/icons/arrow-left.svg"
            alt=""
            width={24}
            height={24}
            className="size-6"
          />
        </Link>

        <div className="absolute inset-x-0 bottom-0 flex flex-col items-start gap-2.5 bg-gradient-to-b from-story-bg/0 to-story-bg/40 px-12 pt-3 pb-12">
          <span className="rounded-[14px] bg-ink-faint px-3.5 py-2 font-gothic text-[13px] font-extrabold text-ink-deep">
            {OPENING_LABEL}
          </span>
          <p className="font-gothic text-[19px] leading-[1.65] font-bold whitespace-pre-line text-ink-deep">
            {opening.join("\n")}
          </p>
        </div>
      </section>

      {/* ── 오른쪽 절반 */}
      <section className="relative flex-1">
        <header className="absolute top-[141px] left-12 flex w-[587px] flex-col gap-5">
          <h1 className="text-[40px] font-extrabold text-ink-strong">
            {story.title}
          </h1>
          <p className="text-[16px] text-ink-strong">{story.summary}</p>
          <ul className="flex items-center gap-2">
            {chips.map((chip) => (
              <li
                key={chip}
                className="rounded bg-surface-muted px-5 py-3 text-[16px] font-bold text-ink-mid"
              >
                {chip}
              </li>
            ))}
          </ul>
        </header>

        {/* 상황 카드와 역할 카드는 화면 세로 한가운데에 묶여 있다.
            말풍선 꼬리처럼 서로 마주 보는 모서리(상황 왼쪽 위 · 역할 오른쪽 아래)만 각이 선다. */}
        <div className="absolute top-1/2 left-12 flex w-[578px] -translate-y-1/2 flex-col gap-8">
          {situation && (
            <article className="flex gap-4 overflow-hidden rounded-[24px] rounded-tl-[4px] bg-surface-muted py-[18px] pr-6 pl-5">
              {/* 초상 이미지가 준비되면 이 자리에 넣는다. 그때까지는 주인공 이름 첫 글자. */}
              <span className="flex size-[60px] shrink-0 items-center justify-center rounded-full bg-brand-900 text-[26px] font-extrabold text-white">
                {[...situation.name][0]}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <p className="text-[16px] font-extrabold text-point-strong">
                  {situation.heading}
                </p>
                <p className="text-[18px] leading-[1.6] font-bold whitespace-pre-line text-ink-strong">
                  {situation.lines.join("\n")}
                </p>
              </div>
            </article>
          )}

          <article className="flex items-end gap-4 overflow-hidden rounded-[24px] rounded-br-[4px] border-2 border-primary bg-primary-pale py-[18px] pr-5 pl-6 shadow-role">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="text-[16px] font-extrabold text-primary-strong">
                {child.name}의 역할
              </p>
              <p className="text-[18px] leading-[1.6] font-bold whitespace-pre-line text-ink-strong">
                {ROLE_LINES.join("\n")}
              </p>
            </div>
            <span className="size-[60px] shrink-0 overflow-hidden rounded-full border-4 border-primary bg-primary-strong">
              <CharacterAvatar characterId={child.character_id} size={52} />
            </span>
          </article>
        </div>

        {story.intro && (
          <p className="absolute top-[890px] left-12 w-[587px] text-center font-gothic text-[14px] font-bold text-ink-faint">
            {story.intro.note}
          </p>
        )}

        {/* 재생 화면이 있는 published 만 시작할 수 있다. draft 는 버튼 자리에 "제작 중".
            시작은 세션 기록을 남겨야 해서 링크가 아니라 서버 액션이다. */}
        {story.status === "published" ? (
          <form
            action={startStory.bind(null, story.id)}
            className="absolute top-[924px] left-12 w-[587px]"
          >
            <button
              type="submit"
              className="flex h-[68px] w-full cursor-pointer items-center justify-center rounded-lg bg-primary-strong text-[24px] leading-[1.5] font-extrabold text-white"
            >
              이야기 시작하기
            </button>
          </form>
        ) : (
          <p className="absolute top-[924px] left-12 flex h-[68px] w-[587px] items-center justify-center rounded-lg bg-ink-faint text-[24px] leading-[1.5] font-extrabold text-white">
            제작 중
          </p>
        )}
      </section>
    </main>
  );
}
