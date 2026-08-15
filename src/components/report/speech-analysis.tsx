import { CharacterAvatar } from "@/components/child/character-avatar";
import { RadarChart } from "@/components/report/radar-chart";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { Report, SkillDetail, WordGroup } from "@/lib/report";

/** 카드 공통 — 흰 판에 옅은 그림자(시안 47-1885 · 47-1906 · 47-1962 · 47-1974). */
const CARD =
  "flex flex-col rounded-[20px] bg-story-bg px-[26px] py-5 shadow-[0_4px_8px_rgba(0,0,0,0.08)]";

/** 말하기 분석 탭(시안 47-1865 본문). */
export function SpeechAnalysis({
  report,
  characterId,
}: {
  report: Report;
  characterId: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      {/* ── 요약 스트립 */}
      <section className="flex h-24 items-center justify-between rounded-xl bg-primary-pale px-[26px]">
        <div className="flex items-center gap-4">
          <CharacterAvatar characterId={characterId} size={56} />
          <div className="flex flex-col gap-1.5 whitespace-nowrap">
            <h2 className="text-[24px] leading-[1.3] font-extrabold text-ink-strong">
              {report.summary.title}
            </h2>
            <p className="text-[14px] leading-[1.4] font-bold text-[#8a8a8a]">
              {report.summary.caption}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5">
          {report.summary.stats.map((stat) => (
            <div
              key={stat.label}
              className="flex flex-col items-center gap-1.5 px-[18px] py-2.5 whitespace-nowrap"
            >
              <span className="text-[13px] font-extrabold text-[#3d3d3d]">
                {stat.label}
              </span>
              <span className="text-[20px] leading-[1.2] font-extrabold text-primary-strong">
                {stat.value}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* ── 역량 그래프 · 역량별 분석 */}
      <div className="flex h-[432px] gap-5">
        <section className={`${CARD} w-[434px] shrink-0 justify-between`}>
          <div className="flex h-[30px] items-center justify-between whitespace-nowrap">
            <h2 className="text-[20px] leading-[1.3] font-extrabold text-ink-strong">
              말하기 역량 그래프
            </h2>
            <p className="text-[13px] font-bold text-[#8a8a8a]">이번 활동 기준</p>
          </div>

          <RadarChart axes={report.radar.axes} />

          <p className="flex items-start gap-2 rounded-xl bg-surface-muted px-3.5 py-[11px]">
            <MaterialSymbol
              name="insights"
              size={16}
              className="text-primary mt-[3px]"
            />
            <span className="text-[14px] leading-[1.5] font-bold text-[#575757]">
              {report.radar.comment}
            </span>
          </p>
        </section>

        <section className={`${CARD} min-w-0 flex-1`}>
          <div className="flex h-[30px] items-center justify-between whitespace-nowrap">
            <div className="flex items-center gap-2.5">
              <h2 className="text-[20px] leading-[1.3] font-extrabold text-ink-strong">
                역량별 분석
              </h2>
              <p className="text-[12px] font-bold text-[#8a8a8a]">
                실제 발화를 근거로 정리했어요
              </p>
            </div>
            <p className="text-[12px] font-bold text-[#8a8a8a]">
              잘한 점 → 보완할 점 순서
            </p>
          </div>

          <div className="flex min-h-0 flex-1 gap-3.5 pt-3.5">
            {report.skills.map((skill) => (
              <SkillCard
                key={skill.name}
                skill={skill}
                quoteLabel={report.quoteLabel}
              />
            ))}
          </div>
        </section>
      </div>

      {/* ── 대표 발화 · 어휘 자세히 보기 */}
      <div className="flex h-[304px] gap-5">
        <section className={`${CARD} w-[434px] shrink-0 gap-3`}>
          <div className="flex h-[30px] items-center gap-2">
            <MaterialSymbol
              name="format_quote"
              size={22}
              className="text-[#fd7649]"
            />
            <h2 className="text-[20px] leading-[1.3] font-extrabold text-[#575757]">
              오늘의 대표 발화
            </h2>
            <span className="flex items-center gap-1.5 py-1.5 whitespace-nowrap">
              <MaterialSymbol
                name="photo_library"
                size={13}
                className="text-ink-faint"
              />
              <span className="text-[12px] font-bold text-[#575757]">
                {report.highlight.scene}
              </span>
            </span>
          </div>

          <p className="flex min-h-0 flex-1 items-center rounded-[14px] p-4 text-[18px] leading-[1.6] font-extrabold text-ink-strong">
            {report.highlight.quote}
          </p>

          <p className="flex items-center gap-2 rounded-xl bg-surface-muted px-3.5 py-[11px]">
            <MaterialSymbol name="star" size={16} className="text-[#fd7649]" />
            <span className="text-[14px] leading-[1.5] font-bold text-[#575757]">
              {report.highlight.comment}
            </span>
          </p>
        </section>

        <section className={`${CARD} min-w-0 flex-1 gap-3.5`}>
          <div className="flex h-[30px] items-center gap-2.5 whitespace-nowrap">
            <h2 className="text-[20px] leading-[1.3] font-extrabold text-ink-strong">
              어휘 자세히 보기
            </h2>
            <p className="text-[12px] font-bold text-[#8a8a8a]">
              {report.words.caption}
            </p>
          </div>

          <div className="flex min-h-0 flex-1 gap-3.5">
            {report.words.groups.map((group) => (
              <WordCard key={group.title} group={group} />
            ))}
          </div>

          <p className="flex items-start gap-2 rounded-xl bg-surface-muted px-4 py-3">
            <MaterialSymbol
              name="tips_and_updates"
              size={18}
              className="mt-[3px] text-primary-strong"
            />
            <span className="text-[13px] leading-[1.6] font-bold text-[#575757]">
              {report.words.feedback.before}
              <span className="font-extrabold text-primary-strong">
                {report.words.feedback.accent}
              </span>
              {report.words.feedback.after}
            </span>
          </p>
        </section>
      </div>
    </div>
  );
}

/** 역량별 분석 3단 중 한 장(시안 47-1913). 색만 역량마다 다르다. */
function SkillCard({
  skill,
  quoteLabel,
}: {
  skill: SkillDetail;
  quoteLabel: string;
}) {
  return (
    <article className="flex min-w-0 flex-1 flex-col gap-3 rounded-2xl border border-[#d6d6d6] bg-story-bg p-4">
      <div className="flex items-center gap-[7px]">
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: skill.color }}
        />
        <h3 className="text-[17px] leading-[1.3] font-extrabold text-ink-strong">
          {skill.name}
        </h3>
      </div>

      <p className="text-[12px] leading-[1.5] font-bold text-ink-strong">
        {skill.summary}
      </p>

      <div className="flex min-h-0 flex-1 flex-col gap-5">
        <div
          className="flex flex-col gap-3 rounded-[10px] px-3 py-2.5"
          style={{ backgroundColor: skill.tint }}
        >
          <span
            className="text-[11px] font-bold"
            style={{ color: skill.color }}
          >
            {quoteLabel}
          </span>
          <p className="text-[12px] leading-[1.5] font-extrabold text-ink-strong">
            {skill.quote}
          </p>
        </div>

        <div className="flex flex-col gap-5">
          <Verdict icon="check_circle" color="#5aa860" text={skill.good} />
          <Verdict icon="add_circle" color="#e08a5a" text={skill.improve} />
        </div>
      </div>
    </article>
  );
}

