import { describe, expect, it } from "vitest";

import { PASTE_THRESHOLD, countChange } from "./paste-counter";

// Q7's paste indicator, as the phone counts it.
describe("countChange", () => {
  const zero = { typed: 0, pasted: 0 };

  it("a key at a time is typed", () => {
    let counts = zero;
    let text = "";
    for (const ch of "Plants make food") {
      counts = countChange(text, text + ch, counts);
      text += ch;
    }
    expect(counts).toEqual({ typed: 16, pasted: 0 });
  });

  it("a predicted word is typed; a block is pasted", () => {
    expect(countChange("The ", "The chlorophyll ", zero)).toEqual({ typed: 12, pasted: 0 });
    const block = "x".repeat(PASTE_THRESHOLD);
    expect(countChange("", block, zero)).toEqual({ typed: 0, pasted: PASTE_THRESHOLD });
  });

  it("deleting changes nothing", () => {
    expect(countChange("Plants", "Plan", { typed: 6, pasted: 0 })).toEqual({ typed: 6, pasted: 0 });
  });
});
