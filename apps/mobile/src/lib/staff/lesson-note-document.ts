import type { LessonPlanDto } from "@school-kit/types";

// The printable lesson note: ONE document, start to finish.
//
// On screen the note is split into editable sections because that is how it is
// written and saved. On paper it must be the opposite — a single continuous
// document a head teacher can read and sign, with the sections as headings in
// the flow rather than as separate boxes, cards or pages. A Nigerian lesson
// note is submitted as one sheet; handing someone ten fragments is handing
// them a form to assemble.
//
// Pure and separately tested: the HTML is built here, and the screen only
// hands it to the printer. That keeps the escaping and the "skip what is
// empty" rules checkable without a device.

export interface LessonNoteMeta {
  schoolName?: string | null;
  teacherName?: string | null;
  /** ISO date; defaults to nothing rather than to the device's clock. */
  preparedOn?: string | null;
}

interface Section {
  heading: string;
  body: string | null;
}

/**
 * Escape text for HTML.
 *
 * Teacher-written content goes into this document verbatim — a note about
 * "x < y in Mathematics" must print as typed, not vanish as a broken tag.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Keep the teacher's own line breaks; they carry the structure of a list. */
function paragraphs(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((block) => `<p>${escapeHtml(block.trim()).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

function sectionsOf(plan: LessonPlanDto): Section[] {
  return [
    { heading: "Objectives", body: plan.objectives },
    { heading: "Behavioural objectives", body: plan.behaviouralObjectives },
    { heading: "Previous knowledge", body: plan.previousKnowledge },
    { heading: "Instructional materials", body: plan.instructionalMaterials },
    { heading: "Main content", body: plan.mainContent },
    { heading: "Assessment", body: plan.assessment },
    { heading: "Homework", body: plan.homework },
    { heading: "Conclusion", body: plan.conclusion },
    { heading: "References", body: plan.referenceMaterials },
    { heading: "Quiz", body: plan.quiz },
    // Pre-v2 notes kept these two instead; they are never populated by a new
    // generation, but an older note must still print in full.
    { heading: "Introduction", body: plan.introduction },
    { heading: "Activities", body: plan.activities },
  ];
}

/** A filename a teacher can find again in their downloads. */
export function lessonNoteFileName(plan: LessonPlanDto): string {
  const safe = `${plan.subjectName}-${plan.topic}`
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${safe || "lesson-note"}.pdf`;
}

export function buildLessonNoteHtml(plan: LessonPlanDto, meta: LessonNoteMeta = {}): string {
  const written = sectionsOf(plan).filter(
    (section) => section.body !== null && section.body.trim() !== "",
  );

  const header = [
    meta.schoolName ? `<p class="school">${escapeHtml(meta.schoolName)}</p>` : "",
    `<h1>${escapeHtml(plan.topic)}</h1>`,
    `<p class="meta">${escapeHtml(plan.subjectName)} &middot; ${escapeHtml(plan.classLevelName)}${
      plan.durationMinutes ? ` &middot; ${plan.durationMinutes} minutes` : ""
    }</p>`,
    meta.teacherName || meta.preparedOn
      ? `<p class="meta">${[
          meta.teacherName ? escapeHtml(meta.teacherName) : "",
          meta.preparedOn ? escapeHtml(meta.preparedOn) : "",
        ]
          .filter(Boolean)
          .join(" &middot; ")}</p>`
      : "",
  ].join("");

  const body = written
    .map((section) => `<h2>${escapeHtml(section.heading)}</h2>${paragraphs(section.body!)}`)
    .join("");

  // A signature line, because this is a document a head teacher signs.
  const footer =
    '<div class="sign"><p>Teacher&rsquo;s signature: ______________________</p>' +
    "<p>Head teacher&rsquo;s signature: ______________________</p></div>";

  // Fonts are the system's: a print stylesheet that reaches for a web font
  // fails quietly on a phone with no data and prints in something arbitrary.
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(plan.topic)}</title>
<style>
  @page { margin: 18mm 15mm; }
  body { font-family: Georgia, "Times New Roman", serif; color: #13262E; line-height: 1.5; font-size: 12pt; }
  .school { font-size: 10pt; letter-spacing: 0.08em; text-transform: uppercase; color: #5B6B72; margin: 0 0 4pt; }
  h1 { font-size: 18pt; margin: 0 0 4pt; }
  h2 { font-size: 12pt; margin: 14pt 0 4pt; color: #0E5C43; }
  .meta { font-size: 10pt; color: #5B6B72; margin: 0 0 2pt; }
  p { margin: 0 0 8pt; }
  /* One continuous document: no page break is forced between sections, and a
     heading never prints alone at the foot of a page. */
  h2 { page-break-after: avoid; break-after: avoid; }
  .sign { margin-top: 24pt; font-size: 11pt; }
</style></head>
<body>${header}${body}${footer}</body></html>`;
}
