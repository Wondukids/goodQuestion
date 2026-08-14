import { Logo } from "@/components/brand/logo";
import { ChildRegisterForm } from "@/components/onboarding/child-register-form";
import { StepIndicator } from "@/components/onboarding/step-indicator";

export default function ChildOnboardingPage() {
  return (
    <main className="relative flex min-h-full items-center justify-center bg-auth-bg px-12 py-8">
      <Logo className="absolute top-[30px] left-12" />

      <div className="flex w-[1202px] max-w-full flex-col items-center gap-20">
        <StepIndicator
          steps={[
            { marker: "✓", label: "보호자 계정", done: true },
            { marker: "2", label: "아이 등록" },
          ]}
        />

        <ChildRegisterForm />
      </div>
    </main>
  );
}
