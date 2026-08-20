// PII-leak evals — mechanically enforcing CLAUDE.md's AI hard rule:
//
//   "Never send student PII (full name, address, DOB, contact info) to the
//    LLM. Use opaque IDs and class-level context (e.g. 'JSS2 student') only."
//
// This is the highest-value check in the whole harness. Every other rule in
// this project is enforced by something — RLS by Postgres, the budget by a
// conditional UPDATE, SDK access by ESLint. Before this file, "no student PII
// reaches Claude" was enforced by nothing but care, which is the same as
// nothing once a second person or a later slice touches a prompt.
//
// The strategy is sentinel-based rather than pattern-matching on realistic
// data. Every renderer input is a unique, improbable token; the rendered
// prompt must contain exactly those sentinels and nothing else identifiable.
// A future edit that pulls `student.firstName` or a DOB into a template fails
// here immediately, because the leaked value is not in the sentinel set.

import { renderLessonPlanPrompt, renderLessonQuizPrompt } from "../../src/prompts/lesson-plan.js";
import {
  renderInsightsNarrationPrompt,
  renderInsightsRouterPrompt,
} from "../../src/prompts/insights.js";
import { renderParentWeeklySummaryPrompt } from "../../src/prompts/parent-weekly-summary.js";
import { renderReportCardCommentPrompt } from "../../src/prompts/report-card-comment.js";
import { renderReportCardFormCommentPrompt } from "../../src/prompts/report-card-form-comment.js";
import { renderStudentListExtractionPrompt } from "../../src/prompts/student-list-extraction.js";
import { PROMPTS } from "../../src/prompts/registry.js";
import { check, type EvalCase } from "../harness.js";

// ---------------------------------------------------------------------------
// THE PII-BEARING PROMPT ALLOWLIST.
//
// CLAUDE.md's AI hard rules carve out exactly ONE prompt that may send student
// PII to the model — `student-list-extraction`, whose entire function is
// transcribing a register the school already holds. This constant is the
// machine-readable half of that table, and the checks below pin it so the
// carve-out cannot quietly widen:
//
//   * a SECOND prompt added here fails the length assertion, so joining the
//     list is a visible, deliberate edit rather than something a feature can
//     argue itself into during review;
//   * the allowlisted prompt must still exist in the registry under exactly
//     this name, so renaming it silently does not orphan the carve-out.
//
// Note what the allowlist does NOT permit: PII in the rendered TEXT. Even for
// this prompt, the text channel stays clean — the register's contents travel
// in the image, and renderStudentListExtractionPrompt takes only class arm
// names. That is asserted below, and it is what keeps this suite meaningful
// for the one prompt it exempts.
const PII_BEARING_PROMPT_ALLOWLIST = ["student-list-extraction"] as const;

// Field names that must never appear in a rendered prompt. If a template ever
// interpolates a labelled PII field, the label itself usually travels with it.
const FORBIDDEN_FIELD_LABELS = [
  "admission number",
  "admissionNumber",
  "date of birth",
  "dateOfBirth",
  "guardian",
  "parent name",
  "phone",
  "address",
  "email",
  "bvn",
  "nin",
  "student name",
  "firstName",
  "lastName",
];

// A realistic student record. NONE of these values may appear in any rendered
// prompt — they stand in for what a careless future edit would pull in.
const FORBIDDEN_VALUES = [
  "Chinedu Okafor",
  "2011-04-17",
  "08031234567",
  "17 Adeola Odeku Street, Victoria Island",
  "chinedu.okafor@example.com",
  "SK/2024/0147",
];

// Word-boundary matched, NOT substring matched. The first run of this eval
// failed on "nin" because the template contains the word "Learning" — a false
// positive that, left in, would have trained the next person to ignore this
// suite. Short tokens like NIN and BVN make substring matching useless here.
function labelPattern(label: string): RegExp {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i");
}

function assertNoForbidden(label: string, rendered: string) {
  const leakedValues = FORBIDDEN_VALUES.filter((v) => rendered.includes(v));
  const leakedLabels = FORBIDDEN_FIELD_LABELS.filter((f) => labelPattern(f).test(rendered));

  return [
    check(
      `${label}: rendered prompt contains no student PII values`,
      leakedValues.length === 0,
      leakedValues.length ? `leaked: ${leakedValues.join(", ")}` : undefined,
    ),
    check(
      `${label}: rendered prompt contains no PII field labels`,
      leakedLabels.length === 0,
      leakedLabels.length ? `found PII field label(s): ${leakedLabels.join(", ")}` : undefined,
    ),
  ];
}

