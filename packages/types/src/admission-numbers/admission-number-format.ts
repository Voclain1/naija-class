// A school's admission number format (docs/modules/admission-numbers.md).
//
// The school writes its number once with blanks SchoolKit fills in:
//   {YYYY}  year of admission          {YY}    short year
//   {CLASS} the class's code (per-class numbering only, and required there)
//   {NNN…}  the number: as many digits as N's, 3 to 8
// Everything else is literal text — letters, digits, "/", "-" and ".".
//
// Shared by the API (which assigns) and the web app (which previews as the
// admin types), so both read a format the same way.

export const ADMISSION_NUMBER_ORDERS = ["SCHOOL", "CLASS", "RANDOM"] as const;
export type AdmissionNumberOrder = (typeof ADMISSION_NUMBER_ORDERS)[number];

export const ADMISSION_NUMBER_MAX_LENGTH = 40;
export const ADMISSION_DIGITS_MIN = 3;
export const ADMISSION_DIGITS_MAX = 8;
export const ADMISSION_FORMAT_MAX_LENGTH = 60;

export type FormatPart =
  | { kind: "text"; value: string }
  | { kind: "year" }
  | { kind: "shortYear" }
  | { kind: "class" }
  | { kind: "digits"; length: number };

export interface ParsedFormat {
  parts: FormatPart[];
  digits: number;
  hasYear: boolean;
  hasClass: boolean;
}

const LITERAL = /^[A-Za-z0-9/.-]$/;

/** Read a format, or say in plain words what is wrong with it. */
export function parseAdmissionFormat(
  format: string,
  order: AdmissionNumberOrder,
): { ok: true; format: ParsedFormat } | { ok: false; error: string } {
  const text = format.trim();
  if (text === "") return { ok: false, error: "Write the format, for example VFM/{YYYY}/{NNNN}." };
  if (text.length > ADMISSION_FORMAT_MAX_LENGTH) return { ok: false, error: "That format is too long." };

  const parts: FormatPart[] = [];
  let digits = 0;
  let digitRuns = 0;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (ch === "{") {
      const end = text.indexOf("}", i);
      if (end === -1) return { ok: false, error: "A { is not closed with }." };
      const token = text.slice(i + 1, end).toUpperCase();
      if (token === "YYYY") parts.push({ kind: "year" });
      else if (token === "YY") parts.push({ kind: "shortYear" });
      else if (token === "CLASS") parts.push({ kind: "class" });
      else if (/^N+$/.test(token)) {
        if (token.length < ADMISSION_DIGITS_MIN || token.length > ADMISSION_DIGITS_MAX) {
          return { ok: false, error: `Use ${ADMISSION_DIGITS_MIN} to ${ADMISSION_DIGITS_MAX} N's for the number, like {NNNN}.` };
        }
        digits = token.length;
        digitRuns += 1;
        parts.push({ kind: "digits", length: token.length });
      } else {
        return { ok: false, error: `{${text.slice(i + 1, end)}} is not a blank SchoolKit knows. Use {YYYY}, {YY}, {CLASS} or {NNNN}.` };
      }
      i = end + 1;
      continue;
    }
    if (ch === "}") return { ok: false, error: "A } has no { before it." };
    if (!LITERAL.test(ch)) {
      return { ok: false, error: `"${ch}" can't be in an admission number. Use letters, numbers, /, - or .` };
    }
    const last = parts[parts.length - 1];
    if (last?.kind === "text") last.value += ch;
    else parts.push({ kind: "text", value: ch });
    i += 1;
  }

  if (digitRuns === 0) return { ok: false, error: "Add {NNNN} where the number goes." };
  if (digitRuns > 1) return { ok: false, error: "Use {NNNN} only once." };
  const hasClass = parts.some((p) => p.kind === "class");
  if (order === "CLASS" && !hasClass) {
    return { ok: false, error: "Numbering per class needs {CLASS} in the format, so two classes never share a number." };
  }
  if (order !== "CLASS" && hasClass) {
    return { ok: false, error: "{CLASS} only works when numbering per class." };
  }
  const parsed: ParsedFormat = {
    parts,
    digits,
    hasYear: parts.some((p) => p.kind === "year" || p.kind === "shortYear"),
    hasClass,
  };
  // Long class codes are rare; 6 characters covers "JSS1", "PRI4", "SSS3A".
  if (fillAdmissionNumber(parsed, { year: 2026, classCode: "XXXXXX", value: 0 }).length > ADMISSION_NUMBER_MAX_LENGTH) {
    return { ok: false, error: `A filled-in number would be longer than ${ADMISSION_NUMBER_MAX_LENGTH} characters.` };
  }
  return { ok: true, format: parsed };
}

/** A class level's code as it appears in a number: "jss1" → "JSS1". */
export function classCodeForNumber(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function fillAdmissionNumber(
  format: ParsedFormat,
  input: { year: number; classCode?: string; value: number },
): string {
  return format.parts
    .map((p) => {
      switch (p.kind) {
        case "text":
          return p.value;
        case "year":
          return String(input.year);
        case "shortYear":
          return String(input.year % 100).padStart(2, "0");
        case "class":
          return classCodeForNumber(input.classCode ?? "");
        case "digits":
          return String(input.value).padStart(p.length, "0");
      }
    })
    .join("");
}

/**
 * Which count a number belongs to. The year is in the scope only when the
 * format shows it, so the count restarts each year exactly then (D3); the
 * class only when numbering per class.
 */
export function admissionCounterScope(
  format: ParsedFormat,
  input: { year: number; classCode?: string },
): string {
  const parts: string[] = [];
  if (format.hasYear) parts.push(String(input.year));
  if (format.hasClass) parts.push(classCodeForNumber(input.classCode ?? ""));
  return parts.join(":");
}

/**
 * A pattern matching numbers already written in this format for this scope,
 * capturing the digits, so numbering carries on from the register.
 */
export function admissionNumberPattern(
  format: ParsedFormat,
  input: { year: number; classCode?: string },
): RegExp {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
  const source = format.parts
    .map((p) => {
      switch (p.kind) {
        case "text":
          return escape(p.value);
        case "year":
          return format.hasYear ? String(input.year) : "\\d{4}";
        case "shortYear":
          return String(input.year % 100).padStart(2, "0");
        case "class":
          return escape(classCodeForNumber(input.classCode ?? ""));
        case "digits":
          return `(\\d{${p.length}})`;
      }
    })
    .join("");
  return new RegExp(`^${source}$`, "i");
}

/** The highest value already used in this pattern, or 0. */
export function highestExistingValue(numbers: string[], pattern: RegExp): number {
  let highest = 0;
  for (const n of numbers) {
    const m = pattern.exec(n);
    if (m?.[1]) highest = Math.max(highest, Number(m[1]));
  }
  return highest;
}

/** How many numbers a format can make before its digits run out. */
export function admissionCapacity(format: ParsedFormat): number {
  return 10 ** format.digits - 1;
}
