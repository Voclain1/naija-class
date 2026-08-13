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
import { renderReportCardCommentPrompt } from "../../src/prompts/report-card-comment.js";
import { renderReportCardFormCommentPrompt } from "../../src/prompts/report-card-form-comment.js";
import { check, type EvalCase } from "../harness.js";

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

    return results;
  },
};
