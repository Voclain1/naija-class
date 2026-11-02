import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "../fixtures/session.js";

// Setup calls (docs/modules/onboarding-call.md): a new school's owner is sent
// to the booking page instead of the dashboard, once. Booking shows the
// confirmation with the WhatsApp button; the page never comes back.

test("a new school's owner books a setup call, then never sees the page again", async ({ browser }) => {
  const admin = await loginAsAdmin(browser, { setupCallPending: true });
  try {
    const page = admin.page;
    await page.goto("/dashboard");
    await page.waitForURL(/\/welcome$/);
    await expect(page.getByRole("heading", { name: /Let's finish setting up/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "hello@schoolkit.ng" })).toBeVisible();

    // The name is the owner's; the second day and a 10:00 am slot.
    await expect(page.getByLabel("Your name")).toHaveValue("Eve Owner");
    await page.locator("fieldset").first().getByRole("button").nth(1).click();
    await page.getByRole("button", { name: "10:00 am" }).click();
    await page.getByTestId("setup-call-book").click();

    const booked = page.getByTestId("setup-call-booked");
    await expect(booked).toBeVisible();
    await expect(booked.getByText("at 10:00 am")).toBeVisible();
    const wa = booked.getByRole("link", { name: /Send to SchoolKit on WhatsApp/ });
    await expect(wa).toHaveAttribute("href", /^https:\/\/wa\.me\/2347049677393\?text=/);

    await page.getByTestId("setup-call-dashboard").click();
    await page.waitForURL(/\/dashboard/);
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard/);
    await page.goto("/welcome");
    await page.waitForURL(/\/dashboard/);
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});

test("Skip for now closes the page; the checklist's link still books a call", async ({ browser }) => {
  const admin = await loginAsAdmin(browser, { setupCallPending: true });
  try {
    const page = admin.page;
    await page.goto("/welcome");
    await page.getByTestId("setup-call-skip-top").click();
    await page.waitForURL(/\/dashboard/);
    await page.goto("/welcome");
    await page.waitForURL(/\/dashboard/);

    // Getting started (docs/modules/activation.md): the checklist still offers
    // the call to an owner who skipped it, and its link opens the form.
    await page.getByTestId("checklist-book-call").click();
    await page.waitForURL(/\/welcome\?book=1$/);
    await expect(page.getByRole("heading", { name: /Let's finish setting up/ })).toBeVisible();
    await expect(page.getByTestId("setup-call-book")).toBeVisible();
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});
