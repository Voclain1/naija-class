import { describe, expect, it } from "vitest";

import type { ReportExportStatusDto } from "@school-kit/types";

import { reportFileName, waitForReportPdf } from "./report-wait";

const status = (s: ReportExportStatusDto["status"]): ReportExportStatusDto => ({
  exportId: "e1",
  status: s,
  filename: "x.pdf",
  url: s === "GENERATED" ? "https://files.example/x.pdf" : null,
});

describe("waitForReportPdf", () => {
  it("polls until the PDF is made", async () => {
    const seq = [status("PENDING"), status("GENERATED")];
    const slept: number[] = [];
    const out = await waitForReportPdf("e1", async () => seq.shift()!, async (ms) => void slept.push(ms), 5);
    expect(out.status).toBe("GENERATED");
    expect(slept).toEqual([5]);
  });

  it("stops at FAILED, and gives up after the limit", async () => {
    expect((await waitForReportPdf("e1", async () => status("FAILED"), async () => undefined)).status).toBe("FAILED");
    let calls = 0;
    const out = await waitForReportPdf("e1", async () => (calls++, status("PENDING")), async () => undefined, 10, 20);
    expect(out.status).toBe("PENDING");
    expect(calls).toBe(3);
  });
});

describe("reportFileName", () => {
  it("names the file after the report and term", () => {
    expect(reportFileName("academic", "First Term", "2026/2027", "xlsx")).toBe("academic-report-first-term-2026-2027.xlsx");
    expect(reportFileName("enrolment", null, null, "pdf")).toBe("enrolment-report.pdf");
  });
});
