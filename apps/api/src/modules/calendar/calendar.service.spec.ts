import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError, NotFoundError, UnauthorizedError, type CalendarEntryDto } from "@school-kit/types";

import type { AuthContext } from "../../common/auth/auth-context";
import { PermissionsGuard } from "../../common/auth/permissions.guard";
import { AuthService } from "../auth/auth.service";
import { CalendarController } from "./calendar.controller";
import { CalendarService } from "./calendar.service";

// Phase 8 / CP1 — CalendarService against a REAL Postgres, real roles and the
// REAL @Permissions metadata off CalendarController. docs/modules/phase-8.md §15.4.
//
// Same harness shape as bursar-scope.spec.ts: guard.canActivate() is the code
// path PermissionsGuard runs in production, so a rejection here is the 403 a
// real request would get. The service's own role assertion is exercised
// separately, because the two gates are independent (rbac-two-gate).

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 100_000_000)
    .toString()
    .padStart(8, "0");
  return `+23487${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeCtx(handler: (...args: any[]) => unknown, user: AuthContext): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => CalendarController,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const WINDOW = { from: "2026-09-01", to: "2026-12-31" };

describe("CalendarService (Phase 8 CP1) — real database", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1" };
  const service = new CalendarService();
  const guard = new PermissionsGuard(new Reflector());
  const schoolIds: string[] = [];

  let a: { schoolId: string; owner: AuthContext; teacher: AuthContext; bursar: AuthContext };
  let b: { schoolId: string; owner: AuthContext };
  let christmasId: string;

  async function createSchool(suffix: string): Promise<{ schoolId: string; owner: AuthContext }> {
    const signed = await new AuthService().signupOwner(
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
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    );
    schoolIds.push(signed.school.id);
    return {
      schoolId: signed.school.id,
      owner: { sessionId: "sess", userId: signed.user.id, schoolId: signed.school.id } as AuthContext,
    };
  }

  async function createStaff(schoolId: string, roleKey: "teacher" | "bursar", suffix: string): Promise<AuthContext> {
    return withTenant(schoolId, async (db) => {
      const u = await db.user.create({
        data: {
          schoolId,
          firstName: "Staff",
          lastName: roleKey,
          email: `cal-${roleKey}-${suffix}-${runId}@example.test`,
          phone: randomPhone(),
          passwordHash: "argon2id$placeholder",
        },
        select: { id: true },
      });
      const role = await db.role.findFirst({ where: { schoolId: null, key: roleKey, isSystem: true }, select: { id: true } });
      if (!role) throw new Error(`system role '${roleKey}' not seeded`);
      await db.userRole.create({ data: { userId: u.id, roleId: role.id } });
      return { sessionId: "sess", userId: u.id, schoolId } as AuthContext;
    });
  }

  async function addTerm(schoolId: string): Promise<void> {
    await withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: {
          schoolId,
          label: `CAL-${runId}`,
          startDate: new Date("2026-09-14T00:00:00Z"),
          endDate: new Date("2027-07-23T00:00:00Z"),
        },
        select: { id: true },
      });
      await db.term.create({
        data: {
          schoolId,
          academicYearId: year.id,
          sequence: 1,
          name: "First Term",
          startDate: new Date("2026-09-14T00:00:00Z"),
          endDate: new Date("2026-12-11T00:00:00Z"),
        },
      });
    });
  }

  beforeAll(async () => {
    const sa = await createSchool("a");
    a = {
      ...sa,
      teacher: await createStaff(sa.schoolId, "teacher", "a"),
      bursar: await createStaff(sa.schoolId, "bursar", "a"),
    };
    b = await createSchool("b");
    await addTerm(a.schoolId);

    const christmas = await basePrisma.nationalEvent.findUnique({ where: { key: "christmas-day-2026" }, select: { id: true } });
    if (!christmas) throw new Error("seed missing: christmas-day-2026");
    christmasId = christmas.id;
  });

  afterAll(async () => {
    for (const id of schoolIds) {
      await withTenant(id, async (db) => {
        await db.schoolHiddenNationalEvent.deleteMany({ where: { schoolId: id } });
        await db.schoolEvent.deleteMany({ where: { schoolId: id } });
      }).catch(() => undefined);
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
  });

  const titles = (entries: CalendarEntryDto[]) => entries.map((e) => e.title);

  // -------------------------------------------------------------------------
  // The merged read (D27).
  // -------------------------------------------------------------------------

  describe("buildCalendar", () => {
    beforeAll(async () => {
      // Window edges, in school A.
      for (const [title, startDate, endDate] of [
        [`overlaps-from ${runId}`, "2026-08-28", "2026-09-02"], // starts before `from`, still happening → IN
        [`starts-on-to ${runId}`, "2026-12-31", "2027-01-02"], // starts on `to` → IN
        [`ends-before-from ${runId}`, "2026-08-01", "2026-08-31"], // ends the day before `from` → OUT
        [`after-to ${runId}`, "2027-01-01", "2027-01-01"], // starts the day after `to` → OUT
        [`sports day ${runId}`, "2026-10-16", "2026-10-16"],
      ] as const) {
        await service.createSchoolEvent(a.owner, { title, category: "EVENT", startDate, endDate }, reqCtx);
      }
      await service.createSchoolEvent(
        b.owner,
        { title: `B only ${runId}`, category: "MEETING", startDate: "2026-10-16", endDate: "2026-10-16" },
        reqCtx,
      );
      await service.hideNationalEvent(a.owner, christmasId, reqCtx);
    });

    it("includes an event that overlaps the window, and excludes ones that do not", async () => {
      const t = titles(await withTenant(a.schoolId, (db) => service.buildCalendar(db, a.schoolId, WINDOW)));
      expect(t).toContain(`overlaps-from ${runId}`);
      expect(t).toContain(`starts-on-to ${runId}`);
      expect(t).not.toContain(`ends-before-from ${runId}`);
      expect(t).not.toContain(`after-to ${runId}`);
    });

    it("never returns another school's events", async () => {
      const aEntries = await withTenant(a.schoolId, (db) => service.buildCalendar(db, a.schoolId, WINDOW));
      const bEntries = await withTenant(b.schoolId, (db) => service.buildCalendar(db, b.schoolId, WINDOW));
      expect(titles(aEntries)).not.toContain(`B only ${runId}`);
      expect(titles(bEntries)).toContain(`B only ${runId}`);
      expect(titles(bEntries)).not.toContain(`sports day ${runId}`);
    });

    it("omits a national event this school hid — and only for this school", async () => {
      const aEntries = await withTenant(a.schoolId, (db) => service.buildCalendar(db, a.schoolId, WINDOW));
      const bEntries = await withTenant(b.schoolId, (db) => service.buildCalendar(db, b.schoolId, WINDOW));
      expect(titles(aEntries)).not.toContain("Christmas Day");
      expect(titles(aEntries)).toContain("Boxing Day");
      expect(titles(bEntries)).toContain("Christmas Day");
    });

    it("derives term boundaries from Term rows, as single-day TERM entries", async () => {
      const entries = await withTenant(a.schoolId, (db) => service.buildCalendar(db, a.schoolId, WINDOW));
      const begins = entries.find((e) => e.category === "TERM_START");
      const ends = entries.find((e) => e.category === "TERM_END");
      expect(begins).toMatchObject({
        source: "TERM",
        title: `First Term (CAL-${runId}) begins`,
        startDate: "2026-09-14",
        endDate: "2026-09-14",
      });
      expect(ends).toMatchObject({ source: "TERM", startDate: "2026-12-11", endDate: "2026-12-11" });
      // School B has no terms, so no term entries.
      const bEntries = await withTenant(b.schoolId, (db) => service.buildCalendar(db, b.schoolId, WINDOW));
      expect(bEntries.some((e) => e.source === "TERM")).toBe(false);
    });

    it("sorts by date, then national → term → school within a day, and ids never collide", async () => {
      const entries = await withTenant(a.schoolId, (db) => service.buildCalendar(db, a.schoolId, WINDOW));
      const dates = entries.map((e) => e.startDate);
      expect([...dates].sort()).toEqual(dates);
      expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
      expect(entries.every((e) => /^(school|national|term-start|term-end):/.test(e.id))).toBe(true);
    });

    it("marks an unconfirmed national event (a 2027 Eid estimate) as dateConfirmed: false", async () => {
      const entries = await withTenant(a.schoolId, (db) =>
        service.buildCalendar(db, a.schoolId, { from: "2027-03-01", to: "2027-03-31" }),
      );
      expect(entries.find((e) => e.title === "Eid-el-Fitr")).toMatchObject({
        source: "NATIONAL",
        startDate: "2027-03-09",
        endDate: "2027-03-10",
        dateConfirmed: false,
      });
      expect(entries.find((e) => e.title === "Good Friday")).toMatchObject({ dateConfirmed: true });
    });

    it("staff, guardian and student reads return the identical calendar for the same school (one builder)", async () => {
      const staff = await service.getStaffCalendar(a.owner, WINDOW);
      const guardian = await service.getGuardianCalendar(a.schoolId, WINDOW);
      const student = await service.getStudentCalendar(a.schoolId, WINDOW);
      expect(guardian).toEqual(staff);
      expect(student).toEqual(staff);
      expect(titles(staff.entries)).toContain(`sports day ${runId}`);
    });
  });

  // -------------------------------------------------------------------------
  // Management (D25, D26, D28).
  // -------------------------------------------------------------------------

  describe("management", () => {
    it("owner creates an event, and exactly one tenant-scoped audit row records it", async () => {
      const created = await service.createSchoolEvent(
        a.owner,
        { title: `PTA ${runId}`, category: "MEETING", startDate: "2026-11-05", endDate: "2026-11-05" },
        reqCtx,
      );
      const audits = await withTenant(a.schoolId, (db) =>
        db.auditLog.findMany({
          where: { action: "calendar-event.create", entityId: created.id },
          select: { schoolId: true, userId: true, metadata: true },
        }),
      );
      expect(audits).toHaveLength(1);
      expect(audits[0].schoolId).toBe(a.schoolId);
      expect(audits[0].userId).toBe(a.owner.userId);
      expect(audits[0].metadata).toMatchObject({ title: `PTA ${runId}`, startDate: "2026-11-05" });
    });

    it("updating or deleting another school's event by id is a 404, and the event is untouched", async () => {
      const aEvent = await service.createSchoolEvent(
        a.owner,
        { title: `A private ${runId}`, category: "OTHER", startDate: "2026-11-06", endDate: "2026-11-06" },
        reqCtx,
      );
      await expect(service.updateSchoolEvent(b.owner, aEvent.id, { title: "hijacked" }, reqCtx)).rejects.toBeInstanceOf(
        NotFoundError,
      );
      await expect(service.deleteSchoolEvent(b.owner, aEvent.id, reqCtx)).rejects.toBeInstanceOf(NotFoundError);
      const still = await service.listSchoolEvents(a.owner, { from: "2026-11-06", to: "2026-11-06" });
      expect(still.find((e) => e.id === aEvent.id)?.title).toBe(`A private ${runId}`);
    });

    it("update and delete work for the owning school and are audited", async () => {
      const e = await service.createSchoolEvent(
        a.owner,
        { title: `Mid-term ${runId}`, category: "BREAK", startDate: "2026-10-26", endDate: "2026-10-30" },
        reqCtx,
      );
      const updated = await service.updateSchoolEvent(
        a.owner,
        e.id,
        { startDate: "2026-10-27", endDate: "2026-10-31" },
        reqCtx,
      );
      expect(updated).toMatchObject({ startDate: "2026-10-27", endDate: "2026-10-31", category: "BREAK" });
      await service.deleteSchoolEvent(a.owner, e.id, reqCtx);
      const actions = await withTenant(a.schoolId, (db) =>
        db.auditLog.findMany({ where: { entityId: e.id }, select: { action: true }, orderBy: { createdAt: "asc" } }),
      );
      expect(actions.map((x) => x.action)).toEqual([
        "calendar-event.create",
        "calendar-event.update",
        "calendar-event.delete",
      ]);
    });

    it("hide is idempotent and audited once; unhide restores the event", async () => {
      const boxing = await basePrisma.nationalEvent.findUnique({ where: { key: "boxing-day-2026" }, select: { id: true } });
      await service.hideNationalEvent(b.owner, boxing!.id, reqCtx);
      await service.hideNationalEvent(b.owner, boxing!.id, reqCtx); // no-op

      const listed = await service.listNationalEvents(b.owner, WINDOW);
      expect(listed.find((n) => n.id === boxing!.id)?.hidden).toBe(true); // still listed for management, flagged
      expect(titles((await service.getGuardianCalendar(b.schoolId, WINDOW)).entries)).not.toContain("Boxing Day");

      await service.unhideNationalEvent(b.owner, boxing!.id, reqCtx);
      await service.unhideNationalEvent(b.owner, boxing!.id, reqCtx); // no-op
      expect(titles((await service.getGuardianCalendar(b.schoolId, WINDOW)).entries)).toContain("Boxing Day");

      const audits = await withTenant(b.schoolId, (db) =>
        db.auditLog.findMany({ where: { entityId: boxing!.id, schoolId: b.schoolId }, select: { action: true } }),
      );
      expect(audits.map((x) => x.action).sort()).toEqual(["national-event.hide", "national-event.unhide"]);
    });

    it("hiding a nonexistent national event is a 404", async () => {
      await expect(
        service.hideNationalEvent(a.owner, "00000000-0000-0000-0000-000000000000", reqCtx),
      ).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  // -------------------------------------------------------------------------
  // Both authorization gates (D28).
  // -------------------------------------------------------------------------

  describe("authorization", () => {
    it("teacher and bursar pass the guard for GET /calendar — the calendar is visible to all staff (D4)", async () => {
      for (const who of [a.teacher, a.bursar, a.owner]) {
        await expect(guard.canActivate(makeCtx(CalendarController.prototype.calendar, who))).resolves.toBe(true);
      }
    });

    it("teacher and bursar are refused by the guard for every write route", async () => {
      const writes = [
        CalendarController.prototype.createEvent,
        CalendarController.prototype.updateEvent,
        CalendarController.prototype.deleteEvent,
        CalendarController.prototype.hide,
        CalendarController.prototype.unhide,
      ];
      for (const who of [a.teacher, a.bursar]) {
        for (const handler of writes) {
          await expect(guard.canActivate(makeCtx(handler, who)), handler.name).rejects.toBeInstanceOf(ForbiddenError);
        }
      }
    });

    it("the service's own role gate also refuses teacher and bursar writes (independent second gate)", async () => {
      for (const who of [a.teacher, a.bursar]) {
        await expect(
          service.createSchoolEvent(
            who,
            { title: "nope", category: "OTHER", startDate: "2026-11-10", endDate: "2026-11-10" },
            reqCtx,
          ),
        ).rejects.toBeInstanceOf(ForbiddenError);
        await expect(service.hideNationalEvent(who, christmasId, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
      }
    });

    it("a deactivated owner cannot write (the isActive half of the gate is never dropped)", async () => {
      const c = await createSchool("inactive");
      await withTenant(c.schoolId, (db) => db.user.update({ where: { id: c.owner.userId }, data: { isActive: false } }));
      await expect(
        service.createSchoolEvent(
          c.owner,
          { title: "nope", category: "OTHER", startDate: "2026-11-10", endDate: "2026-11-10" },
          reqCtx,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedError);
    });
  });
});
