import * as docx from "docx";
import { describe, expect, it } from "vitest";

import type { ExamPaperExportDto } from "@school-kit/types";

import { buildPaperDocx, paperCsv, paperFilename, paperPrintHtml } from "./paper-export";

// Phase 8c / CP5c — what a printed paper and its marking scheme contain.

const data: ExamPaperExportDto = {
  version: "B",
  versionCount: 2,
  schoolName: "St <Mary's> College",
  title: "First Term Examination",
  subjectName: "Physics",
  classLevelName: "SS 1",
  termName: "First Term",
  academicYearLabel: "2026/2027",
  durationMinutes: 90,
  instructions: "Answer all questions in Section A.",
  totalMarks: 11,
  sections: [
    {
      title: "Section A — Objectives",
      instructions: "Choose the correct option.",
      marks: 1,
      questions: [
        {
          number: 1,
          type: "MULTIPLE_CHOICE",
          text: "Which is a vector?",
          marks: 1,
          options: [
            { letter: "A", text: "Mass" },
            { letter: "B", text: "Speed" },
            { letter: "C", text: "Displacement" },
            { letter: "D", text: "Time" },
          ],
          correctLetter: "C",
          answerGuide: null,
        },
      ],
    },
    {
      title: "Section B — Theory",
      instructions: null,
      marks: 10,
      questions: [
        { number: 2, type: "THEORY", text: "Derive v = u + at.", marks: 10, options: [], correctLetter: null, answerGuide: "Acceleration is rate of change of velocity." },
      ],
    },
  ],
};

describe("exam paper exports", () => {
  it("the paper shows questions and options but never the answers; the scheme shows the answers", () => {
    const paper = paperPrintHtml(data, "paper");
    expect(paper).toContain("St &lt;Mary&#39;s&gt; College"); // escaped tenant data
    expect(paper).toContain("Version B");
    expect(paper).toContain("C. Displacement");
    expect(paper).toContain("Total: 11 marks");
    expect(paper).not.toContain("Acceleration is rate of change");
    expect(paper).not.toMatch(/class="key"/);

    const scheme = paperPrintHtml(data, "scheme");
    expect(scheme).toContain("Marking scheme — Version B");
    expect(scheme).toMatch(/<span class="key">C<\/span>/);
    expect(scheme).toContain("Acceleration is rate of change of velocity.");
    expect(scheme).not.toContain("Name: ____");
  });

  it("a single-version paper is not labelled with a version", () => {
    const single = paperPrintHtml({ ...data, version: "A", versionCount: 1 }, "paper");
    expect(single).not.toContain("Version A");
    expect(paperFilename({ ...data, versionCount: 1 }, "paper", "docx")).toBe("ss-1-physics-first-term-examination.docx");
    expect(paperFilename(data, "scheme", "csv")).toBe("ss-1-physics-first-term-examination-marking-scheme-version-b.csv");
  });

  it("CSV: one row per question, in this version's option order, with the key", () => {
    const lines = paperCsv(data).trim().split(/\r?\n/);
    expect(lines[0]).toBe("Version,Section,Number,Type,Question,Option A,Option B,Option C,Option D,Option E,Correct answer,Marks,Marking guide");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("B,Section A — Objectives,1,MULTIPLE_CHOICE,Which is a vector?,Mass,Speed,Displacement,Time,,C,1,");
  });

  it("builds a real Word document for the paper and the scheme", async () => {
    for (const kind of ["paper", "scheme"] as const) {
      const buffer = await docx.Packer.toBuffer(buildPaperDocx(docx, data, kind));
      expect(buffer.subarray(0, 2).toString()).toBe("PK"); // a .docx is a zip
      expect(buffer.length).toBeGreaterThan(2000);
    }
  });
});
