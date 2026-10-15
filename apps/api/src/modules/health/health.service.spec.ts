import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError, NotFoundError, updateHealthProfileSchema } from "@school-kit/types";

import { AuthService } from "../auth/auth.service";
import { HealthService } from "./health.service";

// Phase 9 / CP3.1 — health profiles (docs/modules/phase-9.md §10), against
// real Postgres. The tests are about WHO reads WHAT: the whole record for
// owner, admin and the Health officer; the "For teachers" note only for a
// teacher of the child; the whole record, read-only, for a linked guardian;
// nothing for anyone else.

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const ALLERGY = "Severe peanut allergy";
const NOTE = "Peanut allergy. EpiPen in her school bag.";

function ctx(schoolId: string, userId: string) {
  return { sessionId: `sess-${runId}`, schoolId, userId };
}

async function makeSchool(label: string) {
  const signed = await new AuthService().signupOwner(
    {
      schoolName: `Health ${label} ${runId}`,
      schoolSlug: `health-${label}-${runId}`,
      ownerFirstName: "Owen",
      ownerLastName: "Owner",
      ownerEmail: `health-${label}-${runId}@example.test`,
      ownerPhone: `+23497${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
      password: "Correct-Horse-9",
      ndprConsent: true,
    },
    { ipAddress: "127.0.0.1", userAgent: "vitest" },
  );
  await basePrisma.school.update({ where: { id: signed.school.id }, data: { status: "ACTIVE", onboardingStep: 5 } });
  return { schoolId: signed.school.id, ownerId: signed.user.id };
}

describe("HealthService (integration)", () => {
  const service = new HealthService();
  const schoolIds = new Set<string>();

  let A: {
    schoolId: string;
    ownerId: string;
    adminId: string;
    officerId: string;
    teacherId: string;
    otherTeacherId: string;
    bursarId: string;
    armId: string;
    child: string;
    otherChild: string;
    guardianId: string;
    unlinkedGuardianId: string;
  };
  let B: { schoolId: string; guardianId: string };

  beforeAll(async () => {
    const a = await makeSchool("a");
    schoolIds.add(a.schoolId);
    const schoolId = a.schoolId;
    A = await withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({
        data: { schoolId, label: `Y-${runId}`, startDate: day("2026-09-01"), endDate: day("2027-07-31") },
      });
      const term = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 1, name: "First Term", startDate: day("2026-09-01"), endDate: day("2026-12-11"), isCurrent: true },
      });
      const level = await db.classLevel.findFirstOrThrow({ where: { schoolId }, orderBy: { orderIndex: "asc" } });
      const arm = await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "JSS1A", code: `hp-a-${runId}` }, select: { id: true } });
      const otherArm = await db.classArm.create({ data: { schoolId, classLevelId: level.id, name: "JSS1B", code: `hp-b-${runId}` }, select: { id: true } });
      const subject = await db.subject.findFirstOrThrow({ where: { schoolId }, orderBy: { name: "asc" } });
      const role = async (key: string) => (await db.role.findFirstOrThrow({ where: { key }, select: { id: true } })).id;
      const staff = async (email: string, firstName: string, roleKey: string, armId: string | null) => {
        const user = await db.user.create({ data: { schoolId, email, firstName, lastName: "Staff" }, select: { id: true } });
        await db.userRole.create({ data: { userId: user.id, roleId: await role(roleKey) } });
        if (armId) {
          await db.teacherAssignment.create({
            data: { schoolId, teacherId: user.id, classArmId: armId, subjectId: subject.id, academicYearId: year.id, isActive: true },
          });
        }
        return user.id;
      };
      const child = async (name: string, armId: string) => {
        const s = await db.student.create({
          data: { schoolId, admissionNumber: `HP-${name}-${runId}`, firstName: name, lastName: "Pupil", dateOfBirth: day("2013-01-01"), gender: "FEMALE" },
          select: { id: true },
        });
        await db.enrollment.create({ data: { schoolId, studentId: s.id, termId: term.id, academicYearId: year.id, classArmId: armId, status: "ENROLLED" } });
        return s.id;
      };
      const guardian = async (firstName: string) =>
        (await db.guardian.create({ data: { schoolId, firstName, lastName: "Parent", relationship: "MOTHER", phone: "08031112222" }, select: { id: true } })).id;

      const kid = await child("Amara", arm.id);
      const guardianId = await guardian("Linked");
      await db.studentGuardian.create({ data: { schoolId, studentId: kid, guardianId, isPrimary: true } });
      return {
        schoolId,
        ownerId: a.ownerId,
        adminId: await staff(`hp-ad-${runId}@example.test`, "Amaka", "admin", null),
        officerId: await staff(`hp-ho-${runId}@example.test`, "Halima", "health_officer", null),
        teacherId: await staff(`hp-t-${runId}@example.test`, "Tunde", "teacher", arm.id),
        otherTeacherId: await staff(`hp-t2-${runId}@example.test`, "Ngozi", "teacher", otherArm.id),
        bursarId: await staff(`hp-b-${runId}@example.test`, "Bisi", "bursar", null),
        armId: arm.id,
        child: kid,
        otherChild: await child("Bola", otherArm.id),
        guardianId,
        unlinkedGuardianId: await guardian("Unlinked"),
      };
    });

    const b = await makeSchool("b");
    schoolIds.add(b.schoolId);
    B = {
      schoolId: b.schoolId,
      guardianId: await withTenant(b.schoolId, async (db) =>
        (await db.guardian.create({ data: { schoolId: b.schoolId, firstName: "Far", lastName: "Away", relationship: "FATHER", phone: "08039999999" }, select: { id: true } })).id,
      ),
    };
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
  });

  describe("the Health officer keeps the record", () => {
    it("writes a profile and reads it back, with who changed it", async () => {
      const saved = await service.updateProfile(
        ctx(A.schoolId, A.officerId),
        A.child,
        { allergies: ALLERGY, bloodGroup: "O+", teacherNote: NOTE },
        reqCtx,
      );
      expect(saved.allergies).toBe(ALLERGY);
      expect(saved.teacherNote).toBe(NOTE);
      expect(saved.updatedByName).toBe("Halima Staff");
      expect(saved.className).toBe("JSS1A");
    });

    it("an emptied box clears the field", async () => {
      const parsed = updateHealthProfileSchema.parse({ medication: "" });
      expect(parsed.medication).toBeNull();
      await service.updateProfile(ctx(A.schoolId, A.adminId), A.child, { medication: "Inhaler" }, reqCtx);
      const cleared = await service.updateProfile(ctx(A.schoolId, A.adminId), A.child, parsed, reqCtx);
      expect(cleared.medication).toBeNull();
      expect(cleared.allergies).toBe(ALLERGY);
    });

    it("owner and admin read it; the list shows flags, not health text", async () => {
      expect((await service.getProfile(ctx(A.schoolId, A.ownerId), A.child, reqCtx)).allergies).toBe(ALLERGY);
      const list = await service.listStudents(ctx(A.schoolId, A.officerId), { armId: A.armId });
      const row = list.data.find((r) => r.studentId === A.child)!;
      expect(row).toMatchObject({ hasProfile: true, hasTeacherNote: true, className: "JSS1A" });
      expect(JSON.stringify(list)).not.toContain("peanut");
    });

    it("a teacher and a bursar cannot read or write the record", async () => {
      for (const userId of [A.teacherId, A.bursarId]) {
        await expect(service.getProfile(ctx(A.schoolId, userId), A.child, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
        await expect(
          service.updateProfile(ctx(A.schoolId, userId), A.child, { allergies: "x" }, reqCtx),
        ).rejects.toBeInstanceOf(ForbiddenError);
        await expect(service.listStudents(ctx(A.schoolId, userId), {})).rejects.toBeInstanceOf(ForbiddenError);
      }
    });
  });

  describe("a teacher sees the note and nothing else", () => {
    it("a teacher of the child gets the note, in exactly two fields", async () => {
      const one = await service.teacherNoteForStudent(ctx(A.schoolId, A.teacherId), A.child, reqCtx);
      expect(one).toEqual({ studentId: A.child, note: NOTE });
      const arm = await service.teacherNotesForArm(ctx(A.schoolId, A.teacherId), A.armId, reqCtx);
      expect(arm.data).toEqual([{ studentId: A.child, name: "Amara Pupil", note: NOTE }]);
      expect(JSON.stringify(arm)).not.toContain(ALLERGY);
    });

    it("a teacher who does not teach the child gets nothing", async () => {
      await expect(
        service.teacherNoteForStudent(ctx(A.schoolId, A.otherTeacherId), A.child, reqCtx),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        service.teacherNotesForArm(ctx(A.schoolId, A.otherTeacherId), A.armId, reqCtx),
      ).rejects.toBeInstanceOf(NotFoundError);
    });

    it("a child with no shared note reads as no note", async () => {
      await service.updateProfile(ctx(A.schoolId, A.officerId), A.otherChild, { allergies: "Dust" }, reqCtx);
      const res = await service.teacherNoteForStudent(ctx(A.schoolId, A.otherTeacherId), A.otherChild, reqCtx);
      expect(res.note).toBeNull();
    });
  });

  describe("parents", () => {
    it("a linked guardian reads the whole profile", async () => {
      const res = await service.profileForGuardian({ sessionId: "s", schoolId: A.schoolId, guardianId: A.guardianId }, A.child);
      expect(res.allergies).toBe(ALLERGY);
      expect(res.teacherNote).toBe(NOTE);
      expect(res.updatedAt).not.toBeNull();
    });

    it("an unlinked guardian, and another school's guardian, get nothing", async () => {
      await expect(
        service.profileForGuardian({ sessionId: "s", schoolId: A.schoolId, guardianId: A.unlinkedGuardianId }, A.child),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        service.profileForGuardian({ sessionId: "s", schoolId: B.schoolId, guardianId: B.guardianId }, A.child),
      ).rejects.toBeInstanceOf(ForbiddenError);
      expect(await withTenant(B.schoolId, (db) => db.healthProfile.count())).toBe(0);
    });
  });

  it("every read is audited, and the audit log holds no health text", async () => {
    const rows = await withTenant(A.schoolId, (db) => db.auditLog.findMany({ where: { action: { startsWith: "health." } } }));
    expect(new Set(rows.map((r) => r.action))).toEqual(
      new Set(["health.update", "health.read", "health.note.read", "health.portal.read"]),
    );
    const update = rows.find((r) => r.action === "health.update")!;
    expect((update.metadata as { changed: string[] }).changed).toEqual(
      expect.arrayContaining(["allergies", "bloodGroup", "teacherNote"]),
    );
    expect(JSON.stringify(rows.map((r) => r.metadata))).not.toMatch(/peanut|EpiPen|O\+|Inhaler|Dust/i);
  });
});
