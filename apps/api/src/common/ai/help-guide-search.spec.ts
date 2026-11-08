import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GUIDE_PARAPHRASE_CASES,
  GUIDE_PARAPHRASE_HOLDOUT,
  GUIDE_SECTIONS,
  isGuideAnchor,
  queryTerms,
  searchGuide,
  tokenize,
  type ParaphraseCase,
} from "@school-kit/ai";

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

  it("hears 'log in' as the guide's 'sign in', in every form people type it", () => {
    for (const q of ["log in", "login", "logging in", "log-in", "logon", "logged in", "signin"]) {
      expect(queryTerms(`teacher cannot ${q}`), q).toContain("sign");
    }
    expect(queryTerms("pay staff salaries")).toEqual(expect.arrayContaining(["salary", "payroll"]));
    expect(queryTerms("who is the class teacher")).toEqual(expect.arrayContaining(["form", "teacher"]));
    // The person's own words are kept beside the guide's.
    expect(queryTerms("list of debtors")).toEqual(expect.arrayContaining(["debtor", "unpaid"]));
  });
});

// Paraphrase cases (packages/ai/src/help-guide/guide-paraphrases.ts): questions
// in staff's own words. Floors are today's measurements; a change that lowers
// them fails here. The held-out set was written after tuning and never tuned
// on, so its numbers are the honest ones for unseen questions.
describe("help guide search on paraphrased questions (FD-5a)", () => {
  function measure(cases: readonly ParaphraseCase[]) {
    const misses: string[] = [];
    let top1 = 0;
    let top3 = 0;
    for (const c of cases) {
      const hits = searchGuide(c.question).map((h) => h.anchor);
      if (c.accept.includes(hits[0]!)) top1++;
      if (hits.some((a) => c.accept.includes(a))) top3++;
      else misses.push(`${c.question} -> ${hits.join(", ")}`);
    }
    return { top1, top3, misses };
  }

  it("every 'log in' and 'sign in' question finds a correct section in the top 3", () => {
    const signIn = [...GUIDE_PARAPHRASE_CASES, ...GUIDE_PARAPHRASE_HOLDOUT].filter((c) =>
      /log ?in|sign in|login/i.test(c.question),
    );
    expect(signIn.length).toBeGreaterThanOrEqual(6);
    expect(measure(signIn).misses).toEqual([]);
  });

  it("tuned set: all 44 in the top 3, at least 34 first", () => {
    const r = measure(GUIDE_PARAPHRASE_CASES);
    expect(GUIDE_PARAPHRASE_CASES).toHaveLength(44);
    expect(r.misses).toEqual([]);
    expect(r.top1).toBeGreaterThanOrEqual(34);
  });

  it("held-out set (not tuned on): at least 19 of 20 in the top 3, at least 15 first", () => {
    const r = measure(GUIDE_PARAPHRASE_HOLDOUT);
    expect(GUIDE_PARAPHRASE_HOLDOUT).toHaveLength(20);
    expect(r.top3).toBeGreaterThanOrEqual(19);
    expect(r.top1).toBeGreaterThanOrEqual(15);
    // The known miss, kept visible rather than tuned away: no shared words.
    expect(r.misses).toEqual([expect.stringMatching(/^what does SchoolKit set up for me automatically ->/)]);
  });
});
