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
import { REPORT_CARD_COMMENT_SYSTEM } from "../../src/prompts/report-card-comment.js";
import { REPORT_CARD_FORM_COMMENT_SYSTEM } from "../../src/prompts/report-card-form-comment.js";
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
      ...auditSystemPrompt("report-card-comment", REPORT_CARD_COMMENT_SYSTEM),
      ...auditSystemPrompt("report-card-form-comment", REPORT_CARD_FORM_COMMENT_SYSTEM),
    ];

    // ---- form comment: what makes it a FORM comment ----------------------
    // These are the checks that keep it from collapsing into a longer subject
    // comment. The two prompts are deliberately separate (different inputs,
    // different author, independent quality regressions) and this is where that
    // separation is enforced rather than assumed.
    const formSystem = REPORT_CARD_FORM_COMMENT_SYSTEM;

    results.push(
      check(
        "report-card-form-comment: forbids inventing a student name",
        /never invent a name/i.test(formSystem),
        "the model is given no name; without this it fills the gap with a plausible one",
      ),
      check(
        "report-card-form-comment: forbids gendered pronouns",
        /never use/i.test(formSystem) && /\bhe\b.*\bshe\b|gender/i.test(formSystem),
        "gender is deliberately not sent, so any pronoun is a guess on a parent-facing record",
      ),
      check(
        "report-card-form-comment: requires naming actual subjects",
        /name actual subjects/i.test(formSystem),
        'without this it produces "performed well in some subjects", which tells a parent nothing ' +
          "the grade table beside it does not already say",
      ),
      check(
        "report-card-form-comment: speaks to the overall picture, not one subject",
        /overall/i.test(formSystem) && /position/i.test(formSystem),
        "this is the whole-child comment; if it reads like a subject comment the slice has no reason to exist",
      ),
      check(
        "report-card-form-comment: asks for a concrete next step",
        /concrete, specific thing that would improve/i.test(formSystem),
        "a comment with no actionable close leaves a parent knowing the result but not what to do",
      ),
      check(
        "report-card-form-comment: bans the template openers",
        /do not open with/i.test(formSystem),
        "40 form comments in one arm opening identically is the failure a parent notices first",
      ),
      check(
        "report-card-form-comment: instructs the model not to invent figures",
        /never state or imply a figure you were not given/i.test(formSystem),
        "the grade table sits beside this comment and will contradict a fabricated number",
      ),
    );

    // ---- report-card comment: the constraints that make it usable --------
    // This prompt runs once per student per subject. Its failure modes are
    // specific and each one is a real complaint a school would make, so they
    // are gated individually rather than by a general "is it substantive"
    // check.
    const commentSystem = REPORT_CARD_COMMENT_SYSTEM;

    results.push(
      check(
        "report-card-comment: forbids inventing a student name",
        /never invent a name/i.test(commentSystem),
        "the model is given no name; without this instruction it fills the gap with a plausible one, " +
          "and a report card addressed to the wrong child is the worst output this feature can produce",
      ),
      check(
        "report-card-comment: forbids gendered pronouns",
        /\bhe\b.*\bshe\b|gender/i.test(commentSystem) && /never use/i.test(commentSystem),
        "gender is deliberately not sent (PII), so any pronoun is a guess — a report calling a girl \"he\" " +
          "is worse than one with no pronoun at all",
      ),
      check(
        "report-card-comment: constrains length to a comment, not a paragraph",
        /one to two sentences|1-2 sentences/i.test(commentSystem),
        "an unconstrained comment overflows the report card layout and stops reading like a teacher wrote it",
      ),
      check(
        "report-card-comment: bans the template openers that collapse a class set",
        /this student|the student/i.test(commentSystem) && /do not open with/i.test(commentSystem),
        "without this, 40 comments in one arm open identically and the whole feature reads as machine-written",
      ),
      check(
        "report-card-comment: requires interpretation rather than restating figures",
        /never restate the raw numbers|interpret them/i.test(commentSystem),
        "the parent can already see the scores on the card; a comment that repeats them adds nothing",
      ),
      check(
        "report-card-comment: requires honesty about weak performance",
        /\bhonest\b/i.test(commentSystem) && /mislead/i.test(commentSystem),
        "softening a failing grade into \"satisfactory progress\" is the failure mode that makes a school " +
          "distrust every comment the system produces",
      ),
      check(
        "report-card-comment: instructs the model not to invent figures",
        /never state or imply a figure you were not given/i.test(commentSystem),
        "a fabricated attendance percentage or score in a parent-facing record is a data-integrity incident",
      ),
    );

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
