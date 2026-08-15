import { Fragment, type ReactNode } from "react";
import { MaterialSymbol } from "@/components/ui/material-symbol";
import type { DailyQuestion, Report, StoryQuestion } from "@/lib/report";

/** 가정 연계 가이드 탭(시안 47-2045 본문). */
export function HomeGuide({ guide }: { guide: Report["guide"] }) {
  return (
    <div className="flex flex-col gap-5">
      {/* ── 추천 근거 한 줄 */}
      <p className="flex h-12 items-center gap-[7px] rounded-[10px] bg-surface-muted px-3.5">
        <MaterialSymbol
          name="auto_awesome"
          size={18}
          className="text-[#fd7649]"
        />
        <span className="font-gothic text-[14px] font-bold text-ink-mid">
          {guide.reason}
        </span>
      </p>

      {/* ── 이야기 속 질문 · 일상 질문 */}
      {/* 문장이 아직 없는 리포트에서는 두 기둥이 통째로 빈다 — 안내를 낸다 (계약 2절 ②) */}
      {guide.notice ? (
        <p className="flex h-[700px] items-center justify-center rounded-[20px] border border-[#bdbdbd] bg-story-bg px-10 text-center text-[16px] leading-[1.6] font-bold text-ink-faint">
          {guide.notice}
        </p>
      ) : (
        <div className="flex h-[700px] gap-5">
          <GuideColumn
            step={1}
            stepColor="#45a9d3"
            title="이야기 주제 이어가기"
            caption={guide.story.caption}
          >
            {/* 키를 배지 이름으로 잡지 않는다 — 같은 요소가 두 번 뽑힐 수 있다 */}
            {guide.story.questions.map((question, index) => (
              <StoryQuestionCard key={index} question={question} />
            ))}
          </GuideColumn>

          <GuideColumn
            step={2}
            stepColor="#fd7649"
            title="일상생활로 연결하기"
            caption={guide.daily.caption}
          >
            {guide.daily.questions.map((question, index) => (
              <DailyQuestionCard key={index} question={question} />
            ))}
          </GuideColumn>
        </div>
      )}

      {/* ── 대답이 짧을 때 쓰는 3단계 */}
      <section className="flex h-24 items-center gap-5 rounded-[20px] border-2 border-primary-pale bg-[#f7f5fd] px-6">
        <div className="flex shrink-0 items-center gap-3">
          <MaterialSymbol name="stairs" size={22} className="text-[#7c5cd6]" />
          <div className="flex flex-col gap-[13px] whitespace-nowrap">
            <span className="text-[14px] leading-[1.3] font-extrabold text-ink-strong">
              대답이 짧을 땐
            </span>
            <span className="text-[12px] leading-[1.3] font-bold text-ink-mid">
              순서대로 시도해보세요!
            </span>
          </div>
        </div>

        <span aria-hidden className="h-11 w-px shrink-0 bg-primary-pale" />

        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          {guide.steps.map((step, index) => (
            <Fragment key={step.title}>
              {index > 0 && (
                <MaterialSymbol
                  name="chevron_right"
                  size={16}
                  className="text-[#c9bcec]"
                />
              )}
              <div className="flex min-w-0 flex-1 items-center gap-4 rounded-xl bg-story-bg px-3.5 py-4">
                <span
                  className="flex size-6 shrink-0 items-center justify-center rounded-full font-jua text-[13px] text-story-bg"
                  style={{ backgroundColor: step.color }}
                >
                  {index + 1}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-4">
                  <span className="text-[14px] leading-[1.5] font-extrabold text-[#5b3fb0]">
                    {step.title}
                  </span>
                  <span className="text-[12px] leading-[1.5] font-bold text-ink-mid">
                    {step.example}
                  </span>
                </div>
              </div>
            </Fragment>
          ))}
        </div>
      </section>
    </div>
  );
}

/** 번호 · 제목 · 캡션을 얹은 두 기둥의 공통 껍데기(시안 47-2052 · 47-2101). */
function GuideColumn({
  step,
  stepColor,
  title,
  caption,
  children,
}: {
  step: number;
  stepColor: string;
  title: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-3.5 rounded-[20px] border border-[#bdbdbd] bg-story-bg px-[26px] py-[22px]">
      <div className="flex h-[34px] items-center gap-2.5 whitespace-nowrap">
        <span
          className="flex size-[26px] shrink-0 items-center justify-center rounded-full font-jua text-[14px] text-story-bg"
          style={{ backgroundColor: stepColor }}
        >
          {step}
        </span>
        <h2 className="text-[20px] leading-[1.3] font-extrabold text-ink-strong">
          {title}
        </h2>
        <p className="text-[13px] font-bold text-[#8a8a8a]">{caption}</p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3">{children}</div>
    </section>
  );
}

/** 이야기 속에서 이어 묻는 질문 한 장(시안 47-2059). */
function StoryQuestionCard({ question }: { question: StoryQuestion }) {
  return (
    <article className="flex min-h-0 flex-1 flex-col justify-center gap-[18px] rounded-[14px] border border-primary-pale bg-[#fbfcfd] px-4 py-[13px]">
      <div className="flex items-center gap-1.5">
        <span className="rounded-full bg-[#eaf6fb] px-2.5 py-1 text-[11px] font-extrabold text-primary-strong">
          {question.type}
        </span>
        {/* 「장면 3 · …」 과 「미션 · 배 따기」 두 꼴이 온다 — 그대로 찍는다 (M7) */}
        {question.scene && (
          <span className="flex items-center gap-[5px] rounded-full bg-surface-muted px-3 py-1.5">
            <MaterialSymbol
              name="photo_library"
              size={13}
              className="text-ink-mid"
            />
            <span className="text-[12px] font-bold text-[#575757]">
              {question.scene}
            </span>
          </span>
        )}
      </div>

      {/* 인용을 못 찾으면 근거 줄 없이 질문만 그린다 (계약 1절) */}
      {question.quote && (
        <p className="flex items-center gap-1.5 rounded-lg bg-primary-pale px-2.5 py-2 text-[#226f90]">
          <MaterialSymbol name="format_quote" size={16} />
          <span className="min-w-0 flex-1 text-[13px] font-extrabold">
            {question.quote}
          </span>
        </p>
      )}

      <p className="text-[16px] leading-[1.5] font-extrabold text-ink-strong">
        {question.question}
      </p>

      <p className="flex items-start gap-1.5">
        <MaterialSymbol
          name="subdirectory_arrow_right"
          size={14}
          className="mt-[3px] text-[#a78bfa]"
        />
        <span className="min-w-0 flex-1 text-[14px] leading-[1.5] font-bold text-ink-mid">
          {question.followUp}
        </span>
      </p>
    </article>
  );
}

/** 저녁 식탁으로 옮겨 묻는 질문 한 장(시안 47-2108). */
function DailyQuestionCard({ question }: { question: DailyQuestion }) {
  return (
    <article className="flex min-h-0 flex-1 flex-col justify-center gap-[18px] rounded-[14px] border border-[#ffe8e1] bg-story-bg px-4 py-[13px]">
      <span className="w-fit rounded-full bg-[#fff3ec] px-3 py-1.5 text-[12px] font-extrabold text-[#fd7649]">
        {question.type}
      </span>

      <p className="text-[16px] leading-[1.5] font-extrabold text-ink-strong">
        {question.question}
      </p>

      <p className="flex items-center gap-1.5 text-ink-mid">
        <MaterialSymbol name="target" size={14} />
        <span className="min-w-0 flex-1 text-[14px] leading-[1.5] font-bold">
          {question.intent}
        </span>
      </p>
    </article>
  );
}
