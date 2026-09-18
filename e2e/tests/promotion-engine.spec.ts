import { expect, test, type APIRequestContext } from "@playwright/test";

import {
  apiCreateAcademicYear,
  apiCreateClassArm,
  apiCreateTerm,
  apiListClassArms,
  apiListClassLevels,
  apiSetCurrentTerm,
  apiSetCurrentYear,
} from "../fixtures/api.js";
import { apiCreateEnrollment, apiCreateStudent } from "../fixtures/finance.js";
import { loginAsAdmin, uniqueSuffix, type AdminSession } from "../fixtures/index.js";

// Promotion engine — docs/modules/promotion-engine.md.
//
// API-FIRST SETUP, UI-ONLY ASSERTIONS, like the rest of this suite. The school,
// its two academic years and last year's roster are built over HTTP; the
// browser drives only the thing under test: /enrollments/promote.
//
// The shape deliberately reproduces the awkward real case rather than the easy
// one — Primary 1 has TWO arms and Primary 2 has ONE, so the arm-gap path is
// exercised on the way through, not as an afterthought.

interface Scaffold {
  lastYearTermId: string;
  lastYearTermName: string;
  thisYearTermName: string;
  lastYearLabel: string;
  thisYearLabel: string;
  pri1aId: string;
  pri1bId: string;
  pri2aId: string;
  thisYearTermId: string;
  students: { id: string; lastName: string; firstName: string }[];
}

// Two years, two Primary 1 arms, one Primary 2 arm, three children enrolled in
// last year's Third Term (two in 1A, one in 1B).
async function scaffold(api: APIRequestContext): Promise<Scaffold> {
  const suffix = uniqueSuffix();
  const lastYearLabel = `2024/2025-${suffix}`;
  const thisYearLabel = `2025/2026-${suffix}`;

  const lastYear = await apiCreateAcademicYear(api, {
    label: lastYearLabel,
    startDate: "2024-09-01T00:00:00.000Z",
    endDate: "2025-07-31T00:00:00.000Z",
  });
  const lastYearTerm = await apiCreateTerm(api, lastYear.id, {
    sequence: 3,
    name: "Third Term",
    startDate: "2025-04-20T00:00:00.000Z",
    endDate: "2025-07-31T00:00:00.000Z",
  });

  const thisYear = await apiCreateAcademicYear(api, {
    label: thisYearLabel,
    startDate: "2025-09-01T00:00:00.000Z",
    endDate: "2026-07-31T00:00:00.000Z",
  });
  const thisYearTerm = await apiCreateTerm(api, thisYear.id, {
    sequence: 1,
    name: "First Term",
    startDate: "2025-09-01T00:00:00.000Z",
    endDate: "2025-12-15T00:00:00.000Z",
  });
  // The page defaults its TARGET to the current term, so make the new year
  // current — the state a school is actually in when it promotes.
  await apiSetCurrentYear(api, thisYear.id);
  await apiSetCurrentTerm(api, thisYearTerm.id);

  const levels = await apiListClassLevels(api);
  const pri1 = levels.find((l) => l.code === "pri1");
  const pri2 = levels.find((l) => l.code === "pri2");
  if (!pri1 || !pri2) throw new Error("seeded Primary 1/2 levels not found");

  // Signup seeds one "A" arm per level; reuse those and add only 1B, so
  // Primary 2 is one arm short of Primary 1.
  const pri1a = (await apiListClassArms(api, pri1.id))[0];
  const pri2a = (await apiListClassArms(api, pri2.id))[0];
  if (!pri1a || !pri2a) throw new Error("seeded arms not found");
  const pri1b = await apiCreateClassArm(api, pri1.id, {
    name: "Primary 1B",
    code: "pri1-b",
  });

  const roster = [
    { firstName: "Adaeze", lastName: "Okonkwo", arm: pri1a.id },
    { firstName: "Ibrahim", lastName: "Danjuma", arm: pri1a.id },
    { firstName: "Chisom", lastName: "Eze", arm: pri1b.id },
  ];
  const students: Scaffold["students"] = [];
  for (const [i, entry] of roster.entries()) {
    const student = await apiCreateStudent(api, {
      admissionNumber: `ADM/${suffix}/${i}`,
      firstName: entry.firstName,
      lastName: entry.lastName,
      dateOfBirth: "2016-03-15T00:00:00.000Z",
      gender: "FEMALE",
    });
    await apiCreateEnrollment(api, {
      studentId: student.id,
      termId: lastYearTerm.id,
      classArmId: entry.arm,
    });
    students.push({
      id: student.id,
      firstName: entry.firstName,
      lastName: entry.lastName,
    });
  }

  return {
    lastYearTermId: lastYearTerm.id,
    lastYearTermName: "Third Term",
    thisYearTermName: "First Term",
    lastYearLabel,
    thisYearLabel,
    pri1aId: pri1a.id,
    pri1bId: pri1b.id,
    pri2aId: pri2a.id,
    thisYearTermId: thisYearTerm.id,
    students,
  };
}

