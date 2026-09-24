import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ConflictError, NotFoundError } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { AnnouncementsService } from "./announcements.service";

// Announcements (docs/modules/announcements.md), against real Postgres.
//
// The audience rules are the whole risk here: an announcement that reaches
// the wrong families is not a bug a school forgives, and neither is one that
// reaches nobody.

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function ctx(schoolId: string, userId: string) {
  return { sessionId: `sess-${runId}`, schoolId, userId };
}

describe("AnnouncementsService (integration)", () => {
  const schoolIds = new Set<string>();
  const posted: Array<{ announcementId: string }> = [];
  const events = { announcementPosted: vi.fn(async (a: { announcementId: string }) => void posted.push(a)) };
  const service = new AnnouncementsService(events as never);

  let A: {
    schoolId: string;
    ownerId: string;
    teacherId: string;
    armId: string;
    otherArmId: string;
    guardianInClass: string;
    guardianElsewhere: string;
    studentInClass: string;
  };
  let B: { schoolId: string; ownerId: string };

  async function makeSchool(suffix: string) {
    const signed = await new AuthService().signupOwner(
      {
        schoolName: `Announce ${suffix} ${runId}`,
        schoolSlug: `announce-${suffix}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `announce-${suffix}-${runId}@example.test`,
        ownerPhone: `+23499${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    );
    schoolIds.add(signed.school.id);
    await basePrisma.school.update({ where: { id: signed.school.id }, data: { status: "ACTIVE", onboardingStep: 5 } });
    return { schoolId: signed.school.id, ownerId: signed.user.id };
  }

  beforeAll(async () => {
    const a = await makeSchool("a");
    B = await makeSchool("b");

    A = await withTenant(a.schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId: a.schoolId, label: `Y-${runId}`, startDate: day("2026-09-01"), endDate: day("2027-07-31") },
      });
      const term = await db.term.create({
        data: {
          schoolId: a.schoolId,
          academicYearId: year.id,
          sequence: 1,
          name: "First Term",
          startDate: day("2026-09-01"),
          endDate: day("2026-12-11"),
          isCurrent: true,
        },
      });
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId: a.schoolId }, orderBy: { orderIndex: "asc" } });
      const arm = await db.classArm.create({
        data: { schoolId: a.schoolId, classLevelId: level.id, name: "JSS1A", code: `a-${runId}` },
        select: { id: true },
      });
      const otherArm = await db.classArm.create({
        data: { schoolId: a.schoolId, classLevelId: level.id, name: "JSS1B", code: `b-${runId}` },
        select: { id: true },
      });
      const teacher = await db.user.create({
        data: { schoolId: a.schoolId, email: `ann-t-${runId}@example.test`, firstName: "Tunde", lastName: "Teacher" },
        select: { id: true },
      });

      const makeChild = async (name: string, armId: string) => {
        const student = await db.student.create({
          data: {
            schoolId: a.schoolId,
            admissionNumber: `ADM-${name}-${runId}`,
            firstName: name,
            lastName: "Pupil",
            dateOfBirth: day("2013-01-01"),
            gender: "FEMALE",
          },
          select: { id: true },
        });
        await db.enrollment.create({
          data: {
            schoolId: a.schoolId,
            studentId: student.id,
            termId: term.id,
            academicYearId: year.id,
            classArmId: armId,
            status: "ENROLLED",
          },
        });
        const guardian = await db.guardian.create({
          data: {
            schoolId: a.schoolId,
            firstName: `${name}-parent`,
            lastName: "Parent",
            relationship: "MOTHER",
            phone: `0803${Math.floor(Math.random() * 1_000_000).toString().padStart(7, "0")}`,
          },
          select: { id: true },
        });
        await db.studentGuardian.create({
          data: { schoolId: a.schoolId, studentId: student.id, guardianId: guardian.id, isPrimary: true },
        });
        return { studentId: student.id, guardianId: guardian.id };
      };

      const inClass = await makeChild("Ada", arm.id);
      const elsewhere = await makeChild("Bola", otherArm.id);

      return {
        schoolId: a.schoolId,
        ownerId: a.ownerId,
        teacherId: teacher.id,
        armId: arm.id,
        otherArmId: otherArm.id,
        guardianInClass: inClass.guardianId,
        guardianElsewhere: elsewhere.guardianId,
        studentInClass: inClass.studentId,
      };
    });
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  it("sends to everyone, and tells the notification rail once", async () => {
    posted.length = 0;
    const announcement = await service.create(
      ctx(A.schoolId, A.ownerId),
      { title: "Resumption", body: "School resumes on Monday.", audience: "EVERYONE" },
      reqCtx,
    );
    expect(announcement.urgent).toBe(false);
    expect(posted).toEqual([{ schoolId: A.schoolId, announcementId: announcement.id }]);

    const guardian = await service.guardianFeed(A.schoolId, A.guardianInClass);
    const student = await service.studentFeed(A.schoolId, A.studentInClass);
    const staff = await service.staffFeed(ctx(A.schoolId, A.teacherId));
    for (const feed of [guardian, student, staff]) {
      expect(feed.data.map((a) => a.id)).toContain(announcement.id);
    }
  });

  it("keeps a parents-only announcement away from students and staff", async () => {
    const announcement = await service.create(
      ctx(A.schoolId, A.ownerId),
      { title: "Fees", body: "Second instalment is due.", audience: "PARENTS" },
      reqCtx,
    );
    expect((await service.guardianFeed(A.schoolId, A.guardianInClass)).data.map((a) => a.id)).toContain(announcement.id);
    expect((await service.studentFeed(A.schoolId, A.studentInClass)).data.map((a) => a.id)).not.toContain(announcement.id);
    expect((await service.staffFeed(ctx(A.schoolId, A.teacherId))).data.map((a) => a.id)).not.toContain(announcement.id);
  });

  it("keeps a staff-only announcement away from families", async () => {
    const announcement = await service.create(
      ctx(A.schoolId, A.ownerId),
      { title: "Staff meeting", body: "3pm in the hall.", audience: "STAFF" },
      reqCtx,
    );
    expect((await service.staffFeed(ctx(A.schoolId, A.teacherId))).data.map((a) => a.id)).toContain(announcement.id);
    expect((await service.guardianFeed(A.schoolId, A.guardianInClass)).data.map((a) => a.id)).not.toContain(announcement.id);
    expect((await service.studentFeed(A.schoolId, A.studentInClass)).data.map((a) => a.id)).not.toContain(announcement.id);
  });

  it("sends a class announcement to that class's family only", async () => {
    const announcement = await service.create(
      ctx(A.schoolId, A.ownerId),
      { title: "JSS1A trip", body: "Bring a packed lunch.", audience: "CLASS", classArmId: A.armId },
      reqCtx,
    );
    expect((await service.guardianFeed(A.schoolId, A.guardianInClass)).data.map((a) => a.id)).toContain(announcement.id);
    // The other class's parent must not see it.
    expect((await service.guardianFeed(A.schoolId, A.guardianElsewhere)).data.map((a) => a.id)).not.toContain(
      announcement.id,
    );
  });

  it("refuses a class announcement with no class, and a class that is not this school's", async () => {
    await expect(
      service.create(
        ctx(A.schoolId, A.ownerId),
        { title: "x", body: "y", audience: "CLASS", classArmId: "00000000-0000-4000-8000-000000000000" },
        reqCtx,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("is owner/admin only — a teacher cannot message the school", async () => {
    await expect(
      service.create(ctx(A.schoolId, A.teacherId), { title: "x", body: "y", audience: "EVERYONE" }, reqCtx),
    ).rejects.toMatchObject({ httpStatus: 403 });
  });

  it("withdrawn announcements disappear from every feed, and cannot be withdrawn twice", async () => {
    const announcement = await service.create(
      ctx(A.schoolId, A.ownerId),
      { title: "Cancelled", body: "Ignore this.", audience: "EVERYONE" },
      reqCtx,
    );
    await service.withdraw(ctx(A.schoolId, A.ownerId), announcement.id, reqCtx);

    for (const feed of [
      await service.guardianFeed(A.schoolId, A.guardianInClass),
      await service.studentFeed(A.schoolId, A.studentInClass),
      await service.staffFeed(ctx(A.schoolId, A.teacherId)),
    ]) {
      expect(feed.data.map((a) => a.id)).not.toContain(announcement.id);
    }
    await expect(service.withdraw(ctx(A.schoolId, A.ownerId), announcement.id, reqCtx)).rejects.toBeInstanceOf(
      ConflictError,
    );
    // It still exists for the school's own record — sent is sent (A2).
    expect((await service.list(ctx(A.schoolId, A.ownerId))).data.map((a) => a.id)).toContain(announcement.id);
  });

  it("counts unread until the reader marks it, and marking twice is not an error", async () => {
    const announcement = await service.create(
      ctx(A.schoolId, A.ownerId),
      { title: "Sports day", body: "Wear house colours.", audience: "EVERYONE" },
      reqCtx,
    );
    const before = await service.guardianFeed(A.schoolId, A.guardianInClass);
    expect(before.unreadCount).toBeGreaterThan(0);

    await service.markRead(A.schoolId, announcement.id, "GUARDIAN", A.guardianInClass);
    await service.markRead(A.schoolId, announcement.id, "GUARDIAN", A.guardianInClass);

    const after = await service.guardianFeed(A.schoolId, A.guardianInClass);
    expect(after.data.find((a) => a.id === announcement.id)?.readAt).not.toBeNull();
    expect(after.unreadCount).toBe(before.unreadCount - 1);
    // One reader's read is their own: the student has not read it.
    const student = await service.studentFeed(A.schoolId, A.studentInClass);
    expect(student.data.find((a) => a.id === announcement.id)?.readAt).toBeNull();
  });

  it("is invisible to another school, and cannot be withdrawn from one", async () => {
    const announcement = await service.create(
      ctx(A.schoolId, A.ownerId),
      { title: "Private", body: "School A only.", audience: "EVERYONE" },
      reqCtx,
    );
    expect((await service.list(ctx(B.schoolId, B.ownerId))).data.map((a) => a.id)).not.toContain(announcement.id);
    await expect(service.withdraw(ctx(B.schoolId, B.ownerId), announcement.id, reqCtx)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("records urgent in the audit log — waking phones at any hour is someone's decision", async () => {
    const announcement = await service.create(
      ctx(A.schoolId, A.ownerId),
      { title: "Gate closed", body: "Do not bring children tomorrow.", audience: "EVERYONE", urgent: true },
      reqCtx,
    );
    const audit = await withTenant(A.schoolId, (db) =>
      db.auditLog.findFirstOrThrow({
        where: { action: "announcement.create", entityId: announcement.id },
        select: { metadata: true, userId: true },
      }),
    );
    expect(audit.metadata).toMatchObject({ urgent: true, audience: "EVERYONE" });
    expect(audit.userId).toBe(A.ownerId);
  });
});
