import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { withTenant } from "@school-kit/db";

import { apiCreateEnrollment, apiCreateStudent } from "../fixtures/finance.js";
import { armId, loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";

// Phase 8c / CP5c — exam papers (docs/modules/phase-8.md §22.3).
//
// Through the real UI, as the school owner:
//   1. Start a two-version paper for the Exam column; add two multiple-choice
//      questions by hand and draw one theory question at random; save. The
//      total is computed.
//   2. Finalise. The paper is frozen — fields locked — and the export panel
//      appears.
//   3. Version B prints with its options moved, and version B's marking
//      scheme names the letter where the right answer now sits.
//   4. Word and CSV downloads are real files. Every export is audited.
//   5. The gradebook's Exam column now starts "Out of" the paper's total.
//   6. "Duplicate to edit" makes an editable draft copy.

const SUBJECT = "Agricultural Science";

test("a paper is set from the bank, finalised, printed per version with matching schemes, exported, and fills the gradebook's Out of", async ({
  browser,
}) => {
  const admin = await loginAsAdmin(browser);
  const suffix = uniqueSuffix();
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 2 Gold", code: `ep-gold-${suffix}` }],
    subjectName: SUBJECT,
    subjectCode: `agr-${suffix}`,
  });
  const classArmId = armId(structure, "JSS 2 Gold");
  const student = await apiCreateStudent(admin.api, {
    admissionNumber: `EP/${suffix}/1`,
    firstName: "Kemi",
    lastName: "Bello",
    dateOfBirth: "2012-05-14T00:00:00.000Z",
    gender: "FEMALE",
  });
  await apiCreateEnrollment(admin.api, { studentId: student.id, termId: structure.termId, classArmId });

  // Approved questions, through the real API.
  const pair = { subjectId: structure.subjectId, classLevelId: structure.classLevelId };
  const approve = async (body: Record<string, unknown>) => {
    const created = await admin.api.post("questions", { data: { ...pair, ...body } });
    expect(created.ok(), await created.text()).toBe(true);
    const { id } = (await created.json()) as { id: string };
    expect((await admin.api.post(`questions/${id}/approve`)).ok()).toBe(true);
  };
  const mcq = (text: string, options: string[], correct: number) =>
    approve({ topic: "Soil", type: "MULTIPLE_CHOICE", difficulty: "MEDIUM", text, marks: 1, options: options.map((o, i) => ({ text: o, isCorrect: i === correct })) });
  await mcq("Which soil holds the most water?", ["Sandy soil", "Loamy soil", "Clay soil", "Gravel"], 2);
  await mcq("Which is a cash crop?", ["Cocoa", "Maize", "Yam", "Cassava"], 0);
  await approve({ topic: "Soil", type: "THEORY", difficulty: "HARD", text: "Explain three ways to prevent soil erosion.", marks: 10, answerGuide: "Any three: cover crops, terracing, mulching." });

  const page = admin.page;
  page.on("dialog", (d) => void d.accept());

  try {
    // ---- 1. Start and build ----------------------------------------------------
    await page.goto("/teacher/exam-papers");
    await expect(page.getByRole("heading", { name: "Exam papers", level: 1 })).toBeVisible({ timeout: 60_000 });
    await page.getByLabel("Class", { exact: true }).selectOption({ label: "JSS 2" });
    await page.getByLabel("Subject", { exact: true }).selectOption({ label: SUBJECT });
    await page.getByLabel("Title").fill("First Term Examination");
    await page.getByLabel("Versions").selectOption({ label: "Two (A–B)" });
    await expect(page.getByLabel("Gradebook column")).toHaveValue(/.+/); // Exam, chosen for them
    await page.getByRole("button", { name: "Start paper" }).click();
    await expect(page).toHaveURL(/\/teacher\/exam-papers\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "First Term Examination", level: 1 })).toBeVisible();

    const sectionA = page.getByRole("region", { name: "Section A — Objectives" });
    await sectionA.getByRole("button", { name: "Add questions" }).click();
    const picker = page.getByRole("dialog");
    await picker.getByLabel("Which soil holds the most water?").check();
    await picker.getByLabel("Which is a cash crop?").check();
    await picker.getByRole("button", { name: "Add 2 selected" }).click();
    await expect(sectionA.getByRole("listitem")).toHaveCount(2);

    const sectionB = page.getByRole("region", { name: "Section B — Theory" });
    await sectionB.getByRole("button", { name: "Add questions" }).click();
    await picker.getByLabel("Draw at random").fill("1");
    await picker.getByRole("button", { name: "Draw theory questions" }).click();
    await expect(sectionB.getByRole("listitem")).toContainText("Explain three ways to prevent soil erosion.");
    await expect(page.getByLabel("Total marks")).toHaveText("12 marks");

    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Paper saved.")).toBeVisible();

    // ---- 2. Finalise -----------------------------------------------------------
    await page.getByRole("button", { name: "Finalise" }).click();
    await expect(page.getByText(/^Final/)).toBeVisible();
    await expect(page.getByLabel("Title", { exact: true })).toBeDisabled();
    await expect(page.getByRole("heading", { name: "Print and export" })).toBeVisible();
    await page.screenshot({ path: "test-results/exam-papers/1-final.png", fullPage: true });

    // ---- 3. Version B and its marking scheme agree ----------------------------
    await page.getByLabel("Version", { exact: true }).selectOption("B");
    const printed = async (button: "Question paper" | "Marking scheme") => {
      const [win] = await Promise.all([
        page.context().waitForEvent("page"),
        page.getByText(button, { exact: true }).locator("..").getByRole("button", { name: "Print / PDF" }).click(),
      ]);
      await expect(win.getByText("Version B")).toBeVisible();
      return win;
    };
    const paperWin = await printed("Question paper");
    const soil = paperWin.locator("li.q").filter({ hasText: "Which soil holds the most water?" });
    const soilNumber = (await soil.locator(".num").textContent())!;
    const options = await soil.locator(".options > div").allTextContents();
    expect(options.map((o) => o.slice(3)).sort()).toEqual(["Clay soil", "Gravel", "Loamy soil", "Sandy soil"]);
    expect(options.map((o) => o.slice(3))).not.toEqual(["Sandy soil", "Loamy soil", "Clay soil", "Gravel"]);
    await expect(paperWin.getByText("any three: cover crops", { exact: false })).toHaveCount(0); // no answers on the paper
    await paperWin.screenshot({ path: "test-results/exam-papers/2-paper-version-b.png", fullPage: true });
    const clayLetter = options.find((o) => o.endsWith("Clay soil"))!.slice(0, 1);

    const schemeWin = await printed("Marking scheme");
    await expect(schemeWin.getByText("Marking scheme — Version B")).toBeVisible();
    await expect(schemeWin.locator("li.q").filter({ has: schemeWin.locator(".num", { hasText: soilNumber }) }).locator(".key")).toHaveText(clayLetter);
    await schemeWin.close();
    await paperWin.close();

    // ---- 4. Word and CSV ------------------------------------------------------
    const download = async (container: string | null, name: RegExp) => {
      const scope = container ? page.getByText(container, { exact: true }).locator("..") : page;
      const [file] = await Promise.all([page.waitForEvent("download"), scope.getByRole("button", { name }).click()]);
      return { name: file.suggestedFilename(), body: readFileSync((await file.path())!) };
    };
    const word = await download("Question paper", /^Word$/);
    expect(word.name).toMatch(/version-b\.docx$/);
    expect(word.body.subarray(0, 2).toString()).toBe("PK");
    const csv = await download(null, /Download CSV/);
    expect(csv.body.toString("utf8")).toContain("Version,Section,Number,Type,Question,Option A");

    const paperId = page.url().split("/").pop()!;
    const audited = await withTenant(admin.schoolId, (db) =>
      db.auditLog.count({ where: { entityId: paperId, action: "exam-paper.export" } }),
    );
    expect(audited).toBe(4); // paper print, scheme print, Word, CSV

    // ---- 5. The gradebook's Exam column starts "Out of" the paper -------------
    await page.goto(`/gradebook/${classArmId}/${structure.subjectId}?termId=${structure.termId}`);
    await expect(page.getByLabel("Exam out of")).toHaveValue("12", { timeout: 60_000 });
    await expect(page.getByText("From the paper “First Term Examination”")).toBeVisible();

    // ---- 6. Duplicate to edit -------------------------------------------------
    await page.goto(`/teacher/exam-papers/${paperId}`);
    await page.getByRole("button", { name: "Duplicate to edit" }).click();
    await expect(page).not.toHaveURL(new RegExp(paperId));
    await expect(page.getByRole("heading", { name: "First Term Examination (copy)", level: 1 })).toBeVisible();
    await expect(page.getByLabel("Title", { exact: true })).toBeEnabled();
    await expect(page.getByText("Draft", { exact: true })).toBeVisible();
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});
