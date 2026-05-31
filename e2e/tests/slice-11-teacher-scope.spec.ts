import { expect, test, type BrowserContext } from "@playwright/test";

import {
  armId,
  assignTeacher,
  inviteAndAcceptTeacher,
  loginAsAdmin,
  setupAcademicStructure,
} from "../fixtures/index.js";

// Slice 11 cp4 — acceptance #9 end-to-end (acceptance-bar step 8 of
// docs/modules/phase-1.md): "Each teacher logs in and sees exactly and only the
// arms/subjects they teach."
//
// cp3's manual browser pass verified this behaviour; cp4 codifies it. The
// teacher-scope filter is the most testable SECURITY property of Phase 1 — a
// bug leaks WITHIN a school (one teacher seeing another's roster). These two
// tests are the regression net for that property.
//
// Discipline (see fixtures/): API-first setup (signup, onboarding, academic
// structure, assignments all over HTTP), UI-only assertions (the teacher
// portal). One browser context per session. Specific DOM waits, never
// arbitrary sleeps. Fresh, uniquely-identified school per test — no shared
// state. Each test owns its contexts and closes them in a finally.

// The out-of-scope copy from /teacher/classes/[armId] (apps/web/src/app/
// (teacher)/teacher/classes/[armId]/page.tsx). Matched by a fragment to dodge
// the apostrophe in "isn't" and the wrapped whitespace.
const OUT_OF_SCOPE_COPY = /one of yours/i;
const ROSTER_EMPTY_COPY =
  "No students are enrolled in this class for the current term yet.";

test("acceptance #9 — admin assigns teacher; teacher sees exactly that assignment", async ({
  browser,
}) => {
  const toClose: BrowserContext[] = [];
  const admin = await loginAsAdmin(browser);
  toClose.push(admin.context);

  try {
    // --- API-first setup: academic structure + teacher + assignment ---------
    const structure = await setupAcademicStructure(admin.api, {
      arms: [{ name: "JSS 2 A", code: "jss2a" }],
      subjectName: "Mathematics",
    });

    const teacher = await inviteAndAcceptTeacher(browser, {
      schoolId: admin.schoolId,
      invitedByUserId: admin.ownerUserId,
    });
    toClose.push(teacher.context);

    await assignTeacher(admin.api, {
      teacherId: teacher.userId,
      classArmId: armId(structure, "JSS 2 A"),
      subjectId: structure.subjectId,
      academicYearId: structure.academicYearId,
    });

    // --- UI-only assertions in the teacher's own context --------------------
    const page = teacher.page;

    // Dashboard: the arm + the subject the teacher teaches in it.
    await page.goto("/teacher/dashboard");
    await expect(page.getByText("JSS 2 A")).toBeVisible();
    await expect(page.getByText("Mathematics")).toBeVisible();

    // Classes list: the arm appears.
    await page.goto("/teacher/classes");
    await expect(page.getByText("JSS 2 A")).toBeVisible();

    // Click into the arm → roster page.
    await page.getByRole("link", { name: /JSS 2 A/ }).click();
    await page.waitForURL(/\/teacher\/classes\/[^/]+$/);

    // Arm detail: name as the heading, the subject, and the empty-roster state
    // (this test seeds no students).
    await expect(
      page.getByRole("heading", { name: "JSS 2 A", level: 1 }),
    ).toBeVisible();
    await expect(page.getByText("You teach:")).toBeVisible();
    await expect(page.getByText("Mathematics")).toBeVisible();
    await expect(page.getByText(ROSTER_EMPTY_COPY)).toBeVisible();
  } finally {
    for (const ctx of toClose) await ctx.close();
    await admin.api.dispose();
  }
});

test("acceptance #9 — cross-teacher isolation: a teacher cannot see another's arm", async ({
  browser,
}) => {
  const toClose: BrowserContext[] = [];
  const admin = await loginAsAdmin(browser);
  toClose.push(admin.context);

  try {
    // Two arms under JSS 2, one shared subject.
    const structure = await setupAcademicStructure(admin.api, {
      arms: [
        { name: "JSS 2 A", code: "jss2a" },
        { name: "JSS 2 B", code: "jss2b" },
      ],
      subjectName: "Mathematics",
    });
    const armAId = armId(structure, "JSS 2 A");
    const armBId = armId(structure, "JSS 2 B");

    // Teacher A → JSS 2 A; Teacher B → JSS 2 B. Each gets their own context.
    const teacherA = await inviteAndAcceptTeacher(browser, {
      schoolId: admin.schoolId,
      invitedByUserId: admin.ownerUserId,
      firstName: "Ada",
      lastName: "TeacherA",
    });
    toClose.push(teacherA.context);
    const teacherB = await inviteAndAcceptTeacher(browser, {
      schoolId: admin.schoolId,
      invitedByUserId: admin.ownerUserId,
      firstName: "Bode",
      lastName: "TeacherB",
    });
    toClose.push(teacherB.context);

    await assignTeacher(admin.api, {
      teacherId: teacherA.userId,
      classArmId: armAId,
      subjectId: structure.subjectId,
      academicYearId: structure.academicYearId,
    });
    await assignTeacher(admin.api, {
      teacherId: teacherB.userId,
      classArmId: armBId,
      subjectId: structure.subjectId,
      academicYearId: structure.academicYearId,
    });

    // --- Teacher A sees only JSS 2 A ----------------------------------------
    await teacherA.page.goto("/teacher/classes");
    await expect(teacherA.page.getByText("JSS 2 A")).toBeVisible();
    // Scope has rendered (JSS 2 A is present) — B must be absent, not merely
    // not-yet-loaded.
    await expect(teacherA.page.getByText("JSS 2 B")).toHaveCount(0);

    // A navigates straight to B's arm URL → in-page "not one of your classes"
    // state (NOT a 404 page, NOT a crash — the cp3 client mirror of the API's
    // scope 404).
    await teacherA.page.goto(`/teacher/classes/${armBId}`);
    await expect(teacherA.page.getByText(OUT_OF_SCOPE_COPY)).toBeVisible();

    // --- Teacher B sees only JSS 2 B ----------------------------------------
    await teacherB.page.goto("/teacher/classes");
    await expect(teacherB.page.getByText("JSS 2 B")).toBeVisible();
    await expect(teacherB.page.getByText("JSS 2 A")).toHaveCount(0);

    await teacherB.page.goto(`/teacher/classes/${armAId}`);
    await expect(teacherB.page.getByText(OUT_OF_SCOPE_COPY)).toBeVisible();
  } finally {
    for (const ctx of toClose) await ctx.close();
    await admin.api.dispose();
  }
});
