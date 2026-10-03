import { describe, expect, it } from "vitest";

import type { GeneratedResultPinBatchDto } from "@school-kit/types";

import { pinBatchCsv, pinBatchFilename, pinBatchPrintHtml } from "./pin-export";

const generated: GeneratedResultPinBatchDto = {
  batch: {
    id: "b1",
    number: 7,
    termId: "t1",
    termName: "First Term",
    academicYearLabel: "2026/2027",
    size: 2,
    maxUses: 5,
    redeemedCount: 0,
    voidedCount: 0,
    createdAt: "2026-10-03T09:00:00Z",
    voidedAt: null,
  },
  pins: [
    { serial: "B7-0001", pin: "4821 0937 5512" },
    { serial: "B7-0002", pin: "0012 3456 7890" },
  ],
};

describe("result PIN export (D16 — once, at generation)", () => {
  it("the CSV carries serial, PIN, term, session and uses for a print shop", () => {
    expect(pinBatchCsv(generated).split("\r\n")).toEqual([
      "Serial,PIN,Term,Session,Uses",
      "B7-0001,4821 0937 5512,First Term,2026/2027,5",
      "B7-0002,0012 3456 7890,First Term,2026/2027,5",
    ]);
    expect(pinBatchFilename(generated)).toBe("result-pins-batch-7-2026-2027-first-term.csv");
  });

  it("the printable sheet has one card per PIN, with where to check, and escapes the school name", () => {
    const html = pinBatchPrintHtml(generated, {
      schoolName: "St. Mary's <College>",
      checkerUrl: "https://portal.schoolkit.ng/result-checker/st-marys",
    });
    expect(html.match(/class="card"/g)).toHaveLength(2);
    expect(html).toContain("4821 0937 5512");
    expect(html).toContain("Serial B7-0002");
    expect(html).toContain("https://portal.schoolkit.ng/result-checker/st-marys");
    expect(html).toContain("St. Mary&#39;s &lt;College&gt;");
    expect(html).not.toContain("<College>");
  });
});
