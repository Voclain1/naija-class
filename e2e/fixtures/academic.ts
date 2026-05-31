import { type APIRequestContext } from "@playwright/test";

import {
  apiCreateAcademicYear,
  apiCreateClassArm,
  apiCreateSubject,
  apiCreateTeacherAssignment,
  apiCreateTerm,
  apiListAcademicYears,
  apiListClassArms,
  apiListClassLevels,
  apiListSubjects,
  apiListTerms,
  apiSetCurrentTerm,
  apiSetCurrentYear,
} from "./api.js";

// One arm to create (or reuse) under the JSS 2 level. `name` is what the
// teacher portal renders verbatim (the scope DTO's arm.name is ClassArm.name),
// so callers pass e.g. "JSS 2 A" to make "JSS 2 A" appear in the DOM.
export interface ArmSpec {
  name: string;
  code: string;
}

export interface AcademicStructure {
  academicYearId: string;
  termId: string;
  classLevelId: string;
  subjectId: string;
  subjectName: string;
  arms: Array<{ name: string; code: string; id: string }>;
}

// Find the id of an arm by its spec name (helper for tests).
export function armId(structure: AcademicStructure, name: string): string {
  const arm = structure.arms.find((a) => a.name === name);
  if (!arm) {
    throw new Error(
      `armId: no arm named "${name}" in structure (have: ${structure.arms
        .map((a) => a.name)
        .join(", ")})`,
    );
  }
  return arm.id;
}

// setupAcademicStructure — builds the minimal academic scaffold a teacher
// assignment needs, entirely via admin API calls (NO admin UI clicking):
//   - reuses the signup-seeded JSS 2 ClassLevel (code "jss2" — every school is
//     auto-seeded with 14 default levels at signup, so creating one would
//     409). This mirrors the real admin workflow: arms are created UNDER the
//     seeded levels.
//   - an AcademicYear (set current) + one Term (set current). Current-ness
//     isn't required for the teacher SCOPE itself, but the roster reads the
//     current term, and slice 13 (which reuses this fixture to seed students +
//     enrollment) needs a current term to enrol into.
//   - a Subject ("Mathematics" by default).
//   - one or more arms (default a single "JSS 2 A").
//
// Idempotent when opts.skipIfExists is set: each entity is found-or-created by
// its stable identifier (year label, term sequence, subject code, arm code), so
// a re-run / resume reuses rows instead of colliding on unique constraints.
// With the default (fresh school per test) it simply creates everything.
export async function setupAcademicStructure(
  api: APIRequestContext,
  opts?: {
    arms?: ArmSpec[];
    subjectName?: string;
    subjectCode?: string;
    yearLabel?: string;
    skipIfExists?: boolean;
  },
): Promise<AcademicStructure> {
  const arms = opts?.arms ?? [{ name: "JSS 2 A", code: "jss2a" }];
  const subjectName = opts?.subjectName ?? "Mathematics";
  const subjectCode = opts?.subjectCode ?? "math";
  const yearLabel = opts?.yearLabel ?? "2025/2026";
  const reuse = opts?.skipIfExists ?? false;

  // 1. JSS 2 level — reuse the seeded one (code "jss2").
  const levels = await apiListClassLevels(api);
  const jss2 = levels.find((l) => l.code === "jss2");
  if (!jss2) {
    throw new Error(
      "setupAcademicStructure: seeded JSS 2 level (code 'jss2') not found — " +
        "is class-level seeding-on-signup working?",
    );
  }
  const classLevelId = jss2.id;

  // 2. Academic year (current).
  let academicYearId: string | undefined;
  if (reuse) {
    const existing = await apiListAcademicYears(api);
    academicYearId = existing.find((y) => y.label === yearLabel)?.id;
  }
  if (!academicYearId) {
    const year = await apiCreateAcademicYear(api, {
      label: yearLabel,
      startDate: "2025-09-01T00:00:00.000Z",
      endDate: "2026-07-31T00:00:00.000Z",
    });
    academicYearId = year.id;
  }
  await apiSetCurrentYear(api, academicYearId);

  // 3. Term 1 (current).
  let termId: string | undefined;
  if (reuse) {
    const existing = await apiListTerms(api, academicYearId);
    termId = existing.find((t) => t.sequence === 1)?.id;
  }
  if (!termId) {
    const term = await apiCreateTerm(api, academicYearId, {
      sequence: 1,
      name: "First Term",
      startDate: "2025-09-01T00:00:00.000Z",
      endDate: "2025-12-15T00:00:00.000Z",
    });
    termId = term.id;
  }
  await apiSetCurrentTerm(api, termId);

  // 4. Subject.
  let subjectId: string | undefined;
  if (reuse) {
    const existing = await apiListSubjects(api);
    subjectId = existing.find((s) => s.code === subjectCode)?.id;
  }
  if (!subjectId) {
    const subject = await apiCreateSubject(api, {
      name: subjectName,
      code: subjectCode,
    });
    subjectId = subject.id;
  }

  // 5. Arms under JSS 2.
  const existingArms = reuse ? await apiListClassArms(api, classLevelId) : [];
  const createdArms: AcademicStructure["arms"] = [];
  for (const spec of arms) {
    let id = existingArms.find((a) => a.code === spec.code)?.id;
    if (!id) {
      const arm = await apiCreateClassArm(api, classLevelId, {
        name: spec.name,
        code: spec.code,
      });
      id = arm.id;
    }
    createdArms.push({ name: spec.name, code: spec.code, id });
  }

  return {
    academicYearId,
    termId,
    classLevelId,
    subjectId,
    subjectName,
    arms: createdArms,
  };
}

// assignTeacher — POST /teacher-assignments. termId defaults to null
// (whole-year assignment), which is enough for the teacher to see the arm in
// scope. Returns the created assignment id.
export async function assignTeacher(
  api: APIRequestContext,
  input: {
    teacherId: string;
    classArmId: string;
    subjectId: string;
    academicYearId: string;
    termId?: string | null;
  },
): Promise<{ id: string }> {
  return apiCreateTeacherAssignment(api, input);
}
