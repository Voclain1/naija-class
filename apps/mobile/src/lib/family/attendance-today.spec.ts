import { describe, expect, it } from "vitest";

import { attendanceTodayLine } from "./attendance-today";

describe("attendanceTodayLine", () => {
  it("an absence is a warning, so it stands out on the card", () => {
    expect(attendanceTodayLine("ABSENT")).toEqual({ text: "Marked absent today.", tone: "warning" });
  });

  it("other marks are plain information", () => {
    expect(attendanceTodayLine("PRESENT")?.tone).toBe("info");
    expect(attendanceTodayLine("LATE")?.text).toBe("Marked late today.");
    expect(attendanceTodayLine("EXCUSED")?.text).toBe("Excused today.");
  });

  it("says nothing before the register is taken, or from an older API", () => {
    expect(attendanceTodayLine(null)).toBeNull();
    expect(attendanceTodayLine(undefined)).toBeNull();
  });
});
