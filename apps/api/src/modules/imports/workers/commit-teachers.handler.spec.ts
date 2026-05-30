import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Logger } from "@nestjs/common";
import * as crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { basePrisma, withTenant } from "@school-kit/db";

import { FilesystemStorageDriver } from "../../../common/storage/filesystem-storage.driver";
import { StorageService } from "../../../common/storage/storage.service";
import { AuthService } from "../../auth/auth.service";
import { ImportsService } from "../imports.service";
import { runCommitHandler } from "./commit.handler";
import { ImportsProcessor } from "./imports.processor";

// Integration spec for the slice-10 cp2 TEACHER commit pipeline. Drives a
// CSV through upload → mapping → validate → commit end-to-end, asserting on
// the seven cases in the cp2 task:
//
//   1. Happy path — 5-row CSV → 5 Invitations + one teacher.import.commit
//      audit row.
//   2. Duplicate email in file — row 2 same email as row 1 → row 2 bad
//      ("Duplicate email with row 1"); row 1 commits.
//   3. Email already exists as a User — bad ("User already exists with
//      this email"); validate-tier.
//   4. Invalid email format — bad with the email format error.
//   5. Missing required field (firstName) — bad ("firstName required").
//   6. Every-row-collides — every email already a User → COMPLETED,
//      committedRows=0, error report has all rows.
//   7. Pending invitation already exists for the email — commit-tier bad
//      ("Invitation already exists for this email"). This is the
//      schema-faithful version of "the invitation uniqueness still
//      handled": invitations have NO (email, schoolId) unique, so the
//      guard is application-level (mirrors UsersService INVITATION_ALREADY_
//      PENDING), not a P2002.

let phoneCounter = 0;
function randomPhone(): string {
  phoneCounter += 1;
  const random = Math.floor(Math.random() * 1_000_000_00)
    .toString()
    .padStart(8, "0");
  return `+23468${(phoneCounter % 100).toString().padStart(2, "0")}${random}`;
}

