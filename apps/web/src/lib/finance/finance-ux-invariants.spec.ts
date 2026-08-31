import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// Code invariants for the bursar invoice journey.
//
// WHY THIS FILE EXISTS. apps/web's Vitest runner is node-environment and
// *.spec.ts only — component/DOM tests are deliberately not set up (see
// apps/web/vitest.config.ts). That means the pure reducer in
// invoice-cancel.ts can be tested exhaustively, but nothing at the unit level
// otherwise stops a component from BYPASSING it — which is precisely the
// shape of the original F-01 bug, where a table-row button was wired straight
// to `cancelInvoice(id)`.
//
// So these assertions are made against the SOURCE TEXT of the finance
// screens. That is an unusual thing to do and it is not a substitute for a
// rendered test; it is a targeted guard on the specific regressions this
// slice fixed, following the same code-invariant precedent already used in
// apps/mobile/__tests__ and apps/api's storage/RBAC conformance specs.
//
// If a future change legitimately needs to break one of these, the fix is to
// update the invariant deliberately — not to delete it quietly.

function source(relativeToRepoRoot: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../../../${relativeToRepoRoot}`, import.meta.url)),
    "utf8",
  );
}

const INVOICE_LIST = "apps/web/src/app/(admin)/finance/invoices/page.tsx";
const INVOICE_DETAIL = "apps/web/src/app/(admin)/finance/invoices/[id]/page.tsx";
const CANCEL_DIALOG = "apps/web/src/components/finance/cancel-invoice-dialog.tsx";
const FINANCE_DASHBOARD = "apps/web/src/app/(admin)/finance/dashboard/page.tsx";
const DEBTORS = "apps/web/src/app/(admin)/finance/debtors/page.tsx";
const GENERATE_DIALOG = "apps/web/src/components/finance/generate-invoices-dialog.tsx";
const GENERATE_LOGIC = "apps/web/src/lib/finance/invoice-generate.ts";
const DISCOUNTS = "apps/web/src/app/(admin)/finance/discounts/page.tsx";
const FEES = "apps/web/src/app/(admin)/finance/fees/page.tsx";
const EXPENSES = "apps/web/src/app/(admin)/finance/expenses/page.tsx";
const PAYROLL = "apps/web/src/app/(admin)/finance/payroll/page.tsx";
const INLINE_ALERT = "apps/web/src/components/shared/inline-alert.tsx";

describe("sanity — the files these invariants guard still exist", () => {
  it("reads every guarded source file", () => {
    for (const path of [INVOICE_LIST, INVOICE_DETAIL, CANCEL_DIALOG, FINANCE_DASHBOARD, DEBTORS, GENERATE_DIALOG, INLINE_ALERT]) {
      expect(source(path).length).toBeGreaterThan(500);
    }
  });
});

describe("F-01 — invoice cancellation cannot bypass the confirmation", () => {
  it("only the confirmation dialog is allowed to call cancelInvoice", () => {
    // THE mutation check. Re-wiring a row button directly to the mutation
    // requires importing cancelInvoice into a page again — which fails here.
    expect(source(INVOICE_LIST)).not.toContain("cancelInvoice");
    expect(source(INVOICE_DETAIL)).not.toContain("cancelInvoice");
    expect(source(CANCEL_DIALOG)).toContain("cancelInvoice");
  });

  it("both cancel entry points go through <CancelInvoiceDialog>", () => {
    expect(source(INVOICE_LIST)).toContain("CancelInvoiceDialog");
    expect(source(INVOICE_DETAIL)).toContain("CancelInvoiceDialog");
  });

  it("the dialog drives its phases through the tested reducer, not ad-hoc booleans", () => {
    const dialog = source(CANCEL_DIALOG);
    expect(dialog).toContain("cancelReducer");
    expect(dialog).toContain('dispatch({ type: "submit" })');
    // The request must sit behind the confirming-phase check.
    expect(dialog).toContain('state.phase !== "confirming"');
  });

  it("the destructive confirm button is visually distinct from the dismiss button", () => {
    const dialog = source(CANCEL_DIALOG);
    expect(dialog).toContain('variant="destructive"');
    expect(dialog).toContain("dismissLabel");
  });

  it("a cancellation failure is never swallowed into console.error alone", () => {
    const dialog = source(CANCEL_DIALOG);
    expect(dialog).toContain("financeErrorMessage");
    expect(dialog).toContain('dispatch({ type: "error"');
  });
});

describe("F-04 — invoice rows identify students by name, not by UUID", () => {
  it("the list never truncates an id for display", () => {
    const list = source(INVOICE_LIST);
    // `.slice(0, 8)` on studentId/invoice id was the original F-04 rendering.
    // Truncation now lives only in invoice-identity.ts / invoice-cancel.ts.
    expect(list).not.toContain("studentId.slice");
    expect(list).not.toContain("inv.id.slice");
  });

  it("the list renders identity through the shared helpers", () => {
    const list = source(INVOICE_LIST);
    expect(list).toContain("studentDisplayName");
    expect(list).toContain("studentSecondaryLabel");
  });

  it("the CSV export leads with human identity and keeps ids as trailing columns", () => {
    const list = source(INVOICE_LIST);
    const studentCol = list.indexOf('header: "Student"');
    const idCol = list.indexOf('header: "Invoice ID"');
    expect(studentCol).toBeGreaterThan(-1);
    // Machine identifiers are retained — they are operationally useful — but
    // no longer the first thing a school employee reads.
    expect(idCol).toBeGreaterThan(studentCol);
    expect(list).toContain('header: "Admission number"');
  });
});

describe("F-05 — a failed fetch is never rendered as emptiness", () => {
  it("the list routes its states through the tested resolver", () => {
    const list = source(INVOICE_LIST);
    expect(list).toContain("resolveInvoiceListView");
    expect(list).not.toContain("No invoices found");
  });

  it("the list records a fetch failure instead of only clearing the rows", () => {
    expect(source(INVOICE_LIST)).toContain("setListError(financeErrorMessage(e))");
  });

  it("reference-data failure is tracked separately from the invoice fetch", () => {
    expect(source(INVOICE_LIST)).toContain("referenceError");
  });
});

describe("F-12 — finance screens never render a raw error object", () => {
  it("String(e) is gone from the finance screens this slice owns", () => {
    for (const path of [INVOICE_LIST, INVOICE_DETAIL, FINANCE_DASHBOARD, DEBTORS]) {
      expect(source(path)).not.toContain("String(e)");
    }
  });

  it("the dashboard and debtors use the shared human-facing copy", () => {
    for (const path of [FINANCE_DASHBOARD, DEBTORS]) {
      expect(source(path)).toContain("financeErrorMessage");
      expect(source(path)).toContain("logFinanceError");
    }
  });
});

describe("F-32 — internal invoice navigation is client-side", () => {
  it("the list uses next/link rather than raw anchors for invoice detail", () => {
    const list = source(INVOICE_LIST);
    expect(list).toContain('from "next/link"');
    expect(list).not.toContain('<a href={`/finance/invoices/');
    expect(list).toContain("<Link");
  });
});

