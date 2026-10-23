import { expect, test } from "@playwright/test";

import { loginAsAdmin } from "../fixtures/index.js";
import { PORTAL_BASE_URL } from "../fixtures/guardian.js";

// The school's public website (docs/modules/school-website.md): the owner
// writes the page details in Settings → School website and publishes them;
// adds a gallery photo, which needs the "no pupils" tick first; ticks an event
// for the website. A visitor then sees all three on the school's page.

// A real 64 × 48 PNG: the browser must be able to decode it to resize it.
const PHOTO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAAVUlEQVR4nO3PQQ3AIADAQEAAprCBfx0TweOypKegnfue8WdLB7xqQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtA+wBh4gENnet3+gAAAABJRU5ErkJggg==",
  "base64",
);

test("the owner builds the school's page; a visitor sees the welcome, an event and a photo", async ({ browser }) => {
  test.setTimeout(4 * 60 * 1000);
  const admin = await loginAsAdmin(browser);
  const me = await admin.api.get("schools/me");
  expect(me.ok(), await me.text()).toBe(true);
  const school = (await me.json()) as { name: string; slug: string };

  // An event ticked for the website, through the API (the calendar form is covered elsewhere).
  const day = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
  const event = await admin.api.post("calendar/events", {
    data: { title: "Inter-house sports", category: "EVENT", startDate: day, endDate: day, showOnWebsite: true },
  });
  expect(event.ok(), await event.text()).toBe(true);

  const page = admin.page;
  await page.goto("/settings/website");
  await expect(page.getByRole("heading", { name: "School website" })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel("Welcome line").fill("A caring school in the heart of Enugu");
  await page.getByLabel("Our story").fill("We began with forty pupils in two classrooms.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText("You have changes families cannot see yet.")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Publish page details" }).click();
  await expect(page.getByText("You have changes families cannot see yet.")).toBeHidden({ timeout: 30_000 });

  // The gallery: the upload stays shut until the tick is given.
  await page.getByRole("tab", { name: /Gallery/ }).click();
  const add = page.getByRole("button", { name: "Add to the gallery" });
  await expect(add).toBeDisabled();
  await page.getByLabel("This photo shows no pupils.").check();
  await expect(add).toBeEnabled();
  await page.getByTestId("website-photo-file").setInputFiles({ name: "library.png", mimeType: "image/png", buffer: PHOTO });
  await expect(page.getByText("1 of 300 photos.")).toBeVisible({ timeout: 30_000 });

  const visitor = await browser.newContext();
  try {
    const site = await visitor.newPage();
    await site.goto(`${PORTAL_BASE_URL}/school/${school.slug}`);
    await expect(site.getByRole("heading", { level: 1, name: school.name })).toBeVisible({ timeout: 60_000 });
    await expect(site.getByText("A caring school in the heart of Enugu")).toBeVisible();
    await expect(site.getByText("We began with forty pupils in two classrooms.")).toBeVisible();
    await expect(site.getByRole("heading", { name: "Coming up" })).toBeVisible();
    await expect(site.getByText("Inter-house sports")).toBeVisible();
    await expect(site.getByRole("heading", { name: "Gallery" })).toBeVisible();
    await expect(site.getByRole("button", { name: "Report this photo" })).toBeVisible();
  } finally {
    await visitor.close();
  }
});
