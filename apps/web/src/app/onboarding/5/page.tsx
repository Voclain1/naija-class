import { RequireOnboarding } from "@/components/auth/require-onboarding";
import { Step5Success } from "@/components/onboarding/step5-success";

export default function OnboardingStep5Page() {
  return (
    <RequireOnboarding currentStep={5}>
      <Step5Success />
    </RequireOnboarding>
  );
}
