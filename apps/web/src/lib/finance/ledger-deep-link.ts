// Reading the finance dashboard's "Detailed ledger view" deep link on the
// invoice page: /finance/invoices?tab=list&yearId=<id>&termId=<id>.
//
// Two rules live here so they can be tested without a browser:
//
// 1. A linked id is used ONLY if it is one the API returned for this school.
//    The URL is user-editable; a malformed id, a stale bookmark, or another
//    school's term must never become a filter (a malformed one would 400 the
//    list; a foreign one would show an empty ledger that looks like "no
//    invoices"). An unusable term is reported, not silently dropped.
//
// 2. A linked term filters the LIST, and is never treated as a choice for
//    GENERATION. The dashboard defaults its term to the one flagged current,
//    so a term arriving by link is frequently an isCurrent default in
//    disguise — exactly what lib/finance/current-context.ts forbids for
//    invoice generation. The page clears a link-sourced term when the Generate
//    tab is opened (see invoices/page.tsx).

export const LEDGER_TAB_PARAM = "tab";
export const LEDGER_YEAR_PARAM = "yearId";
export const LEDGER_TERM_PARAM = "termId";

export interface LedgerDeepLink {
  yearId: string | null;
  termId: string | null;
  openList: boolean;
}

/** Build the dashboard's link. Both ids are needed: the term list is per year. */
export function ledgerDeepLinkHref(yearId: string, termId: string): string {
  const params = new URLSearchParams({
    [LEDGER_TAB_PARAM]: "list",
    [LEDGER_YEAR_PARAM]: yearId,
    [LEDGER_TERM_PARAM]: termId,
  });
  return `/finance/invoices?${params.toString()}`;
}

/** Parse the query string. Blank values count as absent. */
export function parseLedgerDeepLink(params: { get(name: string): string | null }): LedgerDeepLink {
  const clean = (v: string | null) => (v && v.trim() ? v.trim() : null);
  const termId = clean(params.get(LEDGER_TERM_PARAM));
  return {
    yearId: clean(params.get(LEDGER_YEAR_PARAM)),
    termId,
    // A term link always lands on the list — that is the only thing it filters.
    openList: params.get(LEDGER_TAB_PARAM) === "list" || termId !== null,
  };
}

/** The linked id if it names one of `records`, otherwise null. */
export function knownId(requested: string | null, records: ReadonlyArray<{ id: string }>): string | null {
  if (!requested) return null;
  return records.some((r) => r.id === requested) ? requested : null;
}
