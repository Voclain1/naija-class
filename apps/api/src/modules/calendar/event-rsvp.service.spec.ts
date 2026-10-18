import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { answerRsvpSchema, ConflictError, ForbiddenError, NotFoundError, sickbayDayOf, ValidationError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import type { EventNotification } from "../notifications/notification-dispatch.service";
import { CalendarService } from "./calendar.service";
import { EventRsvpService } from "./event-rsvp.service";

// Phase 9 / CP10.1 — event RSVPs (docs/modules/phase-9.md §19.2), against
// real Postgres. The rules: only the parents asked (the whole school or the
// chosen classes, never a switched-off parent) can answer; one answer each,
// changeable until the reply-by date; a parent sees only their own; the
// counts add up; the reminder goes once, to those who have not answered.

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const DAY_MS = 24 * 60 * 60 * 1000;
const lagos = (offsetDays: number) => sickbayDayOf(new Date(Date.now() + offsetDays * DAY_MS));

function ctx(schoolId: string, userId: string) {
  return { sessionId: `sess-${runId}`, schoolId, userId };
}

class FakeDispatch {
  calls: EventNotification[] = [];
  async notifyOfEvent(req: EventNotification) {
    this.calls.push(req);
    return "PUSH" as const;
  }
}

describe("Event RSVPs (integration)", () => {
  const dispatch = new FakeDispatch();
  const calendar = new CalendarService();
  const rsvps = new EventRsvpService(dispatch as never);
  const schoolIds = new Set<string>();
  let A: {
    schoolId: string;
    ownerId: string;
    teacherId: string;
    armA: string;
    armB: string;
    gA: string; // child in arm A
    gB: string; // child in arm B
    gBoth: string; // children in both arms
    gOff: string; // portal switched off, child in arm A
  };
  let B: { schoolId: string; ownerId: string; guardianId: string };

  async function makeSchool(label: string) {
    const s = await new AuthService().signupOwner(
      {
        schoolName: `RSVP ${label} ${runId}`,
        schoolSlug: `rsvp-${label}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `rsvp-${label}-${runId}@example.test`,
        ownerPhone: `+23495${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    );
    schoolIds.add(s.school.id);
    await basePrisma.school.update({ where: { id: s.school.id }, data: { status: "ACTIVE", onboardingStep: 5 } });
    return { schoolId: s.school.id, ownerId: s.user.id };
  }

  async function seedFamilies(schoolId: string, label: string) {
    return withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({ data: { schoolId, label: `Y-${label}-${runId}`, startDate: day("2025-09-01"), endDate: day("2099-07-31") } });
      const term = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 1, name: "Now", startDate: day("2025-09-01"), endDate: day("2098-12-31"), isCurrent: true },
      });
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" } });
      const armA = await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "JSS1A", code: `ra-${label}-${runId}` } });
      const armB = await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "JSS1B", code: `rb-${label}-${runId}` } });
      let n = 0;
      const child = async (armId: string) => {
        n += 1;
        const s = await db.student.create({
          data: { schoolId, admissionNumber: `R-${label}-${n}-${runId}`, firstName: `Child${n}`, lastName: "Bello", dateOfBirth: day("2013-01-01"), gender: "MALE" },
        });
        await db.enrollment.create({ data: { schoolId, studentId: s.id, termId: term.id, academicYearId: year.id, classArmId: armId } });
        return s.id;
      };
      const parent = async (first: string, studentIds: string[], extra: { portalDisabledAt?: Date } = {}) => {
        const g = await db.guardian.create({ data: { schoolId, firstName: first, lastName: "Bello", relationship: "FATHER", phone: `0806${String(n).padStart(7, "0")}`, ...extra } });
        for (const studentId of studentIds) await db.studentGuardian.create({ data: { schoolId, studentId, guardianId: g.id, isPrimary: true } });
        return g.id;
      };
      const a1 = await child(armA.id);
      const b1 = await child(armB.id);
      const a2 = await child(armA.id);
      const b2 = await child(armB.id);
      const a3 = await child(armA.id);
      const teacher = await db.user.create({ data: { schoolId, email: `rsvp-t-${label}-${runId}@example.test`, firstName: "Tola", lastName: "Teacher" } });
      const role = await db.role.findFirstOrThrow({ where: { key: "teacher" }, select: { id: true } });
      await db.userRole.create({ data: { userId: teacher.id, roleId: role.id } });
      return {
        armA: armA.id,
        armB: armB.id,
        teacherId: teacher.id,
        gA: await parent("Ade", [a1]),
        gB: await parent("Bayo", [b1]),
        gBoth: await parent("Chidi", [a2, b2]),
        gOff: await parent("Dele", [a3], { portalDisabledAt: new Date() }),
      };
    });
  }

  beforeAll(async () => {
    const a = await makeSchool("a");
    A = { ...a, ...(await seedFamilies(a.schoolId, "a")) };
    const b = await makeSchool("b");
    const fb = await seedFamilies(b.schoolId, "b");
    B = { ...b, guardianId: fb.gA };
  });

  beforeEach(() => {
    dispatch.calls = [];
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  const g = (guardianId: string, schoolId = A.schoolId) => ({ sessionId: "gs", schoolId, guardianId });
  const event = (rsvp: { deadline?: string | null; askCount?: boolean; classArmIds?: string[] } | null, start = lagos(10)) =>
    calendar.createSchoolEvent(
      ctx(A.schoolId, A.ownerId),
      {
        title: `Sports day ${Math.random().toString(36).slice(2, 6)}`,
        description: null,
        category: "EVENT",
        startDate: start,
        endDate: start,
        rsvp: rsvp ? { deadline: rsvp.deadline ?? null, askCount: rsvp.askCount ?? false, classArmIds: rsvp.classArmIds ?? [] } : null,
      },
      reqCtx,
    );
  const familyView = async (guardianId: string, eventId: string) => {
    const cal = await calendar.getGuardianCalendar(A.schoolId, { from: lagos(-1), to: lagos(30) }, guardianId);
    return cal.entries.find((e) => e.id === `school:${eventId}`);
  };

  it("a class event asks only that class's parents, never a switched-off parent", async () => {
    const e = await event({ classArmIds: [A.armA] });
    expect(e.rsvp).toMatchObject({ classArmIds: [A.armA], counts: { asked: 2, notAnswered: 2 } }); // gA and gBoth
    expect((await familyView(A.gA, e.id))?.rsvp).toMatchObject({ open: true, answer: null });
    expect((await familyView(A.gBoth, e.id))?.rsvp).toBeTruthy();
    expect((await familyView(A.gB, e.id))?.rsvp).toBeUndefined();
    await expect(rsvps.answer(g(A.gB), e.id, { answer: "YES", attending: null }, reqCtx)).rejects.toBeInstanceOf(NotFoundError);
    await expect(rsvps.answer(g(A.gOff), e.id, { answer: "YES", attending: null }, reqCtx)).rejects.toBeInstanceOf(NotFoundError);
    const list = await rsvps.list(ctx(A.schoolId, A.ownerId), e.id);
    expect(list.rows.map((r) => r.guardianId).sort()).toEqual([A.gA, A.gBoth].sort());
  });

  it("one answer per parent, changeable; counts add up; numbers coming only when asked", async () => {
    const e = await event({ askCount: true });
    expect(e.rsvp!.counts.asked).toBe(3);
    await rsvps.answer(g(A.gA), e.id, { answer: "YES", attending: 3 }, reqCtx);
    await rsvps.answer(g(A.gB), e.id, { answer: "MAYBE", attending: 2 }, reqCtx);
    await rsvps.answer(g(A.gBoth), e.id, { answer: "NO", attending: null }, reqCtx);
    let list = await rsvps.list(ctx(A.schoolId, A.ownerId), e.id);
    expect(list.counts).toEqual({ asked: 3, yes: 1, no: 1, maybe: 1, notAnswered: 0, attending: 3, maybeAttending: 2 });
    // Changing an answer replaces it.
    await rsvps.answer(g(A.gBoth), e.id, { answer: "YES", attending: 2 }, reqCtx);
    list = await rsvps.list(ctx(A.schoolId, A.ownerId), e.id);
    expect(list.counts).toMatchObject({ yes: 2, no: 0, attending: 5 });
    expect(list.rows.find((r) => r.guardianId === A.gBoth)).toMatchObject({ answer: "YES", attending: 2, children: [expect.any(Object), expect.any(Object)] });

    // Without "how many", the number is not kept.
    const plain = await event({});
    const mine = await rsvps.answer(g(A.gA), plain.id, { answer: "YES", attending: 4 }, reqCtx);
    expect(mine.attending).toBeNull();
    expect(answerRsvpSchema.safeParse({ answer: "NO", attending: 2 }).success).toBe(false);
  });

  it("a parent sees only their own answer", async () => {
    const e = await event({});
    await rsvps.answer(g(A.gA), e.id, { answer: "YES", attending: null }, reqCtx);
    expect((await familyView(A.gA, e.id))?.rsvp?.answer).toBe("YES");
    expect((await familyView(A.gB, e.id))?.rsvp?.answer).toBeNull();
    expect(JSON.stringify(await calendar.getGuardianCalendar(A.schoolId, { from: lagos(-1), to: lagos(30) }, A.gB))).not.toMatch(/"yes":/);
  });

  it("replies close after the reply-by date, and the reply-by date may not follow the start", async () => {
    const e = await event({ deadline: lagos(-1) }, lagos(5)).catch((err) => err);
    // A deadline yesterday is allowed (it is before the start), and replies are closed.
    expect(e).not.toBeInstanceOf(Error);
    await expect(rsvps.answer(g(A.gA), e.id, { answer: "YES", attending: null }, reqCtx)).rejects.toBeInstanceOf(ConflictError);
    expect((await familyView(A.gA, e.id))?.rsvp?.open).toBe(false);
    await expect(event({ deadline: lagos(12) }, lagos(10))).rejects.toThrow();
    const ok = await event({ deadline: lagos(3) }, lagos(10));
    await expect(calendar.updateSchoolEvent(ctx(A.schoolId, A.ownerId), ok.id, { startDate: lagos(2), endDate: lagos(2) }, reqCtx)).rejects.toBeInstanceOf(ValidationError);
    // Switching replies off keeps answers but takes the question away.
    await rsvps.answer(g(A.gA), ok.id, { answer: "MAYBE", attending: null }, reqCtx);
    const off = await calendar.updateSchoolEvent(ctx(A.schoolId, A.ownerId), ok.id, { rsvp: null }, reqCtx);
    expect(off.rsvp).toBeNull();
    expect((await familyView(A.gA, ok.id))?.rsvp).toBeUndefined();
    await expect(rsvps.list(ctx(A.schoolId, A.ownerId), ok.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("classes must be this school's; only the owner and admins see the replies; another school sees nothing", async () => {
    const otherArm = await withTenant(B.schoolId, (db) => db.classArm.findFirstOrThrow({ where: { schoolId: B.schoolId }, select: { id: true } }));
    await expect(event({ classArmIds: [otherArm.id] })).rejects.toBeInstanceOf(ValidationError);
    const e = await event({});
    await expect(rsvps.list(ctx(A.schoolId, A.teacherId), e.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(rsvps.list(ctx(B.schoolId, B.ownerId), e.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(rsvps.answer(g(B.guardianId, B.schoolId), e.id, { answer: "YES", attending: null }, reqCtx)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("the reminder goes once, the day before the reply-by date, only to parents who have not answered, without the event's words", async () => {
    const e = await event({ deadline: lagos(1) });
    const later = await event({ deadline: lagos(4) });
    await rsvps.answer(g(A.gA), e.id, { answer: "YES", attending: null }, reqCtx);
    await rsvps.sendReminders(new Date());
    const forE = dispatch.calls.filter((c) => c.eventId === e.id);
    expect(forE.map((c) => (c.principal as { guardianId: string }).guardianId).sort()).toEqual([A.gB, A.gBoth].sort());
    expect(dispatch.calls.some((c) => c.eventId === later.id)).toBe(false);
    expect(forE[0]!.body).not.toContain(e.title);
    dispatch.calls = [];
    await rsvps.sendReminders(new Date());
    expect(dispatch.calls.filter((c) => c.eventId === e.id)).toHaveLength(0);
  });

  it("audit rows carry ids and the answer, nothing typed", async () => {
    const e = await event({});
    await rsvps.answer(g(A.gB), e.id, { answer: "NO", attending: null }, reqCtx);
    const rows = await withTenant(A.schoolId, (db) => db.auditLog.findMany({ where: { action: "event.rsvp", entityId: e.id } }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metadata).toMatchObject({ guardianId: A.gB, answer: "NO" });
  });
});
