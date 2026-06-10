// Dev-only seed — a COMPLETE test school for browser-pass testing of the
// Phase 2 UI (gradebook, aggregation, report cards). NOT for production.
//
// `pnpm db:seed` still creates ONLY the system roles. This script layers a
// fully-populated tenant ON TOP of those roles, so run the base seed first
// (it is a prerequisite — we read the owner/teacher system roles here).
//
//   pnpm db:seed      # system roles (idempotent)
//   pnpm dev:seed     # this script — the test school (idempotent)
//
// Idempotency: every write is an upsert / find-or-create on a NATURAL key, so
// re-running neither throws nor duplicates. Re-running refreshes scores +
// positions in place.
//
// Connection: we connect with DIRECT_URL (the privileged `school_kit` migration
// role) so the seed can write across the tenant without juggling the
// `app.current_school_id` RLS GUC for every table. The runtime app still reads
// these rows as `app_user` under RLS — privileged-write + RLS-read is fine. A
// dev seed is a dev tool, in the same trust bracket as migrations.

import * as argon2 from "argon2";

import {
  computeClassAverages,
  computeClassPositions,
  computeSubjectPositions,
} from "@school-kit/types";

import { PrismaClient } from "../generated/client/index.js";
import { DEFAULT_CLASS_LEVELS } from "../src/seeds/class-levels.js";
import {
  DEFAULT_GRADE_BOUNDARIES,
  DEFAULT_GRADING_COMPONENTS,
  DEFAULT_GRADING_SCHEME_NAME,
} from "../src/seeds/grading.js";

// --------------------------------------------------------------------------
// Constants — the test fixture
// --------------------------------------------------------------------------

const SCHOOL_SLUG = "test-school-naija";
const SCHOOL_NAME = "Test School Naija";
const SCHOOL_MOTTO = "Knowledge and Character";
const PASSWORD = "Test1234!";
const OWNER_EMAIL = "dev-owner@test.naija-class.local";
const TEACHER_EMAIL = "dev-teacher@test.naija-class.local";

// The arm we wire up end-to-end (form teacher, students, scores, positions).
const TARGET_LEVEL_CODE = "jss2";
const TARGET_ARM_NAME = "JSS 2 A";

// Arms to create — one per secondary level (JSS 1..SSS 3). Codes are the arm's
// stable per-(school,level) identifier backing the (schoolId, classLevelId,
// code) unique.
const ARM_LEVEL_CODES = ["jss1", "jss2", "jss3", "sss1", "sss2", "sss3"] as const;

// 8 standard Nigerian subjects (code = stable per-school identifier).
const SUBJECTS = [
  { code: "math", name: "Mathematics" },
  { code: "english", name: "English Language" },
  { code: "basic-science", name: "Basic Science" },
  { code: "social-studies", name: "Social Studies" },
  { code: "civic-education", name: "Civic Education" },
  { code: "computer-studies", name: "Computer Studies" },
  { code: "yoruba", name: "Yoruba" },
  { code: "religious-studies", name: "Religious Studies" },
] as const;

const STUDENTS = [
  { admissionNumber: "NJC/2025/001", firstName: "Adaeze", lastName: "Okeke", gender: "FEMALE", dob: "2012-03-14" },
  { admissionNumber: "NJC/2025/002", firstName: "Bode", lastName: "Adeyemi", gender: "MALE", dob: "2012-07-22" },
  { admissionNumber: "NJC/2025/003", firstName: "Chioma", lastName: "Nwosu", gender: "FEMALE", dob: "2012-11-05" },
  { admissionNumber: "NJC/2025/004", firstName: "David", lastName: "Eze", gender: "MALE", dob: "2012-01-30" },
  { admissionNumber: "NJC/2025/005", firstName: "Funmi", lastName: "Adesanya", gender: "FEMALE", dob: "2012-09-18" },
] as const;

