import type { PrismaClient } from "@school-kit/db";
import type { StudentImportRow } from "@school-kit/types";

// Per-row commit for STUDENTS. Single insert; the outer commit.handler.ts
// loop wraps this in its own withTenant() tx so a P2002 (race-condition
// admission_number collision) only rolls back THIS row.
//
// students has one unique-per-school constraint: (school_id,
// admission_number). Any P2002 from this create is unambiguously an
// admission-number race that re-validate missed in the millisecond gap
// before this row was reached. The outer loop catches generically and
// routes to describeCommitFailure, which surfaces the canonical
// "Could not commit: admission number already exists in roster (race)."
// message.
export async function commitStudentRow(
  row: StudentImportRow,
  schoolId: string,
  db: PrismaClient,
): Promise<void> {
  await db.student.create({
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
    },
  });
}
