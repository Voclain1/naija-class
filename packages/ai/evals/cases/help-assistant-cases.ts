// FD-5c — the help assistant's evaluation cases stay well-formed (offline).
//
// The cases themselves are in ../help-assistant/cases.ts. This suite checks
// them, not a model: every case is labelled synthetic (none may pass as a real
// support question), every cited anchor exists in the guide index, every
// category the plan requires is present, and every factual case carries gold
// claims plus a crafted wrong answer for the grader to fail. The live run
// (each case against a registered model) is skipped until FD-5c's prompt exists.

import { GUIDE_SECTIONS } from "../../src/help-guide/guide-index.generated.js";
import { check, skip, type EvalCase } from "../harness.js";
import { HELP_EVAL_CASES, type HelpEvalCategory } from "../help-assistant/cases.js";

const MINIMUMS: Record<HelpEvalCategory, number> = {
  answerable: 60,
  unanswerable: 10,
  insufficient: 4,
  refusal: 4,
  injection: 2,
  factual: 6,
};

export const helpAssistantCasesCase: EvalCase = {
  suite: "help-assistant eval cases (FD-5c, synthetic)",
  run() {
    const anchors = new Set(GUIDE_SECTIONS.map((s) => s.anchor));
    const ids = HELP_EVAL_CASES.map((c) => c.id);
    const results = [
      check(
        "every case is labelled synthetic (no real support question yet)",
        HELP_EVAL_CASES.every((c) => c.source === "synthetic"),
      ),
      check("case ids are unique", new Set(ids).size === ids.length),
    ];

    const badAnchors = HELP_EVAL_CASES.flatMap((c) => (c.expect.citeAny ?? []).filter((a) => !anchors.has(a)).map((a) => `${c.id}: ${a}`));
    results.push(check("every cited anchor exists in the guide index", badAnchors.length === 0, badAnchors.join(", ")));

    for (const [category, min] of Object.entries(MINIMUMS) as Array<[HelpEvalCategory, number]>) {
      const n = HELP_EVAL_CASES.filter((c) => c.category === category).length;
      results.push(check(`at least ${min} ${category} cases`, n >= min, `${n}`));
    }

    const factual = HELP_EVAL_CASES.filter((c) => c.category === "factual");
    const thinFactual = factual
      .filter(
        (c) =>
          !c.expect.goldClaims?.length ||
          c.expect.goldClaims.some((g) => !g.figure || !g.belongsTo || !g.unit) ||
          !c.wrongAnswers?.length,
      )
      .map((c) => c.id);
    results.push(
      check("every factual case has complete gold claims and a crafted wrong answer", thinFactual.length === 0, thinFactual.join(", ")),
    );

    const fallbackCats = new Set<HelpEvalCategory>(["unanswerable", "insufficient"]);
    const noFallback = HELP_EVAL_CASES.filter((c) => fallbackCats.has(c.category) && !c.expect.fallback).map((c) => c.id);
    results.push(check("every unanswerable or insufficient case requires the honest fallback", noFallback.length === 0, noFallback.join(", ")));

    const refusalAsOwner = HELP_EVAL_CASES.filter((c) => c.category === "refusal" && (!c.role || c.role === "owner" || c.role === "admin")).map(
      (c) => c.id,
    );
    results.push(check("every refusal case is asked by a role the tool refuses", refusalAsOwner.length === 0, refusalAsOwner.join(", ")));

    results.push(skip("live run against each registered model", "the help-assistant prompt is built in FD-5c"));
    return results;
  },
};