test.describe("promotion engine", () => {
  let session: AdminSession;

  test.beforeEach(async ({ browser }) => {
    session = await loginAsAdmin(browser);
  });

  test.afterEach(async () => {
    await session.api.dispose();
    await session.context.close();
  });

  test("promotes a whole school in one approval, filling an arm gap on the way", async () => {
    const data = await scaffold(session.api);
    const { page } = session;

    await page.goto("/enrollments/promote");
    await expect(
      page.getByRole("heading", { name: "Promote students" }),
    ).toBeVisible();

    // BOTH terms are selected by ID, not by label. A school is seeded with its
    // own academic calendar at signup, so "Third Term" is not a unique label —
    // selecting by name picked the seeded year's term and the API correctly
    // refused the roll as backwards. Ids are what the option values carry.
    await page
      .getByLabel("Move students from")
      .selectOption(data.lastYearTermId);
    await page.getByLabel("Into").selectOption(data.thisYearTermId);
    await page.getByRole("button", { name: "Show me the list" }).click();

    // Year mode, because the two terms sit in different academic years.
    await expect(
      page.getByText("New academic year — students move up a class."),
    ).toBeVisible();

    // Primary 1A's two children are proposed into Primary 2A.
    const pri1aSection = page.locator("section", {
      has: page.getByRole("heading", { name: "Primary 1A", exact: true }),
    });
    await expect(pri1aSection.getByText("Okonkwo Adaeze")).toBeVisible();
    await expect(pri1aSection.getByText("Danjuma Ibrahim")).toBeVisible();
    const adaezeRow = pri1aSection.locator("tr", {
      has: page.getByText("Okonkwo Adaeze"),
    });
    await expect(adaezeRow.locator("select").nth(1)).toHaveValue(data.pri2aId);

    // Primary 1B has nowhere to go — reported once for the arm, not per child.
    await expect(page.getByText("1 class has nowhere to go")).toBeVisible();
    await expect(
      page.getByText("Primary 2 has no matching arm."),
    ).toBeVisible();
    // ...and that child is held back from the count until it is resolved.
    await expect(page.getByText("2 promoted")).toBeVisible();

    // Fill the gap the way an admin would: create the missing class.
    await page.getByRole("button", { name: "Create Primary 2B" }).click();
    await expect(page.getByText("nowhere to go")).toHaveCount(0);
    await expect(page.getByText("3 promoted")).toBeVisible();

    // One child repeats.
    const chisomRow = page.locator("tr", {
      has: page.getByText("Eze Chisom"),
    });
    await chisomRow.locator("select").first().selectOption("REPEAT");
    await expect(page.getByText("2 promoted")).toBeVisible();
    await expect(page.getByText("1 repeating")).toBeVisible();

    // Approve, once, for the whole school.
    await page.getByRole("button", { name: "Review and approve" }).click();
    await expect(
      page.getByRole("heading", { name: "Apply this promotion?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^Apply to 3 students$/ }).click();

    await expect(page.getByRole("heading", { name: "Done" })).toBeVisible();
    await expect(
      page.getByText("3 enrolled · 2 promoted · 1 repeating"),
    ).toBeVisible();

    // What actually landed in the database, read back through the API.
    const res = await session.api.get(
      `enrollments?termId=${data.thisYearTermId}`,
    );
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as {
      data: {
        studentId: string;
        classArmId: string;
        promotedFromArmId: string | null;
      }[];
    };
    expect(body.data).toHaveLength(3);

    const [adaeze, ibrahim, chisom] = data.students;
    const rowFor = (studentId: string) =>
      body.data.find((r) => r.studentId === studentId);

    // Promoted into Primary 2A, with a pointer back to where they came from.
    expect(rowFor(adaeze!.id)?.classArmId).toBe(data.pri2aId);
    expect(rowFor(adaeze!.id)?.promotedFromArmId).toBe(data.pri1aId);
    expect(rowFor(ibrahim!.id)?.classArmId).toBe(data.pri2aId);
    // Repeating: still in Primary 1B, not moved up.
    expect(rowFor(chisom!.id)?.classArmId).toBe(data.pri1bId);
  });

  test("re-running the same promotion writes nothing the second time", async () => {
    const data = await scaffold(session.api);
    const { page } = session;

    await page.goto("/enrollments/promote");
    await page
      .getByLabel("Move students from")
      .selectOption(data.lastYearTermId);
    await page.getByLabel("Into").selectOption(data.thisYearTermId);
    await page.getByRole("button", { name: "Show me the list" }).click();

    // Leave Primary 1B unresolved and promote only Primary 1A, so the first
    // run is deliberately partial — the state an interrupted roll leaves.
    await expect(page.getByText("2 promoted")).toBeVisible();
    await page.getByRole("button", { name: "Review and approve" }).click();
    await page.getByRole("button", { name: /^Apply to 2 students$/ }).click();
    await expect(page.getByText("2 enrolled")).toBeVisible();

    // The preview reloads after a commit. Those two now hold a place in the
    // target term, so they come back as already-placed and excluded — which is
    // what makes finishing an interrupted roll safe.
    await expect(page.getByText("already placed")).toHaveCount(2);
    await expect(page.getByText("0 promoted")).toBeVisible();

    const res = await session.api.get(
      `enrollments?termId=${data.thisYearTermId}`,
    );
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(2);
  });
});
