import { describe, expect, it } from "vitest";

import { fitWithin } from "./resize";

describe("fitWithin", () => {
  it("shrinks the long side to the limit and keeps the shape", () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 480)).toEqual({ width: 360, height: 480 });
  });

  it("never enlarges a small picture", () => {
    expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
  });
});
