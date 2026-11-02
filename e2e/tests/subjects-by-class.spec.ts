import { expect, test } from "@playwright/test";

import { loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";

// Subjects by class (2026-11-02, docs/modules/subjects-by-class.md), through
// the real screens: the standard subjects are already there by stage, a
// school adds and removes subjects per stage, and hides one for a term and
// unhides it. What a hide does to totals and report cards is proven in
// report-card.service.spec.ts.

test("subjects by class: standard subjects per stage, add, remove, hide and unhide", async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await loginAsAdmin(browser);
  const page = admin.page;
  try {
    await setupAcademicStructure(admin.api);
    await page.goto("/settings/academic/class-subjects");
    await expect(page.getByRole("heading", { name: "Subjects by class" })).toBeVisible({ timeout: 60_000 });

    // The standard subjects are there without any mapping; KG is its own
    // stage, and a stage with no classes (Nursery is not seeded) has no section.
    const jss = page.getByTestId("stage-JSS");
    const sss = page.getByTestId("stage-SSS");
    await expect(jss.getByText("Basic Science", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(sss.getByText("Physics", { exact: true })).toBeVisible();
    await expect(jss.getByText("Physics", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("stage-KG")).toBeVisible();
    await expect(page.getByTestId("stage-KG").getByText("Phonics", { exact: true })).toBeVisible();
    await expect(page.getByTestId("stage-NURSERY")).toHaveCount(0);

    // Add a subject of the school's own to JSS.
    const own = `Diction ${uniqueSuffix().slice(-4)}`;
    await jss.getByRole("button", { name: "Add a subject" }).click();
    const add = page.getByRole("dialog", { name: /Add a subject to Junior Secondary/ });
    await add.getByLabel("Or a new subject").fill(own);
    await add.getByRole("button", { name: "Add subject" }).click();
    await expect(jss.getByText(own, { exact: true })).toBeVisible({ timeout: 30_000 });

    // Take it off JSS again.
    page.once("dialog", (d) => void d.accept());
    await jss.getByRole("button", { name: `Take ${own} off Junior Secondary (JSS)` }).click();
    await expect(jss.getByText(own, { exact: true })).toHaveCount(0, { timeout: 30_000 });

    // Hide Physics for the whole school, this term.
    await expect(page.getByText("No subject is hidden.")).toBeVisible();
    await page.getByRole("button", { name: "Hide a subject" }).click();
    const hide = page.getByRole("dialog", { name: "Hide a subject" });
    await hide.getByLabel("Subject").selectOption({ label: "Physics" });
    await hide.getByLabel("The whole school").check();
    await hide.getByLabel("This term only").check();
    await hide.getByRole("button", { name: "Hide subject" }).click();

    const hidden = page.getByTestId("hidden-subjects");
    await expect(hidden.getByText("Physics", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(hidden.getByText(/Whole school · First Term/)).toBeVisible();

    // Unhiding brings it back; the hide stays on record under "Show ended and unhidden".
    await hidden.getByRole("button", { name: "Unhide" }).click();
    await expect(page.getByText("No subject is hidden.")).toBeVisible({ timeout: 30_000 });
    await page.getByLabel("Show ended and unhidden").check();
    await expect(hidden.getByText(/unhidden/)).toBeVisible({ timeout: 30_000 });
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});
