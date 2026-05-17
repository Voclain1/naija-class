// POST /schools/me/onboarding/:step. One wrapper per step so the call-sites
// are typed against the right payload — calling advanceStep1 with a step 3
// shape is a compile error, not a runtime 400.

import type {
  OnboardingStep1Input,
  OnboardingStep2Input,
  OnboardingStep3Input,
  OnboardingStep4Input,
  OnboardingStep5Input,
  OnboardingStepResponse,
} from "@school-kit/types";

import { apiFetch } from "../api-client";

function advance(step: number, body: unknown): Promise<OnboardingStepResponse> {
  return apiFetch<OnboardingStepResponse>(`/schools/me/onboarding/${step}`, {
    method: "POST",
    body,
  });
}

export function advanceStep1(input: OnboardingStep1Input) {
  return advance(1, input);
}
export function advanceStep2(input: OnboardingStep2Input) {
  return advance(2, input);
}
export function advanceStep3(input: OnboardingStep3Input) {
  return advance(3, input);
}
export function advanceStep4(input: OnboardingStep4Input) {
  return advance(4, input);
}
export function advanceStep5(input: OnboardingStep5Input) {
  return advance(5, input);
}
