import { describe, expect, it } from "vitest";

import { fitsOnPdf, toTableInput } from "./table-export";

interface Row {
  name: string;
  balance: number | null;
  owed: string;
}

describe("toTableInput", () => {
  it("sends the page's own columns and values, numbers flagged as numeric", () => {
    const out = toTableInput<Row>({
      title: "Debtors",
      columns: [
        { header: "Name", accessor: (r) => r.name },
        { header: "Balance", accessor: (r) => r.balance },
        { header: "Owed", accessor: (r) => r.owed },
      ],
      rows: [
        { name: "Ada", balance: 1200, owed: "₦12.00" },
        { name: "Bayo", balance: null, owed: "₦0.00" },
      ],
    });
    expect(out).toEqual({
      title: "Debtors",
      subtitle: null,
      columns: [
        { header: "Name", numeric: false },
        { header: "Balance", numeric: true },
        { header: "Owed", numeric: false },
      ],
      rows: [
        ["Ada", 1200, "₦12.00"],
        ["Bayo", null, "₦0.00"],
      ],
    });
  });

  it("an empty list sends no numeric columns, and undefined becomes empty", () => {
    const out = toTableInput<{ a?: string }>({ title: "T", columns: [{ header: "A", accessor: (r) => r.a }], rows: [{}] });
    expect(out.columns[0]!.numeric).toBe(false);
    expect(out.rows).toEqual([[null]]);
  });

  it("knows when a list is too wide to print", () => {
    expect(fitsOnPdf(14)).toBe(true);
    expect(fitsOnPdf(15)).toBe(false);
  });
});