// Per-component marks (out of each component's weight: ca1≤20, ca2≤20, exam≤60).
// Maths and English are deliberately DIFFERENT so per-subject positions diverge
// (and English has a 79/79 tie → exercises sparse "2,2,4" ranking).
type Marks = { ca1: number; ca2: number; exam: number };
const MATH_SCORES: Record<string, Marks> = {
  "NJC/2025/001": { ca1: 18, ca2: 17, exam: 55 }, // 90 → A1, subj 1st
  "NJC/2025/002": { ca1: 15, ca2: 14, exam: 45 }, // 74 → B2, subj 3rd
  "NJC/2025/003": { ca1: 12, ca2: 13, exam: 40 }, // 65 → B3, subj 4th
  "NJC/2025/004": { ca1: 20, ca2: 18, exam: 50 }, // 88 → A1, subj 2nd
  "NJC/2025/005": { ca1: 10, ca2: 11, exam: 38 }, // 59 → C5, subj 5th
};
const ENGLISH_SCORES: Record<string, Marks> = {
  "NJC/2025/001": { ca1: 16, ca2: 15, exam: 48 }, // 79 → A1, subj 2nd (tie)
  "NJC/2025/002": { ca1: 18, ca2: 16, exam: 52 }, // 86 → A1, subj 1st
  "NJC/2025/003": { ca1: 14, ca2: 15, exam: 50 }, // 79 → A1, subj 2nd (tie)
  "NJC/2025/004": { ca1: 15, ca2: 14, exam: 44 }, // 73 → B2, subj 4th
  "NJC/2025/005": { ca1: 13, ca2: 14, exam: 42 }, // 69 → B3, subj 5th
};

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL } },
});

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

// total → WAEC letter + remark, from the default boundaries (inclusive bands).
function resolveGrade(total: number): { letter: string; remark: string } {
  const band = DEFAULT_GRADE_BOUNDARIES.find((b) => total >= b.minScore && total <= b.maxScore);
  return band ? { letter: band.letter, remark: band.remark } : { letter: "F9", remark: "Fail" };
}

function marksTotal(m: Marks): number {
  return m.ca1 + m.ca2 + m.exam;
}

// --------------------------------------------------------------------------
// Seed
// --------------------------------------------------------------------------

