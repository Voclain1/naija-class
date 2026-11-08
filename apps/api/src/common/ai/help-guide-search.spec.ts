import { afterEach, describe, expect, it, vi } from "vitest";

import { GUIDE_SECTIONS, isGuideAnchor, searchGuide, tokenize } from "@school-kit/ai";

// FD-5a — search over the help guide (docs/reviews/agentic-implementation-plan.md
// §3.3). The index's anchors and freshness are checked against the real page in
// apps/web/src/app/help/guide/guide-index.spec.ts; this file checks the search.

describe("help guide search (FD-5a)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("finds every searchable section first when asked by its own title", () => {
    const misses = GUIDE_SECTIONS.filter((s) => s.searchable)
      .filter((s) => searchGuide(s.title)[0]?.anchor !== s.anchor)
      .map((s) => s.title);
    expect(misses).toEqual([]);
  });

  it("answers ordinary questions with the section a reader would want", () => {
    const top = (q: string) => searchGuide(q)[0]?.anchor;
    expect(top("How do parents pay fees online?")).toBe("letting-parents-pay-online");
    expect(top("print result PIN cards")).toBe("result-pin-cards");
    expect(top("how do I start a new session")).toBe("a-new-session");
    expect(top("taking the register for attendance")).toBe("taking-the-daily-register");
    expect(top("what does the dashboard checklist do")).toBe("step-3-use-the-checklist-on-your-dashboard");
    expect(top("invite teachers")).toBe("step-7-invite-your-teachers-and-office-staff");
  });

  it("never returns the contents list or a heading with no text of its own", () => {
    const unsearchable = GUIDE_SECTIONS.filter((s) => !s.searchable).map((s) => s.anchor);
    expect(unsearchable).toContain("what-is-in-this-guide");
    for (const s of GUIDE_SECTIONS) {
      for (const hit of searchGuide(s.title, { limit: 8 })) expect(unsearchable).not.toContain(hit.anchor);
    }
  });

  it("returns only real anchors, with the heading path and a capped excerpt", () => {
    const hits = searchGuide("fees", { limit: 8, maxExcerptChars: 200 });
    expect(hits).toHaveLength(8);
    for (const h of hits) {
      expect(isGuideAnchor(h.anchor)).toBe(true);
      expect(h.path.endsWith(h.title)).toBe(true);
      expect(h.excerpt.length).toBeLessThanOrEqual(201);
    }
    expect(hits.map((h) => h.score)).toEqual([...hits.map((h) => h.score)].sort((a, b) => b - a));
  });

  it("clamps the number of hits to 1–8, and finds nothing for an empty or meaningless query", () => {
    expect(searchGuide("fees", { limit: 0 })).toHaveLength(1);
    expect(searchGuide("fees", { limit: 50 })).toHaveLength(8);
    expect(searchGuide("")).toEqual([]);
    expect(searchGuide("the and of to")).toEqual([]);
    expect(searchGuide("zqxv wqpt")).toEqual([]);
  });

  it("is deterministic and makes no network call", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const a = searchGuide("how do I add parents and send them a message", { limit: 5 });
    const b = searchGuide("how do I add parents and send them a message", { limit: 5 });
    expect(a).toEqual(b);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("tokenizes plainly: lowercase words, simple endings, stopwords out", () => {
    expect(tokenize("Billing Parents for School Fees")).toEqual(["bill", "parent", "school", "fee"]);
    expect(tokenize("The classes and categories")).toEqual(["class", "category"]);
    expect(isGuideAnchor("not-a-heading")).toBe(false);
  });
});
