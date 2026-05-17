import { RequireOnboarding } from "@/components/auth/require-onboarding";
import { Step1BasicsForm } from "@/components/onboarding/step1-basics-form";

export default function OnboardingStep1Page() {
  return (
    <RequireOnboarding currentStep={1}>
      <Step1BasicsForm />
    </RequireOnboarding>
  );
}
