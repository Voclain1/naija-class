import { RequireOnboarding } from "@/components/auth/require-onboarding";
import { Step3InvitesForm } from "@/components/onboarding/step3-invites-form";

export default function OnboardingStep3Page() {
  return (
    <RequireOnboarding currentStep={3}>
      <Step3InvitesForm />
    </RequireOnboarding>
  );
}
