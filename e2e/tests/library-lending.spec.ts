import { expect, test } from "@playwright/test";

import { inviteAndAcceptTeacher, loginAsAdmin, loginAsTeacher, uniqueSuffix } from "../fixtures/index.js";
import { createPortalGuardian } from "../fixtures/guardian.js";

// Phase 9 / CP6.1 — the library (docs/modules/phase-9.md §14), in a real
// browser against a throwaway school: the Librarian adds a book with two
// numbered copies, lends one to a student at the desk, sees it on the loans
// list, and takes it back. The admin sees the book on the student's page and
// sets the library's rules, which the Librarian cannot reach.

test("the librarian catalogues a book, lends a copy to a student and takes it back", async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const suffix = uniqueSuffix();
  const admin = await loginAsAdmin(browser);
  const guardian = await createPortalGuardian(admin.api, { suffix, schoolId: admin.schoolId });
  const invited = await inviteAndAcceptTeacher(browser, {
    schoolId: admin.schoolId,
    invitedByUserId: admin.ownerUserId,
    firstName: "Bisi",
    lastName: "Librarian",
    roleKey: "librarian",
  });
  await invited.context.close();
  const librarian = await loginAsTeacher(browser, invited.email, invited.password);
  const title = `Things Fall Apart ${suffix}`;

  try {
    const page = librarian.page;

    // 1. The Librarian's home is the catalogue; the rules are not theirs.
    await page.goto("/library");
    await expect(page.getByRole("heading", { name: "Library", exact: true })).toBeVisible({ timeout: 60_000 });
    const libraryNav = page.getByRole("navigation", { name: "Library" });
    await expect(libraryNav.getByRole("link", { name: "Lending desk" })).toBeVisible();
    await expect(libraryNav.getByRole("link", { name: "Rules" })).toHaveCount(0);

    // 2. A book with two copies, numbered for her.
    await page.getByRole("button", { name: "Add a book" }).click();
    const form = page.getByRole("form", { name: "New book" });
    await form.getByLabel("Title").fill(title);
    await form.getByLabel("Author(s)").fill("Chinua Achebe");
    await form.getByLabel("ISBN (optional)").fill("978-0-385-47454-2");
    await form.getByLabel("Shelf location").fill("Fiction, shelf B");
    await form.getByLabel("Replacement price (₦, optional)").fill("4,500");
    await form.getByLabel("Number of copies").fill("2");
    await form.getByRole("button", { name: "Save book" }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("2 of 2 on the shelf")).toBeVisible();
    await expect(page.getByText("No. 1", { exact: true })).toBeVisible();
    await expect(page.getByText("No. 2", { exact: true })).toBeVisible();
    await expect(page.getByText("9780385474542")).toBeVisible();

    // 3. Lend copy 1 to the student at the desk.
    await page.goto("/library/desk");
    await page.getByLabel("Accession number").fill("1");
    await page.getByRole("button", { name: "Find copy" }).click();
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await page.getByLabel("Find a student").fill("Chidinma");
    await page.getByRole("button", { name: "Find", exact: true }).click();
    await page.getByRole("button", { name: "Choose Chidinma Adeleke" }).click();
    await expect(page.getByText(/has 0 of 2 books out/)).toBeVisible();
    await page.getByRole("button", { name: "Lend book" }).click();
    await expect(page.getByText(new RegExp(`"${title}" lent to Chidinma Adeleke\\. Due `))).toBeVisible();

    // 4. It is on the loans list, and not overdue.
    await page.goto("/library/loans");
    await expect(page.getByRole("link", { name: title })).toBeVisible();
    await expect(page.getByText(/No\. 1 · Chidinma Adeleke/)).toBeVisible();
    await page.getByRole("button", { name: "Overdue" }).click();
    await expect(page.getByText("No books are overdue.")).toBeVisible();

    // 5. The admin sees it on the student's page.
    await admin.page.goto(`/students/${guardian.studentId}`);
    await expect(admin.page.getByText("Library books out")).toBeVisible({ timeout: 60_000 });
    await expect(admin.page.getByRole("link", { name: title })).toBeVisible();

    // 6. Returned at the desk.
    await page.goto("/library/desk");
    await page.getByLabel("Accession number").fill("1");
    await page.getByRole("button", { name: "Find copy" }).click();
    await expect(page.getByText(/Lent to Chidinma Adeleke/)).toBeVisible();
    await page.getByRole("button", { name: "Return book" }).click();
    await expect(page.getByText(`"${title}" is back from Chidinma Adeleke.`)).toBeVisible();
    await page.goto("/library/loans");
    await expect(page.getByText("No loans to show.")).toBeVisible();

    // 7. The rules are the admin's.
    await admin.page.goto("/library/settings");
    await admin.page.getByLabel("Loan period (days)").fill("7");
    await admin.page.getByRole("button", { name: "Save rules" }).click();
    await expect(admin.page.getByText("Rules saved. They apply to books lent from now on.")).toBeVisible();
  } finally {
    await librarian.context.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
