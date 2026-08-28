import { type APIRequestContext } from "@playwright/test";

import { withTenant } from "@school-kit/db";

import { apiCreateEnrollment, apiCreateStudent, type SeededStudent } from "./finance.js";

const NIGERIAN_NAMES = [
  ["Oluwaseun Chukwunonso", "Adebayo-Ogundimu"],
  ["Chiamaka", "Nwankwo-Ibe"],
  ["Ibrahim", "Danjuma"],
  ["Temilade", "Oladipo"],
] as const;

/**
 * Creates a local-only roster that is eligible on the historical fixture term.
 * Enrolments are backdated because the attendance service deliberately excludes
 * pupils enrolled after the register date.
 */
export async function seedAttendanceRoster(
  api: APIRequestContext,
  input: { schoolId: string; termId: string; classArmId: string; suffix: string; count: number },
): Promise<SeededStudent[]> {
  const students: SeededStudent[] = [];
  const enrollmentIds: string[] = [];

  for (let index = 0; index < input.count; index += 1) {
    const [firstName, lastName] = NIGERIAN_NAMES[index % NIGERIAN_NAMES.length] ?? NIGERIAN_NAMES[0];
    const admissionNumber = `ATD/${input.suffix}/${String(index + 1).padStart(3, "0")}`;
    const student = await apiCreateStudent(api, {
      admissionNumber,
      firstName: `${firstName} ${index + 1}`,
      lastName,
      dateOfBirth: "2012-05-14T00:00:00.000Z",
      gender: index % 2 === 0 ? "FEMALE" : "MALE",
    });
    const enrollment = await apiCreateEnrollment(api, {
      studentId: student.id,
      termId: input.termId,
      classArmId: input.classArmId,
    });
    students.push({ id: student.id, admissionNumber, firstName: `${firstName} ${index + 1}`, lastName });
    enrollmentIds.push(enrollment.id);
  }

  await withTenant(input.schoolId, (db) =>
    db.enrollment.updateMany({
      where: { id: { in: enrollmentIds } },
      data: { enrolledAt: new Date("2025-09-01T00:00:00.000Z") },
    }),
  );

  return students;
}

export async function setFormTeacher(input: { schoolId: string; classArmId: string; teacherId: string }): Promise<void> {
  await withTenant(input.schoolId, (db) =>
    db.classArm.update({ where: { id: input.classArmId }, data: { classTeacherId: input.teacherId } }),
  );
}
