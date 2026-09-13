import { describe, expect, it } from "vitest";

import { knownId, ledgerDeepLinkHref, parseLedgerDeepLink } from "./ledger-deep-link";

const YEAR = "11111111-1111-4111-8111-111111111111";
const TERM = "22222222-2222-4222-8222-222222222222";

describe("ledgerDeepLinkHref / parseLedgerDeepLink", () => {
  it("round-trips: the link the dashboard builds is the link the invoice page reads", () => {
    const href = ledgerDeepLinkHref(YEAR, TERM);
    expect(href.startsWith("/finance/invoices?")).toBe(true);
    const parsed = parseLedgerDeepLink(new URL(href, "http://x").searchParams);
    expect(parsed).toEqual({ yearId: YEAR, termId: TERM, openList: true });
  });

  it("no params → no filter, stays on the default tab", () => {
    expect(parseLedgerDeepLink(new URLSearchParams(""))).toEqual({ yearId: null, termId: null, openList: false });
  });

  it("blank values count as absent", () => {
    expect(parseLedgerDeepLink(new URLSearchParams("termId=&yearId=%20"))).toEqual({
      yearId: null,
      termId: null,
      openList: false,
    });
  });

  it("a term link opens the list even without tab=list", () => {
    expect(parseLedgerDeepLink(new URLSearchParams(`termId=${TERM}`)).openList).toBe(true);
  });
});

describe("knownId", () => {
  const records = [{ id: TERM }, { id: "33333333-3333-4333-8333-333333333333" }];

  it("accepts an id the API returned", () => {
    expect(knownId(TERM, records)).toBe(TERM);
  });

  it("rejects an id it did not — another school's, a stale bookmark, or garbage", () => {
    expect(knownId("44444444-4444-4444-8444-444444444444", records)).toBeNull();
    expect(knownId("not-a-uuid", records)).toBeNull();
    expect(knownId("'; DROP TABLE invoices;--", records)).toBeNull();
  });

  it("rejects everything when nothing has loaded", () => {
    expect(knownId(TERM, [])).toBeNull();
    expect(knownId(null, records)).toBeNull();
  });
});
