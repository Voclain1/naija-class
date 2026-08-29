import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError, proposeAcademicCalendar, type SetupStepKey } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { AcademicCalendarService } from "../academic-calendar/academic-calendar.service.js";
import { AuthService } from "../auth/auth.service";
import { SetupStateService } from "./setup-state.service.js";

// Real Postgres, real RLS, real signup — same harness shape as
// academic-calendar.service.spec.ts, and for the same reason. The whole
// premise of SetupStateService is that its answers come from the tenant's
// actual rows, so a suite that mocked Prisma would be testing a hand-written
// restatement of the queries rather than the queries. Every school below is
// created through AuthService.signupOwner, which means every one of them
// also gets the real applySchoolDefaults() seeding — the thing that decides
// which steps are pre-ticked.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 100_000_000)
    .toString()
    .padStart(8, "0");
  return `+23481${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

describe("SetupStateService", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const calendarService = new AcademicCalendarService();
  const service = new SetupStateService();
  const schoolIdsToCleanup = new Set<string>();

  afterAll(async () => {
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  async function createSchool(suffix: string): Promise<AuthContext> {
    const signed = await authService.signupOwner(
      {
        schoolName: `Setup ${suffix}`,
        schoolSlug: `setup-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `setup-owner-${suffix}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    schoolIdsToCleanup.add(signed.school.id);
    await basePrisma.school.update({
      where: { id: signed.school.id },
      data: { status: "ACTIVE", onboardingStep: 5 },
    });
    return {
      sessionId: "sess",
      userId: signed.user.id,
      schoolId: signed.school.id,
    } as AuthContext;
  }

  // A school that has finished the wizard — i.e. has its calendar. This is
  // the normal starting point for every real school, so most cases below
  // build from it rather than from the calendar-less state.
  async function createSchoolWithCalendar(suffix: string): Promise<AuthContext> {
    const authCtx = await createSchool(suffix);
    const p = proposeAcademicCalendar(new Date(Date.UTC(2026, 9, 15)));
    await calendarService.createForSchool(
      authCtx,
      {
        yearLabel: p.yearLabel,
        yearStartDate: p.yearStartDate,
        yearEndDate: p.yearEndDate,
        terms: p.terms,
        currentTermSequence: p.currentTermSequence,
      },
      reqCtx,
    );
    return authCtx;
  }

  function step(state: Awaited<ReturnType<SetupStateService["getSetupState"]>>, key: SetupStepKey) {
    const found = state.steps.find((s) => s.key === key);
    if (!found) throw new Error(`no step ${key}`);
    return found;
  }

  // Adds one ACTIVE student and returns its id. Enrolment is deliberately
  // NOT done here — the gap between "has students" and "has enrolled
  // students" is the exact thing this service exists to make visible, so the
  // tests keep the two operations apart the same way the product does.
  async function addStudent(authCtx: AuthContext, suffix: string): Promise<string> {
    return withTenant(authCtx.schoolId, async (db) => {
      const created = await db.student.create({
        data: {
          schoolId: authCtx.schoolId,
          admissionNumber: `ADM-${runId}-${suffix}`,
          firstName: "Ada",
          lastName: "Obi",
          dateOfBirth: new Date("2012-04-01"),
          gender: "FEMALE",
        },
        select: { id: true },
      });
      return created.id;
    });
  }

  async function enrolStudent(authCtx: AuthContext, studentId: string): Promise<void> {
    await withTenant(authCtx.schoolId, async (db) => {
      const term = await db.term.findFirstOrThrow({ where: { isCurrent: true } });
      const arm = await db.classArm.findFirstOrThrow({ where: { isActive: true } });
      await db.enrollment.create({
        data: {
          schoolId: authCtx.schoolId,
          studentId,
          termId: term.id,
          academicYearId: term.academicYearId,
          classArmId: arm.id,
          status: "ENROLLED",
        },
      });
    });
  }

  // ── derivation: what a brand-new school is told ──────────────────────────

  it("a fresh school owes exactly the two required steps the wizard cannot do for it", async () => {
    const authCtx = await createSchoolWithCalendar("fresh");
    const state = await service.getSetupState(authCtx);

    // The calendar is already done — the wizard collected it — so the school
    // sees one required row already ticked. That is deliberate: "what is
    // already complete" is one of the questions this surface answers, and a
    // list where nothing is ticked answers it badly.
    expect(step(state, "academic-calendar").done).toBe(true);
    expect(step(state, "students").done).toBe(false);
    expect(step(state, "enrollments").done).toBe(false);
    expect(state.requiredRemaining).toBe(2);
    expect(state.nextStepKey).toBe("students");
    expect(state.status).toBe("setup");
    expect(state.hasRealActivity).toBe(false);
  });

  it("pre-ticks nothing that signup did not actually seed, and ticks nothing it did not do", async () => {
    const authCtx = await createSchoolWithCalendar("seeded");
    const state = await service.getSetupState(authCtx);

    // applySchoolDefaults seeds levels, arms, subjects and grading — none of
    // which are steps. What it does NOT seed is ClassSubject links, so that
    // optional step must be outstanding even though the subjects exist. This
    // is the assertion that would catch someone "helpfully" widening the
    // seed and silently changing what an owner is told.
    expect(step(state, "class-subjects").done).toBe(false);
    expect(state.alreadyDone.length).toBeGreaterThan(0);
    // And the seeded things are reported as done-for-you, not as chores.
    expect(state.steps.map((s) => s.key)).not.toContain("grading");
  });

  it("a school with no calendar at all reports the calendar step as the blocker", async () => {
    const authCtx = await createSchool("nocal");
    const state = await service.getSetupState(authCtx);

    expect(step(state, "academic-calendar").done).toBe(false);
    expect(state.nextStepKey).toBe("academic-calendar");
    expect(state.requiredRemaining).toBe(3);
  });

  // ── the finding this whole slice is about ────────────────────────────────

  it("students on the roster do NOT complete the enrolment step — the blocker moves, it does not disappear", async () => {
    const authCtx = await createSchoolWithCalendar("roster");
    const studentId = await addStudent(authCtx, "roster");

    const afterRoster = await service.getSetupState(authCtx);
    expect(step(afterRoster, "students").done).toBe(true);
    expect(step(afterRoster, "students").count).toBe(1);
    expect(step(afterRoster, "enrollments").done).toBe(false);
    expect(afterRoster.nextStepKey).toBe("enrollments");
    expect(afterRoster.requiredRemaining).toBe(1);

    await enrolStudent(authCtx, studentId);

    const afterEnrolment = await service.getSetupState(authCtx);
    expect(step(afterEnrolment, "enrollments").done).toBe(true);
    expect(step(afterEnrolment, "enrollments").count).toBe(1);
    expect(afterEnrolment.requiredRemaining).toBe(0);
  });

  // ── completion is never re-derived away ──────────────────────────────────

  it("a completed step stays completed across calls — nothing is stored, so nothing can drift", async () => {
    const authCtx = await createSchoolWithCalendar("stable");
    const studentId = await addStudent(authCtx, "stable");
    await enrolStudent(authCtx, studentId);

    const first = await service.getSetupState(authCtx);
    const second = await service.getSetupState(authCtx);

    expect(first.steps.map((s) => [s.key, s.done])).toEqual(
      second.steps.map((s) => [s.key, s.done]),
    );
    expect(second.requiredRemaining).toBe(0);
  });

  // ── suppression ──────────────────────────────────────────────────────────

  it("required work outstanding ⇒ status 'setup'; only recommended work left ⇒ 'finishing'", async () => {
    const authCtx = await createSchoolWithCalendar("finishing");
    const studentId = await addStudent(authCtx, "finishing");
    await enrolStudent(authCtx, studentId);

    const state = await service.getSetupState(authCtx);
    expect(state.requiredRemaining).toBe(0);
    expect(state.recommendedRemaining).toBeGreaterThan(0);
    expect(state.status).toBe("finishing");
  });

  // The established-school case. This is what stops the checklist becoming
  // permanent furniture for a school that has deliberately skipped, say,
  // fees — and it is derived from a real workflow row, not from a dismissal.
  it("real activity ends the setup UI even with recommended steps outstanding", async () => {
    const authCtx = await createSchoolWithCalendar("established");
    const studentId = await addStudent(authCtx, "established");
    await enrolStudent(authCtx, studentId);

    await withTenant(authCtx.schoolId, async (db) => {
      const term = await db.term.findFirstOrThrow({ where: { isCurrent: true } });
      const arm = await db.classArm.findFirstOrThrow({ where: { isActive: true } });
      await db.attendanceRecord.create({
        data: {
          schoolId: authCtx.schoolId,
          studentId,
          classArmId: arm.id,
          termId: term.id,
          date: new Date("2026-10-15"),
          status: "PRESENT",
          markedBy: authCtx.userId,
        },
      });
    });

    const state = await service.getSetupState(authCtx);
    expect(state.hasRealActivity).toBe(true);
    expect(state.recommendedRemaining).toBeGreaterThan(0);
    expect(state.status).toBe("established");
  });

  // The exception to the rule above, and the reason the rule is not just
  // "activity wins". A school missing a required step is told so however
  // busy it looks.
  it("but a missing REQUIRED step overrides real activity", async () => {
    const authCtx = await createSchoolWithCalendar("busy-broken");
    const studentId = await addStudent(authCtx, "busy-broken");
    await enrolStudent(authCtx, studentId);
    await withTenant(authCtx.schoolId, async (db) => {
      await db.invoice.count(); // no-op read, keeps the tenant client warm
      // Un-set the current term: the school now has activity AND a missing
      // required step.
      await db.term.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
      const term = await db.term.findFirstOrThrow({ where: { sequence: 1 } });
      const arm = await db.classArm.findFirstOrThrow({ where: { isActive: true } });
      await db.attendanceRecord.create({
        data: {
          schoolId: authCtx.schoolId,
          studentId,
          classArmId: arm.id,
          termId: term.id,
          date: new Date("2026-10-16"),
          status: "PRESENT",
          markedBy: authCtx.userId,
        },
      });
    });

    const state = await service.getSetupState(authCtx);
    expect(state.hasRealActivity).toBe(true);
    expect(step(state, "academic-calendar").done).toBe(false);
    expect(state.status).toBe("setup");
  });

  // ── tiering ──────────────────────────────────────────────────────────────

  // Guards the distinction the audit finding turns on. If a future change
  // promotes one of these to "required", a fresh school starts being told
  // it cannot operate until it has priced its fees or invited a teacher —
  // neither of which is true, and both of which this list is supposed to
  // stop claiming.
  it("keeps fees, staff and the subject matrix off the required list", async () => {
    const authCtx = await createSchoolWithCalendar("tiers");
    const state = await service.getSetupState(authCtx);

    expect(step(state, "fee-catalog").tier).toBe("recommended");
    expect(step(state, "staff").tier).toBe("recommended");
    expect(step(state, "form-teachers").tier).toBe("recommended");
    expect(step(state, "teacher-assignments").tier).toBe("recommended");
    expect(step(state, "class-subjects").tier).toBe("optional");
    expect(step(state, "guardians").tier).toBe("optional");

    expect(state.steps.filter((s) => s.tier === "required").map((s) => s.key)).toEqual([
      "academic-calendar",
      "students",
      "enrollments",
    ]);
  });

  // ── action links ─────────────────────────────────────────────────────────

  it("every step points at a route that exists in apps/web", async () => {
    const authCtx = await createSchoolWithCalendar("routes");
    const state = await service.getSetupState(authCtx);

    // Pinned literals rather than a filesystem walk: these are the routes an
    // owner is sent to, and a typo in one is a dead end that no type check
    // would catch. Cross-checked against apps/web/src/app on 2026-08-29.
    const expected: Record<SetupStepKey, string> = {
      "academic-calendar": "/settings/academic/years",
      students: "/students",
      enrollments: "/enrollments",
      "fee-catalog": "/finance/fees",
      staff: "/staff",
      "form-teachers": "/settings/academic/class-arms",
      "teacher-assignments": "/staff",
      "class-subjects": "/settings/academic/class-subjects",
      guardians: "/guardians/import",
    };
    for (const s of state.steps) {
      expect(s.href).toBe(expected[s.key]);
      expect(s.actionLabel.length).toBeGreaterThan(0);
      expect(s.why.length).toBeGreaterThan(0);
    }
    for (const item of state.alreadyDone) {
      expect(item.href.startsWith("/")).toBe(true);
    }
  });

  // ── role gate ────────────────────────────────────────────────────────────

  // The list is entirely owner/admin actions. A bursar or teacher shown
  // "invite your teachers" would be handed a button that 403s, which is the
  // misleading-navigation failure this slice exists to remove — so the data
  // never reaches them in the first place.
  it("refuses a non-owner/non-admin caller", async () => {
    const authCtx = await createSchoolWithCalendar("roles");

    const bursarCtx = await withTenant(authCtx.schoolId, async (db) => {
      const bursarRole = await db.role.findFirstOrThrow({ where: { key: "bursar" } });
      const user = await db.user.create({
        data: {
          schoolId: authCtx.schoolId,
          email: `setup-bursar-${runId}@example.test`,
          phone: randomPhone(),
          firstName: "Bisi",
          lastName: "Bursar",
          passwordHash: "x",
          isActive: true,
        },
        select: { id: true },
      });
      await db.userRole.create({ data: { userId: user.id, roleId: bursarRole.id } });
      return { sessionId: "sess", userId: user.id, schoolId: authCtx.schoolId } as AuthContext;
    });

    await expect(service.getSetupState(bursarCtx)).rejects.toBeInstanceOf(ForbiddenError);
  });

  // ── tenancy ──────────────────────────────────────────────────────────────

  // Two schools at different stages must not see each other's progress. The
  // service reads through withTenant, so this is really a check that no
  // count escaped the tenant client.
  it("does not leak another school's progress", async () => {
    const busy = await createSchoolWithCalendar("tenant-a");
    const quiet = await createSchoolWithCalendar("tenant-b");
    const studentId = await addStudent(busy, "tenant-a");
    await enrolStudent(busy, studentId);

    const quietState = await service.getSetupState(quiet);
    expect(step(quietState, "students").done).toBe(false);
    expect(step(quietState, "students").count).toBe(0);
    expect(step(quietState, "enrollments").count).toBe(0);
  });
});
