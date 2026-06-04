import type { ReportCardRenderData } from "@school-kit/types";

// ---------------------------------------------------------------------------
// Report-card HTML template (Phase 2 / Slice 5 cp2).
//
// HAND-ROLLED, not React. This module produces a single self-contained HTML
// string that Puppeteer renders to PDF. There is NO browser runtime here, no
// hydration, no client JS — just string assembly. The reasons we did NOT reach
// for React/JSX:
//   1. The render worker runs in the API process. Pulling React + a JSX
//      transform into the API build for one static document is dead weight.
//   2. A typed function over ReportCardRenderData is trivially unit-testable
//      (no DOM, no renderer) and the 40-card memory budget cares about every
//      avoidable allocation.
//
// SECURITY — the load-bearing rule of this file: EVERY interpolation of a
// user-controlled value MUST go through esc(). Student names, school name,
// teacher comments, subject names — all of it originates from tenant data and
// could contain `<`, `>`, `&`, quotes, or a full `<script>` payload. esc() is
// the single XSS boundary. If you add a field to the template and interpolate
// it raw, you have opened an injection hole. There is a unit test that feeds a
// `<script>` payload through every field and asserts it comes out inert.
// ---------------------------------------------------------------------------

// Escape the five characters that are dangerous in HTML text/attribute context.
// `&` MUST be replaced first, otherwise we double-escape the entities we emit
// for the other four. null/undefined collapse to the empty string so callers
// can pass nullable fields directly. esc(esc(x)) !== esc(x) is INTENTIONAL —
// esc is not idempotent (it re-escapes the `&` in `&lt;`); never double-apply.
export function esc(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Int-hundredths → fixed 2dp string. 7350 → "73.50". Mirrors the kobo rule:
// the value is stored as an integer count of hundredths; we only divide at the
// display layer. null → "—".
function formatHundredths(value: number | null): string {
  if (value === null) return "—";
  const whole = Math.trunc(value / 100);
  const frac = Math.abs(value % 100).toString().padStart(2, "0");
  return `${whole}.${frac}`;
}

function formatInt(value: number | null): string {
  return value === null ? "—" : String(value);
}

function formatOrdinal(value: number | null): string {
  if (value === null) return "—";
  const mod100 = value % 100;
  const mod10 = value % 10;
  const suffix =
    mod100 >= 11 && mod100 <= 13 ? "th" : mod10 === 1 ? "st" : mod10 === 2 ? "nd" : mod10 === 3 ? "rd" : "th";
  return `${value}${suffix}`;
}

// Calendar date → "DD Mon YYYY". Accepts Date or ISO string. Parsing happens on
// the worker, never in the template's hot path concern — but we keep it defensive
// (an unparseable string falls back to the raw, escaped, value upstream).
function formatDate(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(d.getUTCDate()).padStart(2, "0")} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function fullName(student: ReportCardRenderData["student"]): string {
  return [student.firstName, student.middleName, student.lastName].filter(Boolean).join(" ");
}

// Assemble the complete HTML document. Pure function of the input data.
export function renderReportCardHtml(data: ReportCardRenderData): string {
  const { school, academicYear, term, classArm, student, rollup, subjects } = data;

  const subjectRows = subjects
    .map((s) => {
      const components = s.components
        .map((c) => `<td class="num">${esc(formatInt(c.score))}</td>`)
        .join("");
      return `
        <tr>
          <td class="subject">${esc(s.subjectName)}</td>
          ${components}
          <td class="num total">${esc(formatInt(s.totalScore))}</td>
          <td class="grade">${esc(s.letterGrade)}</td>
          <td class="pos">${esc(formatOrdinal(s.subjectPosition))}</td>
          <td class="remark">${esc(s.remark)}</td>
          <td class="remark">${esc(s.subjectComment)}</td>
        </tr>`;
    })
    .join("");

  // Component column headers are taken from the first subject's components so
  // the grid header matches the data (CA1/CA2/Exam labels vary per school).
  const componentHeaders = (subjects[0]?.components ?? [])
    .map((c) => `<th class="num">${esc(c.label)}</th>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Report Card — ${esc(fullName(student))}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Arial, sans-serif; color: #1a1a1a; margin: 0; padding: 24px 28px; font-size: 12px; }
  .header { display: flex; align-items: center; border-bottom: 3px solid #14532d; padding-bottom: 12px; margin-bottom: 16px; }
  .header .logo { width: 64px; height: 64px; object-fit: contain; margin-right: 16px; }
  .header .school-name { font-size: 20px; font-weight: 700; color: #14532d; margin: 0; }
  .header .motto { font-style: italic; color: #555; margin: 2px 0 0; font-size: 11px; }
  .doc-title { text-align: center; font-size: 14px; font-weight: 700; letter-spacing: 1px; margin: 8px 0 16px; text-transform: uppercase; }
  .bio { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px 16px; margin-bottom: 16px; }
  .bio div { padding: 3px 0; }
  .bio .label { color: #666; font-size: 10px; text-transform: uppercase; }
  .bio .value { font-weight: 600; }
  table.grades { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
  table.grades th, table.grades td { border: 1px solid #cbd5e1; padding: 5px 6px; text-align: left; }
  table.grades th { background: #14532d; color: #fff; font-size: 10px; text-transform: uppercase; }
  table.grades td.num, table.grades th.num { text-align: center; }
  table.grades td.total { font-weight: 700; }
  table.grades td.grade, table.grades td.pos { text-align: center; }
  .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 18px; }
  .summary .box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; }
  .summary .box .label { color: #666; font-size: 10px; text-transform: uppercase; }
  .summary .box .value { font-size: 18px; font-weight: 700; color: #14532d; }
  .comments { margin-bottom: 8px; }
  .comments .block { margin-bottom: 10px; }
  .comments .block .label { font-weight: 700; font-size: 11px; text-transform: uppercase; color: #14532d; }
  .comments .block .body { border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px 8px; min-height: 28px; white-space: pre-wrap; }
  .footer { margin-top: 24px; display: flex; justify-content: space-between; font-size: 10px; color: #888; }
</style>
</head>
<body>
  <div class="header">
    ${school.logoUrl ? `<img class="logo" src="${esc(school.logoUrl)}" alt="" />` : ""}
    <div>
      <h1 class="school-name">${esc(school.name)}</h1>
      ${school.motto ? `<p class="motto">${esc(school.motto)}</p>` : ""}
    </div>
  </div>

  <div class="doc-title">Terminal Report — ${esc(term.name)}, ${esc(academicYear.label)}</div>

  <div class="bio">
    <div><div class="label">Student</div><div class="value">${esc(fullName(student))}</div></div>
    <div><div class="label">Admission No.</div><div class="value">${esc(student.admissionNumber)}</div></div>
    <div><div class="label">Class</div><div class="value">${esc(classArm.name)}</div></div>
    <div><div class="label">Gender</div><div class="value">${esc(student.gender)}</div></div>
    <div><div class="label">Date of Birth</div><div class="value">${esc(formatDate(student.dateOfBirth))}</div></div>
    <div><div class="label">Term Duration</div><div class="value">${esc(formatDate(term.startDate))} – ${esc(formatDate(term.endDate))}</div></div>
  </div>

  <table class="grades">
    <thead>
      <tr>
        <th>Subject</th>
        ${componentHeaders}
        <th class="num">Total</th>
        <th>Grade</th>
        <th>Pos.</th>
        <th>Remark</th>
        <th>Teacher's Comment</th>
      </tr>
    </thead>
    <tbody>
      ${subjectRows}
    </tbody>
  </table>

  <div class="summary">
    <div class="box"><div class="label">Subjects</div><div class="value">${esc(formatInt(rollup.subjectsCount))}</div></div>
    <div class="box"><div class="label">Total Score</div><div class="value">${esc(formatInt(rollup.overallTotal))}</div></div>
    <div class="box"><div class="label">Average</div><div class="value">${esc(formatHundredths(rollup.overallAverage))}%</div></div>
    <div class="box"><div class="label">Position in Class</div><div class="value">${esc(formatOrdinal(rollup.overallPosition))}</div></div>
  </div>

  <div class="comments">
    <div class="block">
      <div class="label">Form Teacher's Comment</div>
      <div class="body">${esc(rollup.formTeacherComment)}</div>
    </div>
    <div class="block">
      <div class="label">Principal's Remark</div>
      <div class="body">${esc(rollup.principalNote)}</div>
    </div>
  </div>

  <div class="footer">
    <span>${esc(school.name)}</span>
    <span>This is a computer-generated report card.</span>
  </div>
</body>
</html>`;
}
