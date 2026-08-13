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
import {
  INSIGHTS_NARRATION_SYSTEM,
  INSIGHTS_ROUTER_SYSTEM,
  buildInsightsRouterSchema,
} from "../../src/prompts/insights.js";
import { PARENT_WEEKLY_SUMMARY_SYSTEM } from "../../src/prompts/parent-weekly-summary.js";
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
      ...auditSystemPrompt("parent-weekly-summary", PARENT_WEEKLY_SUMMARY_SYSTEM),
      // The router is deliberately NOT put through auditSystemPrompt: it is a
      // classifier, not a writer. It has no reason to mention Nigeria, WAEC or
      // British spelling, and forcing it to satisfy a prose-quality audit
      // would mean padding a classification prompt with irrelevant text. Its
      // own checks are below.
      ...auditSystemPrompt("insights-narration", INSIGHTS_NARRATION_SYSTEM),
    ];

    // ---- insights router: the closed output space -------------------------
    // This prompt's entire safety property is that it chooses a label from a
    // list and does nothing else. Each check below is one way that could be
    // eroded by a well-meaning edit.
    const routerSystem = INSIGHTS_ROUTER_SYSTEM;

    results.push(
      check(
        "insights-router: forbids inventing a report name",
        /never invent a report name/i.test(routerSystem),
        "an invented intent name would fall through the service's switch and " +
          "either crash or silently answer nothing",
      ),
      check(
        "insights-router: prefers 'unsupported' over a poor match",
        /do not force a poor match/i.test(routerSystem) && /unsupported/i.test(routerSystem),
        "answering a different question than the one asked, confidently, is this " +
          "feature's worst failure mode — worse than admitting the gap",
      ),
      check(
        "insights-router: routes out-of-scope topics rather than approximating",
        /fees or money/i.test(routerSystem) && /individual child/i.test(routerSystem),
        "without naming them, finance and single-student questions get routed to " +
          "the nearest academic report and answered wrongly",
      ),
      check(
        "insights-router: does not answer the question itself",
        /do not answer the question/i.test(routerSystem),
        "a router that starts answering is a router producing numbers, which is " +
          "the exact thing this design exists to prevent",
      ),
    );

    // The schema IS the output space — a router whose schema lost its enum
    // would accept any string, which is the same failure as an invented name.
    const routerSchema = buildInsightsRouterSchema(["a", "b"]) as {
      properties: { intent: { enum?: unknown[] } };
    };
    results.push(
      check(
        "insights-router: schema constrains intent to an enum",
        Array.isArray(routerSchema.properties.intent.enum) &&
          routerSchema.properties.intent.enum.length === 2,
        "structured output is what makes the output space closed; without the enum " +
          "the model can return any string",
      ),
    );

    // ---- insights narration: the no-arithmetic rules ----------------------
    const narrationSystem = INSIGHTS_NARRATION_SYSTEM;

    results.push(
      check(
        "insights-narration: forbids numbers it was not given",
        /never state, imply, estimate or round to a number you were not handed/i.test(
          narrationSystem,
        ),
        "the whole design is that every figure comes from SQL — a model that " +
          "derives its own puts an unchecked number in front of an owner",
      ),
      check(
        "insights-narration: forbids naming a student",
        /never name a student/i.test(narrationSystem),
        "it is given no names; an invented one in a report an admin forwards is " +
          "a serious error",
      ),
      check(
        "insights-narration: forbids claiming a cause",
        /never claim a cause/i.test(narrationSystem),
        "these figures cannot distinguish teaching from timetabling from cohort, " +
          "and a guessed cause in writing is how a teacher gets unfairly blamed",
      ),
      check(
        "insights-narration: requires interpretation over recitation",
        /interpret, don't recite/i.test(narrationSystem),
        "the table is directly beside it; restating rows adds nothing",
      ),
    );

    // ---- parent weekly summary: the UNATTENDED-OUTPUT checks --------------
    // Every other prompt in this registry produces a draft that a teacher
    // reads before anyone else does. This one's output goes to a parent with
    // nobody in between (D16), so the instructions that keep it safe are not
    // quality preferences — they are the only control on the output, and an
    // edit that removes one must fail the build rather than ship quietly.
    const summarySystem = PARENT_WEEKLY_SUMMARY_SYSTEM;

    results.push(
      check(
        "parent-weekly-summary: forbids urgency and alarm",
        /never tell the parent to act urgently/i.test(summarySystem) &&
          /immediately/i.test(summarySystem),
        "an unsupervised model telling a parent to come to the school immediately about their " +
          "child is the specific harm D16's no-gate decision has to hold the line on — there is " +
          "no teacher reading this before it sends",
      ),
      check(
        "parent-weekly-summary: routes real concerns through the class teacher",
        /class teacher/i.test(summarySystem),
        "a concern with no named route out leaves a worried parent with nowhere to go",
      ),
      check(
        "parent-weekly-summary: forbids over-reading a single data point",
        /one low score is one low score/i.test(summarySystem),
        "a week is a tiny sample; without this the model narrates one middling test as a trend, " +
          "and no human will catch it before the parent reads it",
      ),
      check(
        "parent-weekly-summary: forbids inventing a child's name",
        /never invent a name/i.test(summarySystem),
        "the model is given no name — and unlike a report card, nobody proofreads this one",
      ),
      check(
        "parent-weekly-summary: forbids gendered pronouns",
        /never use/i.test(summarySystem) && /\bhe\b.*\bshe\b|gender/i.test(summarySystem),
        "gender is deliberately not sent, so any pronoun is a guess in a message to the child's own parent",
      ),
      check(
        "parent-weekly-summary: bans teacher-register jargon",
        /\bCA1\b/.test(summarySystem) && /do not say/i.test(summarySystem),
        'the audience is a parent on a phone, not a staff room — "CA1 component weighting" is ' +
          "the register this prompt exists to translate out of",
      ),
      check(
        "parent-weekly-summary: asks for one concrete thing to do at home",
        /doable thing the parent could do at home/i.test(summarySystem) &&
          /monitor their progress/i.test(summarySystem),
        'without a banned-example to anchor it the model closes on "continue to monitor their ' +
          'progress", which is the filler phrase that makes a parent stop opening these',
      ),
      check(
        "parent-weekly-summary: constrains length for a phone screen",
        /three to four short sentences/i.test(summarySystem),
        "this is read on a phone; an unconstrained note goes unread, which is a silent failure — " +
          "the send still succeeds",
      ),
    );

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
        /never repeat a score back as a number/i.test(commentSystem),
        "the parent can already see the scores on the card; a comment that repeats them adds nothing. " +
          "v1 phrased this as a clause inside the don't-invent-figures bullet and the model ignored it " +
          'in real output ("the exam performance of 33/60") — v2 gives it its own rule with examples',
      ),
      check(
        "report-card-comment: forbids naming topics it was never told were taught",
        /never name a topic, subtopic or skill/i.test(commentSystem),
        "the prompt is given a subject name and no syllabus. v1 produced \"focused revision of " +
          'fundamentals in algebra and number work" for a class it knew nothing about — a guess ' +
          "that lands on a permanent report card a parent keeps",
      ),
      check(
        "report-card-comment: redirects improvement advice to work and habits",
        /about the work and the habits behind it/i.test(commentSystem),
        "banning topic names without offering an alternative just produces vague advice; the " +
          "figures DO support concrete habit-level next steps (classwork-vs-exam gap, late rush)",
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
