import type { PrismaClient } from "@school-kit/db";
import type { StudentImportRow } from "@school-kit/types";

import { CommitRowError } from "./commit-guardians.row";

// Per-row commit for STUDENTS. The outer commit.handler.ts loop wraps this
// in its own withTenant() tx so a P2002 (race-condition admission_number
// collision) only rolls back THIS row.
//
// students has one unique-per-school constraint: (school_id,
// admission_number). Any P2002 from the student create is unambiguously an
// admission-number race that re-validate missed in the millisecond gap
// before this row was reached. The outer loop catches generically and
// routes to describeCommitFailure, which surfaces the canonical
// "Could not commit: admission number already exists in roster (race)."
// message.
//
// ---- Enrollment (2026-08-09) -------------------------------------------
// When the row carries a classArm AND the job has a target term, this also
// creates the student's Enrollment — in the SAME transaction, deliberately.
// See docs/modules/student-import-enrollment.md D6.
//
// A row is all-or-nothing. If the enrollment fails, the student is rolled
// back too. The alternative (student committed, enrollment failed) produces
// exactly the orphaned-student state this whole feature exists to
// eliminate: a student who exists but appears on no class roster, and is
// therefore invisible to attendance, the gradebook, invoicing and report
// cards.
//
// The arm is RE-RESOLVED here rather than trusted from validate: an arm can
// be renamed or deactivated in the gap between the two passes, the same
// class of race this file already documents for admission numbers. The
// ambiguity rule is identical to the validate engine's (D1) — ClassArm.name
// has no uniqueness constraint, so >1 match is an error, never a guess.
// ---- Extraction provenance (2026-08-20) --------------------------------
// `aiExtracted` marks rows whose values came from a camera-captured register
// transcribed by the model (Smart Student Import) rather than from a CSV or
// a typed form. Defaulted to false so every existing caller — the CSV commit
// handler and its specs — is unchanged.
//
// It is NOT a trust marker: a scanned row reaching this function has already
// been read, corrected and explicitly confirmed by an admin (D4), so it is
// exactly as authoritative as a CSV row. It exists so that a systematic
// extraction defect found later has an identifiable population. See the
// column's own comment in schema.prisma.
export async function commitStudentRow(
  row: StudentImportRow,
  schoolId: string,
  db: PrismaClient,
  enrollment?: { termId: string; academicYearId: string },
  aiExtracted = false,
): Promise<void> {
  const created = await db.student.create({
    data: {
      schoolId,
      admissionNumber: row.admissionNumber,
      firstName: row.firstName,
      middleName: row.middleName ?? null,
      lastName: row.lastName,
      dateOfBirth: row.dateOfBirth,
      gender: row.gender,
      phone: row.phone ?? null,
      email: row.email ?? null,
      address: row.address ?? null,
      photoUrl: row.photoUrl ?? null,
      bloodGroup: row.bloodGroup ?? null,
      religion: row.religion ?? null,
      stateOfOrigin: row.stateOfOrigin ?? null,
      aiExtracted,
    },
    select: { id: true },
  });

  // No arm on this row, or the job has no target term → student only, which
  // is byte-identical to this function's pre-2026-08-09 behaviour.
  if (row.classArm === undefined || enrollment === undefined) {
    return;
  }

  const matches = await db.classArm.findMany({
    where: { name: { equals: row.classArm, mode: "insensitive" } },
    select: { id: true, isActive: true },
  });

  if (matches.length === 0) {
    throw new CommitRowError(
      "classArm",
      `Class arm "${row.classArm}" no longer exists.`,
    );
  }
  if (matches.length > 1) {
    throw new CommitRowError(
      "classArm",
      `Class arm "${row.classArm}" is ambiguous — ${matches.length} arms share that name.`,
    );
  }
  const [arm] = matches;
  if (!arm.isActive) {
    throw new CommitRowError(
      "classArm",
      `Class arm "${row.classArm}" is no longer active.`,
    );
  }

  // academicYearId is derived server-side from the chosen term by the
  // caller, never accepted from input — the two columns MUST stay
  // consistent (see Enrollment's schema comment), and EnrollmentsService.
  // bulkCreate resolves it the same way.
  await db.enrollment.create({
    data: {
      schoolId,
      studentId: created.id,
      termId: enrollment.termId,
      academicYearId: enrollment.academicYearId,
      classArmId: arm.id,
      status: "ENROLLED",
    },
  });
}