/** 잘한 점(체크) · 보완할 점(플러스) 한 줄. */
function Verdict({
  icon,
  color,
  text,
}: {
  icon: string;
  color: string;
  text: string;
}) {
  return (
    <p className="flex items-start gap-2.5">
      {/* 아이콘 색은 잘한 점(초록)·보완할 점(주황) 두 가지뿐이라 역량 색과 무관하다 */}
      <span className="mt-[2px] flex shrink-0" style={{ color }}>
        <MaterialSymbol name={icon} size={14} />
      </span>
      <span className="min-w-0 flex-1 text-[12px] leading-[1.6] font-bold text-[#3d3d3d]">
        {text}
      </span>
    </p>
  );
}

/** 어휘 3단 중 한 칸(시안 47-1980). */
function WordCard({ group }: { group: WordGroup }) {
  return (
    <article className="flex min-w-0 flex-1 flex-col gap-5 rounded-[14px] border border-[#eef2f6] bg-[#fbfcfd] px-4 py-3.5">
      <div className="flex items-center justify-between gap-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="flex shrink-0" style={{ color: group.color }}>
            <MaterialSymbol name={group.icon} size={16} />
          </span>
          <h3 className="truncate text-[14px] font-extrabold text-ink-strong">
            {group.title}
          </h3>
        </div>
        {group.more && (
          <span className="shrink-0 text-[11px] font-extrabold text-[#bdbdbd]">
            {group.more}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {group.words.map((word) => (
          <span
            key={word}
            className="rounded-full px-[11px] py-[5px] text-[12px] font-bold"
            style={{ backgroundColor: group.chipBg, color: group.color }}
          >
            {word}
          </span>
        ))}
      </div>
    </article>
  );
}
