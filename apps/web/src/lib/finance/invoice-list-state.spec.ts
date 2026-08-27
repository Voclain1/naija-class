import { describe, expect, it } from "vitest";

import { resolveInvoiceListView, type InvoiceListInputs } from "./invoice-list-state";

// F-05 regression suite. The bug was that `.catch(() => setInvoices([]))`
// made every failure indistinguishable from "this term has nothing billed".
// These tests exist so a future refactor cannot reintroduce that collapse.

function inputs(overrides: Partial<InvoiceListInputs> = {}): InvoiceListInputs {
  return {
    loading: false,
    error: null,
    rowCount: 0,
    statusFilter: "",
    statusLabel: "",
    ...overrides,
  };
}

describe("resolveInvoiceListView", () => {
  it("shows loading while the request is in flight", () => {
    expect(resolveInvoiceListView(inputs({ loading: true }))).toEqual({ kind: "loading" });
  });

  it("shows rows when the fetch returned invoices", () => {
    expect(resolveInvoiceListView(inputs({ rowCount: 12 }))).toEqual({ kind: "rows" });
  });

  it("shows a genuine empty state only when the fetch SUCCEEDED with no rows", () => {
    expect(resolveInvoiceListView(inputs())).toEqual({ kind: "empty" });
  });

  it("NEVER reports emptiness when the fetch failed", () => {
    const view = resolveInvoiceListView(
      inputs({ error: "Could not reach the server.", rowCount: 0 }),
    );

    expect(view.kind).toBe("error");
    expect(view.kind).not.toBe("empty");
    expect(view.kind).not.toBe("filtered-empty");
  });

  it("prefers the error over a stale loading flag, so retry is never hidden behind a spinner", () => {
    const view = resolveInvoiceListView(
      inputs({ error: "Something went wrong on our side.", loading: true }),
    );
    expect(view).toEqual({ kind: "error", message: "Something went wrong on our side." });
  });

  it("distinguishes 'no invoices at all' from 'none matching this filter'", () => {
    const unfiltered = resolveInvoiceListView(inputs());
    const filtered = resolveInvoiceListView(
      inputs({ statusFilter: "OVERDUE", statusLabel: "Overdue" }),
    );

    expect(unfiltered).toEqual({ kind: "empty" });
    expect(filtered).toEqual({ kind: "filtered-empty", statusLabel: "Overdue" });
  });

  it("does not claim a filter is responsible when rows exist", () => {
    const view = resolveInvoiceListView(
      inputs({ rowCount: 3, statusFilter: "PAID", statusLabel: "Paid" }),
    );
    expect(view).toEqual({ kind: "rows" });
  });
});
