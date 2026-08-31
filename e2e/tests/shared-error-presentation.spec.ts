import { expect, test } from "@playwright/test";
import axeCore from "axe-core";

import { loginAsAdmin, setupAcademicStructure } from "../fixtures/index.js";

const axeSource = axeCore.source;

function relativeLuminance([red, green, blue]: number[]): number {
  const linear = [red, green, blue].map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

function contrastRatio(foreground: number[], background: number[]): number {
  const light = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const dark = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (light + 0.05) / (dark + 0.05);
}

test.describe("shared error presentation", () => {
  test("a failed finance load is an AA-readable alert, not an empty state, and Retry recovers", async ({ browser }) => {
    const admin = await loginAsAdmin(browser);
    const academic = await setupAcademicStructure(admin.api);
    let dashboardRequests = 0;

    await admin.page.route("**/api/v1/finance/dashboard?termId=*", async (route) => {
      dashboardRequests += 1;
      if (dashboardRequests === 1) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "DATABASE_TIMEOUT" }),
        });
        return;
      }
      await route.continue();
    });

    await admin.page.goto("/finance/dashboard");
    await expect(admin.page.locator("#fin-dash-year")).not.toHaveValue("");
    await expect(admin.page.getByRole("alert")).toContainText("Could not load finance dashboard");
    await expect(admin.page.getByRole("alert")).not.toContainText("DATABASE_TIMEOUT");
    await expect(admin.page.getByText("No debtors")).toHaveCount(0);

    // Browser-computed colours include the current design tokens. The alert
    // background is translucent, so calculate the conservative text contrast
    // against the opaque page background it is painted over.
    const ratio = await admin.page.getByRole("alert").evaluate((node) => {
      const parse = (value: string) => value.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number) ?? [];
      const foreground = parse(getComputedStyle(node).color);
      const pageBackground = parse(getComputedStyle(document.body).backgroundColor);
      return { foreground, pageBackground };
    });
    expect(contrastRatio(ratio.foreground, ratio.pageBackground)).toBeGreaterThanOrEqual(4.5);

    await admin.page.addScriptTag({ content: axeSource });
    const axe = await admin.page.evaluate(async () => {
      const axe = (window as unknown as {
        axe: { run: (context: Element | null) => Promise<{ violations: Array<{ id: string }> }> };
      }).axe;
      const result = await axe.run(document.querySelector("[role=alert]"));
      return result.violations.filter((violation) => violation.id === "color-contrast");
    });
    expect(axe).toEqual([]);

    await admin.page.getByRole("button", { name: "Retry" }).click();
    await expect(admin.page.getByRole("alert")).toHaveCount(0);
    expect(dashboardRequests).toBe(2);

    await admin.context.close();
    await admin.api.dispose();
  });
});
