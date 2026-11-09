import { BILLING_RUN_PROMPT, BILLING_RUN_SYSTEM, BILLING_RUN_TASK } from "../../src/prompts/billing-run.js";
import { PROMPTS } from "../../src/prompts/registry.js";
import { check, skip, type EvalCase } from "../harness.js";

export const billingRunCase: EvalCase = {
  suite: "Invoice task planner — offline contract (not live task quality)",
  run: () => [
    check("planner registered and versioned", PROMPTS.BILLING_RUN_PLANNER === BILLING_RUN_PROMPT && BILLING_RUN_PROMPT.version === "1"),
    check("task is fixed text, not a user-request renderer", BILLING_RUN_TASK === "Prepare the selected term and class scope for human review."),
    check("planner inspects before requesting human review", BILLING_RUN_SYSTEM.includes("First call billing_check_scope") && BILLING_RUN_SYSTEM.includes("billing_request_review")),
    check("planner cannot issue or approve", BILLING_RUN_SYSTEM.includes("cannot") && BILLING_RUN_SYSTEM.includes("approve anything")),
    check("planner must stop on refusals", BILLING_RUN_SYSTEM.includes("tool is refused or fails, stop")),
    check("planner prose is not a financial channel", BILLING_RUN_SYSTEM.includes("Do not quote counts or amounts")),
    skip("live invoice-planner task success", "No live account/model evaluation is claimed. Fake-port tool sequences and real database execution tests gate implementation; live eval is required before activation."),
  ],
};
