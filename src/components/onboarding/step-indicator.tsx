export type Step = {
  /** 원 안에 들어가는 표시 — 완료 단계는 체크 */
  marker: string;
  label: string;
  done?: boolean;
};

export function StepIndicator({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex items-center gap-4 font-gothic">
      {steps.map((step, index) => (
        <li key={step.label} className="flex items-center gap-4">
          {index > 0 && (
            <span
              aria-hidden
              className="h-0.5 w-12 rounded-full bg-[#454545]"
            />
          )}
          <span className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-full bg-primary text-[14px] font-extrabold text-white">
              {step.marker}
            </span>
            <span
              className={
                step.done
                  ? "text-[15px] font-bold text-ink-muted"
                  : "text-[15px] font-extrabold text-ink"
              }
            >
              {step.label}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}
