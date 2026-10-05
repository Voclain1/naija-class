// Online exams (CBT) — the two codes on a sitting (docs/modules/cbt.md D3).
//
// One alphabet for both: capitals and digits without the look-alikes
// (0/O, 1/I/L), so an invigilator reading a code aloud in a lab is not misheard.

export const CBT_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CBT_ACCESS_CODE_LENGTH = 6;
export const CBT_UNLOCK_CODE_LENGTH = 12;

/** What a person types → the stored form: capitals, no spaces or dashes. */
export function normaliseCbtCode(raw: string): string {
  return raw.toUpperCase().replace(/[\s-]/g, "");
}

/** 12 characters → "XXXX-XXXX-XXXX", for reading and typing. */
export function formatUnlockCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, "$1-");
}
