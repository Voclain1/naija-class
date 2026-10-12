import { describe, expect, it } from "vitest";

import { labelStackedRows, stackRoleOf, type StackCell } from "./stacked-table";

function cell(colSpan = 1): StackCell & { attrs: Record<string, string> } {
  const attrs: Record<string, string> = {};
  return {
    colSpan,
    attrs,
    setAttribute: (n, v) => void (attrs[n] = v),
    removeAttribute: (n) => void delete attrs[n],
  };
}

describe("stacked tables", () => {
  it("roles: first column is the title, 'Actions' and blank headers carry no label", () => {
    expect(stackRoleOf("Label", 0)).toBe("title");
    expect(stackRoleOf("Starts", 1)).toBe("field");
    expect(stackRoleOf("Actions", 4)).toBe("actions");
    expect(stackRoleOf("action", 2)).toBe("actions");
    expect(stackRoleOf("  ", 3)).toBe("bare");
  });

  it("labels each cell with its column's header", () => {
    const row = [cell(), cell(), cell(), cell()];
    labelStackedRows(["Label", "Starts", "Ends", "Actions"], [{ cells: row }]);
    expect(row[0]!.attrs).toEqual({ "data-stack-role": "title" });
    expect(row[1]!.attrs).toEqual({ "data-stack-role": "field", "data-label": "Starts" });
    expect(row[2]!.attrs["data-label"]).toBe("Ends");
    expect(row[3]!.attrs).toEqual({ "data-stack-role": "actions" });
  });

  it("an empty-state cell spanning the table is one full line, unlabelled", () => {
    const only = cell(5);
    labelStackedRows(["A", "B", "C", "D", "E"], [{ cells: [only] }]);
    expect(only.attrs).toEqual({ "data-stack-role": "full" });
  });

  it("follows colspans: a cell after a 2-wide cell takes the third header", () => {
    const row = [cell(2), cell()];
    labelStackedRows(["Name", "Class", "Balance"], [{ cells: row }]);
    expect(row[1]!.attrs["data-label"]).toBe("Balance");
  });

  it("relabelling replaces stale labels", () => {
    const c = cell();
    labelStackedRows(["", "Amount"], [{ cells: [cell(), c] }]);
    labelStackedRows(["", ""], [{ cells: [cell(), c] }]);
    expect(c.attrs).toEqual({ "data-stack-role": "bare" });
  });
});