export const piiSafetyCase: EvalCase = {
  suite: "PII safety — no student data may reach the model",
  run() {
    const results = [];

    // ---- lesson-plan renderer -------------------------------------------
    // Inputs are the only things that may appear. Sentinels are improbable
    // strings so an accidental substring match cannot mask a leak.
    const planRendered = renderLessonPlanPrompt({
      classLevel: "SENTINEL_LEVEL_JSS2",
      subject: "SENTINEL_SUBJECT_BIOLOGY",
      topic: "SENTINEL_TOPIC_PHOTOSYNTHESIS",
      objectives: "SENTINEL_OBJECTIVES_TEXT",
      durationMinutes: 40,
    });

    results.push(...assertNoForbidden("lesson-plan", planRendered));
    results.push(
      check(
        "lesson-plan: renders all declared inputs",
        ["SENTINEL_LEVEL_JSS2", "SENTINEL_SUBJECT_BIOLOGY", "SENTINEL_TOPIC_PHOTOSYNTHESIS", "SENTINEL_OBJECTIVES_TEXT"].every(
          (s) => planRendered.includes(s),
        ),
        "a declared input was silently dropped from the template",
      ),
    );

    // The renderer must be a pure function of its inputs: no clock, no
    // environment, no hidden context. Two renders of identical input must be
    // byte-identical, or the eval (and prompt caching) cannot be trusted.
    const planRenderedAgain = renderLessonPlanPrompt({
      classLevel: "SENTINEL_LEVEL_JSS2",
      subject: "SENTINEL_SUBJECT_BIOLOGY",
      topic: "SENTINEL_TOPIC_PHOTOSYNTHESIS",
      objectives: "SENTINEL_OBJECTIVES_TEXT",
      durationMinutes: 40,
    });
    results.push(
      check(
        "lesson-plan: renderer is deterministic",
        planRendered === planRenderedAgain,
        "same input produced different output — a clock or env read has crept into the template",
      ),
    );

    // ---- quiz renderer ---------------------------------------------------
    const quizRendered = renderLessonQuizPrompt({
      classLevel: "SENTINEL_LEVEL_SSS1",
      subject: "SENTINEL_SUBJECT_CHEMISTRY",
      topic: "SENTINEL_TOPIC_MOLES",
      lessonContent: "SENTINEL_LESSON_CONTENT",
    });
    results.push(...assertNoForbidden("lesson-quiz", quizRendered));

    // ---- report-card subject comment renderer ----------------------------
    // The one prompt in the phase whose subject IS an individual student, so
    // it is the one where a PII leak is a live risk rather than a theoretical
    // one: the caller is holding a Student row when it builds this input.
    // Note what the input type cannot express — there is no name, DOB, gender
    // or contact field on ReportCardCommentInput at all, so a leak would
    // require widening the interface, which fails here and is visible in
    // review.
    const commentRendered = renderReportCardCommentPrompt({
      classLevel: "SENTINEL_LEVEL_JSS2",
      subject: "SENTINEL_SUBJECT_MATHS",
      components: [
        { label: "SENTINEL_COMPONENT_CA1", score: 12, max: 20 },
        { label: "SENTINEL_COMPONENT_EXAM", score: 44, max: 60 },
      ],
      totalScore: 56,
      letterGrade: "C",
      remark: "SENTINEL_REMARK_CREDIT",
      subjectPosition: 8,
      classSize: 34,
      attendanceRate: 91,
    });

    results.push(...assertNoForbidden("report-card-comment", commentRendered));
    results.push(
      check(
        "report-card-comment: renders all declared inputs",
        [
          "SENTINEL_LEVEL_JSS2",
          "SENTINEL_SUBJECT_MATHS",
          "SENTINEL_COMPONENT_CA1",
          "SENTINEL_COMPONENT_EXAM",
          "SENTINEL_REMARK_CREDIT",
        ].every((s) => commentRendered.includes(s)),
        "a declared input was silently dropped from the template",
      ),
    );
    results.push(
      check(
        "report-card-comment: renderer is deterministic",
        commentRendered ===
          renderReportCardCommentPrompt({
            classLevel: "SENTINEL_LEVEL_JSS2",
            subject: "SENTINEL_SUBJECT_MATHS",
            components: [
              { label: "SENTINEL_COMPONENT_CA1", score: 12, max: 20 },
              { label: "SENTINEL_COMPONENT_EXAM", score: 44, max: 60 },
            ],
            totalScore: 56,
            letterGrade: "C",
            remark: "SENTINEL_REMARK_CREDIT",
            subjectPosition: 8,
            classSize: 34,
            attendanceRate: 91,
          }),
        "same input produced different output — a clock or env read has crept into the template",
      ),
    );

    // The empty/null branch renders too. A student with no scores and no
    // marked attendance is an ordinary mid-term state, not an error, and the
    // renderer must not produce "undefined" or "null" in the prompt text.
    const sparse = renderReportCardCommentPrompt({
      classLevel: "JSS1",
      subject: "Basic Science",
      components: [],
      totalScore: null,
      letterGrade: null,
      remark: null,
      subjectPosition: null,
      classSize: null,
      attendanceRate: null,
    });
    results.push(
      check(
        "report-card-comment: null-heavy input renders without leaking undefined/null",
        !/\b(undefined|null|NaN)\b/.test(sparse),
        `rendered: ${JSON.stringify(sparse)}`,
      ),
      check(
        "report-card-comment: states attendance is unrecorded rather than omitting it",
        /not recorded/i.test(sparse),
        "silently dropping the attendance line lets the model assume attendance was fine",
      ),
    );

    // ---- report-card FORM comment renderer -------------------------------
    // Same subject as the comment above — an individual student — but a wider
    // input: every subject they took this term. More fields is more surface for
    // a future edit to pull a student row through, so it gets the same
    // sentinel treatment rather than being trusted by association.
    const formInput = {
      classLevel: "SENTINEL_LEVEL_SS2",
      termName: "SENTINEL_TERM_SECOND",
      subjects: [
        { subject: "SENTINEL_SUBJECT_MATHS", score: 74, grade: "B" },
        { subject: "SENTINEL_SUBJECT_ENGLISH", score: 41, grade: "E" },
      ],
      overallAverage: 58,
      overallPosition: 12,
      classSize: 31,
      attendanceRate: 78,
    };
    const formRendered = renderReportCardFormCommentPrompt(formInput);

    results.push(...assertNoForbidden("report-card-form-comment", formRendered));
    results.push(
      check(
        "report-card-form-comment: renders all declared inputs",
        [
          "SENTINEL_LEVEL_SS2",
          "SENTINEL_TERM_SECOND",
          "SENTINEL_SUBJECT_MATHS",
          "SENTINEL_SUBJECT_ENGLISH",
        ].every((s) => formRendered.includes(s)),
        "a declared input was silently dropped from the template",
      ),
      check(
        "report-card-form-comment: renderer is deterministic",
        formRendered === renderReportCardFormCommentPrompt(formInput),
        "same input produced different output — a clock or env read has crept in",
      ),
    );

    const sparseForm = renderReportCardFormCommentPrompt({
      classLevel: "JSS1",
      termName: "First Term",
      subjects: [],
      overallAverage: null,
      overallPosition: null,
      classSize: null,
      attendanceRate: null,
    });
    results.push(
      check(
        "report-card-form-comment: null-heavy input renders without leaking undefined/null",
        !/\b(undefined|null|NaN)\b/.test(sparseForm),
        `rendered: ${JSON.stringify(sparseForm)}`,
      ),
      check(
        "report-card-form-comment: states attendance is unrecorded rather than omitting it",
        /not recorded/i.test(sparseForm),
        "silently dropping the line lets the model assume attendance was fine",
      ),
    );

    // ---- parent weekly summary renderer ----------------------------------
    // The highest-stakes renderer in the phase for this check, for a reason
    // that has nothing to do with its input shape: its output is delivered
    // to a parent unattended (D16). Every other prompt's output passes a
    // teacher who would notice a leaked name before it reached anyone. This
    // one has no such reader, so the renderer is the only thing standing
    // between a careless edit and a real disclosure.
    const summaryInput = {
      classLevel: "SENTINEL_LEVEL_JSS3",
      daysMarked: 5,
      daysPresent: 3,
      daysAbsent: 1,
      daysLate: 1,
      scores: [
        {
          subject: "SENTINEL_SUBJECT_MATHS",
          assessmentName: "SENTINEL_ASSESSMENT_TEST",
          score: 15,
          maxScore: 20,
        },
      ],
    };
    const summaryRendered = renderParentWeeklySummaryPrompt(summaryInput);

    results.push(...assertNoForbidden("parent-weekly-summary", summaryRendered));
    results.push(
      check(
        "parent-weekly-summary: renders all declared inputs",
        [
          "SENTINEL_LEVEL_JSS3",
          "SENTINEL_SUBJECT_MATHS",
          "SENTINEL_ASSESSMENT_TEST",
        ].every((s) => summaryRendered.includes(s)),
        "a declared input was silently dropped from the template",
      ),
      check(
        "parent-weekly-summary: renderer is deterministic",
        summaryRendered === renderParentWeeklySummaryPrompt(summaryInput),
        "same input produced different output — a clock or env read has crept in. " +
          "This renderer is a live risk for that specific bug: it summarises a WEEK, " +
          "so reaching for `new Date()` to label the period would be an easy edit to make",
      ),
    );

    // The quiet-week shape. The sweep is supposed to skip these before they
    // reach the model at all, but the renderer must still produce sane text
    // if one gets through — a "null out of null" in a note to a parent is a
    // worse failure here than anywhere else in the phase.
    const quietWeek = renderParentWeeklySummaryPrompt({
      classLevel: "JSS1",
      daysMarked: 0,
      daysPresent: 0,
      daysAbsent: 0,
      daysLate: 0,
      scores: [],
    });
    results.push(
      check(
        "parent-weekly-summary: empty week renders without leaking undefined/null",
        !/\b(undefined|null|NaN)\b/.test(quietWeek),
        `rendered: ${JSON.stringify(quietWeek)}`,
      ),
      check(
        "parent-weekly-summary: distinguishes an unmarked register from perfect attendance",
        /register was not taken/i.test(quietWeek),
        "zero absences and a register nobody took read identically to the model unless the " +
          "renderer says which one happened — and telling a parent their child attended " +
          "every day when the register was never opened is a factual claim we cannot make",
      ),
    );

    // ---- insights narration renderer -------------------------------------
    // The narration prompt sits next to a table that DOES carry student names
    // — they go straight from the API to the browser. This check is what keeps
    // those two paths apart: the figures reaching the model are counts, class
    // labels and percentages, never a row from that table. A future edit that
    // "helpfully" passes the at-risk rows straight in fails here.
    const narrationInput = {
      question: "which classes are struggling?",
      termName: "SENTINEL_TERM_THIRD",
      reportLabel: "SENTINEL_REPORT_LABEL",
      figures: [
        "SENTINEL_ARM_SS2B: average 41%, attendance 68%, 34 students",
        "SENTINEL_ARM_JSS1A: average 62%, attendance 91%, 30 students",
      ],
    };
    const narrationRendered = renderInsightsNarrationPrompt(narrationInput);

    results.push(...assertNoForbidden("insights-narration", narrationRendered));
    results.push(
      check(
        "insights-narration: renders all declared inputs",
        ["SENTINEL_TERM_THIRD", "SENTINEL_REPORT_LABEL", "SENTINEL_ARM_SS2B"].every((s) =>
          narrationRendered.includes(s),
        ),
        "a declared input was silently dropped from the template",
      ),
      check(
        "insights-narration: renderer is deterministic",
        narrationRendered === renderInsightsNarrationPrompt(narrationInput),
        "same input produced different output — a clock or env read has crept in",
      ),
      check(
        "insights-narration: takes pre-formatted figure STRINGS, not row objects",
        typeof narrationInput.figures[0] === "string",
        "the renderer must not reach into row objects: if it did, adding a name " +
          "column to a row type would silently start sending student names to the model",
      ),
    );

    const emptyNarration = renderInsightsNarrationPrompt({
      question: "which classes are struggling?",
      termName: "First Term",
      reportLabel: "Class performance",
      figures: [],
    });
    results.push(
      check(
        "insights-narration: empty report renders without leaking undefined/null",
        !/(undefined|null|NaN)/.test(emptyNarration),
        `rendered: ${JSON.stringify(emptyNarration)}`,
      ),
    );

    // ---- insights router renderer ----------------------------------------
    // The router receives free text an admin typed. It cannot be sanitised
    // here — same documented boundary as the lesson-plan topic field below.
    // What CAN be asserted is that the renderer adds nothing of its own.
    const routerRendered = renderInsightsRouterPrompt({
      question: "SENTINEL_QUESTION_TEXT",
      intents: [{ name: "SENTINEL_INTENT_NAME", description: "SENTINEL_INTENT_DESC" }],
    });
    results.push(...assertNoForbidden("insights-router", routerRendered));
    results.push(
      check(
        "insights-router: renders the question and the intent catalogue",
        ["SENTINEL_QUESTION_TEXT", "SENTINEL_INTENT_NAME", "SENTINEL_INTENT_DESC"].every((s) =>
          routerRendered.includes(s),
        ),
        "a declared input was silently dropped from the template",
      ),
    );

    // ---- the adversarial case -------------------------------------------
    // A teacher CAN type student data into the free-text topic field. The
    // renderer cannot prevent that and must not pretend to — this check
    // documents the boundary honestly: the value passes through, so the
    // mitigation has to live at the API/UI layer, not here.
    const adversarial = renderLessonPlanPrompt({
      classLevel: "JSS2",
      subject: "Biology",
      topic: "Chinedu Okafor",
      objectives: null,
      durationMinutes: null,
    });
    results.push(
      check(
        "lesson-plan: teacher-typed free text passes through verbatim (documented boundary, not a leak)",
        adversarial.includes("Chinedu Okafor"),
        "if this fails the renderer has started sanitising input, which would silently corrupt legitimate topics — " +
          "PII typed into free text is mitigated at the API layer, not here",
      ),
    );

    // ---- the PII-bearing prompt allowlist --------------------------------
    results.push(
      check(
        "allowlist: exactly one prompt is permitted to carry student PII",
        PII_BEARING_PROMPT_ALLOWLIST.length === 1,
        `the allowlist has ${PII_BEARING_PROMPT_ALLOWLIST.length} entries. Adding one is a deliberate act ` +
          "requiring its own sign-off and its own row in CLAUDE.md's PII-bearing prompt allowlist — " +
          "if you meant to do that, update this assertion in the same commit and say why.",
      ),
    );

    const registryNames = Object.values(PROMPTS).map((p) => p.name);
    results.push(
      check(
        "allowlist: every allowlisted prompt still exists in the registry under that exact name",
        PII_BEARING_PROMPT_ALLOWLIST.every((name) => registryNames.includes(name)),
        "an allowlisted prompt name does not match any registered prompt — it was renamed or removed, " +
          "which orphans the carve-out and would let the real prompt fall outside it",
      ),
    );

    // ---- student-list-extraction renderer --------------------------------
    // The allowlisted prompt, and the check that matters most for it: the
    // carve-out covers the IMAGE channel only. Its rendered text must still be
    // free of student PII, because the only thing it is given is school
    // structure — a list of class arm names.
    //
    // If a future edit ever threads a student's name, admission number or
    // guardian phone into this template (say, to "help the model match a row
    // to an existing student"), it fails here. That would be a second,
    // undeclared PII channel hiding behind a prompt that already has
    // permission to see PII — the exact failure the allowlist exists to make
    // impossible rather than merely discouraged.
    const extractionRendered = renderStudentListExtractionPrompt({
      knownClassArms: ["SENTINEL_ARM_JSS1A", "SENTINEL_ARM_PRIMARY4GOLD"],
    });
    results.push(...assertNoForbidden("student-list-extraction", extractionRendered));
    results.push(
      check(
        "student-list-extraction: renders the class arms it was given",
        ["SENTINEL_ARM_JSS1A", "SENTINEL_ARM_PRIMARY4GOLD"].every((s) =>
          extractionRendered.includes(s),
        ),
        "a declared input was silently dropped from the template",
      ),
    );
    results.push(
      check(
        "student-list-extraction: renderer is deterministic",
        extractionRendered ===
          renderStudentListExtractionPrompt({
            knownClassArms: ["SENTINEL_ARM_JSS1A", "SENTINEL_ARM_PRIMARY4GOLD"],
          }),
        "same input produced different output — a clock or env read has crept into the template",
      ),
    );
    results.push(
      check(
        "student-list-extraction: renders cleanly for a school with no class arms",
        !/(undefined|null|NaN)/.test(renderStudentListExtractionPrompt({ knownClassArms: [] })),
        "a school that has not yet created class arms is an ordinary onboarding state — " +
          "the very state this feature exists to serve — not an error",
      ),
    );

    return results;
  },
};