describe("F-29 — generation selectors are plain-language and do not guess", () => {
  it("developer-style placeholders are gone", () => {
    const list = source(INVOICE_LIST);
    for (const placeholder of ["— year —", "— term —", "— arm —"]) {
      expect(list).not.toContain(placeholder);
    }
    expect(list).toContain("Choose an academic year");
    expect(list).toContain("Choose a term");
  });

  it("the current year/term is LABELLED rather than the term being auto-selected", () => {
    const list = source(INVOICE_LIST);
    expect(list).toContain("currentSuffix");
    // The year may be defaulted (it never reaches the write); the term must
    // not be. If a future change starts defaulting termId from isCurrent,
    // this is the assertion that should be argued with rather than deleted.
    expect(list).toContain("unambiguousCurrent(loadedYears)");
    expect(list).not.toContain("unambiguousCurrent(terms)");
    expect(list).not.toContain("setTermId(current.id)");
  });
});

describe("F-34 — bulk generation cannot bypass the review gate", () => {
  it("only the review dialog is allowed to call generateInvoices", () => {
    // THE mutation check, mirroring F-01's. Re-wiring the Generate button
    // straight to the mutation requires importing generateInvoices into the
    // page again — which fails here. Billing a whole arm must stay at least
    // as guarded as voiding one invoice.
    expect(source(INVOICE_LIST)).not.toContain("generateInvoices");
    expect(source(GENERATE_DIALOG)).toContain("generateInvoices");
  });

  it("the Generate entry point goes through <GenerateInvoicesDialog>", () => {
    expect(source(INVOICE_LIST)).toContain("GenerateInvoicesDialog");
  });

  it("the dialog drives its phases through the tested reducer, not ad-hoc booleans", () => {
    const dialog = source(GENERATE_DIALOG);
    expect(dialog).toContain("generateReducer");
    expect(dialog).toContain("initialGenerateState");
  });

  it("the review is populated from the server preview, not a client re-computation", () => {
    const dialog = source(GENERATE_DIALOG);
    expect(dialog).toContain("previewInvoices");
    // summariseGeneration only PARTITIONS server-supplied lines; it must not
    // be accompanied by a re-derivation of who is already invoiced.
    expect(dialog).toContain("summariseGeneration");
    expect(dialog).not.toContain("listInvoices");
  });

  it("the skip set is decided by the server, not re-derived on the client", () => {
    // alreadyInvoiced is read from the preview DTO; the client must never
    // reconstruct the uniqueness rule (which is status-agnostic, so a
    // CANCELLED invoice still blocks — an edge easy to get wrong twice).
    const logic = source(GENERATE_LOGIC);
    expect(logic).toContain("alreadyInvoiced");
    expect(logic).not.toContain("CANCELLED");
  });

  it("a generation failure is never swallowed into console.error alone", () => {
    const dialog = source(GENERATE_DIALOG);
    expect(dialog).toContain("financeErrorMessage");
    expect(dialog).toContain('role="alert"');
  });

  it("the review names students through the shared identity helper, never ids", () => {
    const dialog = source(GENERATE_DIALOG);
    expect(dialog).toContain("studentDisplayName");
    expect(dialog).not.toContain("studentId.slice");
  });
});

