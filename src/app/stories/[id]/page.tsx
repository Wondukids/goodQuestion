import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CHILDREN, getStoryDetail } from "@/lib/mock-data";

/**
 * 시안 7 — 동화 시작.
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
  const story = getStoryDetail(id);
  if (!story) notFound();

  /* 역할 카드의 이름과 얼굴 — 아이 선택(32)에서 넘어온 값으로 교체될 자리 */
  const child = CHILDREN[0];

  return (
    <main className="relative flex h-[1024px] w-full overflow-hidden bg-story-bg">
      {/* ── 왼쪽 절반: 장면 그림 위에 뒤로가기와 도입 텍스트가 얹힌다 */}
      <section className="relative h-full w-[683px] shrink-0">
        {/* 1920×1080 원본을 683×1024 세로 창에 담느라 가로가 크게 넘친다.
            시안은 가운데가 아니라 왼쪽으로 치우친 지점을 보여 준다(넘치는 폭의 35.5%). */}
        <Image
          src={story.hero}
          alt=""
          fill
          sizes="683px"
          priority
          className="object-cover"
          style={{ objectPosition: "35.5% 50%" }}
        />

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
            {story.opening.label}
          </span>
          <p className="font-gothic text-[19px] leading-[1.65] font-bold whitespace-pre-line text-ink-deep">
            {story.opening.lines.join("\n")}
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
            {story.chips.map((chip) => (
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
          <article className="flex gap-4 overflow-hidden rounded-[24px] rounded-tl-[4px] bg-surface-muted py-[18px] pr-6 pl-5">
            <span className="size-[60px] shrink-0 overflow-hidden rounded-full bg-brand-900">
              <Image
                src={story.situation.portrait}
                alt=""
                width={60}
                height={60}
                className="size-full"
              />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="text-[16px] font-extrabold text-point-strong">
                {story.situation.heading}
              </p>
              <p className="text-[18px] leading-[1.6] font-bold whitespace-pre-line text-ink-strong">
                {story.situation.lines.join("\n")}
              </p>
            </div>
          </article>

          <article className="flex items-end gap-4 overflow-hidden rounded-[24px] rounded-br-[4px] border-2 border-primary bg-primary-pale py-[18px] pr-5 pl-6 shadow-role">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="text-[16px] font-extrabold text-primary-strong">
                {child.name}의 역할
              </p>
              <p className="text-[18px] leading-[1.6] font-bold whitespace-pre-line text-ink-strong">
                {story.role.lines.join("\n")}
              </p>
            </div>
            <span className="size-[60px] shrink-0 overflow-hidden rounded-full border-4 border-primary bg-primary-strong">
              <Image
                src={child.avatar}
                alt=""
                width={60}
                height={60}
                className="size-full"
              />
            </span>
          </article>
        </div>

        <p className="absolute top-[890px] left-12 w-[587px] text-center font-gothic text-[14px] font-bold text-ink-faint">
          {story.note}
        </p>

        {/* 누른 다음 화면(8)은 아직 시안만 있고 구현 전이다. */}
        <button
          type="button"
          className="absolute top-[924px] left-12 flex h-[68px] w-[587px] items-center justify-center rounded-lg bg-primary-strong text-[24px] leading-[1.5] font-extrabold text-white"
        >
          이야기 시작하기
        </button>
      </section>
    </main>
  );
}
