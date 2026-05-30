// CSV header → Teacher target-field synonym table. Mirrors the slice 6/8
// student + guardian synonym structure (lookup is case-insensitive and
// ignores punctuation / whitespace). Slice 10 cp3.
//
// Teacher import is the SIMPLEST of the three types — three required fields,
// no optional columns: email, firstName, lastName. The synonym list errs on
// the side of common Nigerian-school staff-spreadsheet headers ("Staff
// Email", "Given Name", "Surname") rather than every imaginable variation;
// admins override every guess by hand on the mapping screen.

import type { TeacherImportTargetField } from "@school-kit/types";

const SYNONYMS: Record<TeacherImportTargetField, string[]> = {
  email: [
    "email",
    "emailaddress",
    "mail",
    "staffemail",
    "teacheremail",
    "workemail",
  ],
  firstName: [
    "firstname",
    "fname",
    "givenname",
    "first",
    "stafffirstname",
    "teacherfirstname",
  ],
  lastName: [
    "lastname",
    "lname",
    "surname",
    "familyname",
    "last",
    "staffsurname",
    "stafflastname",
    "teachersurname",
  ],
};

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function guessTeacherTargetField(
  header: string,
): TeacherImportTargetField | null {
  const norm = normalise(header);
  if (!norm) return null;
  for (const [field, aliases] of Object.entries(SYNONYMS)) {
    if (aliases.includes(norm)) return field as TeacherImportTargetField;
  }
  return null;
}

// Combined-name detection (mirrors the guardian guardrail in
// guardian-synonyms.ts). Some staff spreadsheets use a single "Teacher
// Name" / "Name" / "Full Name" column instead of separate first/surname
// columns. Splitting on whitespace gets Yoruba / Igbo two-part names wrong,
// so we detect the pattern, surface an inline note, and let the existing
// "required firstName + lastName not mapped" guard block the wizard.
//
// Match is case-insensitive + punctuation-stripped (same normalise as the
// synonym lookup), against a short fixed list:
const COMBINED_NAME_KEYS = new Set([
  "teachername",
  "staffname",
  "name",
  "fullname",
]);

export function isCombinedNameHeader(header: string): boolean {
  return COMBINED_NAME_KEYS.has(normalise(header));
}

// True when the file's headers include a combined-name column AND no other
// header maps to firstName/lastName via the synonym table. The inline note
// only fires when there's no way to populate the required firstName/lastName
// fields — if the school also has separate columns, the combined column is
// just an extra unmapped header and doesn't need the warning.
export function detectMissingNameSplit(headers: string[]): {
  combinedHeader: string | null;
  needsSplit: boolean;
} {
  let combinedHeader: string | null = null;
  let hasFirst = false;
  let hasLast = false;
  for (const h of headers) {
    if (combinedHeader === null && isCombinedNameHeader(h)) {
      combinedHeader = h;
    }
    const guess = guessTeacherTargetField(h);
    if (guess === "firstName") hasFirst = true;
    if (guess === "lastName") hasLast = true;
  }
  return {
    combinedHeader,
    needsSplit: combinedHeader !== null && (!hasFirst || !hasLast),
  };
}