describe("F-05b/F-22 shared error presentation remains truthful", () => {
  const migratedScreens = [
    INVOICE_LIST,
    INVOICE_DETAIL,
    FINANCE_DASHBOARD,
    DEBTORS,
    DISCOUNTS,
    FEES,
    EXPENSES,
    PAYROLL,
  ];

  it("uses one semantic alert primitive with an optional retry action", () => {
    const alert = source(INLINE_ALERT);
    expect(alert).toContain('role="alert"');
    expect(alert).toContain("action?: InlineAlertAction");
    expect(alert).toContain("action.label");
  });

  it("does not turn a failed Finance fetch into an empty collection", () => {
    for (const path of migratedScreens) {
      const screen = source(path);
      expect(screen).toContain("InlineAlert");
      expect(screen).not.toMatch(/catch\(\(\)\s*=>\s*(set\w+\(\[\]\)|undefined|\{\s*\})/);
    }
  });

  it("does not reintroduce the duplicated destructive banner in migrated Finance screens", () => {
    for (const path of migratedScreens) {
      expect(source(path)).not.toMatch(/border-destructive[^"`]*bg-destructive|bg-destructive[^"`]*border-destructive/);
    }
  });

  it("normalizes raw exception messages on the invoice detail surface", () => {
    const detail = source(INVOICE_DETAIL);
    expect(detail).toContain("financeErrorMessage");
    expect(detail).not.toContain("instanceof Error ? e.message");
  });
});
