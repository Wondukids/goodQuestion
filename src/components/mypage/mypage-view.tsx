import Image from "next/image";
import Link from "next/link";
import { CharacterChangeButton } from "@/components/mypage/character-change-dialog";
import { ParentReportCard } from "@/components/mypage/parent-report-card";
import { SettingsEntryCard } from "@/components/mypage/settings-entry-card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { getCharacter } from "@/lib/characters";
import type { SelectedChild } from "@/lib/selected-child";
import type { ChildStorySession } from "@/lib/story-sessions";
import type { Story } from "@/lib/story-types";

/* 스티커 시스템이 아직 없어 시안(21-1403)의 구성을 목업으로 보여 준다. */
const STICKERS = [
  { label: "또박또박", icon: "mic", color: "#fd7c51" },
  { label: "마음말", icon: "favorite", color: "#e86a8f" },
  { label: "반짝생각", icon: "lightbulb", color: "#f0a83c" },
  { label: "길게말하기", icon: "format_quote", color: "#45a9d3" },
  { label: "일주일개근", icon: "trophy", color: "#7bc47f" },
] as const;

const STATUS_LABEL: Record<ChildStorySession["status"], string> = {
  in_progress: "이야기 듣는 중",
  post_activity: "이야기 나누는 중",
  completed: "끝까지 완료",
  stopped: "잠시 쉬는 중",
};

/* 연속 일수 — 세션 활동이 있던 날짜가 오늘(오늘 안 했으면 어제)부터 며칠 이어졌는지. */
function activityStreak(sessions: ChildStorySession[]): number {
  const day = (iso: string) => iso.slice(0, 10);
  const days = new Set(
    sessions.flatMap((s) => [day(s.startedAt), day(s.lastActivityAt)]),
  );
  const cursor = new Date();
  const key = () => cursor.toISOString().slice(0, 10);
  if (!days.has(key())) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(key())) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/** 마이페이지(시안 21-1367) — 프로필 카드에 아이가 고른 캐릭터가 들어간다. */
