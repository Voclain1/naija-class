// Registry + schema integrity evals.
//
// These are the checks that stop a prompt PR from landing something that
// typechecks but is wrong at runtime: a schema the API will reject, a
// maxTokens that exceeds the model's ceiling, a version someone forgot to
// bump, or a cost profile nobody looked at.

import { MODEL_PRICING, estimateCostMicroUsd } from "../../src/models.js";
import { LESSON_PLAN_SCHEMA } from "../../src/prompts/lesson-plan.js";
import { PROMPTS, promptRef } from "../../src/prompts/registry.js";
import { check, warn, type EvalCase } from "../harness.js";

// Structured-output schema restrictions. These are API-level constraints: a
// schema violating them is rejected at call time, which without this check
// would surface as a 400 in production on the first real generation.
const UNSUPPORTED_SCHEMA_KEYWORDS = [
  "minimum",
  "maximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "pattern",
  "$ref",
];

function walkSchema(node: unknown, visit: (obj: Record<string, unknown>) => void): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((n) => walkSchema(n, visit));
    return;
  }
  const obj = node as Record<string, unknown>;
  visit(obj);
  Object.values(obj).forEach((v) => walkSchema(v, visit));
}

// The five lesson_plans content columns the schema must fill. Kept as a
// literal list rather than imported from the DB layer: this file is the
// contract check, and importing the thing under test would make it vacuous.
const LESSON_PLAN_DB_COLUMNS = ["introduction", "mainContent", "activities", "assessment", "homework"];

export const registryIntegrityCase: EvalCase = {
  suite: "Registry + schema integrity",
  run() {
    const results = [];
    const entries = Object.values(PROMPTS);

    // ---- every registered prompt is well-formed --------------------------
    for (const p of entries) {
      const ref = promptRef(p);
      results.push(
        check(
          `${ref}: has a non-empty name and version`,
          Boolean(p.name && p.version),
          "a prompt with no version cannot be traced in the ai_generations ledger",
        ),
      );
      results.push(
        check(
          `${ref}: model has a price-table entry`,
          Boolean(MODEL_PRICING[p.model]),
          `no pricing for "${p.model}" — costMicroUsd would throw at settle time`,
        ),
      );
      results.push(
        check(`${ref}: maxTokens is positive`, p.maxTokens > 0),
      );
      // Haiku 4.5 caps at 64K output; the Sonnet/Opus tier at 128K. A prompt
      // above its model's ceiling is a guaranteed runtime 400.
      const ceiling = p.model === "claude-haiku-4-5" ? 64_000 : 128_000;
      results.push(
        check(
          `${ref}: maxTokens within the model's output ceiling`,
          p.maxTokens <= ceiling,
          `${p.maxTokens} exceeds ${ceiling} for ${p.model}`,
        ),
      );
    }

    // ---- names and refs are unique ---------------------------------------
    const refs = entries.map(promptRef);
    results.push(
      check(
        "prompt refs are unique",
        new Set(refs).size === refs.length,
        "two registry entries share a name@version — the ledger could not tell them apart",
      ),
    );

    // ---- worst-case cost is sane ----------------------------------------
    // Not a correctness check — a tripwire. If a prompt's worst-case call is
    // suddenly dollars rather than cents, someone should look before it ships.
    for (const p of entries) {
      const worstCase = estimateCostMicroUsd(p.model, 4000, p.maxTokens);
      results.push(
        warn(
          `${promptRef(p)}: worst-case cost per call under $0.25`,
          worstCase < 250_000,
          `worst case ≈ $${(worstCase / 1_000_000).toFixed(4)} per call`,
        ),
      );
    }

    // ---- lesson-plan structured-output schema ---------------------------
    const schema = LESSON_PLAN_SCHEMA as Record<string, unknown>;
    const props = (schema.properties ?? {}) as Record<string, unknown>;
    const required = (schema.required ?? []) as string[];

    results.push(
      check(
        "lesson-plan schema: every DB content column is a schema property",
        LESSON_PLAN_DB_COLUMNS.every((c) => c in props),
        `missing: ${LESSON_PLAN_DB_COLUMNS.filter((c) => !(c in props)).join(", ")}`,
      ),
    );
    results.push(
      check(
        "lesson-plan schema: no property without a DB column to land in",
        Object.keys(props).every((k) => LESSON_PLAN_DB_COLUMNS.includes(k)),
        `orphan properties: ${Object.keys(props).filter((k) => !LESSON_PLAN_DB_COLUMNS.includes(k)).join(", ")}`,
      ),
    );
    results.push(
      check(
        "lesson-plan schema: all properties are required",
        LESSON_PLAN_DB_COLUMNS.every((c) => required.includes(c)),
        "a non-required property would let the model omit a section, writing an empty column",
      ),
    );

    let missingAdditionalProps = 0;
    let unsupported: string[] = [];
    walkSchema(schema, (obj) => {
      if (obj.type === "object" && obj.additionalProperties !== false) missingAdditionalProps += 1;
      for (const kw of UNSUPPORTED_SCHEMA_KEYWORDS) {
        if (kw in obj) unsupported.push(kw);
      }
    });
    results.push(
      check(
        "lesson-plan schema: every object sets additionalProperties:false",
        missingAdditionalProps === 0,
        `${missingAdditionalProps} object(s) missing it — structured outputs rejects the schema`,
      ),
    );
    results.push(
      check(
        "lesson-plan schema: uses no unsupported JSON Schema keywords",
        unsupported.length === 0,
        `unsupported: ${[...new Set(unsupported)].join(", ")}`,
      ),
    );
    results.push(
      check(
        "lesson-plan schema: every property carries a description",
        Object.values(props).every((p) => Boolean((p as Record<string, unknown>).description)),
        "an undescribed property gives the model no guidance on what to put there",
      ),
    );

    return results;
  },
};
