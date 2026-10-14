import type {
  CbtAttemptFlag,
  CbtCandidateProgressDto,
  CbtCandidateRowDto,
  CbtInvigilatorSheetDto,
  CbtResultRowDto,
  CbtSittingStatus,
  CbtSittingSummaryDto,
} from "@school-kit/types";

// Pure display rules for online exams (docs/modules/cbt.md) on the phone.
//
// The first block is a copy of the website's apps/web/src/lib/cbt/cbt-format.ts
// — same words, same rules — so a teacher reads the same thing on both. The
// rest is what the phone needs on top: typed times (there is no time picker in
// this app), the schedule form's checks, and the printable invigilator sheet.
// No React Native imports: Vitest runs these in node.

/**
 * Where lab computers open the exam (D9), printed on the invigilator sheet.
 * The website reads NEXT_PUBLIC_CBT_URL, defaulting to this address in
 * production. The phone has no build-time switch for it and only ever talks to
 * production, so it uses the production default directly. If the exam app's
 * address ever changes, change it here too.
 */
export const CBT_DELIVERY_BASE_URL = "https://cbt.schoolkit.ng";

/** "https://cbt.schoolkit.ng/greenfield" — what each lab computer opens. */
export function cbtExamUrl(schoolSlug: string): string {
  return `${CBT_DELIVERY_BASE_URL.replace(/\/$/, "")}/${schoolSlug}`;
}

// ---- Copied from the website ----------------------------------------------

export function cbtStatusLabel(status: CbtSittingStatus): string {
  return status === "DRAFT" ? "Draft" : status === "PUBLISHED" ? "Published" : "Closed";
}

