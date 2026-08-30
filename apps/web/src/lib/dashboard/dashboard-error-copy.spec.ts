import { describe, expect, it } from "vitest";

import { dashboardErrorMessage } from "./dashboard-error-copy";

describe("dashboardErrorMessage", () => {
  it("does not expose a raw backend error", () => {
    expect(dashboardErrorMessage(new Error("DATABASE_TIMEOUT: 5xx"))).toBe(
      "We couldn’t load your dashboard. Refresh and try again.",
    );
  });
});
