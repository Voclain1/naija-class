import { AFFECTIVE_TRAITS, PSYCHOMOTOR_SKILLS, REPORT_RATING_KEY, readReportProfile, readReportCardDesign, PROMOTION_STATUS_LABELS, type ReportCardRenderData } from "@school-kit/types";

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

/** The colour of an unbranded card: SchoolKit's Deep Emerald. */
export const SCHOOLKIT_CARD_COLOR = "#0E5C43";
/** A branded card with no usable colour of its own keeps the card's original green. */
const DEFAULT_SCHOOL_CARD_COLOR = "#14532d";

/** The school's colour if it is a plain #rrggbb value; anything else could break out of the CSS. */
export function reportCardBrandColor(value: string | null): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : DEFAULT_SCHOOL_CARD_COLOR;
}

// Assemble the complete HTML document. Pure function of the input data.
export function renderReportCardHtml(data: ReportCardRenderData): string {
  const { school, academicYear, term, classArm, student, rollup, subjects } = data;
  // Plans (plans.md D5): a branded card carries the school's logo and colour;
  // otherwise it is SchoolKit's template, in SchoolKit's colour, with a
  // SchoolKit footer. The school's name is on every card either way.
  const design = school.branded ? readReportCardDesign(school.design) : readReportCardDesign(null);
  const brand = school.branded ? reportCardBrandColor(school.design?.color ?? school.primaryColor) : SCHOOLKIT_CARD_COLOR;
  // Keep custom light colours legible on paper and in table headings.
  const channels = [1, 3, 5].map((offset) => {
    const c = Number.parseInt(brand.slice(offset, offset + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
  const ink = luminance > 0.179 ? "#13262e" : brand;
  const headerInk = luminance > 0.179 ? "#13262e" : "#ffffff";
  const profile = readReportProfile(data.profile);
  const safeImage = (uri: string | null | undefined) => uri && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(uri) ? uri : null;
  const logo = safeImage(school.logoDataUri);
  const photo = safeImage(student.photoDataUri);
  const contact = [school.address, school.phone, school.email].filter(Boolean).map(esc).join(" · ");
  const ratingTable = (heading: string, traits: readonly string[], values: Record<string, number | null>) => `<section class="rating-panel"><h2>${esc(heading)}</h2><table class="ratings"><thead><tr><th>Observation</th><th>Rating / 5</th></tr></thead><tbody>${traits.map((trait) => `<tr><td>${esc(trait)}</td><td>${esc(values[trait] ?? "Not recorded")}</td></tr>`).join("")}</tbody></table></section>`;
  const profileHtml = `<div class="domain-grid">${ratingTable("Character and attitude (affective)", AFFECTIVE_TRAITS, profile.affective)}${ratingTable("Practical skills (psychomotor)", PSYCHOMOTOR_SKILLS, profile.psychomotor)}</div><p class="rating-key">${esc(REPORT_RATING_KEY)}. Unrated observations are not scored.</p>`;
  const customHtml = school.branded && profile.customFields.length ? `<section class="additional"><h2>Additional school information</h2>${profile.customFields.map((f) => `<p><strong>${esc(f.label)}:</strong> ${esc(f.value || "Not recorded")}</p>`).join("")}</section>` : "";
  const gradeKeyHtml = data.gradeKey?.length ? `<p class="grade-key"><strong>Grading key:</strong> ${data.gradeKey.map((g) => `${esc(g.letter)} ${esc(g.minScore)}–${esc(g.maxScore)}${g.remark ? ` (${esc(g.remark)})` : ""}`).join(" · ")}</p>` : "";
  // Phase 8 / CP6a (D51): the school decides whether paper carries rank. Off
  // means the box and the column are GONE — a dash would read as "missing".
  const showPosition = school.positionOnReportCardPdf;
  // Phase 8c / CP5a (§22.1): the year so far, on the final term's card only.
  const cumulative = rollup.cumulative;

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
          ${showPosition ? `<td class="pos">${esc(formatOrdinal(s.subjectPosition))}</td>` : ""}
          ${cumulative ? `<td class="num">${esc(formatHundredths(s.cumulativeAverage))}</td>` : ""}
          <td class="remark">${esc(s.remark)}</td>
          <td class="remark">${esc(s.subjectComment)}</td>
        </tr>`;
    })
    .join("");

  // Component column headers are taken from the first subject's components so
  // the grid header matches the data (CA1/CA2/Exam labels vary per school).
  const summaryBoxes = [
    ["Subjects", formatInt(rollup.subjectsCount)],
    ...(data.classSize !== undefined ? [["Students in Class", formatInt(data.classSize)]] : []),
    ["Total Score", formatInt(rollup.overallTotal)],
    ["Average", rollup.overallAverage === null ? "Not recorded" : `${formatHundredths(rollup.overallAverage)}%`],
    ...(showPosition ? [["Position in Class", formatOrdinal(rollup.overallPosition)]] : []),
    // CP6a (§20.2): present out of the days the arm was marked. No record → no
    // box at all; "0 of 0" would read as a child who never came.
    ...(rollup.attendance
      ? [["Attendance", `${rollup.attendance.present} of ${rollup.attendance.daysOpened} days`]]
      : []),
    // CP5a (D61): averaged over the terms the student HAS — the label says how
    // many, so a mid-year admission's figure is never misread.
    ...(cumulative
      ? [[`Cumulative Average (${cumulative.terms} term${cumulative.terms === 1 ? "" : "s"})`, `${formatHundredths(cumulative.average)}%`]]
      : []),
    ...(cumulative && showPosition && cumulative.position !== null
      ? [["Cumulative Position", formatOrdinal(cumulative.position)]]
      : []),
  ]
    .map(([label, value]) => `<div class="box"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div></div>`)
    .join("");
  const summaryColumns =
    3 + (data.classSize !== undefined ? 1 : 0) +
    (showPosition ? 1 : 0) +
    (rollup.attendance ? 1 : 0) +
    (cumulative ? 1 : 0) +
    (cumulative && showPosition && cumulative.position !== null ? 1 : 0);

  const attendanceNote = rollup.attendance
    ? `<div class="attendance-note">School opened ${esc(rollup.attendance.daysOpened)} days this term. Present ${esc(
        rollup.attendance.present,
      )}, absent ${esc(rollup.attendance.absent)}.</div>`
    : "";

  // CP6a (§20.3): the end-of-year decision, final term only. A tinted block,
  // never an accent border (CLAUDE.md), and the decision said in words.
  const promotion = rollup.promotionStatus
    ? `<div class="promotion"><span class="label">Promotion status</span> <span class="value">${esc(
        PROMOTION_STATUS_LABELS[rollup.promotionStatus],
      )}</span></div>`
    : "";

  const componentHeaders = (subjects[0]?.components ?? [])
    .map((c) => `<th class="num">${esc(c.label)}${c.maxScore !== undefined ? `<br /><span class="maximum">/${esc(c.maxScore)}</span>` : ""}</th>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Report Card — ${esc(fullName(student))}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: ${design.font === "serif" ? 'Georgia, "Times New Roman", serif' : '"Helvetica Neue", Arial, sans-serif'}; color: #1a1a1a; margin: 0; padding: 0; font-size: 10px; }
  .header { display: flex; gap: 14px; align-items: center; border: 0; border-bottom: 1px solid #cbd5e1; padding: 10px; margin-bottom: 10px; }
  .header .logo { width: 64px; height: 64px; flex-shrink: 0; object-fit: contain; }
  .school-identity { flex: 1; min-width: 0; text-align: center; }
  .header .school-name { font-size: 26px; line-height: 1.12; font-weight: 800; text-transform: uppercase; overflow-wrap: anywhere; color: ${ink}; margin: 0; }
  .header .motto { font-style: italic; color: #555; margin: 2px 0 0; font-size: 11px; }
  .doc-title { text-align: center; font-size: 14px; font-weight: 700; letter-spacing: 1px; margin: 8px 0 10px; text-transform: uppercase; }
  .bio { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px 16px; margin-bottom: 10px; }
  .bio div { padding: 3px 0; }
  .bio .label { color: #666; font-size: 10px; text-transform: uppercase; }
  .bio .value { font-weight: 600; }
  table.grades { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  table.grades th, table.grades td { border: 1px solid #cbd5e1; padding: 4px 5px; text-align: left; }
  table.grades th { background: ${brand}; color: ${headerInk}; font-size: 10px; text-transform: uppercase; }
  table.grades td.num, table.grades th.num { text-align: center; }
  table.grades td.total { font-weight: 700; }
  table.grades td.grade, table.grades td.pos { text-align: center; }
  .summary { display: grid; gap: 4px; margin-bottom: 6px; }
  .summary .box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px 8px; }
  .summary .box .label { color: #666; font-size: 10px; text-transform: uppercase; }
  .summary .box .value { font-size: 14px; font-weight: 700; color: ${ink}; }
  .attendance-note { font-size: 10px; color: #555; margin-bottom: 14px; }
  .promotion { background: #ecfdf5; border-radius: 6px; padding: 6px 8px; margin-bottom: 14px; }
  .promotion .label { font-size: 10px; text-transform: uppercase; color: #555; margin-right: 8px; }
  .promotion .value { font-size: 14px; font-weight: 700; color: ${ink}; }
  .comments { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 6px 0; }
  .comments .block { margin-bottom: 10px; }
  .comments .block .label { font-weight: 700; font-size: 11px; text-transform: uppercase; color: ${ink}; }
  .comments .block .body { border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px 8px; min-height: 28px; white-space: pre-wrap; }
  h2 { font-size: 11px; color: ${ink}; margin: 0 0 6px; }
  .domain-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 10px 0 6px; }
  .ratings { width: 100%; border-collapse: collapse; font-size: 10px; }
  .ratings td, .ratings th { border: 1px solid #d5ddd8; padding: 3px 5px; text-align: left; }
  .ratings th { background: #f2f5f3; }
  .rating-key, .grade-key { font-size: 9px; line-height: 1.5; }
  .contact { font-size: 10px; margin: 5px 0 0; }
  .passport { width: 58px; height: 72px; object-fit: cover; border: 1px solid #d5ddd8; border-radius: 4px; margin-left: auto; }
  .closing { break-inside: avoid; }
  .signature-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 8px; }
  .signature { border: 1px solid #d5ddd8; padding: 7px; border-radius: 6px; font-size: 10px; line-height: 1.6; }
  .dates { font-size: 10px; margin: 5px 0; }
  .watermark { position: fixed; top: 42%; left: 10%; right: 10%; text-align: center; font-size: 44px; opacity: .07; transform: rotate(-25deg); z-index: -1; overflow-wrap: anywhere; }
  .additional { border: 1px solid #d5ddd8; padding: 6px 8px; margin-top: 6px; font-size: 10px; break-inside: avoid; }
  .additional p { margin: 3px 0; }
  .template-classic .header { text-align: center; }
  .template-classic .school-name { font-family: Georgia, "Times New Roman", serif; }
  .template-compact table.grades th, .template-compact table.grades td { padding: 3px 4px; font-size: 10px; }
  .template-compact .bio { margin-bottom: 8px; }
  .template-compact .summary .box { padding: 6px; }
  thead { display: table-header-group; }
  tr, .rating-panel, .comments .block, .signature-grid, .promotion { break-inside: avoid; }
  td, .comments .body, .additional { overflow-wrap: anywhere; }
  .summary { grid-template-columns: repeat(4, minmax(0, 1fr)) !important; }
  .footer { margin-top: 4px; display: flex; justify-content: space-between; font-size: 10px; color: #888; }
</style>
</head>
<body class="template-${design.template}">
  ${school.branded && design.watermark ? `<div class="watermark">${esc(design.watermark)}</div>` : ""}
  <div class="header">
    ${logo ? `<img class="logo" src="${esc(logo)}" alt="School logo" />` : ""}
    <div class="school-identity">
      <h1 class="school-name">${esc(school.name)}</h1>
      ${school.motto ? `<p class="motto">${esc(school.motto)}</p>` : ""}
      ${contact ? `<p class="contact">${contact}</p>` : ""}
    </div>
    ${photo ? `<img class="passport" src="${esc(photo)}" alt="Student passport photograph" />` : ""}
  </div>

  <div class="doc-title">${profile.level === "NURSERY" ? "Learning and Development Report" : "Terminal Report"} — ${esc(term.name)}, ${esc(academicYear.label)}</div>

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
        <th>${profile.level === "NURSERY" ? "Learning area" : "Subject"}</th>
        ${componentHeaders}
        <th class="num">Total<br /><span class="maximum">/100</span></th>
        <th>Grade</th>
        ${showPosition ? "<th>Pos.</th>" : ""}
        ${cumulative ? '<th class="num">Cum. Avg</th>' : ""}
        <th>Remark</th>
        <th>Teacher's Comment</th>
      </tr>
    </thead>
    <tbody>
      ${subjectRows}
    </tbody>
  </table>

  <div class="summary" style="grid-template-columns: repeat(${summaryColumns}, 1fr);">
    ${summaryBoxes}
  </div>
  ${attendanceNote}
  ${promotion}
  ${gradeKeyHtml}
  ${profileHtml}
  ${customHtml}

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

  <div class="closing">
  <div class="signature-grid">
    <div class="signature"><strong>Class teacher</strong><br />Name: ${esc(profile.teacherName || "Not recorded")}<br />Signature: ____________________</div>
    <div class="signature"><strong>${profile.level === "SECONDARY" ? "Principal" : "Head teacher"}</strong><br />Name: ${esc(profile.headName || "Not recorded")}<br />Signature / stamp: ____________________</div>
  </div>
  <div class="dates">Date issued: ${esc(data.issuedOn ? formatDate(data.issuedOn) : "Not yet approved")} · Next term begins: ${esc(data.nextTermDate ? formatDate(data.nextTermDate) : "Not recorded")}</div>
  <div class="footer">
    <span>${esc(school.name)}</span>
    <span>${school.branded ? "This is a computer-generated report card." : "Report card by SchoolKit · schoolkit.ng"}</span>
  </div>
  </div>
</body>
</html>`;
}
