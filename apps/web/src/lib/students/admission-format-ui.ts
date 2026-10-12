// Pure helpers for the admission number screens (docs/modules/admission-numbers.md).

import {
  fillAdmissionNumber,
  parseAdmissionFormat,
  type AdmissionNumberOrder,
} from "@school-kit/types";

/** What a format looks like filled in, for the live example under the field. */
export function exampleNumbers(
  format: string,
  order: AdmissionNumberOrder,
  year: number,
): { ok: true; examples: string[] } | { ok: false; error: string } {
  const parsed = parseAdmissionFormat(format, order);
  if (!parsed.ok) return parsed;
  const f = parsed.format;
  const examples =
    order === "RANDOM"
      ? [4821, 1093, 7356].map((v) => fillAdmissionNumber(f, { year, value: v % 10 ** f.digits }))
      : order === "CLASS"
        ? [
            fillAdmissionNumber(f, { year, classCode: "JSS1", value: 1 }),
            fillAdmissionNumber(f, { year, classCode: "JSS1", value: 2 }),
            fillAdmissionNumber(f, { year, classCode: "PRI4", value: 1 }),
          ]
        : [1, 2, 3].map((v) => fillAdmissionNumber(f, { year, value: v }));
  return { ok: true, examples };
}

/** The simple dialog's pieces: text before, an optional year, the digits, text after. */
export interface SimpleFormat {
  prefix: string;
  withYear: boolean;
  digits: number;
  suffix: string;
}

/** Builds a format from the dialog's pieces. Per class adds {CLASS}/ after the year. */
export function composeFormat(simple: SimpleFormat, order: AdmissionNumberOrder): string {
  return (
    simple.prefix.trim() +
    (simple.withYear ? "{YYYY}/" : "") +
    (order === "CLASS" ? "{CLASS}/" : "") +
    `{${"N".repeat(simple.digits)}}` +
    simple.suffix.trim()
  );
}

/**
 * Reads a format back into the dialog's pieces, or null when it was written
 * by hand in a shape the dialog can't show (then the dialog shows the field).
 */
export function decomposeFormat(format: string): SimpleFormat | null {
  const m = /^([A-Za-z0-9/.-]*?)(\{YYYY\}\/)?(\{CLASS\}\/)?\{(N{3,8})\}([A-Za-z0-9/.-]*)$/i.exec(format.trim());
  if (!m) return null;
  return { prefix: m[1] ?? "", withYear: Boolean(m[2]), digits: m[4]!.length, suffix: m[5] ?? "" };
}

/** "VFM/2026/####": the format with its digits shown as #, for one-line display. */
export function formatAsPattern(format: string, year: number): string {
  return format
    .replace(/\{YYYY\}/gi, String(year))
    .replace(/\{YY\}/gi, String(year % 100).padStart(2, "0"))
    .replace(/\{CLASS\}/gi, "CLASS")
    .replace(/\{(N+)\}/gi, (_, n: string) => "#".repeat(n.length));
}

export const ORDER_CHOICES: { value: AdmissionNumberOrder; label: string; hint: string }[] = [
  { value: "SCHOOL", label: "In order, across the school", hint: "0001, 0002, 0003… one count for everyone." },
  { value: "CLASS", label: "In order, per class", hint: "Each class keeps its own count, with the class in the number." },
  { value: "RANDOM", label: "Random", hint: "Random digits that never repeat. Harder to guess." },
];
