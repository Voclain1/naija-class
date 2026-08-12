// LIVE evals — the only case in the harness that spends real tokens.
//
// Skipped, loudly, when ANTHROPIC_API_KEY is absent, which is the state in CI
// and on any developer machine without a key. That is deliberate: the offline
// cases must remain a real gate on their own, so `pnpm ai:eval` is meaningful
// before the key ever lands. Skipping is reported as a skip, never as a pass.
//
// What this asserts is deliberately shape-and-substance, not "is the lesson
// plan good" — quality is a human judgement and a model that produces
// beautifully-written nonsense would pass any automatable check. What it CAN
// catch, and what breaks silently in practice:
//   * structured output no longer conforming to the schema
//   * a section coming back empty or as a one-line stub
//   * the localisation instruction being ignored
//   * the response arriving as a refusal

import { createAnthropicClient } from "../../src/client.js";
import {
  LESSON_PLAN_PROMPT,
  LESSON_PLAN_SCHEMA,
  LESSON_PLAN_SYSTEM,
  renderLessonPlanPrompt,
} from "../../src/prompts/lesson-plan.js";
import { check, skip, warn, type CheckResult, type EvalCase } from "../harness.js";

const FIXTURE = {
  classLevel: "JSS 2",
  subject: "Basic Science",
  topic: "Photosynthesis",
  objectives: "Students should be able to state the word equation and name the raw materials.",
  durationMinutes: 40,
};

export const liveGenerationCase: EvalCase = {
  suite: "Live generation (requires ANTHROPIC_API_KEY)",
  async run(): Promise<CheckResult[]> {
    const key = process.env.ANTHROPIC_API_KEY;
    const usable = key && key.trim() !== "" && !key.includes("placeholder") && !key.includes("replace-me");
    if (!usable) {
      return [
        skip(
          "lesson-plan: end-to-end generation against the real API",
          "ANTHROPIC_API_KEY not set (or is a placeholder) — offline checks above still gate this PR",
        ),
      ];
    }

    const client = createAnthropicClient(key);
    if (!client) return [skip("lesson-plan: end-to-end generation", "client could not be constructed")];

    const results: CheckResult[] = [];
    const started = Date.now();
    const response = await client.create({
      model: LESSON_PLAN_PROMPT.model,
      system: LESSON_PLAN_SYSTEM,
      userContent: renderLessonPlanPrompt(FIXTURE),
      maxTokens: LESSON_PLAN_PROMPT.maxTokens,
      jsonSchema: LESSON_PLAN_SCHEMA,
    });
    const elapsed = Date.now() - started;

    results.push(
      check(
        "response is not a refusal",
        response.stopReason !== "refusal",
        `stop_reason=${response.stopReason}`,
      ),
    );
    results.push(
      check(
        "response was not truncated by max_tokens",
        response.stopReason !== "max_tokens",
        `hit the ${LESSON_PLAN_PROMPT.maxTokens}-token ceiling — sections will be cut off mid-sentence`,
      ),
    );

    let parsed: Record<string, string> | null = null;
    try {
      parsed = JSON.parse(response.text) as Record<string, string>;
    } catch {
      parsed = null;
    }
    results.push(check("structured output parses as JSON", parsed !== null));

    if (parsed) {
      for (const section of ["introduction", "mainContent", "activities", "assessment", "homework"]) {
        const value = parsed[section];
        results.push(
          check(
            `section "${section}" is present and substantive`,
            typeof value === "string" && value.trim().length > 80,
            typeof value === "string"
              ? `only ${value.trim().length} chars — a stub, not a usable section`
              : "missing entirely",
          ),
        );
      }

      const all = Object.values(parsed).join(" ").toLowerCase();
      results.push(
        warn(
          "output shows Nigerian localisation",
          /nigeria|naira|waec|neco|lagos|kano|ibadan|garri|yam|cassava/.test(all),
          "no Nigerian marker found anywhere in the generated plan — the grounding instruction may be being ignored",
        ),
      );
    }

    results.push(
      warn(
        "generation completed within 60s",
        elapsed < 60_000,
        `took ${(elapsed / 1000).toFixed(1)}s`,
      ),
    );

    console.log(
      `    tokens: ${response.inputTokens} in / ${response.outputTokens} out, ${(elapsed / 1000).toFixed(1)}s`,
    );

    return results;
  },
};
