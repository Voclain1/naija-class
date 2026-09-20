import type { LessonPlanDto } from "@school-kit/types";
import { describe, expect, it } from "vitest";

import {
  buildLessonNoteHtml,
  escapeHtml,
  lessonNoteFileName,
} from "./lesson-note-document";

function plan(overrides: Partial<LessonPlanDto> = {}): LessonPlanDto {
  return {
    id: "plan-1",
    classLevelId: "level-1",
    classLevelName: "JSS 2",
    subjectId: "subject-1",
    subjectName: "Basic Science",
    topic: "Photosynthesis",
    objectives: "Explain how plants make food.",
    durationMinutes: 40,
    status: "DRAFT",
    behaviouralObjectives: "Pupils will name the parts of a leaf.",
    instructionalMaterials: "Fresh leaves, chart",
    previousKnowledge: "Pupils know that plants are living things.",
    referenceMaterials: "NERDC Basic Science JSS2",
    mainContent: "First paragraph.\n\nSecond paragraph.",
    assessment: "Three questions.",
    homework: "Draw a leaf.",
    conclusion: "Recap.",
    quiz: null,
    groundedOn: null,
    introduction: null,
    activities: null,
    createdBy: "user-1",
    createdAt: "2026-09-20T09:00:00Z",
    updatedAt: "2026-09-20T09:00:00Z",
    ...overrides,
  } as LessonPlanDto;
}

describe("escapeHtml", () => {
  it("keeps a teacher's own words intact rather than losing them as markup", () => {
    // "x < y" in a Mathematics note would otherwise vanish as a broken tag.
    expect(escapeHtml("x < y & z > 1")).toBe("x &lt; y &amp; z &gt; 1");
    expect(escapeHtml('He said "yes"')).toContain("&quot;");
  });
});

describe("buildLessonNoteHtml", () => {
  it("is ONE document containing every written section, in teaching order", () => {
    const html = buildLessonNoteHtml(plan());
    for (const heading of [
      "Objectives",
      "Behavioural objectives",
      "Previous knowledge",
      "Instructional materials",
      "Main content",
      "Assessment",
      "Homework",
      "Conclusion",
      "References",
    ]) {
      expect(html).toContain(`<h2>${heading}</h2>`);
    }
    // Order matters: a head teacher reads it as a lesson note, not a bag of
    // sections.
    expect(html.indexOf("Objectives")).toBeLessThan(html.indexOf("Main content"));
    expect(html.indexOf("Main content")).toBeLessThan(html.indexOf("Homework"));
  });

  it("does not force a page break between sections", () => {
    // The ask was one continuous document. A page-break-before on each heading
    // would print ten near-empty pages.
    const html = buildLessonNoteHtml(plan());
    expect(html).not.toContain("page-break-before");
    expect(html).toContain("page-break-after: avoid");
  });

  it("omits sections with nothing in them instead of printing empty headings", () => {
    const html = buildLessonNoteHtml(plan({ homework: null, quiz: "  " }));
    expect(html).not.toContain("<h2>Homework</h2>");
    expect(html).not.toContain("<h2>Quiz</h2>");
  });

  it("still prints the legacy sections of an older note", () => {
    const html = buildLessonNoteHtml(
      plan({ mainContent: null, introduction: "Old intro", activities: "Old activities" }),
    );
    expect(html).toContain("<h2>Introduction</h2>");
    expect(html).toContain("<h2>Activities</h2>");
  });

  it("keeps paragraphs and single line breaks the teacher typed", () => {
    const html = buildLessonNoteHtml(plan({ mainContent: "One\n\nTwo\nstill two" }));
    expect(html).toContain("<p>One</p>");
    expect(html).toContain("Two<br />still two");
  });

  it("escapes content and the topic, including in the title", () => {
    const html = buildLessonNoteHtml(plan({ topic: "Acids & <bases>" }));
    expect(html).toContain("<title>Acids &amp; &lt;bases&gt;</title>");
    expect(html).not.toContain("<bases>");
  });

  it("carries the heading a signed note needs", () => {
    const html = buildLessonNoteHtml(plan(), {
      schoolName: "Virgo Fidelis",
      teacherName: "Mrs Adeyemi",
      preparedOn: "20 September 2026",
    });
    expect(html).toContain("Virgo Fidelis");
    expect(html).toContain("Mrs Adeyemi");
    expect(html).toContain("20 September 2026");
    expect(html).toContain("Basic Science");
    expect(html).toContain("JSS 2");
    expect(html).toContain("40 minutes");
    expect(html).toContain("signature");
  });

  it("omits the school and teacher lines when they are not known", () => {
    const html = buildLessonNoteHtml(plan());
    expect(html).not.toContain('class="school"');
  });

  it("uses system fonts, so a phone with no data still prints properly", () => {
    const html = buildLessonNoteHtml(plan());
    expect(html).not.toContain("fonts.googleapis");
    expect(html).not.toContain("@font-face");
  });
});

describe("lessonNoteFileName", () => {
  it("names the file after the subject and topic", () => {
    expect(lessonNoteFileName(plan())).toBe("Basic-Science-Photosynthesis.pdf");
  });

  it("strips anything a filesystem would object to", () => {
    const name = lessonNoteFileName(plan({ topic: "Acids / bases: an intro!" }));
    expect(name).toMatch(/^[A-Za-z0-9-]+\.pdf$/);
  });

  it("falls back rather than producing a nameless file", () => {
    expect(lessonNoteFileName(plan({ subjectName: "!!!", topic: "???" }))).toBe("lesson-note.pdf");
  });
});
