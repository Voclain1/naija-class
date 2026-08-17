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
  LESSON_PLAN_SECTION_ORDER,
  LESSON_PLAN_SYSTEM,
  renderLessonPlanPrompt,
} from "../../src/prompts/lesson-plan.js";
import { check, skip, warn, type CheckResult, type EvalCase } from "../harness.js";

// Step labels must ascend. An empty or single-element list is vacuously fine —
// the "at least 2 steps" check above is what catches a missing Presentation.
function isAscending(nums: readonly number[]): boolean {
  return nums.every((n, i) => i === 0 || n >= (nums[i - 1] ?? 0));
}

// Counts discrete items in a section that should read as a list.
//
// Deliberately NOT line-anchored and deliberately not question-mark-only. Both
// of those were the first shape of this check and both were wrong, caught by
// running a Mathematics topic through the real model rather than by reasoning:
//
//   * A maths Evaluation is imperative, not interrogative — "Solve
//     simultaneously: x + y = 9 and x - y = 3." contains no question mark at
//     all. Requiring '?' would have failed every computational lesson note
//     while passing every biology one.
//   * The model often writes the list inline ("1. ... 2. ... 3. ...") rather
//     than one item per line, so a /^\s*\d[.)]/m anchor counts exactly one.
//
// The property that actually matters is "several discrete, specific items",
// however they happen to be punctuated: enumerators anywhere, bullets, or
// question marks.
// Semicolons count too: a materials line is just as legitimately written
// "Chalkboard and chalk; ruler; a prepared chart; exercise books" as it is
// numbered, and that is what a Mathematics generation actually produced.
function countItems(text: string): number {
  const enumerators = text.match(/(?:^|\s)\d+[.)]\s/g) ?? [];
  const bullets = text.match(/(?:^|\n)\s*[-*•]\s/g) ?? [];
  const questions = text.match(/\?/g) ?? [];
  const semicolons = text.match(/;/g) ?? [];
  return Math.max(enumerators.length, bullets.length, questions.length, semicolons.length);
}

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
      for (const section of LESSON_PLAN_SECTION_ORDER) {
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

      // ---- Nigerian lesson-note conventions, checked against REAL output ---
      // The schema can force the keys to exist; it cannot force the content
      // inside them to follow the convention. These checks are the difference
      // between "the fix is in the schema" and "the fix actually holds" — the
      // v1 defect was well-formed output in the wrong shape, which every
      // structural check of the era passed.
      results.push(
        check(
          "objectives open with the conventional behavioural stem",
          /by the end of (the|this) lesson,? pupils should be able to/i.test(
            parsed.behaviouralObjectives ?? "",
          ),
          `got: "${(parsed.behaviouralObjectives ?? "").slice(0, 90)}..." — the stem is the ` +
            "convention a teacher copies verbatim into the scheme book",
        ),
        check(
          "objectives are numbered outcomes",
          /(^|\n)\s*(\d[.)]|[ivx]+[.)])/im.test(parsed.behaviouralObjectives ?? ""),
          "objectives ran together as prose — they are checked off individually in " +
            "the Evaluation section, so they have to be separable",
        ),
        warn(
          "objectives avoid unobservable verbs",
          !/\b(understand|know|appreciate)\b/i.test(parsed.behaviouralObjectives ?? ""),
          "an objective a teacher cannot observe cannot be evaluated; the prompt " +
            "names these three explicitly",
        ),
        check(
          "presentation is broken into labelled steps",
          (parsed.mainContent ?? "").match(/step\s*\d/gi)?.length >= 2,
          `found ${(parsed.mainContent ?? "").match(/step\s*\d/gi)?.length ?? 0} step labels — ` +
            "the numbered-steps Presentation is the most recognisable feature of the format",
        ),
        check(
          "presentation steps are in ascending order",
          isAscending(
            ((parsed.mainContent ?? "").match(/step\s*(\d+)/gi) ?? []).map((s) =>
              Number(s.replace(/\D/g, "")),
            ),
          ),
          "step numbers are out of order — the note would be taught in the wrong sequence",
        ),
        check(
          "evaluation is a list of specific items, not a description",
          countItems(parsed.assessment ?? "") >= 2,
          `found ${countItems(parsed.assessment ?? "")} discrete items — Evaluation read as ` +
            "a description of how assessment would happen rather than the specific things " +
            "to put to the class, which was a v1 behaviour",
        ),
        warn(
          "instructional materials are itemised",
          countItems(parsed.instructionalMaterials ?? "") >= 2,
          "materials came back as undifferentiated prose; a teacher reads this line to " +
            "pack their bag before walking to class",
        ),
        warn(
          "presentation names both teacher and pupil action",
          /pupil/i.test(parsed.mainContent ?? "") && /teacher/i.test(parsed.mainContent ?? ""),
          "the format's steps say what the teacher does AND what pupils do in response",
        ),
        warn(
          "no projector/printer/tablet assumption",
          !/\b(projector|printer|tablets?|smartboard|powerpoint)\b/i.test(
            Object.values(parsed).join(" "),
          ),
          "assumes equipment the classroom does not have",
        ),
      );

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
