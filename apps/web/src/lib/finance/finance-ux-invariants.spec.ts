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

// ── The finance dashboard's secondary sections cannot vanish (2026-09-11) ───
//
// The defect: "Revenue trajectory" and "Collection by class level" were each
// wrapped in `{data && (<Card>…</Card>)}`, and their fetch failures went only
// to `logFinanceError` — the console. A failed read therefore deleted the
// whole section from the page: no heading, no message, no retry. To a bursar
// that is indistinguishable from a feature nobody finished, which is exactly
// how it was reported.
//
// Isolating these reads from the KPI cards was right and is preserved — a
// trajectory failure must not blank the tiles. What changed is that the
// failure is now VISIBLE rather than silent.
//
// Source-text assertions for the same reason the rest of this file uses them:
// apps/web has no DOM test runner by deliberate choice.

describe("F-40 — the dashboard's secondary sections report failure instead of disappearing", () => {
  const dashboard = () => source(FINANCE_DASHBOARD);

  it("neither section is gated on its own data being present", () => {
    // THE mutation check. Re-wrapping either section in `{trajectory && (`
    // restores the vanishing bug and fails here.
    expect(dashboard()).not.toContain("{trajectory && (");
    expect(dashboard()).not.toContain("{byLevel && (");
  });

  it("each section tracks its own error, separately from the primary read", () => {
    // Separate from `error`, which belongs to getFinanceDashboard. Sharing one
    // error string would let a trajectory failure blank the KPI cards — the
    // isolation this fix deliberately keeps.
    for (const token of ["trajectoryError", "byLevelError"]) {
      expect(dashboard()).toContain(token);
    }
  });

  it("both failures set human-facing copy rather than only logging", () => {
    // The original bug in one line: the catch logged and did nothing else.
    expect(dashboard()).toContain("setTrajectoryError(financeErrorMessage(e))");
    expect(dashboard()).toContain("setByLevelError(financeErrorMessage(e))");
  });

  it("each failure offers a retry that refetches only its own section", () => {
    // Retrying via the whole effect would also refetch KPI data already on
    // screen and correct.
    expect(dashboard()).toContain("onClick: () => loadTrajectory(termId)");
    expect(dashboard()).toContain("onClick: () => loadByLevel(termId)");
  });

  it("the raw error still reaches the console", () => {
    // The sanitised copy is for the bursar; the real error is still needed for
    // diagnosis. This fix adds a UI path, it does not remove the log.
    for (const token of ['logFinanceError("getRevenueTrajectory", e)', 'logFinanceError("getCollectionByLevel", e)']) {
      expect(dashboard()).toContain(token);
    }
  });
});

