import { Prisma, type PrismaClient } from "@school-kit/db";
import type { GuardianImportRow } from "@school-kit/types";

// Typed commit-time row error. Thrown by per-type commit-row functions
// when a SPECIFIC, recoverable per-row failure happens (student lookup
// missing, link already exists). The outer commit.handler.ts catch
// converts to a bad-row entry with `field` + `message`.
//
// Distinct from PrismaClientKnownRequestError, which is the generic
// catch-all — describeCommitFailure() in commit.handler.ts maps those
// to safe messages.
export class CommitRowError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "CommitRowError";
  }
}

// Per-row commit for GUARDIANS. Three operations in one tx (the outer
// loop wraps in withTenant), so a failure at any step rolls back the
// other two:
//
//   1. Resolve studentAdmissionNumber → Student.id. Missing → commit-
//      time bad row "Student admission number not found at commit time."
//      (Rare — validate already caught most of these; only a student
//      withdrawn / deleted between READY and commit reaches here.)
//   2. Find-or-create Guardian on (phone, firstName, lastName) per
//      slice 8's dedup key. Schema has NO unique on these columns by
//      design (slice 5 schema comment: parents commonly share phone+
//      lastName), so this is a manual findFirst + create rather than
//      Prisma's native upsert. The dedup key uses firstName too so
//      Mr. and Mrs. Okonkwo at the same household phone are kept
//      separate — diverges from the spec's (phone+lastName) for the
//      correctness reason flagged in cp1 report.
//   3. Create StudentGuardian link. StudentGuardian has exactly ONE
//      unique constraint: @@unique([studentId, guardianId]). A P2002
//      here means this Guardian is already linked to this Student —
//      ALSO commit-time bad row, with the message "Guardian already
//      linked to this student."
//
// When two CSV rows share the guardianKey but DISAGREE on relationship
// (or any other Guardian-level field), the FIRST-row's values are
// preserved because the find-or-create returns the existing row and
// step 2's create only runs on the first occurrence. Same first-wins
// merge-conflict policy as distributed-systems sync. Flagged in cp1.
export async function commitGuardianRow(
  row: GuardianImportRow,
  schoolId: string,
  db: PrismaClient,
): Promise<void> {
  // 1. Resolve student by admission number.
  const student = await db.student.findUnique({
    where: {
      schoolId_admissionNumber: {
        schoolId,
        admissionNumber: row.studentAdmissionNumber,
      },
    },
    select: { id: true },
  });
  if (!student) {
    throw new CommitRowError(
      "studentAdmissionNumber",
      "Student admission number not found at commit time.",
    );
  }

  // 2. Find-or-create Guardian on (phone, firstName, lastName).
  //
  // No native upsert because no unique index — findFirst + create.
  // Race-condition: between findFirst and create, another worker
  // attempt (BullMQ retry post-crash) could create the same Guardian.
  // We don't worry about it: an extra Guardian row is not incorrect
  // data, just a duplicate that admins can merge later. Idempotent
  // commit retries are guaranteed by the StudentGuardian @@unique on
  // (studentId, guardianId) — even if two Guardians get created,
  // both would create a StudentGuardian link to the same student, and
  // the second link's create catches P2002.
  let guardianId: string;
  const existing = await db.guardian.findFirst({
    where: {
      phone: row.phone,
      firstName: row.firstName,
      lastName: row.lastName,
    },
    select: { id: true },
  });
  if (existing) {
    guardianId = existing.id;
  } else {
    const created = await db.guardian.create({
      data: {
        schoolId,
        firstName: row.firstName,
        lastName: row.lastName,
        relationship: row.relationship,
        phone: row.phone,
        email: row.email ?? null,
        occupation: row.occupation ?? null,
        employer: row.employer ?? null,
        address: row.address ?? null,
        notes: row.notes ?? null,
      },
      select: { id: true },
    });
    guardianId = created.id;
  }

  // 3. Create the StudentGuardian link.
  try {
    await db.studentGuardian.create({
      data: {
        schoolId,
        studentId: student.id,
        guardianId,
        isPrimary: row.isPrimary ?? false,
        canPickup: row.canPickup ?? true,
      },
    });
  } catch (e) {
    if (
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === "P2002"
    ) {
      throw new CommitRowError(
        "studentAdmissionNumber",
        "Guardian already linked to this student.",
      );
    }
    throw e;
  }
}
