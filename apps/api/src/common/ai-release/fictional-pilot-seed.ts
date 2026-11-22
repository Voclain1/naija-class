import { withTenant } from "@school-kit/db";
import { ConflictError, NotFoundError, type PlatformAdminFictionalSeedResponse } from "@school-kit/types";

// The fictional-data pilot's records (2026-11-22,
// docs/modules/assistant-ai-governance.md, "Fictional-data pilot").
//
// Fills a school the platform admin has classified FICTIONAL with invented
// records, so AI understanding and voice can be tested end to end with a real
// model and a real speech provider without any child's data. Everything is
// written through withTenant, so RLS bounds every statement to this school.
//
// Nothing here can reach a real person: guardian email addresses use the
// reserved example.test domain (RFC 2606) and phone numbers use the
// +234 0… range, which is not a Nigerian mobile prefix. Names are invented
// combinations; dates of birth are fixed and synthetic. Refused unless the
// school is FICTIONAL and still holds no students or guardians.

const FIRST = [
  "Adaeze", "Chinedu", "Ifeoma", "Tunde", "Zainab", "Emeka", "Funmilayo", "Ibrahim", "Ngozi", "Segun",
  "Halima", "Obinna", "Temitope", "Musa", "Chiamaka", "Kayode", "Aisha", "Uchenna", "Yetunde", "Sani",
  "Amarachi", "Babatunde", "Hauwa", "Ikenna", "Folake", "Abdullahi", "Nneka", "Olumide", "Rukayat", "Chukwuma",
];
// Invented surnames: deliberately not common real surnames.
const LAST = ["Testwood", "Pilotson", "Mockwale", "Fixtura", "Samplebo", "Demoyede"];
const ARMS: Array<{ level: string; code: string; orderIndex: number; arms: string[] }> = [
  { level: "JSS 1", code: "jss1", orderIndex: 1, arms: ["JSS 1A", "JSS 1B"] },
  { level: "JSS 2", code: "jss2", orderIndex: 2, arms: ["JSS 2A", "JSS 2B"] },
  { level: "JSS 3", code: "jss3", orderIndex: 3, arms: ["JSS 3A"] },
];

export const FICTIONAL_PILOT_STUDENTS = FIRST.length;

export async function seedFictionalPilot(schoolId: string, actorUserId: string): Promise<PlatformAdminFictionalSeedResponse> {
  return withTenant(schoolId, async (db) => {
    const school = await db.school.findUnique({ where: { id: schoolId }, select: { aiDataClassification: true } });
    if (!school) throw new NotFoundError("School not found.");
    if (school.aiDataClassification !== "FICTIONAL") {
      throw new ConflictError("SCHOOL_NOT_FICTIONAL", "Only a school classified as fictional can be filled with pilot records.");
    }
    const [students, guardians] = await Promise.all([db.student.count({ where: { schoolId } }), db.guardian.count({ where: { schoolId } })]);
    if (students > 0 || guardians > 0) {
      throw new ConflictError("SCHOOL_HAS_RECORDS", "This school already holds student or guardian records; pilot records are only added to an empty school.");
    }

    const year = await db.academicYear.create({
      data: { schoolId, label: "2026/2027 (pilot)", startDate: new Date("2026-09-07"), endDate: new Date("2027-07-23") },
    });
    const termRows = [
      { sequence: 1, name: "First Term", startDate: "2026-09-07", endDate: "2026-12-11", isCurrent: true },
      { sequence: 2, name: "Second Term", startDate: "2027-01-04", endDate: "2027-04-02", isCurrent: false },
      { sequence: 3, name: "Third Term", startDate: "2027-04-26", endDate: "2027-07-23", isCurrent: false },
    ];
    const terms: { id: string }[] = [];
    for (const t of termRows) {
      terms.push(await db.term.create({
        data: { schoolId, academicYearId: year.id, sequence: t.sequence, name: t.name, isCurrent: t.isCurrent, startDate: new Date(t.startDate), endDate: new Date(t.endDate) },
      }));
    }
    const current = terms[0]!;

    const arms: { id: string }[] = [];
    for (const l of ARMS) {
      const level = await db.classLevel.create({ data: { schoolId, name: l.level, code: `pilot-${l.code}`, stage: "JSS", orderIndex: 100 + l.orderIndex } });
      for (const [i, name] of l.arms.entries()) {
        arms.push(await db.classArm.create({ data: { schoolId, classLevelId: level.id, name, code: `pilot-${l.code}-${i + 1}` } }));
      }
    }

    let guardianCount = 0;
    for (const [i, first] of FIRST.entries()) {
      const last = LAST[i % LAST.length]!;
      const n = String(i + 1).padStart(3, "0");
      const student = await db.student.create({
        data: {
          schoolId, firstName: first, lastName: last, admissionNumber: `PILOT-${n}`,
          dateOfBirth: new Date(Date.UTC(2013 + (i % 3), i % 12, 1 + (i % 27))), gender: i % 2 === 0 ? "FEMALE" : "MALE",
        },
      });
      await db.enrollment.create({
        data: { schoolId, studentId: student.id, termId: current.id, academicYearId: year.id, classArmId: arms[i % arms.length]!.id, status: "ENROLLED" },
      });
      const guardian = await db.guardian.create({
        data: {
          schoolId, firstName: `Parent${n}`, lastName: last, relationship: i % 2 === 0 ? "MOTHER" : "FATHER",
          phone: `+2340000000${n}`, email: `pilot-parent-${n}@example.test`,
        },
      });
      guardianCount += 1;
      await db.studentGuardian.create({ data: { schoolId, studentId: student.id, guardianId: guardian.id, isPrimary: true } });
    }

    const category = await db.feeCategory.create({ data: { schoolId, name: "Tuition (pilot)", createdBy: actorUserId } });
    await db.feeItem.create({ data: { schoolId, categoryId: category.id, name: "Tuition (pilot)", amount: 15_000_000, createdBy: actorUserId } });

    return { schoolId, students: FIRST.length, guardians: guardianCount, classArms: arms.length, terms: terms.length };
  }, { label: "fictional-pilot-seed", timeoutMs: 60_000 });
}
