import { describe, expect, it } from "vitest";

import { changeSince, count, pct } from "./report-copy";

describe("report copy", () => {
  it("formats hundredths and changes in words", () => {
    expect(pct(9333)).toBe("93.33%");
    expect(pct(null)).toBe("—");
    expect(changeSince(1000)).toBe("up 10.00 since last term");
    expect(changeSince(-250)).toBe("down 2.50 since last term");
    expect(changeSince(0)).toBe("no change since last term");
    expect(changeSince(null)).toBeNull();
    expect(count(1, "student", "students")).toBe("1 student");
    expect(count(3, "student", "students")).toBe("3 students");
  });
});
