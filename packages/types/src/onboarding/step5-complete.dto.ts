import { z } from "zod";

import { academicCalendarSchema } from "./academic-calendar.dto.js";

// Step 5 — Academic calendar, then Complete.
//
// This step used to carry NO payload: it only flipped school.status from
// ONBOARDING to ACTIVE. As of 2026-08-21 it also carries the school's first
// academic year and its three terms — see academic-calendar.dto.ts and
// docs/modules/academic-calendar-bootstrap.md (#198) for why that has to be
// asked rather than seeded.
//
// WHY STEP 5 RATHER THAN A NEW STEP 6. The plan-first assumed inserting a new
// step and renumbering Success, and costed the renumbering (the step machine
// in schools.service.ts rejects unless onboardingStep === step - 1, plus the
// web route folders, the progress indicator, RequireAuth's
// /onboarding/<step + 1> redirect) along with a migration for schools sitting
// mid-onboarding at deploy time.
//
// None of that is necessary. Step 5 was an empty object, so the calendar
// rides on it: the step count is unchanged, no route folder moves, and a
// school parked at onboardingStep 4 advances into the new step 5 with no
// migration at all — it simply gets the form the next time it continues.
// Activation stays part of the same step, which is what keeps "a school is
// ACTIVE" and "a school has a usable calendar" true at the same instant
// rather than two states that can drift apart.
//
// Schools that completed onboarding BEFORE this shipped are already ACTIVE
// and cannot revisit step 5 — the production census found 23 of them. They
// are served by POST /schools/me/academic-calendar and the in-app prompt,
// using this same calendar schema.
export const onboardingStep5Schema = z
  .object({
    calendar: academicCalendarSchema,
  })
  .strict();

export type OnboardingStep5Input = z.infer<typeof onboardingStep5Schema>;
