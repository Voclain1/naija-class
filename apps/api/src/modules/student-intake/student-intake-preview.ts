import { createHash } from "node:crypto";

import type { PrismaClient } from "@school-kit/db";
import {
  BaseError,
  INTAKE_DUPLICATE_RULE,
  PLAN_ERROR_CODES,
  intakeStudentRowSchema,
  type IntakeBatchErrorCode,
  type IntakeBatchProblem,
  type IntakeBatchWarningCode,
  type IntakePlacement,
  type IntakeRowErrorCode,
  type IntakeRowProblem,
  type IntakeRowWarningCode,
  type IntakeStudentRow,
  type PrepareStudentIntakeInput,
  type StudentIntakeProposalDto,
  type StudentIntakeRowDto,
} from "@school-kit/types";

import { assertRoomForStudents } from "../../common/plans/plan-limits";
import { loadNumbering, type Numbering } from "../students/admission-numbers";
import type { StudentPlacement } from "../students/students.service";

// The authoritative preview of a student intake batch
// (docs/modules/student-intake-proposals.md). Computed in the caller's
// tenant transaction at prepare, and again at confirm: the confirm writes only
// if the recomputed fingerprint equals the one the person reviewed.
//
// Reads only. Reserves nothing: an automatic admission number is shown as
// "assigned on confirm", never as a number the preview cannot promise.

/** A row as stored in the proposal: JSON-safe, dates as strings, sorted keys. */
export type StoredRow = Record<string, string | null>;

export interface StoredInput {
  placement: IntakePlacement;
  students: StoredRow[];
}

export interface IntakeSummary {
  placement: StudentIntakeProposalDto["placement"];
  counts: StudentIntakeProposalDto["counts"];
  batchErrors: IntakeBatchProblem<IntakeBatchErrorCode>[];
  batchWarnings: IntakeBatchProblem<IntakeBatchWarningCode>[];
}

export interface IntakePreview {
  summary: IntakeSummary;
  rows: StudentIntakeRowDto[];
  previewHash: string;
  canConfirm: boolean;
  /** What confirm needs to write, from the same reads. */
  write: { placement: StudentPlacement | null; numbering: Numbering | null };
}

/** JSON with object keys sorted at every level, so equal values hash equally. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function dateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The prepare body as it is stored and fingerprinted. */
export function normaliseInput(input: PrepareStudentIntakeInput): StoredInput {
  return {
    placement: input.placement,
    students: input.students.map((s) => {
      const row: StoredRow = {};
      for (const [k, v] of Object.entries(s)) {
        if (v === undefined) continue;
        if (k === "dateOfBirth") row[k] = dateOnly(v as Date);
        else if (k === "admittedAt") row[k] = (v as Date).toISOString();
        else row[k] = v as string | null;
      }
      return row;
    }),
  };
}

/** Back to the typed row the writer takes (Dates restored, schema re-applied). */
export function toWritableRow(row: StoredRow): IntakeStudentRow {
  return intakeStudentRowSchema.parse(row);
}

