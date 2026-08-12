// Prompt-quality evals — offline, structural.
//
// These encode the prompting decisions this project has committed to, so that
// a later edit that quietly undoes one gets caught. Two categories:
//
//   * PRODUCT: the curriculum grounding is the differentiator
//     (docs/deferred.md: "WAEC/NECO localization is the moat"). A prompt that
//     drifts into generic international lesson-planning is a product
//     regression that no typecheck or unit test would notice.
//
//   * PROMPTING HYGIENE: current Claude models follow the system prompt
//     closely, so emphasis written for older, less steerable models now
//     over-applies. Shouty "CRITICAL: YOU MUST" phrasing causes
//     over-triggering and rigid output rather than compliance.

import { LESSON_PLAN_SYSTEM, LESSON_QUIZ_SYSTEM } from "../../src/prompts/lesson-plan.js";
import { check, warn, type EvalCase } from "../harness.js";

// Dated pressure patterns. Not banned outright — emphasis is a legitimate,
// tested fix for one demonstrably underweighted instruction — but each hit
// should be deliberate, so they surface as warnings rather than silence.
const PRESSURE_PATTERNS = [
  /\bCRITICAL\b/,
  /\bYOU MUST\b/,
  /\bNEVER EVER\b/,
  /\bIMPORTANT:/,
  /!!+/,
  /\bDo not be lazy\b/i,
  /\bif in doubt\b/i,
];

const NIGERIAN_GROUNDING_MARKERS = ["nigeria", "waec", "neco", "naira"];

const CLASSROOM_REALITY_MARKERS = ["electricity", "projector", "class", "board"];

function auditSystemPrompt(label: string, prompt: string) {
  const lower = prompt.toLowerCase();
  const results = [];

  results.push(
    check(`${label}: system prompt is non-empty`, prompt.trim().length > 0),
  );

  // A system prompt that has quietly shrunk to a stub is a silent quality
  // regression; 200 chars is well below anything usable here.
  results.push(
    check(
      `${label}: system prompt is substantive`,
      prompt.trim().length > 200,
      `only ${prompt.trim().length} chars — did this get truncated?`,
    ),
  );

  const grounding = NIGERIAN_GROUNDING_MARKERS.filter((m) => lower.includes(m));
  results.push(
    check(
      `${label}: grounded in Nigerian curriculum context`,
      grounding.length >= 2,
      `found only [${grounding.join(", ")}] — the localisation IS the differentiator; ` +
        "a prompt that loses it produces generic output any competitor can match",
    ),
  );

  results.push(
    check(
      `${label}: specifies British spelling`,
      lower.includes("british spelling"),
      "output would drift between US and UK spelling across generations",
    ),
  );

  const pressure = PRESSURE_PATTERNS.filter((p) => p.test(prompt)).map((p) => p.source);
  results.push(
    warn(
      `${label}: free of dated pressure phrasing`,
      pressure.length === 0,
      `matched: ${pressure.join(", ")} — current models follow the system prompt closely; ` +
        "shouty emphasis causes over-triggering rather than compliance",
    ),
  );

  return results;
}

export const promptQualityCase: EvalCase = {
  suite: "Prompt quality — grounding and hygiene",
  run() {
    const results = [
      ...auditSystemPrompt("lesson-plan", LESSON_PLAN_SYSTEM),
      ...auditSystemPrompt("lesson-quiz", LESSON_QUIZ_SYSTEM),
    ];

    const lessonLower = LESSON_PLAN_SYSTEM.toLowerCase();
    const reality = CLASSROOM_REALITY_MARKERS.filter((m) => lessonLower.includes(m));
    results.push(
      check(
        "lesson-plan: accounts for real classroom constraints",
        reality.length >= 3,
        `found only [${reality.join(", ")}] — activities that assume a projector or ` +
          "one device per student are unusable in the schools this serves",
      ),
    );

    results.push(
      check(
        "lesson-quiz: requires a mark scheme",
        LESSON_QUIZ_SYSTEM.toLowerCase().includes("mark scheme"),
        "a quiz without a mark scheme is half a feature — ARCHITECTURE.md §7 specifies both",
      ),
    );

    results.push(
      check(
        "lesson-quiz: constrains questions to the taught material",
        /did not teach|lesson content provided|answerable from the lesson/i.test(LESSON_QUIZ_SYSTEM),
        "without this the model invents questions on material the lesson never covered",
      ),
    );

    return results;
  },
};
