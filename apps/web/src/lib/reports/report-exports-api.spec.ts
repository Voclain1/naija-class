import { describe, expect, it } from "vitest";

import type { ReportExportStatusDto } from "@school-kit/types";

import { filenameFromDisposition } from "../file-download";
import { waitForPdf } from "./report-exports-api";

const status = (s: ReportExportStatusDto["status"]): ReportExportStatusDto => ({
  exportId: "e1",
  status: s,
  filename: "registers.pdf",
  url: s === "GENERATED" ? "https://files.example/registers.pdf" : null,
});

describe("waitForPdf", () => {
  it("polls until the PDF is made", async () => {
    const seq = [status("PENDING"), status("PENDING"), status("GENERATED")];
    const slept: number[] = [];
    const out = await waitForPdf("e1", {
      fetchStatus: async () => seq.shift()!,
      sleep: async (ms) => void slept.push(ms),
      intervalMs: 10,
    });
    expect(out.status).toBe("GENERATED");
    expect(slept).toEqual([10, 10]);
  });

  it("stops at FAILED", async () => {
    const out = await waitForPdf("e1", { fetchStatus: async () => status("FAILED"), sleep: async () => undefined });
    expect(out.status).toBe("FAILED");
  });

  it("gives up after the limit and returns the PENDING status", async () => {
    let calls = 0;
    const out = await waitForPdf("e1", {
      fetchStatus: async () => {
        calls++;
        return status("PENDING");
      },
      sleep: async () => undefined,
      intervalMs: 10,
      limitMs: 30,
    });
    expect(out.status).toBe("PENDING");
    expect(calls).toBe(4);
  });
});

describe("filenameFromDisposition", () => {
  it("reads the API's file name, else the fallback", () => {
    expect(filenameFromDisposition('attachment; filename="registers-first-term.xlsx"', "x.xlsx")).toBe(
      "registers-first-term.xlsx",
    );
    expect(filenameFromDisposition(null, "x.xlsx")).toBe("x.xlsx");
  });
});
