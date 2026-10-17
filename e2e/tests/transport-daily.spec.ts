import { expect, test } from "@playwright/test";

import { loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";
import { apiCreateEnrollment } from "../fixtures/finance.js";
import { createPortalGuardian, PORTAL_BASE_URL } from "../fixtures/guardian.js";

// Phase 9 / CP5.3 — the day's route list and what a parent sees
// (docs/modules/phase-9.md §13 CP5-D9/D10), in a real browser against a
// throwaway school. The route is set up over the API; the screens under test
// are the driver's list on the website and the bus card in the portal.

async function ok<T>(res: { ok(): boolean; status(): number; text(): Promise<string>; json(): Promise<unknown> }, label: string): Promise<T> {
  if (!res.ok()) throw new Error(`${label}: ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

test("the driver's list names each child at their stop with a parent's phone, and the parent sees the bus", async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const suffix = uniqueSuffix();
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 1 Red", code: `jss1r-${suffix}`.slice(0, 20) }],
    subjectCode: `math-${suffix}`.slice(0, 20),
  });
  const arm = structure.arms[0]!;
  const guardian = await createPortalGuardian(admin.api, { suffix, schoolId: admin.schoolId });
  await apiCreateEnrollment(admin.api, { studentId: guardian.studentId, termId: structure.termId, classArmId: arm.id });

  const vehicle = await ok<{ id: string }>(
    await admin.api.post("transport/vehicles", { data: { plate: `KJA ${suffix.slice(0, 5)}`, seats: 14 } }),
    "vehicle",
  );
  const driver = await ok<{ id: string }>(
    await admin.api.post("transport/drivers", { data: { name: "Musa Abubakar", phone: "08031234567" } }),
    "driver",
  );
  const route = await ok<{ id: string }>(
    await admin.api.post("transport/routes", { data: { name: "Ikoyi – VI", vehicleId: vehicle.id, driverId: driver.id } }),
    "route",
  );
  const withStops = await ok<{ stops: { id: string; name: string }[] }>(
    await admin.api.put(`transport/routes/${route.id}/stops`, {
      data: { stops: [{ name: "Falomo", pickupMinute: 405 }, { name: "Bourdillon" }] },
    }),
    "stops",
  );
  await ok(
    await admin.api.post("transport/places", {
      data: { studentId: guardian.studentId, termId: structure.termId, routeId: route.id, stopId: withStops.stops[0]!.id },
    }),
    "place",
  );
  const child = `${guardian.studentFirstName} ${guardian.lastName}`;
  const parentContext = await browser.newContext();

  try {
    // 1. The driver's list for a school day: the stop, the child, the parent's phone.
    const page = admin.page;
    await page.goto(`/transport/routes/${route.id}`);
    await page.getByRole("link", { name: "Today's list" }).click();
    await expect(page.getByRole("heading", { name: "Ikoyi – VI" })).toBeVisible();
    await expect(page.getByText("Confidential: for the driver's use on this route.")).toBeVisible();
    // The fixture's term is in 2025; the page opens on today, so choose a day in it.
    await page.getByLabel("Date").fill("2025-10-01");
    await expect(page.getByText("1. Falomo · 06:45")).toBeVisible();
    await expect(page.getByText(child)).toBeVisible();
    const phone = page.locator(`a[href^="tel:"]`).first();
    await expect(phone).toBeVisible();
    await expect(page.getByText("No one at this stop.")).toBeVisible();
    await expect(page.getByRole("button", { name: /Print/ })).toBeVisible();

    // A day outside every term lists nobody.
    await page.getByLabel("Date").fill("1999-01-01");
    await expect(page.getByText("That date is not in any term, so no children are listed.")).toBeVisible();

    // 2. The parent sees the bus on the child's page.
    const parent = await parentContext.newPage();
    await parent.goto(`${PORTAL_BASE_URL}/login`);
    await parent.getByLabel("Email").fill(guardian.email);
    await parent.getByLabel("Password", { exact: true }).fill(guardian.password);
    await parent.getByRole("button", { name: "Log in" }).click();
    await expect(parent.getByRole("heading", { name: "Your children" })).toBeVisible({ timeout: 60_000 });
    await parent.goto(`${PORTAL_BASE_URL}/students/${guardian.studentId}`);
    await expect(parent.getByRole("heading", { name: "School bus" })).toBeVisible({ timeout: 60_000 });
    await expect(parent.getByText("Ikoyi – VI")).toBeVisible();
    await expect(parent.getByText("Falomo · pickup 06:45")).toBeVisible();
    await expect(parent.getByRole("link", { name: "08031234567" })).toBeVisible();
  } finally {
    await parentContext.close();
    await admin.context.close();
    await admin.api.dispose();
  }
});
