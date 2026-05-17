import { RequireOnboarding } from "@/components/auth/require-onboarding";
import { Step2BrandingForm } from "@/components/onboarding/step2-branding-form";

export default function OnboardingStep2Page() {
  return (
    <RequireOnboarding currentStep={2}>
      <Step2BrandingForm />
    </RequireOnboarding>
  );
}
