// CSV header → Student target-field synonym table. Used by the mapping
// wizard to pre-fill dropdowns. The list errs on the side of common
// Nigerian-school spreadsheet headers ("Adm No", "Surname", "Sex") rather
// than aiming for every imaginable variation. Admins can override every
// guess by hand.
//
// Lookup is case-insensitive and ignores punctuation / whitespace. A
// header that doesn't match any synonym is left as "unmapped" — the UI
// will surface it as a required dropdown if any required Student field is
// still unmapped.

import type { StudentImportTargetField } from "@school-kit/types";

const SYNONYMS: Record<StudentImportTargetField, string[]> = {
  admissionNumber: [
    "admissionnumber",
    "admissionno",
    "admno",
    "admnumber",
    "admission",
    "matricno",
    "matricnumber",
    "matricnum",
    "studentid",
    "studentnumber",
  ],
  firstName: [
    "firstname",
    "fname",
    "givenname",
    "first",
  ],
  middleName: [
    "middlename",
    "mname",
    "middleinitial",
    "middle",
  ],
  lastName: [
    "lastname",
    "lname",
    "surname",
    "familyname",
    "last",
  ],
  dateOfBirth: [
    "dateofbirth",
    "dob",
    "birthday",
    "birthdate",
    "dateborn",
  ],
  gender: [
    "gender",
    "sex",
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
  ],
  email: [
    "email",
    "emailaddress",
    "mail",
  ],
  address: [
    "address",
    "homeaddress",
    "residentialaddress",
    "residence",
  ],
  photoUrl: [
    "photourl",
    "photo",
    "photolink",
    "image",
    "imageurl",
    "picture",
  ],
  bloodGroup: [
    "bloodgroup",
    "bloodtype",
  ],
  religion: [
    "religion",
    "faith",
  ],
  stateOfOrigin: [
    "stateoforigin",
    "state",
    "origin",
  ],
};

function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function guessTargetField(
  header: string,
): StudentImportTargetField | null {
  const norm = normalise(header);
  if (!norm) return null;
  for (const [field, aliases] of Object.entries(SYNONYMS)) {
    if (aliases.includes(norm)) return field as StudentImportTargetField;
  }
  return null;
}
