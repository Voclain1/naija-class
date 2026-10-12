import { describe, expect, it } from "vitest";

import {
  admissionCounterScope,
  admissionNumberPattern,
  fillAdmissionNumber,
  highestExistingValue,
  parseAdmissionFormat,
} from "@school-kit/types";

import { composeFormat, decomposeFormat, exampleNumbers, formatAsPattern } from "./admission-format-ui";

// The admission number format (docs/modules/admission-numbers.md), shared by
// the API (which assigns) and these screens (which preview).

function parsed(format: string, order: "SCHOOL" | "CLASS" | "RANDOM" = "SCHOOL") {
  const result = parseAdmissionFormat(format, order);
  if (!result.ok) throw new Error(result.error);
  return result.format;
}

describe("reading a format", () => {
  it("fills the year, short year, class and digits, keeping the rest as written", () => {
    expect(fillAdmissionNumber(parsed("VFM/{YYYY}/{NNNN}"), { year: 2026, value: 42 })).toBe("VFM/2026/0042");
    expect(fillAdmissionNumber(parsed("SJC{YY}{CLASS}{NNN}", "CLASS"), { year: 2026, classCode: "jss1", value: 7 })).toBe(
      "SJC26JSS1007",
    );
    expect(fillAdmissionNumber(parsed("{nnnnn}-VF"), { year: 2026, value: 3 })).toBe("00003-VF");
  });

  it("says what is wrong, in words an admin can act on", () => {
    const error = (f: string, order: "SCHOOL" | "CLASS" | "RANDOM" = "SCHOOL") => {
      const r = parseAdmissionFormat(f, order);
      return r.ok ? null : r.error;
    };
    expect(error("")).toMatch(/Write the format/);
    expect(error("VFM/{YYYY}")).toMatch(/Add \{NNNN\}/);
    expect(error("{NN}")).toMatch(/3 to 8 N's/);
    expect(error("{NNNN}/{NNNN}")).toMatch(/only once/);
    expect(error("VFM {NNNN}")).toMatch(/can't be in an admission number/);
    expect(error("{MONTH}{NNNN}")).toMatch(/not a blank SchoolKit knows/);
    expect(error("{YYYY}/{NNNN}", "CLASS")).toMatch(/needs \{CLASS\}/);
    expect(error("{CLASS}/{NNNN}")).toMatch(/only works when numbering per class/);
    expect(error("{YYYY/{NNNN}")).not.toBeNull();
  });

  it("restarts the count with the year only when the year is in the number", () => {
    expect(admissionCounterScope(parsed("VFM/{YYYY}/{NNNN}"), { year: 2026 })).toBe("2026");
    expect(admissionCounterScope(parsed("VFM/{NNNN}"), { year: 2026 })).toBe("");
    expect(admissionCounterScope(parsed("{YY}{CLASS}{NNN}", "CLASS"), { year: 2027, classCode: "pri4" })).toBe("2027:PRI4");
  });

  it("finds where the register already got to, ignoring other years and other shapes", () => {
    const pattern = admissionNumberPattern(parsed("VFM/{YYYY}/{NNNN}"), { year: 2026 });
    expect(highestExistingValue(["VFM/2026/0147", "VFM/2025/0900", "vfm/2026/0012", "OLD-9", "VFM/2026/12"], pattern)).toBe(147);
  });
});

describe("the screens", () => {
  it("shows examples for each way of numbering", () => {
    expect(exampleNumbers("VFM/{YYYY}/{NNNN}", "SCHOOL", 2026)).toEqual({
      ok: true,
      examples: ["VFM/2026/0001", "VFM/2026/0002", "VFM/2026/0003"],
    });
    expect(exampleNumbers("VF/{CLASS}/{NNN}", "CLASS", 2026)).toEqual({
      ok: true,
      examples: ["VF/JSS1/001", "VF/JSS1/002", "VF/PRI4/001"],
    });
    const random = exampleNumbers("R{NNNN}", "RANDOM", 2026);
    expect(random.ok && random.examples.every((e) => /^R\d{4}$/.test(e))).toBe(true);
  });

  it("the Change dialog's prefix and suffix make a format, and read one back", () => {
    const simple = { prefix: "VFM/", withYear: true, digits: 4, suffix: "" };
    expect(composeFormat(simple, "SCHOOL")).toBe("VFM/{YYYY}/{NNNN}");
    expect(composeFormat(simple, "CLASS")).toBe("VFM/{YYYY}/{CLASS}/{NNNN}");
    expect(composeFormat({ prefix: "", withYear: false, digits: 5, suffix: "-VF" }, "RANDOM")).toBe("{NNNNN}-VF");
    expect(decomposeFormat("VFM/{YYYY}/{NNNN}")).toEqual(simple);
    expect(decomposeFormat("VFM/{YYYY}/{CLASS}/{NNN}")).toEqual({ prefix: "VFM/", withYear: true, digits: 3, suffix: "" });
    // Written by hand in a shape the builder can't show: the dialog shows the field.
    expect(decomposeFormat("SJC{YY}{NNN}")).toBeNull();
  });

  it("shows a format on one line with its digits as #", () => {
    expect(formatAsPattern("VFM/{YYYY}/{NNNN}", 2026)).toBe("VFM/2026/####");
    expect(formatAsPattern("{YY}{CLASS}{NNN}", 2026)).toBe("26CLASS###");
  });
});
