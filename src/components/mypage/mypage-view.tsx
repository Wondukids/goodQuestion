import Image from "next/image";
import Link from "next/link";
import { CharacterAvatar } from "@/components/child/character-avatar";
import { AttendanceCard } from "@/components/mypage/attendance-card";
import { CharacterChangeButton } from "@/components/mypage/character-change-dialog";
import { ParentReportCard } from "@/components/mypage/parent-report-card";
import { SettingsEntryCard } from "@/components/mypage/settings-entry-card";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import { togetherDays, type WeekAttendance } from "@/lib/attendance";
import type { SelectedChild } from "@/lib/selected-child";
import type { ChildStorySession } from "@/lib/story-sessions";
import type { Story } from "@/lib/story-types";

/* 스티커 시스템이 아직 없어 시안(41-1770)의 구성을 목업으로 보여 준다. */
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

/** 마이페이지(시안 41-1700) — 왼쪽에 프로필·출석, 오른쪽에 기록 묶음. */
export function MyPageView({
  child,
  stories,
  sessions,
  week,
}: {
  child: SelectedChild;
  stories: Story[];
  sessions: ChildStorySession[];
  week: WeekAttendance;
}) {
  const recent = sessions
    .flatMap((session) => {
      const story = stories.find((candidate) => candidate.id === session.slug);
      return story ? [{ session, story }] : [];
    })
    .slice(0, 3);
  const readCount = new Set(sessions.map((session) => session.slug)).size;

  return (
    <main className="flex flex-col gap-[30px] px-12 pb-16">
      {/* 시안은 하늘 배경 없이 평평한 바탕 — 레이아웃의 하늘 배경을 덮는다 */}
      <div aria-hidden className="fixed inset-0 -z-10 bg-story-bg" />

      <div className="flex items-center gap-3 px-4">
        <h1 className="text-[24px] font-extrabold text-ink-strong">
          {child.name}의 이야기 방이에요!
        </h1>
        <p className="font-gothic text-[16px] font-bold text-ink-mid">
          오늘도 재미있게 이야기해봐요
        </p>
      </div>

      <div className="flex h-[514px] items-start gap-6">
        {/* ── 왼쪽: 프로필 카드와 이번 주 출석 */}
        <div className="flex h-full w-[213px] shrink-0 flex-col gap-6">
          <section className="flex flex-col items-center gap-5 rounded-[20px] bg-primary-pale px-5 pt-3 pb-[23px]">
            <div className="flex w-full justify-end">
              <CharacterChangeButton characterId={child.character_id} />
            </div>
            <CharacterAvatar characterId={child.character_id} size={96} />
            <div className="flex flex-col items-center gap-3.5 font-gothic">
              <p className="text-[13px] leading-[1.3] font-extrabold text-ink-strong">
                {child.name}와 함께한 지
              </p>
              <p className="flex items-end gap-[3px] leading-none">
                <span className="text-[36px] font-extrabold text-primary-strong">
                  {togetherDays(child.created_at)}
                </span>
                <span className="text-[20px] font-extrabold text-ink-strong">
                  일차
                </span>
              </p>
            </div>
          </section>

          <AttendanceCard week={week} />
        </div>

        {/* ── 오른쪽: 통계 · 스티커 · 최근 이야기 */}
        <div className="flex h-full min-w-0 flex-1 flex-col items-center justify-between rounded-[20px] border border-[#d6d6d6] bg-story-bg py-[30px]">
          {/* 통계 — 읽은 이야기만 실데이터, 문장·낱말 수는 집계가 아직 없어 목업 */}
          <div className="flex w-full items-center">
            <StatCell
              icon="menu_book"
              color="#45a9d3"
              value={`${readCount}권`}
              label="읽은 이야기"
            />
            <span className="h-[70px] w-px shrink-0 bg-[#d6d6d6]" />
            <StatCell
              icon="chat_bubble"
              color="#fd7c51"
              value="86개"
              label="내가 말한 문장"
            />
            <span className="h-[70px] w-px shrink-0 bg-[#d6d6d6]" />
            <StatCell
              icon="auto_awesome"
              color="#7bc47f"
              value="34개"
              label="새로 배운 낱말"
            />
          </div>

          <section className="flex w-full flex-col gap-3 px-6">
            <div className="flex items-center justify-between pl-2">
              <h2 className="text-[18px] font-extrabold text-ink-strong">
                내가 모은 스티커
              </h2>
              <p className="font-gothic text-[16px] font-extrabold text-ink-mid">
                5 / 12
              </p>
            </div>
            <div className="flex w-full gap-4">
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
                <span className="text-[14px] font-bold text-[#3d3d3d]">
                  다음 스티커
                </span>
              </div>
            </div>
          </section>

          <section className="flex w-full flex-col gap-3 px-6">
            <div className="flex items-center justify-between px-2">
              <h2 className="text-[18px] font-extrabold text-ink-strong">
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
              <div className="flex w-full gap-4">
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
                      <span className="text-[14px] leading-[1.5] font-extrabold text-ink-mid">
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
        </div>
      </div>

      <div className="flex flex-col gap-3.5 pt-2.5">
        <div className="flex items-center gap-2.5 font-gothic">
          <span className="flex items-center gap-1.5 rounded-full bg-surface-muted px-3.5 py-2 text-[#575757]">
            <MaterialSymbol name="lock" size={16} />
            <span className="text-[15px] font-extrabold">보호자 전용</span>
          </span>
          <p className="text-[16px] font-extrabold text-ink-mid">
            어른이 확인하는 공간이에요
          </p>
        </div>
        <div className="flex items-stretch gap-6">
          <ParentReportCard childName={child.name} childId={child.id} />
          <SettingsEntryCard />
        </div>
      </div>
    </main>
  );
}

/** 기록 묶음 위쪽 통계 한 칸(시안 41-1749). */
function StatCell({
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
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2.5 px-6">
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
