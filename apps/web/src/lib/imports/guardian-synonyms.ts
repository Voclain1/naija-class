// CSV header → Guardian target-field synonym table. Mirrors the slice 6
// student-synonyms structure (lookup is case-insensitive and ignores
// punctuation / whitespace). Slice 8 cp2.
//
// Nigerian-school spreadsheet conventions checked in cp1 plan Q4:
//   - "Surname" everywhere — already covered
//   - "Ward" idiomatically means "the child a guardian is responsible
//     for" — included as a synonym for studentAdmissionNumber
//   - "Parent" / "Guardian" prefixes on contact columns are common
//     ("Parent Phone", "Guardian Email") — included on phone/email/
//     name fields
//   - "Is Primary" / "Can Pickup" boolean columns aren't standard
//     across schools but are common when a school has thought about
//     pickup permissions — include the obvious phrasings

import type { GuardianImportTargetField } from "@school-kit/types";

const SYNONYMS: Record<GuardianImportTargetField, string[]> = {
  firstName: [
    "firstname",
    "fname",
    "givenname",
    "first",
    "parentfirstname",
    "guardianfirstname",
  ],
  lastName: [
    "lastname",
    "lname",
    "surname",
    "familyname",
    "last",
    "parentsurname",
    "parentlastname",
    "guardiansurname",
  ],
  relationship: [
    "relationship",
    "relation",
    "relationto",
    "relationtostudent",
    "guardiantype",
    "parenttype",
  ],
  phone: [
    "phone",
    "phonenumber",
    "phoneno",
    "mobile",
    "mobileno",
    "mobilenumber",
    "tel",
    "telephone",
    "contact",
    "parentphone",
    "guardianphone",
  ],
  email: [
    "email",
    "emailaddress",
    "mail",
    "parentemail",
    "guardianemail",
  ],
  studentAdmissionNumber: [
    "studentadmno",
    "studentadmissionno",
    "studentadmissionnumber",
    "studentid",
    "studentnumber",
    "wardadmno",
    "wardadmissionno",
    "wardadmissionnumber",
    "wardid",
    "childadmno",
    "childadmissionnumber",
  ],
  occupation: ["occupation", "job", "jobtitle", "profession", "work"],
  employer: [
    "employer",
    "company",
    "organization",
    "workplace",
    "organisation",
  ],
  address: [
    "address",
    "homeaddress",
    "residentialaddress",
    "residence",
    "parentaddress",
    "guardianaddress",
  ],
  isPrimary: ["primary", "isprimary", "primarycontact", "primaryparent"],
  canPickup: ["canpickup", "pickup", "authorizedpickup", "allowedpickup"],
  notes: ["notes", "comments", "remarks"],
};

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function guessGuardianTargetField(
  header: string,
): GuardianImportTargetField | null {
  const norm = normalise(header);
  if (!norm) return null;
  for (const [field, aliases] of Object.entries(SYNONYMS)) {
    if (aliases.includes(norm)) return field as GuardianImportTargetField;
  }
  return null;
}

// Combined-name detection (cp2 plan F UX guardrail).
//
// Some schools' spreadsheets use a single "Parent Name" / "Guardian Name"
// / "Name" / "Full Name" column instead of separate first/surname columns.
// Splitting that on whitespace looks tempting but gets Yoruba / Igbo
// two-part names wrong ("Adesola Tunde" — is Tunde the surname or a
// middle name?). Better UX: detect the pattern, surface a clear inline
// note next to the column dropdown explaining what to do, and let the
// existing "required firstName + lastName not mapped" guard prevent the
// wizard from advancing.
//
// Match is case-insensitive + punctuation-stripped (same normalise as
// the synonym lookup), against a short fixed list:
const COMBINED_NAME_KEYS = new Set(["parentname", "guardianname", "name", "fullname"]);

export function isCombinedNameHeader(header: string): boolean {
  return COMBINED_NAME_KEYS.has(normalise(header));
}

// True when the file's headers include a combined-name column AND no
// other header maps to firstName/lastName via the synonym table. The
// inline note only fires when there's no way to populate the required
// firstName/lastName fields — if the school also has separate columns,
// the combined column is just an extra unmapped header and doesn't
// need the warning.
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
    const guess = guessGuardianTargetField(h);
    if (guess === "firstName") hasFirst = true;
    if (guess === "lastName") hasLast = true;
  }
  return {
    combinedHeader,
    needsSplit: combinedHeader !== null && (!hasFirst || !hasLast),
  };
}
