import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@school-kit/types";

import { FilesystemStorageDriver } from "../../common/storage/filesystem-storage.driver";
import { StorageService } from "../../common/storage/storage.service";
import { AuthService } from "../auth/auth.service";
import { LibraryResourcesService } from "./library-resources.service";

// Phase 9 / CP6.3 — digital resources (docs/modules/phase-9.md §14 CP6-D7),
// against real Postgres and the filesystem storage driver. The rules first:
// a teacher adds only for a subject they teach at every level chosen, and
// removes only their own; a PDF is typed by its bytes; a student sees only
// what is meant for their class level, and opens a file through a signed link
// only after that check.

const runId = Math.random().toString(36).slice(2, 8);
const reqCtx = { ipAddress: "127.0.0.1" };
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const PDF = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function ctx(schoolId: string, userId: string) {
  return { sessionId: `sess-${runId}`, schoolId, userId };
}

interface Fixture {
  schoolId: string;
  ownerId: string;
  librarianId: string;
  teacherId: string;
  bursarId: string;
  levelA: string;
  levelB: string;
  maths: string;
  english: string;
  kidA: string;
  kidB: string;
}

describe("LibraryResourcesService (integration)", () => {
  const storageRoot = mkdtempSync(join(tmpdir(), "library-resources-"));
  const service = new LibraryResourcesService(new StorageService(new FilesystemStorageDriver(storageRoot)));
  const schoolIds = new Set<string>();
  let A: Fixture;
  let B: Fixture;

  async function setUp(label: string): Promise<Fixture> {
    const signed = await new AuthService().signupOwner(
      {
        schoolName: `Resources ${label} ${runId}`,
        schoolSlug: `resources-${label}-${runId}`,
        ownerFirstName: "Owen",
        ownerLastName: "Owner",
        ownerEmail: `resources-${label}-${runId}@example.test`,
        ownerPhone: `+23497${Math.floor(Math.random() * 100_000_000).toString().padStart(8, "0")}`,
        password: "Correct-Horse-9",
        ndprConsent: true,
      },
      { ipAddress: "127.0.0.1", userAgent: "vitest" },
    );
    const schoolId = signed.school.id;
    schoolIds.add(schoolId);
    await basePrisma.school.update({ where: { id: schoolId }, data: { status: "ACTIVE", onboardingStep: 5 } });
    return withTenant(schoolId, async (db) => {
      const year = await db.academicYear.create({ data: { schoolId, label: `Y-${runId}`, startDate: day("2025-09-01"), endDate: day("2099-07-31") } });
      const term = await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: 1, name: "Term", startDate: day("2025-09-01"), endDate: day("2098-12-31"), isCurrent: true },
      });
      const levels = await db.classLevel.findMany({ where: { schoolId }, orderBy: { orderIndex: "asc" }, take: 2 });
      const [levelA, levelB] = [levels[0]!, levels[1]!];
      const armA = await db.classArm.create({ data: { schoolId, classLevelId: levelA.id, name: "A Gold", code: `ra-${label}-${runId}` } });
      const armB = await db.classArm.create({ data: { schoolId, classLevelId: levelB.id, name: "B Gold", code: `rb-${label}-${runId}` } });
      const maths = await db.subject.create({ data: { schoolId, name: `Maths ${runId}`, code: `m-${label}-${runId}` } });
      const english = await db.subject.create({ data: { schoolId, name: `English ${runId}`, code: `e-${label}-${runId}` } });
      const role = async (key: string) => (await db.role.findFirstOrThrow({ where: { key }, select: { id: true } })).id;
      const staff = async (key: string) => {
        const user = await db.user.create({ data: { schoolId, email: `rs-${label}-${key}-${runId}@example.test`, firstName: key, lastName: "Staff" } });
        await db.userRole.create({ data: { userId: user.id, roleId: await role(key) } });
        return user.id;
      };
      const teacherId = await staff("teacher");
      // The teacher teaches Maths at level A only.
      await db.teacherAssignment.create({ data: { schoolId, teacherId, classArmId: armA.id, subjectId: maths.id, academicYearId: year.id, isActive: true } });
      const kid = async (n: string, armId: string) => {
        const s = await db.student.create({
          data: { schoolId, admissionNumber: `RS-${n}-${label}-${runId}`, firstName: "Ada", lastName: n, dateOfBirth: day("2013-01-01"), gender: "FEMALE" },
        });
        await db.enrollment.create({ data: { schoolId, studentId: s.id, termId: term.id, academicYearId: year.id, classArmId: armId, status: "ENROLLED" } });
        return s.id;
      };
      return {
        schoolId,
        ownerId: signed.user.id,
        librarianId: await staff("librarian"),
        teacherId,
        bursarId: await staff("bursar"),
        levelA: levelA.id,
        levelB: levelB.id,
        maths: maths.id,
        english: english.id,
        kidA: await kid("A", armA.id),
        kidB: await kid("B", armB.id),
      };
    });
  }

  const librarian = (f: Fixture) => ctx(f.schoolId, f.librarianId);
  const teacher = (f: Fixture) => ctx(f.schoolId, f.teacherId);

  beforeAll(async () => {
    A = await setUp("a");
    B = await setUp("b");
  });

  afterAll(async () => {
    for (const id of schoolIds) await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    await basePrisma.$disconnect();
    rmSync(storageRoot, { recursive: true, force: true });
  });

  it("the librarian adds a link for any subject and level; a teacher only within what they teach", async () => {
    const link = await service.createLink(
      librarian(A),
      { title: "Khan Academy fractions", subjectId: A.english, levelIds: [A.levelA, A.levelB], url: "https://www.khanacademy.org/math/fractions" },
      reqCtx,
    );
    expect(link).toMatchObject({ kind: "LINK", url: "https://www.khanacademy.org/math/fractions", fileSize: null, canRemove: true });
    expect(link.levels.map((l) => l.id).sort()).toEqual([A.levelA, A.levelB].sort());

    const file = await service.createFile(teacher(A), { title: "Fractions worksheet", subjectId: A.maths, levelIds: [A.levelA] }, PDF, reqCtx);
    expect(file).toMatchObject({ kind: "FILE", url: null, fileSize: PDF.length, canRemove: true, subject: { id: A.maths } });

    // Not their subject, or not at that level.
    await expect(service.createLink(teacher(A), { title: "X", subjectId: A.english, levelIds: [A.levelA], url: "https://example.org/x" }, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(service.createFile(teacher(A), { title: "X", subjectId: A.maths, levelIds: [A.levelA, A.levelB] }, PDF, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("takes only a PDF, read from its bytes, and only an https link", async () => {
    await expect(service.createFile(librarian(A), { title: "Image", subjectId: A.maths, levelIds: [A.levelA] }, PNG, reqCtx)).rejects.toMatchObject({ code: "INVALID_FILE_TYPE" });
    await expect(service.createFile(librarian(A), { title: "Junk", subjectId: A.maths, levelIds: [A.levelA] }, Buffer.from("MZ not a pdf"), reqCtx)).rejects.toBeInstanceOf(ValidationError);
    await expect(service.createLink(librarian(A), { title: "Plain", subjectId: A.maths, levelIds: [A.levelA], url: "http://example.org/x" }, reqCtx)).rejects.toMatchObject({ code: "LINK_NOT_HTTPS" });
    // Another school's subject or level is refused.
    await expect(service.createLink(librarian(A), { title: "X", subjectId: B.maths, levelIds: [A.levelA], url: "https://example.org/x" }, reqCtx)).rejects.toBeInstanceOf(ValidationError);
    await expect(service.createLink(librarian(A), { title: "X", subjectId: A.maths, levelIds: [B.levelA], url: "https://example.org/x" }, reqCtx)).rejects.toBeInstanceOf(ValidationError);
  });

  it("lists every resource for staff, with who may remove each, and says what a teacher may add", async () => {
    const own = await service.createLink(teacher(A), { title: "Teacher link", subjectId: A.maths, levelIds: [A.levelA], url: "https://example.org/t" }, reqCtx);
    const theirs = await service.createLink(librarian(A), { title: "Librarian link", subjectId: A.maths, levelIds: [A.levelB], url: "https://example.org/l" }, reqCtx);

    const asTeacher = await service.list(teacher(A), {});
    expect(asTeacher.resources.find((r) => r.id === own.id)?.canRemove).toBe(true);
    expect(asTeacher.resources.find((r) => r.id === theirs.id)?.canRemove).toBe(false);
    expect(asTeacher.scope).toMatchObject({ any: false, pairs: [{ subjectId: A.maths, classLevelId: A.levelA }] });

    const asLibrarian = await service.list(librarian(A), { subjectId: A.maths });
    expect(asLibrarian.scope.any).toBe(true);
    expect(asLibrarian.resources.every((r) => r.canRemove && r.subject.id === A.maths)).toBe(true);
    expect((await service.list(librarian(A), { classLevelId: A.levelB })).resources.map((r) => r.id)).toContain(theirs.id);

    await expect(service.list(ctx(A.schoolId, A.bursarId), {})).rejects.toBeInstanceOf(ForbiddenError);
    expect((await service.list(librarian(B), {})).resources.some((r) => r.id === own.id)).toBe(false);
  });

  it("a student sees what is meant for their class level, and opens a PDF only through that check", async () => {
    const forA = await service.createFile(librarian(A), { title: "Level A notes", subjectId: A.maths, levelIds: [A.levelA] }, PDF, reqCtx);
    const forBoth = await service.createLink(librarian(A), { title: "For both", subjectId: A.maths, levelIds: [A.levelA, A.levelB], url: "https://example.org/both" }, reqCtx);

    const seenA = (await service.forStudent(A.schoolId, A.kidA)).resources.map((r) => r.id);
    const seenB = (await service.forStudent(A.schoolId, A.kidB)).resources.map((r) => r.id);
    expect(seenA).toEqual(expect.arrayContaining([forA.id, forBoth.id]));
    expect(seenB).toContain(forBoth.id);
    expect(seenB).not.toContain(forA.id);

    const signed = await service.fileUrlForStudent(A.schoolId, A.kidA, forA.id);
    expect(signed.url).toEqual(expect.any(String));
    await expect(service.fileUrlForStudent(A.schoolId, A.kidB, forA.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.fileUrlForStudent(A.schoolId, A.kidA, forBoth.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(service.fileUrlForStudent(B.schoolId, B.kidA, forA.id)).rejects.toBeInstanceOf(NotFoundError);
    // Staff open it too.
    expect((await service.fileUrlForStaff(teacher(A), forA.id)).url).toEqual(expect.any(String));
  });

  it("a teacher removes only their own; removing a file deletes the stored PDF; both are audited", async () => {
    const mine = await service.createFile(teacher(A), { title: "Mine", subjectId: A.maths, levelIds: [A.levelA] }, PDF, reqCtx);
    const path = join(storageRoot, "schools", A.schoolId, "library", `${mine.id}.pdf`);
    expect(existsSync(path)).toBe(true);
    const librarians = await service.createLink(librarian(A), { title: "Not yours", subjectId: A.maths, levelIds: [A.levelA], url: "https://example.org/n" }, reqCtx);

    await expect(service.remove(teacher(A), librarians.id, reqCtx)).rejects.toBeInstanceOf(ForbiddenError);
    await service.remove(teacher(A), mine.id, reqCtx);
    expect(existsSync(path)).toBe(false);
    await service.remove(librarian(A), librarians.id, reqCtx);
    await expect(service.remove(librarian(A), librarians.id, reqCtx)).rejects.toBeInstanceOf(NotFoundError);

    const rows = await withTenant(A.schoolId, (db) =>
      db.auditLog.findMany({ where: { entityType: "library_resource", entityId: { in: [mine.id, librarians.id] } }, orderBy: { createdAt: "asc" } }),
    );
    expect(rows.map((r) => r.action)).toEqual(["library.resource.create", "library.resource.create", "library.resource.remove", "library.resource.remove"]);
  });
});
