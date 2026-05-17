import { RequireOnboarding } from "@/components/auth/require-onboarding";
import { Step4NdprForm } from "@/components/onboarding/step4-ndpr-form";

export default function OnboardingStep4Page() {
  return (
    <RequireOnboarding currentStep={4}>
      <Step4NdprForm />
    </RequireOnboarding>
  );
}
