import { expect, test, type BrowserContext } from "@playwright/test";

import { loginAsAdmin } from "../fixtures/index.js";

// Smart Student Import — camera capture reaching the review gate.
// docs/modules/smart-student-import.md.
//
// ---------------------------------------------------------------------------
// WHAT THIS TEST COVERS, AND WHAT IT DELIBERATELY DOES NOT.
//
// Covers: the route exists and is reachable from the students page, the
// capture control is a real camera-backed file input, and — critically — the
// feature degrades correctly when AI is switched off, pointing the admin at
// the CSV path instead of leaving them stuck.
//
// Does NOT cover: a real extraction. That would need a live ANTHROPIC_API_KEY
// in CI, and would spend real money on every push to produce a result no
// assertion here could meaningfully check (whether the model read a name
// correctly is a content question — see phase-5.md §9's standing note that
// every structural check in this repo can pass while the model writes fluent
// nonsense). Extraction correctness is the golden-fixture eval suite's job,
// against real photographed registers, and that asset does not exist yet.
//
// So this is a REACHABILITY AND DEGRADATION test, and it is written to be
// honest about that rather than to look like more coverage than it is.
// ---------------------------------------------------------------------------

test("smart student import — the scan page is reachable and degrades safely", async ({
  browser,
}) => {
  const toClose: BrowserContext[] = [];
  const admin = await loginAsAdmin(browser);
  toClose.push(admin.context);
  const page = admin.page;

  try {
    // --- The entry point exists on the students page ----------------------
    await page.goto("/students");
    const scanLink = page.getByRole("link", { name: /scan a student list/i }).first();
    await expect(scanLink).toBeVisible();

    // --- The route resolves ------------------------------------------------
    // A route-group mistake here — (scan) instead of scan — would 404, and
    // CLAUDE.md's route-group note says only the browser catches that.
    await page.goto("/students/scan");
    await expect(page.getByRole("heading", { name: /scan a student list/i })).toBeVisible();

    // --- The capture control is camera-backed ------------------------------
    // `capture="environment"` is what opens the rear camera directly on a
    // phone browser instead of a file browser. It is the whole reason this
    // works as a "photograph the register" flow rather than an upload flow,
    // and it is one attribute that a refactor could drop without breaking
    // anything visible on desktop.
    const input = page.locator('input[type="file"]#register-photo');
    await expect(input).toHaveAttribute("capture", "environment");
    await expect(input).toHaveAttribute("accept", /image\/jpeg/);

    // --- The retention promise is stated to the person taking the photo ----
    // D3 is a decision about the product, not only about the code: the admin
    // photographing forty children's details is entitled to know the image is
    // not kept. If this copy disappears, the decision has quietly become
    // invisible to the only person it protects.
    await expect(page.getByText(/is not stored/i)).toBeVisible();

    // --- Degradation when AI is off ---------------------------------------
    // In CI no ANTHROPIC_API_KEY is configured, so the API reports
    // AI_NOT_CONFIGURED and availability comes back false. The correct
    // behaviour is a disabled control plus a route onward to the CSV import —
    // NOT a dead end, and not a button that fails after the admin has already
    // taken the photo.
    //
    // If a key IS configured in this environment the button is enabled
    // instead, which is equally correct; the assertion branches rather than
    // pinning one environment's answer.
    const button = page.getByRole("button", { name: /take a photo/i });
    await expect(button).toBeVisible();

    const disabled = await button.isDisabled();
    if (disabled) {
      await expect(page.getByText(/not switched on for this school/i)).toBeVisible();
      await expect(
        page.getByRole("link", { name: /import students from a spreadsheet/i }),
      ).toBeVisible();
    }
  } finally {
    for (const context of toClose) await context.close();
  }
});
