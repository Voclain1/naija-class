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
} as const;

// GET /schools/me/plan
export interface SchoolPlanDto {
  plan: SchoolPlan;
  label: string;
  /** Null: no cap. */
  studentCap: number | null;
  studentsOnRoll: number;
  enforcement: PlanEnforcement;
  status: PlanUsageStatus;
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
