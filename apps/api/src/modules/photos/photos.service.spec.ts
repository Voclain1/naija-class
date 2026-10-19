import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@school-kit/types";

import { FilesystemStorageDriver } from "../../common/storage/filesystem-storage.driver";
import { StorageService } from "../../common/storage/storage.service";

import { AuthService } from "../auth/auth.service";
import { PhotosService } from "./photos.service";

// Passport photos (docs/modules/id-cards-and-store.md §2), against real
// Postgres and the filesystem driver: JPEG only, one object per person,
// audited, signed links only for those who may see them, and nothing across
// schools.

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1" };
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function ctx(schoolId: string, userId: string) {
  return { sessionId: `sess-${runId}`, schoolId, userId };
}

async function makeSchool(label: string) {
  const signed = await new AuthService().signupOwner(
    {
      schoolName: `Photos ${label} ${runId}`,
      schoolSlug: `photos-${label}-${runId}`,
      ownerFirstName: "Owen",
      ownerLastName: "Owner",
      ownerEmail: `photos-${label}-${runId}@example.test`,
      ownerPhone: `+23497${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
      password: "Correct-Horse-9",
      ndprConsent: true,
    },
    { ipAddress: "127.0.0.1", userAgent: "vitest" },
  );
  await basePrisma.school.update({ where: { id: signed.school.id }, data: { status: "ACTIVE", onboardingStep: 5 } });
  return { schoolId: signed.school.id, ownerId: signed.user.id };
}

async function addPeople(schoolId: string, tag: string) {
  return withTenant(schoolId, async (db) => {
    const role = async (key: string) => (await db.role.findFirstOrThrow({ where: { key, schoolId: null }, select: { id: true } })).id;
    const staff = async (roleKey: string) => {
      const user = await db.user.create({
        data: { schoolId, email: `ph-${roleKey}-${tag}-${runId}@example.test`, firstName: roleKey, lastName: "Staff" },
        select: { id: true },
      });
      await db.userRole.create({ data: { userId: user.id, roleId: await role(roleKey) } });
      return user.id;
    };
    const student = await db.student.create({
      data: {
        schoolId,
        admissionNumber: `PH-${tag}-${runId}`,
        firstName: "Amara",
        lastName: "Pupil",
        dateOfBirth: new Date("2013-01-01T00:00:00.000Z"),
        gender: "FEMALE",
      },
      select: { id: true },
    });
    return {
      adminId: await staff("admin"),
      teacherId: await staff("teacher"),
      bursarId: await staff("bursar"),
      studentId: student.id,
    };
  });
}

describe("PhotosService (integration)", () => {
  const storageRoot = mkdtempSync(join(tmpdir(), "photos-"));
  const service = new PhotosService(new StorageService(new FilesystemStorageDriver(storageRoot)));
  const schoolIds = new Set<string>();
  let A: { schoolId: string; ownerId: string; adminId: string; teacherId: string; bursarId: string; studentId: string };
  let B: { schoolId: string; ownerId: string; adminId: string; studentId: string };

  beforeAll(async () => {
    const a = await makeSchool("a");
    schoolIds.add(a.schoolId);
    A = { ...a, ...(await addPeople(a.schoolId, "a")) };
    const b = await makeSchool("b");
    schoolIds.add(b.schoolId);
    B = { ...b, ...(await addPeople(b.schoolId, "b")) };
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
    rmSync(storageRoot, { recursive: true, force: true });
  });

  const studentFile = () => join(storageRoot, "schools", A.schoolId, "photos", "students", `${A.studentId}.jpg`);

  describe("a student's photo", () => {
    it("an admin uploads a JPEG; it is stored, flagged and audited", async () => {
      const status = await service.setStudentPhoto(ctx(A.schoolId, A.adminId), A.studentId, JPEG, reqCtx);
      expect(status.hasPhoto).toBe(true);
      expect(existsSync(studentFile())).toBe(true);
      const audit = await withTenant(A.schoolId, (db) =>
        db.auditLog.findFirst({ where: { action: "student.photo.set", entityId: A.studentId } }),
      );
      expect(audit?.userId).toBe(A.adminId);
    });

    it("refuses anything that is not a JPEG, whatever it is called", async () => {
      await expect(service.setStudentPhoto(ctx(A.schoolId, A.adminId), A.studentId, PNG, reqCtx)).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(
        service.setStudentPhoto(ctx(A.schoolId, A.adminId), A.studentId, Buffer.alloc(0), reqCtx),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("a teacher sees the link; a bursar, without student.read, does not", async () => {
      const seen = await service.studentPhotoUrls(ctx(A.schoolId, A.teacherId), [A.studentId]);
      expect(seen.urls[A.studentId]).toContain(`/photos/students/${A.studentId}.jpg`);
      await expect(service.studentPhotoUrls(ctx(A.schoolId, A.bursarId), [A.studentId])).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it("a teacher cannot change it", async () => {
      await expect(service.setStudentPhoto(ctx(A.schoolId, A.teacherId), A.studentId, JPEG, reqCtx)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it("another school's admin neither sees nor changes it", async () => {
      expect((await service.studentPhotoUrls(ctx(B.schoolId, B.adminId), [A.studentId])).urls).toEqual({});
      await expect(service.setStudentPhoto(ctx(B.schoolId, B.adminId), A.studentId, JPEG, reqCtx)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("removing it deletes the file and the link", async () => {
      const status = await service.removeStudentPhoto(ctx(A.schoolId, A.adminId), A.studentId, reqCtx);
      expect(status.hasPhoto).toBe(false);
      expect(existsSync(studentFile())).toBe(false);
      expect((await service.studentPhotoUrls(ctx(A.schoolId, A.adminId), [A.studentId])).urls).toEqual({});
    });
  });

  describe("a staff photo", () => {
    it("a teacher sets their own and sees only their own", async () => {
      await service.setStaffPhoto(ctx(A.schoolId, A.teacherId), A.teacherId, JPEG, reqCtx);
      await service.setStaffPhoto(ctx(A.schoolId, A.adminId), A.bursarId, JPEG, reqCtx);
      const own = await service.staffPhotoUrls(ctx(A.schoolId, A.teacherId), [A.teacherId, A.bursarId]);
      expect(Object.keys(own.urls)).toEqual([A.teacherId]);
    });

    it("an admin sees everyone's; a teacher cannot change a colleague's", async () => {
      const all = await service.staffPhotoUrls(ctx(A.schoolId, A.adminId), [A.teacherId, A.bursarId]);
      expect(Object.keys(all.urls).sort()).toEqual([A.teacherId, A.bursarId].sort());
      await expect(service.setStaffPhoto(ctx(A.schoolId, A.teacherId), A.bursarId, JPEG, reqCtx)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(service.removeStaffPhoto(ctx(A.schoolId, A.teacherId), A.bursarId, reqCtx)).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    });

    it("another school cannot reach it", async () => {
      expect((await service.staffPhotoUrls(ctx(B.schoolId, B.ownerId), [A.teacherId])).urls).toEqual({});
      await expect(service.setStaffPhoto(ctx(B.schoolId, B.ownerId), A.teacherId, JPEG, reqCtx)).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it("removing your own is audited as yours", async () => {
      await service.removeStaffPhoto(ctx(A.schoolId, A.teacherId), A.teacherId, reqCtx);
      const audit = await withTenant(A.schoolId, (db) =>
        db.auditLog.findFirst({ where: { action: "staff.photo.remove", entityId: A.teacherId } }),
      );
      expect(audit?.metadata).toMatchObject({ own: true });
    });
  });
});
