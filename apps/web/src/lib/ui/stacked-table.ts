// Labels the cells of a table shown as cards on a phone (`<Table
// stackOnMobile>`, components/ui/table.tsx). Each body cell is given its
// column's header text as `data-label`, which globals.css prints above the
// value. Kept free of React so it is unit-tested against a plain DOM shape.

export interface StackCell {
  colSpan: number;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export interface StackRow {
  cells: ArrayLike<StackCell>;
}

/** What a header's text says about its column, once stacked. */
export type StackRole = "title" | "field" | "actions" | "bare";

export function stackRoleOf(header: string, index: number): StackRole {
  const text = header.trim();
  if (/^actions?$/i.test(text)) return "actions";
  if (!text) return "bare";
  return index === 0 ? "title" : "field";
}

export function labelStackedRows(headers: readonly string[], rows: Iterable<StackRow>): void {
  for (const row of rows) {
    let col = 0;
    for (const cell of Array.from(row.cells)) {
      const span = cell.colSpan > 0 ? cell.colSpan : 1;
      for (const attr of ["data-label", "data-stack-role"]) cell.removeAttribute(attr);
      if (span > 1) {
        // An empty-state or summary cell across the table: one full line.
        cell.setAttribute("data-stack-role", "full");
      } else {
        const header = headers[col] ?? "";
        const role = stackRoleOf(header, col);
        cell.setAttribute("data-stack-role", role);
        if (role === "field") cell.setAttribute("data-label", header.trim());
      }
      col += span;
    }
  }
}

export function labelStackedCells(table: HTMLTableElement): void {
  const headerRow = table.tHead?.rows[0];
  const headers = headerRow ? Array.from(headerRow.cells).map((c) => c.textContent ?? "") : [];
  for (const body of Array.from(table.tBodies)) labelStackedRows(headers, Array.from(body.rows));
}
