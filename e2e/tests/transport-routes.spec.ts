import { expect, test } from "@playwright/test";

import { loginAsAdmin, setupAcademicStructure, uniqueSuffix } from "../fixtures/index.js";
import { setupFinanceScaffold } from "../fixtures/finance.js";

// Phase 9 / CP5.2 — transport (docs/modules/phase-9.md §13), in a real
// browser against a throwaway school: a vehicle and driver, a route with
// stops and a fee, a child put on it (raising the transport charge), the
// student page's line, and the charge on Finance → Charges.

test("a route with stops, a vehicle and a fee takes a child and raises the charge", async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const suffix = uniqueSuffix();
  const admin = await loginAsAdmin(browser);
  const structure = await setupAcademicStructure(admin.api, {
    arms: [{ name: "JSS 1 Blue", code: `jss1b-${suffix}`.slice(0, 20) }],
    subjectCode: `math-${suffix}`.slice(0, 20),
  });
  const arm = structure.arms[0]!;
  const { students } = await setupFinanceScaffold(admin.api, {
    suffix,
    termId: structure.termId,
    classArmId: arm.id,
    classLevelId: structure.classLevelId,
    academicYearId: structure.academicYearId,
  });
  const child = students[0]!;
  const childName = `${child.firstName} ${child.lastName}`;
  const plate = `KJA ${suffix.slice(0, 6).toUpperCase()}`;

  try {
    const page = admin.page;

    // 1. A vehicle and a driver.
    await page.goto("/transport/vehicles");
    await page.getByRole("button", { name: "Add a vehicle" }).click();
    const vehicleForm = page.getByRole("form", { name: "New vehicle" });
    await vehicleForm.getByLabel("Plate number").fill(plate.toLowerCase());
    await vehicleForm.getByLabel("Seats for children").fill("14");
    await vehicleForm.getByRole("button", { name: "Save vehicle" }).click();
    await expect(page.getByText(plate, { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Add a driver" }).click();
    const driverForm = page.getByRole("form", { name: "New driver" });
    await driverForm.getByLabel("Name").fill("Musa Abubakar");
    await driverForm.getByLabel("Phone").fill("08031234567");
    await driverForm.getByLabel("Licence expiry (optional)").fill("2020-01-31");
    await driverForm.getByRole("button", { name: "Save driver" }).click();
    await expect(page.getByText("Musa Abubakar")).toBeVisible();
    // An expired licence is said in words, not only by colour.
    await expect(page.getByText("Licence expired (2020-01-31)")).toBeVisible();

    // 2. A route.
    await page.goto("/transport");
    await page.getByLabel("Route name").fill("Lekki – Ajah");
    await page.getByRole("button", { name: "Create route" }).click();
    await expect(page.getByRole("heading", { name: "Lekki – Ajah" })).toBeVisible();

    await page.getByLabel("Vehicle").selectOption({ label: `${plate} (14 seats)` });
    await page.getByLabel("Driver").selectOption({ label: "Musa Abubakar" });
    await page.getByRole("button", { name: "Save details" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    await page.getByRole("button", { name: "Add a stop" }).click();
    await page.getByLabel("Stop 1", { exact: true }).fill("Lekki Phase 1");
    await page.getByLabel("Pickup time for stop 1").fill("06:30");
    await page.getByRole("button", { name: "Add a stop" }).click();
    await page.getByLabel("Stop 2", { exact: true }).fill("Ajah");
    await page.getByRole("button", { name: "Save stops" }).click();
    await expect(page.getByText("Stops saved.")).toBeVisible();

    await page.getByLabel("Fee (₦)").fill("35,000");
    await page.getByRole("button", { name: "Save fee" }).click();
    await expect(page.getByText("Fee saved.")).toBeVisible();

    // 3. A child on the route, at the second stop.
    await page.locator("#route-term").selectOption({ index: 1 });
    await expect(page.getByText("0 of 14 seats taken")).toBeVisible();
    await page.getByLabel("Find a student").fill(child.firstName);
    await page.getByRole("button", { name: "Find", exact: true }).click();
    await page.getByRole("button", { name: `Choose ${childName}` }).click();
    await expect(page.getByText(/raises a ₦35,000(\.00)? transport charge/)).toBeVisible();
    await page.getByLabel("Stop", { exact: true }).selectOption({ label: "Ajah" });
    await page.getByRole("button", { name: "Add to route" }).click();
    await expect(page.getByText("1 of 14 seats taken")).toBeVisible();
    await expect(page.getByText("Fee waiting to be billed")).toBeVisible();

    // 4. The student page says so.
    await page.goto(`/students/${child.id}`);
    await expect(page.getByText("Lekki – Ajah · Ajah")).toBeVisible();

    // 5. The charge is on Finance → Charges, as a transport line.
    await page.goto("/finance/charges");
    await page.locator("#charges-term").selectOption({ index: 1 });
    await page.locator("#charges-class").selectOption({ label: arm.name });
    await expect(page.getByText("Transport — Lekki – Ajah")).toBeVisible();
    await expect(page.getByText("Waiting to be billed")).toBeVisible();
  } finally {
    await admin.context.close();
    await admin.api.dispose();
  }
});
