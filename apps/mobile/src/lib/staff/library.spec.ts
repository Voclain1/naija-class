import { describe, expect, it } from "vitest";

import { foundNotice } from "./library";

describe("foundNotice (CP11.2)", () => {
  it("says what happened to the replacement charge", () => {
    expect(foundNotice("voided")).toBe("Back on the shelf. The replacement charge was cancelled.");
    expect(foundNotice("billed")).toMatch(/already on an invoice/);
    expect(foundNotice("none")).toBe("Back on the shelf.");
    expect(foundNotice(undefined)).toBe("Back on the shelf.");
  });
});