async function main() {
  if (!process.env.DIRECT_URL) {
    throw new Error("DIRECT_URL is not set — run via `pnpm dev:seed` (loads ../../.env).");
  }

  // 0. Prerequisite system roles (created by `pnpm db:seed`).
  const ownerRole = await prisma.role.findFirst({
    where: { schoolId: null, key: "owner", isSystem: true },
    select: { id: true },
  });
  const teacherRole = await prisma.role.findFirst({
    where: { schoolId: null, key: "teacher", isSystem: true },
    select: { id: true },
  });
  if (!ownerRole || !teacherRole) {
    throw new Error("System roles missing — run `pnpm db:seed` first, then `pnpm dev:seed`.");
  }

  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

  // 1. School — ACTIVE so RequireAuth lets the user past onboarding.
  const school = await prisma.school.upsert({
    where: { slug: SCHOOL_SLUG },
    update: { name: SCHOOL_NAME, motto: SCHOOL_MOTTO, status: "ACTIVE", onboardingStep: 5 },
    create: {
      name: SCHOOL_NAME,
      slug: SCHOOL_SLUG,
      motto: SCHOOL_MOTTO,
      status: "ACTIVE",
      onboardingStep: 5,
      ndprConsent: true,
      ndprConsentAt: new Date(),
    },
    select: { id: true },
  });
  const schoolId = school.id;

  // 2. Owner + teacher users (upsert by unique email). emailVerified so login
  //    has no verification gate; isActive so writes pass the active check.
  const owner = await prisma.user.upsert({
    where: { email: OWNER_EMAIL },
    update: { passwordHash, isActive: true },
    create: {
      schoolId,
      email: OWNER_EMAIL,
      phone: "+2348100000001",
      firstName: "Dev",
      lastName: "Owner",
      passwordHash,
      isActive: true,
      emailVerified: true,
    },
    select: { id: true },
  });
  const teacher = await prisma.user.upsert({
    where: { email: TEACHER_EMAIL },
    update: { passwordHash, isActive: true },
    create: {
      schoolId,
      email: TEACHER_EMAIL,
      phone: "+2348100000002",
      firstName: "Dev",
      lastName: "Teacher",
      passwordHash,
      isActive: true,
      emailVerified: true,
    },
    select: { id: true },
  });

  // 3. Role grants (UserRole PK is (userId, roleId)).
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: owner.id, roleId: ownerRole.id } },
    update: {},
    create: { userId: owner.id, roleId: ownerRole.id },
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: teacher.id, roleId: teacherRole.id } },
    update: {},
    create: { userId: teacher.id, roleId: teacherRole.id },
  });

  // 4. Class levels (the 14 defaults a real signup creates). Idempotent on
  //    (schoolId, code).
  await prisma.classLevel.createMany({
    data: DEFAULT_CLASS_LEVELS.map((l) => ({
      schoolId,
      code: l.code,
      name: l.name,
      stage: l.stage,
      orderIndex: l.orderIndex,
    })),
    skipDuplicates: true,
  });
  const levels = await prisma.classLevel.findMany({
    where: { schoolId },
    select: { id: true, code: true, name: true },
  });
  const levelByCode = new Map(levels.map((l) => [l.code, l]));

  // 5. Grading scheme + components + WAEC boundaries (what signup auto-creates).
  const scheme = await prisma.gradingScheme.upsert({
    where: { schoolId },
    update: {},
    create: { schoolId, name: DEFAULT_GRADING_SCHEME_NAME },
    select: { id: true },
  });
  await prisma.gradingComponent.createMany({
    data: DEFAULT_GRADING_COMPONENTS.map((c) => ({
      schoolId,
      schemeId: scheme.id,
      key: c.key,
      label: c.label,
      weight: c.weight,
      orderIndex: c.orderIndex,
    })),
    skipDuplicates: true,
  });
  await prisma.gradeBoundary.createMany({
    data: DEFAULT_GRADE_BOUNDARIES.map((b) => ({
      schoolId,
      letter: b.letter,
      minScore: b.minScore,
      maxScore: b.maxScore,
      remark: b.remark,
      orderIndex: b.orderIndex,
    })),
    skipDuplicates: true,
  });
  const components = await prisma.gradingComponent.findMany({
    where: { schoolId, schemeId: scheme.id },
    select: { id: true, key: true },
  });
  const componentIdByKey = new Map(components.map((c) => [c.key, c.id]));

  // 6. Academic year + three terms, computed RELATIVE TO TODAY so the CURRENT
  //    term always contains the seed-day's date. This keeps date-resolved
  //    surfaces (attendance, subject-attendance) aligned with isCurrent-resolved
  //    surfaces (gradebook, report cards) no matter how far real calendar time
  //    has advanced past a hardcoded date — closing the dev-seed staleness
  //    incident (docs/journal/2026-06-08, finished in slice-9 cp3). Windows, in
  //    days from today: First (prior) [−135,−46] · Second (current) [−45,+45] ·
  //    Third (next) [+46,+135]; the year brackets First.start → Third.end. The
  //    `update` clauses refresh the dates too, so re-seeding an existing dev DB
  //    (not just a fresh reset) rolls the windows forward.
  const MS_DAY = 86_400_000;
  const seedToday = new Date();
  const dayOffset = (days: number) => new Date(seedToday.getTime() + days * MS_DAY);
  const yearStart = dayOffset(-135);
  const yearEnd = dayOffset(135);
  const year = await prisma.academicYear.upsert({
    where: { schoolId_label: { schoolId, label: "2025/2026" } },
    update: { isCurrent: true, startDate: yearStart, endDate: yearEnd },
    create: {
      schoolId,
      label: "2025/2026",
      startDate: yearStart,
      endDate: yearEnd,
      isCurrent: true,
    },
    select: { id: true },
  });
  const TERMS = [
    { sequence: 1, name: "First Term", startDate: dayOffset(-135), endDate: dayOffset(-46), isCurrent: false },
    { sequence: 2, name: "Second Term", startDate: dayOffset(-45), endDate: dayOffset(45), isCurrent: true },
    { sequence: 3, name: "Third Term", startDate: dayOffset(46), endDate: dayOffset(135), isCurrent: false },
  ];
  // Clear any existing current-term flag first: the partial unique index
  // `terms_school_id_current_key` permits only ONE is_current term per school, so
  // re-seeding while a different term is flagged current would transiently create
  // two and violate it. Reset, then the loop sets the single new current term.
  await prisma.term.updateMany({ where: { schoolId }, data: { isCurrent: false } });
  let firstTermId = "";
  for (const t of TERMS) {
    const term = await prisma.term.upsert({
      where: { academicYearId_sequence: { academicYearId: year.id, sequence: t.sequence } },
      update: { isCurrent: t.isCurrent, name: t.name, startDate: t.startDate, endDate: t.endDate },
      create: {
        schoolId,
        academicYearId: year.id,
        sequence: t.sequence,
        name: t.name,
        startDate: t.startDate,
        endDate: t.endDate,
        isCurrent: t.isCurrent,
      },
      select: { id: true },
    });
    if (t.sequence === 1) firstTermId = term.id;
  }

  // The CURRENT term (isCurrent=true → the window containing today). Both the
  // enrollments (below) AND the score fixture (step 11) pin to it, so the whole
  // demo — gradebook + report cards (isCurrent-resolved) AND daily/subject
  // attendance (date-resolved → today) — is populated for the seed day. firstTermId
  // survives only as a defensive fallback (there is always an isCurrent term).
  const currentTerm = await prisma.term.findFirst({
    where: { schoolId, isCurrent: true },
    select: { id: true },
  });
  const currentTermId = currentTerm?.id ?? firstTermId;

  // 7. One arm per secondary level. Two form-teacher assignments, so both the
  //    owner-role and teacher-role form-teacher paths are testable in cp3:
  //      JSS 2 A → owner    (owner-role + form-teacher scenarios)
  //      JSS 1 A → teacher  (teacher-role + form-teacher scenarios; the teacher
  //                          ALSO holds subject assignments in JSS 2 A below, so
  //                          the subject-vs-form-teacher distinction holds)
  const formTeacherByLevelCode = new Map<string, string>([
    [TARGET_LEVEL_CODE, owner.id], // jss2 → owner
    ["jss1", teacher.id], // jss1 → dev-teacher
  ]);
  const armIdByLevelCode = new Map<string, string>();
  for (const code of ARM_LEVEL_CODES) {
    const level = levelByCode.get(code);
    if (!level) continue;
    const armCode = `${code}-a`;
    const classTeacherId = formTeacherByLevelCode.get(code) ?? null;
    const arm = await prisma.classArm.upsert({
      where: { schoolId_classLevelId_code: { schoolId, classLevelId: level.id, code: armCode } },
      update: { classTeacherId },
      create: {
        schoolId,
        classLevelId: level.id,
        name: `${level.name} A`,
        code: armCode,
        classTeacherId,
      },
      select: { id: true },
    });
    armIdByLevelCode.set(code, arm.id);
  }
  const targetArmId = armIdByLevelCode.get(TARGET_LEVEL_CODE)!;
  const targetLevelId = levelByCode.get(TARGET_LEVEL_CODE)!.id;

  // 8. Subjects + map all 8 to all secondary levels (ClassSubject is per LEVEL).
  const subjectIdByCode = new Map<string, string>();
  for (const s of SUBJECTS) {
    const subject = await prisma.subject.upsert({
      where: { schoolId_code: { schoolId, code: s.code } },
      update: { name: s.name },
      create: { schoolId, code: s.code, name: s.name },
      select: { id: true },
    });
    subjectIdByCode.set(s.code, subject.id);
  }
  for (const code of ARM_LEVEL_CODES) {
    const level = levelByCode.get(code);
    if (!level) continue;
    for (const s of SUBJECTS) {
      const subjectId = subjectIdByCode.get(s.code)!;
      await prisma.classSubject.upsert({
        where: { schoolId_classLevelId_subjectId: { schoolId, classLevelId: level.id, subjectId } },
        update: {},
        create: { schoolId, classLevelId: level.id, subjectId, isCore: true },
      });
    }
  }

  // 9. Students + enroll all five in JSS 2 A for the current term (whichever
  //    term has isCurrent=true at seed time). enrolledAt is pinned to the
  //    academic-year start so any in-term date puts them on the register (the
  //    attendance roster filters enrolledAt <= the selected date).
  const studentIdByAdmission = new Map<string, string>();
  for (const s of STUDENTS) {
    const student = await prisma.student.upsert({
      where: { schoolId_admissionNumber: { schoolId, admissionNumber: s.admissionNumber } },
      update: { firstName: s.firstName, lastName: s.lastName },
      create: {
        schoolId,
        admissionNumber: s.admissionNumber,
        firstName: s.firstName,
        lastName: s.lastName,
        gender: s.gender,
        dateOfBirth: new Date(s.dob),
      },
      select: { id: true },
    });
    studentIdByAdmission.set(s.admissionNumber, student.id);
    await prisma.enrollment.upsert({
      where: { schoolId_studentId_termId: { schoolId, studentId: student.id, termId: currentTermId } },
      update: { classArmId: targetArmId, status: "ENROLLED", enrolledAt: yearStart },
      create: {
        schoolId,
        studentId: student.id,
        termId: currentTermId,
        academicYearId: year.id,
        classArmId: targetArmId,
        status: "ENROLLED",
        enrolledAt: yearStart,
      },
    });
  }

  // 10. Teacher profile + subject assignments (JSS 2 A × Maths, English). NOT a
  //     form teacher (so the subject-vs-form-teacher gate is testable).
  await prisma.teacherProfile.upsert({
    where: { userId: teacher.id },
    update: {},
    create: { schoolId, userId: teacher.id, staffNumber: "STAFF-001", specialty: "Mathematics & English" },
  });
  for (const code of ["math", "english"]) {
    const subjectId = subjectIdByCode.get(code)!;
    // Whole-year assignment (termId null). NULL breaks compound-unique upsert
    // (Postgres treats NULL as distinct), so find-or-create by hand.
    const existing = await prisma.teacherAssignment.findFirst({
      where: {
        schoolId,
        teacherId: teacher.id,
        classArmId: targetArmId,
        subjectId,
        academicYearId: year.id,
        termId: null,
      },
      select: { id: true },
    });
    if (!existing) {
      await prisma.teacherAssignment.create({
        data: {
          schoolId,
          teacherId: teacher.id,
          classArmId: targetArmId,
          subjectId,
          academicYearId: year.id,
          termId: null,
          isActive: true,
        },
      });
    }
  }

  // 11. Scores for JSS 2 A × {Maths, English} × the CURRENT term (so gradebook +
  //     report cards are populated for the seed day; slice-9 cp3 moved these off
  //     the old hardcoded First Term). Per-component
  //     AssessmentScore rows + the materialized Assessment summary (totalScore +
  //     letter + remark). Basic Science et al. are left UNSCORED on purpose so
  //     the cp3 "no scores" empty states are exercisable.
  const SCORED: { code: string; scores: Record<string, Marks> }[] = [
    { code: "math", scores: MATH_SCORES },
    { code: "english", scores: ENGLISH_SCORES },
  ];
  // studentId -> [subject totals] for the class-average pass.
  const totalsByStudent = new Map<string, number[]>();
  // subjectId -> rows for the per-subject ranking pass.
  const subjectRows = new Map<string, { studentId: string; totalScore: number }[]>();

  for (const { code, scores } of SCORED) {
    const subjectId = subjectIdByCode.get(code)!;
    subjectRows.set(subjectId, []);
    for (const s of STUDENTS) {
      const studentId = studentIdByAdmission.get(s.admissionNumber)!;
      const marks = scores[s.admissionNumber];
      const total = marksTotal(marks);
      const { letter, remark } = resolveGrade(total);

      // Per-component raw marks.
      for (const key of ["ca1", "ca2", "exam"] as const) {
        const componentId = componentIdByKey.get(key)!;
        await prisma.assessmentScore.upsert({
          where: {
            schoolId_studentId_subjectId_termId_componentId: {
              schoolId,
              studentId,
              subjectId,
              termId: currentTermId,
              componentId,
            },
          },
          update: { score: marks[key], enteredBy: teacher.id },
          create: {
            schoolId,
            studentId,
            subjectId,
            termId: currentTermId,
            componentId,
            score: marks[key],
            enteredBy: teacher.id,
          },
        });
      }

      // Materialized summary (what slice-2 materialization persists).
      await prisma.assessment.upsert({
        where: {
          schoolId_studentId_subjectId_termId: { schoolId, studentId, subjectId, termId: currentTermId },
        },
        update: { totalScore: total, letterGrade: letter, remark, computedAt: new Date() },
        create: {
          schoolId,
          studentId,
          subjectId,
          termId: currentTermId,
          academicYearId: year.id,
          classArmId: targetArmId,
          totalScore: total,
          letterGrade: letter,
          remark,
          computedAt: new Date(),
        },
      });

      subjectRows.get(subjectId)!.push({ studentId, totalScore: total });
      const list = totalsByStudent.get(studentId) ?? [];
      list.push(total);
      totalsByStudent.set(studentId, list);
    }
  }

  // 12. Aggregation pass (slice-4 pure functions) — subjectPosition per subject,
  //     classPosition by overall average. Denormalize classPosition onto EVERY
  //     of a student's assessment rows (matches the slice-4/5 convention).
  const averages = computeClassAverages(totalsByStudent);
  const classPositions = computeClassPositions(averages);
  const now = new Date();
  for (const [subjectId, rows] of subjectRows) {
    const subjectPositions = computeSubjectPositions(rows);
    for (const row of rows) {
      await prisma.assessment.update({
        where: {
          schoolId_studentId_subjectId_termId: {
            schoolId,
            studentId: row.studentId,
            subjectId,
            termId: currentTermId,
          },
        },
        data: {
          subjectPosition: subjectPositions.get(row.studentId) ?? null,
          classPosition: classPositions.get(row.studentId) ?? null,
          positionsComputedAt: now,
        },
      });
    }
  }

  // --------------------------------------------------------------------------
  /* eslint-disable no-console */
  console.log("");
  console.log("✅ Dev seed complete");
  console.log(`School: ${SCHOOL_NAME}`);
  console.log(`Owner login:   ${OWNER_EMAIL} / ${PASSWORD}`);
  console.log(`Teacher login: ${TEACHER_EMAIL} / ${PASSWORD}`);
  console.log("Form teachers: owner → JSS 2 A, dev-teacher → JSS 1 A");
  console.log(`Arm with scores: ${TARGET_ARM_NAME} (Mathematics + English Language, current term)`);
  console.log("dev-teacher also has SUBJECT assignments in JSS 2 A (Maths + English)");
  console.log("Now go to /report-cards as owner");
  console.log("");
  /* eslint-enable no-console */
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("dev-seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
