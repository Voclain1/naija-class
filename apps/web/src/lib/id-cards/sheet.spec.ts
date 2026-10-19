import { describe, expect, it } from "vitest";

import { mirrorRows } from "./sheet";

describe("A4 back sheet", () => {
  it("swaps each row's two cards, keeping blanks in place", () => {
    expect(mirrorRows(["a", "b", "c", null, null, null, null, null, null, null])).toEqual([
      "b", "a", null, "c", null, null, null, null, null, null,
    ]);
  });
});