/** A date ("2026-11-20") and a wall-clock time ("09:00") in this phone's zone → a moment. */
export function localMoment(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const d = new Date(`${date}T${time}:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const timeOf = (d: Date) => d.toLocaleTimeString("en-NG", { hour: "2-digit", minute: "2-digit" });

/** "Fri 20 Nov 2026, 09:00 (start by 09:30) · 40 min" */
export function describeSittingTime(s: Pick<CbtSittingSummaryDto, "startsAt" | "windowEndsAt" | "durationMinutes">): string {
  const start = new Date(s.startsAt);
  const latest = new Date(s.windowEndsAt);
  const day = start.toLocaleDateString("en-NG", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const sameDay = start.toDateString() === latest.toDateString();
  const by = sameDay ? timeOf(latest) : `${latest.toLocaleDateString("en-NG", { day: "numeric", month: "short" })} ${timeOf(latest)}`;
  return `${day}, ${timeOf(start)} (start by ${by}) · ${s.durationMinutes} min`;
}

/** "Not started" · "Sitting — 12 of 40 answered" · "Submitted — 38 of 40 answered (2 computers)" */
export function cbtProgressLabel(progress: CbtCandidateProgressDto | null, questionCount: number): string {
  if (!progress) return "Not started";
  const state = progress.submitted ? "Submitted" : "Sitting";
  const machines = progress.machines > 1 ? ` (${progress.machines} computers)` : "";
  return `${state} — ${progress.answeredCount} of ${questionCount} answered${machines}`;
}

/** What a teacher reads beside an attempt. Flags never decide anything (D6). */
export function cbtFlagLabel(flag: CbtAttemptFlag, focusLosses: number): string {
  switch (flag) {
    case "LATE_START":
      return "Started after the latest start";
    case "OVER_TIME":
      return "Ran over time";
    case "NOT_SUBMITTED":
      return "Did not finish";
    case "AFTER_CLOSE":
      return "Arrived after the close";
    case "LEFT_WINDOW":
      return `Left the exam window ${focusLosses === 1 ? "once" : `${focusLosses} times`}`;
  }
}

/** Why a row has no total yet, or null when it is ready for the gradebook. */
export function cbtNotReadyReason(row: Pick<CbtResultRowDto, "attempts" | "needsChoice" | "total" | "objectiveScore">): string | null {
  if (row.total !== null) return null;
  if (row.attempts.length === 0) return "No answers received";
  if (row.needsChoice) return "Choose which computer counts";
  return "Theory mark needed";
}

/** A typed theory mark → a whole number in 0..max, null for empty, or "invalid". */
export function parseTheoryMark(typed: string, max: number): number | null | "invalid" {
  const t = typed.trim();
  if (t === "") return null;
  if (!/^\d+$/.test(t)) return "invalid";
  const n = Number(t);
  return n <= max ? n : "invalid";
}

// ---- Phone-only -------------------------------------------------------------

/** "Versions A–C" once published; the paper decides how many. */
export function cbtVersionsLabel(versionCount: number): string {
  const last = "ABCD"[Math.min(Math.max(versionCount, 1), 4) - 1];
  return versionCount <= 1 ? "Version A" : `Versions A–${last}`;
}

/** "1 question" / "3 questions" */
export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/**
 * A typed time of day → "HH:MM", or null. Accepts "9:00", "09:00", "0900" and
 * "900", because a phone's number pad has no colon.
 */
export function normaliseTime(typed: string): string | null {
  const m = /^(\d{1,2}):?(\d{2})$/.exec(typed.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export interface ScheduleTimesInput {
  /** "2026-11-20", or null when the day/month/year boxes do not make a real date. */
  date: string | null;
  startTime: string;
  latestStart: string;
  duration: string;
}

export interface ScheduleTimes {
  startsAt: Date | null;
  windowEndsAt: Date | null;
  durationMinutes: number | null;
  /** The first thing wrong, in words, or null when the times can be sent. */
  problem: string | null;
}

/** The schedule form's checks — the website's rules, said in words for each field. */
export function readScheduleTimes(input: ScheduleTimesInput): ScheduleTimes {
  const start = normaliseTime(input.startTime);
  const latest = normaliseTime(input.latestStart);
  const startsAt = input.date && start ? localMoment(input.date, start) : null;
  const windowEndsAt = input.date && latest ? localMoment(input.date, latest) : null;
  const d = input.duration.trim();
  const durationMinutes = /^\d+$/.test(d) && Number(d) >= 5 && Number(d) <= 600 ? Number(d) : null;

  let problem: string | null = null;
  if (!input.date) problem = "Type the day, month and year of the exam.";
  else if (!start) problem = "Type the start time as hours and minutes, like 09:00.";
  else if (!latest) problem = "Type the latest start as hours and minutes, like 09:30.";
  else if (!startsAt || !windowEndsAt || windowEndsAt <= startsAt) problem = "The latest start must be after the start.";
  else if (durationMinutes === null) problem = "The length is a whole number of minutes from 5 to 600.";

  return { startsAt, windowEndsAt, durationMinutes, problem };
}

/** The saved theory mark as the box shows it. */
export function savedTheoryText(row: Pick<CbtResultRowDto, "theoryMark">): string {
  return row.theoryMark === null ? "" : String(row.theoryMark);
}

/**
 * Rows whose typed theory mark differs from the saved one. `edits` holds only
 * what the teacher has typed; a row without an edit shows its saved mark.
 */
export function changedTheoryRows<R extends Pick<CbtResultRowDto, "studentId" | "theoryMark">>(
  rows: readonly R[],
  edits: Readonly<Record<string, string>>,
): R[] {
  return rows.filter((row) => {
    const typed = edits[row.studentId];
    return typed !== undefined && typed.trim() !== savedTheoryText(row);
  });
}

export function escapeHtml(value: string | number): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The invigilator sheet as a printable page — the website's
 * /teacher/cbt/[id]/invigilator, word for word: the codes, the steps for the
 * day, and the register with a blank column to sign. Every value is escaped
 * (names and the school's name are tenant data). Built only to hand to the
 * print dialog or a PDF that is deleted after sharing; never stored. No accent
 * borders (CLAUDE.md): the codes sit in tinted boxes, the register has plain
 * gridlines.
 */
export function invigilatorSheetHtml(sheet: CbtInvigilatorSheetDto, candidates: readonly CbtCandidateRowDto[]): string {
  const examUrl = cbtExamUrl(sheet.schoolSlug);
  const rows = candidates
    .map(
      (c) => `
      <tr>
        <td class="mono">${escapeHtml(c.admissionNumber)}</td>
        <td>${escapeHtml(c.lastName)}, ${escapeHtml(c.firstName)}</td>
        <td>${escapeHtml(c.armName)}</td>
        <td>${escapeHtml(c.version)}</td>
        <td class="sign"></td>
      </tr>`,
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(sheet.title)} — invigilator sheet</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; margin: 14mm; color: #13262e; font-size: 12px; }
  .muted { color: #5b6b72; }
  h1 { font-size: 20px; margin: 4px 0; }
  p { margin: 4px 0; }
  .private { background: #fbf0d9; padding: 8px 10px; border-radius: 4px; margin: 12px 0; }
  .codes { display: flex; gap: 12px; margin: 12px 0; }
  .code { flex: 1; background: #f1eee5; padding: 10px 12px; border-radius: 4px; }
  .code .value { font-family: "Courier New", monospace; font-size: 26px; font-weight: 700; letter-spacing: 3px; margin-top: 4px; }
  h2 { font-size: 14px; margin: 16px 0 6px; }
  ol { padding-left: 18px; margin: 0; }
  li { margin-bottom: 4px; }
  .mono { font-family: "Courier New", monospace; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 11px; color: #5b6b72; font-weight: 600; }
  th, td { padding: 5px 6px; border-bottom: 1px solid #cfcabd; }
  tr { break-inside: avoid; }
  .sign { width: 30%; }
</style>
</head>
<body>
  <p class="muted">${escapeHtml(sheet.schoolName)} — invigilator sheet</p>
  <h1>${escapeHtml(sheet.title)}</h1>
  <p>${escapeHtml(sheet.classLevelName)} ${escapeHtml(sheet.subjectName)} · ${escapeHtml(sheet.armNames.join(", "))}</p>
  <p>${escapeHtml(describeSittingTime(sheet))}</p>

  <p class="private"><strong>Keep this sheet private.</strong> The unlock code opens the exam questions. Do not write it on the board or leave this sheet where students can see it.</p>

  <div class="codes">
    <div class="code">
      <div class="muted">Access code — to download the exam onto each computer</div>
      <div class="value">${escapeHtml(sheet.accessCode)}</div>
    </div>
    <div class="code">
      <div class="muted">Unlock code — type it on each computer at the start</div>
      <div class="value">${escapeHtml(sheet.unlockCode)}</div>
    </div>
  </div>

  <h2>On the day</h2>
  <ol>
    ${invigilatorSteps(examUrl, sheet.durationMinutes)
      .map((step) => `<li><strong>${escapeHtml(step.lead)}</strong>${escapeHtml(step.rest)}</li>`)
      .join("\n    ")}
  </ol>

  <h2>Register (${escapeHtml(sheet.candidateCount)})</h2>
  <table>
    <thead>
      <tr><th>Admission no.</th><th>Name</th><th>Class</th><th>Version</th><th>Computer / signature</th></tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>
</body>
</html>`;
}

export interface InvigilatorStep {
  /** Shown in bold; may be empty. */
  lead: string;
  rest: string;
}

/** The website's "On the day" steps, as data so the screen and the printout say the same. */
export function invigilatorSteps(examUrl: string, durationMinutes: number): InvigilatorStep[] {
  return [
    {
      lead: "Before the exam",
      rest: `, while the internet is on: on each computer open ${examUrl}, type the access code and download the exam. It is locked; nobody can read it yet.`,
    },
    { lead: "At the start", rest: ", type the unlock code on each computer. The exam works without internet from here on." },
    {
      lead: "",
      rest: `Each student types their admission number and checks their name. Their own clock starts when they begin, and they have ${durationMinutes} minutes. No one may begin after the latest start time.`,
    },
    {
      lead: "",
      rest: "If a computer switches off, turn it back on and open the same address: the answers are saved on it. Type the unlock code again to carry on.",
    },
    { lead: "", rest: "Answers are sent automatically whenever the internet is on. Leave each computer on until it says it has sent." },
  ];
}
