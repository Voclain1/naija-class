import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { exportFilename, toPrintHtml, toXlsx, type ExportDocument } from "./tabular-export";

interface Row {
  name: string;
  taken: number;
  last: string | null;
}

const doc = (rows: Row[]): ExportDocument => ({
  title: "Registers",
  schoolName: "Green Field School",
  subtitle: "First Term 2026/2027",
  tables: [
    {
      title: "Registers",
      note: "A register counts when it is marked on a school day.",
      columns: [
        { header: "Class", value: (r: Row) => r.name },
        { header: "Registers taken", value: (r: Row) => r.taken, numeric: true },
        { header: "Last register", value: (r: Row) => r.last },
      ],
      rows,
    },
  ],
});

async function readBack(buf: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  // exceljs types its load() argument as its own Buffer alias.
  await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
  return wb;
}

describe("toXlsx", () => {
  it("writes the header row and keeps numbers as numbers", async () => {
    const wb = await readBack(await toXlsx(doc([{ name: "JSS 1 Blue", taken: 41, last: "2026-10-09" }])));
    const sheet = wb.getWorksheet("Registers")!;
    const values: unknown[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => values.push((row.values as unknown[]).slice(1)));
    expect(values[0]).toEqual(["Registers"]);
    expect(values[1]).toEqual(["Green Field School · First Term 2026/2027"]);
    expect(values[2]).toEqual(["A register counts when it is marked on a school day."]);
    expect(values[3]).toEqual(["Class", "Registers taken", "Last register"]);
    expect(values[4]).toEqual(["JSS 1 Blue", 41, "2026-10-09"]);
    expect(typeof values[4]![1]).toBe("number");
  });

  it("stores a value starting with = as text, never a formula", async () => {
    const wb = await readBack(await toXlsx(doc([{ name: "=HYPERLINK(\"x\")", taken: 1, last: null }])));
    const cell = wb.getWorksheet("Registers")!.getRow(6).getCell(1);
    expect(cell.type).toBe(ExcelJS.ValueType.String);
    expect(cell.value).toBe("=HYPERLINK(\"x\")");
  });

  it("gives every sheet a legal, unique name", async () => {
    const d = doc([]);
    d.tables = [
      { ...d.tables[0]!, title: "Scores: JSS/SSS [all] — a very long name indeed here" },
      { ...d.tables[0]!, title: "Scores: JSS/SSS [all] — a very long name indeed here" },
    ];
    const wb = await readBack(await toXlsx(d));
    const names = wb.worksheets.map((s) => s.name);
    expect(names).toHaveLength(2);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(2);
    for (const n of names) {
      expect(n.length).toBeLessThanOrEqual(31);
      expect(n).not.toMatch(/[:\\/?*[\]]/);
    }
  });
});

describe("toPrintHtml", () => {
  it("escapes every value, so a name holding markup prints as text", () => {
    const html = toPrintHtml(doc([{ name: "<script>alert(1)</script>", taken: 3, last: null }]), {
      logoDataUri: null,
      printedOn: "2026-10-16",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("Green Field School · First Term 2026/2027 · Printed 2026-10-16");
  });

  it("says so when a table is empty", () => {
    expect(toPrintHtml(doc([]), { logoDataUri: null, printedOn: "2026-10-16" })).toContain("Nothing to show.");
  });
});

describe("exportFilename", () => {
  it("makes a safe name from the title and term", () => {
    expect(exportFilename("Registers", "First Term 2026/2027", "xlsx")).toBe("registers-first-term-2026-2027.xlsx");
    expect(exportFilename("", null, "pdf")).toBe("export.pdf");
  });
});
