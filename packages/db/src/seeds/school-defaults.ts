// Shared "a new school starts usable" bootstrap — the six seeds every school
// needs before an admin can do anything at all: 14 class levels, one default
// arm each, a core subject catalogue, and the grading scheme + components +
// grade boundaries.
//
// WHY THIS FILE EXISTS (2026-08-14). This block lived inline inside
// AuthService.signupOwner from Phase 1 / Slice 2 onward. When platform-admin
// school provisioning shipped (2026-08-07, PR #149) it reused signupOwner's
// transaction *pattern* — create School, set the RLS GUC, insert tenant-scoped
// rows — but not its seeding, because the seeding wasn't a callable unit. Four
// schools provisioned on 2026-08-08 landed with zero class levels, zero arms,
// zero subjects and no grading scheme: an owner could log in and do nothing.
// One of those owners (TRUE-WORD SCHOOLS) gave up and re-registered through
// self-serve signup four days later, leaving two school rows for one school.
// Extracting the block is therefore not tidiness — it's the fix, and the
// reason both call sites now share one function rather than two copies that
// can drift again.
//
// PRECONDITION — READ BEFORE ADDING A THIRD CALLER. `app.current_school_id`
// must ALREADY be set on the `tx` you pass in, for the same schoolId. Every
// table written here is under FORCE RLS, so an unset GUC fails the policy's
// WITH CHECK and the whole transaction aborts.
//
// This function deliberately does NOT set the GUC itself, and deliberately
// does NOT call withTenant(). withTenant opens its own
// basePrisma.$transaction, and Prisma does not support nested interactive
// transactions — the call would hang rather than fail, which is the worst
// possible failure mode. The caller owns the transaction and the GUC; this
// function only owns what gets seeded into it.
//
// TIMEOUT — the second thing a new caller must get right. This runs ~8
// sequential round-trips. Prisma's interactive-transaction default is 5000ms,
// and against real Neon latency that is not enough: the 2026-08-02/03
// production incident had signupOwner's transaction measured at 5172ms, 172ms
// over the default, failing every signup with a 500 for roughly two hours.
// Both current callers pass an explicit 20s timeout. A new one must too.
//
// IDEMPOTENT by construction — createMany({ skipDuplicates: true }) against
// each table's (school_id, ...) unique index, and an upsert for the grading
// scheme (whose id the components need anyway). Re-running against a
// partially- or fully-seeded school is a no-op rather than a constraint
// violation, which is what makes the backfill script safe to re-run.
//
// NO AUDIT ROW is written here. This is bootstrap attributed to the caller's
// own audit entry (auth.signup_owner / platform_admin.schools.create /
// the backfill script's own row), matching how the block behaved when it was
// inline in signupOwner.

import type { Prisma } from "../../generated/client/index.js";

import { defaultArmFor } from "./class-arms.js";
import { DEFAULT_CLASS_LEVELS } from "./class-levels.js";
import {
  DEFAULT_GRADE_BOUNDARIES,
  DEFAULT_GRADING_COMPONENTS,
  DEFAULT_GRADING_SCHEME_NAME,
} from "./grading.js";
import { DEFAULT_SUBJECTS } from "./subjects.js";

export async function applySchoolDefaults(
  tx: Prisma.TransactionClient,
  schoolId: string,
): Promise<void> {
  // Phase 1 / Slice 2 — the 14 standard Nigerian class levels (KG 1, KG 2,
  // Primary 1-6, JSS 1-3, SSS 1-3).
  await tx.classLevel.createMany({
    data: DEFAULT_CLASS_LEVELS.map((level) => ({
      schoolId,
      code: level.code,
      name: level.name,
      stage: level.stage,
      orderIndex: level.orderIndex,
    })),
    skipDuplicates: true,
  });

  // Give each seeded level one default arm ("JSS 1" -> "JSS 1A") so a
  // single-arm school (the common case for a Nigerian private school with one
  // stream per level) can enroll students immediately, with no separate
  // manual "create an arm" step first. createMany above doesn't return the
  // rows it inserted, so re-fetch ids by the codes we just used.
  const seededLevels = await tx.classLevel.findMany({
    where: { schoolId, code: { in: DEFAULT_CLASS_LEVELS.map((l) => l.code) } },
    select: { id: true, code: true, name: true },
  });
  await tx.classArm.createMany({
    data: seededLevels.map((level) => {
      const arm = defaultArmFor(level);
      return {
        schoolId,
        classLevelId: level.id,
        name: arm.name,
        code: arm.code,
      };
    }),
    skipDuplicates: true,
  });

  // A short, track-independent core subject catalogue (English Language,
  // Mathematics, Civic Education) — the only subjects that are both
  // WAEC-compulsory for every SSS track and the same subject at every level
  // from JSS through SSS. See DEFAULT_SUBJECTS for the candidates considered
  // and rejected. Bare catalogue entries only: no ClassSubject rows, so
  // linking subjects to levels stays a deliberate step in the class-subject
  // matrix UI.
  await tx.subject.createMany({
    data: DEFAULT_SUBJECTS.map((subject) => ({
      schoolId,
      code: subject.code,
      name: subject.name,
      category: subject.category,
    })),
    skipDuplicates: true,
  });

  // Phase 2 / Slice 1 — the school's single grading scheme, its three default
  // components (CA1/CA2/Exam = 20/20/60, sum 100) and the nine WAEC grade
  // boundaries (A1..F9). Upserted rather than created because we need the
  // scheme's id to attach components to.
  const gradingScheme = await tx.gradingScheme.upsert({
    where: { schoolId },
    update: {},
    create: { schoolId, name: DEFAULT_GRADING_SCHEME_NAME },
    select: { id: true },
  });
  await tx.gradingComponent.createMany({
    data: DEFAULT_GRADING_COMPONENTS.map((component) => ({
      schoolId,
      schemeId: gradingScheme.id,
      key: component.key,
      label: component.label,
      weight: component.weight,
      orderIndex: component.orderIndex,
    })),
    skipDuplicates: true,
  });
  await tx.gradeBoundary.createMany({
    data: DEFAULT_GRADE_BOUNDARIES.map((boundary) => ({
      schoolId,
      letter: boundary.letter,
      minScore: boundary.minScore,
      maxScore: boundary.maxScore,
      remark: boundary.remark,
      orderIndex: boundary.orderIndex,
    })),
    skipDuplicates: true,
  });
}