// ── Pass 3: the finance dashboard's controls and header (2026-09-11) ───────
//
// These assertions are made against the source with COMMENTS STRIPPED.
// Several of them assert that a string from the mockup does NOT appear —
// and the code comments explaining *why* it was omitted necessarily quote
// the very string being banned. Asserting on raw source would therefore fail
// on the documentation of the decision it is protecting, which would push
// the next person to delete the explanation to get CI green. Stripping
// comments keeps the ban on shipped UI text, where it belongs.
function code(relativeToRepoRoot: string): string {
  return source(relativeToRepoRoot)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const FINANCE_SUB_NAV = "apps/web/src/components/finance/sub-nav.tsx";
const PAYSTACK_STATUS = "apps/web/src/lib/finance/paystack-status.ts";

describe("F-41 — the finance section row claims only what is built", () => {
  const subNav = () => source(FINANCE_SUB_NAV);

  it("does not offer a Paystack Sync control anywhere", () => {
    // The mockup showed one, on the row this file now guards. Nothing in this
    // codebase syncs with Paystack on demand — ensureSchoolPercentageSplit is
    // called during setup and never exposed as an endpoint — so the button
    // would name an operation that does not exist. Same class of omission as
    // the mockup's fabricated subaccount number and "3.4 seconds" webhook.
    for (const path of [FINANCE_DASHBOARD, FINANCE_SUB_NAV]) {
      expect(code(path)).not.toContain("Paystack Sync");
      expect(code(path)).not.toContain("paystackSync");
    }
  });

  it("gates Record payment on the permission the API actually enforces", () => {
    // Hidden for anyone who cannot record one, rather than 403-ing on
    // arrival — the pattern pass 1's header actions established.
    expect(subNav()).toContain('hasPermission(permissions, "payment.record")');
  });

  it("points Record payment at a route that exists", () => {
    // /finance/payments holds only the Paystack callback — it is not a page.
    // /finance/invoices is where an invoice is picked and recorded against.
    expect(subNav()).toContain('href="/finance/invoices"');
    expect(subNav()).not.toContain('href="/finance/payments"');
  });

  it("keeps exactly ONE Record payment control, on the section row", () => {
    // THE anti-duplication check, and the reason the control moved here.
    // #283 shipped a duplicated pair by giving a page its own copy of what
    // the shell already rendered, and one copy had no permission gate at all.
    // A second copy on the dashboard page is that bug returning.
    expect(code(FINANCE_DASHBOARD)).not.toContain("Record payment");
    expect(code(FINANCE_SUB_NAV)).toContain("Record payment");
  });
});

describe("F-43 — the eyebrow reports card-payment STATUS, never an account number", () => {
  it("the dashboard renders the status through the shared resolver", () => {
    expect(code(FINANCE_DASHBOARD)).toContain("resolvePaystackStatus(school)");
  });

  it("no account-number-shaped literal reaches either file", () => {
    // The mockup's eyebrow carried "#3021949182 (Wema Bank)". The status is
    // real and worth showing; the number is not, and must never be pasted
    // back in "just for the mockup" — this page renders on every finance
    // visit, so it would spread through logs, screenshots and screen shares.
    for (const path of [FINANCE_DASHBOARD, PAYSTACK_STATUS]) {
      expect(code(path)).not.toMatch(/\d{10}/);
      expect(code(path)).not.toContain("Wema");
    }
  });

  it("the status labels themselves are digit-free", () => {
    // Enforced at the unit level too (paystack-status.spec.ts), but pinned
    // here so a label edited straight into the page cannot bypass it.
    expect(code(PAYSTACK_STATUS)).toContain("Card payments live");
    expect(code(PAYSTACK_STATUS)).toContain("Card payments not set up");
  });

  it("distinguishes switched-off from never-set-up", () => {
    // Collapsing these sends a school down the wrong remediation path.
    expect(code(PAYSTACK_STATUS)).toContain("CONFIGURED_OFF");
    expect(code(PAYSTACK_STATUS)).toContain("NOT_CONNECTED");
  });
});

describe("F-42 — the collection-rate card derives its figures, never invents them", () => {
  const dashboard = () => source(FINANCE_DASHBOARD);

  it("shows Recovered and Outstanding from real DTO fields", () => {
    expect(dashboard()).toContain("formatKobo(dashboard.outstandingBalance)");
    expect(dashboard()).toContain("Recovered:");
    expect(dashboard()).toContain("Outstanding:");
  });

  it("derives the billing window instead of hard-coding the mockup's string", () => {
    // The mockup printed "Week 3 of 13" as a literal. Terms are not a uniform
    // length, so the count comes from the term's own stored dates.
    expect(dashboard()).toContain("resolveBillingWindow(trajectory)");
    expect(code(FINANCE_DASHBOARD)).not.toContain("Week 3 of 13");
  });

  it("still does not invent the mockup's fee-type breakdown", () => {
    // No field on FinanceDashboardDto carries it. Unchanged from pass 2.
    for (const invented of ["Tuition:", "Levy:", "Last recorded:"]) {
      expect(code(FINANCE_DASHBOARD)).not.toContain(invented);
    }
  });

  it("writes naira, not raw kobo, into the CSV export", () => {
    // This file opens in a spreadsheet in front of a school owner. A raw kobo
    // integer under a column headed "Collected" is wrong by 100x.
    expect(dashboard()).toContain("accessor: (g) => formatKobo(g.collected)");
    expect(dashboard()).not.toContain("accessor: (g) => g.collected");
  });
});

// ── Pass 3 regression: the restyled term pills (2026-09-12) ─────────────────
//
// Pass 3 relabelled "Academic year" as "Session" to match the mockup, and
// stripped each <select>'s focus outline so it would sit flush in its pill.
// CI's a11y-wave3a e2e caught the first (both tests locate the control by its
// visible label). Nothing caught the second: a keyboard user tabbing into the
// pill saw no focus indicator at all.

describe("F-44 — the term pills keep the app's terminology and a visible focus state", () => {
  it("says 'Academic year', matching Debtors and Fees", () => {
    // The mockup said "Session". Nigerian schools do use that word, but the
    // rest of Finance says "Academic year", and one screen using a different
    // name for the same thing is worse than either choice made consistently.
    expect(code(FINANCE_DASHBOARD)).toContain("Academic year");
    expect(code(FINANCE_DASHBOARD)).not.toMatch(/>\s*Session\s*</);
  });

  it("every select that drops its own focus ring sits inside a pill that shows one", () => {
    // focus:outline-none with no replacement fails WCAG 2.4.7. The pill
    // carries the ring via focus-within, so the count of removals must never
    // exceed the count of replacements.
    const src = code(FINANCE_DASHBOARD);
    const removed = (src.match(/focus:outline-none focus:ring-0/g) ?? []).length;
    const replaced = (src.match(/focus-within:ring-2/g) ?? []).length;
    expect(removed).toBeGreaterThan(0);
    expect(replaced).toBeGreaterThanOrEqual(removed);
  });
});
