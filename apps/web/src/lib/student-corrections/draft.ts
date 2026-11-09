import { STUDENT_CORRECTION_FIELDS, studentCorrectionChangesSchema, type StudentDto, type StudentCorrectionChanges, type StudentCorrectionField } from "@school-kit/types";
export const FIELD_LABELS: Record<StudentCorrectionField, string> = { firstName: "First name", middleName: "Middle name", lastName: "Last name", dateOfBirth: "Date of birth", gender: "Gender", email: "Email" };
export type CorrectionValues = Record<StudentCorrectionField, string>;
export interface CorrectionDraft { studentId: string; admissionNumber: string; originalName: string; before: CorrectionValues; values: CorrectionValues; clearMiddleName: boolean; clearEmail: boolean }
export function correctionDraft(s: StudentDto): CorrectionDraft {
  const before: CorrectionValues = { firstName: s.firstName, middleName: s.middleName ?? "", lastName: s.lastName, dateOfBirth: (s.dateOfBirth instanceof Date ? s.dateOfBirth.toISOString() : s.dateOfBirth).slice(0, 10), gender: s.gender, email: s.email ?? "" };
  return { studentId: s.id, admissionNumber: s.admissionNumber, originalName: [s.firstName, s.middleName, s.lastName].filter(Boolean).join(" "), before, values: { ...before }, clearMiddleName: false, clearEmail: false };
}
/** Only explicit changes leave the browser. Blank optionals do not silently clear records. */
export function correctionChanges(d: CorrectionDraft): { changes: StudentCorrectionChanges | null; errors: string[] } {
  const raw: Record<string, string | null> = {}; const errors: string[] = [];
  for (const field of STUDENT_CORRECTION_FIELDS) {
    const optional = field === "email" || field === "middleName";
    const clear = field === "email" ? d.clearEmail : field === "middleName" && d.clearMiddleName;
    const value = field === "email" ? d.values[field].trim().toLowerCase() : d.values[field].trim();
    const before = field === "email" ? d.before[field].trim().toLowerCase() : d.before[field].trim();
    if (clear) { if (before !== "") raw[field] = null; continue; }
    if (value === before) continue;
    if (optional && value === "" && before !== "") { errors.push(`Tick Clear ${FIELD_LABELS[field].toLowerCase()} to remove its current value.`); continue; }
    if (optional && value === "" && before === "") continue;
    raw[field] = value;
  }
  if (errors.length || !Object.keys(raw).length) return { changes: null, errors };
  const parsed = studentCorrectionChangesSchema.safeParse(raw);
  if (!parsed.success) return { changes: null, errors: parsed.error.issues.map((issue) => `${FIELD_LABELS[issue.path[0] as StudentCorrectionField] ?? "Correction"}: ${issue.message}`) };
  return { changes: parsed.data, errors: [] };
}
export function displayCorrectionValue(field: StudentCorrectionField, value: string | null): string {
  if (value === null || value === "") return "Not recorded";
  return field === "dateOfBirth" ? value.slice(0, 10).split("-").reverse().join("/") : value;
}
