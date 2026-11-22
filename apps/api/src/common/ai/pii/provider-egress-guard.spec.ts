import { describe, expect, it } from "vitest";

import { ProviderEgressGuard, WITHHELD } from "./provider-egress-guard.js";
import { PersonRefs } from "./question-check.js";

// The provider egress guard matches the school's ACTUAL values, not patterns
// (docs/modules/assistant-ai-governance.md, "Data minimisation").

const guard = new ProviderEgressGuard({
  people: [
    { first: "Grace", middle: "Ifeoma", last: "Hope" }, // both name parts are ordinary English words
    { first: "Chidinma", last: "Okafor" },
    { first: "Bisi", last: "Adeyemi-Cole" },
  ],
  admissionNumbers: ["VFM/2024/017", "1234", "12"],
  emails: ["Parent.One@Example.test"],
  phones: ["+234 803 123 4567"],
});

describe("provider egress guard [release-check:eng.pseudonymisation]", () => {
  it("finds a full name the school holds in any case, order or accent, which the capitalisation rule alone misses", () => {
    for (const t of ["fees for grace hope please", "Hope Grace in JSS 2", "grace ifeoma hope", "OKAFOR CHIDINMA", "Adáeze? no: Chídinma Okafor's report", "bisi adeyemi cole"]) {
      expect(guard.scan(t), t).toContain("known-name");
    }
    // A single word is the roster detector's job; sequences only here, so ordinary words pass.
    for (const t of ["is there a grace period", "we hope to finish", "Chidinma", "okafor street"]) expect(guard.scan(t), t).not.toContain("known-name");
  });

  it("finds admission numbers, emails and phone numbers the school holds, however they are written", () => {
    expect(guard.scan("check vfm/2024/017")).toEqual(["known-admission-number"]);
    expect(guard.scan("mail parent.one@example.TEST")).toEqual(["known-email"]);
    expect(guard.scan("call 0803-123-4567")).toEqual(["known-phone"]);
    expect(guard.scan("call +2348031234567")).toEqual(["known-phone"]);
    // Too short to be specific, and a different phone number: not matched.
    expect(guard.scan("12 students, 0803 999 0000")).toEqual([]);
  });

  it("turns full names into server-held markers, so the person can still be found", () => {
    const refs = new PersonRefs();
    const out = guard.markNames("show grace hope and Okafor Chidinma's results", refs);
    expect(out).toBe("show ⟨P1⟩ and ⟨P2⟩ results");
    expect([...refs.values.values()]).toEqual(["grace hope", "Okafor Chidinma"]);
  });

  it("withholds every identifier from text going to a provider", () => {
    const r = guard.redact('{"classes":["Grace Hope\'s class","JSS 2A"],"note":"VFM/2024/017 parent.one@example.test 08031234567"}');
    expect(r.text).not.toMatch(/grace|hope|vfm|parent\.one|0803/i);
    expect(r.text).toContain("JSS 2A");
    expect(r.withheld).toBe(4);
    expect(r.text.split(WITHHELD)).toHaveLength(5);
  });

  it("an empty school withholds nothing", () => {
    const empty = new ProviderEgressGuard({ people: [], admissionNumbers: [], emails: [], phones: [] });
    expect(empty.scan("Grace Hope 08031234567")).toEqual([]);
    expect(empty.redact("anything").withheld).toBe(0);
  });
});
