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

// Student CSV import — class-arm column + enrollment creation (2026-08-09).
// Plan-first: docs/modules/student-import-enrollment.md
//
// Same real-DB, real-storage, real-pipeline discipline as
// commit.handler.spec.ts: upload → map → validate → commit, invoked
// directly rather than through BullMQ.
//
// The assertions that actually matter here, in rough order of consequence:
//
//   1. AMBIGUITY IS A HARD ERROR. ClassArm is @@unique on
//      (schoolId, classLevelId, code) — on CODE, scoped PER LEVEL — and
//      `name` carries no uniqueness constraint at all. So "JSS 1A" can match
//      several arms, and guessing would enrol children into the WRONG CLASS,
//      propagating into attendance, grades and invoices before anyone
//      noticed. Constructed here by creating a second arm that shares a name
//      under a different level, which the schema permits.
//   2. A ROW IS ALL-OR-NOTHING. If the enrollment fails, the student must
//      not exist either — otherwise we produce exactly the orphaned-student
//      state this feature exists to eliminate.
//   3. BACKWARD COMPATIBILITY. An unmapped column behaves exactly as before.
//      (The pre-existing specs in commit.handler.spec.ts are the real proof
//      of this — they were not modified for this feature. This spec adds an
//      explicit statement of the same fact.)

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00)
    .toString()
    .padStart(8, "0");
  return `+23468${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

function makeMockQueue() {
  return { add: vi.fn(async () => ({ id: "mock-job" })) };
}

function fakeValidateJob(data: {
  schoolId: string;
  userId: string;
  jobId: string;
}) {
  return {
    id: `test-${Math.random().toString(36).slice(2, 8)}`,
    name: "validate",
    data: { ...data, type: "STUDENTS" as const },
    queueName: "imports",
    attemptsMade: 0,
    opts: { attempts: 3 },
  } as unknown as Parameters<typeof ImportsProcessor.prototype.process>[0];
}

const HEADER = "Adm No,First Name,Surname,DOB,Sex,Class\n";

describe("student import — class arm + enrollment (2026-08-09)", () => {
  const runId = Math.random().toString(36).slice(2, 8);
  const reqCtx = { ipAddress: "127.0.0.1", userAgent: "vitest" };
  const authService = new AuthService();
  const schoolIdsToCleanup = new Set<string>();
  let storageRoot: string;
  let storage: StorageService;
  let importsService: ImportsService;
  let processor: ImportsProcessor;
  let logger: Logger;

  beforeAll(() => {
    storageRoot = mkdtempSync(join(tmpdir(), "schoolkit-arm-spec-"));
    storage = new StorageService(new FilesystemStorageDriver(storageRoot));
    importsService = new ImportsService(storage, makeMockQueue() as never);
    processor = new ImportsProcessor(storage);
    logger = new Logger("class-arm-spec");
  });

  afterAll(async () => {
    for (const id of schoolIdsToCleanup) {
      await basePrisma.school.delete({ where: { id } }).catch(() => undefined);
    }
    await basePrisma.$disconnect();
    rmSync(storageRoot, { force: true, recursive: true });
  });

  // A school signup seeds 14 class levels, each with one default arm named
  // `${levelName}A` — so "JSS 1A" exists without any extra setup. Terms are
  // NOT seeded, so we create a year + term for the enrollment target.
  async function createSchoolWithTerm(suffix: string) {
    const signed = await authService.signupOwner(
      {
        schoolName: `Arm Spec ${suffix}`,
        schoolSlug: `arm-${suffix}-${runId}`,
        ownerFirstName: "Ada",
        ownerLastName: "Owner",
        ownerEmail: `arm-${suffix}-${runId}@example.test`,
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

    const { termId, armId } = await withTenant(signed.school.id, async (db) => {
      const year = await db.academicYear.create({
        data: {
          schoolId: signed.school.id,
          label: "2025/2026",
          startDate: new Date("2025-09-01"),
          endDate: new Date("2026-07-31"),
          isCurrent: true,
        },
        select: { id: true },
      });
      const term = await db.term.create({
        data: {
          schoolId: signed.school.id,
          academicYearId: year.id,
          sequence: 1,
          name: "First Term",
          startDate: new Date("2025-09-01"),
          endDate: new Date("2025-12-15"),
          isCurrent: true,
        },
        select: { id: true },
      });
      const arm = await db.classArm.findFirst({
        where: { name: "JSS 1A" },
        select: { id: true },
      });
      return { termId: term.id, armId: arm!.id };
    });

    return {
      schoolId: signed.school.id,
      userId: signed.user.id,
      termId,
      armId,
      authCtx: {
        sessionId: "sess-placeholder",
        userId: signed.user.id,
        schoolId: signed.school.id,
      },
    };
  }

  function mappingWithArm(targetTermId: string | undefined) {
    return {
      columnMapping: {
        "Adm No": "admissionNumber",
        "First Name": "firstName",
        Surname: "lastName",
        DOB: "dateOfBirth",
        Sex: "gender",
        Class: "classArm",
      },
      options: {
        dateFormat: "YYYY-MM-DD" as const,
        treatBlankAs: "skip" as const,
        ...(targetTermId ? { targetTermId } : {}),
      },
    };
  }

  async function runPipeline(
    ctx: Awaited<ReturnType<typeof createSchoolWithTerm>>,
    suffix: string,
    csvText: string,
    // `unknown`, matching applyMapping's own parameter — the service
    // validates the payload itself, and typing this concretely would force
    // a cast in the "column deliberately unmapped" case (where a value is
    // null rather than a target-field literal).
    mapping: unknown,
    beforeCommit?: () => Promise<void>,
  ) {
    const buffer = Buffer.from(csvText, "utf-8");
    const uploaded = await importsService.uploadStudents(
      ctx.authCtx,
      { buffer, originalname: `${suffix}.csv`, size: buffer.length },
      reqCtx,
    );
    await importsService.applyMapping(
      ctx.authCtx,
      uploaded.jobId,
      mapping,
      reqCtx,
    );
    await processor.process(
      fakeValidateJob({
        schoolId: ctx.schoolId,
        userId: ctx.userId,
        jobId: uploaded.jobId,
      }),
    );

    if (beforeCommit) await beforeCommit();

    await withTenant(ctx.schoolId, async (db) => {
      await db.importJob.update({
        where: { id: uploaded.jobId },
        data: { status: "COMMITTING" },
      });
    });

    const result = await runCommitHandler({
      jobId: uploaded.jobId,
      schoolId: ctx.schoolId,
      userId: ctx.userId,
      storage,
      logger,
    });
    return { jobId: uploaded.jobId, result };
  }

  it("happy path: a mapped, valid arm creates the Student AND the Enrollment", async () => {
    const ctx = await createSchoolWithTerm("happy");
    const csv = HEADER + "ARM/001,Chidi,Okeke,2012-09-15,M,JSS 1A\n";

    const { result } = await runPipeline(
      ctx,
      "happy",
      csv,
      mappingWithArm(ctx.termId),
    );

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.committedRows).toBe(1);
    expect(result.notEnrolledRows).toBe(0);

    await withTenant(ctx.schoolId, async (db) => {
      const student = await db.student.findFirst({
        where: { admissionNumber: "ARM/001" },
        select: { id: true },
      });
      expect(student).not.toBeNull();

      const enrollment = await db.enrollment.findFirst({
        where: { studentId: student!.id },
        select: { classArmId: true, termId: true, status: true },
      });
      expect(enrollment).not.toBeNull();
      expect(enrollment!.classArmId).toBe(ctx.armId);
      expect(enrollment!.termId).toBe(ctx.termId);
      expect(enrollment!.status).toBe("ENROLLED");
    });
  });

  it("matches the arm name case-insensitively", async () => {
    const ctx = await createSchoolWithTerm("case");
    const csv = HEADER + "ARM/002,Ngozi,Eze,2012-09-15,F,jss 1a\n";

    const { result } = await runPipeline(
      ctx,
      "case",
      csv,
      mappingWithArm(ctx.termId),
    );

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.committedRows).toBe(1);

    await withTenant(ctx.schoolId, async (db) => {
      const count = await db.enrollment.count({
        where: { classArmId: ctx.armId },
      });
      expect(count).toBe(1);
    });
  });

  it("an unknown arm name is a row error — the student is NOT created", async () => {
    const ctx = await createSchoolWithTerm("unknown");
    const csv = HEADER + "ARM/003,Bola,Ade,2012-09-15,M,JSS 9Z\n";

    const { result } = await runPipeline(
      ctx,
      "unknown",
      csv,
      mappingWithArm(ctx.termId),
    );

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.committedRows).toBe(0);
    expect(result.validateBadCount).toBe(1);

    await withTenant(ctx.schoolId, async (db) => {
      const student = await db.student.findFirst({
        where: { admissionNumber: "ARM/003" },
      });
      expect(student).toBeNull();
    });
  });

  // THE headline case. ClassArm.name has no uniqueness constraint, so this
  // state is reachable in any real school; silently picking one would put a
  // child in the wrong class.
  it("an AMBIGUOUS arm name is a hard row error, never a silent best-guess", async () => {
    const ctx = await createSchoolWithTerm("ambig");

    // Create a second arm named "JSS 1A" under a DIFFERENT level. The
    // schema permits this: uniqueness is (schoolId, classLevelId, code).
    await withTenant(ctx.schoolId, async (db) => {
      const otherLevel = await db.classLevel.findFirst({
        where: { code: "jss2" },
        select: { id: true },
      });
      await db.classArm.create({
        data: {
          schoolId: ctx.schoolId,
          classLevelId: otherLevel!.id,
          name: "JSS 1A", // same NAME, different level — legal
          code: "jss2-dupe-name",
          isActive: true,
        },
      });
    });

    const csv = HEADER + "ARM/004,Emeka,Nwosu,2012-09-15,M,JSS 1A\n";
    const { result } = await runPipeline(
      ctx,
      "ambig",
      csv,
      mappingWithArm(ctx.termId),
    );

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.committedRows).toBe(0);
    expect(result.validateBadCount).toBe(1);

    await withTenant(ctx.schoolId, async (db) => {
      expect(
        await db.student.findFirst({ where: { admissionNumber: "ARM/004" } }),
      ).toBeNull();
      // Crucially: nothing was enrolled into EITHER candidate arm.
      expect(await db.enrollment.count()).toBe(0);
    });
  });

  it("an inactive arm is a row error", async () => {
    const ctx = await createSchoolWithTerm("inactive");
    await withTenant(ctx.schoolId, async (db) => {
      await db.classArm.update({
        where: { id: ctx.armId },
        data: { isActive: false },
      });
    });

    const csv = HEADER + "ARM/005,Tunde,Bello,2012-09-15,M,JSS 1A\n";
    const { result } = await runPipeline(
      ctx,
      "inactive",
      csv,
      mappingWithArm(ctx.termId),
    );

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.committedRows).toBe(0);
    expect(result.validateBadCount).toBe(1);
  });

  it("a blank arm cell creates the student WITHOUT an enrollment, and is counted", async () => {
    const ctx = await createSchoolWithTerm("blank");
    const csv =
      HEADER +
      "ARM/006,Amaka,Obi,2012-09-15,F,JSS 1A\n" +
      "ARM/007,Sade,Lawal,2012-09-15,F,\n";

    const { result } = await runPipeline(
      ctx,
      "blank",
      csv,
      mappingWithArm(ctx.termId),
    );

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.committedRows).toBe(2);
    // The blank-cell row is NOT an error — it is an un-enrolled student.
    expect(result.notEnrolledRows).toBe(1);

    await withTenant(ctx.schoolId, async (db) => {
      expect(await db.student.count()).toBe(2);
      expect(await db.enrollment.count()).toBe(1);
    });
  });

  // D6's load-bearing assertion.
  it("arm deactivated BETWEEN validate and commit: the row fails and leaves NO orphaned student", async () => {
    const ctx = await createSchoolWithTerm("race");
    const csv = HEADER + "ARM/008,Ifeanyi,Udo,2012-09-15,M,JSS 1A\n";

    const { result } = await runPipeline(
      ctx,
      "race",
      csv,
      mappingWithArm(ctx.termId),
      // Runs after validate said the arm was fine, before commit.
      async () => {
        await withTenant(ctx.schoolId, async (db) => {
          await db.classArm.update({
            where: { id: ctx.armId },
            data: { isActive: false },
          });
        });
      },
    );

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.committedRows).toBe(0);

    // The row is rejected — but by RE-VALIDATE, not by the commit-row guard.
    // runCommitHandler re-runs the whole validation engine before its row
    // loop, so a mutation landing before that pass is caught there and shows
    // up in validateBadCount, with commitErrorCount staying 0. This mirrors
    // exactly what commit.handler.spec.ts already documents for
    // admission-number collisions ("my impl pre-empts commit-time collisions
    // via re-validate's external dedup").
    //
    // Asserting the SUM rather than either counter is the honest expectation:
    // the guarantee this test exists for is "the row does not commit and
    // leaves nothing behind", not which of the two layers caught it. The
    // commit-row guard is still load-bearing — it covers a mutation landing
    // in the millisecond gap AFTER re-validate — but that window can't be
    // driven deterministically from a test.
    expect(result.validateBadCount + result.commitErrorCount).toBe(1);

    await withTenant(ctx.schoolId, async (db) => {
      // The whole point: no student exists. A student with no class is the
      // state this feature exists to prevent.
      expect(
        await db.student.findFirst({ where: { admissionNumber: "ARM/008" } }),
      ).toBeNull();
      expect(await db.enrollment.count()).toBe(0);
    });
  });

  it("column unmapped: students import with no enrollments — unchanged pre-2026-08-09 behaviour", async () => {
    const ctx = await createSchoolWithTerm("unmapped");
    const csv = HEADER + "ARM/009,Kemi,Ojo,2012-09-15,F,JSS 1A\n";

    // Class column present in the file but deliberately NOT mapped, and no
    // targetTermId supplied — the pre-feature shape.
    const { result } = await runPipeline(ctx, "unmapped", csv, {
      columnMapping: {
        "Adm No": "admissionNumber",
        "First Name": "firstName",
        Surname: "lastName",
        DOB: "dateOfBirth",
        Sex: "gender",
        Class: null,
      },
      options: {
        dateFormat: "YYYY-MM-DD" as const,
        treatBlankAs: "skip" as const,
      },
    });

    expect(result.status).toBe("completed");
    if (result.status !== "completed") return;
    expect(result.committedRows).toBe(1);
    expect(result.notEnrolledRows).toBe(1);

    await withTenant(ctx.schoolId, async (db) => {
      expect(await db.student.count()).toBe(1);
      expect(await db.enrollment.count()).toBe(0);
    });
  });

  describe("mapping-submit preconditions (D4)", () => {
    it("mapping the arm column WITHOUT a target term is rejected — no silent default", async () => {
      const ctx = await createSchoolWithTerm("noterm");
      const csv = HEADER + "ARM/010,Uche,Nnamdi,2012-09-15,M,JSS 1A\n";
      const buffer = Buffer.from(csv, "utf-8");
      const uploaded = await importsService.uploadStudents(
        ctx.authCtx,
        { buffer, originalname: "noterm.csv", size: buffer.length },
        reqCtx,
      );

      await expect(
        importsService.applyMapping(
          ctx.authCtx,
          uploaded.jobId,
          mappingWithArm(undefined),
          reqCtx,
        ),
      ).rejects.toMatchObject({ code: "TARGET_TERM_REQUIRED" });
    });

    it("a target term that doesn't exist is rejected at mapping-submit", async () => {
      const ctx = await createSchoolWithTerm("badterm");
      const csv = HEADER + "ARM/011,Zainab,Musa,2012-09-15,F,JSS 1A\n";
      const buffer = Buffer.from(csv, "utf-8");
      const uploaded = await importsService.uploadStudents(
        ctx.authCtx,
        { buffer, originalname: "badterm.csv", size: buffer.length },
        reqCtx,
      );

      await expect(
        importsService.applyMapping(
          ctx.authCtx,
          uploaded.jobId,
          mappingWithArm("00000000-0000-4000-8000-000000000000"),
          reqCtx,
        ),
      ).rejects.toMatchObject({ code: "TARGET_TERM_NOT_FOUND" });
    });

    it("a school with no active class arms is rejected once, not per row", async () => {
      const ctx = await createSchoolWithTerm("noarms");
      await withTenant(ctx.schoolId, async (db) => {
        await db.classArm.updateMany({ data: { isActive: false } });
      });

      const csv = HEADER + "ARM/012,Yusuf,Sani,2012-09-15,M,JSS 1A\n";
      const buffer = Buffer.from(csv, "utf-8");
      const uploaded = await importsService.uploadStudents(
        ctx.authCtx,
        { buffer, originalname: "noarms.csv", size: buffer.length },
        reqCtx,
      );

      await expect(
        importsService.applyMapping(
          ctx.authCtx,
          uploaded.jobId,
          mappingWithArm(ctx.termId),
          reqCtx,
        ),
      ).rejects.toMatchObject({ code: "NO_CLASS_ARMS" });
    });
  });
});
