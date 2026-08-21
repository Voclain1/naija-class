import { afterAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, ForbiddenError, proposeAcademicCalendar } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { AuthService } from "../auth/auth.service";
import { AcademicCalendarService } from "./academic-calendar.service.js";

// Real Postgres, real RLS, real roles — same harness shape as
// bursar-scope.spec.ts. The point of this suite is the INVARIANTS, not the
// happy path: #198 exists because half-built calendars are as unusable as
// missing ones, and the production census found 11 of 42 schools in exactly
// that half-built state (years, but no current term).

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 100_000_000)
    .toString()
    .padStart(8, "0");
  return `+23487${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

describe("AcademicCalendarService", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const service = new AcademicCalendarService();
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
        schoolName: `Calendar ${suffix}`,
        schoolSlug: `cal-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `cal-owner-${suffix}-${runId}@example.test`,
        ownerPhone: randomPhone(),
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      reqCtx,
    );
    schoolIdsToCleanup.add(signed.school.id);
    return {
      sessionId: "sess",
      userId: signed.user.id,
      schoolId: signed.school.id,
    } as AuthContext;
  }

  function calendarInput() {
    const p = proposeAcademicCalendar(new Date(Date.UTC(2026, 9, 15)));
    return {
      yearLabel: p.yearLabel,
      yearStartDate: p.yearStartDate,
      yearEndDate: p.yearEndDate,
      terms: p.terms,
      currentTermSequence: p.currentTermSequence,
    };
  }

  it("creates a year and exactly three terms, with exactly one current term", async () => {
    const authCtx = await createSchool("happy");
    const res = await service.createForSchool(authCtx, calendarInput(), reqCtx);

    expect(res.academicYearId).toBeTruthy();
    expect(res.currentTermId).toBeTruthy();

    const state = await withTenant(authCtx.schoolId, async (db) => ({
      years: await db.academicYear.count(),
      currentYears: await db.academicYear.count({ where: { isCurrent: true } }),
      terms: await db.term.count(),
      currentTerms: await db.term.count({ where: { isCurrent: true } }),
    }));

    expect(state).toEqual({ years: 1, currentYears: 1, terms: 3, currentTerms: 1 });
  });

  // The census's own predicate. A school that passes this is, by definition,
  // no longer in the stuck population.
  it("moves the school out of the 'needs calendar' state", async () => {
    const authCtx = await createSchool("status");
    await expect(service.getCalendarStatus(authCtx)).resolves.toEqual({ needsCalendar: true });
    await service.createForSchool(authCtx, calendarInput(), reqCtx);
    await expect(service.getCalendarStatus(authCtx)).resolves.toEqual({ needsCalendar: false });
  });

  it("refuses to run twice — a second calendar is an edit, not a bootstrap", async () => {
    const authCtx = await createSchool("twice");
    await service.createForSchool(authCtx, calendarInput(), reqCtx);
    await expect(service.createForSchool(authCtx, calendarInput(), reqCtx)).rejects.toBeInstanceOf(
      ConflictError,
    );

    // And the refusal left nothing behind.
    const state = await withTenant(authCtx.schoolId, async (db) => ({
      years: await db.academicYear.count(),
      terms: await db.term.count(),
    }));
    expect(state).toEqual({ years: 1, terms: 3 });
  });

  // Atomicity. If the terms fail, the year must not survive — a year with no
  // terms is one of the exact half-built states #198 is about, and it would
  // additionally trip the "already has a year" guard above, locking the
  // school out of its own recovery path permanently.
  it("rolls the year back when a term write fails", async () => {
    const authCtx = await createSchool("atomic");
    const bad = calendarInput();
    // Duplicate sequence → violates Term's @@unique([academicYearId, sequence])
    // on the SECOND insert, after the year and first term are already written.
    // The schema would normally reject this before the service ever sees it
    // (see the dto spec's "rejects duplicate term sequences"); we bypass it
    // deliberately, because what is under test here is the transaction
    // boundary, not the validation in front of it.
    //
    // An over-long name was the first attempt and does NOT work: Prisma
    // `String` maps to Postgres TEXT, which has no length limit.
    bad.terms = bad.terms.map((t, i) => (i === 2 ? { ...t, sequence: 2 as const } : t));

    await expect(service.createForSchool(authCtx, bad, reqCtx)).rejects.toBeTruthy();

    const state = await withTenant(authCtx.schoolId, async (db) => ({
      years: await db.academicYear.count(),
      terms: await db.term.count(),
    }));
    expect(state).toEqual({ years: 0, terms: 0 });

    // Still recoverable — the guard did not latch on a phantom year.
    await expect(service.createForSchool(authCtx, calendarInput(), reqCtx)).resolves.toBeTruthy();
  });

  it("writes exactly one audit row for the calendar", async () => {
    const authCtx = await createSchool("audit");
    await service.createForSchool(authCtx, calendarInput(), reqCtx);
    const rows = await withTenant(authCtx.schoolId, (db) =>
      db.auditLog.count({ where: { action: "academic-calendar.create" } }),
    );
    expect(rows).toBe(1);
  });

  // Being blocked by a missing calendar is not authority to define it.
  it("refuses a user without an owner/admin grant", async () => {
    const authCtx = await createSchool("rbac");
    const bursarCtx = await withTenant(authCtx.schoolId, async (db) => {
      const u = await db.user.create({
        data: {
          schoolId: authCtx.schoolId,
          firstName: "Betty",
          lastName: "Bursar",
          email: `cal-bursar-${runId}@example.test`,
          phone: randomPhone(),
          passwordHash: "argon2id$placeholder",
        },
        select: { id: true },
      });
      const role = await db.role.findFirst({
        where: { schoolId: null, key: "bursar", isSystem: true },
        select: { id: true },
      });
      if (!role) throw new Error("system role 'bursar' not seeded — run pnpm db:seed");
      await db.userRole.create({ data: { userId: u.id, roleId: role.id } });
      return { sessionId: "s", userId: u.id, schoolId: authCtx.schoolId } as AuthContext;
    });

    await expect(
      service.createForSchool(bursarCtx, calendarInput(), reqCtx),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  // The calendar has to actually unblock the thing it exists to unblock.
  // resolveTermForDate() ignores isCurrent and matches purely on date range,
  // so this asserts the created rows satisfy the OTHER definition of
  // "current term" too — the divergence flagged in the plan-first §7.
  it("produces a term whose date range contains the day it was proposed for", async () => {
    const authCtx = await createSchool("daterange");
    const today = new Date(Date.UTC(2026, 9, 15));
    const p = proposeAcademicCalendar(today);
    expect(p.currentTermContainsToday).toBe(true);

    await service.createForSchool(
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

    const match = await withTenant(authCtx.schoolId, (db) =>
      db.term.findFirst({
        where: { startDate: { lte: today }, endDate: { gte: today } },
        select: { id: true, isCurrent: true },
      }),
    );
    expect(match).not.toBeNull();
    // Both definitions agree, which is what makes attendance work on day one.
    expect(match?.isCurrent).toBe(true);
  });
});
