import qrcode from "qrcode-generator";
import { describe, expect, it } from "vitest";

import { qrRuns } from "./qr-runs";

describe("QR runs", () => {
  it("covers exactly the dark modules of the code", () => {
    const value = "https://portal.schoolkit.ng/id/bright-future.3f1c2a4e-7b8d-4e9f-a0b1-c2d3e4f5a6b7.abcdefghijklmnopqrstuv";
    const { size, rows } = qrRuns(value);
    const qr = qrcode(0, "M");
    qr.addData(value);
    qr.make();
    expect(size).toBe(qr.getModuleCount());
    for (let r = 0; r < size; r++) {
      const dark = new Set<number>();
      for (const run of rows[r]!) for (let c = run.start; c < run.start + run.length; c++) dark.add(c);
      for (let c = 0; c < size; c++) expect(dark.has(c)).toBe(qr.isDark(r, c));
    }
  });
});
