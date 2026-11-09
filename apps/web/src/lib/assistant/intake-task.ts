import type { PrepareStudentIntakeInput, StudentIntakeOutcomeDto } from "@school-kit/types";
import { IntakeSession, type IntakeState } from "@/lib/students/intake-session";

// Wraps the guided-intake session (#514) so its outcome survives the panel
// being minimised or the page changing: IntakeSession hands the outcome back
// once and returns to idle, so this keeps it (ids and admission numbers only).

export interface IntakeTaskState { session: IntakeState; outcome: StudentIntakeOutcomeDto | null; started: boolean }

export class IntakeTask {
  readonly session = new IntakeSession();
  private outcome: StudentIntakeOutcomeDto | null = null;
  private started = false;
  /** The person's rows and placement, kept in memory so "back to editing" keeps them. */
  draft: { rows: PastedRow[]; placement: { termId: string; classArmId: string } | null | undefined } | null = null;
  private listeners = new Set<() => void>();
  private snap: IntakeTaskState;
  constructor() {
    this.snap = { session: this.session.snapshot(), outcome: null, started: false };
    this.session.subscribe(() => this.emit());
  }
  private emit() {
    this.snap = { session: this.session.snapshot(), outcome: this.outcome, started: this.started };
    this.listeners.forEach((fn) => fn());
  }
  snapshot = () => this.snap;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  start(input: Omit<PrepareStudentIntakeInput, "clientRequestId">) {
    if (this.started) return;
    this.started = true; this.emit();
    void this.session.start(input).then((o) => {
      this.outcome = o;
      if (!o) this.started = false;
      this.emit();
    });
  }
  dispose() { this.session.dispose(); this.listeners.clear(); }
}

/** One pasted line: "First, Last, YYYY-MM-DD or DD/MM/YYYY, Gender[, Admission no.]". */
export interface PastedRow { firstName: string; lastName: string; dateOfBirth: string; gender: "MALE" | "FEMALE" | "OTHER" | ""; admissionNumber: string }

export function parsePastedRows(text: string): { rows: PastedRow[]; skipped: number } {
  const rows: PastedRow[] = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.split(line.includes("\t") ? "\t" : ",").map((c) => c.trim());
    const [first = "", last = "", dob = "", gender = "", adm = ""] = cells;
    if (!first || !last || /^first/i.test(first)) { skipped += 1; continue; }
    rows.push({ firstName: first, lastName: last, dateOfBirth: toIsoDate(dob), gender: toGender(gender), admissionNumber: adm });
  }
  return { rows, skipped };
}

function toIsoDate(s: string): string {
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return s;
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  return dmy ? `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}` : "";
}
function toGender(s: string): PastedRow["gender"] {
  const g = s.toLowerCase();
  return g.startsWith("m") ? "MALE" : g.startsWith("f") ? "FEMALE" : g.startsWith("o") ? "OTHER" : "";
}
