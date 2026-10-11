import { z } from "zod";

// Plans and student caps (2026-10-11). docs/modules/plans.md.
//
// The plans are the ones published on the marketing site (schoolkit-landing,
// lib/brand.ts). Only the student caps live here: prices are not stored in
// the app, because nothing bills yet and the site is the one place a price is
// written (plans.md D1).

export const SCHOOL_PLANS = ["FREE", "STARTER", "GROWTH", "PROFESSIONAL", "ENTERPRISE"] as const;
export type SchoolPlan = (typeof SCHOOL_PLANS)[number];

export const PLAN_LABELS: Record<SchoolPlan, string> = {
  FREE: "Free",
  STARTER: "Starter",
  GROWTH: "Growth",
  PROFESSIONAL: "Professional",
  ENTERPRISE: "Enterprise",
};

/** Students on the roll each plan covers. Null: by agreement (no cap unless overridden). */
export const PLAN_STUDENT_CAPS: Record<SchoolPlan, number | null> = {
  FREE: 100,
  STARTER: 200,
  GROWTH: 600,
  PROFESSIONAL: 1200,
  ENTERPRISE: null,
};

/** Statuses that count toward the cap (plans.md D2). Withdrawn and graduated do not. */
export const ON_ROLL_STUDENT_STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED"] as const;

/** The cap for a school: its override if it has one, else its plan's. */
export function studentCapFor(plan: SchoolPlan, override: number | null): number | null {
  return override ?? PLAN_STUDENT_CAPS[plan];
}

/** At or above this share of the cap, owners and admins see a notice. */
export const PLAN_NEAR_CAP_RATIO = 0.9;

export type PlanUsageStatus = "ok" | "near" | "over";

export function planUsageStatus(studentsOnRoll: number, cap: number | null): PlanUsageStatus {
  if (cap === null) return "ok";
  if (studentsOnRoll > cap) return "over";
  return studentsOnRoll >= Math.ceil(cap * PLAN_NEAR_CAP_RATIO) ? "near" : "ok";
}

/**
 * PLAN_ENFORCEMENT on the API (plans.md D3). "warn" blocks nothing; "enforce"
 * refuses new students past the cap. Anything else, including unset, is warn.
 */
export type PlanEnforcement = "warn" | "enforce";

export function parsePlanEnforcement(raw: string | undefined): PlanEnforcement {
  return raw?.trim().toLowerCase() === "enforce" ? "enforce" : "warn";
}

export const PLAN_ERROR_CODES = {
  STUDENT_LIMIT: "PLAN_STUDENT_LIMIT",
  FEATURE_UNAVAILABLE: "PLAN_FEATURE_UNAVAILABLE",
} as const;

// ---------------------------------------------------------------------------
// Features by plan (2026-10-11, plans.md D5). The owner's decision for report
// cards on Free: a real, printable termly card, with three things kept for
// paid plans. Like the caps, they only take effect under
// PLAN_ENFORCEMENT=enforce; under warn every school has them.
// ---------------------------------------------------------------------------
export const PLAN_FEATURES = ["reportCardBranding", "aiReportComments", "reportCardPositions"] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

export const PLAN_FEATURE_LABELS: Record<PlanFeature, string> = {
  reportCardBranding: "Your logo and colours on report cards",
  aiReportComments: "AI drafts of report card comments",
  reportCardPositions: "Class positions and cumulative results on report cards",
};

/** The cheapest plan that includes each feature. */
export const PLAN_FEATURE_MIN_PLAN: Record<PlanFeature, SchoolPlan> = {
  reportCardBranding: "STARTER",
  aiReportComments: "STARTER",
  reportCardPositions: "STARTER",
};

/** Whether the plan includes the feature, whatever the enforcement switch says. */
export function planIncludesFeature(plan: SchoolPlan, feature: PlanFeature): boolean {
  return SCHOOL_PLANS.indexOf(plan) >= SCHOOL_PLANS.indexOf(PLAN_FEATURE_MIN_PLAN[feature]);
}

/** Whether the school gets the feature now: always under warn, by plan under enforce. */
export function planFeatureAvailable(plan: SchoolPlan, feature: PlanFeature, enforcement: PlanEnforcement): boolean {
  return enforcement === "warn" || planIncludesFeature(plan, feature);
}

export interface SchoolPlanFeatureDto {
  feature: PlanFeature;
  label: string;
  /** In the school's plan. */
  included: boolean;
  /** The school has it now (true for every feature under warn). */
  available: boolean;
}

// GET /schools/me/plan
export interface SchoolPlanDto {
  plan: SchoolPlan;
  label: string;
  /** Null: no cap. */
  studentCap: number | null;
  studentsOnRoll: number;
  enforcement: PlanEnforcement;
  status: PlanUsageStatus;
  features: SchoolPlanFeatureDto[];
}

// PATCH /platform-admin/schools/:schoolId/plan
export const PLATFORM_ADMIN_STUDENT_CAP_MAX = 100_000;

export const platformAdminSetPlanSchema = z
  .object({
    plan: z.enum(SCHOOL_PLANS),
    studentCapOverride: z.number().int().positive().max(PLATFORM_ADMIN_STUDENT_CAP_MAX).nullable(),
  })
  .strict();

export type PlatformAdminSetPlanInput = z.infer<typeof platformAdminSetPlanSchema>;

export interface PlatformAdminSetPlanResponse {
  schoolId: string;
  plan: SchoolPlan;
  studentCapOverride: number | null;
  studentCap: number | null;
}
