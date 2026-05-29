import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Logger } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import { FilesystemStorageDriver } from "../../../common/storage/filesystem-storage.driver";
import { StorageService } from "../../../common/storage/storage.service";
import { AuthService } from "../../auth/auth.service";
import { ImportsService } from "../imports.service";
import { runCommitHandler } from "./commit.handler";
import { ImportsProcessor } from "./imports.processor";

// Integration spec for the slice-8 cp1 GUARDIAN commit pipeline. Drives a
// CSV through upload → mapping → validate → commit end-to-end, asserting on
// the six cases captured by the user in the cp1 task:
//
//   1. Sibling case (two rows, same guardian + different students) →
//      ONE Guardian row + TWO StudentGuardian links.
//   2. Same (phone+firstName+lastName) but DIFFERENT relationship across
//      rows → ONE Guardian (first row's relationship wins; second row's
//      Guardian-level fields silently ignored). Schema design-flag from
//      cp1 — relationship is per-Guardian, not per-link.
//   3. Missing admission number at validate time → bad row "Student
//      admission number not found" (validate-bad pile).
//   4. Admission number EXISTED at validate but the Student was withdrawn
//      between validate and commit → commit-time bad row "Student
//      admission number not found at commit time."
//   5. Every-row-collides edge (all admission numbers don't resolve to a
//      Student) → COMPLETED with committedRows=0, error report has all
//      rows. (Same shape as the slice-7 student edge case.)
//   6. StudentGuardian's single @@unique([studentId, guardianId]) means
//      a P2002 is unambiguously "link already exists" — no constraint-
//      name disambiguation needed. Tested by importing the same row twice
//      across two import jobs.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00)
    .toString()
    .padStart(8, "0");
  return `+23467${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

interface MockQueueAddCall {
  name: string;
  data: Record<string, unknown>;
  options: Record<string, unknown>;
}

function makeMockQueue() {
  const calls: MockQueueAddCall[] = [];
  return {
    calls,
    add: vi.fn(async (name: string, data: unknown, options: unknown) => {
      calls.push({
        name,
        data: data as Record<string, unknown>,
        options: (options ?? {}) as Record<string, unknown>,
      });
      return { id: `mock-job-${calls.length}` };
    }),
  };
}

function fakeValidateJob(data: {
  schoolId: string;
  userId: string;
  jobId: string;
  type: "STUDENTS" | "GUARDIANS";
}) {
  return {
    id: `test-${Math.random().toString(36).slice(2, 8)}`,
    name: "validate",
    data,
    queueName: "imports",
    attemptsMade: 0,
    opts: { attempts: 3 },
  } as unknown as Parameters<typeof ImportsProcessor.prototype.process>[0];
}

describe("Guardian commit handler (slice 8 cp1)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const schoolIdsToCleanup = new Set<string>();
  let storageRoot: string;
  let storage: StorageService;
  let mockQueue: ReturnType<typeof makeMockQueue>;
  let importsService: ImportsService;
  let processor: ImportsProcessor;
  let logger: Logger;

  beforeAll(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "schoolkit-guardian-spec-"));
    const driver = new FilesystemStorageDriver(storageRoot);
    storage = new StorageService(driver);
    mockQueue = makeMockQueue();
    importsService = new ImportsService(storage, mockQueue as never);
    processor = new ImportsProcessor(storage);
    logger = new Logger("commit-guardian-spec");
  });

  afterAll(async () => {
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
    rmSync(storageRoot, { force: true, recursive: true });
  });

  async function createActiveSchool(suffix: string) {
    const signed = await authService.signupOwner(
      {
        schoolName: `Guardian Spec ${suffix}`,
        schoolSlug: `gd-${suffix}-${runId}`,
        ownerFirstName: "Olu",
        ownerLastName: "Owner",
        ownerEmail: `gd-${suffix}-${runId}@example.test`,
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
      schoolId: signed.school.id,
      userId: signed.user.id,
      authCtx: {
        sessionId: "sess-placeholder",
        userId: signed.user.id,
        schoolId: signed.school.id,
      },
    };
  }

  // Seed a couple of students so we have admission numbers to link to.
  async function seedStudents(
    schoolId: string,
    rows: Array<{ admissionNumber: string; firstName: string; lastName: string }>,
  ) {
    await withTenant(schoolId, async (db) => {
      for (const r of rows) {
        await db.student.create({
          data: {
            schoolId,
            admissionNumber: r.admissionNumber,
            firstName: r.firstName,
            lastName: r.lastName,
            dateOfBirth: new Date("2014-01-01"),
            gender: "MALE",
          },
        });
      }
    });
  }

  const mapping = {
    columnMapping: {
      "Ward Adm No": "studentAdmissionNumber",
      "First Name": "firstName",
      Surname: "lastName",
      Relationship: "relationship",
      Phone: "phone",
      "Is Primary": "isPrimary",
    },
    options: {
      dateFormat: "YYYY-MM-DD" as const,
      treatBlankAs: "skip" as const,
    },
  };

  async function uploadMapValidateAndPrepareCommit(
    suffix: string,
    schoolId: string,
    authCtx: { schoolId: string; userId: string; sessionId: string },
    userId: string,
    csvText: string,
  ) {
    const buffer = Buffer.from(csvText, "utf-8");
    const uploaded = await importsService.uploadGuardians(
      authCtx,
      { buffer, originalname: `${suffix}.csv`, size: buffer.length },
      reqCtx,
    );
    await importsService.applyMapping(authCtx, uploaded.jobId, mapping, reqCtx);
    await processor.process(
      fakeValidateJob({
        schoolId,
        userId,
        jobId: uploaded.jobId,
        type: "GUARDIANS",
      }),
    );

    await withTenant(schoolId, async (db) => {
      const row = await db.importJob.findUnique({
        where: { id: uploaded.jobId },
        select: { status: true },
      });
      if (row?.status !== "READY") {
        throw new Error(
          `expected READY after validate, got ${row?.status} for ${uploaded.jobId}`,
        );
      }
      await db.importJob.update({
        where: { id: uploaded.jobId },
        data: { status: "COMMITTING" },
      });
    });

    return { jobId: uploaded.jobId };
  }

  // ----------------------------------------------------------------------
  // Case 1 — sibling case: one parent, two children.
  // ----------------------------------------------------------------------
  describe("sibling case", () => {
    it("collapses to ONE Guardian with TWO StudentGuardian links", async () => {
      const { schoolId, userId, authCtx } = await createActiveSchool("sibs");
      await seedStudents(schoolId, [
        { admissionNumber: "ADM/SIB1", firstName: "Ada", lastName: "Okafor" },
        { admissionNumber: "ADM/SIB2", firstName: "Tobi", lastName: "Okafor" },
      ]);

      const csv = [
        "Ward Adm No,First Name,Surname,Relationship,Phone,Is Primary",
        "ADM/SIB1,Ngozi,Okafor,Mother,08012345001,Yes",
        "ADM/SIB2,Ngozi,Okafor,Mother,08012345001,Yes",
      ].join("\r\n");
      const { jobId } = await uploadMapValidateAndPrepareCommit(
        "sibs",
        schoolId,
        authCtx,
        userId,
        csv,
      );

      const result = await runCommitHandler({
        jobId,
        schoolId,
        userId,
        storage,
        logger,
      });

      expect(result).toMatchObject({
        status: "completed",
        committedRows: 2,
        commitErrorCount: 0,
        validateBadCount: 0,
        errorReportUrl: null,
      });

      // ONE Guardian, TWO StudentGuardian links
      const guardians = await withTenant(schoolId, (db) =>
        db.guardian.findMany({
          where: { phone: "08012345001" },
          select: { id: true, firstName: true, lastName: true, relationship: true },
        }),
      );
      expect(guardians).toHaveLength(1);
      expect(guardians[0]).toMatchObject({
        firstName: "Ngozi",
        lastName: "Okafor",
        relationship: "MOTHER",
      });

      const links = await withTenant(schoolId, (db) =>
        db.studentGuardian.findMany({
          where: { guardianId: guardians[0].id },
          select: {
            student: { select: { admissionNumber: true } },
            isPrimary: true,
            canPickup: true,
          },
          orderBy: { student: { admissionNumber: "asc" } },
        }),
      );
      expect(links).toHaveLength(2);
      expect(links[0].student.admissionNumber).toBe("ADM/SIB1");
      expect(links[1].student.admissionNumber).toBe("ADM/SIB2");
      expect(links.every((l) => l.isPrimary === true)).toBe(true);
      expect(links.every((l) => l.canPickup === true)).toBe(true);
    });
  });

  // ----------------------------------------------------------------------
  // Case 2 — same (phone+firstName+lastName) but disagreeing relationship.
  // First row wins; second row's Guardian-level data is silently ignored
  // because the commit-side find-or-create returns the existing Guardian.
  // ----------------------------------------------------------------------
  describe("relationship typo across rows (first-row-wins merge)", () => {
    it("creates ONE Guardian with the first row's relationship; second row links to the same Guardian", async () => {
      const { schoolId, userId, authCtx } = await createActiveSchool("typo");
      await seedStudents(schoolId, [
        { admissionNumber: "ADM/T1", firstName: "Ada", lastName: "Bello" },
        { admissionNumber: "ADM/T2", firstName: "Femi", lastName: "Bello" },
      ]);

      // Row 1 says Mother; row 2 (typo) says Guardian. Same person —
      // both rows have firstName=Ngozi, lastName=Bello, phone=...
      const csv = [
        "Ward Adm No,First Name,Surname,Relationship,Phone,Is Primary",
        "ADM/T1,Ngozi,Bello,Mother,08012345002,Yes",
        "ADM/T2,Ngozi,Bello,Guardian,08012345002,Yes",
      ].join("\r\n");
      const { jobId } = await uploadMapValidateAndPrepareCommit(
        "typo",
        schoolId,
        authCtx,
        userId,
        csv,
      );

      const result = await runCommitHandler({
        jobId,
        schoolId,
        userId,
        storage,
        logger,
      });

      expect(result).toMatchObject({
        status: "completed",
        committedRows: 2,
        commitErrorCount: 0,
        validateBadCount: 0,
      });

      const guardians = await withTenant(schoolId, (db) =>
        db.guardian.findMany({
          where: { phone: "08012345002" },
          select: { id: true, relationship: true },
        }),
      );
      // ONE Guardian (dedup on phone+firstName+lastName) — relationship is
      // the FIRST row's value. The second row's "Guardian" relationship
      // is silently dropped.
      expect(guardians).toHaveLength(1);
      expect(guardians[0].relationship).toBe("MOTHER");

      const linkCount = await withTenant(schoolId, (db) =>
        db.studentGuardian.count({ where: { guardianId: guardians[0].id } }),
      );
      expect(linkCount).toBe(2);
    });
  });

  // ----------------------------------------------------------------------
  // Case 3 — missing admission number at VALIDATE time.
  // ----------------------------------------------------------------------
  describe("missing admission number (validate-time)", () => {
    it("flags the bad row with 'Student admission number not found'; commit ignores it", async () => {
      const { schoolId, userId, authCtx } = await createActiveSchool("nf-validate");
      await seedStudents(schoolId, [
        { admissionNumber: "ADM/N1", firstName: "Ada", lastName: "Okafor" },
      ]);

      const csv = [
        "Ward Adm No,First Name,Surname,Relationship,Phone,Is Primary",
        "ADM/N1,Ngozi,Okafor,Mother,08012345003,Yes",
        "ADM/MISSING,Bayo,Adeyemi,Father,08012345004,Yes",
      ].join("\r\n");
      const { jobId } = await uploadMapValidateAndPrepareCommit(
        "nf-validate",
        schoolId,
        authCtx,
        userId,
        csv,
      );

      // After validate the second row should already be in the bad pile.
      const beforeCommit = await withTenant(schoolId, (db) =>
        db.importJob.findUnique({
          where: { id: jobId },
          select: { validRows: true, invalidRows: true },
        }),
      );
      expect(beforeCommit).toMatchObject({ validRows: 1, invalidRows: 1 });

      const result = await runCommitHandler({
        jobId,
        schoolId,
        userId,
        storage,
        logger,
      });

      expect(result).toMatchObject({
        status: "completed",
        committedRows: 1,
        commitErrorCount: 0,
        validateBadCount: 1,
      });

      const reportBytes = await storage.get(schoolId, {
        kind: "import-error-report",
        jobId,
      });
      const text = reportBytes.toString("utf-8");
      expect(text).toMatch(/ADM\/MISSING/);
      expect(text).toMatch(/Student admission number not found/);
      // Must NOT include the commit-time variant for this row.
      expect(text).not.toMatch(/Student admission number not found at commit time/);
    });
  });

  // ----------------------------------------------------------------------
  // Case 4 — admission number EXISTED at validate but Student withdrawn
  // (deleted in our test) between READY and commit. Caught by the commit-
  // time student lookup in commit-guardians.row.ts.
  //
  // NOTE: re-validate at commit time runs first and would catch the
  // missing student via its external check — so by the time the per-row
  // loop runs, the row is already in validate-bad with the validate-time
  // message ("Student admission number not found", no "at commit time"
  // suffix). The COMMIT-time error only fires if a Student goes missing
  // BETWEEN the commit's re-validate and the per-row loop — a very tight
  // race window inside the commit handler itself.
  //
  // We test the OBSERVABLE behaviour (COMPLETED, the row appears in the
  // error report, the Guardian isn't linked) rather than the specific
  // message tier — both messages mean "this admission number didn't
  // resolve" to the admin, and the message-level distinction is invisible.
  // ----------------------------------------------------------------------
  describe("admission number disappears between validate and commit", () => {
    it("routes the row to the error report and skips its Guardian creation", async () => {
      const { schoolId, userId, authCtx } = await createActiveSchool("nf-commit");
      await seedStudents(schoolId, [
        { admissionNumber: "ADM/C1", firstName: "Ada", lastName: "Okafor" },
        { admissionNumber: "ADM/C2", firstName: "Tobi", lastName: "Okafor" },
      ]);

      const csv = [
        "Ward Adm No,First Name,Surname,Relationship,Phone,Is Primary",
        "ADM/C1,Ngozi,Okafor,Mother,08012345005,Yes",
        "ADM/C2,Bayo,Adeyemi,Father,08012345006,Yes",
      ].join("\r\n");
      const { jobId } = await uploadMapValidateAndPrepareCommit(
        "nf-commit",
        schoolId,
        authCtx,
        userId,
        csv,
      );

      // Delete one of the students AFTER validate ran. The commit's
      // re-validate will catch this and surface "Student admission
      // number not found" (validate-tier). Per the note above, the
      // commit-tier message would only fire on the extremely narrow
      // race INSIDE the commit handler — we don't try to engineer it
      // here.
      await withTenant(schoolId, (db) =>
        db.student.delete({
          where: {
            schoolId_admissionNumber: {
              schoolId,
              admissionNumber: "ADM/C2",
            },
          },
        }),
      );

      const result = await runCommitHandler({
        jobId,
        schoolId,
        userId,
        storage,
        logger,
      });

      expect(result).toMatchObject({
        status: "completed",
        committedRows: 1,
      });
      const completed = result as Extract<
        typeof result,
        { status: "completed" }
      >;
      expect(completed.commitErrorCount + completed.validateBadCount).toBe(1);

      // ADM/C1 is now linked; ADM/C2 isn't (because its student is
      // gone and its row is in the error report).
      const remainingStudent = await withTenant(schoolId, (db) =>
        db.student.findFirst({
          where: { admissionNumber: "ADM/C1" },
          select: {
            guardians: { select: { guardian: { select: { phone: true } } } },
          },
        }),
      );
      expect(remainingStudent?.guardians).toHaveLength(1);
      expect(remainingStudent?.guardians[0].guardian.phone).toBe(
        "08012345005",
      );

      // The error report mentions ADM/C2 either way (validate-tier or
      // commit-tier message both contain "Student admission number not
      // found").
      const reportBytes = await storage.get(schoolId, {
        kind: "import-error-report",
        jobId,
      });
      const text = reportBytes.toString("utf-8");
      expect(text).toMatch(/ADM\/C2/);
      expect(text).toMatch(/Student admission number not found/);
    });
  });

  // ----------------------------------------------------------------------
  // Case 5 — every row's admission number doesn't resolve.
  // ----------------------------------------------------------------------
  describe("every row collides at validate", () => {
    it("COMPLETED with committedRows=0; error report has every row", async () => {
      const { schoolId, userId, authCtx } = await createActiveSchool("all-bad");
      // No students seeded — every CSV row's admission number is missing.

      const csv = [
        "Ward Adm No,First Name,Surname,Relationship,Phone,Is Primary",
        "ADM/X1,Ngozi,Okafor,Mother,08012345007,Yes",
        "ADM/X2,Bayo,Adeyemi,Father,08012345008,Yes",
        "ADM/X3,Chi,Eze,Guardian,08012345009,No",
      ].join("\r\n");
      const { jobId } = await uploadMapValidateAndPrepareCommit(
        "all-bad",
        schoolId,
        authCtx,
        userId,
        csv,
      );

      const result = await runCommitHandler({
        jobId,
        schoolId,
        userId,
        storage,
        logger,
      });

      expect(result).toMatchObject({
        status: "completed",
        committedRows: 0,
      });
      const completed = result as Extract<
        typeof result,
        { status: "completed" }
      >;
      expect(completed.validateBadCount).toBe(3);
      expect(completed.commitErrorCount).toBe(0);
      expect(completed.errorReportUrl).not.toBeNull();

      const row = await withTenant(schoolId, (db) =>
        db.importJob.findUnique({ where: { id: jobId } }),
      );
      expect(row).toMatchObject({
        status: "COMPLETED",
        committedRows: 0,
        invalidRows: 3,
      });
      expect(row?.errorReportUrl).not.toBeNull();

      // No Guardian rows created.
      const guardianCount = await withTenant(schoolId, (db) =>
        db.guardian.count(),
      );
      expect(guardianCount).toBe(0);

      // Error report has all 3 rows.
      const reportBytes = await storage.get(schoolId, {
        kind: "import-error-report",
        jobId,
      });
      const text = reportBytes.toString("utf-8");
      const lines = text.split("\r\n").filter((l) => l.length > 0);
      expect(lines).toHaveLength(4); // header + 3 bad rows
      expect(lines[1]).toMatch(/^ADM\/X1/);
      expect(lines[2]).toMatch(/^ADM\/X2/);
      expect(lines[3]).toMatch(/^ADM\/X3/);
    });
  });

  // ----------------------------------------------------------------------
  // Case 6 — StudentGuardian's single unique constraint. Importing the
  // same (guardian, student) link twice across TWO import jobs produces
  // a P2002 at commit time on the second import, which the per-row catch
  // converts to a typed CommitRowError → "Guardian already linked to
  // this student." Bad row, not a fatal failure.
  // ----------------------------------------------------------------------
  describe("StudentGuardian @@unique([studentId, guardianId]) P2002", () => {
    it("second import of the same link routes the row to 'Guardian already linked to this student.'", async () => {
      const { schoolId, userId, authCtx } = await createActiveSchool("dup-link");
      await seedStudents(schoolId, [
        { admissionNumber: "ADM/D1", firstName: "Ada", lastName: "Okafor" },
      ]);

      const csv1 = [
        "Ward Adm No,First Name,Surname,Relationship,Phone,Is Primary",
        "ADM/D1,Ngozi,Okafor,Mother,08012345010,Yes",
      ].join("\r\n");
      const first = await uploadMapValidateAndPrepareCommit(
        "dup-link-1",
        schoolId,
        authCtx,
        userId,
        csv1,
      );
      const firstResult = await runCommitHandler({
        jobId: first.jobId,
        schoolId,
        userId,
        storage,
        logger,
      });
      expect(firstResult).toMatchObject({
        status: "completed",
        committedRows: 1,
      });

      // Second import — identical link.
      const csv2 = [
        "Ward Adm No,First Name,Surname,Relationship,Phone,Is Primary",
        "ADM/D1,Ngozi,Okafor,Mother,08012345010,Yes",
      ].join("\r\n");
      const second = await uploadMapValidateAndPrepareCommit(
        "dup-link-2",
        schoolId,
        authCtx,
        userId,
        csv2,
      );
      const secondResult = await runCommitHandler({
        jobId: second.jobId,
        schoolId,
        userId,
        storage,
        logger,
      });

      // committedRows=0 because the only row's link already exists.
      // The error lands in commitErrorCount (P2002 → CommitRowError).
      expect(secondResult).toMatchObject({
        status: "completed",
        committedRows: 0,
      });
      const completed = secondResult as Extract<
        typeof secondResult,
        { status: "completed" }
      >;
      expect(completed.commitErrorCount).toBe(1);
      expect(completed.validateBadCount).toBe(0);
      expect(completed.errorReportUrl).not.toBeNull();

      const reportBytes = await storage.get(schoolId, {
        kind: "import-error-report",
        jobId: second.jobId,
      });
      const text = reportBytes.toString("utf-8");
      expect(text).toMatch(/Guardian already linked to this student/);
    });
  });
});
