import type { CreateStudentInput, GenderDto } from "@school-kit/types";

// The rules behind the "add a student" form on the phone.
//
// Pure and separately tested because two of them protect against real
// incidents, and both would be easy to lose in a screen rewrite.
//
// 1. CLASS PLACEMENT IS AN EXPLICIT CHOICE, WITH NO DEFAULT. The API makes
//    `enrollment` optional, and the create DTO's own comment records why the
//    UI must still force an answer: the 2026-08-25 carry-over incident was a
//    pre-ticked default enrolling every student at a newly-onboarded school —
//    "a silent default is most dangerous exactly when it is most likely
//    wrong". So the form's placement starts UNANSWERED, and an unanswered
//    placement blocks saving. "Place later" is a real, deliberate answer.
//
// 2. DATES ARE ENTERED AS DAY, MONTH, YEAR. No date picker: three short
//    number boxes are what an older administrator can type without hunting
//    through a calendar widget for a birth year a decade back. They are
//    assembled into an ISO date here and checked for being a REAL date —
//    31/02 is rejected rather than quietly rolled into March.

export type Placement =
  | { kind: "unanswered" }
  | { kind: "arm"; classArmId: string }
  | { kind: "later" };

export interface StudentFormValues {
  admissionNumber: string;
  firstName: string;
  middleName: string;
  lastName: string;
  dobDay: string;
  dobMonth: string;
  dobYear: string;
  gender: GenderDto | null;
  phone: string;
  address: string;
}

export const EMPTY_STUDENT_FORM: StudentFormValues = {
  admissionNumber: "",
  firstName: "",
  middleName: "",
  lastName: "",
  dobDay: "",
  dobMonth: "",
  dobYear: "",
  gender: null,
  phone: "",
  address: "",
};

/** Build an ISO yyyy-mm-dd date from three typed parts, or null if not a real date. */
export function isoDateFromParts(day: string, month: string, year: string): string | null {
  if (!/^\d{1,2}$/.test(day.trim()) || !/^\d{1,2}$/.test(month.trim()) || !/^\d{4}$/.test(year.trim())) {
    return null;
  }
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  // Reject a date the calendar does not have (31 February rolls into March).
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

export type StudentFormErrors = Partial<Record<"admissionNumber" | "firstName" | "lastName" | "dateOfBirth" | "gender" | "placement", string>>;

/**
 * Validate the form against what the API will accept, and against the
 * placement rule the API cannot enforce.
 *
 * `today` is the server's date, so "born in the future" is judged against the
 * school's calendar, never a handset clock that may be wrong.
 */
export function validateStudentForm(
  values: StudentFormValues,
  placement: Placement,
  today: string | null,
): StudentFormErrors {
  const errors: StudentFormErrors = {};
  if (values.admissionNumber.trim() === "") errors.admissionNumber = "Enter the admission number.";
  if (values.firstName.trim() === "") errors.firstName = "Enter the first name.";
  if (values.lastName.trim() === "") errors.lastName = "Enter the surname.";
  if (values.gender === null) errors.gender = "Choose one.";

  const dob = isoDateFromParts(values.dobDay, values.dobMonth, values.dobYear);
  if (dob === null) {
    errors.dateOfBirth = "Enter a real date: day, month and a four-digit year.";
  } else if (today !== null && dob > today) {
    errors.dateOfBirth = "The date of birth can't be in the future.";
  }

  if (placement.kind === "unanswered") {
    errors.placement = "Choose a class, or choose to place the student later.";
  }
  return errors;
}

/**
 * The create payload. Enrollment is attached ONLY for an explicitly chosen
 * class, and only with the term the caller resolved — never a default.
 */
export function buildCreateStudentInput(
  values: StudentFormValues,
  placement: Placement,
  currentTermId: string | null,
): CreateStudentInput {
  const dob = isoDateFromParts(values.dobDay, values.dobMonth, values.dobYear);
  if (dob === null) throw new Error("buildCreateStudentInput called on an invalid date of birth.");
  if (placement.kind === "unanswered") {
    throw new Error("buildCreateStudentInput called before placement was answered.");
  }
  if (values.gender === null) throw new Error("buildCreateStudentInput called without a gender.");

  const input: CreateStudentInput = {
    admissionNumber: values.admissionNumber.trim(),
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
    dateOfBirth: new Date(dob + "T00:00:00.000Z"),
    gender: values.gender,
  };
  if (values.middleName.trim() !== "") input.middleName = values.middleName.trim();
  if (values.phone.trim() !== "") input.phone = values.phone.trim();
  if (values.address.trim() !== "") input.address = values.address.trim();

  if (placement.kind === "arm") {
    if (currentTermId === null) {
      // A class was chosen but there is no current term to enrol into. Refuse
      // rather than drop the placement silently — the admin asked for it.
      throw new Error("NO_CURRENT_TERM");
    }
    input.enrollment = { termId: currentTermId, classArmId: placement.classArmId };
  }
  return input;
}
