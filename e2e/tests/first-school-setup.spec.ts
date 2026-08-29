import { expect, test } from "@playwright/test";

import {
  apiCreateEnrollment,
  apiCreateFeeCategory,
  apiCreateFeeItem,
  apiCreateStudent,
} from "../fixtures/finance.js";
import { inviteAndAcceptTeacher, loginAsAdmin, uniqueSuffix } from "../fixtures/index.js";

// The fresh-school setup journey (F-25).
//
// WHAT THIS COVERS THAT THE SERVICE SPEC CANNOT. SetupStateService's own suite
// proves the derivation is right against a real database. This proves the
// owner is actually TOLD — that the checklist renders on the page a new owner
// lands on, that its action links go where they say, that the prompt moves as
// the school progresses, and — the part most likely to regress — that all of
// it disappears once the school is running.
//
// One test, walked end to end, per CLAUDE.md's "a passing happy path is worth
// more than 50 narrow UI assertions". The stages below mirror the four states
// the slice was asked to verify: brand-new, partly configured, established,
// and a non-owner role.
//
// API-FIRST SETUP, UI-ONLY ASSERTIONS — the house convention. Students,
// enrolments and fees are created over HTTP; the browser is only ever asked
// what the owner can see.
test("first-school setup: a new owner is told what to do next, and stops being told once the school runs", async ({
  browser,
}) => {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const { page, api } = admin;

  // ───────────────────────────────────────────────────────────────────────
  // 1. Brand-new school — the checklist is the dashboard.
  // ───────────────────────────────────────────────────────────────────────
  await page.goto("/dashboard");

  const checklist = page.getByText(/finish setting up your school/i);
  await expect(checklist).toBeVisible();

  // The calendar is already done (onboarding step 5 collected it), so the
  // owner immediately sees that something IS complete. A list where nothing
  // is ticked cannot answer "what is already done".
  await expect(page.getByTestId("setup-step-academic-calendar")).toHaveAttribute(
    "data-done",
    "true",
  );
  await expect(page.getByTestId("setup-step-students")).toHaveAttribute("data-done", "false");
  await expect(page.getByTestId("setup-step-enrollments")).toHaveAttribute("data-done", "false");

  // The tiering is visible, not just modelled — the whole finding is that
  // everything used to read as equally mandatory.
  await expect(page.getByText(/the school cannot run day to day/i)).toBeVisible();
  await expect(page.getByText(/you can still work without them/i)).toBeVisible();

  // And the next action actually goes somewhere.
  await page
    .getByTestId("setup-step-students")
    .getByRole("link", { name: /add students/i })
    .click();
  await expect(page).toHaveURL(/\/students$/);

  // ───────────────────────────────────────────────────────────────────────
  // 2. A workflow screen with an absent prerequisite explains itself rather
  //    than showing a plausible-looking dead end.
  // ───────────────────────────────────────────────────────────────────────
  await page.goto("/enrollments");
  await expect(page.getByTestId("prerequisite-students")).toBeVisible();
  await expect(page.getByText(/there is nobody to enrol yet/i)).toBeVisible();
  // Not a route guard: the screen itself is still there and still usable.
  await expect(page.getByRole("heading", { name: "Enrollments" })).toBeVisible();

  await page.goto("/finance/invoices");
  await expect(page.getByTestId("prerequisite-fee-catalog")).toBeVisible();
  await expect(page.getByTestId("prerequisite-enrollments")).toBeVisible();
  await expect(page.getByRole("button", { name: /generate invoices/i })).toBeVisible();

  // ───────────────────────────────────────────────────────────────────────
  // 3. Partly configured — a roster alone does NOT finish setup. This is the
  //    finding's sharpest edge: the old dashboard said "add your first
  //    student" and then had nothing more to say, while every register and
  //    invoice stayed empty because nobody was enrolled.
  // ───────────────────────────────────────────────────────────────────────
  const student = await apiCreateStudent(api, {
    admissionNumber: `ADM-${suffix}`,
    firstName: "Adaeze",
    lastName: "Okonkwo",
    dateOfBirth: "2012-05-04",
    gender: "FEMALE",
  });

  await page.goto("/dashboard");
  await expect(page.getByTestId("setup-step-students")).toHaveAttribute("data-done", "true");
  await expect(page.getByTestId("setup-step-enrollments")).toHaveAttribute("data-done", "false");
  await expect(page.getByText(/next: put your students in their classes/i)).toBeVisible();

  // The handover appears on the Students page itself, at the moment it stops
  // being premature — an owner who has just built a roster is exactly who
  // needs telling.
  await page.goto("/students");
  await expect(page.getByTestId("prerequisite-enrollments")).toBeVisible();
  await expect(page.getByText(/on the roster but not yet in any class/i)).toBeVisible();

  // ───────────────────────────────────────────────────────────────────────
  // 4. Completed steps stay completed, and they are derived — no browser
  //    state is involved, so a brand-new browser context sees the same thing.
  // ───────────────────────────────────────────────────────────────────────
  // Read straight through the API context rather than the shared fixtures:
  // the existing helpers narrow their row types to the fields their own
  // callers use, and this test needs `isCurrent` (which is exactly the field
  // the whole feature keys off) plus the flat /class-arms list.
  interface CurrentRow {
    id: string;
    isCurrent: boolean;
  }
  const years = (await (await api.get("academic-years")).json()) as CurrentRow[];
  const currentYear = years.find((y) => y.isCurrent) ?? years[0]!;
  const terms = (await (
    await api.get(`academic-years/${currentYear.id}/terms`)
  ).json()) as CurrentRow[];
  const currentTerm = terms.find((t) => t.isCurrent) ?? terms[0]!;
  const arms = (await (await api.get("class-arms")).json()) as Array<{ id: string }>;
  const arm = arms[0]!;

  await apiCreateEnrollment(api, {
    studentId: student.id,
    termId: currentTerm.id,
    classArmId: arm.id,
  });

  const secondContext = await browser.newContext();
  await secondContext.addCookies([
    {
      name: "sk_session",
      value: admin.token,
      url: process.env.E2E_WEB_URL ?? "http://localhost:3001",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  const freshPage = await secondContext.newPage();
  await freshPage.goto("/dashboard");
  await expect(freshPage.getByTestId("setup-step-enrollments")).toHaveAttribute(
    "data-done",
    "true",
  );
  // Required work is done, so the card changes its tune rather than vanishing
  // — there is still recommended work, and the school has not started using
  // anything yet.
  await expect(
    freshPage.getByText(/a few things left to set up/i),
  ).toBeVisible();
  await secondContext.close();

  // The enrolment prerequisite is gone from every screen that carried it.
  await page.goto("/report-cards");
  await expect(page.getByTestId("prerequisite-enrollments")).toHaveCount(0);

  // ───────────────────────────────────────────────────────────────────────
  // 5. Established — real activity, not a dismiss button, ends the setup UI.
  //    Three recommended steps are still outstanding at this point (no
  //    teachers, no form teachers, no assignments) and the checklist must
  //    still be gone: an established school that has deliberately skipped
  //    something should not be nagged about it forever.
  // ───────────────────────────────────────────────────────────────────────
  const category = await apiCreateFeeCategory(api, { name: `Tuition ${suffix}` });
  await apiCreateFeeItem(api, {
    categoryId: category.id,
    name: "Term tuition",
    amount: 15_000_000,
  });
  const generated = await api.post("invoices/arm/generate", {
    data: { classArmId: arm.id, termId: currentTerm.id },
  });
  expect(generated.ok()).toBe(true);

  await page.goto("/dashboard");
  // The real dashboard, not the setup one.
  await expect(page.getByText(/enrolled/i).first()).toBeVisible();
  await expect(page.getByText(/finish setting up your school/i)).toHaveCount(
    0,
  );
  await expect(
    page.getByText(/a few things left to set up/i),
  ).toHaveCount(0);

  await page.goto("/finance/invoices");
  await expect(page.getByTestId("prerequisite-fee-catalog")).toHaveCount(0);
  await expect(page.getByTestId("prerequisite-enrollments")).toHaveCount(0);

  // ───────────────────────────────────────────────────────────────────────
  // 6. Permissions — a teacher is never handed owner-only setup actions.
  //    Every step in the list is owner/admin work, so offering one to a
  //    teacher would be the misleading navigation this slice removes, not a
  //    helpful hint. Report cards is the shared screen (same component under
  //    both route groups), so it is where the two would collide.
  // ───────────────────────────────────────────────────────────────────────
  const teacher = await inviteAndAcceptTeacher(browser, {
    schoolId: admin.schoolId,
    invitedByUserId: admin.ownerUserId,
  });
  await teacher.page.goto("/teacher/report-cards");
  await expect(teacher.page.getByTestId("prerequisite-enrollments")).toHaveCount(0);
  await expect(
    teacher.page.getByText(/finish setting up your school/i),
  ).toHaveCount(0);
  await teacher.context.close();

  await admin.context.close();
  await api.dispose();
});
