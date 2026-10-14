import type { ExamPaperExportDto, ExamPaperExportQuestion } from "@school-kit/types";

// A FINAL exam paper leaving the phone (docs/modules/phase-8.md §22.3, D63) —
// the website's apps/web/src/lib/exam-papers/paper-export.ts, for the share
// sheet and the system print dialog. Each form is built from ONE version's
// export data, fetched fresh from the API (which audits every export), so a
// paper and its marking scheme always agree on the letters.
//
// Two forms on the phone: the print page (printed, or made into a PDF by
// expo-print) and the CSV. The website's Word file is not offered here: it is
// built with the `docx` library, which the app does not carry. Pure, so what
// goes on a paper is specified by a test.

export type PaperDocumentKind = "paper" | "scheme";

const versionLabel = (data: ExamPaperExportDto) => (data.versionCount > 1 ? `Version ${data.version}` : "");

export function paperFilename(data: ExamPaperExportDto, kind: PaperDocumentKind, ext: "pdf" | "csv"): string {
  const slug = `${data.classLevelName}-${data.subjectName}-${data.title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const version = data.versionCount > 1 ? `-version-${data.version.toLowerCase()}` : "";
  return `${slug}${kind === "scheme" ? "-marking-scheme" : ""}${version}.${ext}`;
}

/** What the share sheet and print dialog call a document: "Marking scheme — Version B". */
export function paperDocumentTitle(data: ExamPaperExportDto, kind: PaperDocumentKind): string {
  const version = versionLabel(data);
  const what = kind === "scheme" ? "Marking scheme" : "Question paper";
  return `${data.title}: ${what}${version ? ` — ${version}` : ""}`;
}

interface CsvColumn<T> {
  header: string;
  accessor: (row: T) => string | number | null | undefined;
}

function escapeCsvCell(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  return /[",\r\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function rowsToCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => escapeCsvCell(c.header)).join(",");
  const lines = rows.map((row) => columns.map((c) => escapeCsvCell(c.accessor(row))).join(","));
  return [head, ...lines].join("\r\n");
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
 * A self-contained page for expo-print: the system print dialog, or a PDF for
 * the share sheet. The website's page, less its "Print or save as PDF"
 * button — expo-print opens its own dialog, and a button would print onto the
 * paper. No script of any kind. Every interpolated value is escaped — all of
 * it is tenant data. No accent borders (CLAUDE.md): sections are set apart by
 * space and headings only.
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
  @media print { body { padding: 0; } }
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
