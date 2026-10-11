import type { PrismaClient } from "@school-kit/db";
import {
  ForbiddenError,
  ON_ROLL_STUDENT_STATUSES,
  PLAN_ERROR_CODES,
  PLAN_FEATURES,
  PLAN_FEATURE_LABELS,
  PLAN_FEATURE_MIN_PLAN,
  PLAN_LABELS,
  parsePlanEnforcement,
  planFeatureAvailable,
  planIncludesFeature,
  planUsageStatus,
  studentCapFor,
  type PlanEnforcement,
  type PlanFeature,
  type SchoolPlanDto,
} from "@school-kit/types";

// Plans and student caps (2026-10-11). docs/modules/plans.md.
//
// Plain functions taking the caller's tenant-scoped client, like
// assertUserActiveAndHasOneOf, because the three places students are created
// (students.service, imports.service, student-scan.service) each already hold
// one, and the count must run under the same school's RLS.

/** PLAN_ENFORCEMENT, read per call so a changed secret needs only a restart. */
export function currentPlanEnforcement(): PlanEnforcement {
  return parsePlanEnforcement(process.env.PLAN_ENFORCEMENT);
}

export async function readSchoolPlan(
  db: PrismaClient,
  schoolId: string,
  enforcement: PlanEnforcement = currentPlanEnforcement(),
): Promise<SchoolPlanDto> {
  const school = await db.school.findUniqueOrThrow({
    where: { id: schoolId },
    select: { plan: true, studentCapOverride: true },
  });
  const studentsOnRoll = await db.student.count({
    where: { schoolId, status: { in: [...ON_ROLL_STUDENT_STATUSES] } },
  });
  const studentCap = studentCapFor(school.plan, school.studentCapOverride);
  return {
    plan: school.plan,
    label: PLAN_LABELS[school.plan],
    studentCap,
    studentsOnRoll,
    enforcement,
    status: planUsageStatus(studentsOnRoll, studentCap),
    features: PLAN_FEATURES.map((feature) => ({
      feature,
      label: PLAN_FEATURE_LABELS[feature],
      included: planIncludesFeature(school.plan, feature),
      available: planFeatureAvailable(school.plan, feature, enforcement),
    })),
  };
}

/**
 * Refuses, under PLAN_ENFORCEMENT=enforce, an action that would take the
 * school past its cap by `adding` students. Under warn (the default) it does
 * nothing and reads nothing. Count-then-insert without a lock: two admins
 * taking the last place together can both succeed (plans.md D3).
 */
export async function assertRoomForStudents(
  db: PrismaClient,
  schoolId: string,
  adding: number,
  enforcement: PlanEnforcement = currentPlanEnforcement(),
): Promise<void> {
  if (enforcement !== "enforce" || adding <= 0) return;
  const plan = await readSchoolPlan(db, schoolId, enforcement);
  if (plan.studentCap === null || plan.studentsOnRoll + adding <= plan.studentCap) return;
  const room = Math.max(0, plan.studentCap - plan.studentsOnRoll);
  throw new ForbiddenError(
    PLAN_ERROR_CODES.STUDENT_LIMIT,
    `Your school's ${plan.label} plan covers up to ${plan.studentCap} students, and ${plan.studentsOnRoll} are on the roll` +
      (adding > 1 ? `, so there is room for ${room} more, not ${adding}.` : ".") +
      " Contact SchoolKit to move to a bigger plan.",
    { plan: plan.plan, studentCap: plan.studentCap, studentsOnRoll: plan.studentsOnRoll, adding },
  );
}

// ---------------------------------------------------------------------------
// Features by plan (plans.md D5).
// ---------------------------------------------------------------------------

/** Whether the school has the feature now. Under warn this reads nothing. */
export async function schoolHasPlanFeature(
  db: PrismaClient,
  schoolId: string,
  feature: PlanFeature,
  enforcement: PlanEnforcement = currentPlanEnforcement(),
): Promise<boolean> {
  if (enforcement === "warn") return true;
  const school = await db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { plan: true } });
  return planFeatureAvailable(school.plan, feature, enforcement);
}

/** Refuses with 403 PLAN_FEATURE_UNAVAILABLE when the school's plan leaves the feature out. */
export async function assertPlanFeature(
  db: PrismaClient,
  schoolId: string,
  feature: PlanFeature,
  enforcement: PlanEnforcement = currentPlanEnforcement(),
): Promise<void> {
  if (await schoolHasPlanFeature(db, schoolId, feature, enforcement)) return;
  const school = await db.school.findUniqueOrThrow({ where: { id: schoolId }, select: { plan: true } });
  throw new ForbiddenError(
    PLAN_ERROR_CODES.FEATURE_UNAVAILABLE,
    `${PLAN_FEATURE_LABELS[feature]} aren't on the ${PLAN_LABELS[school.plan]} plan. ` +
      `They come with the ${PLAN_LABELS[PLAN_FEATURE_MIN_PLAN[feature]]} plan and up; contact SchoolKit to move to it.`,
    { feature, plan: school.plan },
  );
}