/** Case, accents and spacing ignored: the disclosed duplicate rule. */
export function nameKey(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function lagosToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export async function computeIntakePreview(
  db: PrismaClient,
  schoolId: string,
  input: StoredInput,
  now: Date = new Date(),
): Promise<IntakePreview> {
  const batchErrors: IntakeBatchProblem<IntakeBatchErrorCode>[] = [];
  const batchWarnings: IntakeBatchProblem<IntakeBatchWarningCode>[] = [];
  const n = input.students.length;

  // ---- Placement: exactly what was asked for, or nothing. -----------------
  let placement: StudentPlacement | null = null;
  let summaryPlacement: IntakeSummary["placement"] = { mode: "DEFER" };
  let placementFacts: Record<string, unknown> = { mode: "DEFER" };
  if (input.placement.mode === "ENROL") {
    const { termId, classArmId } = input.placement;
    const term = await db.term.findFirst({
      where: { id: termId, schoolId },
      select: { id: true, name: true, isCurrent: true, academicYearId: true, academicYear: { select: { label: true } } },
    });
    const arm = await db.classArm.findFirst({
      where: { id: classArmId, schoolId },
      select: { id: true, name: true, isActive: true, capacity: true, classLevel: { select: { name: true, code: true } } },
    });
    const termLabel = term ? `${term.academicYear.label} · ${term.name}` : null;
    const classLabel = arm ? `${arm.classLevel.name} · ${arm.name}` : null;
    summaryPlacement = { mode: "ENROL", termId, classArmId, termLabel, classLabel };
    placementFacts = {
      mode: "ENROL", termId, classArmId, termLabel, classLabel,
      academicYearId: term?.academicYearId ?? null, classCode: arm?.classLevel.code ?? null,
      armActive: arm?.isActive ?? null, termCurrent: term?.isCurrent ?? null, capacity: arm?.capacity ?? null,
    };
    if (!term) batchErrors.push({ code: "TERM_NOT_FOUND", message: "The chosen term was not found. Choose the term again." });
    if (!arm) batchErrors.push({ code: "CLASS_ARM_NOT_FOUND", message: "The chosen class was not found. Choose the class again." });
    else if (!arm.isActive) batchErrors.push({ code: "CLASS_ARM_INACTIVE", message: "The chosen class is inactive. Choose another class or reactivate it." });
    if (term && !term.isCurrent) {
      batchWarnings.push({ code: "TERM_NOT_CURRENT", message: `${termLabel} is not the school's current term.` });
    }
    if (term && arm && arm.isActive) {
      placement = { termId, academicYearId: term.academicYearId, classArmId, classCode: arm.classLevel.code };
      if (arm.capacity !== null) {
        const enrolled = await db.enrollment.count({ where: { schoolId, termId, classArmId, status: "ENROLLED" } });
        if (enrolled + n > arm.capacity) {
          batchWarnings.push({
            code: "CLASS_OVER_CAPACITY",
            message: `${classLabel} holds ${arm.capacity}; ${enrolled} are enrolled for this term, so this batch makes ${enrolled + n}.`,
            details: { capacity: arm.capacity, enrolledNow: enrolled, afterIntake: enrolled + n },
          });
        }
      }
    }
  }

  // ---- Plan limit (only under PLAN_ENFORCEMENT=enforce). -----------------
  try {
    await assertRoomForStudents(db, schoolId, n);
  } catch (e) {
    if (e instanceof BaseError && e.code === PLAN_ERROR_CODES.STUDENT_LIMIT) {
      const d = (e.details ?? {}) as Record<string, number | string>;
      batchErrors.push({ code: "PLAN_STUDENT_LIMIT", message: e.message, details: { studentCap: d.studentCap ?? 0, studentsOnRoll: d.studentsOnRoll ?? 0, adding: n } });
    } else throw e;
  }

  // ---- Numbering. ---------------------------------------------------------
  const rowErrors: IntakeRowProblem<IntakeRowErrorCode>[][] = input.students.map(() => []);
  const rowWarnings: IntakeRowProblem<IntakeRowWarningCode>[][] = input.students.map(() => []);
  const typed = input.students.map((s) => s.admissionNumber ?? null);
  const blanks = typed.flatMap((t, i) => (t ? [] : [i]));

  let numbering: Numbering | null = null;
  let numberingFacts: unknown = null;
  let numberingUnreadable = false;
  try {
    numbering = await loadNumbering(db, schoolId);
    numberingFacts = numbering ? { format: numbering.format, order: numbering.order } : "MANUAL";
  } catch (e) {
    if (e instanceof BaseError && e.code === "ADMISSION_FORMAT_INVALID") {
      numberingUnreadable = true;
      numberingFacts = "INVALID";
      if (blanks.length > 0) batchErrors.push({ code: "ADMISSION_FORMAT_INVALID", message: e.message });
    } else throw e;
  }
  if (blanks.length > 0 && !numberingUnreadable) {
    for (const i of blanks) {
      if (!numbering) {
        rowErrors[i]!.push({ code: "ADMISSION_NUMBER_REQUIRED", message: "Enter an admission number, or turn on automatic numbering in Settings." });
      } else if (numbering.order === "CLASS" && !placement) {
        rowErrors[i]!.push({ code: "ADMISSION_NUMBER_NEEDS_CLASS", message: "Your school numbers students per class: choose a class for the batch, or type this number." });
      }
    }
  }

  // Typed numbers: repeated in the batch, or already on the roll.
  const firstSeen = new Map<string, number>();
  const repeats = new Map<string, number[]>();
  typed.forEach((t, i) => {
    if (!t) return;
    if (!firstSeen.has(t)) firstSeen.set(t, i);
    repeats.set(t, [...(repeats.get(t) ?? []), i]);
  });
  for (const [, idx] of repeats) {
    if (idx.length < 2) continue;
    for (const i of idx) {
      rowErrors[i]!.push({ code: "ADMISSION_NUMBER_REPEATED", message: "This admission number is on more than one row.", relatedIndexes: idx.filter((j) => j !== i) });
    }
  }
  if (firstSeen.size > 0) {
    const taken = await db.student.findMany({
      where: { schoolId, admissionNumber: { in: [...firstSeen.keys()] } },
      select: { admissionNumber: true },
    });
    const takenSet = new Set(taken.map((t) => t.admissionNumber));
    typed.forEach((t, i) => {
      if (t && takenSet.has(t)) rowErrors[i]!.push({ code: "ADMISSION_NUMBER_TAKEN", message: "A student of this school already has this admission number." });
    });
  }

  // ---- Advisory duplicates (INTAKE_DUPLICATE_RULE). Never merged. ---------
  const keys = input.students.map((s) => `${nameKey(s.firstName ?? "")}|${nameKey(s.lastName ?? "")}|${s.dateOfBirth}`);
  const byKey = new Map<string, number[]>();
  keys.forEach((k, i) => byKey.set(k, [...(byKey.get(k) ?? []), i]));
  for (const [, idx] of byKey) {
    if (idx.length < 2) continue;
    for (const i of idx) {
      rowWarnings[i]!.push({ code: "POSSIBLE_DUPLICATE_IN_BATCH", message: "Another row has the same name and date of birth.", relatedIndexes: idx.filter((j) => j !== i) });
    }
  }
  const dobs = [...new Set(input.students.map((s) => s.dateOfBirth!))];
  const existing = await db.student.findMany({
    where: { schoolId, dateOfBirth: { in: dobs.map((d) => new Date(`${d}T00:00:00.000Z`)) } },
    select: { id: true, firstName: true, lastName: true, dateOfBirth: true },
    orderBy: { id: "asc" },
  });
  const onRoll = new Map<string, string[]>();
  for (const s of existing) {
    const k = `${nameKey(s.firstName)}|${nameKey(s.lastName)}|${dateOnly(s.dateOfBirth)}`;
    onRoll.set(k, [...(onRoll.get(k) ?? []), s.id]);
  }
  const today = lagosToday(now);
  keys.forEach((k, i) => {
    const ids = onRoll.get(k);
    if (ids) rowWarnings[i]!.push({ code: "POSSIBLE_DUPLICATE_ON_ROLL", message: "A student with the same name and date of birth is already on the roll.", relatedStudentIds: ids });
    if (input.students[i]!.dateOfBirth! > today) rowWarnings[i]!.push({ code: "DATE_OF_BIRTH_IN_FUTURE", message: "The date of birth is after today." });
  });

  // ---- Assemble. ----------------------------------------------------------
  const rows: StudentIntakeRowDto[] = input.students.map((s, index) => ({
    index,
    values: s as unknown as StudentIntakeRowDto["values"],
    admissionNumber: s.admissionNumber ?? null,
    admissionNumberSource: s.admissionNumber ? "TYPED" : "ASSIGNED_ON_CONFIRM",
    errors: rowErrors[index]!,
    warnings: rowWarnings[index]!,
  }));
  const counts = {
    rows: n,
    withErrors: rows.filter((r) => r.errors.length > 0).length,
    withWarnings: rows.filter((r) => r.warnings.length > 0).length,
    assignedOnConfirm: blanks.length,
  };
  const summary: IntakeSummary = { placement: summaryPlacement, counts, batchErrors, batchWarnings };
  const previewHash = sha256(stableStringify({
    v: 1, placement: placementFacts, numbering: numberingFacts, rows, batchErrors, batchWarnings, rule: INTAKE_DUPLICATE_RULE,
  }));
  return {
    summary,
    rows,
    previewHash,
    canConfirm: batchErrors.length === 0 && counts.withErrors === 0,
    write: { placement, numbering },
  };
}