export function MyPageView({
  child,
  stories,
  sessions,
}: {
  child: SelectedChild;
  stories: Story[];
  sessions: ChildStorySession[];
}) {
  const character = getCharacter(child.character_id);
  const age = new Date().getFullYear() - child.birth_year;
  const streak = activityStreak(sessions);
  const recent = sessions
    .flatMap((session) => {
      const story = stories.find((candidate) => candidate.id === session.slug);
      return story ? [{ session, story }] : [];
    })
    .slice(0, 3);
  const readCount = new Set(sessions.map((session) => session.slug)).size;

  return (
    <main className="flex flex-col gap-[18px] px-12 pt-2 pb-16">
      {/* 시안은 하늘 배경 없이 평평한 바탕 — 레이아웃의 하늘 배경을 덮는다 */}
      <div aria-hidden className="fixed inset-0 -z-10 bg-story-bg" />

      <div className="flex items-center gap-3 font-gothic">
        <h1 className="text-[28px] font-extrabold text-ink-strong">
          {child.name}의 이야기 방이에요!
        </h1>
        <p className="text-[18px] font-extrabold text-[#707070]">
          오늘도 재미있게 이야기해요
        </p>
      </div>

      <div className="flex items-stretch gap-6">
        {/* 내 프로필 카드(시안 22-1919) — 흰 사각 카드에 캐릭터, 아래로 연속 뱃지와 이름.
            crop 은 캐릭터 고르기 카드와 같은 백분율이다. */}
        <section className="flex w-[404px] shrink-0 flex-col items-center justify-center gap-[18px] rounded-[20px] bg-primary-pale px-6 py-[26px]">
          <div className="relative size-[318px] overflow-hidden rounded-xl border border-primary bg-story-bg">
            <Image
              src={character.src}
              alt=""
              width={character.intrinsic.width}
              height={character.intrinsic.height}
              priority
              style={{
                left: character.crop.left,
                top: character.crop.top,
                width: character.crop.width,
                height: character.crop.height,
              }}
              className="absolute max-w-none"
            />
          </div>
          <CharacterChangeButton characterId={child.character_id} />
          <div className="flex items-center gap-2 rounded-full bg-[#fd7c51] px-[18px] py-3 text-white">
            <MaterialSymbol name="local_fire_department" size={20} />
            <span className="font-gothic text-[16px] font-extrabold">
              {streak > 0
                ? `${streak}일 연속 이야기 중!`
                : "오늘 첫 이야기를 시작해 봐요!"}
            </span>
          </div>
          <div className="flex flex-col items-center gap-1.5 font-gothic">
            <p className="text-[30px] font-extrabold text-ink-strong">
              {child.name}
            </p>
            <p className="text-[16px] font-extrabold text-[#575757]">
              {age}살 · 이야기 친구
            </p>
          </div>
        </section>

        <div className="flex min-w-0 flex-1 flex-col justify-center gap-5">
          <section className="flex flex-col gap-3.5 rounded-[20px] border border-[#bdbdbd] bg-story-bg p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-[22px] font-extrabold text-ink-strong">
                최근에 들은 이야기
              </h2>
              <Link
                href="/stories"
                className="text-[16px] font-extrabold text-primary-strong"
              >
                전체 보기
              </Link>
            </div>
            {recent.length > 0 ? (
              <div className="flex gap-4">
                {recent.map(({ session, story }) => (
                  <Link
                    key={story.id}
                    href={`/stories/${story.id}`}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-2xl bg-surface-muted p-3"
                  >
                    <span className="relative size-16 shrink-0 overflow-hidden rounded-xl">
                      <Image
                        src={story.thumbnail}
                        alt=""
                        fill
                        sizes="64px"
                        className="object-cover"
                      />
                    </span>
                    <span className="flex min-w-0 flex-col gap-1.5">
                      <span className="truncate text-[16px] font-extrabold text-ink-strong">
                        {story.title}
                      </span>
                      <span className="text-[14px] leading-[1.5] font-extrabold text-[#707070]">
                        {STATUS_LABEL[session.status]}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="text-[16px] font-bold text-ink-faint">
                아직 들은 이야기가 없어요. 첫 이야기를 골라 볼까요?
              </p>
            )}
          </section>

          <section className="flex flex-col gap-[18px] rounded-[20px] border border-[#bdbdbd] bg-story-bg p-6 font-gothic">
            <div className="flex items-center justify-between">
              <h2 className="text-[22px] font-extrabold text-ink-strong">
                내가 모은 스티커
              </h2>
              <p className="text-[16px] font-extrabold text-[#707070]">5 / 12</p>
            </div>
            <div className="flex gap-4">
              {STICKERS.map((sticker) => (
                <div
                  key={sticker.label}
                  className="flex min-w-0 flex-1 flex-col items-center gap-2 rounded-2xl px-2.5 py-4"
                  style={{
                    backgroundColor: `${sticker.color}1f`,
                    color: sticker.color,
                  }}
                >
                  <MaterialSymbol name={sticker.icon} size={30} />
                  <span className="text-[14px] font-bold text-[#3d3d3d]">
                    {sticker.label}
                  </span>
                </div>
              ))}
              <div className="flex min-w-0 flex-1 flex-col items-center gap-2 rounded-2xl bg-surface-muted px-2.5 py-4 text-[#bdbdbd]">
                <MaterialSymbol name="lock" size={30} />
                <span className="text-[14px] font-bold text-ink-faint">
                  다음 스티커
                </span>
              </div>
            </div>
          </section>

          {/* 통계 — 읽은 이야기만 실데이터, 문장·낱말 수는 집계가 아직 없어 목업 */}
          <div className="flex gap-5">
            <StatCard
              icon="menu_book"
              color="#45a9d3"
              value={`${readCount}권`}
              label="읽은 이야기"
            />
            <StatCard
              icon="chat_bubble"
              color="#fd7c51"
              value="86개"
              label="내가 말한 문장"
            />
            <StatCard
              icon="auto_awesome"
              color="#7bc47f"
              value="34개"
              label="새로 배운 낱말"
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3.5 pt-2.5">
        <div className="flex items-center gap-2.5 font-gothic">
          <span className="flex items-center gap-1.5 rounded-full bg-[#eef2f6] px-3.5 py-2 text-[#575757]">
            <MaterialSymbol name="lock" size={16} />
            <span className="text-[15px] font-extrabold">보호자 전용</span>
          </span>
          <p className="text-[16px] font-extrabold text-[#707070]">
            어른이 확인하는 공간이에요
          </p>
        </div>
        <div className="flex items-stretch gap-6">
          <ParentReportCard childName={child.name} />
          <SettingsEntryCard />
        </div>
      </div>
    </main>
  );
}

function StatCard({
  icon,
  color,
  value,
  label,
}: {
  icon: string;
  color: string;
  value: string;
  label: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2.5 rounded-[20px] border border-[#bdbdbd] bg-story-bg px-6 py-[18px]">
      <span
        className="flex size-[52px] items-center justify-center rounded-full"
        style={{ backgroundColor: `${color}26`, color }}
      >
        <MaterialSymbol name={icon} size={26} />
      </span>
      <p className="text-[24px] font-extrabold text-ink-strong">{value}</p>
      <p className="text-[16px] font-bold text-[#575757]">{label}</p>
    </div>
  );
}
