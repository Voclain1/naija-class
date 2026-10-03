import type { ExamPaperExportDto, ExamPaperExportQuestion } from "@school-kit/types";

import { rowsToCsv } from "../csv-export";

// Phase 8c / CP5c — the three forms a FINAL paper leaves the system in (D63):
// a print page (saved as PDF from the browser, as receipts and PIN cards
// are), a Word document, and a CSV. Each is built from ONE version's export
// data, so a paper and its marking scheme always agree on the letters.
// Pure (the Word builder takes the docx module as an argument), so what goes
// on a paper is specified by a test.

export type PaperDocumentKind = "paper" | "scheme";

const versionLabel = (data: ExamPaperExportDto) => (data.versionCount > 1 ? `Version ${data.version}` : "");

export function paperFilename(data: ExamPaperExportDto, kind: PaperDocumentKind, ext: "html" | "docx" | "csv"): string {
  const slug = `${data.classLevelName}-${data.subjectName}-${data.title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const version = data.versionCount > 1 ? `-version-${data.version.toLowerCase()}` : "";
  return `${slug}${kind === "scheme" ? "-marking-scheme" : ""}${version}.${ext}`;
}

/** One row per question, in this version's option order. */
export function paperCsv(data: ExamPaperExportDto): string {
  const rows = data.sections.flatMap((s) => s.questions.map((q) => ({ section: s.title, q })));
  const option = (q: ExamPaperExportQuestion, i: number) => q.options[i]?.text ?? "";
  return rowsToCsv(rows, [
    { header: "Version", accessor: () => data.version },
    { header: "Section", accessor: (r) => r.section },
    { header: "Number", accessor: (r) => r.q.number },
    { header: "Type", accessor: (r) => r.q.type },
    { header: "Question", accessor: (r) => r.q.text },
    { header: "Option A", accessor: (r) => option(r.q, 0) },
    { header: "Option B", accessor: (r) => option(r.q, 1) },
    { header: "Option C", accessor: (r) => option(r.q, 2) },
    { header: "Option D", accessor: (r) => option(r.q, 3) },
    { header: "Option E", accessor: (r) => option(r.q, 4) },
    { header: "Correct answer", accessor: (r) => r.q.correctLetter ?? "" },
    { header: "Marks", accessor: (r) => r.q.marks },
    { header: "Marking guide", accessor: (r) => r.q.answerGuide ?? "" },
  ]);
}

function esc(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const marksText = (n: number) => `${n} mark${n === 1 ? "" : "s"}`;

/**
 * A self-contained page for the school's printer, opened in a new tab where
 * "Print / save as PDF" makes the PDF. Every interpolated value is escaped —
 * all of it is tenant data. No accent borders (CLAUDE.md): sections are set
 * apart by space and headings only.
 */
export function paperPrintHtml(data: ExamPaperExportDto, kind: PaperDocumentKind): string {
  const version = versionLabel(data);
  const heading = kind === "scheme" ? `Marking scheme${version ? ` — ${version}` : ""}` : version;
  const body = data.sections
    .map((section) => {
      const questions = section.questions
        .map((q) => (kind === "paper" ? questionHtml(q) : schemeHtml(q)))
        .join("");
      return `
    <section>
      <h2>${esc(section.title)} <span class="muted">(${esc(marksText(section.marks))})</span></h2>
      ${kind === "paper" && section.instructions ? `<p class="instructions">${esc(section.instructions)}</p>` : ""}
      <ol class="questions">${questions}</ol>
    </section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(data.title)}${heading ? ` — ${esc(heading)}` : ""}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Times New Roman", Georgia, serif; color: #111; margin: 0; padding: 24px; font-size: 13pt; line-height: 1.45; }
  header { text-align: center; margin-bottom: 20px; }
  header .school { font-size: 16pt; font-weight: bold; text-transform: uppercase; }
  header .title { font-size: 14pt; font-weight: bold; margin-top: 4px; }
  header .meta { margin-top: 6px; }
  header .version { margin-top: 6px; font-weight: bold; }
  .candidate { display: flex; gap: 24px; margin: 12px 0 18px; }
  .candidate span { flex: 1; }
  .general { background: #f3f3f3; padding: 8px 12px; margin-bottom: 18px; white-space: pre-wrap; }
  h2 { font-size: 13pt; margin: 22px 0 6px; }
  .muted { font-weight: normal; color: #444; }
  .instructions { font-style: italic; margin: 0 0 8px; white-space: pre-wrap; }
  ol.questions { padding-left: 0; list-style: none; margin: 0; }
  li.q { margin: 0 0 12px; break-inside: avoid; }
  .qtext { white-space: pre-wrap; }
  .num { font-weight: bold; margin-right: 6px; }
  .qmarks { color: #444; font-size: 11pt; }
  .options { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 24px; margin: 4px 0 0 24px; }
  .answer-space { height: 72px; }
  .key { font-weight: bold; }
  .guide { white-space: pre-wrap; margin: 2px 0 0 24px; }
  .actions { margin-top: 24px; text-align: center; }
  @media print { .actions { display: none; } body { padding: 0; } }
</style>
</head>
<body>
<header>
  <div class="school">${esc(data.schoolName)}</div>
  <div class="title">${esc(data.title)}</div>
  <div class="meta">${esc(data.classLevelName)} · ${esc(data.subjectName)} · ${esc(data.termName)} ${esc(data.academicYearLabel)}</div>
  <div class="meta">Time allowed: ${esc(data.durationMinutes)} minutes · Total: ${esc(marksText(data.totalMarks))}</div>
  ${heading ? `<div class="version">${esc(heading)}</div>` : ""}
</header>
${kind === "paper" ? `<div class="candidate"><span>Name: ______________________________</span><span>Admission no: ____________</span></div>` : ""}
${kind === "paper" && data.instructions ? `<div class="general">${esc(data.instructions)}</div>` : ""}
${body}
<div class="actions"><button type="button" onclick="window.print()">Print or save as PDF</button></div>
</body>
</html>`;
}

function questionHtml(q: ExamPaperExportQuestion): string {
  const options = q.options.length
    ? `<div class="options">${q.options.map((o) => `<div>${esc(o.letter)}. ${esc(o.text)}</div>`).join("")}</div>`
    : `<div class="answer-space"></div>`;
  return `<li class="q"><span class="num">${q.number}.</span><span class="qtext">${esc(q.text)}</span> <span class="qmarks">(${esc(marksText(q.marks))})</span>${options}</li>`;
}

function schemeHtml(q: ExamPaperExportQuestion): string {
  const key = q.correctLetter
    ? `<span class="key">${esc(q.correctLetter)}</span>${q.answerGuide ? ` — ${esc(q.answerGuide)}` : ""}`
    : `<div class="guide">${esc(q.answerGuide ?? "")}</div>`;
  return `<li class="q"><span class="num">${q.number}.</span> ${key} <span class="qmarks">(${esc(marksText(q.marks))})</span></li>`;
}

/**
 * The same document as a Word file, for a school that wants to edit or
 * typeset it. `docx` is passed in (the module) so the page can load it only
 * when a teacher clicks Export, and the spec can build the document directly.
 */
export function buildPaperDocx(docx: typeof import("docx"), data: ExamPaperExportDto, kind: PaperDocumentKind) {
  const { AlignmentType, Document, HeadingLevel, Paragraph, TextRun } = docx;
  const version = versionLabel(data);
  const heading = kind === "scheme" ? `Marking scheme${version ? ` — ${version}` : ""}` : version;
  const centred = (text: string, bold = false, size?: number) =>
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text, bold, size })] });

  const children = [
    centred(data.schoolName.toUpperCase(), true, 30),
    centred(data.title, true, 28),
    centred(`${data.classLevelName} · ${data.subjectName} · ${data.termName} ${data.academicYearLabel}`),
    centred(`Time allowed: ${data.durationMinutes} minutes · Total: ${marksText(data.totalMarks)}`),
    ...(heading ? [centred(heading, true)] : []),
    new Paragraph({ text: "" }),
  ];
  if (kind === "paper") {
    children.push(new Paragraph({ text: "Name: ______________________________    Admission no: ____________" }));
    if (data.instructions) children.push(new Paragraph({ children: [new TextRun({ text: data.instructions, italics: true })] }));
  }

  for (const section of data.sections) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, text: `${section.title} (${marksText(section.marks)})` }));
    if (kind === "paper" && section.instructions) {
      children.push(new Paragraph({ children: [new TextRun({ text: section.instructions, italics: true })] }));
    }
    for (const q of section.questions) {
      if (kind === "paper") {
        children.push(
          new Paragraph({
            spacing: { before: 160 },
            children: [new TextRun({ text: `${q.number}. `, bold: true }), new TextRun(q.text), new TextRun(` (${marksText(q.marks)})`)],
          }),
        );
        for (const o of q.options) children.push(new Paragraph({ indent: { left: 400 }, text: `${o.letter}. ${o.text}` }));
        if (q.options.length === 0) children.push(new Paragraph({ text: "" }), new Paragraph({ text: "" }));
      } else {
        const answer = q.correctLetter ? `${q.correctLetter}${q.answerGuide ? ` — ${q.answerGuide}` : ""}` : (q.answerGuide ?? "");
        children.push(
          new Paragraph({
            spacing: { before: 120 },
            children: [new TextRun({ text: `${q.number}. `, bold: true }), new TextRun(answer), new TextRun(` (${marksText(q.marks)})`)],
          }),
        );
      }
    }
  }

  return new Document({
    creator: data.schoolName,
    title: `${data.title}${heading ? ` — ${heading}` : ""}`,
    styles: { default: { document: { run: { font: "Times New Roman", size: 24 } } } },
    sections: [{ children }],
  });
}