function fakeValidateJob(data: {
  schoolId: string;
  userId: string;
  jobId: string;
  type: "STUDENTS" | "GUARDIANS" | "TEACHERS";
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

function makeMockQueue() {
  const calls: Array<{ name: string; data: unknown; options: unknown }> = [];
  return {
    calls,
    add: vi.fn(async (name: string, data: unknown, options: unknown) => {
      calls.push({ name, data, options: options ?? {} });
      return { id: `mock-job-${calls.length}` };
    }),
  };
}

describe("Teacher commit handler (slice 10 cp2)", () => {
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
    storageRoot = mkdtempSync(join(tmpdir(), "schoolkit-teacher-spec-"));
    const driver = new FilesystemStorageDriver(storageRoot);
    storage = new StorageService(driver);
    mockQueue = makeMockQueue();
    importsService = new ImportsService(storage, mockQueue as never);
    processor = new ImportsProcessor(storage);
    logger = new Logger("commit-teacher-spec");
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
        schoolName: `Teacher Spec ${suffix}`,
        schoolSlug: `tc-${suffix}-${runId}`,
        ownerFirstName: "Tola",
        ownerLastName: "Owner",
        ownerEmail: `tc-owner-${suffix}-${runId}@example.test`,
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

  const mapping = {
    columnMapping: {
      Email: "email",
      "First Name": "firstName",
      Surname: "lastName",
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
    const uploaded = await importsService.uploadTeachers(
      authCtx,
      { buffer, originalname: `${suffix}.csv`, size: buffer.length },
      reqCtx,
    );
    await importsService.applyMapping(authCtx, uploaded.jobId, mapping, reqCtx);
    await processor.process(
      fakeValidateJob({ schoolId, userId, jobId: uploaded.jobId, type: "TEACHERS" }),
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

  function teacherEmails(schoolId: string) {
    return withTenant(schoolId, (db) =>
      db.invitation.findMany({
        where: { roleKey: "teacher" },
        select: { email: true, firstName: true, lastName: true, roleKey: true },
        orderBy: { email: "asc" },
      }),
    );
  }

  // ----------------------------------------------------------------------
  // Case 1 — happy path: 5 rows → 5 invitations + audit.
  // ----------------------------------------------------------------------
  it("creates one Invitation per row and writes a teacher.import.commit audit", async () => {
    const { schoolId, userId, authCtx } = await createActiveSchool("happy");
    const csv = [
      "Email,First Name,Surname",
      `t1-${runId}@school.test,Ada,Bello`,
      `t2-${runId}@school.test,Bola,Cole`,
      `t3-${runId}@school.test,Chidi,Dada`,
      `t4-${runId}@school.test,Deji,Eze`,
      `t5-${runId}@school.test,Efe,Femi`,
    ].join("\r\n");
    const { jobId } = await uploadMapValidateAndPrepareCommit(
      "happy",
      schoolId,
      authCtx,
      userId,
      csv,
    );

    const result = await runCommitHandler({ jobId, schoolId, userId, storage, logger });
    expect(result).toMatchObject({
      status: "completed",
      committedRows: 5,
      commitErrorCount: 0,
      validateBadCount: 0,
      errorReportUrl: null,
    });

    const invitations = await teacherEmails(schoolId);
    expect(invitations).toHaveLength(5);
    expect(invitations.every((i) => i.roleKey === "teacher")).toBe(true);
    expect(invitations[0]).toMatchObject({ firstName: "Ada", lastName: "Bello" });

    const audit = await withTenant(schoolId, (db) =>
      db.auditLog.findFirst({
        where: { action: "teacher.import.commit", entityId: jobId },
      }),
    );
    expect(audit).toBeTruthy();
    expect(audit?.metadata).toMatchObject({ committedRows: 5 });
  });

  // ----------------------------------------------------------------------
  // Case 2 — duplicate email in file: row 2 bad, row 1 commits.
  // ----------------------------------------------------------------------
  it("flags a duplicate email in the file; the first row still commits", async () => {
    const { schoolId, userId, authCtx } = await createActiveSchool("dupfile");
    const dup = `dup-${runId}@school.test`;
    const csv = [
      "Email,First Name,Surname",
      `${dup},Ada,Bello`,
      `${dup},Ada,Bello`,
    ].join("\r\n");
    const { jobId } = await uploadMapValidateAndPrepareCommit(
      "dupfile",
      schoolId,
      authCtx,
      userId,
      csv,
    );

    const result = await runCommitHandler({ jobId, schoolId, userId, storage, logger });
    expect(result).toMatchObject({
      status: "completed",
      committedRows: 1,
      validateBadCount: 1,
      commitErrorCount: 0,
    });

    const invitations = await teacherEmails(schoolId);
    expect(invitations).toHaveLength(1);

    const reportBytes = await storage.get(schoolId, {
      kind: "import-error-report",
      jobId,
    });
    expect(reportBytes.toString("utf-8")).toMatch(/Duplicate email with row 1/);
  });

  // ----------------------------------------------------------------------
  // Case 3 — email already a User (validate-tier).
  // ----------------------------------------------------------------------
  it("flags a row whose email already belongs to a User in the school", async () => {
    const { schoolId, userId, authCtx } = await createActiveSchool("userexists");
    const taken = `existing-${runId}@school.test`;
    await withTenant(schoolId, (db) =>
      db.user.create({
        data: { schoolId, email: taken, firstName: "Already", lastName: "Here" },
      }),
    );

    const csv = [
      "Email,First Name,Surname",
      `${taken},Ada,Bello`,
      `fresh-${runId}@school.test,Bola,Cole`,
    ].join("\r\n");
    const { jobId } = await uploadMapValidateAndPrepareCommit(
      "userexists",
      schoolId,
      authCtx,
      userId,
      csv,
    );

    const result = await runCommitHandler({ jobId, schoolId, userId, storage, logger });
    expect(result).toMatchObject({
      status: "completed",
      committedRows: 1,
      validateBadCount: 1,
    });

    const reportBytes = await storage.get(schoolId, {
      kind: "import-error-report",
      jobId,
    });
    expect(reportBytes.toString("utf-8")).toMatch(
      /User already exists with this email/,
    );
  });

  // ----------------------------------------------------------------------
  // Case 4 — invalid email format.
  // ----------------------------------------------------------------------
  it("flags an invalid email format as a bad row", async () => {
    const { schoolId, userId, authCtx } = await createActiveSchool("bademail");
    const csv = [
      "Email,First Name,Surname",
      "not-an-email,Ada,Bello",
      `ok-${runId}@school.test,Bola,Cole`,
    ].join("\r\n");
    const { jobId } = await uploadMapValidateAndPrepareCommit(
      "bademail",
      schoolId,
      authCtx,
      userId,
      csv,
    );

    const beforeCommit = await withTenant(schoolId, (db) =>
      db.importJob.findUnique({
        where: { id: jobId },
        select: { validRows: true, invalidRows: true },
      }),
    );
    expect(beforeCommit).toMatchObject({ validRows: 1, invalidRows: 1 });

    const result = await runCommitHandler({ jobId, schoolId, userId, storage, logger });
    expect(result).toMatchObject({ status: "completed", committedRows: 1 });

    const reportBytes = await storage.get(schoolId, {
      kind: "import-error-report",
      jobId,
    });
    const text = reportBytes.toString("utf-8");
    expect(text).toMatch(/not-an-email/);
    expect(text).toMatch(/valid email/);
  });

  // ----------------------------------------------------------------------
  // Case 5 — missing required firstName.
  // ----------------------------------------------------------------------
  it("flags a row missing firstName with 'firstName required'", async () => {
    const { schoolId, userId, authCtx } = await createActiveSchool("missing");
    const csv = [
      "Email,First Name,Surname",
      `nofirst-${runId}@school.test,,Bello`,
      `withfirst-${runId}@school.test,Bola,Cole`,
    ].join("\r\n");
    const { jobId } = await uploadMapValidateAndPrepareCommit(
      "missing",
      schoolId,
      authCtx,
      userId,
      csv,
    );

    const result = await runCommitHandler({ jobId, schoolId, userId, storage, logger });
    expect(result).toMatchObject({ status: "completed", committedRows: 1 });

    const reportBytes = await storage.get(schoolId, {
      kind: "import-error-report",
      jobId,
    });
    expect(reportBytes.toString("utf-8")).toMatch(/firstName required/);
  });

  // ----------------------------------------------------------------------
  // Case 6 — every row's email already a User → COMPLETED, 0 committed.
  // ----------------------------------------------------------------------
  it("every-row-collides: COMPLETED with committedRows=0 and an error report of all rows", async () => {
    const { schoolId, userId, authCtx } = await createActiveSchool("allbad");
    const emails = [
      `a-${runId}@school.test`,
      `b-${runId}@school.test`,
      `c-${runId}@school.test`,
    ];
    await withTenant(schoolId, async (db) => {
      for (const [i, email] of emails.entries()) {
        await db.user.create({
          data: { schoolId, email, firstName: `U${i}`, lastName: "Existing" },
        });
      }
    });

    const csv = [
      "Email,First Name,Surname",
      `${emails[0]},Ada,Bello`,
      `${emails[1]},Bola,Cole`,
      `${emails[2]},Chidi,Dada`,
    ].join("\r\n");
    const { jobId } = await uploadMapValidateAndPrepareCommit(
      "allbad",
      schoolId,
      authCtx,
      userId,
      csv,
    );

    const result = await runCommitHandler({ jobId, schoolId, userId, storage, logger });
    expect(result).toMatchObject({ status: "completed", committedRows: 0 });
    const completed = result as Extract<typeof result, { status: "completed" }>;
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

    // No teacher invitations created.
    const invitations = await teacherEmails(schoolId);
    expect(invitations).toHaveLength(0);

    const reportBytes = await storage.get(schoolId, {
      kind: "import-error-report",
      jobId,
    });
    const lines = reportBytes
      .toString("utf-8")
      .split("\r\n")
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(4); // header + 3 bad rows
  });

  // ----------------------------------------------------------------------
  // Case 7 — pending invitation already exists for the email (commit-tier).
  // The invitation uniqueness is application-level (no (email, schoolId)
  // unique), so this is a findFirst guard in commit-teachers.row.ts, not a
  // P2002.
  // ----------------------------------------------------------------------
  it("routes a row whose email already has a pending invitation to a commit-tier bad row", async () => {
    const { schoolId, userId, authCtx } = await createActiveSchool("pending");
    const email = `pending-${runId}@school.test`;

    // Pre-create a pending (unaccepted, unexpired) teacher invitation for
    // the email. The validate engine won't catch this (no User exists yet),
    // so the row passes validate and the commit-row guard rejects it.
    await withTenant(schoolId, (db) =>
      db.invitation.create({
        data: {
          schoolId,
          email,
          firstName: "Pre",
          lastName: "Existing",
          roleKey: "teacher",
          tokenHash: crypto.randomBytes(32).toString("hex"),
          invitedBy: userId,
          expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        },
      }),
    );

    const csv = [
      "Email,First Name,Surname",
      `${email},Ada,Bello`,
      `other-${runId}@school.test,Bola,Cole`,
    ].join("\r\n");
    const { jobId } = await uploadMapValidateAndPrepareCommit(
      "pending",
      schoolId,
      authCtx,
      userId,
      csv,
    );

    const result = await runCommitHandler({ jobId, schoolId, userId, storage, logger });
    expect(result).toMatchObject({
      status: "completed",
      committedRows: 1, // the "other" row
      validateBadCount: 0, // pending-invite passes validate
      commitErrorCount: 1, // ...and fails at commit
    });

    const reportBytes = await storage.get(schoolId, {
      kind: "import-error-report",
      jobId,
    });
    expect(reportBytes.toString("utf-8")).toMatch(
      /Invitation already exists for this email/,
    );

    // Exactly two teacher invitations now: the pre-existing one + the
    // "other" row's. The colliding CSV row did NOT create a second.
    const invitations = await teacherEmails(schoolId);
    expect(invitations).toHaveLength(2);
  });
});
